// Building instances against different OpenAI-compatible endpoints. Runs
// offline, no API key needed: constructing an `openai()` backend never
// touches the network — only calling it does, and this file never calls
// one. Also runs as an integration test — see test/examples.test.ts.
//
// Run with: npx tsx examples/backends.ts
import assert from "node:assert/strict";
import { createAsk } from "askif";
import { AzureOpenAI, BedrockOpenAI, openai } from "../src/index.js";

// The default `ask` uses gpt-6-luna. Make your own instance for a different
// model or endpoint.
const custom = createAsk({ backend: openai({ model: "gpt-6-sol" }) });

// Through OpenRouter, or any other OpenAI-compatible API that takes a plain
// bearer API key: just override `baseURL` (and usually `model`, since the
// model id namespace is provider-specific).
const viaOpenRouter = createAsk({
  backend: openai({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    model: "openai/gpt-6-luna",
  }),
});

// Through Google Cloud's Vertex AI, which also exposes a plain OpenAI-
// compatible endpoint — the same `baseURL` override works, but `apiKey` has
// to be a short-lived Google Cloud access token (e.g. from
// `gcloud auth print-access-token`, or a service account), not a static key.
const viaVertexAI = createAsk({
  backend: openai({
    apiKey: process.env.GOOGLE_ACCESS_TOKEN,
    baseURL: `https://aiplatform.googleapis.com/v1/projects/${process.env.GOOGLE_CLOUD_PROJECT}/locations/us-central1/endpoints/openapi`,
    model: "google/gemini-3.5-flash", // check Vertex AI's docs for current ids
  }),
});

// Azure OpenAI needs a different client class, not just a different
// `baseURL` — its auth and request routing (deployment-scoped paths, an
// `api-key` header, an `apiVersion` query param) differ from plain OpenAI.
// `AzureOpenAI` (re-exported from this package, so no separate `npm install
// openai` is needed) is a real subclass of the SDK's own `OpenAI` client, so
// it plugs into the `client` option directly.
//
// Unlike the other examples above, this constructs the client eagerly,
// right here — the `client` option means you build it yourself, so the
// usual "no network call until first use" laziness only goes as far as the
// constructor's own validation (it requires real-looking credentials even
// though it makes no network call itself).
const viaAzure = createAsk({
  backend: openai({
    client: new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY ?? "placeholder",
      endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? "https://example-resource.openai.azure.com/",
      deployment: "gpt-6-luna",
      // Required by the SDK (or set OPENAI_API_VERSION instead) — check
      // Azure's docs for the version your deployment actually supports,
      // this changes over time.
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2025-04-01-preview",
    }),
  }),
});

// Amazon Bedrock has its own client class too (`BedrockOpenAI`, also
// re-exported, also a subclass of `OpenAI`). It authenticates with a Bedrock
// API key (bearer token, not IAM/SigV4) and, like `AzureOpenAI`, is built
// eagerly here.
//
// Two things to know:
// - `BedrockOpenAI` derives a `bedrock-mantle` URL from `awsRegion`, but AWS
//   recommends the `bedrock-runtime` endpoint for new applications — pass its
//   `baseURL` explicitly to use that one.
// - `model` is required: the default (an OpenAI model id) doesn't exist on
//   Bedrock. gpt-oss models are reasoning models, so set an effort via `params`.
const viaBedrock = createAsk({
  backend: openai({
    client: new BedrockOpenAI({
      apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? "placeholder",
      baseURL: `https://bedrock-runtime.${process.env.AWS_REGION ?? "us-east-1"}.amazonaws.com/openai/v1`,
    }),
    model: "openai.gpt-oss-120b-1:0",
    params: { reasoning_effort: "low" },
  }),
});

// Gemini's own OpenAI-compatible API (Google AI Studio keys, not Vertex AI):
// a plain static API key as the bearer token. Google marks this layer beta.
const viaGemini = createAsk({
  backend: openai({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    model: "gemini-2.5-flash",
  }),
});

// Local servers speak the same protocol on localhost, so it's the same
// `baseURL` override. Ollama ignores the key but the SDK needs a non-empty
// one; `model` is whatever you've pulled/loaded.
const viaOllama = createAsk({
  backend: openai({
    apiKey: "ollama",
    baseURL: "http://localhost:11434/v1",
    model: "llama3.3",
  }),
});
// vLLM (http://localhost:8000/v1) and LM Studio (http://localhost:1234/v1)
// work the same way — see the README for what each documents about
// `response_format`, which this backend depends on.

// None of these instances made a network call yet — that only happens on
// first use.
assert.equal(typeof custom.if, "function");
assert.equal(typeof viaOpenRouter.if, "function");
assert.equal(typeof viaVertexAI.if, "function");
assert.equal(typeof viaAzure.if, "function");
assert.equal(typeof viaBedrock.if, "function");
assert.equal(typeof viaGemini.if, "function");
assert.equal(typeof viaOllama.if, "function");
