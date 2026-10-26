# @askif/vercel

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway/modalities/decision)'s Decision API for [askif](https://github.com/asakaxgit/askif).

Two backends, one package:

- `vercel()` posts to `POST /v1/evaluate` with `fetch`. It has no runtime dependency.
- `vercelDecide()` calls AI SDK `experimental_decide` (`ai` 7.0.128 or newer). Earlier AI SDK 7 builds expose the same call as the deprecated `experimental_evaluate`.

```sh
npm install @askif/vercel askif
export AI_GATEWAY_API_KEY=...
```

`AI_GATEWAY_API_KEY` is the name the AI SDK reads. Create a key in the Vercel dashboard for AI Gateway. This repo's live test uses the same name as a GitHub Actions secret (see the root README's Live tests section). The job skips when the secret is missing.

```ts
import { ask } from "@askif/vercel";

await ask.if(ticket, "is urgent", () => page()).else(() => queue());
```

The default `ask` is `vercel()`: HTTP, model `typesafe-ai/jev`. It does not load `ai`.

## HTTP

```ts
import { createAsk } from "askif";
import { vercel } from "@askif/vercel";

const ask = createAsk({
  backend: vercel({
    model: "typesafe-ai/jev",              // default
    apiKey: process.env.AI_GATEWAY_API_KEY, // default: AI_GATEWAY_API_KEY
    baseURL: "https://ai-gateway.vercel.sh", // origin only; the path /v1/evaluate is added
  }),
});
```

Checked against the [Decision](https://vercel.com/docs/ai-gateway/modalities/decision) page (2026-10-26). The body is `{ model, state, questions, providerOptions }`. `state` is a string, a JSON object, or a JSON array. Authorization is `Bearer`. The response carries `answers`, `usage` (`inputTokens`, `outputTokens`), and `providerMetadata.gateway` (`cost`, `marketCost`, `surchargeCost`, `gatewayCost`, `generationId`). `cost` is a decimal string.

## AI SDK

```sh
npm install ai
```

`ai` depends on `zod` (`^3.25.76` or `^4.1.8`). `@askif/vercel` lists `ai` as an optional peer and imports it only when `vercelDecide()` actually runs.

```ts
import { createAsk } from "askif";
import { vercelDecide } from "@askif/vercel";

const ask = createAsk({
  backend: vercelDecide({
    model: "typesafe-ai/jev",
    apiKey: process.env.AI_GATEWAY_API_KEY,
    maxRetries: 0, // SDK default is 2
  }),
});
```

A string model with no `apiKey`, `baseURL`, or `fetch` is passed through to `experimental_decide`. The SDK resolves it with AI Gateway unless `globalThis.AI_SDK_DEFAULT_PROVIDER` is set, in which case that provider must implement `decisionModel`. Pass `apiKey` (or `baseURL` or `fetch`) to force `createGateway({ ... }).decisionModel(id)` instead.

`baseURL` here is the SDK prefix. The SDK default is `https://ai-gateway.vercel.sh/v4/ai`, and the request path ends in `/decision-model`. Do not reuse the HTTP origin: `https://ai-gateway.vercel.sh` plus `/v4/ai` is the SDK prefix, and `/v1/evaluate` is a different API.

You can pass a v4 decision model instance (`specificationVersion: "v4"`, `provider`, `modelId`, and `doDecide`). `apiKey`, `baseURL`, and `fetch` are not applied to an instance you already built.

`experimental_decide` is still experimental in `ai@7`. Pin `ai` to a version you have tested.

## Questions

| askif | wire |
| --- | --- |
| yes/no | `boolean` (probability of true) |
| `switch` | `choice` (each option's description is the criterion; a missing description is `null`) |
| `score` | `score` (levels in order, from the low end) |

Top-level numbers and booleans in the state, instructions, or criteria are sent as strings. Nested numbers and booleans stay JSON. `null` is not a state.

askif names questions `q0`, `q1`, ... inside one call. A fallback `when.question` has to use those ids, or omit `question` to match every question of that kind.

Choice and score probabilities are copied when the response has them. A missing key in an otherwise present distribution is 0. An empty `{}` counts as missing. When a choice or score answer has no distribution (language-model fallbacks do this), askif builds a one-hot choice, or a two-point score whose mean is the reported `score`, and sets `confidence` to 0 so `.unsure()` does not treat that stand-in as certain. A distribution that is present keeps the model's probabilities, and askif computes confidence from them unless the answer or `providerMetadata.typesafe.confidence` / `providerMetadata.perplexity.confidence` (keyed by question id) reports one.

An HTTP answer of `{ type: "refusal" }` fails that question with `BAD_RESPONSE` and leaves the others. The AI SDK throws for a refusal and does not return the other answers, so `vercelDecide` fails the whole call with `BACKEND_FAILED`.

Box questions are part of the AI SDK and are not part of askif.

## Batching

Questions about one state go out as one request. Questions about different states stay in separate requests. `multiState` is off. The Decision API decides one shared state per call, and packing unrelated states into that state is not safe across every model the gateway can route to.

## Images

`vercel()` does not send images. The HTTP docs describe `state` as text or JSON, not file parts. A state with an image fails with `UNSUPPORTED_INPUT` before the request. `limits.maxImages` is not set, even if you pass one.

`vercelDecide({ images: true })` sends PNG, JPEG, WebP, and GIF as AI SDK file parts (base64). The default cap is 16 images per request. That number is askif's guard: AI Gateway does not publish a count. Override it with `limits.maxImages`. `image/jpg` is not accepted; use `image/jpeg`.

The default model `typesafe-ai/jev` accepts text and JSON only. Gateway forwards image files to the routed model, and that model has to support them. Leave `images` off unless you select one that does. Image quality and which media types each model accepts have not been checked live.

`image()`, a `data:image/...;base64,` string, or `{ content_type, base64 }` can sit in the state, the instructions, or the criteria. Each becomes `[image N]`, numbered from 1 across the state and then the questions.

## Fallbacks and `.unsure()`

AI Gateway can rerun a successful decision on a second model when a choice or score is low-confidence, or a boolean probability sits in a band. Both stages are billed, and the second call waits for the first. See [Decision fallbacks](https://vercel.com/docs/ai-gateway/models-and-providers/decision-fallbacks).

```ts
vercel({
  fallback: {
    model: "openai/gpt-6-luna-decisions",
    when: { probabilityBetween: [0.4, 0.6] }, // every boolean, because question is omitted
    or: ["anthropic/claude-sonnet-5"],          // execution-error fallbacks after the conditional
  },
})
```

This becomes `providerOptions.gateway.models`: the conditional object first, then `or`. If you set `providerOptions.gateway.models` yourself, that array is sent as-is and `fallback` is ignored. `confidenceBelow` applies to choice and score. `probabilityBetween` applies to boolean. `when` may also be `{ any }`, `{ all }`, or `{ atLeast: { count, conditions } }`.

`.unsure()` is the other tool: the first answer comes back, and your code decides whether to review it. A gateway fallback spends a second request instead. Use one of them with that difference in mind.

Other gateway options pass through, including `zeroDataRetention` and `only`.

## Usage

There is no usage field on askif's `Backend`. `onUsage` runs when a response object arrives, including when a later answer cannot be parsed:

```ts
vercel({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  onUsage: ({ model, inputTokens, outputTokens, cost, generationId }) => {
    console.log(model, inputTokens, outputTokens, cost, generationId);
  },
})
```

`cost` is the gateway string. A numeric cost is converted with `String`. A fallback that runs both stages reports the combined usage.

## Limits

`maxLevels` defaults to 10, from Perplexity's published score cap. Other providers may require at least 2 levels; askif already requires 2. No published cap on options or questions was found, so those limits are unset and askif's `maxBatchSize` (default 32) applies. Pass `limits` to override.

## TypeSafe-compatible route

AI Gateway also accepts TypeSafe's own wire format at `https://ai-gateway.vercel.sh/typesafe`. Boolean questions stay `noul` on that path, so `@askif/jev` can point at it. That route is not what this package speaks, and it has not been called from this repo. See the `@askif/jev` README.

## Errors

| Code | When |
| --- | --- |
| `BACKEND_UNAVAILABLE` | `AI_GATEWAY_API_KEY` / `apiKey` is missing, `ai` is not installed, or the model instance has no `doDecide` |
| `BACKEND_FAILED` | HTTP status, transport error, or a thrown SDK call. `cause` is the original error |
| `UNSUPPORTED_INPUT` | Images on the HTTP backend, images while `images` is off, an unsupported media type, too many images, or a `null` state |
| `BAD_RESPONSE` | The body has no answers object, or one answer does not match its question |
| `INVALID_QUESTION` | askif's option/level checks, or a `timeout` that is not a positive number of milliseconds |

## Live tests

`live/vercel.test.ts` calls the gateway when `AI_GATEWAY_API_KEY` is set. It is not part of `pnpm run check`. The workflow is `.github/workflows/live.yml` (push to `main`, and `workflow_dispatch`). It is not on the daily cron.

Not run here, because this environment has no key: the live HTTP call, the live SDK call, image input against a vision-capable decision model, and the TypeSafe-compatible base URL.

## License

MIT
