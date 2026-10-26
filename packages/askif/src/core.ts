import { isAskError, makeAskError } from "./errors.js";
import type { AskError } from "./errors.js";
import { extractImages } from "./image.js";
import type {
  Answer,
  Ask,
  AskConfig,
  Backend,
  CallOptions,
  ChoiceAnswer,
  ChoiceQuestion,
  DecisionOptions,
  Description,
  Handler,
  ElseIfChain,
  IfChain,
  IfElseIfResult,
  IfElseResult,
  IfOptions,
  IfResult,
  IfThenResult,
  IfUnsureResult,
  Question,
  QuestionResult,
  Ranked,
  ScaleAnswer,
  ScaleQuestion,
  ScoreChain,
  ScoreResult,
  State,
  SwitchChain,
  SwitchResult,
  UnsureOptions,
  YesNoAnswer,
  YesNoCriteria,
  YesNoQuestion,
} from "./types.js";

const DEFAULTS = {
  threshold: 0.5,
  unsureBand: [0.2, 0.8],
  minConfidence: 0.5,
  maxBatchSize: 32,
  maxStatesPerBatch: 16,
} as const satisfies Omit<AskConfig, "backend">;

const OTHER_DESCRIPTION = "None of the other options fit";

/* -------------------------------------------------------------------------- */
/* Math                                                                       */
/* -------------------------------------------------------------------------- */

/** 1 minus normalized entropy: 1 when all probability is on one outcome, 0 when it is flat. */
export const confidenceOf = (probabilities: readonly number[]): number => {
  if (probabilities.length < 2) return 1;
  const entropy = probabilities.reduce((sum, p) => (p > 0 ? sum - p * Math.log(p) : sum), 0);
  return Math.min(1, Math.max(0, 1 - entropy / Math.log(probabilities.length)));
};

const argmax = (values: readonly number[]): number =>
  values.reduce((best, value, index) => (value > (values[best] ?? -Infinity) ? index : best), 0);

/* -------------------------------------------------------------------------- */
/* Chain runner: starts on the next microtask so the whole chain is attached  */
/* -------------------------------------------------------------------------- */

type Runner<R> = {
  readonly assertOpen: (method: string) => void;
  readonly result: () => Promise<R>;
};

const makeRunner = <R>(execute: () => Promise<R>): Runner<R> => {
  let promise: Promise<R> | undefined;
  let awaited = false;
  const run = (): Promise<R> => (promise ??= execute());

  queueMicrotask(() => {
    run().catch((error: unknown) => {
      // Nobody awaited this chain, so surface the error instead of losing it.
      if (!awaited) console.error("askif:", error);
    });
  });

  return {
    assertOpen: (method) => {
      if (promise !== undefined) {
        throw makeAskError(
          "CHAIN_STARTED",
          `.${method}() was called after the question was sent. Chain every call in one expression.`,
        );
      }
    },
    result: () => {
      awaited = true;
      return run();
    },
  };
};

const isKey = <K extends readonly string[]>(keys: K, value: string): value is K[number] =>
  keys.some((key) => key === value);

const splitArgs = <H>(
  descriptionOrHandler: Description | H | undefined,
  handler: H | undefined,
  fallback: Description,
): { readonly description: Description; readonly handler: H | undefined } =>
  typeof descriptionOrHandler === "function"
    ? { description: fallback, handler: descriptionOrHandler }
    : { description: descriptionOrHandler ?? fallback, handler };

const checkCount = (what: "options" | "levels", count: number, max: number | undefined): void => {
  if (count < 2) {
    throw makeAskError("INVALID_QUESTION", `A question needs at least 2 ${what}, got ${count}.`);
  }
  if (max !== undefined && count > max) {
    throw makeAskError(
      "INVALID_QUESTION",
      `This backend accepts at most ${max} ${what}, got ${count}.`,
    );
  }
};

/* -------------------------------------------------------------------------- */
/* createAsk                                                                  */
/* -------------------------------------------------------------------------- */

type Pending = {
  readonly question: Question;
  readonly state: State;
  /** Images in `state`. A repeated state contributes this once per request. */
  readonly imageCount: number;
  readonly resolve: (answer: Answer) => void;
  readonly reject: (error: unknown) => void;
};

type Batch = {
  readonly backend: Backend;
  readonly state: State;
  readonly items: Pending[];
};

type SwitchCase = {
  readonly key: string;
  readonly description: Description;
  readonly handler: Handler<SwitchResult<string>> | undefined;
};

type ScoreLevel = {
  readonly key: string;
  readonly description: Description;
  readonly handler: Handler<ScoreResult<string>> | undefined;
};

export const createAsk = (
  init: { readonly backend: Backend } & Partial<Omit<AskConfig, "backend">>,
): Ask => {
  let config: AskConfig = { ...DEFAULTS, ...init };

  /* ---------------------------- batching ---------------------------- */

  const queues = new Map<Backend, Map<string, Batch>>();
  let flushScheduled = false;

  const questionLimit = (backend: Backend): number =>
    Math.max(1, Math.min(config.maxBatchSize, backend.limits?.maxQuestionsPerCall ?? Infinity));

  // Backends that don't opt in stay at one state per call, whatever the config says.
  const stateLimit = (backend: Backend): number => {
    if (backend.multiState !== true || backend.decideMany === undefined) return 1;
    return Math.max(1, Math.min(config.maxStatesPerBatch, backend.limits?.maxStatesPerCall ?? Infinity));
  };

  const rejectAll = (backend: Backend, items: readonly Pending[], error: unknown): void => {
    const wrapped = isAskError(error)
      ? error
      : makeAskError("BACKEND_FAILED", `The ${backend.name} backend failed.`, error);
    items.forEach((item) => item.reject(wrapped));
  };

  const badAnswer = (backend: Backend, item: Pending, cause?: unknown): AskError => {
    if (isAskError(cause)) return cause;
    return makeAskError(
      "BAD_RESPONSE",
      `The ${backend.name} backend returned no ${item.question.kind} answer for a question.`,
      cause,
    );
  };

  const isFailure = (result: QuestionResult): result is { readonly error: unknown } => !("kind" in result);

  const accept = (backend: Backend, item: Pending, result: QuestionResult | undefined): void => {
    if (result === undefined || isFailure(result)) {
      item.reject(badAnswer(backend, item, result === undefined ? undefined : result.error));
      return;
    }
    if (result.kind === item.question.kind) item.resolve(result);
    else item.reject(badAnswer(backend, item));
  };

  const send = async (backend: Backend, state: State, items: readonly Pending[]): Promise<void> => {
    const questions = Object.fromEntries(items.map((item, i) => [`q${i}`, item.question]));
    try {
      const answers = await backend.decide(state, questions);
      items.forEach((item, i) => accept(backend, item, answers[`q${i}`]));
    } catch (error) {
      rejectAll(backend, items, error);
    }
  };

  const sendMany = async (backend: Backend, items: readonly Pending[]): Promise<void> => {
    const decideMany = backend.decideMany;
    const first = items[0];
    const distinct = new Set(items.map((item) => JSON.stringify(item.state)));
    // One state keeps the original `decide` wire format: no composite, no rewritten question.
    if (decideMany === undefined || first === undefined || distinct.size < 2) {
      if (first !== undefined) await send(backend, first.state, items);
      return;
    }
    const payload = items.map((item, i) => ({ id: `q${i}`, state: item.state, question: item.question }));
    try {
      const results = await decideMany(payload);
      const byId = new Map(results.map((result) => [result.id, result]));
      items.forEach((item, i) => {
        const result = byId.get(`q${i}`);
        if (result === undefined) accept(backend, item, undefined);
        else if ("error" in result) accept(backend, item, { error: result.error });
        else accept(backend, item, result.answer);
      });
    } catch (error) {
      rejectAll(backend, items, error);
    }
  };

  // Items arrive grouped by state (first-seen state, then that state's questions, in call order).
  // A chunk closes when another question would pass the question limit, another state would pass
  // the state limit, or another state's images would pass maxImages. Images are counted once per
  // distinct state. States are not rewritten: `[image N]` stays local to each state.
  const pack = (
    items: readonly Pending[],
    maxQuestions: number,
    maxStates: number,
    maxImages: number,
  ): Pending[][] => {
    const chunks: Pending[][] = [];
    let current: Pending[] = [];
    const states = new Set<string>();
    let images = 0;
    const close = (): void => {
      if (current.length === 0) return;
      chunks.push(current);
      current = [];
      states.clear();
      images = 0;
    };
    for (const item of items) {
      const key = JSON.stringify(item.state);
      const seen = states.has(key);
      const addsImages = seen ? 0 : item.imageCount;
      const overBudget =
        current.length >= maxQuestions ||
        (!seen && states.size >= maxStates) ||
        (addsImages > 0 && images + addsImages > maxImages);
      if (current.length > 0 && overBudget) close();
      // Membership is checked again: a chunk that just closed does not already contain this state.
      if (!states.has(key)) images += item.imageCount;
      current.push(item);
      states.add(key);
    }
    close();
    return chunks;
  };

  const flush = (): void => {
    flushScheduled = false;
    const pending = [...queues.entries()];
    queues.clear();
    for (const [backend, byState] of pending) {
      const items = [...byState.values()].flatMap((batch) => batch.items);
      const maxQuestions = questionLimit(backend);
      const maxStates = stateLimit(backend);
      const maxImages = backend.limits?.maxImages ?? 0;
      const many = maxStates > 1 && backend.decideMany !== undefined;
      for (const chunk of pack(items, maxQuestions, maxStates, maxImages)) {
        if (many) void sendMany(backend, chunk);
        else {
          const first = chunk[0];
          if (first !== undefined) void send(backend, first.state, chunk);
        }
      }
    }
  };

  /** A state with images only goes to a backend that takes that many; otherwise base64 would be sent as text. */
  const imageProblem = (backend: Backend, found: number): string | undefined => {
    const max = backend.limits?.maxImages ?? 0;
    if (found === 0 || found <= max) return undefined;
    return max === 0
      ? `The ${backend.name} backend does not accept images.`
      : `The ${backend.name} backend accepts at most ${max} images per state, got ${found}.`;
  };

  const enqueue = (backend: Backend, state: State, question: Question): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const imageCount = extractImages(state).images.length;
      const problem = imageProblem(backend, imageCount);
      if (problem !== undefined) {
        reject(makeAskError("UNSUPPORTED_INPUT", problem));
        return;
      }
      const byState = queues.get(backend) ?? new Map<string, Batch>();
      queues.set(backend, byState);
      const key = JSON.stringify(state);
      const batch = byState.get(key) ?? { backend, state, items: [] };
      byState.set(key, batch);
      batch.items.push({ question, state, imageCount, resolve, reject });
      if (!flushScheduled) {
        flushScheduled = true;
        // Two hops: chains start on the next microtask, so a direct call like
        // ask.is() made in the same tick must wait for them to join the batch.
        queueMicrotask(() => queueMicrotask(flush));
      }
    });

  const backendOf = (options: CallOptions): Backend => options.backend ?? config.backend;

  const askYesNo = async (backend: Backend, state: State, question: YesNoQuestion): Promise<YesNoAnswer> => {
    const answer = await enqueue(backend, state, question);
    if (answer.kind !== "yesno") throw makeAskError("BAD_RESPONSE", "Expected a yes/no answer.");
    return answer;
  };

  const askChoice = async (backend: Backend, state: State, question: ChoiceQuestion): Promise<ChoiceAnswer> => {
    const answer = await enqueue(backend, state, question);
    if (answer.kind !== "choice") throw makeAskError("BAD_RESPONSE", "Expected a choice answer.");
    return answer;
  };

  const askScale = async (backend: Backend, state: State, question: ScaleQuestion): Promise<ScaleAnswer> => {
    const answer = await enqueue(backend, state, question);
    if (answer.kind !== "scale") throw makeAskError("BAD_RESPONSE", "Expected a scale answer.");
    if (answer.probabilities.length !== question.levels.length) {
      throw makeAskError(
        "BAD_RESPONSE",
        `Expected ${question.levels.length} level probabilities, got ${answer.probabilities.length}.`,
      );
    }
    return answer;
  };

  /* ----------------------------- yes/no ----------------------------- */

  const yesNoQuestion = (condition: string, criteria: YesNoCriteria | undefined): YesNoQuestion => ({
    kind: "yesno",
    // Keeps a short phrase like "is animal" readable as a claim about the state.
    instructions: { condition, question: "Is `condition` true of the state?" },
    ...(criteria === undefined ? {} : { criteria }),
  });

  const probability = async (state: State, condition: string, options: IfOptions = {}): Promise<number> =>
    (await askYesNo(backendOf(options), state, yesNoQuestion(condition, options.criteria))).probability;

  const is = async (state: State, condition: string, options: IfOptions = {}): Promise<boolean> =>
    (await probability(state, condition, options)) > (options.threshold ?? config.threshold);

  const askIf = (
    state: State,
    condition: string,
    thenHandler?: Handler<IfThenResult>,
    options: IfOptions = {},
  ): IfChain => {
    // Each condition is judged on its own terms; only what is shared across the chain carries over.
    const { criteria, ...shared } = options;
    void criteria;
    const conditions: { readonly condition: string; readonly options: IfOptions }[] = [{ condition, options }];
    const elseifHandlers: (Handler<IfElseIfResult> | undefined)[] = [];
    let elseHandler: Handler<IfElseResult> | undefined;
    let unsureHandler: Handler<IfUnsureResult> | undefined;
    let unsureMode: NonNullable<UnsureOptions["mode"]> = "stop";

    const judge = (p: number, o: IfOptions): "then" | "else" | "unsure" => {
      if (unsureHandler !== undefined) {
        const [low, high] = o.unsureBand ?? config.unsureBand;
        if (p > high) return "then";
        if (p < low) return "else";
        return "unsure";
      }
      return p > (o.threshold ?? config.threshold) ? "then" : "else";
    };

    const runner = makeRunner(async (): Promise<IfResult> => {
      // Asked together, so they share one batch; later branches are discarded if an earlier one wins.
      const probabilities = await Promise.all(
        conditions.map((c) => probability(state, c.condition, c.options)),
      );
      const unsureIndexes: number[] = [];
      const base = { probabilities, unsureIndexes };

      const unsureAt = async (index: number): Promise<IfResult> => {
        const result: IfUnsureResult = {
          ...base,
          branch: "unsure",
          index,
          condition: conditions[index]?.condition ?? "",
          probability: probabilities[index] ?? 0,
        };
        await unsureHandler?.(result);
        return result;
      };

      for (const [i, c] of conditions.entries()) {
        const verdict = judge(probabilities[i] ?? 0, c.options);
        if (verdict === "unsure") {
          unsureIndexes.push(i);
          if (unsureMode === "stop") return unsureAt(i);
        }
        if (verdict !== "then") continue;
        const held = { ...base, condition: c.condition, probability: probabilities[i] ?? 0 };
        if (i === 0) {
          const result: IfThenResult = { ...held, branch: "then", index: 0 };
          await thenHandler?.(result);
          return result;
        }
        const result: IfElseIfResult = { ...held, branch: "elseif", index: i };
        await elseifHandlers[i - 1]?.(result);
        return result;
      }

      const firstUnsure = unsureIndexes[0];
      if (firstUnsure !== undefined) return unsureAt(firstUnsure);
      const result: IfElseResult = { ...base, branch: "else" };
      await elseHandler?.(result);
      return result;
    });

    const chain: ElseIfChain = {
      elseif: (elseifCondition, handler, elseifOptions = {}) => {
        runner.assertOpen("elseif");
        conditions.push({ condition: elseifCondition, options: { ...shared, ...elseifOptions } });
        elseifHandlers.push(handler);
        return chain;
      },
      else: (handler) => {
        runner.assertOpen("else");
        elseHandler = handler;
        return chain;
      },
      unsure: (handler, unsureOptions = {}) => {
        runner.assertOpen("unsure");
        unsureHandler = handler;
        unsureMode = unsureOptions.mode ?? "stop";
        return chain;
      },
      then: (onFulfilled, onRejected) => runner.result().then(onFulfilled, onRejected),
    };
    return chain;
  };

  /* ----------------------------- choice ----------------------------- */

  const askSwitch = (
    state: State,
    question: Description,
    options: DecisionOptions = {},
  ): SwitchChain<readonly []> => {
    const cases: SwitchCase[] = [];
    let unsureHandler: Handler<SwitchResult<string>> | undefined;

    const runner = makeRunner(async (): Promise<SwitchResult<string>> => {
      const backend = backendOf(options);
      checkCount("options", cases.length, backend.limits?.maxOptions);
      const answer = await askChoice(backend, state, {
        kind: "choice",
        instructions: question,
        options: cases.map(({ key, description }) => ({ key, description })),
      });

      const ranking: Ranked<string>[] = cases
        .map(({ key }) => ({ key, probability: answer.probabilities[key] ?? 0 }))
        .sort((a, b) => b.probability - a.probability);
      const top = ranking[0];
      if (top === undefined) throw makeAskError("BAD_RESPONSE", "The choice answer was empty.");

      const confidence = answer.confidence ?? confidenceOf(ranking.map((r) => r.probability));
      const unsure =
        unsureHandler !== undefined && confidence < (options.minConfidence ?? config.minConfidence);
      const result = {
        branch: unsure ? "unsure" : "case",
        choice: top.key,
        confidence,
        ranking,
      } satisfies SwitchResult<string>;

      const handler = unsure ? unsureHandler : cases.find((c) => c.key === top.key)?.handler;
      await handler?.(result);
      return result;
    });

    const chainOf = <K extends readonly string[]>(keys: K): SwitchChain<K> => {
      const addCase = <C extends string>(
        method: string,
        key: C,
        descriptionOrHandler: Description | Handler<SwitchResult<C>> | undefined,
        handlerArg: Handler<SwitchResult<C>> | undefined,
        fallback: Description,
      ): SwitchChain<readonly [...K, C]> => {
        runner.assertOpen(method);
        if (cases.some((c) => c.key === key)) {
          throw makeAskError("INVALID_QUESTION", `Option "${key}" is declared twice.`);
        }
        const { description, handler } = splitArgs(descriptionOrHandler, handlerArg, fallback);
        cases.push({
          key,
          description,
          // This handler only runs when `key` is the choice.
          handler: handler && ((result) => handler({ ...result, choice: key })),
        });
        return chainOf([...keys, key] as const);
      };

      const chain: SwitchChain<K> = {
        case: (key, descriptionOrHandler, handler) =>
          addCase("case", key, descriptionOrHandler, handler, null),
        other: (descriptionOrHandler, handler) =>
          addCase("other", "other", descriptionOrHandler, handler, OTHER_DESCRIPTION),
        unsure: (handler) => {
          runner.assertOpen("unsure");
          unsureHandler = handler;
          return chain;
        },
        then: (onFulfilled, onRejected) =>
          runner
            .result()
            .then((result): SwitchResult<K[number], K[number]> => {
              const { choice } = result;
              if (!isKey(keys, choice)) {
                throw makeAskError(
                  "CHAIN_STARTED",
                  "Await the last value of the chain, after every .case() has been added.",
                );
              }
              const ranking = result.ranking.flatMap((r) =>
                isKey(keys, r.key) ? [{ key: r.key, probability: r.probability }] : [],
              );
              return { ...result, choice, ranking };
            })
            .then(onFulfilled, onRejected),
      };
      return chain;
    };

    return chainOf([] as const);
  };

  /* ----------------------------- scale ------------------------------ */

  const askScore = (
    state: State,
    question: Description,
    options: DecisionOptions = {},
  ): ScoreChain<readonly []> => {
    const levels: ScoreLevel[] = [];
    let unsureHandler: Handler<ScoreResult<string>> | undefined;

    const runner = makeRunner(async (): Promise<ScoreResult<string>> => {
      const backend = backendOf(options);
      checkCount("levels", levels.length, backend.limits?.maxLevels);
      const answer = await askScale(backend, state, {
        kind: "scale",
        instructions: question,
        levels: levels.map((l) => l.description),
      });

      const { probabilities } = answer;
      // Most likely level, not the rounded score: a 50/50 split between the two
      // ends must not land on a middle level that got no probability.
      const index = argmax(probabilities);
      const top = levels[index];
      if (top === undefined) throw makeAskError("BAD_RESPONSE", "The scale answer was empty.");

      const score = probabilities.reduce((sum, p, i) => sum + p * i, 0);
      const confidence = answer.confidence ?? confidenceOf(probabilities);
      const unsure =
        unsureHandler !== undefined && confidence < (options.minConfidence ?? config.minConfidence);
      const result = {
        branch: unsure ? "unsure" : "level",
        level: top.key,
        index,
        score,
        normalized: score / (levels.length - 1),
        confidence,
        probabilities,
      } satisfies ScoreResult<string>;

      await (unsure ? unsureHandler : top.handler)?.(result);
      return result;
    });

    const chainOf = <L extends readonly string[]>(keys: L): ScoreChain<L> => {
      const chain: ScoreChain<L> = {
        level: (key, descriptionOrHandler, handlerArg) => {
          runner.assertOpen("level");
          if (levels.some((l) => l.key === key)) {
            throw makeAskError("INVALID_QUESTION", `Level "${key}" is declared twice.`);
          }
          // The key is not sent to the model, so a bare key doubles as the description.
          const { description, handler } = splitArgs(descriptionOrHandler, handlerArg, key);
          levels.push({
            key,
            description,
            handler: handler && ((result) => handler({ ...result, level: key })),
          });
          return chainOf([...keys, key] as const);
        },
        unsure: (handler) => {
          runner.assertOpen("unsure");
          unsureHandler = handler;
          return chain;
        },
        then: (onFulfilled, onRejected) =>
          runner
            .result()
            .then((result): ScoreResult<L[number]> => {
              const { level } = result;
              if (!isKey(keys, level)) {
                throw makeAskError(
                  "CHAIN_STARTED",
                  "Await the last value of the chain, after every .level() has been added.",
                );
              }
              return { ...result, level };
            })
            .then(onFulfilled, onRejected),
      };
      return chain;
    };

    return chainOf([] as const);
  };

  return {
    if: askIf,
    switch: askSwitch,
    score: askScore,
    is,
    probability,
    configure: (partial) => {
      config = { ...config, ...partial };
    },
  };
};
