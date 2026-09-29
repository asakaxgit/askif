# Examples

| File | Shows | Needs a key? |
| --- | --- | --- |
| [`basic.ts`](./basic.ts) | Quickstart: `ask.if`, `ask.switch`, `ask.score` against the real OpenAI backend | Yes |
| [`backends.ts`](./backends.ts) | Building instances with a specific model, or through an OpenAI-compatible endpoint (OpenRouter) | No |

```sh
OPENAI_API_KEY=... npx tsx examples/basic.ts
# or, with a key saved in .env.local at the repo root:
node --env-file=../../.env.local --import tsx examples/basic.ts
```

For the rest of the API (`ask.switch`'s `.other()`, `ask.score`'s `.unsure()`, batching, configuration, custom backends, errors), see [`askif`'s own examples](../../askif/examples), which run offline against the `mock` backend.
