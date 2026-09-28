import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, isAskError, mock } from "../src/index.js";
import { tableBackend } from "./helpers.js";

test("questions on the same state in the same tick share one call", async () => {
  const backend = tableBackend({ yesno: { "is animal": 0.9 } });
  const ask = createAsk({ backend });
  await Promise.all([
    ask.if("dog", "is animal", () => {}),
    ask.is("dog", "is a vehicle"),
    ask.switch("dog", "size?").case("small").case("large"),
    ask.score("dog", "cuteness?").level("low").level("high"),
    ask.is("car", "is a vehicle"),
  ]);
  assert.equal(backend.calls.length, 2);
  const dog = backend.calls.find((call) => call.state === "dog");
  assert.deepEqual(
    Object.values(dog?.questions ?? {}).map((q) => q.kind).sort(),
    ["choice", "scale", "yesno", "yesno"],
  );
});

test("batches are split by maxBatchSize", async () => {
  const backend = tableBackend({});
  const ask = createAsk({ backend, maxBatchSize: 2 });
  await Promise.all(["a", "b", "c", "d", "e"].map((c) => ask.is("x", c)));
  assert.equal(backend.calls.length, 3);
});

test("backend failures reject with BACKEND_FAILED and keep the cause", async () => {
  const cause = new Error("network down");
  const ask = createAsk({
    backend: mock(() => {
      throw cause;
    }),
  });
  await assert.rejects(
    async () => ask.is("x", "y"),
    (error) => isAskError(error) && error.code === "BACKEND_FAILED" && error.cause === cause,
  );
});

test("per-call backend override", async () => {
  const main = tableBackend({ yesno: { y: 0.1 } });
  const other = tableBackend({ yesno: { y: 0.9 } });
  const ask = createAsk({ backend: main });
  assert.equal(await ask.is("x", "y", { backend: other }), true);
  assert.equal(main.calls.length, 0);
});

test("configure changes defaults", async () => {
  const ask = createAsk({ backend: tableBackend({ yesno: { y: 0.6 } }) });
  assert.equal(await ask.is("x", "y"), true);
  ask.configure({ threshold: 0.7 });
  assert.equal(await ask.is("x", "y"), false);
});
