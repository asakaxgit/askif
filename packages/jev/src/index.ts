import type {
  EntryType,
  Question as TypeSafeQuestion,
  Questions as TypeSafeQuestions,
  ResultFor,
  TypeSafeClient,
  TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import { createAsk, makeAskError } from "askif";
import type { Answer, Backend, Json, Question } from "askif";

export type JevOptions = TypeSafeClientConfig & {
  /** Model id, e.g. "jev-1.13". Default: the client's default, "jev-latest". */
  readonly model?: string;
  /** Use an existing client instead of creating one. */
  readonly client?: TypeSafeClient;
};

/** Limits documented for jev-1.13. */
const LIMITS = { maxOptions: 255, maxLevels: 10 } as const;

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

/**
 * Backend for TypeSafe System One models such as Jev.
 *
 * The SDK (`@typesafe-ai/sdk`) is loaded on the first call, so it is only
 * needed when this backend is actually used.
 */
export const jev = (options: JevOptions = {}): Backend => {
  const { model, client, ...clientConfig } = options;
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

  return {
    name: "jev",
    limits: LIMITS,
    decide: async (state, questions) => {
      const typesafeQuestions: TypeSafeQuestions = Object.fromEntries(
        Object.entries(questions).map(([id, q]) => [id, toTypesafe(q)]),
      );
      const response = await (await getClient()).systemOne({
        state: toEntry(state),
        questions: typesafeQuestions,
        ...(model === undefined ? {} : { model }),
      });
      return Object.fromEntries(
        Object.entries(questions).map(([id, q]) => [id, fromTypesafe(q, response.answers[id])]),
      );
    },
  };
};

/**
 * The default instance, backed by TypeSafe's Jev.
 * Reads TYPESAFE_API_KEY from the environment on first use.
 */
export const ask = createAsk({ backend: jev() });
