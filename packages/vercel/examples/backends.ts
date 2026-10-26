// Building instances. Runs offline: constructing a backend never touches the
// network, and this file never calls one. Also runs as an integration test
// — see test/examples.test.ts.
//
// Run with: npx tsx examples/backends.ts
import assert from "node:assert/strict";
import { createAsk } from "askif";
import { vercel, vercelDecide } from "../src/index.js";

// HTTP POST /v1/evaluate. No `ai` package required.
const http = createAsk({
  backend: vercel({ model: "typesafe-ai/jev" }),
});

// AI SDK experimental_decide. Install `ai` before calling this one.
// Images stay off: typesafe-ai/jev accepts text and JSON only.
const sdk = createAsk({
  backend: vercelDecide({ model: "typesafe-ai/jev" }),
});

// A conditional fallback reruns the whole request on another model.
// askif's .unsure() is the in-process alternative: it does not make a second call.
const withFallback = createAsk({
  backend: vercel({
    fallback: {
      model: "openai/gpt-6-luna-decisions",
      when: { probabilityBetween: [0.4, 0.6] },
    },
  }),
});

assert.equal(typeof http.if, "function");
assert.equal(typeof sdk.if, "function");
assert.equal(typeof withFallback.if, "function");
