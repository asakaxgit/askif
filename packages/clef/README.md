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

## Images

Clef can read up to 4 images (PNG, JPEG or WebP; 4 MiB each, 8 MiB total; no remote URLs). askif's state is plain JSON, so put images in the state and this backend moves them out: any base64 image data URL, or any `{ content_type, base64 }` object, anywhere in the state.

```ts
await ask.if(
  { photo: `data:image/png;base64,${base64}`, note: "customer upload" },
  "shows a damaged parcel",
  () => openClaim(),
);
```

The question and the rest of the state see an `[image 1]` placeholder where each image was (numbered in the order Clef receives them), so you can refer to "image 1" in your question. More than 4 images fails before any request is sent.

## Cost and latency

Measured on 2026-10-06 against the live API, from a host in Japan (Cloudflare edge NRT), with
`examples/bench.ts` (`node --env-file=../../.env.local --import tsx examples/bench.ts`). Seven requests per
row, one after another, over a reused connection. "Questions" are a mix of yes/no, 3-option `switch` and 3-level
`score`, all sent as **one** request. Tokens are the `usage.input_tokens` Cloudflare reports.

| model | request | questions | median ms | min-max ms | input tokens |
| --- | --- | --- | --- | --- | --- |
| clef | short text, 1 question | 1 | 700 | 471-1274 | 169 |
| clef | short text, 4 questions | 4 | 621 | 433-1015 | 418 |
| clef | short text, 16 questions | 16 | 877 | 433-1157 | 1438 |
| clef | short text, 64 questions | 64 | 1261 | 1116-1606 | 5578 |
| clef | long text (~3.6k tokens), 1 question | 1 | 987 | 746-1256 | 3786 |
| clef | 1 image, 128x128 PNG, 1 question | 1 | 715 | 217-1768 | 223 |
| clef | 1 image, 960x653 JPEG, 1 question | 1 | 1369 | 323-2567 | 759 |
| clef | 1 image, 960x960 JPEG, 1 question | 1 | 899 | 526-1166 | 1059 |
| clef | 4 images (960 px), 1 question | 1 | 1716 | 954-2102 | 2680 |
| clef-flash | short text, 1 question | 1 | 300 | 130-660 | 169 |
| clef-flash | short text, 4 questions | 4 | 245 | 141-321 | 418 |
| clef-flash | short text, 16 questions | 16 | 186 | 175-387 | 1438 |
| clef-flash | short text, 64 questions | 64 | 420 | 372-696 | 5578 |
| clef-flash | long text (~3.6k tokens), 1 question | 1 | 255 | 242-504 | 3786 |
| clef-flash | 1 image, 128x128 PNG, 1 question | 1 | 207 | 153-473 | 223 |
| clef-flash | 1 image, 960x653 JPEG, 1 question | 1 | 264 | 200-851 | 759 |
| clef-flash | 1 image, 960x960 JPEG, 1 question | 1 | 339 | 185-429 | 1059 |
| clef-flash | 4 images (960 px), 1 question | 1 | 441 | 370-617 | 2680 |

**Tokens**
- **Output tokens are always 0.** Clef reads probabilities directly instead of generating text, so only the input is billed.
- A short text and one question is about **170 input tokens**. Each additional question about the same state adds about **85**
  (a mix of yes/no, choice and scale). The state is counted once, however many questions share it.
- A long state counts in full: 150 lines of text (~3.6k tokens) came to 3,786 tokens for one question.
  Because askif sends same-state questions in one request, sixteen questions about it cost about 5.1k tokens
  (3,786 + 15 x 85, derived from the rows above), not the 60k of sixteen separate requests.
- An image adds about **55** tokens at 128x128, **590** at 960x653 and **890** at 960x960, so roughly one token per 1,000 pixels
  at the sizes where that stops being a rounding error. Four 960 px images came to 2,680.
- The 65,536-token context is not a practical limit for questions: 64 questions about a short text are about 5.6k tokens.

**Price** (Cloudflare's list prices, input tokens only; check [the model pages](https://developers.cloudflare.com/workers-ai/models/clef/) for current ones)

| | per 1M input tokens | one short question (~170 tokens) | 64 questions in one request (~5.6k) | one 960x960 image (~1.1k) |
| --- | --- | --- | --- | --- |
| `clef` | $0.24 | $0.00004 ($0.04 per 1,000 calls) | $0.0013 | $0.00025 |
| `clef-flash` | $0.09 | $0.000015 ($0.015 per 1,000 calls) | $0.0005 | $0.0001 |

**Latency**
- `clef` answers in roughly **0.6-1.0 s** for text and **0.9-1.7 s** with images. `clef-flash` is roughly **0.2-0.4 s** (up to ~0.45 s with four images).
- Questions are nearly free in time: 16 questions in one request took about the same as 1 (`clef` 877 ms vs 700 ms; `clef-flash` 186 ms vs 300 ms),
  and 64 took 1.3 s (`clef`) and 0.4 s (`clef-flash`). Batching matters for cost as well as speed.
- Expect noise: these are medians of 7 samples with wide ranges (see min-max), and another run of the same script on the same day gave
  `clef-flash` 134 ms for the first row where this one gave 300 ms. Latency depends on where you call from; from a Cloudflare Worker, the
  binding avoids the public-internet round trip, but that was not measured here.
