# TODO

Ideas not yet done, roughly in priority order.

## Reliability of `@askif/openai`

- [ ] Prompt-text fallback: spell out the JSON shape in the prompt (opt-in option, e.g.
      `structuredOutput: "json_schema" | "json_object" | "prompt"`), so endpoints that ignore or
      reject `response_format: json_schema` (Ollama, some llama.cpp builds) still work.
- [x] Live smoke test against OpenAI (gpt-6-luna, 2026-09-30): `examples/basic.ts` ran clean, no
      `BAD_RESPONSE`; a yes/no + choice + scale batch took ~2.6 s.
- [ ] Verify Bedrock accepts `response_format` on its OpenAI-compatible Chat Completions endpoints.
- [ ] Settle Bedrock's default mantle path (SDK's `/openai/v1` vs. AWS docs' `/v1`).
- [ ] Keep a verified/unverified provider list in the package README once live checks exist.

## Live verification (needs credentials; only OpenAI and OpenJev/Codiv have been run so far)

| Target | Needs |
| --- | --- |
| OpenAI | `OPENAI_API_KEY` (done) |
| Azure OpenAI | a resource with a deployment: endpoint, key, deployment name, a supported `apiVersion` |
| Vertex AI | a GCP project with Vertex enabled, `gcloud auth print-access-token`, project id |
| Bedrock | a Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK`), a region with `openai.gpt-oss-*` enabled |
| OpenRouter / Gemini | `OPENROUTER_API_KEY` / `GEMINI_API_KEY` |
| Ollama / vLLM / LM Studio / llama.cpp | the server running locally with a model loaded |
| OpenJev | a Codiv key (done), or a GPU/Apple-silicon host running openjev |

- [ ] A gated live suite (skipped unless the matching env var is set) that sends one yes/no, one
      choice and one scale question per target, so `response_format` support is confirmed.

## More OpenAI-compatible endpoints (docs + example only, just a `baseURL`)

- [ ] Hosted: Groq, Together, Fireworks, DeepInfra, Mistral, xAI, DeepSeek, Cerebras.
- [ ] Gateways: LiteLLM, Cloudflare AI Gateway, Vercel AI Gateway.

## New backends

- [ ] `@askif/anthropic`: native Anthropic adapter (tool use / JSON output for probabilities).

## Release

- [ ] Manual OTP `npm publish` of `@askif/openai@0.1.0`, then configure its npm Trusted Publisher
      (see [RELEASING.md](./RELEASING.md)).
