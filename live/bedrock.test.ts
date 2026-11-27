// Live calls to Amazon Bedrock's OpenAI-compatible Chat Completions, through `BedrockOpenAI`.
// Skipped unless AWS_BEARER_TOKEN_BEDROCK (a Bedrock API key) and AWS_REGION are set; the
// region needs openai.gpt-oss-120b enabled.
//
// Both endpoints are passed an explicit baseURL. AWS's gpt-oss-120b model card lists
// bedrock-runtime at /openai/v1 and bedrock-mantle at /v1 ("not /openai/v1"), while the SDK
// derives https://bedrock-mantle.<region>.api.aws/openai/v1 from `awsRegion`. The third test
// probes that derived URL and logs what Bedrock says, the way clef.test.ts probes its 413.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk } from "../packages/askif/src/index.js";
import { BedrockOpenAI, openai } from "../packages/openai/src/index.js";
import { CAT, assertClearDecisions } from "./decisions.js";
import { assertAskError, assertProbability, onlyCall, recordingFetch, requiredEnv, skipWithout } from "./support.js";
import type { SeenRequest } from "./support.js";

// Bedrock compiles a grammar the first time it sees a schema, which AWS says can take ~90 s,
// so the per-attempt timeout is longer than the other live suites' 45 s.
const CLIENT_TIMEOUT_MS = 110_000;
const live = { skip: skipWithout("AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"), timeout: 4 * CLIENT_TIMEOUT_MS };

// gpt-oss models reason; "none" isn't one of their efforts.
const PARAMS = { reasoning_effort: "low" } as const;

const bedrock = (baseURL: string | undefined, seen: SeenRequest[]) =>
  new BedrockOpenAI({
    apiKey: requiredEnv("AWS_BEARER_TOKEN_BEDROCK"),
    ...(baseURL === undefined ? { awsRegion: requiredEnv("AWS_REGION") } : { baseURL }),
    timeout: CLIENT_TIMEOUT_MS,
    maxRetries: 0,
    fetch: recordingFetch(seen),
  });

const assertEndpoint = (seen: readonly SeenRequest[], expected: string): void => {
  assert.ok(seen.length > 0, "expected at least one live request");
  for (const call of seen) assert.equal(call.url, expected);
};

test("Bedrock bedrock-runtime /openai/v1: ask.if, ask.switch, ask.score, and ask.probability", live, async () => {
  const region = requiredEnv("AWS_REGION");
  const seen: SeenRequest[] = [];
  const baseURL = `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`;
  const ask = createAsk({
    backend: openai({ client: bedrock(baseURL, seen), model: "openai.gpt-oss-120b-1:0", params: PARAMS }),
  });
  await assertClearDecisions(ask);
  assertEndpoint(seen, `${baseURL}/chat/completions`);
});

test("Bedrock bedrock-mantle /v1: ask.if, ask.switch, ask.score, and ask.probability", live, async () => {
  const region = requiredEnv("AWS_REGION");
  const seen: SeenRequest[] = [];
  const baseURL = `https://bedrock-mantle.${region}.api.aws/v1`;
  const ask = createAsk({
    backend: openai({ client: bedrock(baseURL, seen), model: "openai.gpt-oss-120b", params: PARAMS }),
  });
  await assertClearDecisions(ask);
  assertEndpoint(seen, `${baseURL}/chat/completions`);
});

test("Bedrock: the SDK's awsRegion-derived mantle URL (/openai/v1) with gpt-oss", live, async () => {
  const region = requiredEnv("AWS_REGION");
  const seen: SeenRequest[] = [];
  const ask = createAsk({
    backend: openai({ client: bedrock(undefined, seen), model: "openai.gpt-oss-120b", params: PARAMS }),
  });
  try {
    const probability = await ask.probability(CAT, "is a living animal");
    assertProbability(probability, "derived mantle URL");
    console.log(`derived mantle /openai/v1 answered gpt-oss: probability ${probability}`);
  } catch (error) {
    const askError = assertAskError(error);
    const cause = askError.cause instanceof Error ? ` (${askError.cause.message})` : "";
    console.log(`derived mantle /openai/v1 rejected gpt-oss: ${askError.code} ${askError.message}${cause}`);
  }
  assert.equal(onlyCall(seen).url, `https://bedrock-mantle.${region}.api.aws/openai/v1/chat/completions`);
});
