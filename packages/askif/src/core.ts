import { isAskError, makeAskError } from "./errors.js";
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
  IfChain,
  IfOptions,
  IfResult,
  Question,
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

  const send = async (batch: Batch, items: readonly Pending[]): Promise<void> => {
    const questions = Object.fromEntries(items.map((item, i) => [`q${i}`, item.question]));
    try {
      const answers = await batch.backend.decide(batch.state, questions);
      items.forEach((item, i) => {
        const answer = answers[`q${i}`];
        if (answer?.kind === item.question.kind) item.resolve(answer);
        else {
          item.reject(
            makeAskError(
              "BAD_RESPONSE",
              `The ${batch.backend.name} backend returned no ${item.question.kind} answer for a question.`,
            ),
          );
        }
      });
    } catch (error) {
      const wrapped = isAskError(error)
        ? error
        : makeAskError("BACKEND_FAILED", `The ${batch.backend.name} backend failed.`, error);
      items.forEach((item) => item.reject(wrapped));
    }
  };

  const flush = (): void => {
    flushScheduled = false;
    const batches = [...queues.values()].flatMap((byState) => [...byState.values()]);
    queues.clear();
    batches.forEach((batch) => {
      const size = Math.max(
        1,
        Math.min(config.maxBatchSize, batch.backend.limits?.maxQuestionsPerCall ?? Infinity),
      );
      for (let i = 0; i < batch.items.length; i += size) {
        void send(batch, batch.items.slice(i, i + size));
      }
    });
  };

  const enqueue = (backend: Backend, state: State, question: Question): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const byState = queues.get(backend) ?? new Map<string, Batch>();
      queues.set(backend, byState);
      const key = JSON.stringify(state);
      const batch = byState.get(key) ?? { backend, state, items: [] };
      byState.set(key, batch);
      batch.items.push({ question, resolve, reject });
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
    thenHandler?: Handler<IfResult>,
    options: IfOptions = {},
  ): IfChain => {
    type Branch = {
      readonly condition: string;
      readonly handler: Handler<IfResult> | undefined;
      readonly options: IfOptions;
    };
    // Conditions are judged on their own terms; only what is shared across the chain carries over.
    const shared: IfOptions = {
      backend: options.backend,
      threshold: options.threshold,
      unsureBand: options.unsureBand,
    };
    const branches: Branch[] = [{ condition, handler: thenHandler, options }];
    let elseHandler: Handler<IfResult> | undefined;
    let unsureHandler: Handler<IfResult> | undefined;
    let unsureOn: NonNullable<UnsureOptions["on"]> = "stop";

    const judge = (p: number, o: IfOptions): IfResult["branch"] => {
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
      const probabilities = await Promise.all(branches.map((b) => probability(state, b.condition, b.options)));
      const unsureIndexes: number[] = [];

      const finish = async (
        branch: IfResult["branch"],
        index: number,
        handler: Handler<IfResult> | undefined,
      ): Promise<IfResult> => {
        const decider = branches[index];
        const result: IfResult = {
          branch,
          probability: probabilities[Math.min(index, branches.length - 1)] ?? 0,
          index,
          ...(decider === undefined ? {} : { condition: decider.condition }),
          unsureIndexes,
        };
        await handler?.(result);
        return result;
      };

      for (const [i, b] of branches.entries()) {
        const verdict = judge(probabilities[i] ?? 0, b.options);
        if (verdict === "then") return finish("then", i, b.handler);
        if (verdict === "unsure") {
          unsureIndexes.push(i);
          if (unsureOn === "stop") return finish("unsure", i, unsureHandler);
        }
      }
      const firstUnsure = unsureIndexes[0];
      return firstUnsure === undefined
        ? finish("else", branches.length, elseHandler)
        : finish("unsure", firstUnsure, unsureHandler);
    });

    const chain: IfChain = {
      elseif: (elseifCondition, handler, elseifOptions = {}) => {
        runner.assertOpen("elseif");
        branches.push({ condition: elseifCondition, handler, options: { ...shared, ...elseifOptions } });
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
        unsureOn = unsureOptions.on ?? "stop";
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
