import { makeAskError } from "askif";
import type { Experimental_DecisionModel, Experimental_DecisionState } from "ai";
import type { GatewayQuestion, SdkState } from "./map.js";
import type { VercelDecisionModel, VercelProviderOptions } from "./options.js";
import { configured } from "./env.js";
import { failed } from "./usage.js";

const DEFAULT_MODEL = "typesafe-ai/jev";

export type SdkCall = {
  readonly model: VercelDecisionModel;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly abortSignal?: AbortSignal;
  readonly maxRetries?: number;
  readonly providerOptions?: VercelProviderOptions;
  readonly state: SdkState;
  readonly questions: Readonly<Record<string, GatewayQuestion>>;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDecisionState = (value: unknown): value is Experimental_DecisionState =>
  typeof value === "string" || Array.isArray(value) || isRecord(value);

type DecideOptions = Parameters<typeof import("ai").experimental_decide>[0];

const isQuestions = (value: unknown): value is DecideOptions["questions"] => isRecord(value);

const isProviderOptions = (value: unknown): value is NonNullable<DecideOptions["providerOptions"]> =>
  isRecord(value) && Object.values(value).every((entry) => isRecord(entry));

const isModelObject = (
  model: Exclude<VercelDecisionModel, string>,
): model is Exclude<Experimental_DecisionModel, string> =>
  "doDecide" in model && typeof model.doDecide === "function";

const clone = (value: unknown, label: string): unknown => {
  const text = JSON.stringify(value);
  if (typeof text !== "string") throw makeAskError("INVALID_QUESTION", `${label} is not JSON.`);
  return JSON.parse(text);
};

const loadAi = async (): Promise<typeof import("ai")> =>
  import("ai").catch((error: unknown) => {
    throw makeAskError(
      "BACKEND_UNAVAILABLE",
      "vercelDecide needs the ai package (7.0.128 or newer). Install it with: npm install ai. ai depends on zod (^3.25.76 or ^4.1.8).",
      error,
    );
  });

const resolveModel = async (
  ai: typeof import("ai"),
  options: SdkCall,
): Promise<Experimental_DecisionModel> => {
  const model = options.model ?? DEFAULT_MODEL;
  if (typeof model !== "string") {
    if (!isModelObject(model)) {
      throw makeAskError(
        "BACKEND_UNAVAILABLE",
        "vercelDecide model must be a string id or a v4 decision model with doDecide.",
      );
    }
    return model;
  }
  const apiKey = configured(options.apiKey);
  const custom = apiKey !== undefined || options.baseURL !== undefined || options.fetch !== undefined;
  if (!custom) return model;
  return ai
    .createGateway({
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    })
    .decisionModel(model);
};

/** One `experimental_decide` call. The `ai` package is imported here, on first use. */
export const decideWithAi = async (options: SdkCall): Promise<unknown> => {
  const ai = await loadAi();
  const model = await resolveModel(ai, options);
  const state = clone(options.state, "The decision state");
  const questions = clone(options.questions, "The decision questions");
  const providerOptions =
    options.providerOptions === undefined ? undefined : clone(options.providerOptions, "providerOptions");
  if (!isDecisionState(state) || !isQuestions(questions)) {
    throw makeAskError("INVALID_QUESTION", "The decision state or questions are not JSON.");
  }
  if (providerOptions !== undefined && !isProviderOptions(providerOptions)) {
    throw makeAskError("INVALID_QUESTION", "providerOptions is not JSON.");
  }
  try {
    return await ai.experimental_decide({
      model,
      state,
      questions,
      ...(providerOptions === undefined ? {} : { providerOptions }),
      ...(options.headers === undefined ? {} : { headers: { ...options.headers } }),
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    });
  } catch (error) {
    return failed(error, "The Vercel AI SDK decide call failed.");
  }
};
