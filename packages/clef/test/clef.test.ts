import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, isAskError } from "askif";
import type { Json } from "askif";
import { clef } from "../src/index.js";

const isRecord = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const result = {
  model: "@cf/cloudflare/clef",
  answers: {
    q0: { type: "noul", noul: 0.97 },
    q1: {
      type: "choice",
      choice: "returns",
      confidence: 0.42,
      probabilities: { returns: 0.61, billing: 0.39 },
    },
    q2: {
      type: "score",
      score: 1.43,
      confidence: 0.35,
      legend: { "0": "a", "1": "b", "2": "c" },
      probabilities: { "0": 0, "1": 0.57, "2": 0.43 },
    },
  },
  usage: { input_tokens: 10, output_tokens: 0 },
};

const envelope = (r: unknown): Response =>
  new Response(JSON.stringify({ success: true, errors: [], messages: [], result: r }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("the Clef backend sends and reads the System One format over REST", async () => {
  const calls: { url: string; headers: Headers; body: Json }[] = [];
  const backend = clef({
    accountId: "acct 1",
    apiToken: "tok",
    model: "clef-flash",
    fetch: async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return envelope(result);
    },
  });
  const ask = createAsk({ backend });

  const [odd, team, severity] = await Promise.all([
    ask.is(7, "is odd"),
    ask.switch(7, "Which team?").case("returns", "Exchanges").case("billing"),
    ask.score(7, "How severe?").level("a").level("b").level("c"),
  ]);

  assert.equal(odd, true);
  assert.equal(team.choice, "returns");
  assert.equal(team.confidence, 0.42); // Clef's own confidence is kept
  assert.equal(severity.level, "b");
  assert.equal(severity.confidence, 0.35);

  assert.equal(calls.length, 1); // same-tick calls are one request
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.url, "https://api.cloudflare.com/client/v4/accounts/acct%201/ai/run/@cf/cloudflare/clef-flash");
  assert.equal(call.headers.get("authorization"), "Bearer tok");
  assert.ok(isRecord(call.body));
  assert.equal(call.body["model"], "clef-flash");
  assert.equal(call.body["state"], "7");
  const questions = call.body["questions"];
  assert.ok(isRecord(questions));
  assert.deepEqual(Object.values(questions).map((q) => (isRecord(q) ? q["type"] : null)), [
    "noul",
    "choice",
    "score",
  ]);
  assert.deepEqual(questions["q1"] && isRecord(questions["q1"]) ? questions["q1"]["criteria"] : null, {
    returns: "Exchanges",
    billing: null,
  });
});

test("the Clef backend works through a Workers AI binding", async () => {
  const seen: { model: string; input: unknown }[] = [];
  const backend = clef({
    binding: {
      run: async (model, input) => {
        seen.push({ model, input });
        return result; // a binding returns the result without the REST envelope
      },
    },
  });
  const answers = await backend.decide(
    "x",
    {
      q0: { kind: "yesno", instructions: "ok?" },
      q1: { kind: "choice", instructions: "which?", options: [{ key: "returns", description: null }, { key: "billing", description: null }] },
      q2: { kind: "scale", instructions: "how?", levels: ["a", "b", "c"] },
    },
  );
  assert.equal(seen[0]?.model, "@cf/cloudflare/clef");
  assert.deepEqual(answers["q0"], { kind: "yesno", probability: 0.97 });
  assert.deepEqual(answers["q2"], { kind: "scale", probabilities: [0, 0.57, 0.43], confidence: 0.35 });
});

test("missing credentials are BACKEND_UNAVAILABLE", async () => {
  const saved = [process.env["CLOUDFLARE_ACCOUNT_ID"], process.env["CLOUDFLARE_API_TOKEN"]];
  delete process.env["CLOUDFLARE_ACCOUNT_ID"];
  delete process.env["CLOUDFLARE_API_TOKEN"];
  try {
    await assert.rejects(
      () => clef().decide("x", { q: { kind: "yesno", instructions: "ok?" } }),
      (error) => isAskError(error) && error.code === "BACKEND_UNAVAILABLE",
    );
  } finally {
    if (saved[0] !== undefined) process.env["CLOUDFLARE_ACCOUNT_ID"] = saved[0];
    if (saved[1] !== undefined) process.env["CLOUDFLARE_API_TOKEN"] = saved[1];
  }
});

test("HTTP and envelope errors are BACKEND_FAILED", async () => {
  const yesno = { q: { kind: "yesno", instructions: "ok?" } } as const;
  const http = clef({
    accountId: "a",
    apiToken: "t",
    fetch: async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: "bad token" }] }), { status: 403 }),
  });
  await assert.rejects(
    () => http.decide("x", yesno),
    (error) => isAskError(error) && error.code === "BACKEND_FAILED" && /403.*bad token/.test(error.message),
  );
  const envelopeError = clef({
    accountId: "a",
    apiToken: "t",
    fetch: async () => new Response(JSON.stringify({ success: false, errors: [{ message: "nope" }], result: null })),
  });
  await assert.rejects(
    () => envelopeError.decide("x", yesno),
    (error) => isAskError(error) && error.code === "BACKEND_FAILED",
  );
});

test("a missing or mismatched answer is BAD_RESPONSE", async () => {
  const backend = clef({
    binding: { run: async () => ({ model: "clef", answers: { q: { type: "choice", choice: "a", probabilities: {}, confidence: 1 } } }) },
  });
  await assert.rejects(
    () => backend.decide("x", { q: { kind: "yesno", instructions: "ok?" } }),
    (error) => isAskError(error) && error.code === "BAD_RESPONSE",
  );
  await assert.rejects(
    () => clef({ binding: { run: async () => ({}) } }).decide("x", { q: { kind: "yesno", instructions: "ok?" } }),
    (error) => isAskError(error) && error.code === "BAD_RESPONSE",
  );
});

test("batches are capped at 64 questions per request", async () => {
  let requests = 0;
  const ask = createAsk({
    maxBatchSize: 1000, // askif's own default is 32; Clef's limit should be the one that applies
    backend: clef({
      binding: {
        run: async (_model, input) => {
          requests += 1;
          const questions = isRecord(input["questions"]) ? input["questions"] : {};
          return {
            model: "clef",
            answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 1 }])),
          };
        },
      },
    }),
  });
  await Promise.all(Array.from({ length: 65 }, (_, i) => ask.is("s", `q${i}`)));
  assert.equal(requests, 2);
});
