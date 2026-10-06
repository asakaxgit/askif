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

- [ ] `@askif/clef`: first manual publish. (Live smoke test done 2026-10-06: 22/22 image answers correct; tokens and latency measured, see the package README. The bench also ran scale and up to 64 mixed questions per request live, via `decide`. Not yet live-tested: askif-level batching through `ask`, the Workers binding, `clef-flash` image answers, error paths.) Image input is supported by pulling data URLs / `{ content_type, base64 }` out of the state; a first-class image type in askif's `State` would be cleaner but touches core.
- [ ] If a third System One backend appears, move the shared question/answer mapping from `@askif/jev` and `@askif/clef` into `askif` (until then, `packages/askif/test/fixtures/system-one.ts` keeps them in step).
- [ ] Image sources beyond base64: `{ kind: "url" }` and `{ kind: "bucket", provider, bucket, key }` (R2/S3/GCS) in `askif`'s `ImageSource`, plus a resolver (e.g. a `resolveImage` hook on `createAsk`) that downloads to base64 for backends that can't fetch themselves; backends that can (OpenAI takes URLs) would advertise it. Hash the batching key if multi-MB base64 states get slow (it is `JSON.stringify(state)`).
- [ ] Test a real "damaged parcel" return photo end to end (needs the maintainer's own photos; public-domain searches found no clean consumer-parcel example, and the closest industrial crates scored 0.56-0.60, which is not evidence either way). Use `packages/clef/examples/try-image.ts`.
- [ ] Clef HTTP 413 on a small JPEG with EXIF/250 DPI metadata (see the clef README): find the cause, maybe strip or downscale in the backend.
- [ ] `@askif/openai` image input: live-verify (needs a quota that allows it), and consider the `detail` option.
- [ ] `@askif/anthropic`: native Anthropic adapter (tool use / JSON output for probabilities).

## Release

- [x] Manual first publish of `@askif/openai@0.1.0` (done 2026-09-30).
- [ ] Configure npm Trusted Publishers for `askif`, `@askif/jev` and `@askif/openai` (see
      [RELEASING.md](./RELEASING.md)), then re-run the Release job to publish `askif@0.1.1` and
      `@askif/jev@0.1.1`.
