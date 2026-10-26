// Live calls to TypeSafe's Jev. Skipped unless TYPESAFE_API_KEY is set.
// Offline guards (UNSUPPORTED_INPUT, fixture limits) always run and do not touch the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, image } from "../packages/askif/src/index.js";
import type { Question } from "../packages/askif/src/index.js";
import { jev } from "../packages/jev/src/index.js";
import { prepareJevImage } from "../packages/jev/src/images.js";
import { CAT, assertClearDecisions } from "./decisions.js";
import {
  NETWORK_TIMEOUT_MS,
  NO,
  YES,
  assertProbability,
  assertUnsupported,
  fixtureBytes,
  onlyCall,
  recordingFetch,
  skipWithout,
} from "./support.js";
import type { SeenRequest } from "./support.js";

const live = { skip: skipWithout("TYPESAFE_API_KEY"), timeout: NETWORK_TIMEOUT_MS };

const YESNO = { q: { kind: "yesno", instructions: "shows a red circle" } } as const satisfies {
  readonly q: Question;
};

/** The SDK reads TYPESAFE_API_KEY. baseURL is pinned so TYPESAFE_BASE_URL cannot redirect the run. */
const transport = {
  baseURL: "https://api.typesafe.ai",
  timeout: 45_000,
  retry: { maxRetries: 0 },
} as const;

const refusingFetch = async (): Promise<Response> => {
  throw new Error("this guard was supposed to reject before any request");
};

test("@askif/jev: ask.if, ask.switch, ask.score, and ask.probability share one request", live, async () => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({ backend: jev({ ...transport, fetch: recordingFetch(seen) }) });
  await assertClearDecisions(ask);
  const call = onlyCall(seen);
  assert.equal(new URL(call.url).origin, "https://api.typesafe.ai");
  assert.equal(new URL(call.url).pathname, "/v1/systemone");
  assert.equal(call.contentType, "application/json");
  assert.equal(call.dangerZone, null);
});

test("@askif/jev: multiState packs two states into one systemOne request", live, async () => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({ backend: jev({ ...transport, multiState: true, fetch: recordingFetch(seen) }) });
  const [cat, hammer] = await Promise.all([
    ask.probability(CAT, "is a living animal"),
    ask.probability("A claw hammer with a metal head and a wooden handle.", "is a living animal"),
  ]);
  assertProbability(cat, "multiState cat");
  assertProbability(hammer, "multiState hammer");
  assert.ok(cat >= YES, `cat probability ${cat} is below ${YES}`);
  assert.ok(hammer <= NO, `hammer probability ${hammer} is above ${NO}`);
  const call = onlyCall(seen);
  assert.equal(new URL(call.url).pathname, "/v1/systemone");
  assert.equal(call.contentType, "application/json");
  assert.equal(call.dangerZone, null);
});

test("@askif/jev: a JPEG image is multipart and sends TypeSafe-Danger-Zone-Images", live, async () => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({ backend: jev({ ...transport, images: true, fetch: recordingFetch(seen) }) });
  const photo = image(fixtureBytes("public-domain/dog.jpg"));
  const [dog, bicycle] = await Promise.all([
    ask.probability({ photo }, "shows a dog"),
    ask.probability({ photo }, "shows a bicycle"),
  ]);
  assertProbability(dog, "dog");
  assertProbability(bicycle, "bicycle");
  assert.ok(dog >= YES, `dog probability ${dog} is below ${YES}`);
  assert.ok(bicycle <= NO, `bicycle probability ${bicycle} is above ${NO}`);
  const call = onlyCall(seen);
  assert.equal(new URL(call.url).pathname, "/v1/systemone");
  assert.match(call.contentType ?? "", /^multipart\/form-data;/);
  assert.equal(call.dangerZone, "true");
});

test("@askif/jev: public-domain/dog.jpg is inside Jev's image limits", () => {
  const bytes = prepareJevImage(image(fixtureBytes("public-domain/dog.jpg")));
  assert.equal(bytes.byteLength, fixtureBytes("public-domain/dog.jpg").byteLength);
});

test("@askif/jev: images are UNSUPPORTED_INPUT until images: true", async () => {
  const ask = createAsk({ backend: jev({ fetch: refusingFetch }) });
  await assert.rejects(
    () => ask.is({ photo: image(fixtureBytes("images/red-circle.png")) }, "shows a red circle"),
    (error) => assertUnsupported(error, /does not accept images/),
  );
});

test("@askif/jev: WebP is UNSUPPORTED_INPUT when images are on", async () => {
  const backend = jev({ images: true, fetch: refusingFetch });
  await assert.rejects(
    () => backend.decide({ photo: image(fixtureBytes("images/green-triangle.webp")) }, YESNO),
    (error) => assertUnsupported(error, /image\/webp/),
  );
});

test("@askif/jev: a 128px image is UNSUPPORTED_INPUT (below 280px)", async () => {
  const backend = jev({ images: true, fetch: refusingFetch });
  await assert.rejects(
    () => backend.decide({ photo: image(fixtureBytes("images/red-circle.png")) }, YESNO),
    (error) => assertUnsupported(error, /128×128/),
  );
});
