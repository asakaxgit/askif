// Shared contract for the System One backends (@askif/jev, @askif/clef).
//
// Both speak the same wire format, so each package's test feeds this fixture
// through its own transport and asserts the same request and the same decoded
// answers. If one mapping drifts from the other, its test fails. Test-only:
// this file is not published.
import type { Answer, Json, Question } from "../../src/index.js";

export const state: Json = { ticket: "Shoes arrived in the wrong size.", n: 7 };

/** What askif hands a backend. */
export const questions: Readonly<Record<string, Question>> = {
  urgent: {
    kind: "yesno",
    instructions: "Is this urgent?",
    criteria: { true: "Customer is blocked", false: "Can wait" },
  },
  plain: { kind: "yesno", instructions: 42 },
  team: {
    kind: "choice",
    instructions: "Which team?",
    options: [
      { key: "returns", description: "Exchanges" },
      { key: "billing", description: null },
    ],
  },
  severity: { kind: "scale", instructions: "How severe?", levels: ["minor", "major", "blocking"] },
};

/** The `questions` object each backend must put on the wire. */
export const wireQuestions: Readonly<Record<string, Json>> = {
  urgent: {
    type: "noul",
    instructions: "Is this urgent?",
    criteria: { true: "Customer is blocked", false: "Can wait" },
  },
  plain: { type: "noul", instructions: "42" }, // numbers are sent as text
  team: {
    type: "choice",
    instructions: "Which team?",
    criteria: { returns: "Exchanges", billing: null },
  },
  severity: { type: "score", instructions: "How severe?", criteria: ["minor", "major", "blocking"] },
};

/** The `answers` a System One server returns for the questions above. */
export const wireAnswers: Readonly<Record<string, Json>> = {
  urgent: { type: "noul", noul: 0.9 },
  plain: { type: "noul", noul: 0.25 },
  team: { type: "choice", choice: "returns", confidence: 0.4, probabilities: { returns: 0.7, billing: 0.3 } },
  severity: {
    type: "score",
    score: 1.5,
    confidence: 0.35,
    legend: { "0": "minor", "1": "major", "2": "blocking" },
    probabilities: { "0": 0, "1": 0.5, "2": 0.5 },
  },
};

/** What each backend must decode `wireAnswers` into. */
export const expectedAnswers: Readonly<Record<string, Answer>> = {
  urgent: { kind: "yesno", probability: 0.9 },
  plain: { kind: "yesno", probability: 0.25 },
  team: { kind: "choice", probabilities: { returns: 0.7, billing: 0.3 }, confidence: 0.4 },
  severity: { kind: "scale", probabilities: [0, 0.5, 0.5], confidence: 0.35 },
};
