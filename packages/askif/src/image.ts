import { makeAskError } from "./errors.js";
import type { Image, Json } from "./types.js";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `value` is an `Image`, as built by `image()`. */
export const isImage = (value: unknown): value is Image =>
  isRecord(value) &&
  value["type"] === "image" &&
  isRecord(value["source"]) &&
  value["source"]["kind"] === "base64" &&
  typeof value["source"]["mediaType"] === "string" &&
  typeof value["source"]["data"] === "string";

/** Formats recognised from their first bytes, for `image()` when no media type is given. */
const sniff = (bytes: Uint8Array): string | undefined => {
  const at = (offset: number, ...expected: number[]): boolean => expected.every((b, i) => bytes[offset + i] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return undefined;
};

// atob/btoa instead of Buffer, so this works in browsers and edge runtimes too.
const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** A base64 image data URL. Exported so input protection can leave these bytes untouched. */
export const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is;
const STANDARD_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MEDIA_TYPE = /^image\/[a-z0-9.+-]+$/i;

/**
 * True when `value` is an image data URL whose payload is standard base64.
 * Protection uses this before it skips cleaning and the size caps.
 */
export const isStandardImageDataUrl = (value: string): boolean => {
  const match = DATA_URL.exec(value);
  const media = match?.[1];
  const payload = match?.[2];
  return media !== undefined && payload !== undefined && MEDIA_TYPE.test(media) && STANDARD_BASE64.test(payload);
};

/**
 * Standard base64 with padding, or undefined.
 * Accepts base64url (`-`/`_`, padding optional): sniffing already did, validation did not.
 */
const canonicalizeBase64 = (data: string): string | undefined => {
  if (data.length === 0 || /[^A-Za-z0-9+/_=-]/.test(data)) return undefined;
  const unpadded = data.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (unpadded.length === 0 || unpadded.length % 4 === 1 || !/^[A-Za-z0-9+/]+$/.test(unpadded)) return undefined;
  return unpadded + "=".repeat((4 - (unpadded.length % 4)) % 4);
};

const headOf = (canonical: string): Uint8Array => {
  try {
    return Uint8Array.from(atob(canonical.slice(0, 16)), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
};

/**
 * Makes an image for a state: `ask.if({ photo: image(bytes), note }, "is damaged")`.
 *
 * `input` is raw bytes, a base64 or base64url string, or a `data:image/...;base64,` URL. For raw bytes and
 * base64, the media type is detected (PNG, JPEG, WebP, GIF) unless you pass it. Stored data is standard base64.
 */
export const image = (input: Uint8Array | string, mediaType?: string): Image => {
  let data: string | undefined;
  let type = mediaType;
  if (typeof input === "string") {
    const url = DATA_URL.exec(input);
    data = canonicalizeBase64(url?.[2] ?? input);
    type ??= url?.[1] ?? (data === undefined ? undefined : sniff(headOf(data)));
  } else {
    data = toBase64(input);
    type ??= sniff(input);
  }
  if (type === undefined || !MEDIA_TYPE.test(type)) {
    throw makeAskError(
      "UNSUPPORTED_INPUT",
      type === undefined
        ? "Can't tell the image format (PNG, JPEG, WebP and GIF are detected); pass the media type, e.g. image(bytes, \"image/png\")."
        : `"${type}" is not an image media type.`,
    );
  }
  if (data === undefined || !STANDARD_BASE64.test(data)) {
    throw makeAskError("UNSUPPORTED_INPUT", "The image data is empty or not valid base64.");
  }
  return { type: "image", source: { kind: "base64", mediaType: type.toLowerCase(), data } };
};

/** A `{ content_type, base64 }` pair `extractImages` treats as an image in `"auto"` mode. */
export const isContentImage = (value: unknown): value is { readonly content_type: string; readonly base64: string } =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  typeof value["content_type"] === "string" &&
  MEDIA_TYPE.test(value["content_type"]) &&
  typeof value["base64"] === "string";

export type ExtractImagesOptions = {
  /**
   * Number of the first `[image N]` in this state. Default 1.
   * When several states share one image list, continue from the previous state's count
   * so `[image N]` is the Nth image in that list. Count a repeated state once.
   */
  readonly from?: number;
  /**
   * `"image"` lifts only `image()` values. Data-URL strings and `{ content_type, base64 }`
   * objects stay text. Omit it for today's behaviour.
   */
  readonly only?: "image";
};

/**
 * Moves every image out of a state, for backends: each becomes `[image N]` (N from 1, in the order
 * found) and is returned in `images`. Besides `image()` values, it picks up a base64 image data URL
 * string and a `{ content_type, base64 }` object wherever they appear.
 */
export const extractImages = (
  state: Json,
  options?: ExtractImagesOptions,
): { readonly state: Json; readonly images: readonly Image[] } => {
  const images: Image[] = [];
  const start = options?.from ?? 1;
  const placeholder = (mediaType: string, data: string): string => {
    images.push({ type: "image", source: { kind: "base64", mediaType: mediaType.toLowerCase(), data } });
    return `[image ${start + images.length - 1}]`;
  };
  const explicit = options?.only === "image";
  const walk = (value: Json): Json => {
    if (typeof value === "string") {
      if (explicit) return value;
      const url = DATA_URL.exec(value);
      return url?.[1] !== undefined && url[2] !== undefined ? placeholder(url[1], url[2]) : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      if (isImage(value)) return placeholder(value.source.mediaType, value.source.data);
      if (!explicit && isContentImage(value)) return placeholder(value.content_type, value.base64);
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]));
    }
    return value;
  };
  const stripped = walk(state);
  return { state: stripped, images };
};
