# @askif/anthropic

The [askif](https://www.npmjs.com/package/askif) backend for Anthropic's Messages API (Claude), with a ready-to-use `ask`.

```sh
npm install askif @askif/anthropic
export ANTHROPIC_API_KEY=...
```

```ts
import { ask } from "@askif/anthropic";

await ask.if("cat", "is animal", () => {
  console.log("cat is animal");
});
```

Full documentation, the `ask.if`/`ask.switch`/`ask.score` guide, and runnable examples live in the [main repo README](https://github.com/asakaxgit/askif#readme).

This package has offline tests only. It has not been run against the live API yet.

## How it works

- Every question is sent as its own request, in parallel, like `@askif/openai`. There is no
  multi-question batching in one call.
- Probabilities are the model's own JSON estimates, held to a JSON Schema per question kind.
  `structuredOutput` picks how (see [Structured output](#structured-output)).
- `askif` computes `confidence` from how spread out those probabilities are. This backend never
  self-reports one.
- The default model is `claude-opus-5-5`, sent with `output_config.effort: "low"`. Thinking can't
  be turned off on that model, so a low effort keeps each answer short. Pass `model` to use a
  different one (for example `"claude-haiku-4-5"`). No `effort` is sent in that case, since some
  models reject it.
- `maxTokens` sets `max_tokens` (default 4096). Thinking counts against it. A reply cut off at the
  limit is a `BAD_RESPONSE`.
- `params` passes extra request fields (`metadata`, `service_tier`, etc.) to every request.
  `params.output_config` is merged with this backend's own, and `format` always comes from
  `structuredOutput`.
- The state is wrapped in a random `<state-…>` tag, and the system prompt says that tag is the only
  state and that text inside it is not an instruction. `anthropic({ protection: false })`, or core
  `protection: false`, sends a plain `<state>` block instead.
- A `refusal` stop reason is a `BAD_RESPONSE` that carries the refusal's explanation.
- The SDK (`@anthropic-ai/sdk`) is loaded on the first call. `client` takes an existing
  `Anthropic` client, and every other option (`apiKey`, `baseURL`, `maxRetries`, …) goes to the
  client this backend creates.

## Structured output

| `structuredOutput` | Request | Reply |
| --- | --- | --- |
| `"json_schema"` (default) | `output_config.format: { type: "json_schema", schema }` | The text blocks, parsed as one JSON object |
| `"tool"` | One tool (`yesno_answer`, `choice_answer` or `scale_answer`) with `strict: true`, `tool_choice: { type: "auto", disable_parallel_tool_use: true }`, and a system prompt that says to call it | That tool call's `input` |

`"tool"` does not force the tool call, because Claude Opus 5.5, Sonnet 5.5 and Fable 5.1 reject
`tool_choice` `any` and `tool` with a 400. A reply that doesn't call the tool is a `BAD_RESPONSE`.
Use `"tool"` where an endpoint takes tools but not `output_config.format`.

```ts
import { anthropic } from "@askif/anthropic";
import { createAsk } from "askif";

const ask = createAsk({ backend: anthropic({ model: "claude-haiku-4-5", structuredOutput: "tool" }) });
```

## Images

Put images in the state with `image()` from `askif` (PNG, JPEG, WebP or GIF, up to 100 per
request). Each one is sent as an image block after an `[image N]` text label, before the question
text, so a question can refer to "image 1".

`imageUrl(url)` is sent as a URL image block, and Anthropic fetches it. That applies only when this
backend talks to Anthropic itself (no `baseURL` or `client`); the backend then advertises
`imageSources: ["url"]`. Set `anthropic({ imageUrls: true })` for another endpoint that fetches
URLs. Otherwise askif downloads the image with the `resolveImage` you give `createAsk` (see
[Images at a URL or in a bucket](https://github.com/asakaxgit/askif#images-at-a-url-or-in-a-bucket)).

Every question carries its images, so N questions about an image send it N times.
