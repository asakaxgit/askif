import { extractImages, makeAskError } from "askif";
import type { Image, Json, Question, QuestionResult } from "askif";

/** JSON value the Decision API accepts inside instructions, criteria, and state. */
type Value = null | string | number | boolean | { readonly [key: string]: Value | undefined } | readonly Value[];

/** Top-level instructions and criterion text. Numbers and booleans become strings; null stays null. */
type Input = string | { readonly [key: string]: Value | undefined } | readonly Value[];

export type GatewayQuestion =
  | {
      readonly type: "boolean";
      readonly instructions: Input | null;
      readonly criteria?: { readonly true?: Input | null; readonly false?: Input | null };
    }
  | {
      readonly type: "choice";
      readonly instructions: Input | null;
      readonly criteria: Readonly<Record<string, Input | null>>;
    }
  | {
      readonly type: "score";
      readonly instructions: Input | null;
      readonly criteria: readonly (Input | null)[];
    };

export type SdkFilePart = { readonly type: "file"; readonly mediaType: string; readonly data: string };
export type SdkPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "json"; readonly value: Value }
  | SdkFilePart;

/** What `experimental_decide` accepts. A JSON array is a json part, because a bare array means parts. */
export type SdkState = string | { readonly [key: string]: Value | undefined } | readonly SdkPart[];

/** What `POST /v1/evaluate` accepts. A JSON array is the state itself, not a list of parts. */
export type HttpState = string | { readonly [key: string]: Value | undefined } | readonly Value[];

export type Prepared = {
  readonly http: HttpState;
  readonly sdk: SdkState;
  readonly questions: Readonly<Record<string, GatewayQuestion>>;
  readonly images: readonly Image[];
};

/** Gateway publishes no image count. This is askif's own cap when `images: true` is not overridden. */
export const DEFAULT_MAX_IMAGES = 16;

const IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toValue = (value: Json): Value => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(toValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toValue(entry)]));
};

const toInput = (value: Json): Input | null => {
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toValue(entry)]));
};

const imageOptions = (from: number, explicit: boolean): { readonly from: number; readonly only?: "image" } =>
  explicit ? { from, only: "image" as const } : { from };

const take = (value: Json, found: Image[], allowImages: boolean, imagesOff: string, explicit: boolean): Json => {
  const { state, images } = extractImages(value, imageOptions(found.length + 1, explicit));
  if (images.length > 0 && !allowImages) throw makeAskError("UNSUPPORTED_INPUT", imagesOff);
  found.push(...images);
  return state;
};

const encode = (value: Json, found: Image[], allowImages: boolean, imagesOff: string, explicit: boolean): Input | null =>
  toInput(take(value, found, allowImages, imagesOff, explicit));

const yesNoCriteria = (
  criteria: { readonly true?: Json; readonly false?: Json } | undefined,
  found: Image[],
  allowImages: boolean,
  imagesOff: string,
  explicit: boolean,
): { readonly true?: Input | null; readonly false?: Input | null } | undefined => {
  if (criteria === undefined) return undefined;
  const encoded: { true?: Input | null; false?: Input | null } = {};
  if (criteria.true !== undefined) encoded.true = encode(criteria.true, found, allowImages, imagesOff, explicit);
  if (criteria.false !== undefined) encoded.false = encode(criteria.false, found, allowImages, imagesOff, explicit);
  return encoded.true === undefined && encoded.false === undefined ? undefined : encoded;
};

const toQuestion = (
  question: Question,
  found: Image[],
  allowImages: boolean,
  imagesOff: string,
  explicit: boolean,
): GatewayQuestion => {
  const instructions = encode(question.instructions, found, allowImages, imagesOff, explicit);
  switch (question.kind) {
    case "yesno": {
      const criteria = yesNoCriteria(question.criteria, found, allowImages, imagesOff, explicit);
      return criteria === undefined ? { type: "boolean", instructions } : { type: "boolean", instructions, criteria };
    }
    case "choice":
      return {
        type: "choice",
        instructions,
        criteria: Object.fromEntries(
          question.options.map((option) => [
            option.key,
            encode(option.description, found, allowImages, imagesOff, explicit),
          ]),
        ),
      };
    case "scale":
      return {
        type: "score",
        instructions,
        criteria: question.levels.map((level) => encode(level, found, allowImages, imagesOff, explicit)),
      };
    default:
      return question satisfies never;
  }
};

const normalizeState = (value: Json): HttpState => {
  if (value === null) throw makeAskError("UNSUPPORTED_INPUT", "The Vercel backend does not accept null as the state.");
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toValue(entry)]));
};

/**
 * Pull images out of the state and the questions, then map questions to the Decision API.
 * Image numbering starts at 1 on the state and continues through each question, via `extractImages(..., { from })`.
 * `explicit` lifts only `image()` values. Omit it, or pass false, for the historical extraction.
 */
export const prepare = (
  state: Json,
  questions: Readonly<Record<string, Question>>,
  allowImages: boolean,
  maxImages: number,
  imagesOff: string,
  explicit = false,
): Prepared => {
  const found: Image[] = [];
  const stripped = normalizeState(take(state, found, allowImages, imagesOff, explicit));
  const wire = Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      toQuestion(question, found, allowImages, imagesOff, explicit),
    ]),
  );
  if (found.length > maxImages) {
    throw makeAskError(
      "UNSUPPORTED_INPUT",
      `The Vercel backend accepts at most ${maxImages} images per request, got ${found.length}.`,
    );
  }
  for (const image of found) {
    if (!IMAGE_TYPES.includes(image.source.mediaType)) {
      throw makeAskError(
        "UNSUPPORTED_INPUT",
        `The Vercel backend sends PNG, JPEG, WebP and GIF images, not ${image.source.mediaType}.`,
      );
    }
  }
  return { http: stripped, sdk: toSdkState(stripped, found), questions: wire, images: found };
};

/**
 * AI SDK `state` treats a bare array as parts. A JSON array therefore becomes one json part.
 * File parts are added only when this request actually has images.
 */
const isJsonArray = (state: HttpState): state is readonly Value[] => Array.isArray(state);

const toSdkState = (state: HttpState, images: readonly Image[]): SdkState => {
  const files: SdkFilePart[] = images.map((image) => ({
    type: "file",
    mediaType: image.source.mediaType,
    data: image.source.data,
  }));
  if (files.length === 0 && typeof state === "string") return state;
  if (files.length === 0 && !isJsonArray(state)) return state;
  const head: SdkPart = typeof state === "string" ? { type: "text", text: state } : { type: "json", value: state };
  return [head, ...files];
};

const bad = (kind: Question["kind"]): never => {
  throw makeAskError("BAD_RESPONSE", `Vercel AI Gateway returned no valid ${kind} answer.`);
};

const readProbability = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;

const readConfidence = (record: Readonly<Record<string, unknown>>): number | undefined =>
  readProbability(record["confidence"]);

const distribution = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  isRecord(value) && Object.keys(value).length > 0 ? value : undefined;

const choiceProbabilities = (
  question: Extract<Question, { kind: "choice" }>,
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, number>> => {
  const values = question.options.map((option) => readProbability(record[option.key]));
  if (values.every((value) => value === undefined)) bad(question.kind);
  return Object.fromEntries(question.options.map((option, index) => [option.key, values[index] ?? 0]));
};

const oneHot = (question: Extract<Question, { kind: "choice" }>, choice: string): Readonly<Record<string, number>> =>
  Object.fromEntries(question.options.map((option) => [option.key, option.key === choice ? 1 : 0]));

const scoreProbabilities = (levels: number, record: Readonly<Record<string, unknown>>): readonly number[] => {
  const values = Array.from({ length: levels }, (_, index) => readProbability(record[String(index)]));
  if (values.every((value) => value === undefined)) bad("scale");
  return values.map((value) => value ?? 0);
};

/** A two-point distribution whose mean is `score`, used when the model omits probabilities. */
const synthesizeScore = (score: number, levels: number): readonly number[] => {
  const top = levels - 1;
  if (score < 0 || score > top) bad("scale");
  const lower = Math.floor(score);
  const upper = Math.ceil(score);
  const probabilities = Array.from({ length: levels }, () => 0);
  if (lower === upper) {
    probabilities[lower] = 1;
    return probabilities;
  }
  const fraction = score - lower;
  probabilities[lower] = 1 - fraction;
  probabilities[upper] = fraction;
  return probabilities;
};

const metadataConfidence = (metadata: unknown, id: string): number | undefined => {
  if (!isRecord(metadata)) return undefined;
  for (const namespace of ["typesafe", "perplexity"]) {
    const block = metadata[namespace];
    if (!isRecord(block) || !isRecord(block["confidence"])) continue;
    const value = readProbability(block["confidence"][id]);
    if (value !== undefined) return value;
  }
  return undefined;
};

const fromAnswer = (question: Question, answer: unknown, reported: number | undefined): QuestionResult => {
  try {
    if (!isRecord(answer)) return { error: bad(question.kind) };
    if (answer["type"] === "refusal") {
      return { error: makeAskError("BAD_RESPONSE", "The model refused this question.") };
    }
    const confidence = readConfidence(answer) ?? reported;
    switch (question.kind) {
      case "yesno": {
        if (answer["type"] !== "boolean") return { error: bad(question.kind) };
        const probability = readProbability(answer["probability"]);
        return probability === undefined ? { error: bad(question.kind) } : { kind: "yesno", probability };
      }
      case "choice": {
        if (answer["type"] !== "choice") return { error: bad(question.kind) };
        const probabilities = distribution(answer["probabilities"]);
        if (probabilities !== undefined) {
          return {
            kind: "choice",
            probabilities: choiceProbabilities(question, probabilities),
            ...(confidence === undefined ? {} : { confidence }),
          };
        }
        const choice = answer["choice"];
        if (typeof choice !== "string" || !question.options.some((option) => option.key === choice)) {
          return { error: bad(question.kind) };
        }
        return { kind: "choice", probabilities: oneHot(question, choice), confidence: confidence ?? 0 };
      }
      case "scale": {
        if (answer["type"] !== "score") return { error: bad(question.kind) };
        const probabilities = distribution(answer["probabilities"]);
        if (probabilities !== undefined) {
          return {
            kind: "scale",
            probabilities: scoreProbabilities(question.levels.length, probabilities),
            ...(confidence === undefined ? {} : { confidence }),
          };
        }
        const score = answer["score"];
        if (typeof score !== "number" || !Number.isFinite(score)) return { error: bad(question.kind) };
        return {
          kind: "scale",
          probabilities: synthesizeScore(score, question.levels.length),
          confidence: confidence ?? 0,
        };
      }
      default:
        return question satisfies never;
    }
  } catch (error) {
    return { error };
  }
};

export const readAnswers = (
  questions: Readonly<Record<string, Question>>,
  answers: unknown,
  providerMetadata?: unknown,
): Readonly<Record<string, QuestionResult>> => {
  if (!isRecord(answers)) throw makeAskError("BAD_RESPONSE", "Vercel AI Gateway returned no answers.");
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      fromAnswer(question, answers[id], metadataConfidence(providerMetadata, id)),
    ]),
  );
};
