// Building a custom backend. Runs offline, no API key needed. Also runs as
// an integration test — see test/examples.test.ts.
//
// For the Jev/TypeSafe backend, see @askif/jev's own examples/backends.ts.
//
// Run with: npx tsx examples/backends.ts
import assert from "node:assert/strict";
import { createAsk, mock } from "../src/index.js";

// A backend is any object that answers yes/no, choice, and scale questions
// with probabilities. `mock` answers questions locally and records every call
// — handy for tests, or as a template for a real backend.
const backend = mock(() => ({ kind: "yesno", probability: 0.9 }));
const ask = createAsk({ backend });
await ask.is("cat", "is animal");
console.log(backend.calls); // what was asked
assert.equal(backend.calls.length, 1);
