import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, extractImages, image, isAskError, isImage, mock } from "../src/index.js";
import type { Answer, Json } from "../src/index.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

test("image() detects the format from the bytes, as bytes or as base64", () => {
  for (const [bytes, mediaType] of [
    [PNG, "image/png"],
    [JPEG, "image/jpeg"],
    [GIF, "image/gif"],
    [WEBP, "image/webp"],
  ] as const) {
    const expected = { type: "image", source: { kind: "base64", mediaType, data: b64(bytes) } };
    assert.deepEqual(image(bytes), expected);
    assert.deepEqual(image(b64(bytes)), expected);
  }
});

test("image() takes a data URL, and an explicit media type wins", () => {
  assert.deepEqual(image(`data:image/PNG;base64,${b64(PNG)}`), image(PNG));
  assert.equal(image(PNG, "image/x-custom").source.mediaType, "image/x-custom");
  assert.equal(image(b64(JPEG), "image/png").source.mediaType, "image/png");
});

test("image() rejects what it can't make sense of", () => {
  const unsupported = (error: unknown): boolean => isAskError(error) && error.code === "UNSUPPORTED_INPUT";
  assert.throws(() => image(Uint8Array.from([1, 2, 3, 4])), unsupported); // unknown format
  assert.throws(() => image(b64(PNG), "text/plain"), unsupported);
  assert.throws(() => image("not base64 !!", "image/png"), unsupported);
  assert.throws(() => image("", "image/png"), unsupported);
});

test("isImage() recognises images built by image() and nothing else", () => {
  assert.equal(isImage(image(PNG)), true);
  assert.equal(isImage({ type: "image", source: { kind: "url", url: "https://x" } }), false);
  assert.equal(isImage("data:image/png;base64,AAAA"), false);
  assert.equal(isImage(null), false);
});

test("extractImages() moves images out in order, whatever form they came in", () => {
  const state: Json = {
    note: "look",
    first: image(PNG),
    nested: [{ legacy: { content_type: "image/jpeg", base64: b64(JPEG) } }, "data:image/webp;base64,AAAA"],
    count: 2,
    other: { content_type: "text/plain", base64: "aGk=" }, // not an image
  };
  const { state: text, images } = extractImages(state);
  assert.deepEqual(text, {
    note: "look",
    first: "[image 1]",
    nested: [{ legacy: "[image 2]" }, "[image 3]"],
    count: 2,
    other: { content_type: "text/plain", base64: "aGk=" },
  });
  assert.deepEqual(
    images.map((i) => [i.source.mediaType, i.source.data]),
    [
      ["image/png", b64(PNG)],
      ["image/jpeg", b64(JPEG)],
      ["image/webp", "AAAA"],
    ],
  );
});

test("extractImages() leaves a state without images as it was", () => {
  const state: Json = { a: [1, "two", null, true], b: { c: "data:text/plain;base64,AAAA" } };
  const result = extractImages(state);
  assert.deepEqual(result.state, state);
  assert.deepEqual(result.images, []);
});

const yes = (): Answer => ({ kind: "yesno", probability: 1 });

test("a state with images is rejected by a backend that takes none", async () => {
  const backend = mock(yes);
  await assert.rejects(
    () => createAsk({ backend }).is({ photo: image(PNG) }, "is a cat"),
    (error) => isAskError(error) && error.code === "UNSUPPORTED_INPUT" && /does not accept images/.test(error.message),
  );
  assert.equal(backend.calls.length, 0);
});

test("a state with images reaches a backend that takes enough of them, untouched", async () => {
  const backend = mock(yes, { maxImages: 2 });
  const state = { a: image(PNG), b: "data:image/webp;base64,AAAA" };
  assert.equal(await createAsk({ backend }).is(state, "is a cat"), true);
  assert.deepEqual(backend.calls[0]?.state, state); // core doesn't rewrite it; backends call extractImages
});

test("too many images are rejected", async () => {
  const backend = mock(yes, { maxImages: 1 });
  await assert.rejects(
    () => createAsk({ backend }).is([image(PNG), image(JPEG)], "is a cat"),
    (error) => isAskError(error) && error.code === "UNSUPPORTED_INPUT" && /at most 1 images per state, got 2/.test(error.message),
  );
});
