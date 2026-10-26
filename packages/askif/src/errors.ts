export const ASK_ERROR_CODES = [
  /** A question is malformed: too few or too many options or levels, or a duplicate key. */
  "INVALID_QUESTION",
  /** A chain method was called after its question had been sent. */
  "CHAIN_STARTED",
  /** The backend call failed. The original error is in `cause`. */
  "BACKEND_FAILED",
  /** The backend could not be loaded, e.g. an optional SDK is not installed. */
  "BACKEND_UNAVAILABLE",
  /** The state has something this backend can't take, e.g. images for a text-only backend, or too many. */
  "UNSUPPORTED_INPUT",
  /** The backend returned an answer that does not match the question. */
  "BAD_RESPONSE",
] as const;

export type AskErrorCode = (typeof ASK_ERROR_CODES)[number];

export type AskError = Error & {
  readonly name: "AskError";
  readonly code: AskErrorCode;
};

export const makeAskError = (code: AskErrorCode, message: string, cause?: unknown): AskError =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    name: "AskError" as const,
    code,
  });

export const isAskError = (value: unknown): value is AskError =>
  value instanceof Error &&
  value.name === "AskError" &&
  "code" in value &&
  ASK_ERROR_CODES.some((code) => code === value.code);
