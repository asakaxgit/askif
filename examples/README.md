# Examples

| File | Shows | Needs a key? |
| --- | --- | --- |
| [`basic.ts`](./basic.ts) | Quickstart: `ask.if`, `ask.switch`, `ask.score` against the real TypeSafe backend | Yes |
| [`if.ts`](./if.ts) | `ask.if`: `.else`, `.unsure`, `threshold`, `criteria`, `ask.is`, `ask.probability` | No |
| [`switch.ts`](./switch.ts) | `ask.switch`: `.case`, `.other`, `.unsure`, ranking, typed results | No |
| [`score.ts`](./score.ts) | `ask.score`: levels, `.unsure`, `score`/`normalized`, structured descriptions | No |
| [`batching.ts`](./batching.ts) | Calls on the same state in the same tick going out as one request | No |
| [`configuration.ts`](./configuration.ts) | `ask.configure`, per-call overrides, and a separate stricter instance | No |
| [`backends.ts`](./backends.ts) | Building instances against different backends: TypeSafe models, OpenRouter, `mock` | No |
| [`errors.ts`](./errors.ts) | Catching an `AskError` and checking its `code` | No |

Everything except `basic.ts` runs against the built-in [`mock`](../README.md#backends) backend, so it needs no API key and no network access:

```sh
npx tsx examples/if.ts
```

`basic.ts` talks to the live TypeSafe API, so it needs a key:

```sh
TYPESAFE_API_KEY=... npx tsx examples/basic.ts
# or, with a key saved in .env.local:
node --env-file=.env.local --import tsx examples/basic.ts
```
