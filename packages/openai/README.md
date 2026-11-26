# @askif/openai

The [askif](https://www.npmjs.com/package/askif) backend for OpenAI, with a ready-to-use `ask`. Also works with OpenRouter, Google Cloud's Vertex AI, Azure OpenAI, Amazon Bedrock, and self-hosted OpenAI-compatible servers — see [Other endpoints](#other-endpoints).

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
| `structuredOutput: "prompt"` and `"json_object"` | Unverified | Offline tests cover the request body and lenient parsing. `live/openai.test.ts` runs both modes on OpenAI, and `"prompt"` on a local server when `OLLAMA_BASE_URL` and `OLLAMA_MODEL` are set. No passing run recorded yet |
| Ollama, vLLM, LM Studio, llama.cpp | Unverified | Documentation only (see the table above) |

## License

MIT
