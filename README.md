# askif

*Let Jev decide.*

Typed decisions for your code: `ask.if`, `ask.switch`, `ask.score`.

```ts
import { ask } from "askif";

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

## `ask.if`: yes or no

```ts
await ask
  .if(ticket, "the customer is asking for a human agent", () => routeToAgent())
  .else(() => routeToBot())
  .unsure(() => sendToReview());
```

- Without `.unsure()`, the `then` handler runs when the probability is above `threshold` (default 0.5).
- With `.unsure()`, probabilities inside `unsureBand` (default 0.2–0.8) go to it instead.

For a plain `if`, use `ask.is`. For the raw number, use `ask.probability`:

```ts
if (await ask.is("penguin", "can fly")) { ... }
const p = await ask.probability("penguin", "can fly"); // 0..1
```

## `ask.switch`: one of several options

```ts
const team = await ask
  .switch(ticket, "Which team should handle this?")
  .case("returns", "Exchanges, wrong or damaged items", () => ...)
  .case("shipping", "Delivery status, delays, lost packages", () => ...)
  .case("billing", "Charges, invoices, payment problems", () => ...)
  .other(() => ...)
  .unsure(() => ...);

team.choice;  // "returns" | "shipping" | "billing" | "other"
team.ranking; // every option, most likely first
```

- The option key and its description are both sent to the model. A key that explains itself needs no description: `.case("calm")`.
- `.other()` adds an option the model can pick when nothing else fits.
- `.unsure()` runs when confidence is below `minConfidence` (default 0.5).

## `ask.score`: a position on a scale

```ts
await ask
  .score(bug, "How severe is the reported issue?")
  .level("Cosmetic; no impact to functionality", () => ...)
  .level("Broken or degraded feature, but workaround exists", () => ...)
  .level("Blocking issue; no workaround exists", () => page())
  .unsure(() => ...);
```

- Levels go from the low end to the high end, 2 to 10 of them.
- The handler that runs is the one for the **most likely** level, not the rounded score. A 50/50 split between the two ends will never run the middle handler, which got no probability.
- The result also has `score` (the probability-weighted position, which can fall between levels) and `normalized` (0..1), for ranking or combining scores.

Long descriptions can get a short key, and a description can be structured:

```ts
.level("workaround", {
  what: "Broken or degraded feature, but workaround exists",
  examples: ["export fails in one browser but works in another"],
})
```

## Results

Every chain can be awaited. It resolves after the handler finishes, with what happened:

```ts
const r = await ask.score(bug, "How severe?").level("low").level("high");
r.level;      // "low" | "high"
r.branch;     // "level" | "unsure"
r.confidence; // 0..1
```

Handlers receive the same result, so a handler can look at the runner-up or the probabilities.

## Chain in one expression

A question is sent on the next microtask, once the chain is complete. Every `.case()`, `.level()`, `.else()`, and `.unsure()` must be part of the same expression. Adding one later throws a `CHAIN_STARTED` error.

## Batching

Calls about the **same state** made in the same tick go out as one request. Jev answers them in parallel, so extra questions barely add time:

```ts
await Promise.all([
  ask.if(order, "looks fraudulent", flag),
  ask.if(order, "ships internationally", addCustoms),
  ask.score(order, "How urgent is delivery?").level("standard").level("express"),
]); // one request
```

## Configuration

```ts
ask.configure({ threshold: 0.6, minConfidence: 0.4 });

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

const ask = createAsk({ backend: typesafe({ model: "jev-1.13" }) });

// Through OpenRouter
const viaOpenRouter = createAsk({
  backend: typesafe({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api" }),
});
```

A backend is any object that answers yes/no, choice, and scale questions with probabilities. See the `Backend` type to connect another model.

For tests, `mock` answers questions locally and records every call:

```ts
import { createAsk, mock } from "askif";

const backend = mock(() => ({ kind: "yesno", probability: 0.9 }));
const ask = createAsk({ backend });
backend.calls; // what was asked
```

## Confidence

For `ask.switch` and `ask.score`, askif uses the backend's own confidence when it reports one (TypeSafe does). Otherwise it computes one from the probabilities: 1 when all probability is on one option, 0 when it is spread evenly.

## Errors

Errors are standard `Error` objects with a `code`:

```ts
import { isAskError } from "askif";

try { ... } catch (error) {
  if (isAskError(error) && error.code === "BACKEND_FAILED") console.error(error.cause);
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
npm run check   # lint + typecheck + tests (no API key needed)
npm run build
```

The library's source follows a few conventions, enforced by ESLint: `type` instead of `interface`, unions instead of `enum`, arrow functions only, no classes, and no `as` casts (`as const` and `satisfies` are fine).

## License

MIT
