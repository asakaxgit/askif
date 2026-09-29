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

## How it works

- Every question is sent as its own request, in parallel — this backend has no native
  multi-question batching the way `@askif/jev` does, so `askif`'s "same state, same tick" batching
  becomes N parallel requests instead of one.
- Probabilities are the model's own JSON estimates (via [Structured
  Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)), not logprobs —
  logprobs aren't available uniformly across OpenAI-compatible providers.
- `askif` computes `confidence` from how spread out those probabilities are; this backend never
  self-reports one.
- The default model is `gpt-6-luna` (OpenAI's cheapest, fastest model), sent with
  `reasoning_effort: "none"`. Pass `model` to use a different one — no `reasoning_effort` is sent
  by default in that case, since non-reasoning or third-party models can reject it.
- `params` passes extra fields (`temperature`, `reasoning_effort`, etc.) through to every request,
  applied after this backend's own defaults so they can override them.

## Other endpoints

`baseURL` (from `ClientOptions`, passed straight through) switches to any OpenAI-compatible API
that takes a plain bearer API key — including [OpenRouter](https://openrouter.ai) and Google
Cloud's [Vertex AI](https://cloud.google.com/vertex-ai) (whose `apiKey` needs to be a short-lived
Google Cloud access token, not a static key):

```ts
import { openai } from "@askif/openai";

const viaOpenRouter = openai({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  model: "openai/gpt-6-luna",
});
```

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

- `BedrockOpenAI` derives a `bedrock-mantle` endpoint from `awsRegion` if you don't pass `baseURL`;
  AWS recommends `bedrock-runtime` for new applications, so pass its `baseURL` as above to use that.
  Model ids differ between the two endpoints (e.g. `openai.gpt-oss-120b-1:0` on `bedrock-runtime`,
  `openai.gpt-oss-120b` on `bedrock-mantle`).
- This backend depends on `response_format: json_schema` (Structured Outputs). AWS documents
  structured outputs for open-weight models on `InvokeModel`/`Converse` and doesn't list the
  OpenAI-compatible Chat Completions endpoints in that support table either way, so confirm your
  model and endpoint accept it — a 400 from Bedrock on the first call is the sign they don't.

See [`examples/backends.ts`](./examples/backends.ts) for all of these together, plus the one
caveat of using `client` (Azure and Bedrock both): it's constructed eagerly, right there, so —
unlike the `baseURL` form, which this package constructs lazily on first use — its own validation
(real-looking credentials) runs immediately rather than being deferred.

## License

MIT
