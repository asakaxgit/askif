# Examples

All of these run against the built-in [`mock`](../../../README.md#backends) backend, so they need no API key and no network access.

| File | Shows |
| --- | --- |
| [`if.ts`](./if.ts) | `ask.if`: `.else`, `.unsure`, `threshold`, `criteria`, `ask.is`, `ask.probability` |
| [`switch.ts`](./switch.ts) | `ask.switch`: `.case`, `.other`, `.unsure`, ranking, typed results |
| [`score.ts`](./score.ts) | `ask.score`: levels, `.unsure`, `score`/`normalized`, structured descriptions |
| [`batching.ts`](./batching.ts) | Calls on the same state in the same tick going out as one request |
| [`configuration.ts`](./configuration.ts) | `ask.configure`, per-call overrides, and a separate stricter instance |
| [`backends.ts`](./backends.ts) | Building a custom backend with `mock` |
| [`errors.ts`](./errors.ts) | Catching an `AskError` and checking its `code` |

```sh
npx tsx examples/if.ts
```

For the live Jev/TypeSafe quickstart (needs `TYPESAFE_API_KEY`), see [`@askif/jev`'s examples](../../jev/examples).
