import { makeAskError } from "../../packages/askif/src/index.ts";
import type {
  Answer,
  Backend,
  BackendLimits,
  DecisionContext,
  DecisionItem,
  ItemResult,
  Question,
  QuestionResult,
  State,
} from "../../packages/askif/src/index.ts";
import { isRecord, readNumber, readString } from "./json.ts";
import type { AskErrorCode } from "../../packages/askif/src/index.ts";

export type RecordedDecide = {
  readonly state: State;
  readonly questionCount: number;
  readonly questions: readonly unknown[];
  readonly context: DecisionContext | null;
};

export type RecordedMany = {
  readonly itemCount: number;
  readonly items: readonly unknown[];
  readonly context: DecisionContext | null;
};

export type Scripted = {
  readonly backend: Backend;
  readonly decide: readonly RecordedDecide[];
  readonly decideMany: readonly RecordedMany[];
  readonly exhausted: () => string | undefined;
};

type AnswerSpec = Readonly<Record<string, unknown>>;

const questionJson = (question: Question): unknown => {
  if (question.kind === "yesno") {
    return { kind: "yesno", instructions: question.instructions, criteria: question.criteria ?? null };
  }
  if (question.kind === "choice") {
    return { kind: "choice", instructions: question.instructions, options: question.options };
  }
  return { kind: "scale", instructions: question.instructions, levels: question.levels };
};

const answerFrom = (spec: AnswerSpec): Answer => {
  const kind = readString(spec["kind"], "answer.kind");
  if (kind === "yesno") {
    return { kind: "yesno", probability: readNumber(spec["probability"], "probability") };
  }
  if (kind === "choice") {
    const probabilities = spec["probabilities"];
    if (!isRecord(probabilities)) throw new Error("choice probabilities must be an object");
    const parsed: Record<string, number> = {};
    for (const [key, value] of Object.entries(probabilities)) {
      parsed[key] = readNumber(value, key);
    }
    const confidence = spec["confidence"];
    return typeof confidence === "number"
      ? { kind: "choice", probabilities: parsed, confidence }
      : { kind: "choice", probabilities: parsed };
  }
  if (kind === "scale") {
    const probabilities = spec["probabilities"];
    if (!Array.isArray(probabilities)) throw new Error("scale probabilities must be an array");
    const confidence = spec["confidence"];
    const values = probabilities.map((value, index) => readNumber(value, `p${index}`));
    return typeof confidence === "number"
      ? { kind: "scale", probabilities: values, confidence }
      : { kind: "scale", probabilities: values };
  }
  throw new Error(`unknown answer kind ${kind}`);
};

const limitsOf = (raw: unknown): BackendLimits | undefined => {
  if (!isRecord(raw)) return undefined;
  const limits: {
    maxImages?: number;
    maxOptions?: number;
    maxLevels?: number;
    maxQuestionsPerCall?: number;
    maxStatesPerCall?: number;
  } = {};
  for (const key of ["maxImages", "maxOptions", "maxLevels", "maxQuestionsPerCall", "maxStatesPerCall"] as const) {
    const value = raw[key];
    if (typeof value === "number") limits[key] = value;
  }
  return limits;
};

const errorCode = (value: string): AskErrorCode | undefined => {
  if (
    value === "INVALID_QUESTION" ||
    value === "CHAIN_STARTED" ||
    value === "BACKEND_FAILED" ||
    value === "BACKEND_UNAVAILABLE" ||
    value === "UNSUPPORTED_INPUT" ||
    value === "BAD_RESPONSE"
  ) {
    return value;
  }
  return undefined;
};

export const scriptedBackend = (name: string, spec: unknown, script: unknown): Scripted => {
  const backendSpec = isRecord(spec) ? spec : {};
  const side = isRecord(script) ? script : {};
  const decideSteps = Array.isArray(side["decide"]) ? side["decide"] : [];
  const manySteps = Array.isArray(side["decideMany"]) ? side["decideMany"] : [];
  const decideLog: RecordedDecide[] = [];
  const manyLog: RecordedMany[] = [];
  let decideCursor = 0;
  let manyCursor = 0;
  let problem: string | undefined;

  const mustRecord = (value: unknown): Readonly<Record<string, unknown>> => {
    if (!isRecord(value)) {
      problem = "script exhausted";
      throw new Error("script exhausted");
    }
    return value;
  };

  const stepAt = (steps: readonly unknown[], cursor: number): Readonly<Record<string, unknown>> =>
    mustRecord(steps[cursor]);

  const instructionKey = (instructions: Question["instructions"]): string => {
    if (typeof instructions === "string") return instructions;
    return JSON.stringify(instructions);
  };

  const byKindAnswer = (question: Question, byKind: Readonly<Record<string, unknown>>): QuestionResult => {
    if (question.kind === "yesno") {
      const table = mustRecord(byKind["yesno"]);
      const condition = isRecord(question.instructions) ? question.instructions["condition"] : undefined;
      if (typeof condition !== "string") {
        problem = "script exhausted";
        throw new Error("script exhausted");
      }
      const probability = table[condition];
      if (typeof probability !== "number") {
        problem = "script exhausted";
        throw new Error("script exhausted");
      }
      return { kind: "yesno", probability };
    }
    if (question.kind === "choice") {
      const table = mustRecord(byKind["choice"]);
      const body = mustRecord(table[instructionKey(question.instructions)]);
      return answerFrom({ kind: "choice", ...body });
    }
    const table = mustRecord(byKind["scale"]);
    const body = mustRecord(table[instructionKey(question.instructions)]);
    return answerFrom({ kind: "scale", ...body });
  };

  const specsFor = (step: Readonly<Record<string, unknown>>, count: number): readonly (AnswerSpec | undefined)[] => {
    const answers = step["answers"];
    if (isRecord(answers) && "each" in answers) {
      const each = mustRecord(answers["each"]);
      return Array.from({ length: count }, () => each);
    }
    if (!Array.isArray(answers)) {
      problem = "script exhausted";
      throw new Error("script exhausted");
    }
    return answers.map((item: unknown) => (isRecord(item) ? item : undefined));
  };

  const one = (specAnswer: AnswerSpec | undefined): QuestionResult | undefined => {
    if (specAnswer === undefined) return undefined;
    if (specAnswer["throw"] === true) throw new Error("item failed");
    const code = specAnswer["error"];
    if (typeof code === "string") {
      const parsed = errorCode(code);
      if (parsed === undefined) {
        problem = "script exhausted";
        throw new Error("script exhausted");
      }
      return { error: makeAskError(parsed, parsed) };
    }
    return answerFrom(specAnswer);
  };

  const multiState = backendSpec["multiState"] === true;
  const hasDecideMany = backendSpec["hasDecideMany"] === true;
  const limits = limitsOf(backendSpec["limits"]);

  const decideMany = async (items: readonly DecisionItem[], context?: DecisionContext): Promise<readonly ItemResult[]> => {
    const step = stepAt(manySteps, manyCursor);
    manyCursor += 1;
    manyLog.push({
      itemCount: items.length,
      items: items.map((item) => ({ id: item.id, state: item.state, question: questionJson(item.question) })),
      context: context ?? null,
    });
    if (step["throw"] === true) throw new Error("scripted failure");
    const byKind = step["byKind"];
    const specs = isRecord(byKind) ? [] : specsFor(step, items.length);
    return items.map((item, index): ItemResult => {
      try {
        const result = isRecord(byKind) ? byKindAnswer(item.question, byKind) : one(specs[index]);
        if (result === undefined) return { id: item.id, error: new Error("missing answer") };
        if ("error" in result) return { id: item.id, error: result.error };
        return { id: item.id, answer: result };
      } catch (error) {
        return { id: item.id, error };
      }
    });
  };

  const backend: Backend = {
    name,
    ...(limits === undefined ? {} : { limits }),
    ...(multiState ? { multiState: true } : {}),
    ...(hasDecideMany ? { decideMany } : {}),
    decide: async (state, questions, context) => {
      const step = stepAt(decideSteps, decideCursor);
      decideCursor += 1;
      const ids = Object.keys(questions);
      decideLog.push({
        state,
        questionCount: ids.length,
        questions: ids.map((id) => {
          const question = questions[id];
          if (question === undefined) return null;
          return questionJson(question);
        }),
        context: context ?? null,
      });
      if (step["throw"] === true) throw new Error("scripted failure");
      const byKind = step["byKind"];
      const specs = isRecord(byKind) ? [] : specsFor(step, ids.length);
      const results: Record<string, QuestionResult> = {};
      ids.forEach((id, index) => {
        const question = questions[id];
        const result = isRecord(byKind)
          ? question === undefined
            ? undefined
            : byKindAnswer(question, byKind)
          : one(specs[index]);
        if (result !== undefined) results[id] = result;
      });
      return results;
    },
  };

  return { backend, decide: decideLog, decideMany: manyLog, exhausted: () => problem };
};
