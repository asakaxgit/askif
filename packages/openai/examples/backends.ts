// Building instances against different OpenAI configurations. Runs offline,
// no API key needed: constructing an `openai()` backend never touches the
// network — only calling it does, and this file never calls one. Also runs
// as an integration test — see test/examples.test.ts.
//
// Run with: npx tsx examples/backends.ts
import assert from "node:assert/strict";
import { createAsk } from "askif";
import { openai } from "../src/index.js";

// The default `ask` uses gpt-6-luna. Make your own instance for a different
// model or endpoint.
const custom = createAsk({ backend: openai({ model: "gpt-6-sol" }) });

// Through OpenRouter, or any other OpenAI-compatible API.
const viaOpenRouter = createAsk({
  backend: openai({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    model: "openai/gpt-6-luna",
  }),
});

// Neither instance made a network call yet — that only happens on first use.
assert.equal(typeof custom.if, "function");
assert.equal(typeof viaOpenRouter.if, "function");
