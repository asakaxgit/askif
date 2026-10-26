const u16 = (n: number): Uint8Array => Uint8Array.of(n & 0xff, (n >> 8) & 0xff);

const u32 = (n: number): Uint8Array =>
  Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const entry = (tag: number, type: number, count: number, value: number): Uint8Array =>
  concat([u16(tag), u16(type), u32(count), u32(value)]);

const byteAt = (bytes: Uint8Array, offset: number): number => {
  const byte = bytes[offset];
  if (byte === undefined) throw new Error("truncated JPEG");
  return byte;
};

/** Width and height from the first SOF marker. */
export const jpegDimensions = (bytes: Uint8Array): { readonly width: number; readonly height: number } => {
  if (byteAt(bytes, 0) !== 0xff || byteAt(bytes, 1) !== 0xd8) throw new Error("not a JPEG");
  let offset = 2;
  while (offset < bytes.length) {
    if (byteAt(bytes, offset) !== 0xff) throw new Error("JPEG marker was expected");
    while (byteAt(bytes, offset) === 0xff) offset += 1;
    const marker = byteAt(bytes, offset);
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = byteAt(bytes, offset) * 256 + byteAt(bytes, offset + 1);
    if (length < 2) throw new Error("JPEG segment length is invalid");
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      return {
        height: byteAt(bytes, offset + 3) * 256 + byteAt(bytes, offset + 4),
        width: byteAt(bytes, offset + 5) * 256 + byteAt(bytes, offset + 6),
      };
    }
    offset += length;
  }
  throw new Error("JPEG has no start-of-frame marker");
};

/**
 * Inserts an APP1 Exif segment, immediately after SOI, that records `dpi` pixels per inch
 * on both axes. The rest of the file, including the image data, is unchanged.
 * The Clef HTTP 413 report used a JPEG carrying this kind of 250 DPI metadata.
 */
export const withDpiExif = (jpeg: Uint8Array, dpi: number): Uint8Array => {
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 65535) throw new Error("dpi must be an integer from 1 to 65535");
  if (byteAt(jpeg, 0) !== 0xff || byteAt(jpeg, 1) !== 0xd8) throw new Error("expected a JPEG");

  const entries = 4;
  const ifd = 8;
  const rationals = ifd + 2 + entries * 12 + 4;
  const tiff = concat([
    Uint8Array.of(0x49, 0x49),
    u16(42),
    u32(ifd),
    u16(entries),
    entry(0x0112, 3, 1, 1),
    entry(0x011a, 5, 1, rationals),
    entry(0x011b, 5, 1, rationals + 8),
    entry(0x0128, 3, 1, 2),
    u32(0),
    u32(dpi),
    u32(1),
    u32(dpi),
    u32(1),
  ]);
  const exif = Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0x00, 0x00);
  const length = 2 + exif.length + tiff.length;
  const app1 = concat([Uint8Array.of(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff), exif, tiff]);
  return concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
};
