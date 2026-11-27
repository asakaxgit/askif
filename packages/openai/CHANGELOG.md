# @askif/openai

## 0.2.0

### Minor Changes

- 338f60f: Send images in the state as `image_url` data URLs (PNG, JPEG, WebP, or GIF, up to 1500). Build them with `image()` from `askif`. Not yet verified against the live API.
- fa809c2: Images at a URL or in a bucket. `imageUrl(url)` and `bucketImage({ provider: "r2" | "s3" | "gcs", bucket, key })` put an image in the state without its bytes. `createAsk({ resolveImage })` downloads them for a backend that can't fetch them. Without it, the call fails with `UNSUPPORTED_INPUT` before any request. Backends list the kinds they fetch in `imageSources`. `@askif/openai` sends URLs as they are when it talks to OpenAI itself, and other endpoints can opt in with `imageUrls: true`. Only values returned by `imageUrl()` / `bucketImage()` are fetched. A look-alike in state JSON stays text.
  
  Type change for backend authors: `ImageSource` is now a union, so read a base64 image with `base64Source(image, name)` instead of `image.source.data`. `image()` still returns a base64-typed image.
- 0fe5a14: New option `structuredOutput`: `"json_schema"` (default, unchanged), `"json_object"` (JSON mode) or `"prompt"` (no `response_format`). The two fallback modes write the answer's JSON Schema into the prompt and parse the reply leniently, for endpoints such as Ollama that ignore or reject `response_format: json_schema`. Not yet verified against a live endpoint.
- 5ff45fc: Prompt-injection protection is on by default. States lose hidden characters and HTML comments and are capped in length. OpenAI fences each state with a per-request nonce. A state that looks injected sets `suspected_injection`, and `.unsure()` can route that call to unsure. `images: "explicit"` lifts only `image()` values. `protection: false` keeps the previous request body for OpenAI, Jev (including multipart images and packed multiState), Clef, and Vercel (`vercel()` HTTP and `vercelDecide()`).

### Patch Changes

- ec47497: Injection scans no longer backtrack on long whitespace or newline runs, and each state is scanned once. Values from `image()` are frozen and are not cut by the 50,000-character string cap. An untrusted data URL, `{ content_type, base64 }` object, or object shaped like `image()` is sent as an image only when the payload is standard base64, within 4 MiB of characters, and the state is still under 16 MiB of characters and 256 such images. Over those caps, or with line-wrapped base64, it is replaced with `[refused image: N chars]` rather than sent as text. Explicit mode cleans a data URL that stays text, and lifts only values `image()` returned. OpenAI's `<state` fence escape no longer backtracks on a long space run. `ask.is` and `ask.probability` still return a boolean and a number; `suspected_injection` stays on `ask.if`, `ask.switch`, and `ask.score`, and the flag is best-effort.
- Updated dependencies [7e859b7]
- Updated dependencies [338f60f]
- Updated dependencies [fa809c2]
- Updated dependencies [ec47497]
- Updated dependencies [5ff45fc]
- Updated dependencies [ed52e63]
  - askif@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [a96b7d9]
  - askif@0.2.0
