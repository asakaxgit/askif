// Calls about the same state, made in the same tick, go out as one request.
// Runs offline, no API key needed. Also runs as an integration test — see
// test/examples.test.ts.
//
// Run with: npx tsx examples/batching.ts
import assert from "node:assert/strict";
import { createAsk, mock } from "../src/index.js";
import type { Answer, Question } from "../src/index.js";

const answer = (question: Question): Answer => {
  switch (question.kind) {
    case "yesno":
      return { kind: "yesno", probability: 0.8 };
    case "choice":
      return { kind: "choice", probabilities: { standard: 0.3, express: 0.7 } };
    case "scale":
      return { kind: "scale", probabilities: question.levels.map(() => 1 / question.levels.length) };
  }
};

const backend = mock(answer);
const ask = createAsk({ backend });

const order = { id: "A-1", country: "DE" };
const flag = () => console.log("flag for review");
const addCustoms = () => console.log("add customs form");

await Promise.all([
  ask.if(order, "looks fraudulent", flag),
  ask.if(order, "ships internationally", addCustoms),
  ask.score(order, "How urgent is delivery?").level("standard").level("express"),
]); // one request

// Three questions about `order`, asked in the same tick, above — but only one
// call reached the backend.
console.log(`\n${backend.calls.length} call(s) sent`);
console.log(`${Object.keys(backend.calls[0]?.questions ?? {}).length} question(s) in that call`);
assert.equal(backend.calls.length, 1);
assert.equal(Object.keys(backend.calls[0]?.questions ?? {}).length, 3);

// A different state starts its own batch.
const otherOrder = { id: "A-2", country: "US" };
await Promise.all([ask.if(order, "looks fraudulent", () => {}), ask.if(otherOrder, "looks fraudulent", () => {})]);
console.log(`\n${backend.calls.length} call(s) sent in total — different states never share a batch`);
assert.equal(backend.calls.length, 3);
