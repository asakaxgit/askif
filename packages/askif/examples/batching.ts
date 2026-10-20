// Same-tick calls share a request: one state always, several states when the backend opts in.
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

// A backend without multi-state support keeps each state in its own call.
const otherOrder = { id: "A-2", country: "US" };
await Promise.all([ask.if(order, "looks fraudulent", () => {}), ask.if(otherOrder, "looks fraudulent", () => {})]);
console.log(`\n${backend.calls.length} call(s) sent in total — this backend keeps each state in its own call`);
assert.equal(backend.calls.length, 3);

// A backend that opts in (`multiState`) gets every state from the tick in one call.
// The questions still name the original state; the backend decides how to pack them.
const cross = mock(answer, undefined, { multiState: true });
const crossAsk = createAsk({ backend: cross });
const tweetA = { id: "1", text: "hello" };
const tweetB = { id: "2", text: "goodbye" };
await Promise.all([
  crossAsk.if(tweetA, "is a greeting", () => {}),
  crossAsk.score(tweetB, "How warm?").level("cold").level("warm"),
]);
console.log(`\n${cross.manyCalls.length} cross-state call(s), ${cross.manyCalls[0]?.length ?? 0} item(s)`);
assert.equal(cross.calls.length, 0);
assert.equal(cross.manyCalls.length, 1);
assert.deepEqual(
  cross.manyCalls[0]?.map((item) => item.state),
  [tweetA, tweetB],
);
