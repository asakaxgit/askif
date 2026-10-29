import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { isAskError } from "askif";
import {
  JEV_FALLBACK_WARNING,
  JEV_RUNTIME_FALLBACK_WARNING,
  VERTEX_BASE_URL_MESSAGE,
  createAskBackendFor,
  getAsk,
  resetAskWarningsForTests,
  selectAskBackend,
} from "../src/index.js";

const completion = (content: string, status = 200): Response =>
  new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "google/gemini-3.5-flash",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, refusal: null } }],
    }),
    { status, headers: { "content-type": "application/json" } },
  );

const jevAnswer = (status = 200): Response =>
  new Response(
    JSON.stringify({
      model: "jev-latest",
      answers: {
        q0: { type: "noul", noul: 0.93 },
        q1: { type: "noul", noul: 0.11 },
      },
      usage: { input_tokens: 3, output_tokens: 1 },
    }),
    { status, headers: { "content-type": "application/json" } },
  );

const hrefOf = (input: string | URL | Request): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const authorizationOf = (init: RequestInit | undefined): string | undefined => {
  const headers = init?.headers;
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get("authorization") ?? undefined;
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === "authorization");
    return found?.[1];
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization" && typeof value === "string") return value;
  }
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const bodyOf = (init: RequestInit | undefined): Record<string, unknown> | undefined => {
  if (typeof init?.body !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(init.body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

beforeEach(() => {
  resetAskWarningsForTests();
});

test("selects Jev when the key is set, and Vertex when it is missing", () => {
  assert.deepEqual(selectAskBackend({ TYPESAFE_API_KEY: "k" }), { backend: "jev", fellBackToVertex: false });
  assert.deepEqual(selectAskBackend({ ASK_BACKEND: "jev", TYPESAFE_API_KEY: "k" }), {
    backend: "jev",
    fellBackToVertex: false,
  });
  assert.deepEqual(selectAskBackend({ ASK_BACKEND: "Jev", TYPESAFE_API_KEY: "k" }), {
    backend: "jev",
    fellBackToVertex: false,
  });
  assert.deepEqual(selectAskBackend({}), { backend: "vertex", fellBackToVertex: true });
  assert.deepEqual(selectAskBackend({ ASK_BACKEND: "jev" }), { backend: "vertex", fellBackToVertex: true });
  assert.deepEqual(selectAskBackend({ TYPESAFE_API_KEY: "  " }), { backend: "vertex", fellBackToVertex: true });
  assert.deepEqual(selectAskBackend({ ASK_BACKEND: " vertex ", TYPESAFE_API_KEY: "k" }), {
    backend: "vertex",
    fellBackToVertex: false,
  });
  assert.deepEqual(selectAskBackend({ ASK_BACKEND: "openai", TYPESAFE_API_KEY: "k" }), {
    backend: "openai",
    fellBackToVertex: false,
  });
  assert.deepEqual(selectAskBackend({ ASK_BACKEND: "mock", TYPESAFE_API_KEY: "k" }), {
    backend: "mock",
    fellBackToVertex: false,
  });
});

test("an unknown ASK_BACKEND is rejected", () => {
  assert.throws(
    () => selectAskBackend({ ASK_BACKEND: "clef" }),
    (error: unknown) => {
      assert.ok(isAskError(error));
      assert.equal(error.code, "BACKEND_UNAVAILABLE");
      assert.match(error.message, /clef/);
      return true;
    },
  );
});

test("a missing Jev key uses Vertex, warns once, and does not call Jev", async () => {
  const warnings: string[] = [];
  const urls: string[] = [];
  const tokens: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    urls.push(hrefOf(input));
    const authorization = authorizationOf(init);
    if (authorization !== undefined) tokens.push(authorization);
    return completion(JSON.stringify({ probability: 0.88 }));
  };
  const options = {
    fetch,
    accessToken: async () => "ya29.missing-key",
    warn: (message: string) => warnings.push(message),
  };
  const env = { LLM_BASE_URL: "https://vertex.example/v1/" };
  const ask = getAsk(env, options);
  assert.equal(await ask.is("cat", "is animal"), true);
  const again = getAsk(env, options);
  assert.equal(await again.is("cat", "is animal"), true);
  assert.deepEqual(warnings, [JEV_FALLBACK_WARNING]);
  assert.equal(urls.some((url) => url.includes("/systemone")), false);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url === "https://vertex.example/v1/chat/completions"));
  assert.deepEqual(tokens, ["Bearer ya29.missing-key", "Bearer ya29.missing-key"]);
});

test("Jev is tried first, and a 503 falls back to one Vertex request per question", async () => {
  const warnings: string[] = [];
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  let tokenReads = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = hrefOf(input);
    urls.push(url);
    if (url.includes("/systemone")) return new Response("upstream down", { status: 503 });
    const body = bodyOf(init);
    if (body !== undefined) bodies.push(body);
    return completion(JSON.stringify({ probability: 0.91 }));
  };
  const ask = getAsk(
    { TYPESAFE_API_KEY: "k", LLM_BASE_URL: "https://vertex.example/v1", LLM_MODEL: "google/gemini-3.5-flash" },
    {
      fetch,
      accessToken: async () => {
        tokenReads += 1;
        return `ya29.${tokenReads}`;
      },
      warn: (message: string) => warnings.push(message),
    },
  );
  const [animal, asleep] = await Promise.all([ask.is("cat", "is animal"), ask.is("cat", "is asleep")]);
  assert.equal(animal, true);
  assert.equal(asleep, true);
  await ask.is("cat", "is animal");
  assert.deepEqual(warnings, [JEV_RUNTIME_FALLBACK_WARNING]);
  const jevCalls = urls.filter((url) => url.includes("/systemone"));
  const vertexCalls = urls.filter((url) => url.includes("/chat/completions"));
  // Two questions share one Jev call, then one Vertex call each. The later call is one more of each.
  assert.equal(jevCalls.length, 2);
  assert.equal(vertexCalls.length, 3);
  assert.equal(tokenReads, 3);
  assert.ok(bodies.length >= 1);
  const first = bodies[0];
  assert.ok(first !== undefined);
  assert.equal(first["model"], "google/gemini-3.5-flash");
  assert.equal(first["temperature"], 0);
  assert.equal(first["reasoning_effort"], "low");
  assert.equal(first["max_tokens"], 4096);
});

test("a Jev 429 surfaces and does not call Vertex", async () => {
  const warnings: string[] = [];
  const urls: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    urls.push(hrefOf(input));
    return new Response("slow down", { status: 429, headers: { "retry-after": "2" } });
  };
  const ask = getAsk(
    { TYPESAFE_API_KEY: "k", LLM_BASE_URL: "https://vertex.example/v1" },
    { fetch, accessToken: async () => "ya29.unused", warn: (message: string) => warnings.push(message) },
  );
  await assert.rejects(
    () => ask.is("cat", "is animal"),
    (error: unknown) => {
      assert.ok(isAskError(error));
      assert.equal(error.code, "BACKEND_FAILED");
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.name, "RateLimitError");
      return true;
    },
  );
  assert.deepEqual(warnings, []);
  assert.equal(urls.some((url) => url.includes("/chat/completions")), false);
  assert.equal(urls.filter((url) => url.includes("/systemone")).length, 1);
});

test("auth failure, a 500, and a dropped connection fall back", async () => {
  const failures: readonly (() => Response | Promise<Response>)[] = [
    () => new Response("no", { status: 401 }),
    () => new Response("no", { status: 500 }),
    () => Promise.reject(Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" })),
  ];
  for (const failure of failures) {
    resetAskWarningsForTests();
    const urls: string[] = [];
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = hrefOf(input);
      urls.push(url);
      if (url.includes("/systemone")) return failure();
      return completion(JSON.stringify({ probability: 0.7 }));
    };
    const ask = getAsk(
      { ASK_BACKEND: "jev", TYPESAFE_API_KEY: "k", ASK_BASE_URL: "https://vertex.example/v1" },
      { fetch, accessToken: async () => "ya29.auth", warn: () => undefined },
    );
    assert.equal(await ask.is("cat", "is animal"), true);
    assert.equal(urls.filter((url) => url.includes("/chat/completions")).length, 1);
  }
});

test("a timeout from Jev falls back", async () => {
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (!hrefOf(input).includes("/systemone")) return Promise.resolve(completion(JSON.stringify({ probability: 0.66 })));
    return new Promise((_resolve, reject) => {
      const abort = (): void => {
        reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "AbortError" }));
      };
      if (init?.signal?.aborted === true) {
        abort();
        return;
      }
      init?.signal?.addEventListener("abort", abort, { once: true });
    });
  };
  const ask = getAsk(
    { TYPESAFE_API_KEY: "k", LLM_BASE_URL: "https://vertex.example/v1" },
    { fetch, timeout: 500, accessToken: async () => "ya29.timeout", warn: () => undefined },
  );
  assert.equal(await ask.is("cat", "is animal"), true);
});

test("explicit vertex, openai, and mock do not fall back", async () => {
  const urls: string[] = [];
  let tokenReads = 0;
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = hrefOf(input);
    urls.push(url);
    if (url.includes("vertex.example")) return new Response("vertex down", { status: 500 });
    return completion(JSON.stringify({ probability: 0.4 }));
  };
  const vertexAsk = getAsk(
    { ASK_BACKEND: "vertex", TYPESAFE_API_KEY: "k", LLM_BASE_URL: "https://vertex.example/v1" },
    {
      fetch,
      accessToken: async () => {
        tokenReads += 1;
        return "ya29.vertex";
      },
      warn: () => {
        throw new Error("explicit vertex must not warn");
      },
    },
  );
  await assert.rejects(() => vertexAsk.is("cat", "is animal"));
  assert.equal(tokenReads, 1);
  assert.deepEqual(urls, ["https://vertex.example/v1/chat/completions"]);

  urls.length = 0;
  const openaiAsk = getAsk(
    { ASK_BACKEND: "openai", OPENAI_API_KEY: "sk-test", LLM_MODEL: "gpt-6-luna" },
    {
      fetch,
      accessToken: async () => {
        throw new Error("openai must not read an ADC token");
      },
      warn: () => {
        throw new Error("explicit openai must not warn");
      },
    },
  );
  assert.equal(await openaiAsk.is("cat", "is animal"), false);
  assert.ok(urls[0]?.includes("/chat/completions"));
  assert.equal(urls.some((url) => url.includes("vertex.example")), false);

  let fetched = false;
  const mockAsk = getAsk(
    { ASK_BACKEND: "mock", TYPESAFE_API_KEY: "k" },
    {
      fetch: async () => {
        fetched = true;
        return completion("{}");
      },
      warn: () => {
        throw new Error("explicit mock must not warn");
      },
    },
  );
  assert.equal(await mockAsk.probability({ note: "dry run" }, "is spam"), 0.5);
  assert.equal(fetched, false);
});

test("a healthy Jev call does not require Vertex to be configured", async () => {
  const urls: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    urls.push(hrefOf(input));
    return jevAnswer();
  };
  const ask = getAsk(
    { TYPESAFE_API_KEY: "k" },
    {
      fetch,
      accessToken: async () => {
        throw new Error("ADC should not be read when Jev succeeds");
      },
      warn: () => {
        throw new Error("a successful Jev call must not warn");
      },
    },
  );
  assert.equal(await ask.is("cat", "is animal"), true);
  assert.equal(urls.length, 1);
  assert.ok(urls[0]?.includes("/systemone"));
});

test("Vertex without a base URL fails on the first call", async () => {
  let fetched = false;
  let tokenReads = 0;
  const ask = getAsk(
    { ASK_BACKEND: "vertex" },
    {
      fetch: async () => {
        fetched = true;
        return completion("{}");
      },
      accessToken: async () => {
        tokenReads += 1;
        return "ya29.nope";
      },
    },
  );
  await assert.rejects(
    () => ask.is("cat", "is animal"),
    (error: unknown) => {
      assert.ok(isAskError(error));
      assert.equal(error.code, "BACKEND_UNAVAILABLE");
      assert.match(error.message, new RegExp(VERTEX_BASE_URL_MESSAGE.replace(/[()]/g, "\\$&")));
      return true;
    },
  );
  assert.equal(fetched, false);
  assert.equal(tokenReads, 0);
});

test("createAskBackendFor does not fall back when the Jev key is missing", () => {
  assert.throws(
    () => createAskBackendFor("jev", {}),
    (error: unknown) => {
      assert.ok(isAskError(error));
      assert.equal(error.code, "BACKEND_UNAVAILABLE");
      return true;
    },
  );
});

test("ASK_MODEL wins over LLM_MODEL, including a Jev model id sent to Vertex", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = bodyOf(init);
    if (body !== undefined) bodies.push(body);
    assert.ok(hrefOf(input).startsWith("https://ask-base.example/v1/"));
    return completion(JSON.stringify({ probability: 0.5 }));
  };
  const ask = getAsk(
    {
      ASK_BACKEND: "vertex",
      ASK_MODEL: "jev-latest",
      LLM_MODEL: "google/gemini-3.5-flash",
      ASK_BASE_URL: "https://ask-base.example/v1",
      LLM_BASE_URL: "https://llm-base.example/v1",
    },
    { fetch, accessToken: async () => "ya29.model" },
  );
  await ask.is("cat", "is animal");
  assert.equal(bodies[0]?.["model"], "jev-latest");
});

test("Gemini prose around the probability JSON is still an answer", async () => {
  const fetch = async (): Promise<Response> => completion('Here you go:\n{"probability": 0.81}\nThanks');
  const ask = getAsk(
    { ASK_BACKEND: "vertex", LLM_BASE_URL: "https://vertex.example/v1" },
    { fetch, accessToken: async () => "ya29.prose" },
  );
  assert.equal(await ask.probability("cat", "is animal"), 0.81);
});
