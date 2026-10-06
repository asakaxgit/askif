# @askif/clef

[Cloudflare Workers AI Clef](https://developers.cloudflare.com/workers-ai/models/clef/) for [askif](https://github.com/asakaxgit/askif), with a ready-to-use `ask`.

Clef is a decision model: it takes a state and typed questions and returns a probability for every answer. That is askif's own model, so there is no prompt or JSON schema in between, and all questions about one state go out as **one request** (up to 64).

```sh
npm install @askif/clef askif
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...   # needs Workers AI access
```

```ts
import { ask } from "@askif/clef";

await ask.if(ticket, "is urgent", () => page()).else(() => queue());
```

## Options

```ts
import { createAsk } from "askif";
import { clef } from "@askif/clef";

const ask = createAsk({
  backend: clef({
    model: "clef-flash",        // "clef" (default) or "clef-flash"
    accountId: "...",           // default: CLOUDFLARE_ACCOUNT_ID
    apiToken: "...",            // default: CLOUDFLARE_API_TOKEN
  }),
});
```

## In a Cloudflare Worker

Pass the `AI` binding instead of credentials:

```ts
export default {
  async fetch(request: Request, env: { AI: ClefBinding }) {
    const ask = createAsk({ backend: clef({ binding: env.AI }) });
    return new Response((await ask.is(await request.text(), "is spam")) ? "spam" : "ok");
  },
};
```

## Limits

1–64 questions per request (askif splits larger batches; its own `maxBatchSize` defaults to 32, so raise it in `createAsk` to use all 64), 2–255 options per `switch`, 2–10 levels per `score`, a 65,536-token context (long text state is truncated by Clef).

Clef can also read up to 4 images; askif's state is JSON, so images are not supported yet.
