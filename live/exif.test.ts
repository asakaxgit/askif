import assert from "node:assert/strict";
import { test } from "node:test";
import { jpegDimensions, withDpiExif } from "./exif.js";
import { fixtureBytes } from "./support.js";

const readU16 = (bytes: Uint8Array, offset: number): number => {
  const lo = bytes[offset];
  const hi = bytes[offset + 1];
  assert.ok(lo !== undefined && hi !== undefined);
  return lo + hi * 256;
};

const readU32 = (bytes: Uint8Array, offset: number): number => {
  let value = 0;
  for (let i = 0; i < 4; i += 1) {
    const byte = bytes[offset + i];
    assert.ok(byte !== undefined);
    value += byte * 2 ** (8 * i);
  }
  return value;
};

test("withDpiExif inserts 250 DPI Exif and leaves the JPEG frame untouched", () => {
  const original = fixtureBytes("public-domain/bicycle.jpg");
  const before = jpegDimensions(original);
  assert.deepEqual(before, { width: 720, height: 600 });

  const tagged = withDpiExif(original, 250);
  assert.ok(tagged.length > original.length);
  assert.deepEqual(jpegDimensions(tagged), before);
  assert.deepEqual(tagged.subarray(0, 2), Uint8Array.of(0xff, 0xd8));
  assert.deepEqual(tagged.subarray(2, 4), Uint8Array.of(0xff, 0xe1));
  const lengthHi = tagged[4];
  const lengthLo = tagged[5];
  assert.ok(lengthHi !== undefined && lengthLo !== undefined);
  const segmentLength = lengthHi * 256 + lengthLo;
  assert.equal(tagged.length, original.length + 2 + segmentLength);
  assert.deepEqual(tagged.subarray(6, 12), Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0x00, 0x00));
  const tail = tagged.subarray(2 + 2 + segmentLength);
  const originalTail = original.subarray(2);
  assert.equal(tail.length, originalTail.length);
  const differsAt = tail.findIndex((byte, index) => byte !== originalTail[index]);
  assert.equal(differsAt, -1);

  const tiff = 12;
  assert.deepEqual(tagged.subarray(tiff, tiff + 2), Uint8Array.of(0x49, 0x49));
  assert.equal(readU16(tagged, tiff + 2), 42);
  const ifd = tiff + readU32(tagged, tiff + 4);
  assert.equal(readU16(tagged, ifd), 4);

  const tags = new Map<number, { readonly type: number; readonly value: number }>();
  for (let i = 0; i < 4; i += 1) {
    const at = ifd + 2 + i * 12;
    tags.set(readU16(tagged, at), { type: readU16(tagged, at + 2), value: readU32(tagged, at + 8) });
  }
  assert.equal(tags.get(0x0112)?.value, 1);
  assert.equal(tags.get(0x0128)?.value, 2);
  const x = tags.get(0x011a);
  const y = tags.get(0x011b);
  assert.ok(x !== undefined && y !== undefined);
  assert.equal(x.type, 5);
  assert.equal(y.type, 5);
  assert.equal(readU32(tagged, tiff + x.value), 250);
  assert.equal(readU32(tagged, tiff + x.value + 4), 1);
  assert.equal(readU32(tagged, tiff + y.value), 250);
  assert.equal(readU32(tagged, tiff + y.value + 4), 1);
});
