export { confidenceOf, createAsk } from "./core.js";
export { ASK_ERROR_CODES, isAskError, makeAskError } from "./errors.js";
export type { AskError, AskErrorCode } from "./errors.js";
export {
  DEFAULT_PROTECTION,
  HIDDEN_CHARS,
  INJECTION_MARKERS,
  clipUntrusted,
  effectiveProtection,
  looksInjected,
  UNTRUSTED_IMAGE_CHARS,
  UNTRUSTED_IMAGE_COUNT,
  UNTRUSTED_IMAGE_TOTAL_CHARS,
  reduceDescription,
  reduceState,
  sanitizeText,
  stripHidden,
} from "./guard.js";
export { DATA_URL, extractImages, image, isContentImage, isImage } from "./image.js";
export type { ExtractImagesOptions } from "./image.js";
export { mock } from "./mock.js";
export type { MockBackend, MockCall, MockOptions } from "./mock.js";
export type * from "./types.js";
