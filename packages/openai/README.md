# @askif/openai

The [askif](https://www.npmjs.com/package/askif) backend for OpenAI, with a ready-to-use `ask`. Also works with any OpenAI-compatible API (OpenRouter, self-hosted servers) via `baseURL`.

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

## License

MIT
