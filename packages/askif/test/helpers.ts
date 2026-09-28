import { mock } from "../src/index.js";
import type { Answer, Question } from "../src/index.js";

/** Answers every question from fixed tables, keyed by the question text. */
export const tableBackend = (table: {
  readonly yesno?: Readonly<Record<string, number>>;
  readonly choice?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly scale?: Readonly<Record<string, readonly number[]>>;
  readonly confidence?: number;
}) =>
  mock((question: Question): Answer => {
    const text = JSON.stringify(question.instructions);
    const confidence = table.confidence === undefined ? {} : { confidence: table.confidence };
    switch (question.kind) {
      case "yesno": {
        const condition =
          typeof question.instructions === "object" &&
          question.instructions !== null &&
          !Array.isArray(question.instructions)
            ? question.instructions["condition"]
            : undefined;
        return {
          kind: "yesno",
          probability: typeof condition === "string" ? (table.yesno?.[condition] ?? 0.5) : 0.5,
        };
      }
      case "choice":
        return { kind: "choice", probabilities: table.choice?.[text] ?? {}, ...confidence };
      case "scale":
        return {
          kind: "scale",
          probabilities: table.scale?.[text] ?? question.levels.map(() => 1 / question.levels.length),
          ...confidence,
        };
      default:
        return question satisfies never;
    }
  });
