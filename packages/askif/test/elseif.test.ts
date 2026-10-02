import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, isAskError } from "../src/index.js";
import { tableBackend } from "./helpers.js";

const table = { A: 0.05, B: 0.95, C: 0.9, U: 0.5, no: 0.01, borderline: 0.6 };

const setup = () => {
  const backend = tableBackend({ yesno: table });
  const log: string[] = [];
  return { backend, ask: createAsk({ backend }), log };
};

test("the first true branch wins, even when a later one is also true", async () => {
  const { ask, log } = setup();
  const result = await ask
    .if("x", "A", () => log.push("A"))
    .elseif("B", () => log.push("B"))
    .elseif("C", () => log.push("C"))
    .else(() => log.push("else"));
  assert.deepEqual(log, ["B"]);
  assert.ok(result.branch === "elseif");
  assert.equal(result.index, 1);
  assert.equal(result.condition, "B");
  assert.equal(result.probability, 0.95);
  assert.deepEqual(result.unsureIndexes, []);
  assert.deepEqual(result.probabilities, [0.05, 0.95, 0.9]);
});

test("a winning if reports branch 'then' at index 0", async () => {
  const { ask } = setup();
  const result = await ask.if("x", "B").elseif("C");
  assert.ok(result.branch === "then");
  assert.equal(result.index, 0);
  assert.equal(result.condition, "B");
});

test("falls through to else when nothing holds, and reports every probability", async () => {
  const { ask, log } = setup();
  const result = await ask
    .if("x", "A", () => log.push("A"))
    .elseif("no", () => log.push("no"))
    .else(() => log.push("else"));
  assert.deepEqual(log, ["else"]);
  assert.equal(result.branch, "else");
  assert.deepEqual(result.probabilities, [0.05, 0.01]);
});

test("every condition is sent in one batch", async () => {
  const { ask, backend } = setup();
  await ask.if("x", "A").elseif("B").elseif("C");
  assert.equal(backend.calls.length, 1);
  assert.equal(Object.keys(backend.calls[0]?.questions ?? {}).length, 3);
});

test("a per-elseif threshold is respected", async () => {
  const { ask } = setup();
  const strict = await ask.if("x", "A").elseif("borderline", undefined, { threshold: 0.7 });
  assert.equal(strict.branch, "else");
  const lenient = await ask.if("x", "A").elseif("borderline", undefined, { threshold: 0.5 });
  assert.ok(lenient.branch === "elseif");
  assert.equal(lenient.index, 1);
});

test("a per-elseif unsureBand is respected", async () => {
  const { ask, log } = setup();
  const result = await ask
    .if("x", "A", () => log.push("A"))
    .elseif("borderline", () => log.push("borderline"), { unsureBand: [0.1, 0.5] })
    .unsure(() => log.push("unsure"));
  // 0.6 is inside the default band [0.2, 0.8] but above this branch's own band [0.1, 0.5].
  assert.ok(result.branch === "elseif");
  assert.equal(result.index, 1);
  assert.deepEqual(log, ["borderline"]);
});

test("unsure stops the chain by default", async () => {
  const { ask, log } = setup();
  const result = await ask
    .if("x", "A", () => log.push("A"))
    .elseif("U", () => log.push("U"))
    .elseif("B", () => log.push("B"))
    .else(() => log.push("else"))
    .unsure(() => log.push("unsure"));
  assert.deepEqual(log, ["unsure"]);
  assert.ok(result.branch === "unsure");
  assert.equal(result.index, 1);
  assert.equal(result.condition, "U");
  assert.deepEqual(result.unsureIndexes, [1]);
});

test("mode: 'skip' lets a later clearly-true branch win and reports the unsure one", async () => {
  const { ask, log } = setup();
  const result = await ask
    .if("x", "U", () => log.push("U"))
    .elseif("B", () => log.push("B"))
    .unsure(() => log.push("unsure"), { mode: "skip" });
  assert.deepEqual(log, ["B"]);
  assert.ok(result.branch === "elseif");
  assert.equal(result.index, 1);
  assert.deepEqual(result.unsureIndexes, [0]);
});

test("mode: 'skip' runs unsure, not else, when nothing matched and something was unsure", async () => {
  const { ask, log } = setup();
  const result = await ask
    .if("x", "A", () => log.push("A"))
    .elseif("U", () => log.push("U"))
    .elseif("no", () => log.push("no"))
    .else(() => log.push("else"))
    .unsure(() => log.push("unsure"), { mode: "skip" });
  assert.deepEqual(log, ["unsure"]);
  assert.ok(result.branch === "unsure");
  assert.equal(result.index, 1);
  assert.equal(result.condition, "U");
});

test("mode: 'skip' still falls to else when nothing was unsure", async () => {
  const { ask, log } = setup();
  const result = await ask
    .if("x", "A")
    .elseif("no")
    .else(() => log.push("else"))
    .unsure(() => log.push("unsure"), { mode: "skip" });
  assert.deepEqual(log, ["else"]);
  assert.equal(result.branch, "else");
});

test("elseif does not inherit criteria from the if", async () => {
  const { ask, backend } = setup();
  await ask.if("x", "A", undefined, { criteria: { true: "yes", false: "no" } }).elseif("B");
  const questions = Object.values(backend.calls[0]?.questions ?? {});
  const withCriteria = questions.filter((q) => q.kind === "yesno" && q.criteria !== undefined);
  assert.equal(withCriteria.length, 1);
});

test(".elseif after the chain has started throws CHAIN_STARTED", async () => {
  const { ask } = setup();
  const chain = ask.if("x", "A");
  await chain;
  assert.throws(
    () => chain.elseif("B"),
    (error) => isAskError(error) && error.code === "CHAIN_STARTED",
  );
});
