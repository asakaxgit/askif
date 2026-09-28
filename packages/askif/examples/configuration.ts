// Configuring defaults instance-wide, and overriding them per call. Runs
// offline, no API key needed. Also runs as an integration test — see
// test/examples.test.ts.
//
// Run with: npx tsx examples/configuration.ts
import assert from "node:assert/strict";
import { createAsk, mock } from "../src/index.js";
import type { Question } from "../src/index.js";

const backend = mock((question: Question) => {
  if (question.kind !== "yesno") throw new Error("unexpected question kind");
  return { kind: "yesno", probability: 0.62 };
});

const ask = createAsk({ backend });

// Default threshold (0.5): 0.62 counts as true.
const defaultResult = await ask.is("message", "is spam");
console.log("default threshold:", defaultResult);
assert.equal(defaultResult, true);

// Instance-wide: change defaults for every call made through `ask`.
ask.configure({ threshold: 0.6, minConfidence: 0.4 });

// Per-call: override the instance default just for this one call.
const state = "Buy now, 90% off, click this link!!!";
const onSpam = () => console.log("flagged as spam");
await ask.if(state, "is spam", onSpam, { threshold: 0.9 }); // per call

// A stricter instance, built once and reused, is often clearer than
// per-call overrides sprinkled through the code.
const strict = createAsk({ backend, threshold: 0.9, minConfidence: 0.7 });
const strictResult = await strict.is("message", "is spam");
console.log("separate stricter instance:", strictResult);
assert.equal(strictResult, false);
