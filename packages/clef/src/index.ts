import { createAsk, makeAskError } from "askif";
import type { Answer, Backend, Json, Question } from "askif";

export type ClefModel = "clef" | "clef-flash";

/** What `env.AI` looks like inside a Cloudflare Worker. */
export type ClefBinding = {
  readonly run: (model: string, input: Readonly<Record<string, unknown>>) => Promise<unknown>;
};

export type ClefOptions = {
  /** "clef" or "clef-flash". Default: "clef". */
  readonly model?: ClefModel;
  /** Cloudflare account id. Default: CLOUDFLARE_ACCOUNT_ID. Not needed with `binding`. */
  readonly accountId?: string;
  /** Cloudflare API token with Workers AI access. Default: CLOUDFLARE_API_TOKEN. Not needed with `binding`. */
  readonly apiToken?: string;
  /** Run through a Workers AI binding (`env.AI`) instead of the REST API. */
  readonly binding?: ClefBinding;
  /** Default: "https://api.cloudflare.com/client/v4". */
  readonly baseURL?: string;
  /** Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
};

/** Limits documented for Clef: 1-64 questions, 2-255 options, 2-10 levels. */
const LIMITS = { maxQuestionsPerCall: 64, maxOptions: 255, maxLevels: 10 } as const;

const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";

// The question/answer mapping below mirrors packages/jev/src/index.ts (same System One
// wire format). Change both together; the shared fixture in
// packages/askif/test/fixtures/system-one.ts is checked by both packages' tests.
// Differences are deliberate: Clef validates every answer (it has no SDK types to trust)
// and leaves the "scale needs 2+ levels" check to askif core.

type ClefQuestion =
  | { type: "noul"; instructions: Json; criteria?: { true?: Json; false?: Json } }
  | { type: "choice"; instructions: Json; criteria: Record<string, Json> }
  | { type: "score"; instructions: Json; criteria: Json[] };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Clef accepts text, objects, or arrays. Numbers and booleans are sent as text. */
const toEntry = (value: Json): Json =>
  typeof value === "number" || typeof value === "boolean" ? String(value) : value;

const toClef = (question: Question): ClefQuestion => {
  switch (question.kind) {
    case "yesno": {
      const { criteria } = question;
      return {
        type: "noul",
        instructions: toEntry(question.instructions),
        ...(criteria === undefined
          ? {}
          : {
              criteria: {
                ...(criteria.true === undefined ? {} : { true: toEntry(criteria.true) }),
                ...(criteria.false === undefined ? {} : { false: toEntry(criteria.false) }),
              },
            }),
      };
    }
    case "choice":
      return {
        type: "choice",
        instructions: toEntry(question.instructions),
        criteria: Object.fromEntries(question.options.map((o) => [o.key, toEntry(o.description)])),
      };
    case "scale":
      return {
        type: "score",
        instructions: toEntry(question.instructions),
        criteria: question.levels.map(toEntry),
      };
    default:
      return question satisfies never;
  }
};

/** An image as Clef takes it: a base64 data URL, or its content type and bytes. */
type ClefImage = string | { content_type: string; base64: string };

const MAX_IMAGES = 4;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,/i;

const isImageObject = (value: { [key: string]: Json }): value is { content_type: string; base64: string } => {
  const { content_type: contentType, base64 } = value;
  return (
    Object.keys(value).length === 2 &&
    typeof contentType === "string" &&
    /^image\/(?:png|jpeg|webp)$/i.test(contentType) &&
    typeof base64 === "string"
  );
};

/**
 * Moves images out of the state, since askif's state is plain JSON. Any base64 image data
 * URL, or `{ content_type, base64 }` object, anywhere in the state becomes an entry in
 * `images` and leaves "[image N]" behind (N counts from 1, in the order Clef gets them).
 */
const extractImages = (state: Json): { readonly state: Json; readonly images: readonly ClefImage[] } => {
  const images: ClefImage[] = [];
  const placeholder = (image: ClefImage): string => {
    images.push(image);
    return `[image ${images.length}]`;
  };
  const walk = (value: Json): Json => {
    if (typeof value === "string") return IMAGE_DATA_URL.test(value) ? placeholder(value) : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      if (isImageObject(value)) return placeholder({ content_type: value.content_type, base64: value.base64 });
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]));
    }
    return value;
  };
  const stripped = walk(state);
  return { state: stripped, images };
};

const readProbability = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;

const readConfidence = (record: Readonly<Record<string, unknown>>): number | undefined =>
  readProbability(record["confidence"]);

const fromClef = (question: Question, answer: unknown): Answer => {
  const bad = (): never => {
    throw makeAskError("BAD_RESPONSE", `Clef returned no valid ${question.kind} answer.`);
  };
  if (!isRecord(answer)) return bad();
  const confidence = readConfidence(answer);
  const withConfidence = confidence === undefined ? {} : { confidence };

  switch (question.kind) {
    case "yesno": {
      const probability = answer["type"] === "noul" ? readProbability(answer["noul"]) : undefined;
      return probability === undefined ? bad() : { kind: "yesno", probability };
    }
    case "choice": {
      const probabilities = answer["type"] === "choice" ? answer["probabilities"] : undefined;
      if (!isRecord(probabilities)) return bad();
      return {
        kind: "choice",
        probabilities: Object.fromEntries(
          question.options.map((o) => [o.key, readProbability(probabilities[o.key]) ?? 0]),
        ),
        ...withConfidence,
      };
    }
    case "scale": {
      const probabilities = answer["type"] === "score" ? answer["probabilities"] : undefined;
      if (!isRecord(probabilities)) return bad();
      return {
        kind: "scale",
        probabilities: question.levels.map((_, i) => readProbability(probabilities[String(i)]) ?? 0),
        ...withConfidence,
      };
    }
    default:
      return question satisfies never;
  }
};

const env = (name: string): string | undefined => {
  const value = typeof process === "undefined" ? undefined : process.env[name];
  return value === undefined || value === "" ? undefined : value;
};

const describeErrors = (errors: unknown): string =>
  Array.isArray(errors)
    ? errors
        .map((e) => (isRecord(e) && typeof e["message"] === "string" ? e["message"] : JSON.stringify(e)))
        .join("; ")
    : "";

/** Unwraps Cloudflare's `{ success, errors, result }` envelope; a binding returns the result directly. */
const unwrap = (body: unknown): unknown => {
  if (isRecord(body) && "success" in body && "result" in body) {
    if (body["success"] === false) {
      throw makeAskError("BACKEND_FAILED", `Clef request failed: ${describeErrors(body["errors"])}`);
    }
    return body["result"];
  }
  return body;
};

/**
 * Backend for Cloudflare Workers AI's Clef models.
 *
 * Uses the REST API by default (needs CLOUDFLARE_ACCOUNT_ID and
 * CLOUDFLARE_API_TOKEN), or a Workers AI binding when `binding` is given.
 * Credentials are read on the first call, so constructing this never fails.
 */
export const clef = (options: ClefOptions = {}): Backend => {
  const { model = "clef", binding, baseURL = DEFAULT_BASE_URL } = options;
  const modelId = `@cf/cloudflare/${model}`;

  const call = async (input: Readonly<Record<string, unknown>>): Promise<unknown> => {
    if (binding !== undefined) return unwrap(await binding.run(modelId, input));

    const accountId = options.accountId ?? env("CLOUDFLARE_ACCOUNT_ID");
    const apiToken = options.apiToken ?? env("CLOUDFLARE_API_TOKEN");
    if (accountId === undefined || apiToken === undefined) {
      throw makeAskError(
        "BACKEND_UNAVAILABLE",
        "The Clef backend needs a Cloudflare account id and API token. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, pass accountId and apiToken, or pass a Workers AI binding.",
      );
    }
    const response = await (options.fetch ?? fetch)(
      `${baseURL.replace(/\/+$/, "")}/accounts/${encodeURIComponent(accountId)}/ai/run/${modelId}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      const detail = describeErrors(isRecord(body) ? body["errors"] : undefined) || text.slice(0, 200);
      throw makeAskError("BACKEND_FAILED", `Clef request failed (HTTP ${response.status}): ${detail}`);
    }
    return unwrap(body);
  };

  return {
    name: "clef",
    limits: LIMITS,
    decide: async (state, questions) => {
      const { state: text, images } = extractImages(state);
      if (images.length > MAX_IMAGES) {
        throw makeAskError("BACKEND_FAILED", `Clef takes at most ${MAX_IMAGES} images per state, got ${images.length}.`);
      }
      const result = await call({
        model,
        state: toEntry(text),
        ...(images.length === 0 ? {} : { images }),
        questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, toClef(q)])),
      });
      const answers = isRecord(result) ? result["answers"] : undefined;
      if (!isRecord(answers)) throw makeAskError("BAD_RESPONSE", "Clef returned no answers.");
      return Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, fromClef(q, answers[id])]));
    },
  };
};

/**
 * The default instance, backed by Clef.
 * Reads CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the environment on first use.
 */
export const ask = createAsk({ backend: clef() });
