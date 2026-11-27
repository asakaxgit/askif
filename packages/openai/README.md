# @askif/openai

The [askif](https://www.npmjs.com/package/askif) backend for OpenAI, with a ready-to-use `ask`. Also works with OpenRouter, Google Cloud's Vertex AI, Azure OpenAI, Amazon Bedrock, hosted providers such as Groq and Mistral, gateways such as LiteLLM, and self-hosted OpenAI-compatible servers — see [Other endpoints](#other-endpoints).

```sh
npm install askif @askif/openai
export OPENAI_API_KEY=...
```

```ts
import { ask } from "@askif/openai";

await ask.if("cat", "is animal", () => {
  console.log("cat is animal");
});
```

Full documentation, the `ask.if`/`ask.switch`/`ask.score` guide, and runnable examples live in the [main repo README](https://github.com/asakaxgit/askif#readme).

## Images

Put images in the state with `image()` from `askif` (PNG, JPEG, WebP, or non-animated GIF). They are sent as `image_url` data URLs after the question text, and each one is an `[image N]` placeholder in the state, so a question can refer to "image 1".

```ts
import { image } from "askif";

await ask.if({ photo: image(bytes) }, "shows a cat");
```

`imageUrl(url)` from `askif` sends the URL itself as the `image_url`, and OpenAI fetches it. This applies to OpenAI only, meaning no `baseURL` or `client`, and the backend then advertises `imageSources: ["url"]`. For a compatible endpoint that also fetches URLs, set `openai({ imageUrls: true })`. Otherwise askif downloads the image with the `resolveImage` you give `createAsk` and sends a data URL (see [Images at a URL or in a bucket](https://github.com/asakaxgit/askif#images-at-a-url-or-in-a-bucket)). If you point `OPENAI_BASE_URL` at another endpoint, also set `imageUrls: false`. URL images have not been tried live yet.

Every question carries its images, so N questions about an image send it N times. The request shape follows the SDK's types and is covered by offline tests. `live/openai.test.ts` sends one small fixture image when `OPENAI_API_KEY` is set; that run is not part of `pnpm run check`, and a passing live result is not recorded in this repo yet.

## How it works

- Every question is sent as its own request, in parallel — this backend has no native
  multi-question batching the way `@askif/jev` does, so `askif`'s "same state, same tick" batching
  becomes N parallel requests instead of one.
- Probabilities are the model's own JSON estimates (via [Structured
  Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)), not logprobs —
  logprobs aren't available uniformly across OpenAI-compatible providers.
  `structuredOutput` picks how the JSON shape is enforced; see [Structured
  output](#structured-output).
- `askif` computes `confidence` from how spread out those probabilities are; this backend never
  self-reports one.
- The default model is `gpt-6-luna` (OpenAI's cheapest, fastest model), sent with
  `reasoning_effort: "none"`. Pass `model` to use a different one — no `reasoning_effort` is sent
  by default in that case, since non-reasoning or third-party models can reject it.
- `params` passes extra fields (`temperature`, `reasoning_effort`, etc.) through to every request,
  applied after this backend's own defaults so they can override them.
- The state is wrapped in a random `<state-…>` tag. The system prompt says that tag is the only
  state, and that text inside it is not an instruction. `openai({ protection: false })`, or core
  `protection: false`, sends the previous prompt, with `<state>` and `</state>`.

## Structured output

`structuredOutput` sets how each reply is held to the answer's JSON shape. It defaults to
`"json_schema"`, and with the default the request is the same as before the option existed.

| `structuredOutput` | Request | Reply parsing |
| --- | --- | --- |
| `"json_schema"` (default) | `response_format: { type: "json_schema", json_schema: { …, strict: true } }` | The whole reply must be the JSON object |
| `"json_object"` | `response_format: { type: "json_object" }` (JSON mode), and the JSON Schema written at the end of the user message | Lenient (below) |
| `"prompt"` | No `response_format`, and the JSON Schema written at the end of the user message | Lenient (below) |

Use `"prompt"` for endpoints that reject `response_format: json_schema` (a 400) or ignore it
(prose or the wrong keys back, which surfaces as `BAD_RESPONSE`). Ollama and some llama.cpp
builds are in that group. Use `"json_object"` where the endpoint supports JSON mode but not JSON
Schema. Neither mode can make the model follow the schema, so expect more `BAD_RESPONSE` than with
`"json_schema"`, especially from small models.

In both fallback modes, the parser drops `<think>…</think>` blocks and reads from the first `{`
to the last `}`. A reply wrapped in a code fence or a sentence still parses. The probabilities are
checked the same way as in the default mode.

```ts
import { openai } from "@askif/openai";

const viaOllama = openai({
  apiKey: "ollama",
  baseURL: "http://localhost:11434/v1",
  model: "llama3.3",
  structuredOutput: "prompt",
});
```

## Other endpoints

`baseURL` (from `ClientOptions`, passed straight through) switches to any OpenAI-compatible API
that takes a plain bearer API key — including [OpenRouter](https://openrouter.ai) and Google
Cloud's [Vertex AI](https://cloud.google.com/vertex-ai) (whose `apiKey` needs to be a short-lived
Google Cloud access token, not a static key). For a token read from Application Default
Credentials on every request, and for falling back here when Jev is missing or a Jev call
fails, use [`@askif/vertex`](../vertex) instead of pasting a token into `apiKey`:

```ts
import { openai } from "@askif/openai";

const viaOpenRouter = openai({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  model: "openai/gpt-6-luna",
});
```

### Gemini

Google's [OpenAI-compatible Gemini API](https://ai.google.dev/gemini-api/docs/openai) takes a plain
Google AI Studio API key, so it's just a `baseURL` (this is separate from Vertex AI above, which
needs an access token). Google labels the compatibility layer beta and documents that some
parameters are ignored, so check that `response_format` behaves as you expect for your model:

```ts
import { openai } from "@askif/openai";

const viaGemini = openai({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: "gemini-2.5-flash",
});
```

### Hosted providers

These take a plain API key as the bearer token, so each one is a `baseURL` and that provider's
own `model` id:

```ts
import { openai } from "@askif/openai";

const viaGroq = openai({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
  model: "openai/gpt-oss-120b",
});
```

| Provider | `baseURL` | What its docs say about `response_format` | `structuredOutput` |
| --- | --- | --- | --- |
| [Groq](https://console.groq.com/docs/structured-outputs) | `https://api.groq.com/openai/v1` | `json_schema` with `strict: true` on a few listed models (gpt-oss among them). Other models get best-effort `json_schema` or `json_object` | Default on the strict models, `"json_object"` on the rest |
| [Together AI](https://docs.together.ai/docs/json-mode) | `https://api.together.ai/v1` | `json_schema` on supported models | Default |
| [Fireworks AI](https://docs.fireworks.ai/structured-responses/structured-response-formatting) | `https://api.fireworks.ai/inference/v1` | `json_schema` and `json_object` | Default |
| [DeepInfra](https://docs.deepinfra.com/chat/structured-outputs) | `https://api.deepinfra.com/v1/openai` | `json_schema` and `json_object`, on many models | Default |
| [Mistral](https://docs.mistral.ai/inference/conversations/structured-output/custom) | `https://api.mistral.ai/v1` | `json_schema` with `strict` | Default |
| [xAI](https://docs.x.ai/docs/guides/structured-outputs) | `https://api.x.ai/v1` | `json_schema` | Default |
| [DeepSeek](https://api-docs.deepseek.com/guides/json_mode) | `https://api.deepseek.com` | `json_object` only. The prompt must contain the word "json", and the reply can come back empty | `"json_object"` |
| [Cerebras](https://inference-docs.cerebras.ai/capabilities/structured-outputs) | `https://api.cerebras.ai/v1` | `json_schema` with `strict: true`, which needs `additionalProperties: false` on every object, and `json_object` | Default |

The last column is what each provider's docs suggest. None of these has been tested live against
this package. `"json_object"` writes the schema into the user message, which includes the word
"JSON", so DeepSeek's requirement is met. DeepSeek's empty reply surfaces as `BAD_RESPONSE`. The
schemas this backend sends already set `additionalProperties: false` on every object (the same
subset Bedrock needs, below).

```ts
import { openai } from "@askif/openai";

const viaDeepSeek = openai({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
  model: "deepseek-flash",
  structuredOutput: "json_object",
});
```

### Gateways

A gateway in front of several providers is also a `baseURL`. The model id is the gateway's, and
whether `response_format: json_schema` works depends on the provider behind it.

[LiteLLM](https://docs.litellm.ai/docs/proxy/user_keys) proxy listens on port 4000 by default. The
`apiKey` is a LiteLLM virtual key, and `model` is a model name from the proxy's config. LiteLLM
passes `json_schema` through to providers that support it; see its [JSON mode
docs](https://docs.litellm.ai/docs/completion/json_mode) for which ones do.

```ts
import { openai } from "@askif/openai";

const viaLiteLLM = openai({
  apiKey: process.env.LITELLM_API_KEY,
  baseURL: "http://localhost:4000/v1",
  model: "gpt-6-luna", // a model_name from the proxy's config
});
```

[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/)'s
unified endpoint is `/compat` under your account and gateway, and `model` is
`{provider}/{model}`. With provider keys stored in Cloudflare (BYOK), `apiKey` is a Cloudflare API
token. On an authenticated gateway that holds no provider key, `apiKey` is the provider's key, and
the Cloudflare token goes in a `cf-aig-authorization` header (`defaultHeaders` comes from
`ClientOptions` too):

```ts
import { openai } from "@askif/openai";

const viaCloudflare = openai({
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: { "cf-aig-authorization": `Bearer ${process.env.CF_AIG_TOKEN}` },
  baseURL: `https://gateway.ai.cloudflare.com/v1/${process.env.CF_ACCOUNT_ID}/default/compat`,
  model: "openai/gpt-6-luna",
});
```

This is AI Gateway's OpenAI-compatible chat endpoint, which is not the same thing as Cloudflare
Workers AI's Clef. Clef uses the System One format and batches questions into one request; use
[`@askif/clef`](../clef) for it.

Vercel AI Gateway also has an OpenAI-compatible endpoint, but its Decision API is the better fit
for askif. It takes askif's questions as they are, sends the questions about one state in a single
request, and reports cost. Use
[`@askif/vercel`](../vercel) for it: `vercel()` posts to `POST /v1/evaluate`, and `vercelDecide()`
calls AI SDK `experimental_decide`.

### Local servers

Self-hosted servers expose the same protocol on localhost, so again it's a `baseURL`. The SDK
insists on a non-empty `apiKey` even when the server ignores it, and `model` is whatever you've
pulled or loaded:

```ts
import { openai } from "@askif/openai";

const viaOllama = openai({
  apiKey: "ollama",
  baseURL: "http://localhost:11434/v1",
  model: "llama3.3",
});
```

| Server | Default `baseURL` | What its docs say about `response_format` |
| --- | --- | --- |
| [Ollama](https://docs.ollama.com/api/openai-compatibility) | `http://localhost:11434/v1` | Documents JSON mode; `json_schema` isn't listed |
| [vLLM](https://docs.vllm.ai) | `http://localhost:8000/v1` | Supports `json_schema` (structured outputs) |
| [LM Studio](https://lmstudio.ai/docs) | `http://localhost:1234/v1` | Supports `json_schema` |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) server | `http://localhost:8080/v1` | Documents `json_schema`, but there are reports of it not being honored on `/v1/chat/completions` |

By default this backend depends on `response_format: json_schema`. The default prompt describes
the question but never spells out the JSON keys, so an endpoint that ignores `response_format`
will most likely return prose or the wrong shape, surfacing as `BAD_RESPONSE`. For those
endpoints, set `structuredOutput: "prompt"` (or `"json_object"`); see [Structured
output](#structured-output). The table reflects each project's documentation only; none of these
has been tested live against this package.

Azure OpenAI needs a different client class, not just a different `baseURL` — its auth and request
routing genuinely differ from plain OpenAI. `AzureOpenAI` is re-exported from this package (a real
subclass of the SDK's own client, so no separate `npm install openai` is needed) and plugs into the
`client` option directly:

```ts
import { AzureOpenAI, openai } from "@askif/openai";

const viaAzure = openai({
  client: new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: "gpt-6-luna",
    apiVersion: "2025-04-01-preview", // check Azure's docs for your deployment's version
  }),
});
```

Amazon Bedrock also has its own client class, `BedrockOpenAI` (re-exported the same way). It
authenticates with a Bedrock API key (a bearer token — IAM/SigV4 credentials aren't supported by
this client; `bedrockTokenProvider` can supply refreshable tokens), and `model` is required, since
the default is an OpenAI model id that doesn't exist on Bedrock:

```ts
import { BedrockOpenAI, openai } from "@askif/openai";

const viaBedrock = openai({
  client: new BedrockOpenAI({
    apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK,
    baseURL: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
  }),
  model: "openai.gpt-oss-120b-1:0",
  params: { reasoning_effort: "low" }, // gpt-oss models reason; "none" isn't one of their efforts
});
```

- Always pass `baseURL`. Without it, `BedrockOpenAI` (openai SDK 7.23) derives
  `https://bedrock-mantle.<region>.api.aws/openai/v1` from `awsRegion`, but on `bedrock-mantle` the
  path prefix depends on the model, and AWS's gpt-oss model cards put those models under `/v1`,
  "not `/openai/v1`". A request sent to the wrong prefix fails with
  `` model `<id>` isn't supported on this route ``. Check the model card's **Programmatic Access**
  table for your model's prefix.

  | Endpoint | `baseURL` | gpt-oss model id |
  | --- | --- | --- |
  | `bedrock-runtime` (AWS recommends this one for new applications) | `https://bedrock-runtime.<region>.amazonaws.com/openai/v1` | `openai.gpt-oss-120b-1:0` |
  | `bedrock-mantle` | `https://bedrock-mantle.<region>.api.aws/v1` | `openai.gpt-oss-120b` |
- This backend depends on `response_format: json_schema` (Structured Outputs). AWS's
  structured-output page names `response_format` as the field for open-weight models, but its table
  of supported APIs lists `InvokeModel` and `Converse`, not the OpenAI-compatible Chat Completions
  endpoints. This has not been run against Bedrock yet (see [Verification](#verification)). A 400
  on the first call means your model or endpoint doesn't accept it.
- Bedrock accepts only a subset of JSON Schema: every object must set `additionalProperties: false`,
  and numeric or length constraints (`minimum`, `maxLength`, …) are rejected. The schemas this
  backend sends stay inside that subset, and an offline test checks it.
- The first request with a new schema can take about 90 seconds while Bedrock compiles a grammar
  (yes/no, choice, and scale questions are three different schemas, and every new set of options or
  levels is another one). AWS suggests a client timeout of at least 120 seconds.

See [`examples/backends.ts`](./examples/backends.ts) for all of these together, plus the one
caveat of using `client` (Azure and Bedrock both): it's constructed eagerly, right there, so —
unlike the `baseURL` form, which this package constructs lazily on first use — its own validation
(real-looking credentials) runs immediately rather than being deferred.

## Verification

**Verified** means a live run against the real endpoint passed. **Unverified** means only
documentation and offline tests stand behind it. The live suites in the repo's `live/` directory
are skipped unless their credentials are set, and they are not part of `pnpm run check`.

| Endpoint | Status | Evidence |
| --- | --- | --- |
| OpenAI, `gpt-6-luna`, text | Verified | Live smoke test, 2026-09-30: no `BAD_RESPONSE`. `live/openai.test.ts` |
| OpenAI, image input | Unverified | `live/openai.test.ts` sends one fixture image. No passing run recorded yet |
| Amazon Bedrock, `bedrock-runtime` and `bedrock-mantle` | Unverified | Offline tests cover the request URL, bearer auth, and the schema subset. `live/bedrock.test.ts` (`pnpm run test:live:bedrock`) has not been run yet |
| Azure OpenAI | Unverified | Documentation only. `examples/backends.ts` builds the client but sends no request |
| Vertex AI | Unverified | Offline tests in [`@askif/vertex`](../vertex) only |
| OpenRouter, Gemini | Unverified | Documentation only |
| Groq, Together AI, Fireworks AI, DeepInfra, Mistral, xAI, DeepSeek, Cerebras | Unverified | Documentation only (see [Hosted providers](#hosted-providers)). `examples/backends.ts` builds them but sends no request |
| LiteLLM, Cloudflare AI Gateway | Unverified | Documentation only (see [Gateways](#gateways)) |
| `structuredOutput: "prompt"` and `"json_object"` | Unverified | Offline tests cover the request body and lenient parsing. `live/openai.test.ts` runs both modes on OpenAI, and `"prompt"` on a local server when `OLLAMA_BASE_URL` and `OLLAMA_MODEL` are set. No passing run recorded yet |
| Ollama, vLLM, LM Studio, llama.cpp | Unverified | Documentation only (see the table above) |

## License

MIT
