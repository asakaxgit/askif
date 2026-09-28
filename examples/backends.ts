// Building instances against different backends. Runs offline, no API key
// needed: constructing a `typesafe()` backend never touches the network —
// only calling it does, and this file never calls one. Also runs as an
// integration test — see test/examples.test.ts.
//
// Run with: npx tsx examples/backends.ts
import assert from "node:assert/strict";
import { createAsk, mock, typesafe } from "../src/index.js";

// The default `ask` uses TypeSafe with jev-latest. Make your own instance for
// a different model or endpoint.
const ask = createAsk({ backend: typesafe({ model: "jev-1.13" }) });

// Through OpenRouter.
const viaOpenRouter = createAsk({
  backend: typesafe({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api" }),
});

// Neither instance made a network call yet — that only happens on first use.
assert.equal(typeof ask.if, "function");
assert.equal(typeof viaOpenRouter.if, "function");

// For tests, `mock` answers questions locally and records every call.
const backend = mock(() => ({ kind: "yesno", probability: 0.9 }));
const mockAsk = createAsk({ backend });
await mockAsk.is("cat", "is animal");
console.log(backend.calls); // what was asked
assert.equal(backend.calls.length, 1);
