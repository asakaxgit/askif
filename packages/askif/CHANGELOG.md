# askif

## 0.3.0

### Minor Changes

- 7e859b7: Same-tick questions about different states can share one backend call when the backend sets `multiState`. `maxStatesPerBatch` (default 16) caps how many states go in that call; `1` turns it off. `@askif/jev` can opt in with `jev({ multiState: true })` — it is off by default — and then packs the states into one `{ items }` state, pointing each question at its own item. Other backends are unchanged. A bad answer fails only that question.
  
  A packed call counts images across its distinct states and will not exceed `limits.maxImages`. States are not rewritten, so image numbers stay local to each state. `extractImages(state, { from })` continues the numbering when a backend puts several states' images into one list.
  
  **Breaking:** `Backend.decide` now resolves to `QuestionResult` (`Answer` or `{ error }`) instead of `Answer`. A `{ error }` result fails only that question. Callers that read `kind` or `probability` on the result need to narrow first (`"kind" in result`).
- 338f60f: Add `image()`, `extractImages()`, `isImage`, `Image`, and `ImageSource`. `image()` takes bytes, standard base64, base64url, or a data URL (PNG, JPEG, WebP, GIF) and stores standard base64. `BackendLimits.maxImages` is how many images a backend accepts.
  
  A state that contains image data is rejected with `UNSUPPORTED_INPUT` when the backend does not set `maxImages`, or when it contains more images than that limit. Those states used to be sent through as text, including to `@askif/jev`, `mock`, and third-party backends.
- 5ff45fc: Prompt-injection protection is on by default. States lose hidden characters and HTML comments and are capped in length. OpenAI fences each state with a per-request nonce. A state that looks injected sets `suspected_injection`, and `.unsure()` can route that call to unsure. `images: "explicit"` lifts only `image()` values. `protection: false` keeps the previous request body for OpenAI, Jev (including multipart images and packed multiState), Clef, and Vercel (`vercel()` HTTP and `vercelDecide()`).
- ed52e63: `fallback()` sends a failed primary call to a second backend and splits a Jev-sized batch into what that backend accepts. `@askif/vertex` uses Jev when `TYPESAFE_API_KEY` is set and Gemini on Vertex AI otherwise. A Jev connection failure, timeout, 5xx, or auth failure falls back for that call. 429, caller errors, and an explicit `vertex`, `openai`, or `mock` backend do not. Vertex authenticates with a Google ADC access token read on every request.

### Patch Changes

- ec47497: Injection scans no longer backtrack on long whitespace or newline runs, and each state is scanned once. Values from `image()` are frozen and are not cut by the 50,000-character string cap. An untrusted data URL, `{ content_type, base64 }` object, or object shaped like `image()` is sent as an image only when the payload is standard base64, within 4 MiB of characters, and the state is still under 16 MiB of characters and 256 such images. Over those caps, or with line-wrapped base64, it is replaced with `[refused image: N chars]` rather than sent as text. Explicit mode cleans a data URL that stays text, and lifts only values `image()` returned. OpenAI's `<state` fence escape no longer backtracks on a long space run. `ask.is` and `ask.probability` still return a boolean and a number; `suspected_injection` stays on `ask.if`, `ask.switch`, and `ask.score`, and the flag is best-effort.

## 0.2.0

### Minor Changes

- a96b7d9: Add `.elseif()` to `ask.if`. Every condition is asked in one batch and the first true one, in order, wins. `.unsure(handler, { mode: "stop" | "skip" })` controls what an unsure condition does to the rest of an `.elseif()` chain.
  
  **Breaking:** `IfResult` is now a union on `branch` (`"then" | "elseif" | "else" | "unsure"`) and handlers receive the result for their own branch. `else` results no longer have `probability`, so use the new `probabilities` (one per condition) or narrow on `branch`. `then`, `elseif` and `unsure` results gain `index` and `condition`, and every result gains `unsureIndexes`.

## 0.1.1

### Patch Changes

- b81f951: Add a README to each published package (npmjs.com was showing "No README data" for both) and a `repository` field pointing at this repo.
