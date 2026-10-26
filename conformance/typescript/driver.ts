import { createAsk, extractImages, image, isAskError } from "../../packages/askif/src/index.ts";
import type {
  Backend,
  DecisionOptions,
  IfElseIfResult,
  IfElseResult,
  IfOptions,
  IfResult,
  IfThenResult,
  IfUnsureResult,
  Json,
  ProtectionOverride,
  ScoreChain,
  State,
  SwitchChain,
  YesNoCriteria,
} from "../../packages/askif/src/index.ts";
import { bandOf, isJson, isRecord, readString, stringList } from "./json.ts";
import { scriptedBackend } from "./scripted.ts";

type Call = Readonly<Record<string, unknown>>;

type Started = {
  readonly promise: Promise<unknown>;
  readonly handlers: string[];
  readonly late?: (method: string) => void;
};

const readStdin = async (): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    if (chunk instanceof Uint8Array) chunks.push(chunk);
    else throw new Error("stdin chunk was not bytes");
  }
  return Buffer.concat(chunks).toString("utf8");
};

const codeOf = (error: unknown): string => (isAskError(error) ? error.code : "THROWN");

const stateOf = (value: unknown, path: string): State => {
  if (!isJson(value)) throw new Error(`${path} must be JSON`);
  return value;
};

const criteriaOf = (value: unknown): YesNoCriteria | undefined => {
  if (!isRecord(value)) return undefined;
  const yes = value["true"];
  const no = value["false"];
  const criteria: { true?: Json; false?: Json } = {};
  if (isJson(yes)) criteria.true = yes;
  if (isJson(no)) criteria.false = no;
  return criteria;
};

const descriptionOf = (value: unknown): Json => {
  if (!isJson(value)) throw new Error("description must be JSON");
  return value;
};

const expand = (call: Call): Call[] => {
  const count = call["count"];
  if (typeof count !== "number") return [call];
  const copies: Call[] = [];
  for (let index = 0; index < count; index += 1) {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(call)) {
      if (key !== "count" && key !== "statePrefix" && key !== "conditionPrefix") next[key] = value;
    }
    const statePrefix = call["statePrefix"];
    const conditionPrefix = call["conditionPrefix"];
    if (typeof statePrefix === "string") next["state"] = `${statePrefix}${index}`;
    if (typeof conditionPrefix === "string") next["condition"] = `${conditionPrefix}${index}`;
    copies.push(next);
  }
  return copies;
};

const configFrom = (raw: unknown): {
  readonly threshold?: number;
  readonly unsureBand?: readonly [number, number];
  readonly minConfidence?: number;
  readonly maxBatchSize?: number;
  readonly maxStatesPerBatch?: number;
  readonly protection?: ProtectionOverride;
} => {
  if (!isRecord(raw)) return {};
  const threshold = raw["threshold"];
  const minConfidence = raw["minConfidence"];
  const maxBatchSize = raw["maxBatchSize"];
  const maxStatesPerBatch = raw["maxStatesPerBatch"];
  const protection = protectionOf(raw["protection"]);
  return {
    ...(typeof threshold === "number" ? { threshold } : {}),
    ...(raw["unsureBand"] !== undefined ? { unsureBand: bandOf(raw["unsureBand"], "unsureBand") } : {}),
    ...(typeof minConfidence === "number" ? { minConfidence } : {}),
    ...(typeof maxBatchSize === "number" ? { maxBatchSize } : {}),
    ...(typeof maxStatesPerBatch === "number" ? { maxStatesPerBatch } : {}),
    ...(protection !== undefined ? { protection } : {}),
  };
};

const protectionOf = (value: unknown): ProtectionOverride | undefined => {
  if (value === undefined) return undefined;
  if (value === false) return false;
  if (!isRecord(value)) throw new Error("protection must be false or an object");
  const images = value["images"];
  const protection: {
    stripHidden?: boolean;
    stripHtmlComments?: boolean;
    maxStateChars?: number;
    maxStringChars?: number;
    images?: "auto" | "explicit";
    unsureOnInjection?: boolean;
  } = {};
  if (typeof value["stripHidden"] === "boolean") protection.stripHidden = value["stripHidden"];
  if (typeof value["stripHtmlComments"] === "boolean") protection.stripHtmlComments = value["stripHtmlComments"];
  if (typeof value["maxStateChars"] === "number") protection.maxStateChars = value["maxStateChars"];
  if (typeof value["maxStringChars"] === "number") protection.maxStringChars = value["maxStringChars"];
  if (images === "auto" || images === "explicit") protection.images = images;
  if (typeof value["unsureOnInjection"] === "boolean") protection.unsureOnInjection = value["unsureOnInjection"];
  return protection;
};

const flagFields = (flags: readonly string[] | undefined): Record<string, unknown> =>
  flags === undefined ? { flags: null } : { flags: [...flags] };

type ConditionPlan = {
  readonly condition: string;
  readonly threshold?: number;
  readonly unsureBand?: readonly [number, number];
  readonly criteria?: YesNoCriteria;
};

const conditionsOf = (call: Call): readonly ConditionPlan[] => {
  const listed = call["conditions"];
  if (Array.isArray(listed)) {
    return listed.map((item, index) => {
      if (!isRecord(item)) throw new Error(`conditions[${index}] must be an object`);
      const threshold = item["threshold"];
      return {
        condition: readString(item["condition"], "condition"),
        ...(typeof threshold === "number" ? { threshold } : {}),
        ...(item["unsureBand"] !== undefined ? { unsureBand: bandOf(item["unsureBand"], "unsureBand") } : {}),
        ...(item["criteria"] !== undefined ? { criteria: criteriaOf(item["criteria"]) } : {}),
      };
    });
  }
  const threshold = call["threshold"];
  return [
    {
      condition: readString(call["condition"], "condition"),
      ...(typeof threshold === "number" ? { threshold } : {}),
      ...(call["unsureBand"] !== undefined ? { unsureBand: bandOf(call["unsureBand"], "unsureBand") } : {}),
      ...(call["criteria"] !== undefined ? { criteria: criteriaOf(call["criteria"]) } : {}),
    },
  ];
};

const optionsFor = (plan: ConditionPlan, backend: Backend | undefined, protection?: ProtectionOverride): IfOptions => ({
  ...(plan.threshold !== undefined ? { threshold: plan.threshold } : {}),
  ...(plan.unsureBand !== undefined ? { unsureBand: plan.unsureBand } : {}),
  ...(plan.criteria !== undefined ? { criteria: plan.criteria } : {}),
  ...(backend !== undefined ? { backend } : {}),
  ...(protection !== undefined ? { protection } : {}),
});

const decisionFor = (call: Call, backend: Backend | undefined): DecisionOptions => {
  const minConfidence = call["minConfidence"];
  const protection = protectionOf(call["protection"]);
  return {
    ...(typeof minConfidence === "number" ? { minConfidence } : {}),
    ...(backend !== undefined ? { backend } : {}),
    ...(protection !== undefined ? { protection } : {}),
  };
};

const backendFor = (call: Call, main: Backend, override: Backend | undefined): Backend | undefined =>
  call["backend"] === "override" ? override : undefined;

const normalizeIf = (result: IfResult): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    branch: result.branch,
    probabilities: [...result.probabilities],
    unsureIndexes: [...result.unsureIndexes],
    ...flagFields(result.flags),
  };
  if (result.branch === "else") return base;
  return { ...base, index: result.index, condition: result.condition, probability: result.probability };
};

const unsureModeOf = (value: unknown): { readonly mode: "stop" | "skip" } | undefined => {
  if (value === "stop" || value === "skip") return { mode: value };
  return undefined;
};

const startIf = (ask: ReturnType<typeof createAsk>, call: Call, backend: Backend | undefined): Started => {
  const ran: string[] = [];
  const handlers = stringList(call["handlers"]);
  const state = stateOf(call["state"], "state");
  const plans = conditionsOf(call);
  const first = plans[0];
  if (first === undefined) throw new Error("if needs a condition");
  const thenHandler = handlers.includes("then")
    ? (result: IfThenResult): void => {
        void result;
        ran.push("then");
      }
    : undefined;
  let simple = ask.if(state, first.condition, thenHandler, optionsFor(first, backend, protectionOf(call["protection"])));
  const rest = plans.slice(1);
  if (rest.length === 0) {
    if (handlers.includes("else")) simple = simple.else(() => ran.push("else"));
    if (handlers.includes("unsure")) simple = simple.unsure(() => ran.push("unsure"));
    return {
      handlers: ran,
      promise: Promise.resolve(simple.then((result) => normalizeIf(result))),
      late: (method) => {
        if (method === "elseif") simple.elseif("late");
        else if (method === "else") simple.else(() => undefined);
        else if (method === "unsure") simple.unsure(() => undefined);
        else throw new Error(`cannot ${method} an if chain`);
      },
    };
  }
  const unsureOptions = unsureModeOf(call["unsureMode"]);
  const firstExtra = rest[0];
  if (firstExtra === undefined) throw new Error("elseif missing");
  const elseifHandler = (result: IfElseIfResult): void => {
    ran.push("elseif");
    void result;
  };
  let chain = simple.elseif(
    firstExtra.condition,
    handlers.includes("elseif") ? elseifHandler : undefined,
    optionsFor(firstExtra, undefined),
  );
  for (const extra of rest.slice(1)) {
    chain = chain.elseif(extra.condition, handlers.includes("elseif") ? elseifHandler : undefined, optionsFor(extra, undefined));
  }
  if (handlers.includes("else")) {
    const elseHandler = (result: IfElseResult): void => {
      ran.push("else");
      void result;
    };
    chain = chain.else(elseHandler);
  }
  if (handlers.includes("unsure")) {
    const unsureHandler = (result: IfUnsureResult): void => {
      ran.push("unsure");
      void result;
    };
    chain = chain.unsure(unsureHandler, unsureOptions);
  }
  return {
    handlers: ran,
    promise: Promise.resolve(chain.then((result) => normalizeIf(result))),
    late: (method) => {
      if (method === "elseif") chain.elseif("late");
      else if (method === "else") chain.else(() => undefined);
      else if (method === "unsure") chain.unsure(() => undefined);
      else throw new Error(`cannot ${method} an if chain`);
    },
  };
};

const optionList = (value: unknown): readonly { readonly key: string; readonly description?: Json }[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`option ${index} must be an object`);
    const key = readString(item["key"], "key");
    if (!("description" in item)) return { key };
    return { key, description: descriptionOf(item["description"]) };
  });
};

const finishSwitch = <K extends readonly string[]>(chain: SwitchChain<K>, ran: string[]): Started => ({
  handlers: ran,
  promise: Promise.resolve(
    chain.then((result) => ({
      branch: result.branch,
      choice: result.choice,
      confidence: result.confidence,
      ranking: result.ranking.map((ranked) => ({ key: ranked.key, probability: ranked.probability })),
      ...flagFields(result.flags),
    })),
  ),
  late: (method) => {
    if (method === "case") chain.case("late");
    else if (method === "other") chain.other();
    else if (method === "unsure") chain.unsure(() => undefined);
    else throw new Error(`cannot ${method} a switch chain`);
  },
});

const startSwitch = (ask: ReturnType<typeof createAsk>, call: Call, backend: Backend | undefined): Started => {
  const ran: string[] = [];
  const handlers = stringList(call["handlers"]);
  const options = optionList(call["options"]);
  const walk = <K extends readonly string[]>(chain: SwitchChain<K>, index: number): Started => {
    const option = options[index];
    if (option === undefined) {
      const finished = handlers.includes("unsure") ? chain.unsure(() => ran.push("unsure")) : chain;
      return finishSwitch(finished, ran);
    }
    if (option.key === "other") {
      const next =
        option.description === undefined
          ? handlers.includes("other")
            ? chain.other(() => ran.push("other"))
            : chain.other()
          : handlers.includes("other")
            ? chain.other(option.description, () => ran.push("other"))
            : chain.other(option.description);
      return walk(next, index + 1);
    }
    const next =
      option.description === undefined
        ? handlers.includes("case")
          ? chain.case(option.key, () => ran.push("case"))
          : chain.case(option.key)
        : handlers.includes("case")
          ? chain.case(option.key, option.description, () => ran.push("case"))
          : chain.case(option.key, option.description);
    return walk(next, index + 1);
  };
  return walk(ask.switch(stateOf(call["state"], "state"), descriptionOf(call["question"]), decisionFor(call, backend)), 0);
};

const finishScore = <L extends readonly string[]>(chain: ScoreChain<L>, ran: string[]): Started => ({
  handlers: ran,
  promise: Promise.resolve(
    chain.then((result) => ({
      branch: result.branch,
      level: result.level,
      index: result.index,
      score: result.score,
      normalized: result.normalized,
      confidence: result.confidence,
      probabilities: [...result.probabilities],
      ...flagFields(result.flags),
    })),
  ),
  late: (method) => {
    if (method === "level") chain.level("late");
    else if (method === "unsure") chain.unsure(() => undefined);
    else throw new Error(`cannot ${method} a score chain`);
  },
});

const startScore = (ask: ReturnType<typeof createAsk>, call: Call, backend: Backend | undefined): Started => {
  const ran: string[] = [];
  const handlers = stringList(call["handlers"]);
  const levels = optionList(call["levels"]);
  const walk = <L extends readonly string[]>(chain: ScoreChain<L>, index: number): Started => {
    const level = levels[index];
    if (level === undefined) {
      const finished = handlers.includes("unsure") ? chain.unsure(() => ran.push("unsure")) : chain;
      return finishScore(finished, ran);
    }
    const next =
      level.description === undefined
        ? handlers.includes("level")
          ? chain.level(level.key, () => ran.push("level"))
          : chain.level(level.key)
        : handlers.includes("level")
          ? chain.level(level.key, level.description, () => ran.push("level"))
          : chain.level(level.key, level.description);
    return walk(next, index + 1);
  };
  return walk(ask.score(stateOf(call["state"], "state"), descriptionOf(call["question"]), decisionFor(call, backend)), 0);
};

const bytesOf = (value: unknown): Uint8Array => {
  if (!Array.isArray(value)) throw new Error("bytes must be an array");
  const bytes = value.map((item, index) => {
    if (typeof item !== "number") throw new Error(`byte ${index}`);
    return item;
  });
  return Uint8Array.from(bytes);
};

const imageValue = (call: Call): Json => {
  const input = call["input"];
  if (!isRecord(input)) throw new Error("image input must be an object");
  const media = call["mediaType"];
  const mediaType = typeof media === "string" ? media : undefined;
  if (Array.isArray(input["bytes"])) return image(bytesOf(input["bytes"]), mediaType);
  if (typeof input["base64"] === "string") return image(input["base64"], mediaType);
  if (typeof input["dataUrl"] === "string") return image(input["dataUrl"], mediaType);
  throw new Error("image input needs bytes, base64, or dataUrl");
};

const main = async (): Promise<void> => {
  const raw: unknown = JSON.parse(await readStdin());
  if (!isRecord(raw)) throw new Error("case must be an object");
  const id = readString(raw["id"], "id");
  const callsRaw = raw["calls"];
  if (!Array.isArray(callsRaw)) throw new Error("calls must be an array");
  const calls = callsRaw.flatMap((call) => {
    if (!isRecord(call)) throw new Error("call must be an object");
    return expand(call);
  });
  const mainBackend = scriptedBackend("script", raw["backend"], raw["script"]);
  const script = isRecord(raw["script"]) ? raw["script"] : {};
  const overrideBackend =
    script["override"] === undefined ? undefined : scriptedBackend("override", raw["backend"], script["override"]);
  const ask = createAsk({ backend: mainBackend.backend, ...configFrom(raw["config"]) });

  const groups = new Map<number, Call[]>();
  for (const call of calls) {
    const group = call["group"];
    if (typeof group !== "number") throw new Error("group must be a number");
    const list = groups.get(group) ?? [];
    list.push(call);
    groups.set(group, list);
  }

  const results: unknown[] = [];
  const handlersRun: string[][] = [];
  for (const group of [...groups.keys()].sort((left, right) => left - right)) {
    const groupCalls = groups.get(group) ?? [];
    const pending: Promise<{ readonly result: unknown; readonly handlers: readonly string[] }>[] = [];
    for (const call of groupCalls) {
      const op = readString(call["op"], "op");
      if (op === "configure") {
        ask.configure(configFrom(call["configure"]));
        continue;
      }
      const backend = backendFor(call, mainBackend.backend, overrideBackend?.backend);
      const started = (): Started => {
        if (op === "if") return startIf(ask, call, backend);
        if (op === "is") {
          const state = stateOf(call["state"], "state");
          const plan = conditionsOf(call)[0];
          if (plan === undefined) throw new Error("is needs a condition");
          return {
            handlers: [],
            promise: ask.is(state, plan.condition, optionsFor(plan, backend, protectionOf(call["protection"]))).then((value) => ({ value })),
          };
        }
        if (op === "probability") {
          const state = stateOf(call["state"], "state");
          const plan = conditionsOf(call)[0];
          if (plan === undefined) throw new Error("probability needs a condition");
          return {
            handlers: [],
            promise: ask
              .probability(state, plan.condition, optionsFor(plan, backend, protectionOf(call["protection"])))
              .then((value) => ({ value })),
          };
        }
        if (op === "switch") return startSwitch(ask, call, backend);
        if (op === "score") return startScore(ask, call, backend);
        if (op === "image") return { handlers: [], promise: Promise.resolve({ image: imageValue(call) }) };
        if (op === "extractImages") {
          const state = stateOf(call["state"], "state");
          const from = call["from"];
          const extracted = typeof from === "number" ? extractImages(state, { from }) : extractImages(state);
          return { handlers: [], promise: Promise.resolve({ state: extracted.state, images: extracted.images }) };
        }
        throw new Error(`unknown op ${op}`);
      };
      pending.push(
        (async () => {
          try {
            const task = started();
            try {
              const result = await task.promise;
              const after = call["afterStart"];
              if (typeof after !== "string" || task.late === undefined) {
                return { result, handlers: [...task.handlers] };
              }
              try {
                task.late(after);
                return { result, handlers: [...task.handlers] };
              } catch (error) {
                return {
                  result: isRecord(result) ? { ...result, afterStartError: codeOf(error) } : { afterStartError: codeOf(error) },
                  handlers: [...task.handlers],
                };
              }
            } catch (error) {
              return { result: { error: codeOf(error) }, handlers: [...task.handlers] };
            }
          } catch (error) {
            return { result: { error: codeOf(error) }, handlers: [] };
          }
        })(),
      );
    }
    for (const outcome of await Promise.all(pending)) {
      results.push(outcome.result);
      handlersRun.push([...outcome.handlers]);
    }
  }

  const problem = mainBackend.exhausted() ?? overrideBackend?.exhausted();
  if (problem === "script exhausted") {
    process.stderr.write(`${problem}\n`);
    process.exit(2);
  }

  const errors = results.map((result) => (isRecord(result) && typeof result["error"] === "string" ? result["error"] : null));
  process.stdout.write(
    `${JSON.stringify({
      id,
      results,
      handlersRun,
      errors,
      backendCalls: mainBackend.decide.length + mainBackend.decideMany.length,
      decide: mainBackend.decide,
      decideMany: mainBackend.decideMany,
      overrideDecide: overrideBackend?.decide ?? [],
      overrideDecideMany: overrideBackend?.decideMany ?? [],
    })}\n`,
  );
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
