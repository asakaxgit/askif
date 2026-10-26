import { makeAskError } from "./errors.js";
import {
  DATA_URL,
  extractImages,
  isContentImage,
  isImage,
  isStandardImageDataUrl,
  isStandardImagePayload,
  isTrustedImage,
} from "./image.js";
import type { Description, Json, ProtectionConfig, ProtectionOverride, State } from "./types.js";

/**
 * Hidden and control characters removed from untrusted text.
 * U+200D (ZWJ) is in the class; {@link stripHidden} keeps it only inside an emoji sequence.
 * The last alternative is U+E0000–U+E007F (Unicode tag characters).
 */
export const HIDDEN_CHARS: RegExp =
  /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|\uDB40[\uDC00-\uDC7F]/g;

const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;

export const DEFAULT_PROTECTION = {
  stripHidden: true,
  stripHtmlComments: true,
  maxStateChars: 200_000,
  maxStringChars: 50_000,
  images: "auto",
  unsureOnInjection: true,
} as const satisfies ProtectionConfig;

/**
 * Largest untrusted image payload, in characters.
 * Clef's per-image file limit is 4 MiB, the smallest published in this repo (Jev allows 16 MiB).
 * Base64 is longer than the file, so a payload under this stays under that file limit.
 * Values returned by `image()` are not counted against it.
 */
export const UNTRUSTED_IMAGE_CHARS = 4 * 1024 * 1024;

const refusedImage = (chars: number): string => `[refused image: ${chars} chars]`;

export const effectiveProtection = (
  base: ProtectionConfig | false,
  override: ProtectionOverride | undefined,
): ProtectionConfig | false => {
  if (override === false) return false;
  if (override === undefined) return base;
  return { ...(base === false ? DEFAULT_PROTECTION : base), ...override };
};

const isHiddenCodePoint = (cp: number): boolean => {
  if (cp === 0x00ad || cp === 0x180e || cp === 0xfeff) return true;
  if (cp >= 0x200b && cp <= 0x200f) return true;
  if (cp >= 0x202a && cp <= 0x202e) return true;
  if (cp >= 0x2060 && cp <= 0x2064) return true;
  if (cp >= 0x2066 && cp <= 0x2069) return true;
  if (cp <= 0x08 || cp === 0x0b || cp === 0x0c || (cp >= 0x0e && cp <= 0x1f) || cp === 0x7f) return true;
  if (cp >= 0x80 && cp <= 0x9f) return true;
  if (cp >= 0xe0000 && cp <= 0xe007f) return true;
  return false;
};

const isPictographic = (cp: number): boolean => /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp));

/** Variation selectors and emoji skin-tone modifiers sit inside a ZWJ sequence. */
const isEmojiGlue = (cp: number): boolean => cp === 0xfe0e || cp === 0xfe0f || (cp >= 0x1f3fb && cp <= 0x1f3ff);

const pictographicBeside = (chars: readonly string[], index: number, dir: -1 | 1): boolean => {
  for (let i = index + dir; i >= 0 && i < chars.length; i += dir) {
    const ch = chars[i];
    const cp = ch?.codePointAt(0);
    if (cp === undefined) return false;
    if (isEmojiGlue(cp)) continue;
    return isPictographic(cp);
  }
  return false;
};

/**
 * Drops the {@link HIDDEN_CHARS} classes. U+200D is kept when it joins two emoji
 * (skin tone and variation selectors don't break the join) so 👨‍👩‍👧 and ❤️‍🔥 stay intact,
 * and removed otherwise, including a ZWJ used as invisible text.
 */
export const stripHidden = (text: string): string => {
  const chars = Array.from(text);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch?.codePointAt(0);
    if (ch === undefined || cp === undefined) continue;
    if (cp === 0x200d) {
      if (pictographicBeside(chars, i, -1) && pictographicBeside(chars, i, 1)) out += ch;
      continue;
    }
    if (!isHiddenCodePoint(cp)) out += ch;
  }
  return out === text ? text : out;
};

const truncate = (text: string, max: number): string => {
  const limit = Math.max(0, max);
  if (text.length <= limit) return text;
  let end = limit;
  const atBoundary = text.charCodeAt(end - 1);
  // Don't leave a lone high surrogate at the cut.
  if (end > 0 && atBoundary !== undefined && atBoundary >= 0xd800 && atBoundary <= 0xdbff) end -= 1;
  const dropped = text.length - end;
  return `${text.slice(0, end)}…[truncated ${dropped} chars]`;
};

/** Clean one string: hidden characters, HTML comments, then the length cap. */
export const sanitizeText = (text: string, p: ProtectionConfig): string => {
  const hidden = p.stripHidden ? stripHidden(text) : text;
  const comments = p.stripHtmlComments ? hidden.replace(HTML_COMMENT, "") : hidden;
  return Number.isFinite(p.maxStringChars) ? truncate(comments, p.maxStringChars) : comments;
};

/** Provider text echoed into an error: hidden characters removed, then a hard cap. */
export const clipUntrusted = (text: string, max = 200): string => {
  const stripped = stripHidden(text);
  if (stripped.length <= max) return stripped;
  let end = max;
  const atBoundary = stripped.charCodeAt(end - 1);
  if (end > 0 && atBoundary !== undefined && atBoundary >= 0xd800 && atBoundary <= 0xdbff) end -= 1;
  return stripped.slice(0, Math.max(0, end));
};

const keepUntrustedPayload = (data: string): boolean => data.length <= UNTRUSTED_IMAGE_CHARS;

const walkState = (value: Json, p: ProtectionConfig): Json => {
  if (typeof value === "string") {
    if (DATA_URL.test(value)) {
      const payload = DATA_URL.exec(value)?.[2];
      const n = payload === undefined ? value.length : payload.length;
      const keep =
        p.images === "auto" &&
        payload !== undefined &&
        keepUntrustedPayload(payload) &&
        isStandardImageDataUrl(value);
      if (keep) return value;
      // Explicit mode leaves a short data URL as text. A long one is not forwarded as truncated base64.
      if (p.images === "explicit" && (!Number.isFinite(p.maxStringChars) || value.length <= p.maxStringChars)) return value;
      return refusedImage(n);
    }
    const cleaned = sanitizeText(value, p);
    // Hidden characters can reveal a data URL. Do not forward that payload as text.
    if (p.images === "auto" && DATA_URL.test(cleaned)) return refusedImage(cleaned.length);
    return cleaned;
  }
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((entry) => walkState(entry, p));
  if (isImage(value)) {
    const data = value.source.data;
    const valid = isStandardImagePayload(value.source.mediaType, data);
    if (isTrustedImage(value)) return valid ? value : refusedImage(data.length);
    if (valid && keepUntrustedPayload(data)) return value;
    return refusedImage(data.length);
  }
  if (isContentImage(value)) {
    const data = value.base64;
    const valid = isStandardImagePayload(value.content_type, data) && keepUntrustedPayload(data);
    if (!valid) return refusedImage(data.length);
    if (p.images === "auto") return value;
    if (Number.isFinite(p.maxStringChars) && data.length > p.maxStringChars) return refusedImage(data.length);
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [sanitizeText(key, p), walkState(entry, p)]));
};

/** Walk a state and clean every string value and object key. Trusted `image()` values stay intact. */
export const reduceState = (state: State, p: ProtectionConfig): State => {
  const reduced = walkState(state, p);
  if (Number.isFinite(p.maxStateChars)) {
    const measured = extractImages(reduced, p.images === "explicit" ? { only: "image" } : {}).state;
    const n = JSON.stringify(measured).length;
    if (n > p.maxStateChars) {
      throw makeAskError(
        "UNSUPPORTED_INPUT",
        `The state is ${n} characters; the limit is ${p.maxStateChars}. Raise protection.maxStateChars or pass protection: false.`,
      );
    }
  }
  return reduced;
};

const walkDescription = (value: Description): Description => {
  if (typeof value === "string") return stripHidden(value);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(walkDescription);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [stripHidden(key), walkDescription(entry)]));
};

/** Clean developer text: hidden characters only. Comments stay, and nothing is truncated. */
export const reduceDescription = (description: Description, p: ProtectionConfig | false): Description =>
  p === false || !p.stripHidden ? description : walkDescription(description);

/**
 * Known injection markers, matched case-insensitively on the reduced state's text.
 * Repeats are bounded and do not cross newlines, so a long run of spaces or newlines stays linear.
 */
export const INJECTION_MARKERS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|the)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|questions?)\b/i,
  /<[^\S\n]{0,20}\/?[^\S\n]{0,20}(state|system|assistant|user|developer|instructions?)\b[^>\n]{0,200}>/i,
  /^[^\S\n]{0,20}(system|assistant|developer)[^\S\n]{0,20}:/im,
  /\b(answer|respond|output|return|reply)\b[^.\n]{0,30}\b(probability|yes|no|1(\.0)?|100\s*%)\b[^.\n]{0,15}$/im,
  /\b(you are now|new instructions|jailbreak|prompt injection)\b/i,
];

const stateText = (state: State): string => {
  if (typeof state === "string") return state;
  const parts: string[] = [];
  const walk = (value: Json): void => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) for (const entry of value) walk(entry);
    else if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        parts.push(key);
        walk(entry);
      }
    }
  };
  walk(state);
  return parts.join("\n");
};

export const looksInjected = (state: State): boolean => {
  const text = stateText(state);
  return INJECTION_MARKERS.some((marker) => marker.test(text));
};
