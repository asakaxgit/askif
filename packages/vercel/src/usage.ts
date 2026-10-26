import { isAskError, makeAskError } from "askif";
import type { Question, QuestionResult } from "askif";
import { readAnswers } from "./map.js";

/** Token counts and AI Gateway cost strings from one decide or `/v1/evaluate` response. */
export type VercelUsage = {
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Gateway `cost`, kept as a decimal string. A numeric cost is stringified. */
  readonly cost?: string;
  readonly marketCost?: string;
  readonly gatewayCost?: string;
  readonly surchargeCost?: string;
  readonly generationId?: string;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const money = (value: unknown): string | undefined => {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

/** Reads usage from an HTTP body or from an `experimental_decide` result. Absent fields are omitted. */
export const readUsage = (body: unknown, fallbackModel: string): VercelUsage => {
  const record = isRecord(body) ? body : {};
  const usage = isRecord(record["usage"]) ? record["usage"] : undefined;
  const metadata = isRecord(record["providerMetadata"]) ? record["providerMetadata"] : undefined;
  const gateway = metadata !== undefined && isRecord(metadata["gateway"]) ? metadata["gateway"] : undefined;
  const response = isRecord(record["response"]) ? record["response"] : undefined;
  const responseModel = response === undefined ? undefined : response["modelId"];
  const model =
    typeof record["model"] === "string"
      ? record["model"]
      : typeof responseModel === "string"
        ? responseModel
        : fallbackModel;
  const inputTokens = usage === undefined ? undefined : finite(usage["inputTokens"]);
  const outputTokens = usage === undefined ? undefined : finite(usage["outputTokens"]);
  const cost = gateway === undefined ? undefined : money(gateway["cost"]);
  const marketCost = gateway === undefined ? undefined : money(gateway["marketCost"]);
  const gatewayCost = gateway === undefined ? undefined : money(gateway["gatewayCost"]);
  const surchargeCost = gateway === undefined ? undefined : money(gateway["surchargeCost"]);
  const generationId =
    gateway !== undefined && typeof gateway["generationId"] === "string" ? gateway["generationId"] : undefined;
  return {
    model,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cost === undefined ? {} : { cost }),
    ...(marketCost === undefined ? {} : { marketCost }),
    ...(gatewayCost === undefined ? {} : { gatewayCost }),
    ...(surchargeCost === undefined ? {} : { surchargeCost }),
    ...(generationId === undefined ? {} : { generationId }),
  };
};

/**
 * Reports usage, then maps answers. Usage is reported whenever the body is an object,
 * including when a later answer is unreadable.
 */
export const finish = (
  body: unknown,
  fallbackModel: string,
  questions: Readonly<Record<string, Question>>,
  onUsage: ((usage: VercelUsage) => void) | undefined,
): Readonly<Record<string, QuestionResult>> => {
  if (onUsage !== undefined && isRecord(body)) onUsage(readUsage(body, fallbackModel));
  const record = isRecord(body) ? body : undefined;
  return readAnswers(questions, record?.["answers"], record?.["providerMetadata"]);
};

const refusalIds = (error: unknown): readonly string[] | undefined => {
  if (!(error instanceof Error) || !("questionIds" in error)) return undefined;
  const ids = error.questionIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) return undefined;
  return ids;
};

/** Wraps a thrown SDK or transport error. Ask errors pass through. A refusal fails the whole call. */
export const failed = (error: unknown, fallback: string): never => {
  if (isAskError(error)) throw error;
  const ids = refusalIds(error);
  if (ids !== undefined) {
    throw makeAskError("BACKEND_FAILED", `The model refused ${ids.join(", ")}.`, error);
  }
  throw makeAskError("BACKEND_FAILED", fallback, error);
};
