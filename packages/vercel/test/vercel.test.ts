import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, image, isAskError } from "askif";
import type { Question } from "askif";
import { vercel, vercelDecide } from "../src/index.js";
import type { VercelDecideInput, VercelUsage } from "../src/index.js";

const isRecord = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const YESNO = { q: { kind: "yesno", instructions: "ok?" } } as const satisfies { readonly q: Question };

const png = image("AAAA", "image/png");
const gif = image("BBBB", "image/gif");

const result = {
  model: "typesafe-ai/jev",
  answers: {
    q0: { type: "boolean", probability: 0.97 },
    q1: { type: "choice", choice: "returns", probabilities: { returns: 0.61, billing: 0.39 } },
    q2: { type: "score", score: 1.43, probabilities: { "0": 0, "1": 0.57, "2": 0.43 } },
  },
  usage: { inputTokens: 12, outputTokens: 4 },
  providerMetadata: {
    gateway: {
      cost: "0.00001155",
      marketCost: "0.00001155",
      surchargeCost: "0",
      gatewayCost: "0.00001155",
      generationId: "gen_test",
    },
    typesafe: { confidence: { q1: 0.42, q2: 0.35 } },
  },
};

type Seen = {
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
  readonly signal: AbortSignal | null | undefined;
};

const responding = (seen: Seen[], payload: unknown = result, status = 200): typeof fetch =>
  async (url, init) => {
    seen.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
      signal: init?.signal,
    });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };

const refusingFetch: typeof fetch = async () => {
  throw new Error("this guard was supposed to reject before any request");
};

const withKey = async (run: () => Promise<void>): Promise<void> => {
  const saved = process.env["AI_GATEWAY_API_KEY"];
  delete process.env["AI_GATEWAY_API_KEY"];
  try {
    await run();
  } finally {
    if (saved !== undefined) process.env["AI_GATEWAY_API_KEY"] = saved;
  }
};

test("POST /v1/evaluate sends one request for yes/no, choice, and scale", async () => {
  const seen: Seen[] = [];
  const usage: VercelUsage[] = [];
  const backend = vercel({
    apiKey: "test-key",
    model: "typesafe-ai/jev",
    fetch: responding(seen),
    headers: { "x-test": "1" },
    onUsage: (report) => usage.push(report),
  });
  const ask = createAsk({ backend });
  const [odd, team, severity] = await Promise.all([
    ask.is(7, "is odd"),
    ask.switch(7, "Which team?").case("returns", "Exchanges").case("billing"),
    ask.score(7, "How severe?").level("a").level("b").level("c"),
  ]);

  assert.equal(odd, true);
  assert.equal(team.choice, "returns");
  assert.equal(team.confidence, 0.42);
  assert.equal(severity.level, "b");
  assert.equal(severity.confidence, 0.35);
  assert.equal(seen.length, 1);
  const call = seen[0];
  assert.ok(call);
  assert.equal(call.url, "https://ai-gateway.vercel.sh/v1/evaluate");
  assert.equal(call.headers.get("authorization"), "Bearer test-key");
  assert.equal(call.headers.get("content-type"), "application/json");
  assert.equal(call.headers.get("x-test"), "1");
  assert.ok(isRecord(call.body));
  assert.equal(call.body["model"], "typesafe-ai/jev");
  assert.equal(call.body["state"], "7");
  const questions = call.body["questions"];
  assert.ok(isRecord(questions));
  assert.deepEqual(
    Object.values(questions).map((question) => (isRecord(question) ? question["type"] : null)),
    ["boolean", "choice", "score"],
  );
  const choice = questions["q1"];
  assert.ok(isRecord(choice));
  assert.deepEqual(choice["criteria"], { returns: "Exchanges", billing: null });
  assert.deepEqual(usage, [
    {
      model: "typesafe-ai/jev",
      inputTokens: 12,
      outputTokens: 4,
      cost: "0.00001155",
      marketCost: "0.00001155",
      surchargeCost: "0",
      gatewayCost: "0.00001155",
      generationId: "gen_test",
    },
  ]);
  assert.equal(backend.limits?.maxLevels, 10);
  assert.equal(backend.limits?.maxImages, undefined);
  assert.equal(backend.multiState, undefined);
});

test("a JSON array state is sent as an array, and numbers inside objects stay numbers", async () => {
  const seen: Seen[] = [];
  await vercel({ apiKey: "k", fetch: responding(seen, { answers: { q: { type: "boolean", probability: 0.5 } } }) }).decide(
    { rows: ["a"], n: 1, flag: true, list: [1, false] },
    YESNO,
  );
  const body = seen[0]?.body;
  assert.ok(isRecord(body));
  assert.deepEqual(body["state"], { rows: ["a"], n: 1, flag: true, list: [1, false] });

  seen.length = 0;
  await vercel({ apiKey: "k", baseURL: "https://example.test/", fetch: responding(seen, { answers: { q: { type: "boolean", probability: 0.2 } } }) }).decide(
    ["left", "right"],
    YESNO,
  );
  assert.equal(seen[0]?.url, "https://example.test/v1/evaluate");
  assert.deepEqual(isRecord(seen[0]?.body) ? seen[0]?.body["state"] : null, ["left", "right"]);
});

test("null state and images are rejected before POST /v1/evaluate", async () => {
  const seen: Seen[] = [];
  const backend = vercel({ apiKey: "k", fetch: responding(seen) });
  await assert.rejects(() => backend.decide(null, YESNO), (error: unknown) => {
    assert.ok(isAskError(error));
    assert.equal(error.code, "UNSUPPORTED_INPUT");
    assert.match(error.message, /null/);
    return true;
  });
  await assert.rejects(() => backend.decide({ photo: png }, YESNO), (error: unknown) => {
    assert.ok(isAskError(error));
    assert.equal(error.code, "UNSUPPORTED_INPUT");
    assert.match(error.message, /POST \/v1\/evaluate/);
    return true;
  });
  assert.equal(seen.length, 0);
  assert.equal(vercel({ apiKey: "k", limits: { maxImages: 4 } }).limits?.maxImages, undefined);
});

test("different states are separate requests", async () => {
  const seen: Seen[] = [];
  const ask = createAsk({
    backend: vercel({
      apiKey: "k",
      fetch: responding(seen, { answers: { q0: { type: "boolean", probability: 0.9 } } }),
    }),
  });
  const [cat, hammer] = await Promise.all([
    ask.probability("cat", "is an animal"),
    ask.probability("hammer", "is an animal"),
  ]);
  assert.equal(cat, 0.9);
  assert.equal(hammer, 0.9);
  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((call) => (isRecord(call.body) ? call.body["state"] : null)),
    ["cat", "hammer"],
  );
});

test("fallback fills gateway.models unless the caller already set models", async () => {
  const seen: Seen[] = [];
  const fetch = responding(seen, { answers: { q: { type: "boolean", probability: 0.5 } } });
  await vercel({
    apiKey: "k",
    fetch,
    providerOptions: { gateway: { zeroDataRetention: true } },
    fallback: { model: "openai/gpt-6-luna-decisions", when: { probabilityBetween: [0.4, 0.6] }, or: ["anthropic/claude-sonnet-5"] },
  }).decide("x", YESNO);
  const first = seen[0]?.body;
  assert.ok(isRecord(first));
  assert.deepEqual(first["providerOptions"], {
    gateway: {
      zeroDataRetention: true,
      models: [
        { model: "openai/gpt-6-luna-decisions", when: { probabilityBetween: [0.4, 0.6] } },
        "anthropic/claude-sonnet-5",
      ],
    },
  });

  seen.length = 0;
  await vercel({
    apiKey: "k",
    fetch,
    providerOptions: { gateway: { models: ["typesafe-ai/jev-1.14.0"] } },
    fallback: { model: "ignored", when: { any: [{ confidenceBelow: 0.2 }] } },
  }).decide("x", YESNO);
  const second = seen[0]?.body;
  assert.ok(isRecord(second));
  assert.deepEqual(second["providerOptions"], { gateway: { models: ["typesafe-ai/jev-1.14.0"] } });
});

test("HTTP errors, transport errors, and a missing key", async () => {
  await withKey(async () => {
    await assert.rejects(
      () => vercel().decide("x", YESNO),
      (error: unknown) => isAskError(error) && error.code === "BACKEND_UNAVAILABLE" && /AI_GATEWAY_API_KEY/.test(error.message),
    );
  });
  const http = vercel({
    apiKey: "k",
    fetch: async () => new Response(JSON.stringify({ error: { message: "bad token" } }), { status: 401 }),
  });
  await assert.rejects(
    () => http.decide("x", YESNO),
    (error: unknown) => isAskError(error) && error.code === "BACKEND_FAILED" && /HTTP 401\): bad token/.test(error.message),
  );
  const down = vercel({
    apiKey: "k",
    fetch: async () => {
      throw new Error("socket hang up");
    },
  });
  await assert.rejects(() => down.decide("x", YESNO), (error: unknown) => {
    assert.ok(isAskError(error));
    assert.equal(error.code, "BACKEND_FAILED");
    assert.ok(error.cause instanceof Error);
    assert.equal(error.cause.message, "socket hang up");
    return true;
  });
});

test("a bad body still reports usage; a refusal fails only that question", async () => {
  const usage: VercelUsage[] = [];
  await assert.rejects(
    () =>
      vercel({
        apiKey: "k",
        onUsage: (report) => usage.push(report),
        fetch: async () => new Response(JSON.stringify({ model: "typesafe-ai/jev", usage: { inputTokens: 3, outputTokens: 1 }, providerMetadata: { gateway: { cost: 0.25 } } }), { status: 200 }),
      }).decide("x", YESNO),
    (error: unknown) => isAskError(error) && error.code === "BAD_RESPONSE",
  );
  assert.deepEqual(usage, [{ model: "typesafe-ai/jev", inputTokens: 3, outputTokens: 1, cost: "0.25" }]);

  const answers = await vercel({
    apiKey: "k",
    fetch: async () =>
      new Response(
        JSON.stringify({
          answers: {
            kept: { type: "boolean", probability: 0.8 },
            refused: { type: "refusal" },
          },
        }),
        { status: 200 },
      ),
  }).decide("x", {
    kept: { kind: "yesno", instructions: "kept?" },
    refused: { kind: "yesno", instructions: "refused?" },
  });
  assert.deepEqual(answers["kept"], { kind: "yesno", probability: 0.8 });
  const refused = answers["refused"];
  assert.ok(refused && "error" in refused && isAskError(refused.error));
  assert.equal(refused.error.code, "BAD_RESPONSE");
});

test("missing distributions become a one-hot or a two-point score, with confidence 0", async () => {
  const answers = await vercel({
    apiKey: "k",
    fetch: async () =>
      new Response(
        JSON.stringify({
          answers: {
            picked: { type: "choice", choice: "a", probabilities: {} },
            rated: { type: "score", score: 1.5 },
          },
        }),
        { status: 200 },
      ),
  }).decide("x", {
    picked: {
      kind: "choice",
      instructions: "which?",
      options: [
        { key: "a", description: null },
        { key: "b", description: null },
      ],
    },
    rated: { kind: "scale", instructions: "how?", levels: ["low", "mid", "high"] },
  });
  assert.deepEqual(answers["picked"], { kind: "choice", probabilities: { a: 1, b: 0 }, confidence: 0 });
  assert.deepEqual(answers["rated"], { kind: "scale", probabilities: [0, 0.5, 0.5], confidence: 0 });
});

test("eleven levels exceed the default maxLevels of 10", async () => {
  const seen: Seen[] = [];
  const ask = createAsk({ backend: vercel({ apiKey: "k", fetch: responding(seen) }) });
  const chain = ask
    .score("x", "rate")
    .level("0")
    .level("1")
    .level("2")
    .level("3")
    .level("4")
    .level("5")
    .level("6")
    .level("7")
    .level("8")
    .level("9")
    .level("10");
  await assert.rejects(
    () => Promise.resolve(chain),
    (error: unknown) => isAskError(error) && error.code === "INVALID_QUESTION" && /at most 10 levels/.test(error.message),
  );
  assert.equal(seen.length, 0);
});

test("vercelDecide maps file parts only when images is true", async () => {
  const calls: VercelDecideInput[] = [];
  const decide = async (input: VercelDecideInput): Promise<unknown> => {
    calls.push(input);
    return { answers: { q: { type: "boolean", probability: 0.7 } }, response: { modelId: "openai/gpt-6-luna-decisions" }, usage: { inputTokens: 8, outputTokens: 2 }, providerMetadata: { gateway: { cost: "0.01", generationId: "gen_sdk" } } };
  };
  const off = vercelDecide({ apiKey: "k", decide, fetch: refusingFetch });
  await assert.rejects(() => off.decide({ photo: png }, YESNO), (error: unknown) => {
    assert.ok(isAskError(error));
    assert.equal(error.code, "UNSUPPORTED_INPUT");
    assert.match(error.message, /images is true/);
    return true;
  });
  assert.equal(calls.length, 0);
  assert.equal(off.limits?.maxImages, undefined);

  const on = vercelDecide({ apiKey: "k", images: true, decide, maxRetries: 0, timeout: 5 });
  assert.equal(on.limits?.maxImages, 16);
  const usage: VercelUsage[] = [];
  const backend = vercelDecide({
    apiKey: "k",
    images: true,
    decide,
    maxRetries: 0,
    timeout: 50,
    limits: { maxImages: 4 },
    onUsage: (report) => usage.push(report),
  });
  assert.equal(backend.limits?.maxImages, 4);
  await backend.decide({ note: "see", photo: png }, { q: { kind: "yesno", instructions: gif } });
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.maxRetries, 0);
  assert.ok(call.abortSignal instanceof AbortSignal);
  assert.equal(call.model, "typesafe-ai/jev");
  const questions = call.questions["q"];
  assert.ok(questions);
  assert.equal(questions.instructions, "[image 2]");
  assert.deepEqual(call.state, [
    { type: "json", value: { note: "see", photo: "[image 1]" } },
    { type: "file", mediaType: "image/png", data: png.source.data },
    { type: "file", mediaType: "image/gif", data: gif.source.data },
  ]);
  assert.deepEqual(usage, [
    {
      model: "openai/gpt-6-luna-decisions",
      inputTokens: 8,
      outputTokens: 2,
      cost: "0.01",
      generationId: "gen_sdk",
    },
  ]);
});

test("vercelDecide rejects an unsupported image type and too many images before decide", async () => {
  let calls = 0;
  const decide = async (): Promise<unknown> => {
    calls += 1;
    return { answers: { q: { type: "boolean", probability: 1 } } };
  };
  const backend = vercelDecide({ apiKey: "k", images: true, decide });
  await assert.rejects(
    () => backend.decide({ photo: image("AAAA", "image/tiff") }, YESNO),
    (error: unknown) => isAskError(error) && error.code === "UNSUPPORTED_INPUT" && /image\/tiff/.test(error.message),
  );
  const capped = vercelDecide({ apiKey: "k", images: true, limits: { maxImages: 1 }, decide });
  await assert.rejects(
    () => capped.decide({ a: png, b: gif }, YESNO),
    (error: unknown) => isAskError(error) && error.code === "UNSUPPORTED_INPUT" && /at most 1 images/.test(error.message),
  );
  assert.equal(calls, 0);
});

test("a model instance without doDecide is rejected before a request", async () => {
  await assert.rejects(
    () =>
      vercelDecide({
        model: { specificationVersion: "v4", provider: "custom", modelId: "plain" },
        fetch: refusingFetch,
      }).decide("x", YESNO),
    (error: unknown) => isAskError(error) && error.code === "BACKEND_UNAVAILABLE" && /doDecide/.test(error.message),
  );
});

test("an SDK refusal fails the whole call, and a thrown decide error is BACKEND_FAILED", async () => {
  const refused = vercelDecide({
    apiKey: "k",
    decide: async () => {
      const error = new Error("refused");
      return Promise.reject(Object.assign(error, { questionIds: ["q"] }));
    },
  });
  await assert.rejects(() => refused.decide("x", YESNO), (error: unknown) => {
    assert.ok(isAskError(error));
    assert.equal(error.code, "BACKEND_FAILED");
    assert.match(error.message, /refused q/);
    return true;
  });
  const broken = vercelDecide({
    apiKey: "k",
    decide: async () => {
      throw new Error("sdk down");
    },
  });
  await assert.rejects(() => broken.decide("x", YESNO), (error: unknown) => {
    assert.ok(isAskError(error));
    assert.equal(error.code, "BACKEND_FAILED");
    assert.match(error.message, /AI SDK decide call failed/);
    assert.ok(error.cause instanceof Error);
    assert.equal(error.cause.message, "sdk down");
    return true;
  });
});
