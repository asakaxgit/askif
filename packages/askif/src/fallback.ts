import { isAskError, makeAskError } from "./errors.js";
import type { AskErrorCode } from "./errors.js";
import type {
  Backend,
  DecisionContext,
  DecisionItem,
  ItemResult,
  Question,
  QuestionResult,
  State,
} from "./types.js";

/**
 * Whether a failed primary call should be sent to the fallback backend.
 *
 * Transport failures fall back: the connection failed, the call timed out, the
 * server returned 5xx, or auth failed (401/403, including a missing API key).
 * 402 falls back too — the account cannot serve the request.
 *
 * These do not, because a second model would not fix them and would spend its quota:
 * - 429, and any other 4xx that is the caller's request (400, 404, 422, …)
 * - the caller aborting the call
 * - `INVALID_QUESTION`, `UNSUPPORTED_INPUT`, `BAD_RESPONSE`, `CHAIN_STARTED`
 * - `BACKEND_UNAVAILABLE` (the primary's own dependency is missing)
 * - an error that is none of the cases above (a bug should surface, not be hidden)
 *
 * A per-question `{ error }` is not a failed call. `shouldFallback` is only asked
 * when `decide` / `decideMany` throws.
 */
export const shouldFallback = (error: unknown): boolean => {
  const chain = causes(error);
  if (chain.some(isSurface)) return false;
  return chain.some(isTransportFailure);
};

export type FallbackOptions = {
  /**
   * Return true to send this thrown failure to the fallback backend.
   * Default: {@link shouldFallback}.
   */
  readonly when?: (error: unknown) => boolean;
  /** Called once per failed call that is sent to the fallback. Not called when the primary succeeds. */
  readonly onFallback?: (error: unknown) => void;
};

const questionCap = (backend: Backend): number => {
  const cap = backend.limits?.maxQuestionsPerCall;
  if (cap === undefined || !Number.isFinite(cap) || cap < 1) return Number.POSITIVE_INFINITY;
  return Math.floor(cap);
};

const stateCap = (backend: Backend): number => {
  const cap = backend.limits?.maxStatesPerCall;
  if (cap === undefined || !Number.isFinite(cap) || cap < 1) return Number.POSITIVE_INFINITY;
  return Math.floor(cap);
};

const chunksOf = (
  questions: Readonly<Record<string, Question>>,
  cap: number,
): readonly (readonly (readonly [string, Question])[])[] => {
  const entries = Object.entries(questions);
  if (entries.length <= cap) return [entries];
  const chunks: (readonly [string, Question])[][] = [];
  for (let index = 0; index < entries.length; index += cap) chunks.push(entries.slice(index, index + cap));
  return chunks;
};

/**
 * One state, split so a backend with `maxQuestionsPerCall: 1` (Vertex, via `@askif/openai`)
 * never sees the shared-state batch Jev answers in one call.
 */
const decideInChunks = async (
  backend: Backend,
  state: State,
  questions: Readonly<Record<string, Question>>,
  context: DecisionContext | undefined,
): Promise<Readonly<Record<string, QuestionResult>>> => {
  const chunks = chunksOf(questions, questionCap(backend));
  if (chunks.length === 1) {
    const only = chunks[0];
    return only === undefined ? {} : backend.decide(state, Object.fromEntries(only), context);
  }
  const parts = await Promise.all(
    chunks.map((slice) => backend.decide(state, Object.fromEntries(slice), context)),
  );
  const merged: { [id: string]: QuestionResult } = {};
  for (const part of parts) Object.assign(merged, part);
  return merged;
};

const isFailure = (result: QuestionResult): result is { readonly error: unknown } => !("kind" in result);

const toItem = (id: string, result: QuestionResult | undefined, backend: Backend): ItemResult => {
  if (result === undefined) {
    return { id, error: makeAskError("BAD_RESPONSE", `The ${backend.name} backend returned no answer.`) };
  }
  if (isFailure(result)) return { id, error: result.error };
  return { id, answer: result };
};

type StateGroup = { readonly state: State; readonly items: DecisionItem[] };

const groupsOf = (items: readonly DecisionItem[]): readonly StateGroup[] => {
  const groups: StateGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const key = JSON.stringify(item.state);
    const found = indexByKey.get(key);
    if (found === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({ state: item.state, items: [item] });
      continue;
    }
    const group = groups[found];
    if (group !== undefined) group.items.push(item);
  }
  return groups;
};

/**
 * Run `primary`, and on a transport failure run `secondary` instead.
 *
 * Limits and `multiState` are the primary's, so same-tick batching still fills one
 * Jev call. The fallback then splits that call into what `secondary` accepts:
 * one question at a time when `maxQuestionsPerCall` is 1, and one state at a time
 * when `secondary` has no `decideMany`.
 *
 * Each call tries the primary again. A transient 503 does not pin the process to
 * the fallback. Pass `onFallback` to warn; this function does not log.
 */
export const fallback = (primary: Backend, secondary: Backend, options: FallbackOptions = {}): Backend => {
  const when = options.when ?? shouldFallback;

  const notify = (error: unknown): void => {
    if (options.onFallback === undefined) return;
    try {
      options.onFallback(error);
    } catch {
      // A warning must not replace the fallback answer.
    }
  };

  const afterPrimary = async <T>(error: unknown, run: () => Promise<T>): Promise<T> => {
    if (!when(error)) throw error;
    notify(error);
    try {
      return await run();
    } catch (secondaryError) {
      // A bad answer or a rejected input is about this question. A fallback that
      // could not run (missing URL, missing SDK) or failed in transit keeps both causes.
      if (
        isAskError(secondaryError) &&
        secondaryError.code !== "BACKEND_FAILED" &&
        secondaryError.code !== "BACKEND_UNAVAILABLE"
      ) {
        throw secondaryError;
      }
      const code = isAskError(secondaryError) ? secondaryError.code : "BACKEND_FAILED";
      throw makeAskError(
        code,
        `The ${primary.name} backend failed (${describe(error)}); the ${secondary.name} fallback also failed (${describe(secondaryError)}).`,
        secondaryError,
      );
    }
  };

  const runSecondaryMany = async (
    items: readonly DecisionItem[],
    context: DecisionContext | undefined,
  ): Promise<readonly ItemResult[]> => {
    const decideMany = secondary.decideMany;
    const distinct = new Set(items.map((item) => JSON.stringify(item.state))).size;
    if (
      decideMany !== undefined &&
      secondary.multiState === true &&
      distinct <= stateCap(secondary) &&
      items.length <= questionCap(secondary)
    ) {
      return decideMany(items, context);
    }
    const byId = new Map<string, ItemResult>();
    await Promise.all(
      groupsOf(items).map(async (group) => {
        const questions = Object.fromEntries(group.items.map((item) => [item.id, item.question]));
        const answers = await decideInChunks(secondary, group.state, questions, context);
        for (const item of group.items) byId.set(item.id, toItem(item.id, answers[item.id], secondary));
      }),
    );
    return items.map(
      (item) =>
        byId.get(item.id) ?? {
          id: item.id,
          error: makeAskError("BAD_RESPONSE", `The ${secondary.name} backend returned no answer.`),
        },
    );
  };

  const decideMany = async (
    items: readonly DecisionItem[],
    context?: DecisionContext,
  ): Promise<readonly ItemResult[]> => {
    const primaryMany = primary.decideMany;
    if (primaryMany === undefined) return runSecondaryMany(items, context);
    try {
      return await primaryMany(items, context);
    } catch (error) {
      return afterPrimary(error, () => runSecondaryMany(items, context));
    }
  };

  return {
    name: primary.name,
    ...(primary.limits === undefined ? {} : { limits: primary.limits }),
    ...(primary.multiState === true && primary.decideMany !== undefined
      ? { multiState: true as const, decideMany }
      : {}),
    decide: async (state, questions, context) => {
      try {
        return await primary.decide(state, questions, context);
      } catch (error) {
        return afterPrimary(error, () => decideInChunks(secondary, state, questions, context));
      }
    },
  };
};

const describe = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "unknown error";
  return message.slice(0, 300);
};

const SURFACE_CODES = new Set<AskErrorCode>([
  "INVALID_QUESTION",
  "CHAIN_STARTED",
  "UNSUPPORTED_INPUT",
  "BAD_RESPONSE",
  "BACKEND_UNAVAILABLE",
]);

const SURFACE_NAMES = new Set([
  "BadRequestError",
  "NotFoundError",
  "UnprocessableEntityError",
  "RateLimitError",
]);

const FALLBACK_NAMES = new Set([
  "APIConnectionError",
  "APITimeoutError",
  "APIConnectionTimeoutError",
  "AuthenticationError",
  "PermissionDeniedError",
  "InternalServerError",
  "TimeoutError",
]);

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const SURFACE_STRING_CODES = new Set(["RATE_LIMITED", "rate_limit_exceeded", "too_many_requests"]);

const TIMEOUT_MESSAGE = /timed?\s*out|\btimeout\b|ETIMEDOUT/i;
const MISSING_KEY = /no api key|api key was provided|TYPESAFE_API_KEY/i;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const causes = (error: unknown): readonly unknown[] => {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    if (!("cause" in current)) break;
    const next = current["cause"];
    if (next === undefined || next === null) break;
    current = next;
  }
  return chain;
};

const statusOf = (record: Readonly<Record<string, unknown>>): number | undefined => {
  const status = record["status"];
  if (typeof status === "number") return status;
  const statusCode = record["statusCode"];
  return typeof statusCode === "number" ? statusCode : undefined;
};

const stringCode = (record: Readonly<Record<string, unknown>>): string | undefined => {
  const code = record["code"];
  return typeof code === "string" ? code : undefined;
};

const surfaceStatus = (status: number): boolean =>
  status === 429 || (status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 408 && status !== 402);

const fallbackStatus = (status: number): boolean =>
  status === 401 || status === 403 || status === 408 || status === 402 || (status >= 500 && status <= 599);

const isSurface = (error: unknown): boolean => {
  if (!isRecord(error)) return false;
  if (isAskError(error) && SURFACE_CODES.has(error.code)) return true;
  const name = typeof error["name"] === "string" ? error["name"] : "";
  if (SURFACE_NAMES.has(name) || name === "APIUserAbortError") return true;
  const code = stringCode(error);
  if (code !== undefined && SURFACE_STRING_CODES.has(code)) return true;
  const status = statusOf(error);
  if (status !== undefined && surfaceStatus(status)) return true;
  if (name === "AbortError" && !(error instanceof Error && TIMEOUT_MESSAGE.test(error.message))) return true;
  return false;
};

const isTransportFailure = (error: unknown): boolean => {
  if (!isRecord(error)) return false;
  const name = typeof error["name"] === "string" ? error["name"] : "";
  if (FALLBACK_NAMES.has(name)) return true;
  const status = statusOf(error);
  if (status !== undefined && fallbackStatus(status)) return true;
  const code = stringCode(error);
  if (code !== undefined && NETWORK_CODES.has(code)) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "TypeError" && error.message === "fetch failed") return true;
  if (TIMEOUT_MESSAGE.test(error.message)) return true;
  if (error.name === "AbortError" && TIMEOUT_MESSAGE.test(error.message)) return true;
  return MISSING_KEY.test(error.message);
};
