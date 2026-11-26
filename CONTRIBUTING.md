# Contributing

This is a [pnpm](https://pnpm.io) workspace. Packages: [`packages/askif`](./packages/askif), [`packages/jev`](./packages/jev), [`packages/openai`](./packages/openai), [`packages/clef`](./packages/clef), [`packages/vercel`](./packages/vercel), [`packages/vertex`](./packages/vertex).

```sh
pnpm install
pnpm run check   # lint + typecheck + offline tests + docs check
pnpm run build
```

`pnpm run check` typechecks `live/` and runs `live/exif.test.ts` (the JPEG/Exif fixture builder). It does not call a provider.

JVM core (`kotlin/`, JDK 21 to compile, bytecode 17) and the shared conformance suite:

```sh
(cd kotlin && ./gradlew test)
node --import tsx spec/runner/src/run.ts
```

`./gradlew :conformance:installDist` writes the Kotlin driver the runner launches. Image input and prompt-injection protection are TypeScript-only in spec 0.1. See [`spec/CRITERIA.md`](./spec/CRITERIA.md) and [`kotlin/README.md`](./kotlin/README.md).

Style and release notes are in the [README](./README.md#contributing) and [`RELEASING.md`](./RELEASING.md).

## Live tests

`pnpm run test:live` calls the real backends. [`.github/workflows/live.yml`](./.github/workflows/live.yml) runs every backend on a push to `main` and on `workflow_dispatch`. [`.github/workflows/live-daily.yml`](./.github/workflows/live-daily.yml) runs `jev` and `clef` on the daily schedule. Both call [`.github/workflows/live-backend.yml`](./.github/workflows/live-backend.yml) for the install and test steps.

- **When:** every push to `main` runs every backend job. Every day at 15:17 UTC (00:17 in Japan, cron `17 15 * * *`) runs only `jev` and `clef`, the cheap backends. OpenAI, OpenRouter, Vercel, and Bedrock are not on that cron. `workflow_dispatch` on Live can limit a run to one backend.
- **Pull requests:** neither workflow has a `pull_request` trigger. A fork's pull request cannot receive repository secrets. Dispatch Live to run it on a branch once the workflow file is on the default branch.
- **Missing secrets:** each backend is its own job. The job checks the secret, prints a `::notice`, writes a step summary, skips install and tests, and stays green. It does not fail closed.
- **Present secrets:** the test step sets `LIVE_REQUIRE=1`. If the variable is empty anyway, the run fails instead of reporting every network test as skipped.
- **Node:** 22. One attempt per request (`maxRetries: 0` on Jev, OpenAI, and `vercelDecide`; Clef and `vercel()` do not retry). Client timeout is 45 seconds, except Bedrock's 110 seconds (Bedrock compiles a grammar for each new schema, which AWS says can take about 90 seconds).
- **Models:** Jev's default `jev-latest` against `https://api.typesafe.ai`; Clef's functional calls use `clef-flash` and the 413 probe uses `clef`; OpenAI's package default `gpt-6-luna`; OpenRouter uses `jev-1.14` at `https://openrouter.ai/api` (`POST /api/v1/systemone`); Vercel uses `typesafe-ai/jev` (`POST /v1/evaluate`, and AI SDK `experimental_decide` against the gateway decision-model URL); Bedrock uses `openai.gpt-oss-120b-1:0` on `bedrock-runtime` (`/openai/v1`) and `openai.gpt-oss-120b` on `bedrock-mantle` (`/v1`), both with `reasoning_effort: "low"`.
- **Thresholds:** a clear yes must be at least 0.7, a clear no at most 0.3, and the winning switch/score probability at least 0.6. Prompts are unambiguous on purpose.

Keys come only from the environment. On GitHub Actions that environment is filled from repository secrets (Settings → Secrets and variables → Actions). Do not commit a key. `.env` and `.env.local` are gitignored; export the variables in your shell, then run `pnpm run test:live` or one `pnpm run test:live:<backend>` script.

| GitHub secret | Used by | Where to get it |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | `@askif/jev`. `@typesafe-ai/sdk` reads this name when `jev()` is called without `apiKey`. | A TypeSafe account. Create a key at [console.typesafe.ai/keys](https://console.typesafe.ai/keys). |
| `CLOUDFLARE_ACCOUNT_ID` | `@askif/clef`. `clef()` reads this name. | The Cloudflare account that owns Workers AI. It is the id in `https://dash.cloudflare.com/<account-id>`. |
| `CLOUDFLARE_API_TOKEN` | `@askif/clef`. `clef()` reads this name. | A Cloudflare API token with the Workers AI permission. Create one at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) (the Workers AI template). |
| `OPENAI_API_KEY` | `@askif/openai`. The `openai` SDK reads this name when `openai()` is called without `apiKey`. | An OpenAI platform account. Create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). |
| `OPENROUTER_API_KEY` | Jev pointed at OpenRouter. The live test passes it as `jev({ apiKey, baseURL: "https://openrouter.ai/api", model: "jev-1.14" })`. The TypeSafe SDK does not read this name itself (it reads `TYPESAFE_API_KEY`). | An OpenRouter account. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys). |
| `AI_GATEWAY_API_KEY` | `@askif/vercel`. `vercel()` and `vercelDecide()` read this name when called without `apiKey`. The `ai` package reads the same name for AI Gateway. | A Vercel AI Gateway key. Create one from the AI Gateway section of the Vercel dashboard. |
| `AWS_BEARER_TOKEN_BEDROCK` | Amazon Bedrock through `@askif/openai` and `BedrockOpenAI`. The `openai` SDK reads this name when `BedrockOpenAI` is built without `apiKey`. | An AWS account with Bedrock. Create a long-term API key in the Bedrock console (API keys). The region must have `openai.gpt-oss-120b` enabled. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | The `structuredOutput: "prompt"` test in `live/openai.test.ts`, against a local OpenAI-compatible server. Local only: not a GitHub secret, and no workflow job sets them. | Run [Ollama](https://ollama.com) (or another server), pull a model, then set for example `http://localhost:11434/v1` and `llama3.3`. |
| `AWS_REGION` | The Bedrock region, for example `us-east-1`. Not a secret value, but the job reads it from the same place. | The AWS region where the API key and model access live. |

### What each job runs

| Job | Script | Network calls | Also, with no network |
| --- | --- | --- | --- |
| `live @askif/jev` | `pnpm run test:live:jev` | One batched `ask.if` / `ask.switch` / `ask.score` / `ask.probability` on a cat sentence (one `systemOne` request, JSON, no danger-zone header). One `multiState: true` call with a cat state and a hammer state (one request; the two probabilities must disagree). One `images: true` call on `packages/clef/test/fixtures/public-domain/dog.jpg` (400×303 JPEG): "shows a dog" high, "shows a bicycle" low, body `multipart/form-data`, header `TypeSafe-Danger-Zone-Images: true`. | `dog.jpg` passes Jev's pixel limits. Images with `images` left off, a WebP, and the 128px `red-circle.png` are `UNSUPPORTED_INPUT` and a refusing `fetch` proves no request was made. |
| `live @askif/clef` | `pnpm run test:live:clef` | The same four ask methods on `clef-flash`, one request. One `clef-flash` choice on `images/red-circle.png` (circle / square / triangle). One `clef` call with `public-domain/bicycle.jpg` plus an in-memory 250 DPI Exif segment: HTTP 413 (`BACKEND_FAILED`) or a real probability. The log says which. | The Exif builder test. A GIF and five images are `UNSUPPORTED_INPUT`. |
| `live @askif/openai` | `pnpm run test:live:openai` | The same four ask methods on `gpt-6-luna` (one request each; this backend does not batch), then again with `structuredOutput: "prompt"` and with `"json_object"`. One choice on `images/red-circle.png`. With `OLLAMA_BASE_URL` and `OLLAMA_MODEL` set, the four ask methods with `structuredOutput: "prompt"` on that local server (110-second timeout). | `image/tiff` is `UNSUPPORTED_INPUT`. The stand-in key is `unused`, and the test counts `fetch` calls so a regression cannot spend quota. |
| `live OpenRouter (Jev)` | `pnpm run test:live:openrouter` | The same four ask methods, then the dog JPEG, both through OpenRouter's System One URL. The image call must be multipart and must send `TypeSafe-Danger-Zone-Images: true`. Text calls must be JSON and must omit that header. | Images left off, and WebP, are `UNSUPPORTED_INPUT` before any request. |
| `live @askif/vercel` | `pnpm run test:live:vercel` | The same four ask methods twice: once through `vercel()` (`POST https://ai-gateway.vercel.sh/v1/evaluate`, JSON) and once through `vercelDecide()` (one request whose path ends in `/decision-model`, `maxRetries: 0`). | Images on `vercel()` and on `vercelDecide()` with `images` left off are `UNSUPPORTED_INPUT` before any request. |
| `live Bedrock (OpenAI-compatible)` | `pnpm run test:live:bedrock` | The same four ask methods on `bedrock-runtime` `/openai/v1` and on `bedrock-mantle` `/v1` (one request per question; every URL must be the configured endpoint). One `ask.probability` through the SDK's `awsRegion`-derived `bedrock-mantle` `/openai/v1` URL: a real probability or an `AskError`. The log says which. | None. Offline Bedrock tests are in `packages/openai/test`. |

`pnpm run test:live` runs every file above, serially.
