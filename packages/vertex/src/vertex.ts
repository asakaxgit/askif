import { isAskError, makeAskError } from "askif";
import type { Backend } from "askif";
import { openai } from "@askif/openai";
import type { OpenAIOptions } from "@askif/openai";
import { getAdcAccessToken } from "./adc.js";
import type { Env } from "./env.js";
import { trimmed } from "./env.js";

/** Gemini on Vertex's OpenAI-compatible endpoint, when `ASK_MODEL` and `LLM_MODEL` are unset. */
export const VERTEX_ADC_DEFAULT_MODEL = "google/gemini-3.5-flash";

/**
 * Gemini 3 thinks unless told otherwise. Thinking tokens are billed as output and,
 * under a small `max_tokens`, can come back empty. `low` is the OpenAI-compat form
 * of thinking_level low (Gemini 3 rejects `none`). Do not also send `google.thinking_config`.
 */
export const VERTEX_JUDGMENT_REASONING_EFFORT = "low" as const;

/** Room for `reasoning_effort: low` plus the probability JSON. */
export const VERTEX_JUDGMENT_MAX_TOKENS = 4096;

export const VERTEX_BASE_URL_MESSAGE =
  "ASK_BASE_URL or LLM_BASE_URL is required for Vertex (ASK_BACKEND=vertex, or the Jev fallback when TYPESAFE_API_KEY is unset).";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type VertexOptions = {
  /** Defaults to `process.env` for `ASK_MODEL`, `LLM_MODEL`, `ASK_BASE_URL`, and `LLM_BASE_URL`. */
  readonly env?: Env;
  /** Overrides `ASK_MODEL` / `LLM_MODEL`. */
  readonly model?: string;
  /** Overrides `ASK_BASE_URL` / `LLM_BASE_URL`. The Vertex OpenAI-compatible root, no trailing path beyond `/openapi`. */
  readonly baseURL?: string;
  /**
   * Bearer token for one request. Default: {@link getAdcAccessToken}.
   * The OpenAI client calls this before every attempt, so the token is not a static API key.
   */
  readonly accessToken?: () => Promise<string>;
  readonly fetch?: Fetch;
  readonly timeout?: number;
  /** Merged after temperature 0, `reasoning_effort: low`, and `max_tokens` 4096, so these can override them. */
  readonly params?: OpenAIOptions["params"];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Gemini sometimes wraps the schema JSON in prose. Pull the object out before `@askif/openai` parses it. */
const extractJsonObject = (text: string): string => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return text;
  const slice = text.slice(start, end + 1);
  try {
    const value: unknown = JSON.parse(slice);
    if (!isRecord(value)) return text;
    return slice;
  } catch {
    return text;
  }
};

const responseWith = (body: string, response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
};

export const relaxVertexJudgmentJson = async (response: Response): Promise<Response> => {
  if (!response.ok) return response;
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return responseWith(text, response);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["choices"])) return responseWith(text, response);
  const choice = parsed["choices"][0];
  if (!isRecord(choice)) return responseWith(text, response);
  const message = choice["message"];
  if (!isRecord(message) || typeof message["content"] !== "string") return responseWith(text, response);
  const content = message["content"];
  try {
    JSON.parse(content);
    return responseWith(text, response);
  } catch {
    const extracted = extractJsonObject(content);
    if (extracted === content) return responseWith(text, response);
    message["content"] = extracted;
    return responseWith(JSON.stringify(parsed), response);
  }
};

const relaxFetch = (inner: Fetch): Fetch => async (input, init) => relaxVertexJudgmentJson(await inner(input, init));

const resolveModel = (options: VertexOptions, env: Env): string =>
  options.model ?? trimmed(env, "ASK_MODEL") ?? trimmed(env, "LLM_MODEL") ?? VERTEX_ADC_DEFAULT_MODEL;

const resolveBaseURL = (options: VertexOptions, env: Env): string => {
  const raw = options.baseURL ?? trimmed(env, "ASK_BASE_URL") ?? trimmed(env, "LLM_BASE_URL");
  const baseURL = raw?.replace(/\/$/, "");
  if (baseURL === undefined || baseURL === "") throw makeAskError("BACKEND_UNAVAILABLE", VERTEX_BASE_URL_MESSAGE);
  return baseURL;
};

const resolveToken = (options: VertexOptions): (() => Promise<string>) => {
  const read = options.accessToken ?? getAdcAccessToken;
  return async () => {
    let token: string;
    try {
      token = await read();
    } catch (error) {
      if (isAskError(error)) throw error;
      const message = error instanceof Error ? error.message : "token lookup failed";
      throw makeAskError(
        "BACKEND_UNAVAILABLE",
        `Google ADC access token unavailable: ${message.slice(0, 200)}`,
        error,
      );
    }
    if (token.trim() === "") throw makeAskError("BACKEND_UNAVAILABLE", "ADC returned an empty access token.");
    return token;
  };
};

const build = (options: VertexOptions): Backend => {
  const env = options.env ?? process.env;
  return openai({
    apiKey: resolveToken(options),
    baseURL: resolveBaseURL(options, env),
    model: resolveModel(options, env),
    maxRetries: 0,
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    fetch: relaxFetch(options.fetch ?? fetch),
    params: {
      temperature: 0,
      reasoning_effort: VERTEX_JUDGMENT_REASONING_EFFORT,
      max_tokens: VERTEX_JUDGMENT_MAX_TOKENS,
      ...options.params,
    },
  });
};

/**
 * Gemini through Vertex AI's OpenAI-compatible endpoint.
 *
 * One question per request (`@askif/openai`). The bearer token is a fresh ADC
 * access token on every request unless `accessToken` is passed. `ASK_BASE_URL`
 * or `LLM_BASE_URL` is required on the first call, not at construction.
 */
export const vertex = (options: VertexOptions = {}): Backend => {
  let inner: Backend | undefined;
  const load = (): Backend => (inner ??= build(options));
  return {
    name: "vertex",
    limits: { maxQuestionsPerCall: 1, maxImages: 1500 },
    decide: (state, questions, context) => load().decide(state, questions, context),
  };
};
