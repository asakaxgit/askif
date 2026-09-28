# askif

*Let Jev decide.*

Typed decisions for your code: `ask.if`, `ask.switch`, `ask.score`.

```ts
import { ask } from "askif";
```

```ts
// examples/basic.ts#L5-L7

await ask.if("cat", "is animal", () => {
  console.log("cat is animal");
});
```

Each call asks [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's System One model, a question about some state. Jev returns probabilities instead of text, and askif runs the branch that matches.

> Unofficial, not affiliated with TypeSafe AI.

## Install

```sh
npm install askif @typesafe-ai/sdk
export TYPESAFE_API_KEY=...
```

Node 20 or newer. Run it on a server: the TypeSafe SDK refuses to run in a browser, where your API key would be exposed.

## Examples

Runnable examples for everything below live in [`examples/`](./examples). Most of them use the [mock backend](#backends), so they need no API key:

```sh
npx tsx examples/if.ts
```

See [`examples/README.md`](./examples/README.md) for the full list.

## `ask.if`: yes or no

```ts
// examples/if.ts#L40-L44

const ticket = "I've asked three times and nobody has helped. Get me a real person.";
const ticketResult = await ask
  .if(ticket, "the customer is asking for a human agent", () => console.log("routed to a human agent"))
  .else(() => console.log("routed to the bot"))
  .unsure(() => console.log("sent for review"));
```

- Without `.unsure()`, the `then` handler runs when the probability is above `threshold` (default 0.5).
- With `.unsure()`, probabilities inside `unsureBand` (default 0.2–0.8) go to it instead.

For a plain `if`, use `ask.is`. For the raw number, use `ask.probability`:

```ts
// examples/if.ts#L83-L87

if (await ask.is("penguin", "can fly")) console.log("penguin can fly");
else console.log("penguin can't fly");

// ask.probability: the raw number, when you want to do your own thing with it.
const p = await ask.probability("penguin", "can fly"); // 0..1
```

## `ask.switch`: one of several options

```ts
// examples/switch.ts#L17-L29

const ticket = "Shoes arrived in the wrong size. Also I was charged twice.";

// Basic case: the most likely option's handler runs. The chain resolves to a
// typed result: `choice` is narrowed to the declared keys.
const basicAsk = createAsk({ backend: choiceBackend({ returns: 0.61, billing: 0.35, shipping: 0.04 }) });
const team = await basicAsk
  .switch(ticket, "Which team should handle this?")
  .case("returns", "Exchanges, wrong or damaged items", () => console.log("→ returns team"))
  .case("shipping", "Delivery status, delays, lost packages", () => console.log("→ shipping team"))
  .case("billing", "Charges, invoices, payment problems", () => console.log("→ billing team"));

console.log("choice:", team.choice); // "returns" | "shipping" | "billing"
console.log("ranking:", team.ranking); // every option, most likely first
```

`.other()` and `.unsure()` chain onto the same call — see [`examples/switch.ts`](./examples/switch.ts) for both in action.

- The option key and its description are both sent to the model. A key that explains itself needs no description: `.case("calm")`.
- `.other()` adds an option the model can pick when nothing else fits.
- `.unsure()` runs when confidence is below `minConfidence` (default 0.5).

## `ask.score`: a position on a scale

```ts
// examples/score.ts#L16-L26

const COSMETIC = "Cosmetic; no impact to functionality";
const WORKAROUND = "Broken or degraded feature, but workaround exists";
const BLOCKING = "Blocking issue; no workaround exists";

// Basic case: the handler for the most likely level runs.
const basicAsk = createAsk({ backend: scaleBackend([0, 0.57, 0.43]) });
const basicResult = await basicAsk
  .score("The export button crashes the settings page in Safari. Works in Chrome.", "How severe?")
  .level(COSMETIC, () => console.log("→ backlog"))
  .level(WORKAROUND, () => console.log("→ this sprint"))
  .level(BLOCKING, () => console.log("→ page on-call"));
```

- Levels go from the low end to the high end, 2 to 10 of them.
- The handler that runs is the one for the **most likely** level, not the rounded score. A 50/50 split between the two ends will never run the middle handler, which got no probability.
- The result also has `score` (the probability-weighted position, which can fall between levels) and `normalized` (0..1), for ranking or combining scores.

Long descriptions can get a short key, and a description can be structured:

```ts
// examples/score.ts#L65-L72

// Long descriptions can get a short key, and a description can be structured,
// reusing the same COSMETIC / WORKAROUND / BLOCKING descriptions as above.
const structuredAsk = createAsk({ backend: scaleBackend([0, 0, 1]) });
const structuredResult = await structuredAsk
  .score("Cannot log in at all", "How severe?")
  .level("cosmetic", COSMETIC)
  .level("workaround", { what: WORKAROUND, examples: ["export fails in one browser but works in another"] })
  .level("blocking", BLOCKING);
```

## Results

Every chain can be awaited. It resolves after the handler finishes, with what happened:

```ts
// examples/score.ts#L36-L39

const resultAsk = createAsk({ backend: scaleBackend([0.3, 0.7]) });
const bug = "Cannot save changes to the profile page.";
const r = await resultAsk.score(bug, "How severe?").level("low").level("high");
console.log(r.level, r.branch, r.confidence);
```

`r.level`, `r.branch`, and `r.confidence` are all available on the resolved result.

Handlers receive the same result, so a handler can look at the runner-up or the probabilities.

## Chain in one expression

A question is sent on the next microtask, once the chain is complete. Every `.case()`, `.level()`, `.else()`, and `.unsure()` must be part of the same expression. Adding one later throws a `CHAIN_STARTED` error.

## Batching

Calls about the **same state** made in the same tick go out as one request. Jev answers them in parallel, so extra questions barely add time:

```ts
// examples/batching.ts#L24-L32

const order = { id: "A-1", country: "DE" };
const flag = () => console.log("flag for review");
const addCustoms = () => console.log("add customs form");

await Promise.all([
  ask.if(order, "looks fraudulent", flag),
  ask.if(order, "ships internationally", addCustoms),
  ask.score(order, "How urgent is delivery?").level("standard").level("express"),
]); // one request
```

## Configuration

```ts
// examples/configuration.ts#L23-L28

ask.configure({ threshold: 0.6, minConfidence: 0.4 });

// Per-call: override the instance default just for this one call.
const state = "Buy now, 90% off, click this link!!!";
const onSpam = () => console.log("flagged as spam");
await ask.if(state, "is spam", onSpam, { threshold: 0.9 }); // per call
```

| Option          | Default      | Used by                                   |
| --------------- | ------------ | ----------------------------------------- |
| `threshold`     | `0.5`        | `ask.if`, `ask.is`                        |
| `unsureBand`    | `[0.2, 0.8]` | `ask.if` with `.unsure()`                 |
| `minConfidence` | `0.5`        | `ask.switch`, `ask.score` with `.unsure()` |
| `maxBatchSize`  | `32`         | batching                                  |
| `backend`       | TypeSafe     | everything                                |

## Backends

The default `ask` uses TypeSafe with `jev-latest`. Make your own instance for a different model or endpoint:

```ts
import { createAsk, typesafe } from "askif";
```

```ts
// examples/backends.ts#L12-L17

const ask = createAsk({ backend: typesafe({ model: "jev-1.13" }) });

// Through OpenRouter.
const viaOpenRouter = createAsk({
  backend: typesafe({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api" }),
});
```

A backend is any object that answers yes/no, choice, and scale questions with probabilities. See the `Backend` type to connect another model.

For tests, `mock` answers questions locally and records every call:

```ts
import { createAsk, mock } from "askif";
```

```ts
// examples/backends.ts#L24-L27

const backend = mock(() => ({ kind: "yesno", probability: 0.9 }));
const mockAsk = createAsk({ backend });
await mockAsk.is("cat", "is animal");
console.log(backend.calls); // what was asked
```

## Confidence

For `ask.switch` and `ask.score`, askif uses the backend's own confidence when it reports one (TypeSafe does). Otherwise it computes one from the probabilities: 1 when all probability is on one option, 0 when it is spread evenly.

## Errors

Errors are standard `Error` objects with a `code`:

```ts
import { createAsk, isAskError, mock } from "askif";
```

```ts
// examples/errors.ts#L8-L19

const backend = mock(() => {
  throw new Error("network timeout");
});
const ask = createAsk({ backend });

let caught: unknown;
try {
  await ask.is("cat", "is animal");
} catch (error) {
  if (isAskError(error) && error.code === "BACKEND_FAILED") console.error(error.cause);
  caught = error;
}
```

| Code                  | Meaning                                                 |
| --------------------- | ------------------------------------------------------- |
| `INVALID_QUESTION`    | Too few or too many options or levels, or a duplicate key |
| `CHAIN_STARTED`       | A chain method was called after the question was sent   |
| `BACKEND_FAILED`      | The backend call failed. The original error is in `cause` |
| `BACKEND_UNAVAILABLE` | `@typesafe-ai/sdk` is not installed                     |
| `BAD_RESPONSE`        | The backend's answer did not match the question         |

## Writing good questions

From TypeSafe's docs:

- **One judgment per question.** "is angry and wants a refund" works worse than two questions combined in your code.
- **Phrase it so that yes is the interesting answer:** "contains personal data," not "is free of personal data."
- **Describe situations, not degrees.** A level like "Broken, but a workaround exists" works; "moderately severe" doesn't.
- **Test against your own data**, and tune thresholds in code.

## Name collisions

`ask` is a common name. If your code already has one, rename the import:

```ts
import { ask as decide } from "askif";
```

## Contributing

```sh
npm install
npm run check   # lint + typecheck + tests + docs check (no API key needed)
npm run build
```

Some code blocks in this README are embedded from `examples/` with [embedme](https://github.com/zakhenry/embedme), so they can't drift from the actual, tested behavior — look for a `// examples/*.ts` comment as the first line of a block. If you change one of those files, run `npm run docs` to refresh the embedded copies before committing; `npm run docs:check` (part of `npm run check`, and enforced in CI) fails if they're out of sync.

The library's source follows a few conventions, enforced by ESLint: `type` instead of `interface`, unions instead of `enum`, arrow functions only, no classes, and no `as` casts (`as const` and `satisfies` are fine).

## License

MIT
