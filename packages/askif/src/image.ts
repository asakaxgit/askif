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

const headOf = (base64: string): Uint8Array => {
  try {
    return Uint8Array.from(atob(base64.slice(0, 16).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
};

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MEDIA_TYPE = /^image\/[a-z0-9.+-]+$/i;

/**
 * Makes an image for a state: `ask.if({ photo: image(bytes), note }, "is damaged")`.
 *
 * `input` is raw bytes, a base64 string, or a `data:image/...;base64,` URL. For raw bytes and base64,
 * the media type is detected (PNG, JPEG, WebP, GIF) unless you pass it.
 */
export const image = (input: Uint8Array | string, mediaType?: string): Image => {
  let data: string;
  let type = mediaType;
  if (typeof input === "string") {
    const url = DATA_URL.exec(input);
    data = url?.[2] ?? input;
    type ??= url?.[1] ?? sniff(headOf(data));
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
  if (data.length === 0 || !BASE64.test(data)) {
    throw makeAskError("UNSUPPORTED_INPUT", "The image data is empty or not valid base64.");
  }
  return { type: "image", source: { kind: "base64", mediaType: type.toLowerCase(), data } };
};

/**
 * Moves every image out of a state, for backends: each becomes `[image N]` (N from 1, in the order
 * found) and is returned in `images`. Besides `image()` values, it picks up a base64 image data URL
 * string and a `{ content_type, base64 }` object wherever they appear.
 */
export const extractImages = (state: Json): { readonly state: Json; readonly images: readonly Image[] } => {
  const images: Image[] = [];
  const placeholder = (mediaType: string, data: string): string => {
    images.push({ type: "image", source: { kind: "base64", mediaType: mediaType.toLowerCase(), data } });
    return `[image ${images.length}]`;
  };
  const walk = (value: Json): Json => {
    if (typeof value === "string") {
      const url = DATA_URL.exec(value);
      return url?.[1] !== undefined && url[2] !== undefined ? placeholder(url[1], url[2]) : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      if (isImage(value)) return placeholder(value.source.mediaType, value.source.data);
      const { content_type: contentType, base64 } = value;
      if (
        Object.keys(value).length === 2 &&
        typeof contentType === "string" &&
        MEDIA_TYPE.test(contentType) &&
        typeof base64 === "string"
      ) {
        return placeholder(contentType, base64);
      }
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]));
    }
    return value;
  };
  const stripped = walk(state);
  return { state: stripped, images };
};
