// Live calls to OpenAI. Skipped unless OPENAI_API_KEY is set.
// The local-server test is skipped unless OLLAMA_BASE_URL and OLLAMA_MODEL are set
// (any OpenAI-compatible server works, e.g. http://localhost:11434/v1 and llama3.3).
// The image/tiff guard always runs, with a stand-in key, and does not touch the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, image } from "../packages/askif/src/index.js";
import { openai } from "../packages/openai/src/index.js";
import { assertClearDecisions } from "./decisions.js";
import {
  NETWORK_TIMEOUT_MS,
  YES,
  assertProbability,
  assertUnsupported,
  fixtureBytes,
  requiredEnv,
  skipWithout,
} from "./support.js";

const live = { skip: skipWithout("OPENAI_API_KEY"), timeout: NETWORK_TIMEOUT_MS };

test("@askif/openai: ask.if, ask.switch, ask.score, and ask.probability", live, async () => {
  const ask = createAsk({ backend: openai({ timeout: 45_000, maxRetries: 0 }) });
  await assertClearDecisions(ask);
});

for (const structuredOutput of ["prompt", "json_object"] as const) {
  test(`@askif/openai: structuredOutput "${structuredOutput}" answers all four ask methods`, live, async () => {
    const ask = createAsk({ backend: openai({ structuredOutput, timeout: 45_000, maxRetries: 0 }) });
    await assertClearDecisions(ask);
  });
}

const local = { skip: skipWithout("OLLAMA_BASE_URL", "OLLAMA_MODEL"), timeout: NETWORK_TIMEOUT_MS };

test('@askif/openai: structuredOutput "prompt" on a local OpenAI-compatible server', local, async () => {
  const ask = createAsk({
    backend: openai({
      apiKey: "ollama",
      baseURL: requiredEnv("OLLAMA_BASE_URL"),
      model: requiredEnv("OLLAMA_MODEL"),
      structuredOutput: "prompt",
      timeout: 110_000,
      maxRetries: 0,
    }),
  });
  await assertClearDecisions(ask);
});

test("@askif/openai: a PNG image returns a typed choice", live, async () => {
  const ask = createAsk({ backend: openai({ timeout: 45_000, maxRetries: 0 }) });
  const shape = await ask
    .switch({ photo: image(fixtureBytes("images/red-circle.png")) }, "What shape is drawn?")
    .case("circle", "A round disk")
    .case("square", "A square")
    .case("triangle", "A triangle");
  assert.equal(shape.branch, "case");
  assert.equal(shape.choice, "circle");
  const top = shape.ranking[0];
  assert.ok(top !== undefined);
  assertProbability(top.probability, "openai image");
  assert.ok(top.probability >= YES, `circle probability ${top.probability} is below ${YES}`);
});

test("@askif/openai: image/tiff is UNSUPPORTED_INPUT", async () => {
  let calls = 0;
  const backend = openai({
    apiKey: "unused",
    fetch: async () => {
      calls += 1;
      throw new Error("TIFF was supposed to be rejected before any request");
    },
  });
  await assert.rejects(
    () => backend.decide(image(Uint8Array.of(0x49, 0x49, 0x2a, 0x00), "image/tiff"), {
      q: { kind: "yesno", instructions: "shows a picture" },
    }),
    (error) => assertUnsupported(error, /image\/tiff/),
  );
  assert.equal(calls, 0);
});
