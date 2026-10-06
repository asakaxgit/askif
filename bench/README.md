# Backend comparison

`compare.ts` sends the same questions to every live backend, interleaved run by run, and records the HTTP
requests, input and output tokens, and wall-clock time of each `decide` call. Only text, because only
`@askif/clef` takes images (its image numbers are in [its README](../packages/clef/README.md#cost-and-latency)).

```sh
# from the repo root; costs a few cents per provider
node --env-file=.env.local --import tsx bench/compare.ts
BENCH_RUNS=7 BENCH_BACKENDS=clef,jev node --env-file=.env.local --import tsx bench/compare.ts
```

## Results

Measured 2026-10-06 ~16:00 UTC from one host in Japan (Cloudflare edge NRT), 7 runs per cell, medians. The
"questions" are a mix of yes/no, 3-option `switch` and 3-level `score` about one state.
Default models: `jev` is `jev-latest`, `clef` and `clef-flash` as named.

| request | backend | HTTP requests | median ms | min-max ms | input tokens | output tokens |
| --- | --- | --- | --- | --- | --- | --- |
| short text, 1 question | clef | 1 | 861 | 200-1931 | 169 | 0 |
| | clef-flash | 1 | 408 | 118-1805 | 169 | 0 |
| | jev | 1 | 163 | 143-232 | 298 | 21 |
| | openai | 1 | 1805 | 1238-3067 | 197 | 16 |
| short text, 4 questions | clef | 1 | 547 | 436-584 | 418 | 0 |
| | clef-flash | 1 | 252 | 129-506 | 418 | 0 |
| | jev | 1 | 190 | 157-225 | 413 | 88 |
| short text, 16 questions | clef | 1 | 668 | 542-783 | 1,438 | 0 |
| | clef-flash | 1 | 337 | 160-823 | 1,438 | 0 |
| | jev | 1 | 179 | 158-203 | 811 | 346 |
| short text, 64 questions | clef | 1 | 1,115 | 879-1,488 | 5,578 | 0 |
| | clef-flash | 1 | 385 | 353-14,806 | 5,578 | 0 |
| | jev | 1 | 178 | 159-203 | 2,419 | 1,402 |
| long text (~3.6k tokens), 1 question | clef | 1 | 973 | 770-1,506 | 3,786 | 0 |
| | clef-flash | 1 | 236 | 232-961 | 3,786 | 0 |
| | jev | 1 | 175 | 164-219 | 3,766 | 21 |

`openai` has only the first row. It sends one request per question, and the account used here is limited
to 10 requests per minute and 50 per day (`gpt-6-luna`), so the multi-question rows hit HTTP 429 and are not
reported. Its first row comes from an earlier run on the same host 6 minutes before the others (15:54 UTC,
the same interleaved script); in that run the other backends' medians for the same row were 814 ms (`clef`),
133 ms (`clef-flash`) and 183 ms (`jev`).

## What it shows

- **Latency:** `jev` is the fastest and the flattest: about 0.16-0.19 s from 1 question to 64. `clef-flash` is next
  (about 0.1-0.4 s), then `clef` (about 0.5-1.1 s, growing with the number of questions). `openai` took about 1.8 s for a
  single question.
- **Tokens, one question:** `clef` and `clef-flash` use the fewest input tokens (169), then `openai` (197), then `jev` (298).
- **Tokens, many questions:** the gap reverses with batching. Each extra question adds about 85 input tokens on `clef`
  and about 34 on `jev` (64 questions: 5,578 vs 2,419), because `jev`'s input tokens grow more slowly per question (that is token counts, not billing). `openai`
  repeats the state in every request, so its input grows by about 200 tokens per question (not measured beyond one).
- **Output tokens:** `clef` produces none. `jev` reports about 21 per question and `openai` 16 for its one yes/no.
  Whether they are billed depends on the provider; this repo does not record prices for `jev` or `openai`.
- **Long state:** with ~3.6k tokens of text, input tokens are about the same for `clef` and `jev` (3,786 vs 3,766).
- **Price:** only `clef` ($0.24 per 1M input tokens) and `clef-flash` ($0.09) have list prices recorded in
  [the clef README](../packages/clef/README.md#cost-and-latency); check the other providers' pages.

## Caveats

- One host, one hour, 7 runs: indicative, not definitive. Single requests spike (`clef-flash` had a 14.8 s
  outlier at 64 questions, and its 1-question median was 133 ms in one run and 408 ms in another), so look at the
  min-max column, not just the median.
- Latency includes the round trip from this host. A Cloudflare Worker using the `AI` binding for `clef` avoids
  the public-internet leg; that is not measured here.
- Token counts are what each provider reports for the request, so they include prompt scaffolding the provider adds.
