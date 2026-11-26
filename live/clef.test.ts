// Live calls to Cloudflare Workers AI Clef. Skipped unless both Cloudflare variables are set.
// Offline UNSUPPORTED_INPUT guards always run and do not touch the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, image } from "../packages/askif/src/index.js";
import { clef } from "../packages/clef/src/index.js";
import { withDpiExif } from "./exif.js";
import { assertClearDecisions } from "./decisions.js";
import {
  NETWORK_TIMEOUT_MS,
  YES,
  assertAskError,
  assertProbability,
  assertUnsupported,
  fixtureBytes,
  onlyCall,
  recordingFetch,
  skipWithout,
} from "./support.js";
import type { SeenRequest } from "./support.js";

const live = {
  skip: skipWithout("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"),
  timeout: NETWORK_TIMEOUT_MS,
};

const endsWithModel = (url: string, model: "clef" | "clef-flash"): boolean =>
  new URL(url).pathname.endsWith(`/ai/run/@cf/cloudflare/${model}`);

test("@askif/clef: ask.if, ask.switch, ask.score, and ask.probability share one request", live, async () => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({ backend: clef({ model: "clef-flash", fetch: recordingFetch(seen) }) });
  await assertClearDecisions(ask);
  const call = onlyCall(seen);
  assert.equal(new URL(call.url).origin, "https://api.cloudflare.com");
  assert.ok(endsWithModel(call.url, "clef-flash"));
  assert.equal(call.contentType, "application/json");
});

test("@askif/clef: a PNG image answers through clef-flash", live, async () => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({ backend: clef({ model: "clef-flash", fetch: recordingFetch(seen) }) });
  const shape = await ask
    .switch({ photo: image(fixtureBytes("images/red-circle.png")) }, "What shape is drawn?")
    .case("circle", "A round disk")
    .case("square", "A square")
    .case("triangle", "A triangle");
  assert.equal(shape.branch, "case");
  assert.equal(shape.choice, "circle");
  const top = shape.ranking[0];
  assert.ok(top !== undefined);
  assertProbability(top.probability, "clef image");
  assert.ok(top.probability >= YES, `circle probability ${top.probability} is below ${YES}`);
  const call = onlyCall(seen);
  assert.ok(endsWithModel(call.url, "clef-flash"));
  assert.equal(call.contentType, "application/json");
});

// The reported failure was HTTP 413 on `clef` (65,536-token window) for a small JPEG that
// carried EXIF and 250 DPI. bicycle.jpg is the closest fixture (720×600, no EXIF); the DPI
// segment is added in memory. The first test sends it untouched (`imageMetadata: "keep"`), so
// either the historical 413 or a real probability is a result. The second uses the default
// "retry", which resends without metadata after a 413. Any other error fails the test.
// The diagnostics say which one happened.
const probe = (): ReturnType<typeof image> => image(withDpiExif(fixtureBytes("public-domain/bicycle.jpg"), 250));

test("@askif/clef: HTTP 413 probe, 720px JPEG with 250 DPI EXIF, model clef", live, async (t) => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({ backend: clef({ model: "clef", imageMetadata: "keep", fetch: recordingFetch(seen) }) });
  try {
    const probability = await ask.probability({ photo: probe() }, "shows a bicycle");
    assertProbability(probability, "413 probe");
    const call = onlyCall(seen);
    assert.ok(endsWithModel(call.url, "clef"));
    t.diagnostic(
      `Clef accepted the 250 DPI JPEG (probability ${probability.toFixed(3)}). HTTP 413 was not reproduced.`,
    );
  } catch (error) {
    const askError = assertAskError(error);
    assert.equal(askError.code, "BACKEND_FAILED");
    assert.match(askError.message, /HTTP 413/);
    const call = onlyCall(seen);
    assert.ok(endsWithModel(call.url, "clef"));
    t.diagnostic(`Clef refused the 250 DPI JPEG with HTTP 413: ${askError.message}`);
  }
});

test("@askif/clef: the 413 retry without JPEG metadata, model clef", live, async (t) => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({ backend: clef({ model: "clef", fetch: recordingFetch(seen) }) });
  try {
    const probability = await ask.probability({ photo: probe() }, "shows a bicycle");
    assertProbability(probability, "413 retry");
    assert.ok(seen.length === 1 || seen.length === 2, `${seen.length} requests`);
    t.diagnostic(
      seen.length === 2
        ? `HTTP 413, then the retry without metadata answered (probability ${probability.toFixed(3)}).`
        : `Answered on the first request (probability ${probability.toFixed(3)}); no retry was needed.`,
    );
  } catch (error) {
    const askError = assertAskError(error);
    assert.equal(askError.code, "BACKEND_FAILED");
    assert.match(askError.message, /HTTP 413/);
    assert.equal(seen.length, 2);
    t.diagnostic(`HTTP 413 even without metadata, so metadata is not the cause: ${askError.message}`);
  }
});

test("@askif/clef: a GIF is UNSUPPORTED_INPUT", async () => {
  const gif = image(Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0));
  const backend = clef({
    fetch: async () => {
      throw new Error("GIF was supposed to be rejected before any request");
    },
  });
  await assert.rejects(
    () => backend.decide({ photo: gif }, { q: { kind: "yesno", instructions: "shows a picture" } }),
    (error) => assertUnsupported(error, /image\/gif/),
  );
});

test("@askif/clef: five images are UNSUPPORTED_INPUT", async () => {
  const photo = image(fixtureBytes("images/red-circle.png"));
  const ask = createAsk({
    backend: clef({
      fetch: async () => {
        throw new Error("too many images were supposed to be rejected before any request");
      },
    }),
  });
  await assert.rejects(
    () => ask.is([photo, photo, photo, photo, photo], "shows a red circle"),
    (error) => assertUnsupported(error, /at most 4 images per state, got 5/),
  );
});
