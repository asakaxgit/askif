import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk } from "../src/index.js";
import { tableBackend } from "./helpers.js";

const backend = tableBackend({ yesno: { "is animal": 0.97, "is a vehicle": 0.03, "is cute": 0.5 } });
const ask = createAsk({ backend });

test("ask.if runs the then handler", async () => {
  const log: string[] = [];
  const result = await ask.if("cat", "is animal", () => log.push("cat is animal"));
  assert.deepEqual(log, ["cat is animal"]);
  assert.ok(result.branch === "then");
  assert.equal(result.index, 0);
  assert.equal(result.condition, "is animal");
  assert.equal(result.probability, 0.97);
});

test("ask.if runs .else when false", async () => {
  const log: string[] = [];
  await ask
    .if("cat", "is a vehicle", () => log.push("then"))
    .else(() => log.push("else"));
  assert.deepEqual(log, ["else"]);
});

test("ask.if runs .unsure inside the band", async () => {
  const log: string[] = [];
  const result = await ask
    .if("cat", "is cute", () => log.push("then"))
    .else(() => log.push("else"))
    .unsure(() => log.push("unsure"));
  assert.deepEqual(log, ["unsure"]);
  assert.equal(result.branch, "unsure");
});

test("without .unsure, the threshold decides", async () => {
  const result = await ask.if("cat", "is cute", () => {}, { threshold: 0.4 });
  assert.equal(result.branch, "then");
});

test("ask.is and ask.probability", async () => {
  assert.equal(await ask.is("cat", "is animal"), true);
  assert.equal(await ask.is("cat", "is a vehicle"), false);
  assert.equal(await ask.probability("cat", "is a vehicle"), 0.03);
});

test("an un-awaited ask.if still runs", async () => {
  let ran = false;
  void ask.if("cat", "is animal", () => {
    ran = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ran, true);
});

test("handlers are awaited before the chain resolves", async () => {
  const log: string[] = [];
  await ask.if("cat", "is animal", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    log.push("done");
  });
  assert.deepEqual(log, ["done"]);
});
