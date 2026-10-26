import { clipUntrusted, createAsk, makeAskError } from "askif";
import type { Backend, BackendLimits, DecisionContext, Json, Question, QuestionResult } from "askif";
import { configured, envValue } from "./env.js";
import { DEFAULT_MAX_IMAGES, prepare } from "./map.js";
import type { GatewayQuestion, SdkState } from "./map.js";
import { mergeProviderOptions } from "./options.js";
import type { VercelDecisionModel, VercelFallback, VercelProviderOptions } from "./options.js";
import { failed, finish } from "./usage.js";
import type { VercelUsage } from "./usage.js";

export type { GatewayQuestion, SdkState } from "./map.js";
export type { DecisionFallbackCondition, VercelDecisionModel, VercelFallback, VercelProviderOptions } from "./options.js";
export type { VercelUsage } from "./usage.js";

const DEFAULT_MODEL = "typesafe-ai/jev";
const HTTP_BASE_URL = "https://ai-gateway.vercel.sh";
const KEY_MESSAGE =
  "The Vercel AI Gateway backend needs an API key. Set AI_GATEWAY_API_KEY or pass apiKey.";
const HTTP_IMAGES =
  "The Vercel backend does not accept images. POST /v1/evaluate documents state as text or JSON, not image file parts.";
const SDK_IMAGES =
  "vercelDecide does not accept images unless images is true. The default model, typesafe-ai/jev, accepts text and JSON only.";

/** Optional caps. `maxLevels` defaults to 10. `maxImages` is ignored by `vercel()`. */
export type VercelLimits = {
  readonly maxImages?: number;
  readonly maxOptions?: number;
  readonly maxLevels?: number;
  readonly maxQuestionsPerCall?: number;
  readonly maxStatesPerCall?: number;
};

type SharedOptions = {
  /** Default: "typesafe-ai/jev". */
  readonly model?: string;
  /** Default: AI_GATEWAY_API_KEY. Read on the first call. */
  readonly apiKey?: string;
  readonly providerOptions?: VercelProviderOptions;
  /**
   * One conditional decision fallback, written into `providerOptions.gateway.models`
   * unless that array is already set. Both stages are billed, and they run one after the other.
   * Overlaps with askif's `.unsure()`, which keeps the decision in your code instead of rerunning it.
   */
  readonly fallback?: VercelFallback;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  /** Abort the request after this many milliseconds. */
  readonly timeout?: number;
  readonly limits?: VercelLimits;
  /** Called with token counts and gateway cost after a response body arrives, even if an answer is unreadable. */
  readonly onUsage?: (usage: VercelUsage) => void;
};

/**
 * `POST https://ai-gateway.vercel.sh/v1/evaluate`. No runtime dependency.
 * `baseURL` is the origin, default `https://ai-gateway.vercel.sh`. This is not the AI SDK base URL.
 */
export type VercelOptions = SharedOptions & {
  readonly baseURL?: string;
};

/** What an injected `decide` receives. Tests use this instead of loading `ai`. */
export type VercelDecideInput = {
  readonly model: VercelDecisionModel;
  readonly state: SdkState;
  readonly questions: Readonly<Record<string, GatewayQuestion>>;
  readonly providerOptions?: VercelProviderOptions;
  readonly headers?: Readonly<Record<string, string>>;
  readonly abortSignal?: AbortSignal;
  readonly maxRetries?: number;
};

export type VercelDecide = (input: VercelDecideInput) => Promise<unknown>;

/**
 * AI SDK `experimental_decide`. Requires the optional `ai` peer (7.0.128 or newer).
 * `baseURL` is the SDK gateway prefix. Omit it to use the SDK default, `https://ai-gateway.vercel.sh/v4/ai`.
 * Do not point it at the `/v1/evaluate` origin.
 */
export type VercelDecideOptions = Omit<SharedOptions, "model"> & {
  /** A model id, or a v4 decision model instance. Default id: "typesafe-ai/jev". */
  readonly model?: VercelDecisionModel;
  /**
   * Send PNG, JPEG, WebP, and GIF file parts. Off by default.
   * The default model, typesafe-ai/jev, accepts text and JSON only, so turn this on only for a model that takes images.
   */
  readonly images?: boolean;
  readonly baseURL?: string;
  /** Passed to `experimental_decide`. Default is the SDK's 2. Live tests pass 0. */
  readonly maxRetries?: number;
  /** Replaces the SDK call. The `ai` package is not imported when this is set. */
  readonly decide?: VercelDecide;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const limitsFor = (options: VercelLimits | undefined, maxImages: number | undefined): BackendLimits => ({
  maxLevels: options?.maxLevels ?? 10,
  ...(options?.maxOptions === undefined ? {} : { maxOptions: options.maxOptions }),
  ...(options?.maxQuestionsPerCall === undefined ? {} : { maxQuestionsPerCall: options.maxQuestionsPerCall }),
  ...(options?.maxStatesPerCall === undefined ? {} : { maxStatesPerCall: options.maxStatesPerCall }),
  ...(maxImages === undefined ? {} : { maxImages }),
});

const signalFor = (timeout: number | undefined): AbortSignal | undefined => {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw makeAskError("INVALID_QUESTION", "timeout must be a positive number of milliseconds.");
  }
  return AbortSignal.timeout(timeout);
};

const apiKeyFor = (apiKey: string | undefined): string | undefined => configured(apiKey) ?? envValue("AI_GATEWAY_API_KEY");

const requireKey = (model: VercelDecisionModel, apiKey: string | undefined): void => {
  if (typeof model === "string" && apiKeyFor(apiKey) === undefined) throw makeAskError("BACKEND_UNAVAILABLE", KEY_MESSAGE);
};

const providerOptionsFor = (
  providerOptions: VercelProviderOptions | undefined,
  fallback: VercelFallback | undefined,
): VercelProviderOptions | undefined => mergeProviderOptions(providerOptions, fallback);

const errorDetail = (body: unknown, text: string): string => {
  if (isRecord(body)) {
    const error = body["error"];
    if (typeof error === "string" && error !== "") return clipUntrusted(error);
    if (isRecord(error) && typeof error["message"] === "string" && error["message"] !== "") {
      return clipUntrusted(error["message"]);
    }
    if (typeof body["message"] === "string" && body["message"] !== "") return clipUntrusted(body["message"]);
  }
  const trimmed = text.trim();
  return trimmed === "" ? "empty response" : clipUntrusted(trimmed);
};

const endpoint = (baseURL: string): string => `${baseURL.replace(/\/+$/, "")}/v1/evaluate`;

const modelId = (model: VercelDecisionModel): string => (typeof model === "string" ? model : model.modelId);

/**
 * Decision API over HTTP. Same-state questions share one request.
 * Different states stay separate: this backend does not set `multiState`.
 * Images are rejected. `limits.maxImages` is not advertised.
 */
export const vercel = (options: VercelOptions = {}): Backend => {
  const model = options.model ?? DEFAULT_MODEL;
  const baseURL = options.baseURL ?? HTTP_BASE_URL;
  return {
    name: "vercel",
    limits: limitsFor(options.limits, undefined),
    decide: async (state, questions, context?: DecisionContext) =>
      post(options, model, baseURL, state, questions, context?.images === "explicit"),
  };
};

const post = async (
  options: VercelOptions,
  model: string,
  baseURL: string,
  state: Json,
  questions: Readonly<Record<string, Question>>,
  explicit: boolean,
): Promise<Readonly<Record<string, QuestionResult>>> => {
  const apiKey = apiKeyFor(options.apiKey);
  if (apiKey === undefined) throw makeAskError("BACKEND_UNAVAILABLE", KEY_MESSAGE);
  const prepared = prepare(state, questions, false, 0, HTTP_IMAGES, explicit);
  const signal = signalFor(options.timeout);
  const providerOptions = providerOptionsFor(options.providerOptions, options.fallback);
  const body = {
    model,
    state: prepared.http,
    questions: prepared.questions,
    ...(providerOptions === undefined ? {} : { providerOptions }),
  };
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(endpoint(baseURL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...options.headers,
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    throw makeAskError("BACKEND_FAILED", "The Vercel AI Gateway request failed.", error);
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!response.ok || parsed === undefined) {
    throw makeAskError(
      "BACKEND_FAILED",
      `Vercel AI Gateway request failed (HTTP ${response.status}): ${errorDetail(parsed, text)}`,
      parsed ?? text,
    );
  }
  return finish(parsed, model, questions, options.onUsage);
};

type SdkCaller = {
  readonly decideWithAi: (
    input: VercelDecideInput & {
      readonly apiKey?: string;
      readonly baseURL?: string;
      readonly fetch?: typeof fetch;
    },
  ) => Promise<unknown>;
};

const isSdk = (value: unknown): value is SdkCaller =>
  isRecord(value) && typeof value["decideWithAi"] === "function";

/**
 * Decision API through AI SDK `experimental_decide`.
 * Same-state questions share one call. `multiState` stays off: the API decides one shared state per call.
 * Images are off unless `images` is true, and then `maxImages` defaults to 16.
 */
export const vercelDecide = (options: VercelDecideOptions = {}): Backend => {
  const model = options.model ?? DEFAULT_MODEL;
  const cap = options.limits?.maxImages ?? DEFAULT_MAX_IMAGES;
  const allowImages = options.images === true && cap > 0;
  return {
    name: "vercel",
    limits: limitsFor(options.limits, allowImages ? cap : undefined),
    decide: (state, questions, context?: DecisionContext) =>
      decideWithSdk(
        options,
        model,
        allowImages,
        allowImages ? cap : 0,
        state,
        questions,
        context?.images === "explicit",
      ),
  };
};

const decideWithSdk = async (
  options: VercelDecideOptions,
  model: VercelDecisionModel,
  allowImages: boolean,
  maxImages: number,
  state: Json,
  questions: Readonly<Record<string, Question>>,
  explicit: boolean,
): Promise<Readonly<Record<string, QuestionResult>>> => {
  requireKey(model, options.apiKey);
  const prepared = prepare(state, questions, allowImages, maxImages, SDK_IMAGES, explicit);
  const providerOptions = providerOptionsFor(options.providerOptions, options.fallback);
  const signal = signalFor(options.timeout);
  const input: VercelDecideInput = {
    model,
    state: prepared.sdk,
    questions: prepared.questions,
    ...(providerOptions === undefined ? {} : { providerOptions }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(signal === undefined ? {} : { abortSignal: signal }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  };
  let body: unknown;
  try {
    body =
      options.decide !== undefined
        ? await options.decide(input)
        : await callSdk({
            ...input,
            apiKey: options.apiKey,
            baseURL: options.baseURL,
            fetch: options.fetch,
          });
  } catch (error) {
    failed(error, "The Vercel AI SDK decide call failed.");
  }
  return finish(body, modelId(model), questions, options.onUsage);
};

const callSdk = async (input: Parameters<SdkCaller["decideWithAi"]>[0]): Promise<unknown> => {
  const loaded: unknown = await import("./sdk.js").catch((error: unknown) => {
    throw makeAskError(
      "BACKEND_UNAVAILABLE",
      "vercelDecide needs the ai package (7.0.128 or newer). Install it with: npm install ai. ai depends on zod (^3.25.76 or ^4.1.8).",
      error,
    );
  });
  if (!isSdk(loaded)) {
    throw makeAskError("BACKEND_UNAVAILABLE", "vercelDecide could not load its AI SDK caller.");
  }
  return loaded.decideWithAi(input);
};

/**
 * The default instance, backed by `POST /v1/evaluate`.
 * Reads AI_GATEWAY_API_KEY from the environment on first use. It does not load the `ai` package.
 */
export const ask = createAsk({ backend: vercel() });
