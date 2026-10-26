import assert from "node:assert/strict";
import { test } from "node:test";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { createAsk, image, isAskError } from "askif";
import type { Image, Json } from "askif";
import { jev } from "../src/index.js";
import { JEV_IMAGE_LIMITS, JEV_MAX_IMAGES, assertJevRequestBudget, prepareJevImage } from "../src/images.js";

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const u32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
};

const pngChunk = (type: string, data: Uint8Array): Uint8Array =>
  concat([u32(data.length), new TextEncoder().encode(type), data, new Uint8Array(4)]);

const png = (width: number, height: number, extra: readonly Uint8Array[] = []): Uint8Array => {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...extra,
    pngChunk("IEND", new Uint8Array()),
  ]);
};

const jpeg = (width: number, height: number): Uint8Array =>
  Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const dataUrl = (bytes: Uint8Array, type = "image/png"): string => `data:${type};base64,${b64(bytes)}`;
const asImage = (bytes: Uint8Array, mediaType: string): Image => ({
  type: "image",
  source: { kind: "base64", mediaType, data: b64(bytes) },
});

const unsupported = (pattern: RegExp) => (error: unknown) =>
  isAskError(error) && error.code === "UNSUPPORTED_INPUT" && pattern.test(error.message);

const yesno = { q: { kind: "yesno", instructions: "ok?" } } as const;

const answer = (): Response =>
  new Response(
    JSON.stringify({
      model: "jev-1.14.0",
      answers: { q: { type: "noul", noul: 0.5 }, a: { type: "noul", noul: 0.5 }, b: { type: "noul", noul: 0.5 } },
      usage: { input_tokens: 1, output_tokens: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

type Call = { readonly headers: Headers; readonly body: Buffer; readonly contentType: string | null };

const bytesOf = async (body: unknown): Promise<Buffer> => {
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new Error(`unexpected body ${typeof body}`);
};

const capture = (): { readonly calls: Call[]; readonly client: TypeSafeClient } => {
  const calls: Call[] = [];
  const client = new TypeSafeClient({
    apiKey: "test",
    retry: { maxRetries: 0 },
    compression: false,
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ headers, body: await bytesOf(init?.body), contentType: headers.get("content-type") });
      return answer();
    },
  });
  return { calls, client };
};

const parts = (raw: Buffer, contentType: string | null): { name: string; body: Buffer }[] => {
  const boundary = /boundary="?([^";]+)"?/.exec(contentType ?? "")?.[1];
  if (boundary === undefined) throw new Error(`no boundary in ${contentType}`);
  const marker = Buffer.from(`--${boundary}`);
  const out: { name: string; body: Buffer }[] = [];
  let start = raw.indexOf(marker);
  while (start >= 0) {
    const after = start + marker.length;
    if (raw.subarray(after, after + 2).toString() === "--") break;
    const next = raw.indexOf(marker, after);
    const chunk = raw.subarray(after, next < 0 ? raw.length : next);
    const sep = chunk.indexOf("\r\n\r\n");
    const head = chunk.subarray(0, sep).toString("utf8");
    let body = chunk.subarray(sep + 4);
    if (body.subarray(-2).toString() === "\r\n") body = body.subarray(0, -2);
    out.push({ name: /name="([^"]+)"/.exec(head)?.[1] ?? "", body });
    start = next;
  }
  return out;
};

const requestOf = (call: Call): unknown => {
  if (call.contentType?.startsWith("application/json") === true) return JSON.parse(call.body.toString("utf8"));
  const request = parts(call.body, call.contentType).find((part) => part.name === "request");
  if (request === undefined) throw new Error("multipart request had no JSON part");
  return JSON.parse(request.body.toString("utf8"));
};

const isRecord = (value: unknown): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

test("prepareJevImage accepts the documented pixel bounds and rejects the rest", () => {
  assert.deepEqual(prepareJevImage(asImage(png(280, 280), "image/png")), png(280, 280));
  assert.deepEqual(prepareJevImage(asImage(png(1568, 1568), "image/png")), png(1568, 1568));
  assert.deepEqual(prepareJevImage(asImage(jpeg(400, 300), "image/jpg")), jpeg(400, 300));
  assert.throws(() => prepareJevImage(asImage(png(279, 280), "image/png")), unsupported(/279×280/));
  assert.throws(() => prepareJevImage(asImage(jpeg(1569, 280), "image/jpeg")), unsupported(/1569×280/));
  assert.throws(() => prepareJevImage(asImage(png(128, 128), "image/png")), unsupported(/not resized/));
});

test("prepareJevImage rejects the formats and files Jev refuses", () => {
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.throws(() => prepareJevImage(asImage(webp, "image/webp")), unsupported(/not image\/webp/));
  assert.throws(() => prepareJevImage(asImage(jpeg(280, 280), "image/png")), unsupported(/bytes are image\/jpeg/));
  assert.throws(
    () => prepareJevImage(asImage(png(280, 280, [pngChunk("acTL", new Uint8Array(8))]), "image/png")),
    unsupported(/animated PNG/),
  );
  assert.throws(
    () => prepareJevImage({ type: "image", source: { kind: "base64", mediaType: "image/png", data: "@@@@" } }),
    unsupported(/base64/),
  );
});

test("a file over 16 MiB is rejected and one of exactly 16 MiB is accepted", () => {
  const target = JEV_IMAGE_LIMITS.maxFileBytes;
  const fit = target - png(280, 280).length - 12;
  const exact = png(280, 280, [pngChunk("zPAD", new Uint8Array(fit))]);
  assert.equal(exact.byteLength, target);
  assert.equal(prepareJevImage(asImage(exact, "image/png")).byteLength, target);
  const over = concat([exact, Uint8Array.from([0])]);
  assert.throws(() => prepareJevImage(asImage(over, "image/png")), unsupported(/16 MiB/));
});

test("the request budget is 32 MiB for every image in the request together", () => {
  const half = 16 * 1024 * 1024;
  assert.throws(() => assertJevRequestBudget(0, [half, half]), unsupported(/32 MiB/));
  assert.doesNotThrow(() => assertJevRequestBudget(100, [1024, 2048]));
});

test("images are off unless jev({ images: true }), and core enforces maxImages", async () => {
  const off = capture();
  const text = jev({ client: off.client });
  assert.equal(text.limits?.maxImages, undefined);
  await assert.rejects(
    () => createAsk({ backend: text }).is({ photo: image(png(280, 280)) }, "is a cat"),
    unsupported(/does not accept images/),
  );
  await assert.rejects(() => text.decide({ photo: dataUrl(png(280, 280)) }, yesno), unsupported(/images: true/));
  assert.equal(off.calls.length, 0);

  const on = capture();
  const vision = jev({ images: true, client: on.client });
  assert.equal(vision.limits?.maxImages, JEV_MAX_IMAGES);
  const many = Array.from({ length: JEV_MAX_IMAGES + 1 }, () => dataUrl(png(280, 280)));
  await assert.rejects(() => createAsk({ backend: vision }).is(many, "ok?"), unsupported(/at most 64 images per state/));
  await assert.rejects(() => vision.decide(many, yesno), unsupported(/at most 64 images per request/));
  assert.equal(on.calls.length, 0);
});

test("with images on, a PNG is an asset, the state keeps [image N], and the header is set", async () => {
  const { calls, client } = capture();
  const photo = png(280, 320);
  const backend = jev({ images: true, client, model: "jev-1.14.0" });
  await backend.decide(
    { note: "translated", photo: image(photo), other: { content_type: "text/plain", base64: "aGk=" } },
    yesno,
  );
  await backend.decide("no image here", yesno);

  const [withImage, textOnly] = calls;
  assert.ok(withImage && textOnly);
  assert.equal(withImage.headers.get("TypeSafe-Danger-Zone-Images"), "true");
  assert.equal(textOnly.headers.get("TypeSafe-Danger-Zone-Images"), null);

  const body = requestOf(withImage);
  assert.ok(isRecord(body));
  assert.deepEqual(body["state"], {
    note: "translated",
    photo: "[image 1]",
    other: { content_type: "text/plain", base64: "aGk=" },
  });
  const assets = body["assets"];
  assert.ok(isRecord(assets) && isRecord(assets["[image 1]"]));
  assert.equal(assets["[image 1]"]["part"], "asset-0");
  const file = parts(withImage.body, withImage.contentType).find((part) => part.name === "asset-0");
  assert.ok(file);
  assert.equal(file.body.equals(Buffer.from(photo)), true);

  const plain = requestOf(textOnly);
  assert.ok(isRecord(plain));
  assert.equal(plain["state"], "no image here");
  assert.equal("assets" in plain, false);
});

test("decideMany numbers images across packed states, then questions, as one list", async () => {
  const { calls, client } = capture();
  const backend = jev({ images: true, multiState: true, client });
  const { decideMany } = backend;
  if (decideMany === undefined) throw new Error("expected decideMany");
  const first = png(280, 280);
  const second = jpeg(300, 320);
  const note = (item: string): string =>
    `Answer only about items.${item}. Ignore every other item. "The state" means items.${item}.`;
  await decideMany([
    { id: "a", state: { photo: dataUrl(first) }, question: { kind: "yesno", instructions: "first" } },
    {
      id: "b",
      state: { photo: { content_type: "image/jpeg", base64: b64(second) } },
      question: {
        kind: "yesno",
        instructions: dataUrl(png(281, 281)),
        criteria: { true: "matches [image 1]", false: "no" },
      },
    },
  ]);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.headers.get("TypeSafe-Danger-Zone-Images"), "true");
  const body = requestOf(call);
  assert.ok(isRecord(body));
  const state = body["state"];
  assert.ok(isRecord(state) && isRecord(state["items"]));
  const items = state["items"];
  assert.ok(isRecord(items) && isRecord(items["i0"]) && isRecord(items["i1"]));
  assert.equal(items["i0"]["photo"], "[image 1]");
  assert.equal(items["i1"]["photo"], "[image 2]");
  const questions = body["questions"];
  assert.ok(isRecord(questions) && isRecord(questions["a"]) && isRecord(questions["b"]));
  assert.deepEqual(questions["a"]["instructions"], { about: "items.i0", note: note("i0"), question: "first" });
  assert.deepEqual(questions["b"]["instructions"], {
    about: "items.i1",
    note: note("i1"),
    question: "[image 3]",
  });
  const criteria = questions["b"]["criteria"];
  assert.ok(isRecord(criteria));
  assert.equal(criteria["true"], "matches [image 1]");
  assert.equal(criteria["false"], "no");
  const files = parts(call.body, call.contentType).filter((part) => part.name.startsWith("asset-"));
  assert.equal(files.length, 3);
  assert.equal(files[0]?.body.equals(Buffer.from(first)), true);
  assert.equal(files[1]?.body.equals(Buffer.from(second)), true);
});

test("a repeated state contributes its images once", async () => {
  const { calls, client } = capture();
  const backend = jev({ images: true, multiState: true, client });
  const { decideMany } = backend;
  if (decideMany === undefined) throw new Error("expected decideMany");
  const photo = dataUrl(png(280, 300));
  await decideMany([
    { id: "a", state: { photo }, question: { kind: "yesno", instructions: "a" } },
    { id: "b", state: { photo }, question: { kind: "yesno", instructions: "b" } },
  ]);
  const [call] = calls;
  assert.ok(call);
  const body = requestOf(call);
  assert.ok(isRecord(body));
  assert.deepEqual(body["state"], { photo: "[image 1]" });
  const files = parts(call.body, call.contentType).filter((part) => part.name.startsWith("asset-"));
  assert.equal(files.length, 1);
});

test("an unsupported image fails before any request", async () => {
  const { calls, client } = capture();
  const backend = jev({ images: true, client });
  await assert.rejects(
    () => backend.decide({ photo: "data:image/webp;base64,AAAA" }, yesno),
    unsupported(/not image\/webp/),
  );
  await assert.rejects(() => backend.decide({ photo: dataUrl(png(128, 128)) }, yesno), unsupported(/not resized/));
  assert.equal(calls.length, 0);
});
