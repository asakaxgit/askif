import { makeAskError } from "askif";
import type { Json } from "askif";

/**
 * One conditional decision fallback, in the shape AI Gateway documents for
 * `providerOptions.gateway.models`. Omit `question` to test every question of that kind.
 */
export type DecisionFallbackCondition =
  | { readonly question?: string; readonly confidenceBelow: number }
  | { readonly question?: string; readonly probabilityBetween: readonly [number, number] }
  | { readonly any: readonly DecisionFallbackCondition[] }
  | { readonly all: readonly DecisionFallbackCondition[] }
  | { readonly atLeast: { readonly count: number; readonly conditions: readonly DecisionFallbackCondition[] } };

/** Rerun the whole request on `model` when `when` matches. `or` lists execution-error fallbacks after it. */
export type VercelFallback = {
  readonly model: string;
  readonly when: DecisionFallbackCondition;
  readonly or?: readonly string[];
};

/** Passed through as `providerOptions`. Keys are provider namespaces (`gateway`, `openai`, ...). */
export type VercelProviderOptions = Readonly<Record<string, Readonly<Record<string, Json>>>>;

/**
 * A Gateway model id, or any v4 decision model instance.
 * The instance type is structural and does not import `ai`, so `vercel()` typechecks without that package.
 * `vercelDecide` still checks for `doDecide` before calling the SDK.
 */
export type VercelDecisionModel =
  | string
  | {
      readonly specificationVersion: "v4";
      readonly provider: string;
      readonly modelId: string;
    };

const isJson = (value: unknown): value is Json => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value === "object") return Object.values(value).every(isJson);
  return false;
};

const toJson = (value: unknown, label: string): Json => {
  const text = JSON.stringify(value);
  if (typeof text !== "string") throw makeAskError("INVALID_QUESTION", `${label} is not JSON.`);
  const parsed: unknown = JSON.parse(text);
  if (!isJson(parsed)) throw makeAskError("INVALID_QUESTION", `${label} is not JSON.`);
  return parsed;
};

/**
 * `fallback` becomes `providerOptions.gateway.models` unless that array is already set.
 * An explicit `models` array wins, so a caller can pass the gateway shape directly.
 */
export const mergeProviderOptions = (
  providerOptions: VercelProviderOptions | undefined,
  fallback: VercelFallback | undefined,
): VercelProviderOptions | undefined => {
  if (fallback === undefined) return providerOptions;
  const gateway = providerOptions?.["gateway"];
  if (gateway?.["models"] !== undefined) return providerOptions;
  const models = toJson(
    [{ model: fallback.model, when: fallback.when }, ...(fallback.or ?? [])],
    "The gateway fallback",
  );
  if (!Array.isArray(models)) throw makeAskError("INVALID_QUESTION", "The gateway fallback is not a list.");
  return { ...providerOptions, gateway: { ...gateway, models } };
};
