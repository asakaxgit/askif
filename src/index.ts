import { createAsk } from "./core.js";
import { typesafe } from "./typesafe.js";

/**
 * The default instance, backed by TypeSafe's Jev.
 * Reads TYPESAFE_API_KEY from the environment on first use.
 */
export const ask = createAsk({ backend: typesafe() });

export { confidenceOf, createAsk } from "./core.js";
export { ASK_ERROR_CODES, isAskError, makeAskError } from "./errors.js";
export type { AskError, AskErrorCode } from "./errors.js";
export { mock } from "./mock.js";
export type { MockBackend, MockCall } from "./mock.js";
export { typesafe } from "./typesafe.js";
export type { TypesafeOptions } from "./typesafe.js";
export type * from "./types.js";
