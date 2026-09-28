// A closer look at ask.switch. Runs offline, no API key needed. Also runs as
// an integration test — see test/examples.test.ts.
//
// Run with: npx tsx examples/switch.ts
import assert from "node:assert/strict";
import { createAsk, mock } from "../src/index.js";
import type { Question } from "../src/index.js";

// A mock backend that returns fixed probabilities per option key, so the
// example is deterministic. A real backend would read the ticket text.
const choiceBackend = (probabilities: Record<string, number>, confidence?: number) =>
  mock((question: Question) => {
    if (question.kind !== "choice") throw new Error("unexpected question kind");
    return { kind: "choice", probabilities, ...(confidence === undefined ? {} : { confidence }) };
  });

const ticket = "Shoes arrived in the wrong size. Also I was charged twice.";

// Basic case: the most likely option's handler runs. The chain resolves to a
// typed result: `choice` is narrowed to the declared keys.
const basicAsk = createAsk({ backend: choiceBackend({ returns: 0.61, billing: 0.35, shipping: 0.04 }) });
const team = await basicAsk
  .switch(ticket, "Which team should handle this?")
  .case("returns", "Exchanges, wrong or damaged items", () => console.log("→ returns team"))
  .case("shipping", "Delivery status, delays, lost packages", () => console.log("→ shipping team"))
  .case("billing", "Charges, invoices, payment problems", () => console.log("→ billing team"));

console.log("choice:", team.choice); // "returns" | "shipping" | "billing"
console.log("ranking:", team.ranking); // every option, most likely first
assert.equal(team.choice, "returns");
assert.equal(team.branch, "case");
assert.deepEqual(
  team.ranking.map((r) => r.key),
  ["returns", "billing", "shipping"],
);

// .other(): an escape hatch the model can pick when nothing else fits.
const otherAsk = createAsk({ backend: choiceBackend({ returns: 0.1, shipping: 0.05, other: 0.85 }) });
const otherResult = await otherAsk
  .switch("Do you sell gift cards?", "Which team should handle this?")
  .case("returns")
  .case("shipping")
  .other(() => console.log("→ no matching team, routed to general support"));
assert.equal(otherResult.choice, "other");

// .unsure(): runs when confidence is below minConfidence, regardless of which
// option is most likely.
const unsureAsk = createAsk({
  backend: choiceBackend({ returns: 0.36, billing: 0.34, shipping: 0.3 }, 0.15),
});
const unsureResult = await unsureAsk
  .switch(ticket, "Which team should handle this?")
  .case("returns", () => console.log("→ returns"))
  .case("billing", () => console.log("→ billing"))
  .case("shipping", () => console.log("→ shipping"))
  .unsure(() => console.log("→ too close to call, routed to a human for triage"));
assert.equal(unsureResult.branch, "unsure");

// A key that explains itself needs no description.
const toneAsk = createAsk({ backend: choiceBackend({ calm: 0.9, angry: 0.1 }) });
const tone = await toneAsk
  .switch("Thanks so much for the quick fix!", "What tone is this message?")
  .case("calm")
  .case("angry");
assert.equal(tone.choice, "calm");
