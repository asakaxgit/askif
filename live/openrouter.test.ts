// Live Jev calls through OpenRouter's System One API (POST /api/v1/systemone).
// Skipped unless OPENROUTER_API_KEY is set. The SDK reads TYPESAFE_API_KEY, not this name,
// so the key is passed as `apiKey` and baseURL is https://openrouter.ai/api.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, image } from "../packages/askif/src/index.js";
import type { Question } from "../packages/askif/src/index.js";
import { jev } from "../packages/jev/src/index.js";
import { assertClearDecisions } from "./decisions.js";
import {
  NETWORK_TIMEOUT_MS,
  NO,
  YES,
  assertProbability,
  assertUnsupported,
  fixtureBytes,
  onlyCall,
  recordingFetch,
  requiredEnv,
  skipWithout,
} from "./support.js";
import type { SeenRequest } from "./support.js";

const live = { skip: skipWithout("OPENROUTER_API_KEY"), timeout: NETWORK_TIMEOUT_MS };

const YESNO = { q: { kind: "yesno", instructions: "shows green" } } as const satisfies {
  readonly q: Question;
};

const openrouter = (images: boolean, seen: SeenRequest[]) =>
  jev({
    apiKey: requiredEnv("OPENROUTER_API_KEY"),
    baseURL: "https://openrouter.ai/api",
    model: "jev-1.14",
    images,
    timeout: 45_000,
    retry: { maxRetries: 0 },
    fetch: recordingFetch(seen),
  });

const assertOpenRouter = (url: string): void => {
  assert.equal(new URL(url).origin, "https://openrouter.ai");
  assert.equal(new URL(url).pathname, "/api/v1/systemone");
};

test("@askif/jev via OpenRouter: ask.if, ask.switch, ask.score, and ask.probability", live, async () => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({ backend: openrouter(false, seen) });
  await assertClearDecisions(ask);
  const call = onlyCall(seen);
  assertOpenRouter(call.url);
  assert.equal(call.contentType, "application/json");
  assert.equal(call.dangerZone, null);
});

test("@askif/jev via OpenRouter: image input is multipart with TypeSafe-Danger-Zone-Images", live, async () => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({ backend: openrouter(true, seen) });
  const photo = image(fixtureBytes("public-domain/dog.jpg"));
  const [dog, bicycle] = await Promise.all([
    ask.probability({ photo }, "shows a dog"),
    ask.probability({ photo }, "shows a bicycle"),
  ]);
  assertProbability(dog, "openrouter dog");
  assertProbability(bicycle, "openrouter bicycle");
  assert.ok(dog >= YES, `dog probability ${dog} is below ${YES}`);
  assert.ok(bicycle <= NO, `bicycle probability ${bicycle} is above ${NO}`);
  const call = onlyCall(seen);
  assertOpenRouter(call.url);
  assert.match(call.contentType ?? "", /^multipart\/form-data;/);
  assert.equal(call.dangerZone, "true");
});

test("@askif/jev via OpenRouter: images off and WebP are UNSUPPORTED_INPUT", async () => {
  const ask = createAsk({
    backend: jev({
      apiKey: "unused",
      baseURL: "https://openrouter.ai/api",
      fetch: async () => {
        throw new Error("images-off was supposed to reject before any request");
      },
    }),
  });
  await assert.rejects(
    () => ask.is({ photo: image(fixtureBytes("images/red-circle.png")) }, "shows a red circle"),
    (error) => assertUnsupported(error, /does not accept images/),
  );

  const backend = jev({
    apiKey: "unused",
    baseURL: "https://openrouter.ai/api",
    images: true,
    fetch: async () => {
      throw new Error("WebP was supposed to be rejected before any request");
    },
  });
  await assert.rejects(
    () => backend.decide({ photo: image(fixtureBytes("images/green-triangle.webp")) }, YESNO),
    (error) => assertUnsupported(error, /image\/webp/),
  );
});
