import type {
  EntryType,
  Question as TypeSafeQuestion,
  Questions as TypeSafeQuestions,
  ResultFor,
  TypeSafeClient,
  TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import { createAsk, makeAskError } from "askif";
import type { Answer, Backend, DecisionItem, ItemResult, Json, Question, QuestionResult } from "askif";

export type JevOptions = TypeSafeClientConfig & {
  /** Model id, e.g. "jev-1.13". Default: the client's default, "jev-latest". */
  readonly model?: string;
  /** Use an existing client instead of creating one. */
  readonly client?: TypeSafeClient;
  /**
   * Pack different states from the same tick into one `systemOne` call.
   * Default: false. Set true to opt in.
   */
  readonly multiState?: boolean;
};

/** Limits documented for jev-1.13. `maxStatesPerCall` is this backend's own cap on cross-state batches. */
const LIMITS = { maxOptions: 255, maxLevels: 10, maxStatesPerCall: 32 } as const;

// The question/answer mapping below mirrors packages/clef/src/index.ts (same System One
// wire format). Change both together; the shared fixture in
// packages/askif/test/fixtures/system-one.ts is checked by both packages' tests.
// Differences are deliberate: Jev trusts the SDK's response types, Clef validates them.

/** TypeSafe accepts text, objects, arrays, or null. Numbers and booleans are sent as text. */
const toEntry = (value: Json): EntryType =>
  typeof value === "number" || typeof value === "boolean" ? String(value) : value;

const toTypesafe = (question: Question): TypeSafeQuestion => {
  switch (question.kind) {
    case "yesno": {
      const { criteria } = question;
      return {
        type: "noul",
        instructions: toEntry(question.instructions),
        ...(criteria === undefined
          ? {}
          : {
              criteria: {
                ...(criteria.true === undefined ? {} : { true: toEntry(criteria.true) }),
                ...(criteria.false === undefined ? {} : { false: toEntry(criteria.false) }),
              },
            }),
      };
    }
    case "choice":
      return {
        type: "choice",
        instructions: toEntry(question.instructions),
        criteria: Object.fromEntries(question.options.map((o) => [o.key, toEntry(o.description)])),
      };
    case "scale": {
      const [first, second, ...rest] = question.levels.map(toEntry);
      if (first === undefined || second === undefined) {
        throw makeAskError("INVALID_QUESTION", "A scale needs at least 2 levels.");
      }
      return {
        type: "score",
        instructions: toEntry(question.instructions),
        criteria: [first, second, ...rest],
      };
    }
    default:
      return question satisfies never;
  }
};

const fromTypesafe = (
  question: Question,
  answer: ResultFor<TypeSafeQuestion> | undefined,
): Answer => {
  switch (question.kind) {
    case "yesno":
      if (answer?.type === "noul") return { kind: "yesno", probability: answer.noul };
      break;
    case "choice":
      if (answer?.type === "choice") {
        return {
          kind: "choice",
          probabilities: Object.fromEntries(
            question.options.map((o) => [o.key, answer.probabilities[o.key] ?? 0]),
          ),
          confidence: answer.confidence,
        };
      }
      break;
    case "scale":
      if (answer?.type === "score") {
        return {
          kind: "scale",
          probabilities: question.levels.map((_, i) => answer.probabilities[i] ?? 0),
          confidence: answer.confidence,
        };
      }
      break;
    default:
      return question satisfies never;
  }
  throw makeAskError("BAD_RESPONSE", `TypeSafe returned no ${question.kind} answer.`);
};

const isFailure = (result: QuestionResult): result is { readonly error: unknown } => !("kind" in result);

/** Point a question at one entry of a composite `{ items }` state. The caller's question is left unchanged. */
const scopeQuestion = (question: Question, item: string): Question => {
  const instructions = {
    about: `items.${item}`,
    note: `Answer only about items.${item}. Ignore every other item. "The state" means items.${item}.`,
    // Same representation a one-state call would send: numbers and booleans become text.
    question: toEntry(question.instructions),
  };
  switch (question.kind) {
    case "yesno":
      return { ...question, instructions };
    case "choice":
      return { ...question, instructions };
    case "scale":
      return { ...question, instructions };
    default:
      return question satisfies never;
  }
};

const toItemResult = (id: string, result: QuestionResult | undefined): ItemResult => {
  if (result === undefined) return { id, error: makeAskError("BAD_RESPONSE", "TypeSafe returned no answer.") };
  if (isFailure(result)) return { id, error: result.error };
  return { id, answer: result };
};

/**
 * Backend for TypeSafe System One models such as Jev.
 *
 * The SDK (`@typesafe-ai/sdk`) is loaded on the first call, so it is only
 * needed when this backend is actually used.
 */
export const jev = (options: JevOptions = {}): Backend => {
  const { model, client, multiState = false, ...clientConfig } = options;
  let clientPromise: Promise<TypeSafeClient> | undefined;

  const loadClient = async (): Promise<TypeSafeClient> => {
    if (client !== undefined) return client;
    const sdk = await import("@typesafe-ai/sdk").catch((error: unknown) => {
      throw makeAskError(
        "BACKEND_UNAVAILABLE",
        "The Jev backend needs @typesafe-ai/sdk. Install it with: npm install @typesafe-ai/sdk",
        error,
      );
    });
    return new sdk.TypeSafeClient(clientConfig);
  };

  const getClient = (): Promise<TypeSafeClient> =>
    (clientPromise ??= loadClient().catch((error: unknown) => {
      // Don't cache a failure (e.g. a missing API key), so a later call can retry.
      clientPromise = undefined;
      throw error;
    }));

  // `wire` is what the model reads. `original` is what the answer is checked against,
  // so a rewritten question still validates as the caller's question.
  const answerAll = async (
    state: EntryType,
    wire: Readonly<Record<string, Question>>,
    original: Readonly<Record<string, Question>>,
  ): Promise<Readonly<Record<string, QuestionResult>>> => {
    const typesafeQuestions: TypeSafeQuestions = Object.fromEntries(
      Object.entries(wire).map(([id, q]) => [id, toTypesafe(q)]),
    );
    const response = await (await getClient()).systemOne({
      state,
      questions: typesafeQuestions,
      ...(model === undefined ? {} : { model }),
    });
    const results: { [id: string]: QuestionResult } = {};
    for (const [id, question] of Object.entries(original)) {
      try {
        results[id] = fromTypesafe(question, response.answers[id]);
      } catch (error) {
        results[id] = { error };
      }
    }
    return results;
  };

  const decideMany = async (items: readonly DecisionItem[]): Promise<readonly ItemResult[]> => {
    const first = items[0];
    if (first === undefined) return [];
    const itemKey = new Map<string, string>();
    const entries: { readonly key: string; readonly state: EntryType }[] = [];
    for (const item of items) {
      const stable = JSON.stringify(item.state);
      if (itemKey.has(stable)) continue;
      const key = `i${itemKey.size}`;
      itemKey.set(stable, key);
      entries.push({ key, state: toEntry(item.state) });
    }
    // A single state stays on the normal wire format. Cross-state calls are the ones that get packed.
    if (itemKey.size < 2) {
      const questions = Object.fromEntries(items.map((item) => [item.id, item.question]));
      const results = await answerAll(toEntry(first.state), questions, questions);
      return items.map((item) => toItemResult(item.id, results[item.id]));
    }
    const scoped: { [id: string]: Question } = {};
    const original: { [id: string]: Question } = {};
    for (const item of items) {
      const key = itemKey.get(JSON.stringify(item.state));
      if (key === undefined) continue;
      scoped[item.id] = scopeQuestion(item.question, key);
      original[item.id] = item.question;
    }
    const results = await answerAll(
      { items: Object.fromEntries(entries.map((entry) => [entry.key, entry.state])) },
      scoped,
      original,
    );
    return items.map((item) => toItemResult(item.id, results[item.id]));
  };

  return {
    name: "jev",
    limits: LIMITS,
    ...(multiState ? { multiState: true as const, decideMany } : {}),
    decide: async (state, questions) => answerAll(toEntry(state), questions, questions),
  };
};

/**
 * The default instance, backed by TypeSafe's Jev.
 * Reads TYPESAFE_API_KEY from the environment on first use.
 */
export const ask = createAsk({ backend: jev() });
