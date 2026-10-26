import { makeAskError } from "askif";
import type { Image } from "askif";

/** Formats Jev accepts. `image/jpg` is another name for JPEG. WebP and GIF are not accepted. */
export const JEV_IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/jpg"];

/**
 * Most images in one request. Jev publishes no count, so this is our guard: core's
 * `maxImages` applies it to each state and to a packed call, and question images share it too.
 */
export const JEV_MAX_IMAGES = 64;

/** Limits from https://docs.typesafe.ai/images. Both ends of each range are allowed. */
export const JEV_IMAGE_LIMITS = {
  minSide: 280,
  maxSide: 1568,
  minPixels: 78_400,
  maxPixels: 2_458_624,
  maxFileBytes: 16 * 1024 * 1024,
  maxRequestBytes: 32 * 1024 * 1024,
} as const;

const fail = (message: string): never => {
  throw makeAskError("UNSUPPORTED_INPUT", message);
};

const byteAt = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] ?? fail("Jev could not read this image: the file is damaged or incomplete.");

const starts = (bytes: Uint8Array, offset: number, ...expected: number[]): boolean =>
  expected.every((b, i) => bytes[offset + i] === b);

const sniff = (bytes: Uint8Array): string | undefined => {
  if (starts(bytes, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(bytes, 0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(bytes, 0, 0x52, 0x49, 0x46, 0x46) && starts(bytes, 8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (starts(bytes, 0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  return undefined;
};

const canonical = (mediaType: string): string => (mediaType === "image/jpg" ? "image/jpeg" : mediaType);

const ACCEPTED = new Set(JEV_IMAGE_TYPES.map(canonical));

const atobStrict = (data: string): string => {
  try {
    return atob(data);
  } catch (error) {
    throw makeAskError(
      "UNSUPPORTED_INPUT",
      "Jev could not decode this image: base64 must use the standard alphabet, with padding, and no whitespace.",
      error,
    );
  }
};

const decodeBase64 = (data: string): Uint8Array => {
  if (data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return fail(
      "Jev could not decode this image: base64 must use the standard alphabet, with padding, and no whitespace.",
    );
  }
  const binary = atobStrict(data);
  if (binary.length === 0) return fail("Jev could not decode this image: the base64 data is empty.");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;

const readU32 = (bytes: Uint8Array, offset: number): number =>
  byteAt(bytes, offset) * 0x1000000 +
  byteAt(bytes, offset + 1) * 0x10000 +
  byteAt(bytes, offset + 2) * 0x100 +
  byteAt(bytes, offset + 3);

const ascii = (bytes: Uint8Array, offset: number, length: number): string => {
  let text = "";
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(byteAt(bytes, offset + i));
  return text;
};

const parsePng = (bytes: Uint8Array): { readonly width: number; readonly height: number } => {
  if (ascii(bytes, 12, 4) !== "IHDR") fail("Jev could not read this PNG: the file is damaged or incomplete.");
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === "acTL") fail("Jev does not accept animated PNGs. Export one frame as a PNG or JPEG.");
    if (type === "IEND") break;
    const next = offset + 12 + length;
    if (next <= offset || next > bytes.length) break;
    offset = next;
  }
  return { width, height };
};

const parseJpeg = (bytes: Uint8Array): { readonly width: number; readonly height: number } => {
  // Sniff already required the SOI marker (FF D8 FF). Walk segments until a start-of-frame.
  let offset = 2;
  while (offset < bytes.length) {
    if (byteAt(bytes, offset) !== 0xff) fail("Jev could not read this JPEG: the file is damaged or incomplete.");
    while (byteAt(bytes, offset) === 0xff) offset += 1;
    const marker = byteAt(bytes, offset);
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = byteAt(bytes, offset) * 256 + byteAt(bytes, offset + 1);
    if (length < 2) fail("Jev could not read this JPEG: the file is damaged or incomplete.");
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        height: byteAt(bytes, offset + 3) * 256 + byteAt(bytes, offset + 4),
        width: byteAt(bytes, offset + 5) * 256 + byteAt(bytes, offset + 6),
      };
    }
    offset += length;
  }
  return fail("Jev could not read this JPEG: the file is damaged or incomplete.");
};

const assertDimensions = (width: number, height: number): void => {
  const { minSide, maxSide, minPixels, maxPixels } = JEV_IMAGE_LIMITS;
  const pixels = width * height;
  const sidesOk = width >= minSide && width <= maxSide && height >= minSide && height <= maxSide;
  const pixelsOk = pixels >= minPixels && pixels <= maxPixels;
  if (sidesOk && pixelsOk) return;
  const range = `${minPixels.toLocaleString("en-US")}–${maxPixels.toLocaleString("en-US")}`;
  fail(
    `Jev rejected an image that is ${width}×${height} pixels (${pixels} pixels). Each side must be ${minSide}–${maxSide} pixels, and the image must be ${range} pixels. Images are not resized.`,
  );
};

/** Decode one image core already extracted, and reject anything Jev would refuse. */
export const prepareJevImage = (image: Image): Uint8Array => {
  const declared = canonical(image.source.mediaType);
  if (!ACCEPTED.has(declared)) {
    fail(`Jev accepts PNG and JPEG only, not ${image.source.mediaType}. Convert it before sending.`);
  }
  const bytes = decodeBase64(image.source.data);
  if (bytes.byteLength > JEV_IMAGE_LIMITS.maxFileBytes) {
    fail(`Jev rejected an image of ${mib(bytes.byteLength)}. The limit is 16 MiB per image.`);
  }
  const actual = sniff(bytes);
  if (actual !== declared) {
    fail(
      actual === undefined
        ? `This image is labeled ${image.source.mediaType} but the bytes are not a ${declared === "image/png" ? "PNG" : "JPEG"}.`
        : `This image is labeled ${image.source.mediaType} but the bytes are ${actual}.`,
    );
  }
  const { width, height } = declared === "image/png" ? parsePng(bytes) : parseJpeg(bytes);
  assertDimensions(width, height);
  return bytes;
};

/**
 * Rough size of the multipart body the SDK sends: JSON, raw image bytes, and part headers.
 * Rejects above 32 MiB. The API counts the real body, including framing, and does not compress
 * that limit away.
 */
export const assertJevRequestBudget = (jsonBytes: number, imageBytes: readonly number[]): void => {
  const files = imageBytes.reduce((sum, n) => sum + n, 0);
  const total = jsonBytes + files + (imageBytes.length + 1) * 256;
  if (total > JEV_IMAGE_LIMITS.maxRequestBytes) {
    fail(
      `Jev rejected this request: the images make the body about ${mib(total)}, over the 32 MiB limit. Send fewer or smaller images.`,
    );
  }
};
