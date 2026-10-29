import { createAsk, fallback, makeAskError, mock } from "askif";
import type { Answer, Ask, Backend, Question } from "askif";
import { jev } from "@askif/jev";
import { openai } from "@askif/openai";
import type { Env } from "./env.js";
import { trimmed } from "./env.js";
import { vertex } from "./vertex.js";
import type { VertexOptions } from "./vertex.js";

export const ASK_BACKENDS = ["vertex", "openai", "jev", "mock"] as const;

export type AskBackendName = (typeof ASK_BACKENDS)[number];

export type AskBackendSelection = {
  /** Backend `createAskBackend` will construct. */
  readonly backend: AskBackendName;
  /** Jev was the intended backend and `TYPESAFE_API_KEY` was missing. */
  readonly fellBackToVertex: boolean;
};

/** Logged once per process when the Jev key is missing and Vertex is used instead. */
export const JEV_FALLBACK_WARNING =
  "[ask] TYPESAFE_API_KEY is missing, so judgments fell back to Vertex.";

/** Logged once per process the first time a Jev call fails and that call is sent to Vertex. */
export const JEV_RUNTIME_FALLBACK_WARNING =
  "[ask] A Jev call failed, so judgments fell back to Vertex.";

export const isAskBackend = (value: string): value is AskBackendName =>
  ASK_BACKENDS.some((backend) => backend === value);

type Fetch = NonNullable<VertexOptions["fetch"]>;

export type AskBackendOptions = {
  /** Passed to the Jev, Vertex, and OpenAI clients. */
  readonly fetch?: Fetch;
  /** Vertex bearer token. Default: Google ADC, read again on every request. */
  readonly accessToken?: () => Promise<string>;
  /** Receives {@link JEV_FALLBACK_WARNING} or {@link JEV_RUNTIME_FALLBACK_WARNING}. Default: `console.warn`. */
  readonly warn?: (message: string) => void;
  readonly timeout?: number;
};

const defaultWarn = (message: string): void => {
  console.warn(message);
};

let warned = false;

/** Tests assert the one-time fallback warning more than once in a process. */
export const resetAskWarningsForTests = (): void => {
  warned = false;
};

const warnOnce = (message: string, warn: (message: string) => void): void => {
  if (warned) return;
  warned = true;
  warn(message);
};

/**
 * Which backend `createAskBackend` will build.
 * Unset and `jev` select Jev when `TYPESAFE_API_KEY` is present, otherwise Vertex.
 * Explicit `vertex`, `openai`, and `mock` stay on that backend.
 */
export const selectAskBackend = (env: Env = process.env): AskBackendSelection => {
  const raw = env["ASK_BACKEND"]?.trim().toLowerCase();
  if (raw !== undefined && raw !== "" && !isAskBackend(raw)) {
    throw makeAskError("BACKEND_UNAVAILABLE", `Unsupported ASK_BACKEND: ${raw}`);
  }
  if (raw === "vertex" || raw === "openai" || raw === "mock") {
    return { backend: raw, fellBackToVertex: false };
  }
  if (trimmed(env, "TYPESAFE_API_KEY") !== undefined) return { backend: "jev", fellBackToVertex: false };
  return { backend: "vertex", fellBackToVertex: true };
};

export const resolveAskBackend = (env: Env = process.env): AskBackendName => selectAskBackend(env).backend;

const jevBackend = (env: Env, options: AskBackendOptions): Backend => {
  const apiKey = trimmed(env, "TYPESAFE_API_KEY");
  if (apiKey === undefined) {
    throw makeAskError("BACKEND_UNAVAILABLE", "TYPESAFE_API_KEY is required for the Jev backend.");
  }
  const model = trimmed(env, "ASK_MODEL");
  const baseURL = trimmed(env, "ASK_BASE_URL");
  return jev({
    apiKey,
    ...(model === undefined ? {} : { model }),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    retry: { maxRetries: 0 },
  });
};

const vertexBackend = (env: Env, options: AskBackendOptions): Backend =>
  vertex({
    env,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.accessToken === undefined ? {} : { accessToken: options.accessToken }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  });

const openAiBackend = (env: Env, options: AskBackendOptions): Backend => {
  const apiKey = trimmed(env, "LLM_API_KEY") ?? trimmed(env, "OPENAI_API_KEY");
  if (apiKey === undefined) {
    throw makeAskError(
      "BACKEND_UNAVAILABLE",
      "LLM API key missing (set LLM_API_KEY or OPENAI_API_KEY for ASK_BACKEND=openai).",
    );
  }
  const model = trimmed(env, "ASK_MODEL") ?? trimmed(env, "LLM_MODEL");
  const baseURL = trimmed(env, "ASK_BASE_URL") ?? trimmed(env, "LLM_BASE_URL");
  return openai({
    apiKey,
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(model === undefined ? {} : { model }),
    maxRetries: 0,
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    params: { temperature: 0 },
  });
};

/** Flat probabilities. A local dry-run, not a production scorer. */
const mockBackend = (): Backend =>
  mock((question: Question): Answer => {
    if (question.kind === "yesno") return { kind: "yesno", probability: 0.5 };
    if (question.kind === "choice") {
      const probability = 1 / question.options.length;
      return {
        kind: "choice",
        probabilities: Object.fromEntries(question.options.map((option) => [option.key, probability])),
      };
    }
    const probability = 1 / question.levels.length;
    return { kind: "scale", probabilities: question.levels.map(() => probability) };
  });

/**
 * Build one named backend. Does not fall back: Jev without `TYPESAFE_API_KEY` throws,
 * so a comparison cannot silently score Vertex against itself.
 */
export const createAskBackendFor = (
  backend: AskBackendName,
  env: Env = process.env,
  options: AskBackendOptions = {},
): Backend => {
  switch (backend) {
    case "vertex":
      return vertexBackend(env, options);
    case "openai":
      return openAiBackend(env, options);
    case "jev":
      return jevBackend(env, options);
    case "mock":
      return mockBackend();
    default: {
      const exhaustive: never = backend;
      throw makeAskError("BACKEND_UNAVAILABLE", `Unsupported ASK_BACKEND: ${exhaustive}`);
    }
  }
};

/**
 * Jev when `ASK_BACKEND` is unset or `jev` and `TYPESAFE_API_KEY` is set, with a
 * per-call Vertex fallback for transport and auth failures. A missing key uses
 * Vertex directly and warns once. Explicit `vertex`, `openai`, and `mock` do not fall back.
 */
export const createAskBackend = (env: Env = process.env, options: AskBackendOptions = {}): Backend => {
  const selection = selectAskBackend(env);
  const warn = options.warn ?? defaultWarn;
  if (selection.fellBackToVertex) warnOnce(JEV_FALLBACK_WARNING, warn);
  const backend = createAskBackendFor(selection.backend, env, options);
  if (selection.backend !== "jev") return backend;
  return fallback(backend, vertexBackend(env, options), {
    onFallback: () => warnOnce(JEV_RUNTIME_FALLBACK_WARNING, warn),
  });
};

export const getAsk = (env: Env = process.env, options: AskBackendOptions = {}): Ask =>
  createAsk({ backend: createAskBackend(env, options) });
