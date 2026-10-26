// Live calls to Vercel AI Gateway. Skipped unless AI_GATEWAY_API_KEY is set.
// Offline guards always run and do not touch the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, image } from "../packages/askif/src/index.js";
import { vercel, vercelDecide } from "../packages/vercel/src/index.js";
import { assertClearDecisions } from "./decisions.js";
import { NETWORK_TIMEOUT_MS, assertUnsupported, fixtureBytes, onlyCall, recordingFetch, requiredEnv, skipWithout } from "./support.js";
import type { SeenRequest } from "./support.js";

const live = { skip: skipWithout("AI_GATEWAY_API_KEY"), timeout: NETWORK_TIMEOUT_MS };

const refusingFetch = async (): Promise<Response> => {
  throw new Error("this guard was supposed to reject before any request");
};

test("@askif/vercel: ask.if, ask.switch, ask.score, and ask.probability share one POST /v1/evaluate", live, async () => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({
    backend: vercel({
      apiKey: requiredEnv("AI_GATEWAY_API_KEY"),
      fetch: recordingFetch(seen),
      timeout: 45_000,
    }),
  });
  await assertClearDecisions(ask);
  const call = onlyCall(seen);
  assert.equal(new URL(call.url).origin, "https://ai-gateway.vercel.sh");
  assert.equal(new URL(call.url).pathname, "/v1/evaluate");
  assert.equal(call.contentType, "application/json");
});

test("@askif/vercel: vercelDecide sends one AI SDK decision-model request", live, async () => {
  const seen: SeenRequest[] = [];
  const ask = createAsk({
    backend: vercelDecide({
      apiKey: requiredEnv("AI_GATEWAY_API_KEY"),
      fetch: recordingFetch(seen),
      timeout: 45_000,
      maxRetries: 0,
    }),
  });
  await assertClearDecisions(ask);
  const call = onlyCall(seen);
  const url = new URL(call.url);
  assert.equal(url.hostname, "ai-gateway.vercel.sh");
  assert.match(url.pathname, /\/decision-model$/);
});

test("@askif/vercel: images are UNSUPPORTED_INPUT on POST /v1/evaluate", async () => {
  const ask = createAsk({ backend: vercel({ apiKey: "unused", fetch: refusingFetch }) });
  await assert.rejects(
    () => ask.is({ photo: image(fixtureBytes("images/red-circle.png")) }, "shows a red circle"),
    (error) => assertUnsupported(error, /does not accept images/),
  );
});

test("@askif/vercel: vercelDecide rejects images until images is true", async () => {
  const backend = vercelDecide({ apiKey: "unused", fetch: refusingFetch });
  await assert.rejects(
    () => backend.decide({ photo: image(fixtureBytes("images/red-circle.png")) }, { q: { kind: "yesno", instructions: "shows a red circle" } }),
    (error) => assertUnsupported(error, /images is true/),
  );
});
