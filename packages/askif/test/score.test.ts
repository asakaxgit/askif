import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, isAskError } from "../src/index.js";
import { tableBackend } from "./helpers.js";

const Q = "How severe is the reported issue?";
const key = JSON.stringify(Q);
const COSMETIC = "Cosmetic; no impact to functionality";
const WORKAROUND = "Broken or degraded feature, but workaround exists";
const BLOCKING = "Blocking issue; no workaround exists";

test("ask.score runs the most likely level", async () => {
  const ask = createAsk({ backend: tableBackend({ scale: { [key]: [0, 0.57, 0.43] } }) });
  const log: string[] = [];
  const result = await ask
    .score("crashes in Safari", Q)
    .level(COSMETIC, () => log.push("cosmetic"))
    .level(WORKAROUND, (r) => log.push(`workaround ${r.index}`))
    .level(BLOCKING, () => log.push("page"));

  assert.deepEqual(log, ["workaround 1"]);
  assert.equal(result.level, WORKAROUND);
  assert.equal(result.index, 1);
  assert.ok(Math.abs(result.score - 1.43) < 1e-9);
  assert.ok(Math.abs(result.normalized - 0.715) < 1e-9);
});

test("a split between the ends never picks the empty middle level", async () => {
  const ask = createAsk({ backend: tableBackend({ scale: { [key]: [0.5, 0, 0.5] } }) });
  const result = await ask.score("?", Q).level(COSMETIC).level(WORKAROUND).level(BLOCKING);
  assert.equal(result.score, 1); // rounding would say WORKAROUND
  assert.notEqual(result.level, WORKAROUND);
});

test(".unsure runs on low confidence", async () => {
  const ask = createAsk({ backend: tableBackend({ scale: { [key]: [0.34, 0.33, 0.33] } }) });
  const log: string[] = [];
  const result = await ask
    .score("?", Q)
    .level(COSMETIC, () => log.push("cosmetic"))
    .level(WORKAROUND)
    .level(BLOCKING)
    .unsure(() => log.push("unsure"));
  assert.deepEqual(log, ["unsure"]);
  assert.equal(result.branch, "unsure");
});

test("short keys with separate and structured descriptions", async () => {
  const backend = tableBackend({ scale: { [key]: [0, 0, 1] } });
  const ask = createAsk({ backend });
  const result = await ask
    .score("cannot log in", Q)
    .level("cosmetic", COSMETIC)
    .level("workaround", { what: WORKAROUND, examples: ["export fails in one browser"] })
    .level("blocking", BLOCKING);
  assert.equal(result.level, "blocking");
  const question = backend.calls[0]?.questions["q0"];
  assert.deepEqual(question?.kind === "scale" ? question.levels : [], [
    COSMETIC,
    { what: WORKAROUND, examples: ["export fails in one browser"] },
    BLOCKING,
  ]);
});

test("adding a level after the question was sent throws", async () => {
  const ask = createAsk({ backend: tableBackend({ scale: { [key]: [1, 0] } }) });
  const chain = ask.score("?", Q).level("a").level("b");
  await chain;
  assert.throws(
    () => chain.level("c"),
    (error) => isAskError(error) && error.code === "CHAIN_STARTED",
  );
});
