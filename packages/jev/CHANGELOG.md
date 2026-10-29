# @askif/jev

## 0.2.0

### Minor Changes

- 7e859b7: Same-tick questions about different states can share one backend call when the backend sets `multiState`. `maxStatesPerBatch` (default 16) caps how many states go in that call; `1` turns it off. `@askif/jev` can opt in with `jev({ multiState: true })` — it is off by default — and then packs the states into one `{ items }` state, pointing each question at its own item. Other backends are unchanged. A bad answer fails only that question.
  
  A packed call counts images across its distinct states and will not exceed `limits.maxImages`. States are not rewritten, so image numbers stay local to each state. `extractImages(state, { from })` continues the numbering when a backend puts several states' images into one list.
  
  **Breaking:** `Backend.decide` now resolves to `QuestionResult` (`Answer` or `{ error }`) instead of `Answer`. A `{ error }` result fails only that question. Callers that read `kind` or `probability` on the result need to narrow first (`"kind" in result`).
- c05dd6f: `@askif/jev` can send PNG and JPEG images when `jev()` is called with `images: true`. Image input stays off unless that option is set, and a state that contains an image then fails with `UNSUPPORTED_INPUT` instead of being sent as text. A packed `decideMany` call numbers those images in one list.
  
  The `@askif/clef` README records the current clef-flash list price ($0.038 per million input tokens) and the 24,576-token context of hosted clef-flash.
- 5ff45fc: Prompt-injection protection is on by default. States lose hidden characters and HTML comments and are capped in length. OpenAI fences each state with a per-request nonce. A state that looks injected sets `suspected_injection`, and `.unsure()` can route that call to unsure. `images: "explicit"` lifts only `image()` values. `protection: false` keeps the previous request body for OpenAI, Jev (including multipart images and packed multiState), Clef, and Vercel (`vercel()` HTTP and `vercelDecide()`).

### Patch Changes

- ec47497: Injection scans no longer backtrack on long whitespace or newline runs, and each state is scanned once. Values from `image()` are frozen and are not cut by the 50,000-character string cap. An untrusted data URL, `{ content_type, base64 }` object, or object shaped like `image()` is sent as an image only when the payload is standard base64, within 4 MiB of characters, and the state is still under 16 MiB of characters and 256 such images. Over those caps, or with line-wrapped base64, it is replaced with `[refused image: N chars]` rather than sent as text. Explicit mode cleans a data URL that stays text, and lifts only values `image()` returned. OpenAI's `<state` fence escape no longer backtracks on a long space run. `ask.is` and `ask.probability` still return a boolean and a number; `suspected_injection` stays on `ask.if`, `ask.switch`, and `ask.score`, and the flag is best-effort.
- Updated dependencies [7e859b7]
- Updated dependencies [338f60f]
- Updated dependencies [ec47497]
- Updated dependencies [5ff45fc]
- Updated dependencies [ed52e63]
  - askif@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [a96b7d9]
  - askif@0.2.0

## 0.1.1

### Patch Changes

- b81f951: Add a README to each published package (npmjs.com was showing "No README data" for both) and a `repository` field pointing at this repo.
- Updated dependencies [b81f951]
  - askif@0.1.1
