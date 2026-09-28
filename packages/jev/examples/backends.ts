// Building instances against different Jev/TypeSafe configurations. Runs
// offline, no API key needed: constructing a `jev()` backend never touches
// the network — only calling it does, and this file never calls one. Also
// runs as an integration test — see test/jev.test.ts's sibling suite.
//
// Run with: npx tsx examples/backends.ts
import assert from "node:assert/strict";
import { createAsk } from "askif";
import { jev } from "../src/index.js";

// The default `ask` uses jev-latest. Make your own instance for a different
// model or endpoint.
const custom = createAsk({ backend: jev({ model: "jev-1.13" }) });

// Through OpenRouter.
const viaOpenRouter = createAsk({
  backend: jev({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api" }),
});

// Neither instance made a network call yet — that only happens on first use.
assert.equal(typeof custom.if, "function");
assert.equal(typeof viaOpenRouter.if, "function");
