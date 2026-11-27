import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { stripJpegMetadata, stripJpegMetadataBase64 } from "../src/jpeg.js";

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** Marker segments before the first scan, and where the scan starts. */
const header = (jpeg: Uint8Array): { markers: number[]; scan: number } => {
  const markers: number[] = [];
  let offset = 2;
  for (;;) {
    const marker = jpeg[offset + 1];
    assert.ok(jpeg[offset] === 0xff && marker !== undefined, `marker at ${offset}`);
    if (marker === 0xda) return { markers, scan: offset };
    markers.push(marker);
    offset += 2 + (jpeg[offset + 2] ?? 0) * 256 + (jpeg[offset + 3] ?? 0);
  }
};

const segment = (marker: number, payload: Uint8Array): Uint8Array => {
  const length = payload.length + 2;
  return Uint8Array.of(0xff, marker, length >> 8, length & 0xff, ...payload);
};

/** An APP1 Exif segment recording 250 DPI, inserted right after SOI like a camera would. */
const withExif = (jpeg: Uint8Array): Uint8Array => {
  // "Exif\0\0", little-endian TIFF header, one IFD entry: ResolutionUnit = inches.
  const exif = Uint8Array.of(
    ...[0x45, 0x78, 0x69, 0x66, 0, 0],
    ...[0x49, 0x49, 42, 0, 8, 0, 0, 0],
    ...[1, 0, 0x28, 0x01, 3, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
  );
  const app1 = segment(0xe1, exif);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2));
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
};

const scanData = (jpeg: Uint8Array): Uint8Array => jpeg.subarray(header(jpeg).scan);

test("stripJpegMetadata drops Exif and comments and keeps the image data byte for byte", () => {
  const original = withExif(fixture("public-domain/bicycle.jpg"));
  assert.deepEqual(header(original).markers.slice(0, 3), [0xe1, 0xe0, 0xfe]);

  const stripped = stripJpegMetadata(original);
  assert.ok(stripped !== undefined);
  assert.ok(stripped.length < original.length);
  const { markers } = header(stripped);
  assert.equal(markers[0], 0xe0);
  assert.ok(!markers.some((m) => (m > 0xe0 && m < 0xee) || m === 0xef || m === 0xfe), "no metadata left");
  assert.ok(markers.includes(0xc0) || markers.includes(0xc2), "frame header kept");
  assert.ok(markers.includes(0xdb) && markers.includes(0xc4), "quantization and Huffman tables kept");
  assert.deepEqual(scanData(stripped), scanData(original));
  assert.equal(stripJpegMetadata(stripped), undefined, "a second pass has nothing to do");
});

test("stripJpegMetadata resets JFIF density and drops Photoshop IPTC", () => {
  const dog = fixture("public-domain/dog.jpg");
  assert.equal(dog[13], 1, "dog.jpg says dots per inch");
  assert.equal((dog[14] ?? 0) * 256 + (dog[15] ?? 0), 300);
  assert.ok(header(dog).markers.includes(0xed));

  const stripped = stripJpegMetadata(dog);
  assert.ok(stripped !== undefined);
  assert.deepEqual(
    [...stripped.subarray(0, 20)],
    [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 0, 0, 1, 0, 1, 0, 0],
  );
  assert.ok(!header(stripped).markers.includes(0xed));
  assert.deepEqual(scanData(stripped), scanData(dog));
});

test("stripJpegMetadata returns undefined when there is nothing to remove or it can't parse", () => {
  assert.equal(stripJpegMetadata(fixture("public-domain/cat.jpg")), undefined);
  assert.equal(stripJpegMetadata(fixture("images/blue-square.jpg")), undefined);
  assert.equal(stripJpegMetadata(fixture("images/checkerboard.png")), undefined);
  const truncated = withExif(fixture("public-domain/bicycle.jpg")).subarray(0, 30);
  assert.equal(stripJpegMetadata(truncated), undefined);
  assert.equal(stripJpegMetadata(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 1)), undefined);
});

test("stripJpegMetadataBase64 round-trips through base64", () => {
  const original = withExif(fixture("public-domain/bicycle.jpg"));
  const stripped = stripJpegMetadataBase64(Buffer.from(original).toString("base64"));
  assert.ok(stripped !== undefined);
  assert.deepEqual(new Uint8Array(Buffer.from(stripped, "base64")), stripJpegMetadata(original));
  assert.equal(stripJpegMetadataBase64("not base64!"), undefined);
});
