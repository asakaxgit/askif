// Jev as the primary backend, Vertex when that call cannot be answered.
// Offline: no API key and no network. Also runs as a test — see test/examples.test.ts.
//
// Run with: npx tsx examples/backends.ts
import assert from "node:assert/strict";
import { createAsk, fallback, isAskError, mock } from "askif";
import type { Answer, Question } from "askif";
import { JEV_FALLBACK_WARNING, selectAskBackend } from "../src/index.js";

const yes = (question: Question): Answer => {
  if (question.kind !== "yesno") throw new Error("expected a yes/no question");
  return { kind: "yesno", probability: 0.91 };
};

const down = Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
const limited = Object.assign(new Error("slow down"), { name: "RateLimitError", status: 429 });

const vertex = mock(yes);
const notices: unknown[] = [];
const ask = createAsk({
  backend: fallback(
    mock(() => {
      throw down;
    }),
    vertex,
    { onFallback: (error) => notices.push(error) },
  ),
});

assert.equal(await ask.is("cat", "is animal"), true);
assert.equal(notices.length, 1);
assert.equal(vertex.calls.length, 1);
console.log("fell back after", down.message);

const rateLimited = createAsk({
  backend: fallback(
    mock(() => {
      throw limited;
    }),
    vertex,
    {
      onFallback: () => {
        throw new Error("429 must not fall back");
      },
    },
  ),
});
await assert.rejects(
  () => rateLimited.is("cat", "is animal"),
  (error: unknown) => {
    assert.ok(isAskError(error));
    assert.equal(error.code, "BACKEND_FAILED");
    return true;
  },
);
assert.equal(vertex.calls.length, 1);

assert.deepEqual(selectAskBackend({ TYPESAFE_API_KEY: "present" }), { backend: "jev", fellBackToVertex: false });
assert.deepEqual(selectAskBackend({}), { backend: "vertex", fellBackToVertex: true });
assert.deepEqual(selectAskBackend({ ASK_BACKEND: "vertex", TYPESAFE_API_KEY: "present" }), {
  backend: "vertex",
  fellBackToVertex: false,
});
assert.deepEqual(selectAskBackend({ ASK_BACKEND: "openai" }), { backend: "openai", fellBackToVertex: false });
assert.deepEqual(selectAskBackend({ ASK_BACKEND: "mock" }), { backend: "mock", fellBackToVertex: false });
assert.match(JEV_FALLBACK_WARNING, /TYPESAFE_API_KEY is missing/);
