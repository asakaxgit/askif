# askif

*Let Jev decide.*

Typed decisions for your code: `ask.if`, `ask.switch`, `ask.score`.

`askif` is the provider-neutral toolkit: the chain logic, the `Backend` contract, and a `mock` backend for tests. [`@askif/jev`](./packages/jev) is the batteries-included bundle for TypeSafe's Jev, with a ready-to-use `ask`:

```ts
import { ask } from "@askif/jev";
```

```ts
// packages/jev/examples/basic.ts#L5-L7

await ask.if("cat", "is animal", () => {
  console.log("cat is animal");
});
```

Each call asks [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's System One model, a question about some state. Jev returns probabilities instead of text, and askif runs the branch that matches.

> Unofficial, not affiliated with TypeSafe AI.

## Install

```sh
npm install askif @askif/jev
export TYPESAFE_API_KEY=...
```

Node 22 or newer. Run it on a server: the TypeSafe SDK refuses to run in a browser, where your API key would be exposed. Building your own backend instead of using Jev? `npm install askif` alone is enough — see [Backends](#backends).

## Examples

Runnable examples for everything below live alongside each package: [`packages/askif/examples/`](./packages/askif/examples) runs offline against the `mock` backend, and [`packages/jev/examples/`](./packages/jev/examples) has the live quickstart (needs `TYPESAFE_API_KEY`):

```sh
npx tsx packages/askif/examples/if.ts
```

## `ask.if`: yes or no

```ts
// packages/askif/examples/if.ts#L44-L48

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
// packages/askif/examples/if.ts#L87-L91

if (await ask.is("penguin", "can fly")) console.log("penguin can fly");
else console.log("penguin can't fly");

// ask.probability: the raw number, when you want to do your own thing with it.
const p = await ask.probability("penguin", "can fly"); // 0..1
```

### `.elseif()`: first match wins

```ts
// packages/askif/examples/if.ts#L96-L102

const message = "It would be great if the export button supported CSV.";
const routeResult = await ask
  .if(message, "is a bug report", () => console.log("-> bug tracker"))
  .elseif("is a feature request", () => console.log("-> roadmap"))
  .elseif("is a question", () => console.log("-> support"))
  .else(() => console.log("-> inbox"));
assert.ok(routeResult.branch === "elseif");
```

- Every condition is sent in the same batch, so a ladder costs about one round-trip, not one per branch. The answers for the branches after the winner are discarded.
- Branches are checked in order, and only the first match runs.
- The tokens for every condition are spent whether or not it matters, and `@askif/openai` sends one request per question. If the options are mutually exclusive categories, `ask.switch` is cheaper and lets the model compare them against each other.
- `.elseif(condition, handler?, { threshold, unsureBand, criteria })` takes its own options. Anything omitted falls back to the `ask.if` options (`criteria` is never inherited).
- A winning `.elseif()` reports `branch: "elseif"` (the `if` itself reports `"then"`), so a check like `result.branch === "then"` never mistakes one for the other.

By default, an unsure condition **ends the chain**: a later branch never beats an earlier one that might be true. When the branches are independent, pass `{ mode: "skip" }` to `.unsure()` instead. Unsure conditions are skipped, and `unsure` runs, instead of `else`, only if nothing matched.

```ts
// packages/askif/examples/if.ts#L106-L117

// An unsure condition ends the chain by default, so a later branch can't beat one that might be true.
// Pass { mode: "skip" } when the branches are independent: unsure ones are skipped instead.
const unsureStopResult = await ask
  .if(message, "is a refund request", () => console.log("-> refunds"))
  .elseif("is a feature request", () => console.log("-> roadmap"))
  .unsure(() => console.log("-> sent for review"));
assert.equal(unsureStopResult.branch, "unsure");

const unsureSkipResult = await ask
  .if(message, "is a refund request", () => console.log("-> refunds"))
  .elseif("is a feature request", () => console.log("-> roadmap"))
  .unsure(() => console.log("-> sent for review"), { mode: "skip" });
```

## `ask.switch`: one of several options

```ts
// packages/askif/examples/switch.ts#L17-L29

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

`.other()` and `.unsure()` chain onto the same call — see [`packages/askif/examples/switch.ts`](./packages/askif/examples/switch.ts) for both in action.

- The option key and its description are both sent to the model. A key that explains itself needs no description: `.case("calm")`.
- `.other()` adds an option the model can pick when nothing else fits.
- `.unsure()` runs when confidence is below `minConfidence` (default 0.5).

## `ask.score`: a position on a scale

```ts
// packages/askif/examples/score.ts#L16-L26

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
// packages/askif/examples/score.ts#L65-L72

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
// packages/askif/examples/score.ts#L36-L39

const resultAsk = createAsk({ backend: scaleBackend([0.3, 0.7]) });
const bug = "Cannot save changes to the profile page.";
const r = await resultAsk.score(bug, "How severe?").level("low").level("high");
console.log(r.level, r.branch, r.confidence);
```

`r.level`, `r.branch`, and `r.confidence` are all available on the resolved result.

Handlers receive the same result, so a handler can look at the runner-up or the probabilities.

`ask.if` results are a union on `branch` (`"then"`, `"elseif"`, `"else"`, `"unsure"`), and each handler receives the result for its own branch. Every result carries `probabilities` (one per condition, in order) and `unsureIndexes` (every condition judged unsure). All but `else` also have `condition`, `probability`, and `index` (0 for the `if`, 1.. for each `.elseif()`).

## Chain in one expression

A question is sent on the next microtask, once the chain is complete. Every `.case()`, `.level()`, `.elseif()`, `.else()`, and `.unsure()` must be part of the same expression. Adding one later throws a `CHAIN_STARTED` error.

## Batching

Calls about the **same state** made in the same tick go out as one request. Jev answers them in parallel, so extra questions barely add time. The conditions of an `.elseif()` chain are batched too. (`@askif/openai` has no native batching, so it sends one request per question instead — still in parallel, but not one HTTP call.)

```ts
// packages/askif/examples/batching.ts#L24-L32

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
// packages/askif/examples/configuration.ts#L23-L28

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

A backend is any object that answers yes/no, choice, and scale questions with probabilities. `@askif/jev`'s default `ask` uses Jev's `jev-latest` model. Make your own instance for a different model or endpoint:

```ts
import { createAsk } from "askif";
import { jev } from "@askif/jev";
```

```ts
// packages/jev/examples/backends.ts#L11-L18

// The default `ask` uses jev-latest. Make your own instance for a different
// model or endpoint.
const custom = createAsk({ backend: jev({ model: "jev-1.13" }) });

// Through OpenRouter.
const viaOpenRouter = createAsk({
  backend: jev({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api" }),
});
```

`@askif/jev` also works with [OpenJev](https://github.com/razorback16/openjev), an open Jev-compatible server: set `baseURL` and `model` (details in [its README](./packages/jev#other-jev-compatible-servers)).

See the `Backend` type (from `askif`) to connect another model entirely — `@askif/jev` is just one implementation of it. [`@askif/openai`](./packages/openai) is another, for OpenAI and OpenAI-compatible APIs.

For tests, `mock` (from `askif`, no `@askif/jev` needed) answers questions locally and records every call:

```ts
import { createAsk, mock } from "askif";
```

```ts
// packages/askif/examples/backends.ts#L10-L17

// A backend is any object that answers yes/no, choice, and scale questions
// with probabilities. `mock` answers questions locally and records every call
// — handy for tests, or as a template for a real backend.
const backend = mock(() => ({ kind: "yesno", probability: 0.9 }));
const ask = createAsk({ backend });
await ask.is("cat", "is animal");
console.log(backend.calls); // what was asked
assert.equal(backend.calls.length, 1);
```

## Confidence

For `ask.switch` and `ask.score`, askif uses the backend's own confidence when it reports one (TypeSafe does). Otherwise it computes one from the probabilities: 1 when all probability is on one option, 0 when it is spread evenly.

## Errors

Errors are standard `Error` objects with a `code`:

```ts
import { createAsk, isAskError, mock } from "askif";
```

```ts
// packages/askif/examples/errors.ts#L8-L19

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
| `BACKEND_UNAVAILABLE` | A backend's own dependency is missing (e.g. `@typesafe-ai/sdk` for `@askif/jev`, `openai` for `@askif/openai`) |
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
import { ask as decide } from "@askif/jev";
```

## Contributing

This is a [pnpm](https://pnpm.io) workspace with three packages: [`packages/askif`](./packages/askif) (the toolkit), [`packages/jev`](./packages/jev) (the Jev bundle), and [`packages/openai`](./packages/openai) (the OpenAI bundle) — the last two each depend on `askif`.

```sh
pnpm install
pnpm run check   # lint + typecheck + tests + docs check (no API key needed)
pnpm run build
```

Some code blocks in this README are embedded from each package's `examples/` with [embedme](https://github.com/zakhenry/embedme), so they can't drift from the actual, tested behavior — look for a `// packages/*/examples/*.ts` comment as the first line of a block. If you change one of those files, run `pnpm run docs` to refresh the embedded copies before committing; `pnpm run docs:check` (part of `pnpm run check`, and enforced in CI) fails if they're out of sync.

The library's source follows a few conventions, enforced by ESLint: `type` instead of `interface`, unions instead of `enum`, arrow functions only, no classes, and no `as` casts (`as const` and `satisfies` are fine).

Publishing is automated via [Changesets](https://github.com/changesets/changesets) — see [`RELEASING.md`](./RELEASING.md).

## License

MIT
