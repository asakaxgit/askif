import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, isAskError, makeAskError, mock } from "../src/index.js";
import type { Answer, Backend, QuestionResult } from "../src/index.js";
import { tableBackend } from "./helpers.js";

const yes = (probability: number): Answer => ({ kind: "yesno", probability });

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

test("different states stay in separate calls when the backend has no multiState", async () => {
  const backend = mock(() => yes(0.9), undefined, { multiState: false });
  const ask = createAsk({ backend, maxStatesPerBatch: 10 });
  await Promise.all(["a", "b", "c"].map((state) => ask.is(state, "ok")));
  assert.equal(backend.calls.length, 3);
  assert.equal(backend.manyCalls.length, 0);
});

test("a multiState backend receives different states in one decideMany call", async () => {
  const backend = mock((question) => {
    switch (question.kind) {
      case "yesno":
        return yes(0.8);
      case "choice":
        return { kind: "choice", probabilities: { small: 0.2, large: 0.8 } };
      case "scale":
        return { kind: "scale", probabilities: [0.25, 0.75] };
      default:
        return question satisfies never;
    }
  }, undefined, { multiState: true });
  const ask = createAsk({ backend });
  const [animal, size, speed] = await Promise.all([
    ask.is("dog", "is animal"),
    ask.switch("cat", "size?").case("small").case("large"),
    ask.score("car", "speed?").level("low").level("high"),
  ]);
  assert.equal(animal, true);
  assert.equal(size.choice, "large");
  assert.equal(speed.level, "high");
  assert.equal(backend.calls.length, 0);
  assert.equal(backend.manyCalls.length, 1);
  assert.deepEqual(
    backend.manyCalls[0]?.map((item) => item.state),
    ["dog", "cat", "car"],
  );
});

test("one state on a multiState backend still uses decide", async () => {
  const backend = mock(() => yes(0.7), undefined, { multiState: true });
  const ask = createAsk({ backend });
  await Promise.all([ask.is("dog", "is animal"), ask.is("dog", "is cute")]);
  assert.equal(backend.calls.length, 1);
  assert.equal(backend.manyCalls.length, 0);
  assert.equal(Object.keys(backend.calls[0]?.questions ?? {}).length, 2);
  assert.equal(backend.calls[0]?.state, "dog");
});

test("maxStatesPerBatch caps distinct states, and a leftover single state uses decide", async () => {
  const backend = mock(() => yes(0.5), undefined, { multiState: true });
  const ask = createAsk({ backend, maxStatesPerBatch: 2 });
  await Promise.all(["a", "b", "c"].map((state) => ask.is(state, "ok")));
  assert.equal(backend.manyCalls.length, 1);
  assert.deepEqual(
    backend.manyCalls[0]?.map((item) => item.state),
    ["a", "b"],
  );
  assert.equal(backend.calls.length, 1);
  assert.equal(backend.calls[0]?.state, "c");
});

test("maxBatchSize still caps questions inside a cross-state batch", async () => {
  const backend = mock(() => yes(0.5), undefined, { multiState: true });
  const ask = createAsk({ backend, maxBatchSize: 2, maxStatesPerBatch: 10 });
  await Promise.all(["a", "b", "c", "d", "e"].map((state) => ask.is(state, "ok")));
  assert.equal(backend.manyCalls.length, 2);
  assert.equal(backend.calls.length, 1);
  assert.deepEqual(
    backend.manyCalls.map((call) => call.map((item) => item.state)),
    [
      ["a", "b"],
      ["c", "d"],
    ],
  );
  assert.equal(backend.calls[0]?.state, "e");
});

test("repeated state counts once toward maxStatesPerBatch", async () => {
  const backend = mock(() => yes(0.5), undefined, { multiState: true });
  const ask = createAsk({ backend, maxStatesPerBatch: 2 });
  await Promise.all([
    ask.is("a", "one"),
    ask.is("a", "two"),
    ask.is("b", "three"),
    ask.is("c", "four"),
  ]);
  assert.equal(backend.manyCalls.length, 1);
  assert.deepEqual(
    backend.manyCalls[0]?.map((item) => [item.state, item.id]),
    [
      ["a", "q0"],
      ["a", "q1"],
      ["b", "q2"],
    ],
  );
  assert.equal(backend.calls.length, 1);
  assert.equal(backend.calls[0]?.state, "c");
});

test("backend maxStatesPerCall caps the config", async () => {
  const backend = mock(() => yes(0.5), { maxStatesPerCall: 2 }, { multiState: true });
  const ask = createAsk({ backend, maxStatesPerBatch: 10 });
  await Promise.all(["a", "b", "c", "d"].map((state) => ask.is(state, "ok")));
  assert.equal(backend.manyCalls.length, 2);
  assert.equal(backend.calls.length, 0);
  assert.deepEqual(
    backend.manyCalls.map((call) => call.length),
    [2, 2],
  );
});

test("maxStatesPerBatch of 1 disables cross-state batching", async () => {
  const backend = mock(() => yes(0.5), undefined, { multiState: true });
  const ask = createAsk({ backend, maxStatesPerBatch: 1 });
  await Promise.all(["a", "b"].map((state) => ask.is(state, "ok")));
  assert.equal(backend.manyCalls.length, 0);
  assert.equal(backend.calls.length, 2);
});

test("a multiState flag without decideMany keeps one call per state", async () => {
  const backend: Backend = {
    name: "flag-only",
    multiState: true,
    decide: async () => ({ q0: yes(0.4) }),
  };
  const ask = createAsk({ backend, maxStatesPerBatch: 8 });
  await Promise.all([ask.is("a", "ok"), ask.is("b", "ok")]);
  assert.equal(await ask.is("c", "ok"), false);
});

test("one bad answer does not reject the other questions in the call", async () => {
  const backend: Backend = {
    name: "partial",
    decide: async (_state, questions) => {
      const results: { [id: string]: QuestionResult } = {};
      for (const id of Object.keys(questions)) {
        results[id] =
          id === "q1" ? { error: makeAskError("BAD_RESPONSE", "q1 broke") } : yes(0.9);
      }
      return results;
    },
  };
  const ask = createAsk({ backend });
  const [good, bad] = await Promise.allSettled([ask.is("x", "good"), ask.is("x", "bad")]);
  assert.equal(good.status, "fulfilled");
  if (good.status === "fulfilled") assert.equal(good.value, true);
  assert.equal(bad.status, "rejected");
  if (bad.status === "rejected") {
    assert.equal(isAskError(bad.reason), true);
    if (isAskError(bad.reason)) {
      assert.equal(bad.reason.code, "BAD_RESPONSE");
      assert.equal(bad.reason.message, "q1 broke");
    }
  }
});

test("a decideMany item error does not reject its siblings", async () => {
  const cause = new Error("bad tweet");
  const backend = mock((question, state) => {
    if (state === "bad") throw cause;
    if (question.kind === "scale") return { kind: "scale", probabilities: question.levels.map(() => 0) };
    return yes(0.95);
  }, undefined, { multiState: true });
  const ask = createAsk({ backend });
  const [good, bad, scored] = await Promise.allSettled([
    ask.is("good", "ok"),
    ask.is("bad", "ok"),
    ask.score("also-good", "how?").level("low").level("high"),
  ]);
  assert.equal(good.status, "fulfilled");
  if (good.status === "fulfilled") assert.equal(good.value, true);
  assert.equal(bad.status, "rejected");
  if (bad.status === "rejected") {
    assert.equal(isAskError(bad.reason), true);
    if (isAskError(bad.reason)) assert.equal(bad.reason.cause, cause);
  }
  assert.equal(scored.status, "fulfilled");
  if (scored.status === "fulfilled") assert.equal(scored.value.level, "low");
  assert.equal(backend.manyCalls.length, 1);
});

test("a scale answer is validated against that call's levels", async () => {
  const backend = mock((question, state) => {
    if (question.kind !== "scale") return yes(0.5);
    if (state === "short") return { kind: "scale", probabilities: [1] };
    return { kind: "scale", probabilities: question.levels.map((_, i) => (i === 1 ? 1 : 0)) };
  }, undefined, { multiState: true });
  const ask = createAsk({ backend });
  const [good, bad] = await Promise.allSettled([
    ask.score("full", "how?").level("low").level("high"),
    ask.score("short", "how?").level("low").level("high"),
  ]);
  assert.equal(good.status, "fulfilled");
  if (good.status === "fulfilled") {
    assert.equal(good.value.level, "high");
    assert.equal(good.value.probabilities.length, 2);
  }
  assert.equal(bad.status, "rejected");
  if (bad.status === "rejected") {
    assert.equal(isAskError(bad.reason), true);
    if (isAskError(bad.reason)) assert.equal(bad.reason.code, "BAD_RESPONSE");
  }
});

test("a thrown decideMany rejects every item in that call", async () => {
  const cause = new Error("socket hang up");
  const backend: Backend = {
    name: "down",
    multiState: true,
    limits: { maxStatesPerCall: 8 },
    decide: async () => ({ q0: yes(1) }),
    decideMany: async () => {
      throw cause;
    },
  };
  const ask = createAsk({ backend });
  const [a, b] = await Promise.allSettled([ask.is("a", "ok"), ask.is("b", "ok")]);
  for (const result of [a, b]) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.equal(isAskError(result.reason), true);
      if (isAskError(result.reason)) {
        assert.equal(result.reason.code, "BACKEND_FAILED");
        assert.equal(result.reason.cause, cause);
      }
    }
  }
});
