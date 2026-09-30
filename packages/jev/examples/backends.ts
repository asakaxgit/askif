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

// Against an OpenJev server (https://github.com/razorback16/openjev), an open,
// Jev-compatible System One server: same wire API, so only `baseURL` and
// `model` change. Use https://api.codiv.ai for its hosted version, or your own
// server's address. OpenJev's model ids are its own (jev-latest is an alias).
const viaOpenJev = createAsk({
  backend: jev({
    apiKey: process.env.OPENJEV_API_KEY ?? "unused-by-a-local-server",
    baseURL: process.env.OPENJEV_BASE_URL ?? "http://127.0.0.1:8080",
    model: "openjev-latest",
  }),
});

// None of these instances made a network call yet — that only happens on first use.
assert.equal(typeof custom.if, "function");
assert.equal(typeof viaOpenRouter.if, "function");
assert.equal(typeof viaOpenJev.if, "function");
