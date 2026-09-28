// A closer look at ask.if. Runs offline, no API key needed: this uses the
// mock backend instead of a live model. Also runs as an integration test —
// see test/examples.test.ts.
//
// Run with: npx tsx examples/if.ts
import assert from "node:assert/strict";
import { createAsk, mock } from "../src/index.js";
import type { Question } from "../src/index.js";

const table: Record<string, number> = {
  "is animal": 0.97,
  "is a vehicle": 0.03,
  "is cute": 0.55, // lands inside the default unsure band, [0.2, 0.8]
  "is delivered": 0.9,
  "can fly": 0.05,
  "the customer is asking for a human agent": 0.82,
};

const backend = mock((question: Question) => {
  if (question.kind !== "yesno") throw new Error("unexpected question kind");
  const { instructions } = question;
  const condition =
    typeof instructions === "object" && instructions !== null && !Array.isArray(instructions)
      ? instructions["condition"]
      : undefined;
  const probability = typeof condition === "string" ? (table[condition] ?? 0.5) : 0.5;
  return { kind: "yesno", probability };
});

const ask = createAsk({ backend });

// Plain then/else.
const animalResult = await ask
  .if("cat", "is animal", () => console.log("cat is animal"))
  .else(() => console.log("cat is not animal"));
assert.equal(animalResult.branch, "then");
assert.equal(animalResult.probability, 0.97);

// then / else / unsure, on a support ticket.
const ticket = "I've asked three times and nobody has helped. Get me a real person.";
const ticketResult = await ask
  .if(ticket, "the customer is asking for a human agent", () => console.log("routed to a human agent"))
  .else(() => console.log("routed to the bot"))
  .unsure(() => console.log("sent for review"));
assert.equal(ticketResult.branch, "then");

// Without .unsure(), the threshold alone decides: 0.55 is above the default 0.5.
const cuteThresholdResult = await ask
  .if("cat", "is cute", () => console.log("cat is cute (threshold only)"))
  .else(() => console.log("cat is not cute"));
assert.equal(cuteThresholdResult.branch, "then");

// With .unsure(), probabilities inside unsureBand go to it instead of then/else.
const cuteUnsureResult = await ask
  .if("cat", "is cute", () => console.log("cat is cute"))
  .else(() => console.log("cat is not cute"))
  .unsure(() => console.log("not sure whether the cat is cute — 0.55 falls in [0.2, 0.8]"));
assert.equal(cuteUnsureResult.branch, "unsure");

// Per-call threshold override: a stricter bar for the same condition.
const cuteLenientResult = await ask.if("cat", "is cute", () => console.log("cute (default threshold)"), {
  threshold: 0.5,
});
assert.equal(cuteLenientResult.branch, "then");

const cuteStrictResult = await ask
  .if("cat", "is cute", () => console.log("cute (strict threshold)"), { threshold: 0.9 })
  .else(() => console.log("not cute enough (strict threshold)"));
assert.equal(cuteStrictResult.branch, "else");

// criteria: what counts as yes/no, for conditions with a fuzzy boundary.
const deliveredResult = await ask
  .if("order #4471", "is delivered", () => console.log("delivered"), {
    criteria: {
      true: "Tracking shows the package as delivered to the address",
      false: "Tracking shows in transit, delayed, or lost",
    },
  })
  .else(() => console.log("not delivered yet"));
assert.equal(deliveredResult.branch, "then");

// ask.is: a plain boolean, for use inside a regular `if`.
if (await ask.is("penguin", "can fly")) console.log("penguin can fly");
else console.log("penguin can't fly");

// ask.probability: the raw number, when you want to do your own thing with it.
const p = await ask.probability("penguin", "can fly"); // 0..1
console.log(`probability penguin can fly: ${p}`);
assert.equal(p, 0.05);

// Every call above was answered locally — nothing left the process.
console.log(`\n${backend.calls.length} batch(es) sent to the mock backend`);
assert.equal(backend.calls.length, 9);
