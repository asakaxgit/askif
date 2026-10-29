# @askif/vertex

Jev for [askif](https://www.npmjs.com/package/askif), with a fallback to Gemini on Vertex AI when Jev cannot be used.

Vertex is reached through [`@askif/openai`](https://www.npmjs.com/package/@askif/openai) and Vertex's OpenAI-compatible endpoint. There is no static API key. Each request gets a Google access token from [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials).

```sh
npm install askif @askif/vertex
export TYPESAFE_API_KEY=...   # omit this and judgments use Vertex
export LLM_BASE_URL=https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT/locations/LOCATION/endpoints/openapi
```

```ts
import { getAsk } from "@askif/vertex";

const ask = getAsk();
await ask.if("cat", "is animal", () => {
  console.log("cat is animal");
});
```

`getAsk()` reads the environment when you call it. `ASK_BACKEND` is `vertex`, `openai`, `jev`, or `mock`. Unset is the same as `jev`.

| `ASK_BACKEND` | `TYPESAFE_API_KEY` | What runs |
| --- | --- | --- |
| unset or `jev` | set | Jev. A failed call can fall back to Vertex. See below. |
| unset or `jev` | missing | Vertex, and one warning per process. Jev is not called. |
| `vertex` | either | Vertex. The Jev key is ignored. |
| `openai` | either | OpenAI-compatible. `LLM_API_KEY` or `OPENAI_API_KEY`. No fallback. |
| `mock` | either | Flat probabilities for a local dry-run. No fallback. |

The warning strings are `JEV_FALLBACK_WARNING` (missing key) and `JEV_RUNTIME_FALLBACK_WARNING` (a call failed). The first of those in a process is the only one printed. `console.warn` is the default; pass `warn` to `getAsk` to take the line yourself. `resetAskWarningsForTests()` clears the flag.

## What falls back

Fallback is per call. The next call tries Jev again, so a single 503 does not pin the process to Vertex.

| Failure | Falls back |
| --- | --- |
| Connection error, timeout, HTTP 408, HTTP 5xx | yes |
| HTTP 401, 403, or a missing Jev API key reported by the client | yes |
| HTTP 402 | yes. The account cannot serve the request. |
| HTTP 429 | no. The rate limit surfaces on the error's `cause` (`RateLimitError`, status 429), wrapped by askif as `BACKEND_FAILED`. Retrying it on Vertex would spend a second quota to dodge the first one. |
| HTTP 400, 404, 422, and other 4xx | no. The request is the caller's. |
| Caller abort | no |
| `INVALID_QUESTION`, `UNSUPPORTED_INPUT`, `BAD_RESPONSE`, `CHAIN_STARTED` | no |
| `BACKEND_UNAVAILABLE` (the Jev SDK is not installed) | no |
| A per-question `{ error }` when the call itself succeeded | no |
| Anything else | no. An unrecognized error is surfaced instead of hidden behind a second model. |

Explicit `vertex`, `openai`, and `mock` never fall back, including when `TYPESAFE_API_KEY` is unset. `createAskBackendFor("jev", env)` also does not fall back: a missing key throws, so a comparison cannot score Vertex against itself.

Jev answers many questions about one state in one call, and with `multiState` it can pack several states. Vertex takes one question per request and has no `decideMany`. The fallback keeps Jev's batching on the way out, then splits a failed call into what Vertex accepts. `fallback(primary, secondary)` from `askif` is that wrapper, if you want the same split with your own backends. It does not log; pass `onFallback`.

`getAsk()` builds Jev with `retry: { maxRetries: 0 }`, so a 503 falls back instead of being retried by the TypeSafe client first.

## Vertex request

| | |
| --- | --- |
| Base URL | `ASK_BASE_URL`, or else `LLM_BASE_URL`. Required on the first Vertex call. A trailing slash is removed. |
| Model | `ASK_MODEL`, or else `LLM_MODEL`, or else `google/gemini-3.5-flash` |
| Auth | `accessToken` if you pass one, otherwise ADC (`google-auth-library`). Called before every request. |
| Sampling | `temperature: 0`, `reasoning_effort: "low"`, `max_tokens: 4096`. `params` on `vertex()` overrides these. |
| Retries | none (`maxRetries: 0`) |

`ASK_MODEL` is shared with Jev. A value such as `jev-latest` is sent to Vertex as well. Leave `ASK_MODEL` unset and set `LLM_MODEL` when the two models should differ, or pass `model` to `vertex()`.

`ASK_BASE_URL` is also Jev's host override. When both `ASK_BASE_URL` and `LLM_BASE_URL` are set, Vertex uses `ASK_BASE_URL`. Prefer `LLM_BASE_URL` for the Vertex root and leave `ASK_BASE_URL` unset unless Jev itself should use a different host.

Gemini sometimes wraps the JSON in prose. The Vertex client pulls the object out of the assistant message before askif parses it. A non-JSON body is left alone.

`vertex()` on its own is only the Gemini backend. `createAskBackend()` / `getAsk()` is the switch above.

```ts
import { createAsk } from "askif";
import { vertex } from "@askif/vertex";

const ask = createAsk({
  backend: vertex({
    baseURL: process.env.LLM_BASE_URL,
    accessToken: async () => "ya29.example", // tests; omit this to use ADC
  }),
});
```

OpenAI (`ASK_BACKEND=openai`) uses `ASK_MODEL` or `LLM_MODEL` or the `@askif/openai` default, and `ASK_BASE_URL` or `LLM_BASE_URL` or `https://api.openai.com/v1`. Temperature is 0. It does not send `reasoning_effort`.

## Images

On Vertex, the same set as `@askif/openai`: PNG, JPEG, WebP, and non-animated GIF. While the call stays on Jev, Jev's own image rules apply (`images` is off unless you build `jev({ images: true })` yourself). `getAsk()` does not turn Jev images on.

## License

MIT
