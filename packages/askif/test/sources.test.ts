import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base64Source,
  bucketImage,
  createAsk,
  extractImages,
  fallback,
  image,
  imageUrl,
  isAskError,
  isImage,
  mock,
} from "../src/index.js";
import type { Answer, Json, RemoteImageSource, State } from "../src/index.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const yes = (): Answer => ({ kind: "yesno", probability: 1 });
const unsupported = (pattern: RegExp) => (error: unknown) =>
  isAskError(error) && error.code === "UNSUPPORTED_INPUT" && pattern.test(error.message);

const isRecord = (value: unknown): value is Readonly<Record<string, Json>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The image at `state.photo`, as the backend received it. */
const photoOf = (state: State | undefined): unknown => (isRecord(state) ? state["photo"] : undefined);

test("imageUrl() takes http(s) URLs only and normalises them", () => {
  const photo = imageUrl("HTTPS://Example.com/a b.png", "IMAGE/PNG");
  assert.deepEqual(photo.source, { kind: "url", url: "https://example.com/a%20b.png", mediaType: "image/png" });
  assert.equal(Object.isFrozen(photo.source), true);
  assert.deepEqual(imageUrl("http://example.com/x").source, { kind: "url", url: "http://example.com/x" });
  for (const bad of ["ftp://example.com/a.png", "data:image/png;base64,AAAA", "file:///etc/passwd", "not a url"]) {
    assert.throws(() => imageUrl(bad), unsupported(/http or https/));
  }
  assert.throws(() => imageUrl("https://example.com/a.txt", "text/plain"), unsupported(/not an image media type/));
});

test("bucketImage() checks the provider, bucket and key", () => {
  const photo = bucketImage({ provider: "r2", bucket: "returns", key: "2026/11/parcel.jpg", mediaType: "image/jpeg" });
  assert.deepEqual(photo.source, {
    kind: "bucket",
    provider: "r2",
    bucket: "returns",
    key: "2026/11/parcel.jpg",
    mediaType: "image/jpeg",
  });
  assert.equal(isImage(photo), true);
  assert.throws(() => bucketImage({ provider: "s3", bucket: "", key: "k" }), unsupported(/bucket and a key/));
  // @ts-expect-error: a provider askif doesn't know, from untyped input.
  assert.throws(() => bucketImage({ provider: "azure", bucket: "b", key: "k" }), unsupported(/provider/));
});

test("extractImages() lifts imageUrl() values and leaves look-alikes as text", () => {
  const photo = imageUrl("https://example.com/a.png");
  const lookalike = { type: "image", source: { kind: "url", url: "http://169.254.169.254/latest" } };
  for (const only of [undefined, "image"] as const) {
    const { state, images } = extractImages({ photo, lookalike }, only === undefined ? {} : { only });
    assert.deepEqual(state, { photo: "[image 1]", lookalike });
    assert.deepEqual(images, [{ type: "image", source: photo.source }]);
  }
});

test("base64Source() names the backend when it gets an image it can't read", () => {
  assert.equal(base64Source(image(PNG), "clef").data, b64(PNG));
  assert.throws(() => base64Source(imageUrl("https://example.com/a.png"), "clef"), unsupported(/clef backend can't fetch url/));
});

test("a backend that reads URLs gets the URL, and resolveImage is not called", async () => {
  const backend = mock(yes, { maxImages: 1 }, { imageSources: ["url"] });
  const photo = imageUrl("https://example.com/a.png");
  let resolved = 0;
  const ask = createAsk({
    backend,
    resolveImage: async () => {
      resolved += 1;
      return PNG;
    },
  });
  assert.equal(await ask.is({ photo }, "is a cat"), true);
  assert.equal(photoOf(backend.calls[0]?.state), photo);
  assert.equal(resolved, 0);
});

test("without resolveImage, a URL image fails before the backend is called", async () => {
  const backend = mock(yes, { maxImages: 1 });
  await assert.rejects(
    () => createAsk({ backend }).is({ photo: imageUrl("https://example.com/a.png") }, "is a cat"),
    unsupported(/mock backend can't fetch url images\. Pass resolveImage/),
  );
  assert.equal(backend.calls.length, 0);
});

test("a remote image still counts against maxImages", async () => {
  await assert.rejects(
    () => createAsk({ backend: mock(yes) }).is({ photo: imageUrl("https://example.com/a.png") }, "is a cat"),
    unsupported(/does not accept images/),
  );
});

test("resolveImage downloads each distinct source once and the backend gets a trusted base64 image", async () => {
  for (const images of ["auto", "explicit"] as const) {
    const backend = mock(yes, { maxImages: 3 });
    const seen: RemoteImageSource[] = [];
    const ask = createAsk({
      backend,
      protection: { images },
      resolveImage: async (source) => {
        seen.push(source);
        return source.kind === "url" ? PNG : JPEG;
      },
    });
    const url = imageUrl("https://example.com/a.png");
    const bucket = bucketImage({ provider: "s3", bucket: "b", key: "k.jpg" });
    // Three conditions on one state: one request, each source downloaded once.
    await ask
      .if({ photo: url, again: url, scan: bucket }, "is a cat")
      .elseif("is a dog")
      .elseif("is a bird");
    assert.equal(backend.calls.length, 1);
    assert.deepEqual(seen, [url.source, bucket.source]);
    const sent = backend.calls[0]?.state ?? null;
    const lifted = extractImages(sent, images === "explicit" ? { only: "image" } : {});
    assert.deepEqual(lifted.state, { photo: "[image 1]", again: "[image 2]", scan: "[image 3]" });
    assert.deepEqual(
      lifted.images.map((found) => base64Source(found, "mock")),
      [
        { kind: "base64", mediaType: "image/png", data: b64(PNG) },
        { kind: "base64", mediaType: "image/png", data: b64(PNG) },
        { kind: "base64", mediaType: "image/jpeg", data: b64(JPEG) },
      ],
    );
  }
});

test("resolveImage may return image() to set the media type; a remote image is refused", async () => {
  const backend = mock(yes, { maxImages: 1 });
  const ask = createAsk({ backend, resolveImage: async () => image(b64(PNG), "image/webp") });
  await ask.is({ photo: imageUrl("https://example.com/a") }, "is a cat");
  const sent = photoOf(backend.calls[0]?.state);
  assert.ok(isImage(sent));
  assert.equal(sent.source.mediaType, "image/webp");

  const loop = createAsk({ backend, resolveImage: async (source) => imageUrl(source.kind === "url" ? source.url : "") });
  await assert.rejects(
    () => loop.is({ photo: imageUrl("https://example.com/a.png") }, "is a cat"),
    unsupported(/returned a url image/),
  );
});

test("a failed download fails only the questions about that state", async () => {
  const backend = mock(yes, { maxImages: 1 }, { multiState: true });
  const cause = new Error("403 Forbidden");
  const ask = createAsk({
    backend,
    resolveImage: async (source) => {
      if (source.kind === "url" && source.url.includes("/missing.png")) throw cause;
      return PNG;
    },
  });
  const [bad, good, plain] = await Promise.allSettled([
    ask.is({ photo: imageUrl("https://user:pw@example.com/missing.png?X-Amz-Signature=secret") }, "is a cat"),
    ask.is({ photo: imageUrl("https://example.com/ok.png") }, "is a cat"),
    ask.is("no image here", "is a cat"),
  ]);
  assert.equal(bad.status, "rejected");
  if (bad.status === "rejected") {
    assert.ok(unsupported(/resolveImage failed for the url image https:\/\/example\.com\/missing\.png\.$/)(bad.reason));
    // A presigned URL's signature and any userinfo stay out of the message.
    assert.ok(bad.reason instanceof Error && !/secret|pw/.test(bad.reason.message));
    assert.equal(isAskError(bad.reason) ? bad.reason.cause : undefined, cause);
  }
  assert.deepEqual([good.status, plain.status], ["fulfilled", "fulfilled"]);
  // The two states that resolved still went out together.
  assert.equal(backend.manyCalls.length, 1);
  assert.equal(backend.manyCalls[0]?.length, 2);
});

test("a URL look-alike in state JSON is never fetched", async () => {
  const backend = mock(yes, { maxImages: 1 });
  let resolved = 0;
  const ask = createAsk({
    backend,
    resolveImage: async () => {
      resolved += 1;
      return PNG;
    },
  });
  const lookalike = { type: "image", source: { kind: "url", url: "http://169.254.169.254/latest/meta-data" } };
  assert.equal(await ask.is({ photo: lookalike }, "is a cat"), true);
  assert.equal(resolved, 0);
  assert.deepEqual(photoOf(backend.calls[0]?.state), lookalike);
  // Without a resolver it is still just text, not an error.
  assert.equal(await createAsk({ backend }).is({ photo: lookalike }, "is a cat"), true);
});

test("fallback() advertises only the image sources both backends read", () => {
  const url = mock(yes, undefined, { imageSources: ["url"] });
  const base64 = mock(yes);
  assert.deepEqual(fallback(url, url).imageSources, ["url"]);
  assert.equal(fallback(url, base64).imageSources, undefined);
  assert.equal(fallback(base64, url).imageSources, undefined);
});
