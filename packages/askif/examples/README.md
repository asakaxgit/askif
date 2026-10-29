# Examples

All of these run against the built-in [`mock`](../../../README.md#backends) backend, so they need no API key and no network access.

| File | Shows |
| --- | --- |
| [`if.ts`](./if.ts) | `ask.if`: `.else`, `.unsure`, `threshold`, `criteria`, `ask.is`, `ask.probability` |
| [`switch.ts`](./switch.ts) | `ask.switch`: `.case`, `.other`, `.unsure`, ranking, typed results |
| [`score.ts`](./score.ts) | `ask.score`: levels, `.unsure`, `score`/`normalized`, structured descriptions |
| [`batching.ts`](./batching.ts) | Same-tick calls sharing a request: one state by default, or several when the backend opts in |
| [`configuration.ts`](./configuration.ts) | `ask.configure`, per-call overrides, and a separate stricter instance |
| [`backends.ts`](./backends.ts) | Building a custom backend with `mock`. `fallback()` lives in `@askif/vertex`'s examples |
| [`errors.ts`](./errors.ts) | Catching an `AskError` and checking its `code` |
| [`security.ts`](./security.ts) | Default prompt-injection protection: `.unsure()` holds a steered state, and the flag is set either way |

```sh
npx tsx examples/if.ts
```

For the live Jev/TypeSafe quickstart (needs `TYPESAFE_API_KEY`), see [`@askif/jev`'s examples](../../jev/examples).
