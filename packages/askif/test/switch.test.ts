import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, isAskError, mock } from "../src/index.js";
import { tableBackend } from "./helpers.js";

const Q = "Which team should handle this?";
const key = JSON.stringify(Q);

test("ask.switch runs the most likely case with a typed result", async () => {
  const ask = createAsk({
    backend: tableBackend({ choice: { [key]: { returns: 0.61, billing: 0.35, shipping: 0.04 } } }),
  });
  const log: string[] = [];
  const result = await ask
    .switch("wrong size and double charged", Q)
    .case("returns", "Exchanges, wrong or damaged items", (r) => log.push(`case ${r.choice}`))
    .case("shipping", "Delivery status, delays, lost packages")
    .case("billing", "Charges, invoices, payment problems", () => log.push("billing"));

  assert.deepEqual(log, ["case returns"]);
  assert.equal(result.choice, "returns");
  assert.equal(result.branch, "case");
  assert.deepEqual(
    result.ranking.map((r) => r.key),
    ["returns", "billing", "shipping"],
  );
});

test("descriptions default to null and are sent with the keys", async () => {
  const backend = tableBackend({ choice: { [JSON.stringify("tone?")]: { calm: 1 } } });
  const ask = createAsk({ backend });
  await ask.switch("hi", "tone?").case("calm").case("angry").other();
  const question = backend.calls[0]?.questions["q0"];
  assert.equal(question?.kind, "choice");
  assert.deepEqual(question?.kind === "choice" ? question.options : [], [
    { key: "calm", description: null },
    { key: "angry", description: null },
    { key: "other", description: "None of the other options fit" },
  ]);
});

test(".other can be chosen", async () => {
  const ask = createAsk({
    backend: tableBackend({ choice: { [key]: { returns: 0.1, other: 0.9 } } }),
  });
  const log: string[] = [];
  const result = await ask
    .switch("hello?", Q)
    .case("returns")
    .other(() => log.push("other"));
  assert.equal(result.choice, "other");
  assert.deepEqual(log, ["other"]);
});

test(".unsure runs when the backend reports low confidence", async () => {
  const ask = createAsk({
    backend: tableBackend({ choice: { [key]: { a: 0.4, b: 0.35, c: 0.25 } }, confidence: 0.2 }),
  });
  const log: string[] = [];
  const result = await ask
    .switch("?", Q)
    .case("a", () => log.push("a"))
    .case("b")
    .case("c")
    .unsure(() => log.push("unsure"));
  assert.deepEqual(log, ["unsure"]);
  assert.equal(result.branch, "unsure");
  assert.equal(result.choice, "a");
});

test("confidence is computed when the backend gives none", async () => {
  const ask = createAsk({ backend: tableBackend({ choice: { [key]: { a: 1, b: 0 } } }) });
  const result = await ask.switch("?", Q).case("a").case("b");
  assert.equal(result.confidence, 1);
});

test("duplicate keys throw immediately", () => {
  const ask = createAsk({ backend: tableBackend({}) });
  assert.throws(
    () => ask.switch("?", Q).case("a").case("a"),
    (error) => isAskError(error) && error.code === "INVALID_QUESTION",
  );
});

test("too few options rejects", async () => {
  const ask = createAsk({ backend: tableBackend({}) });
  await assert.rejects(
    async () => ask.switch("?", Q).case("only"),
    (error) => isAskError(error) && error.code === "INVALID_QUESTION",
  );
});

test("backend option limits are enforced", async () => {
  const ask = createAsk({
    backend: mock(() => ({ kind: "choice", probabilities: {} }), { maxOptions: 2 }),
  });
  await assert.rejects(
    async () => ask.switch("?", Q).case("a").case("b").case("c"),
    (error) => isAskError(error) && error.code === "INVALID_QUESTION",
  );
});
