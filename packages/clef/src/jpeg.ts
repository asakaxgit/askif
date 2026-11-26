// Lossless JPEG metadata removal for the HTTP 413 workaround (see "Known issue" in the README).
// Only marker segments before the first scan are touched; the entropy-coded image data is
// copied byte for byte, so pixels do not change. atob/btoa instead of Buffer, for Workers.

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP14 = 0xee;
const COM = 0xfe;

/** "JFIF\0" */
const JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00];

/**
 * Segments that only carry metadata: APP1-APP13 and APP15 (Exif, XMP, ICC profile, IPTC, ...)
 * and comments. APP14 (Adobe) is kept because it says how to convert the colours.
 */
const isMetadata = (marker: number): boolean =>
  (marker > APP0 && marker < APP14) || marker === 0xef || marker === COM;

/** Standalone markers: TEM and RST0-RST7. They have no length field. */
const isStandalone = (marker: number): boolean => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * A JFIF APP0 segment with no density (units 0, aspect 1:1) and no thumbnail.
 * Undefined for an APP0 that is not JFIF (e.g. a JFXX thumbnail), which is dropped.
 */
const plainJfif = (segment: Uint8Array): Uint8Array | undefined => {
  if (segment.length < 16 || !JFIF.every((byte, i) => segment[4 + i] === byte)) return undefined;
  const major = segment[9] ?? 1;
  const minor = segment[10] ?? 1;
  return Uint8Array.of(0xff, APP0, 0, 16, ...JFIF, major, minor, 0, 0, 1, 0, 1, 0, 0);
};

/**
 * `jpeg` without Exif, XMP, ICC, IPTC, comments, thumbnails and DPI, or undefined when
 * there was nothing to remove or the file is not a JPEG this can walk safely.
 * Orientation stored in Exif is lost with the rest.
 */
export const stripJpegMetadata = (jpeg: Uint8Array): Uint8Array | undefined => {
  if (jpeg[0] !== 0xff || jpeg[1] !== SOI) return undefined;
  const parts: Uint8Array[] = [jpeg.subarray(0, 2)];
  let changed = false;
  let offset = 2;
  for (;;) {
    if (offset + 1 >= jpeg.length || jpeg[offset] !== 0xff) return undefined;
    const marker = jpeg[offset + 1];
    if (marker === undefined) return undefined;
    if (marker === 0xff) {
      // Fill byte before a marker.
      offset += 1;
      continue;
    }
    if (marker === SOS || marker === EOI) break;
    if (isStandalone(marker)) {
      parts.push(jpeg.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const hi = jpeg[offset + 2];
    const lo = jpeg[offset + 3];
    if (hi === undefined || lo === undefined) return undefined;
    const end = offset + 2 + hi * 256 + lo;
    if (end < offset + 4 || end > jpeg.length) return undefined;
    const segment = jpeg.subarray(offset, end);
    if (isMetadata(marker)) {
      changed = true;
    } else if (marker === APP0) {
      const jfif = plainJfif(segment);
      if (jfif !== undefined) parts.push(jfif);
      if (jfif === undefined || !sameBytes(jfif, segment)) changed = true;
    } else {
      parts.push(segment);
    }
    offset = end;
  }
  if (!changed) return undefined;
  parts.push(jpeg.subarray(offset));
  return concat(parts);
};

const fromBase64 = (data: string): Uint8Array | undefined => {
  try {
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** Base64 in, base64 out. Undefined when nothing was removed. */
export const stripJpegMetadataBase64 = (data: string): string | undefined => {
  const bytes = fromBase64(data);
  const stripped = bytes === undefined ? undefined : stripJpegMetadata(bytes);
  return stripped === undefined ? undefined : toBase64(stripped);
};
