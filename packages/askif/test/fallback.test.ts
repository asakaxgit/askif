import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, fallback, isAskError, makeAskError, shouldFallback } from "../src/index.js";
import type { Answer, Backend, DecisionItem, ItemResult, Question, QuestionResult, State } from "../src/index.js";

const yesno = (instructions: string): Question => ({ kind: "yesno", instructions });

const yes = (probability = 0.9): Answer => ({ kind: "yesno", probability });

const httpError = (name: string, status: number, message = name): Error =>
  Object.assign(new Error(message), { name, status });

const coded = (code: string, message = code): Error => Object.assign(new Error(message), { code });

type Recorded = { readonly state: State; readonly ids: readonly string[] };

const recording = (limits?: Backend["limits"], multiState = false) => {
  const calls: Recorded[] = [];
  const many: DecisionItem[][] = [];
  const backend: Backend = {
    name: "vertex",
    ...(limits === undefined ? {} : { limits }),
    ...(multiState
      ? {
          multiState: true as const,
          decideMany: async (items): Promise<readonly ItemResult[]> => {
            many.push([...items]);
            return items.map((item) => ({ id: item.id, answer: yes() }));
          },
        }
      : {}),
    decide: async (state, questions) => {
      calls.push({ state, ids: Object.keys(questions) });
      const answers: { [id: string]: QuestionResult } = {};
      for (const id of Object.keys(questions)) answers[id] = yes();
      return answers;
    },
  };
  return { backend, calls, many };
};

const throwing = (error: unknown, options?: { readonly multiState?: boolean; readonly onDecide?: () => void }): Backend => ({
  name: "jev",
  limits: { maxStatesPerCall: 8 },
  ...(options?.multiState === true
    ? {
        multiState: true as const,
        decideMany: async (): Promise<readonly ItemResult[]> => {
          throw error;
        },
      }
    : {}),
  decide: async () => {
    options?.onDecide?.();
    throw error;
  },
});

test("classifies which failures fall back", () => {
  const cases: readonly { readonly name: string; readonly error: unknown; readonly fallback: boolean }[] = [
    { name: "503", error: httpError("InternalServerError", 503), fallback: true },
    { name: "500", error: httpError("InternalServerError", 500), fallback: true },
    { name: "599", error: httpError("InternalServerError", 599), fallback: true },
    { name: "401", error: httpError("AuthenticationError", 401), fallback: true },
    { name: "403", error: httpError("PermissionDeniedError", 403), fallback: true },
    { name: "402", error: httpError("Error", 402, "payment required"), fallback: true },
    { name: "408", error: httpError("Error", 408, "request timeout"), fallback: true },
    { name: "connection", error: Object.assign(new Error("connect"), { name: "APIConnectionError" }), fallback: true },
    { name: "timeout class", error: Object.assign(new Error("slow"), { name: "APITimeoutError" }), fallback: true },
    { name: "openai timeout", error: Object.assign(new Error("slow"), { name: "APIConnectionTimeoutError" }), fallback: true },
    { name: "dom timeout", error: Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), fallback: true },
    { name: "abort message timeout", error: Object.assign(new Error("The operation was aborted due to timeout"), { name: "AbortError" }), fallback: true },
    { name: "fetch failed", error: new TypeError("fetch failed"), fallback: true },
    { name: "ECONNRESET", error: coded("ECONNRESET"), fallback: true },
    { name: "ETIMEDOUT", error: coded("ETIMEDOUT"), fallback: true },
    { name: "headers timeout", error: coded("UND_ERR_HEADERS_TIMEOUT"), fallback: true },
    { name: "plain timeout message", error: new Error("network timeout"), fallback: true },
    {
      name: "missing api key",
      error: Object.assign(new Error("No API key was provided. Set the TYPESAFE_API_KEY environment variable."), {
        name: "TypeSafeError",
      }),
      fallback: true,
    },
    {
      name: "503 wrapped in BACKEND_FAILED",
      error: makeAskError("BACKEND_FAILED", "The jev backend failed.", httpError("InternalServerError", 503)),
      fallback: true,
    },
    { name: "429", error: httpError("RateLimitError", 429), fallback: false },
    { name: "429 without name", error: httpError("Error", 429, "slow down"), fallback: false },
    { name: "429 wrapped", error: makeAskError("BACKEND_FAILED", "wrapped", httpError("RateLimitError", 429)), fallback: false },
    { name: "rate limit code", error: coded("RATE_LIMITED", "slow down"), fallback: false },
    { name: "400", error: httpError("BadRequestError", 400), fallback: false },
    { name: "404", error: httpError("NotFoundError", 404), fallback: false },
    { name: "422", error: httpError("UnprocessableEntityError", 422), fallback: false },
    { name: "caller abort", error: Object.assign(new Error("aborted"), { name: "APIUserAbortError" }), fallback: false },
    { name: "AbortError", error: Object.assign(new Error("The operation was aborted"), { name: "AbortError" }), fallback: false },
    { name: "invalid question", error: makeAskError("INVALID_QUESTION", "too few options"), fallback: false },
    { name: "unsupported input", error: makeAskError("UNSUPPORTED_INPUT", "no images"), fallback: false },
    { name: "bad response", error: makeAskError("BAD_RESPONSE", "not json"), fallback: false },
    { name: "chain started", error: makeAskError("CHAIN_STARTED", "too late"), fallback: false },
    { name: "missing sdk", error: makeAskError("BACKEND_UNAVAILABLE", "install the sdk"), fallback: false },
    { name: "unknown error", error: new Error("question id collided"), fallback: false },
  ];
  for (const item of cases) assert.equal(shouldFallback(item.error), item.fallback, item.name);
});

test("a successful primary is not sent to the fallback", async () => {
  let fallbackCalls = 0;
  const primary: Backend = {
    name: "jev",
    decide: async (_state, questions) => {
      const answers: { [id: string]: QuestionResult } = {};
      for (const id of Object.keys(questions)) answers[id] = yes(0.8);
      return answers;
    },
  };
  const secondary: Backend = {
    name: "vertex",
    decide: async () => {
      fallbackCalls += 1;
      return {};
    },
  };
  const notices: unknown[] = [];
  const result = await fallback(primary, secondary, { onFallback: (error) => notices.push(error) }).decide("cat", {
    q: yesno("is animal"),
  });
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(notices, []);
  assert.deepEqual(result["q"], yes(0.8));
});

test("a per-question error is not a failed call", async () => {
  const { backend: secondary, calls } = recording();
  const primary: Backend = {
    name: "jev",
    decide: async () => ({ q: { error: makeAskError("BAD_RESPONSE", "wrong shape") } }),
  };
  const result = await fallback(primary, secondary).decide("cat", { q: yesno("is animal") });
  const answer = result["q"];
  assert.ok(answer !== undefined && "error" in answer);
  assert.equal(calls.length, 0);
});

test("network, timeout, 5xx, and auth failures fall back", async () => {
  const failures = [
    coded("ECONNRESET", "socket hang up"),
    new Error("network timeout"),
    httpError("InternalServerError", 503, "upstream unavailable"),
    httpError("AuthenticationError", 401, "invalid api key"),
  ];
  for (const error of failures) {
    const { backend: secondary, calls } = recording();
    const notices: unknown[] = [];
    const result = await fallback(throwing(error), secondary, { onFallback: (caught) => notices.push(caught) }).decide(
      "cat",
      { q: yesno("is animal") },
    );
    assert.equal(calls.length, 1, error.message);
    assert.equal(notices.length, 1, error.message);
    assert.deepEqual(result["q"], yes());
  }
});

test("429, validation, and caller abort do not fall back", async () => {
  const failures = [
    httpError("RateLimitError", 429, "slow down"),
    makeAskError("UNSUPPORTED_INPUT", "no images"),
    makeAskError("INVALID_QUESTION", "duplicate key"),
    makeAskError("BAD_RESPONSE", "not an object"),
    Object.assign(new Error("aborted"), { name: "APIUserAbortError" }),
    new Error("question id collided"),
  ];
  for (const error of failures) {
    const { backend: secondary, calls } = recording();
    await assert.rejects(
      () => fallback(throwing(error), secondary).decide("cat", { q: yesno("is animal") }),
      (caught: unknown) => caught === error,
    );
    assert.equal(calls.length, 0, error instanceof Error ? error.message : "error");
  }
});

test("a shared-state batch is one primary call and one fallback call per question", async () => {
  let primaryCalls = 0;
  const primary = throwing(httpError("InternalServerError", 502, "bad gateway"), {
    onDecide: () => {
      primaryCalls += 1;
    },
  });
  const { backend: secondary, calls } = recording({ maxQuestionsPerCall: 1 });
  const ask = createAsk({ backend: fallback(primary, secondary) });
  const [animal, asleep] = await Promise.all([ask.is("cat", "is animal"), ask.is("cat", "is asleep")]);
  assert.equal(animal, true);
  assert.equal(asleep, true);
  assert.equal(primaryCalls, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.ids.length),
    [1, 1],
  );
  assert.equal(JSON.stringify(calls[0]?.state), JSON.stringify("cat"));
});

test("decideMany falls back one state at a time when the secondary has no multiState", async () => {
  const primary = throwing(new TypeError("fetch failed"), { multiState: true });
  const { backend: secondary, calls, many } = recording({ maxQuestionsPerCall: 1 });
  const wrapped = fallback(primary, secondary);
  assert.equal(wrapped.multiState, true);
  const items: DecisionItem[] = [
    { id: "a", state: { id: "1" }, question: yesno("is a greeting") },
    { id: "b", state: { id: "1" }, question: yesno("is a question") },
    { id: "c", state: { id: "2" }, question: yesno("is a farewell") },
  ];
  const results = await wrapped.decideMany?.(items);
  assert.ok(results !== undefined);
  assert.equal(many.length, 0);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    results.map((result) => result.id),
    ["a", "b", "c"],
  );
  for (const result of results) assert.ok("answer" in result);
});

test("decideMany keeps one secondary call when that backend accepts the batch", async () => {
  const primary = throwing(httpError("InternalServerError", 500), { multiState: true });
  const { backend: secondary, calls, many } = recording(undefined, true);
  const items: DecisionItem[] = [
    { id: "a", state: "one", question: yesno("is animal") },
    { id: "b", state: "two", question: yesno("is mineral") },
  ];
  const results = await fallback(primary, secondary).decideMany?.(items);
  assert.equal(many.length, 1);
  assert.equal(calls.length, 0);
  assert.equal(results?.length, 2);
});

test("a 429 from decideMany does not fall back", async () => {
  const error = httpError("RateLimitError", 429);
  const { backend: secondary, calls } = recording();
  const decideMany = fallback(throwing(error, { multiState: true }), secondary).decideMany;
  assert.ok(decideMany !== undefined);
  await assert.rejects(
    () => decideMany([]),
    (caught: unknown) => caught === error,
  );
  assert.equal(calls.length, 0);
  const again = fallback(throwing(error, { multiState: true }), secondary).decideMany;
  assert.ok(again !== undefined);
  await assert.rejects(
    () => again([{ id: "a", state: "cat", question: yesno("is animal") }]),
    (caught: unknown) => caught === error,
  );
  assert.equal(calls.length, 0);
});

test("a fallback that also fails reports both causes and does not loop", async () => {
  const primaryError = httpError("InternalServerError", 503, "jev down");
  const secondaryError = new TypeError("fetch failed");
  const secondary: Backend = {
    name: "vertex",
    limits: { maxQuestionsPerCall: 1 },
    decide: async () => {
      throw secondaryError;
    },
  };
  await assert.rejects(
    () => fallback(throwing(primaryError), secondary).decide("cat", { q: yesno("is animal"), r: yesno("is asleep") }),
    (caught: unknown) => {
      assert.ok(isAskError(caught));
      assert.equal(caught.code, "BACKEND_FAILED");
      assert.match(caught.message, /jev down/);
      assert.match(caught.message, /fetch failed/);
      assert.equal(caught.cause, secondaryError);
      return true;
    },
  );
});

test("a fallback that is not configured keeps the primary failure", async () => {
  const primaryError = httpError("InternalServerError", 503, "jev down");
  const secondaryError = makeAskError("BACKEND_UNAVAILABLE", "ASK_BASE_URL or LLM_BASE_URL is required for Vertex.");
  const secondary: Backend = {
    name: "vertex",
    decide: async () => {
      throw secondaryError;
    },
  };
  await assert.rejects(
    () => fallback(throwing(primaryError), secondary).decide("cat", { q: yesno("is animal") }),
    (caught: unknown) => {
      assert.ok(isAskError(caught));
      assert.equal(caught.code, "BACKEND_UNAVAILABLE");
      assert.match(caught.message, /jev down/);
      assert.match(caught.message, /ASK_BASE_URL/);
      assert.equal(caught.cause, secondaryError);
      return true;
    },
  );
});

test("an AskError from the fallback is rethrown as that error", async () => {
  const bad = makeAskError("BAD_RESPONSE", "Vertex returned prose.");
  const secondary: Backend = {
    name: "vertex",
    decide: async () => {
      throw bad;
    },
  };
  await assert.rejects(
    () => fallback(throwing(httpError("InternalServerError", 503)), secondary).decide("cat", { q: yesno("is animal") }),
    (caught: unknown) => caught === bad,
  );
});

test("createAsk surfaces a 429 as BACKEND_FAILED and does not call Vertex", async () => {
  const { backend: secondary, calls } = recording({ maxQuestionsPerCall: 1 });
  const ask = createAsk({ backend: fallback(throwing(httpError("RateLimitError", 429, "slow down")), secondary) });
  await assert.rejects(
    () => ask.is("cat", "is animal"),
    (caught: unknown) => {
      assert.ok(isAskError(caught));
      assert.equal(caught.code, "BACKEND_FAILED");
      assert.ok(caught.cause instanceof Error);
      assert.equal(caught.cause.name, "RateLimitError");
      return true;
    },
  );
  assert.equal(calls.length, 0);
});
