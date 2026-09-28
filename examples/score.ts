// A closer look at ask.score. Runs offline, no API key needed. Also runs as
// an integration test — see test/examples.test.ts.
//
// Run with: npx tsx examples/score.ts
import assert from "node:assert/strict";
import { createAsk, mock } from "../src/index.js";
import type { Question } from "../src/index.js";

// A mock backend that returns fixed per-level probabilities, in level order.
const scaleBackend = (probabilities: readonly number[]) =>
  mock((question: Question) => {
    if (question.kind !== "scale") throw new Error("unexpected question kind");
    return { kind: "scale", probabilities };
  });

const COSMETIC = "Cosmetic; no impact to functionality";
const WORKAROUND = "Broken or degraded feature, but workaround exists";
const BLOCKING = "Blocking issue; no workaround exists";

// Basic case: the handler for the most likely level runs.
const basicAsk = createAsk({ backend: scaleBackend([0, 0.57, 0.43]) });
const basicResult = await basicAsk
  .score("The export button crashes the settings page in Safari. Works in Chrome.", "How severe?")
  .level(COSMETIC, () => console.log("→ backlog"))
  .level(WORKAROUND, () => console.log("→ this sprint"))
  .level(BLOCKING, () => console.log("→ page on-call"));

console.log("level:", basicResult.level);
console.log("score (probability-weighted position):", basicResult.score);
console.log("normalized (0..1):", basicResult.normalized);
assert.equal(basicResult.level, WORKAROUND);
assert.ok(Math.abs(basicResult.score - 1.43) < 1e-9);
assert.ok(Math.abs(basicResult.normalized - 0.715) < 1e-9);

// A result carries what happened, and can be read after the chain resolves.
const resultAsk = createAsk({ backend: scaleBackend([0.3, 0.7]) });
const bug = "Cannot save changes to the profile page.";
const r = await resultAsk.score(bug, "How severe?").level("low").level("high");
console.log(r.level, r.branch, r.confidence);
assert.equal(r.level, "high");
assert.equal(r.branch, "level");

// The handler is chosen by the most likely level, never the rounded score.
// A 50/50 split between the two ends must not run the empty middle level.
const splitAsk = createAsk({ backend: scaleBackend([0.5, 0, 0.5]) });
const splitResult = await splitAsk
  .score("?", "How severe?")
  .level(COSMETIC, () => console.log("→ backlog"))
  .level(WORKAROUND, () => console.log("→ this sprint (should not print)"))
  .level(BLOCKING, () => console.log("→ page on-call"));
console.log("level (never workaround, despite score === 1):", splitResult.level, "score:", splitResult.score);
assert.equal(splitResult.score, 1);
assert.notEqual(splitResult.level, WORKAROUND);

// .unsure(): runs when confidence is below minConfidence.
const unsureAsk = createAsk({ backend: scaleBackend([0.34, 0.33, 0.33]) });
const unsureResult = await unsureAsk
  .score("?", "How severe?")
  .level(COSMETIC, () => console.log("→ backlog"))
  .level(WORKAROUND, () => console.log("→ this sprint"))
  .level(BLOCKING, () => console.log("→ page on-call"))
  .unsure(() => console.log("→ needs a human look"));
assert.equal(unsureResult.branch, "unsure");

// Long descriptions can get a short key, and a description can be structured,
// reusing the same COSMETIC / WORKAROUND / BLOCKING descriptions as above.
const structuredAsk = createAsk({ backend: scaleBackend([0, 0, 1]) });
const structuredResult = await structuredAsk
  .score("Cannot log in at all", "How severe?")
  .level("cosmetic", COSMETIC)
  .level("workaround", { what: WORKAROUND, examples: ["export fails in one browser but works in another"] })
  .level("blocking", BLOCKING);
assert.equal(structuredResult.level, "blocking");
assert.equal(structuredResult.index, 2);
