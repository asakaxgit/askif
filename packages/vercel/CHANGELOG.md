# @askif/vercel

## 0.2.0

### Minor Changes

- 5ff45fc: Prompt-injection protection is on by default. States lose hidden characters and HTML comments and are capped in length. OpenAI fences each state with a per-request nonce. A state that looks injected sets `suspected_injection`, and `.unsure()` can route that call to unsure. `images: "explicit"` lifts only `image()` values. `protection: false` keeps the previous request body for OpenAI, Jev (including multipart images and packed multiState), Clef, and Vercel (`vercel()` HTTP and `vercelDecide()`).
- 524778b: Initial release of `@askif/vercel`: a Vercel AI Gateway Decision API backend (`POST /v1/evaluate`) and optional AI SDK `vercelDecide` (`experimental_decide`).

### Patch Changes

- fa809c2: Images at a URL or in a bucket. `imageUrl(url)` and `bucketImage({ provider: "r2" | "s3" | "gcs", bucket, key })` put an image in the state without its bytes. `createAsk({ resolveImage })` downloads them for a backend that can't fetch them. Without it, the call fails with `UNSUPPORTED_INPUT` before any request. Backends list the kinds they fetch in `imageSources`. `@askif/openai` sends URLs as they are when it talks to OpenAI itself, and other endpoints can opt in with `imageUrls: true`. Only values returned by `imageUrl()` / `bucketImage()` are fetched. A look-alike in state JSON stays text.
  
  Type change for backend authors: `ImageSource` is now a union, so read a base64 image with `base64Source(image, name)` instead of `image.source.data`. `image()` still returns a base64-typed image.
- Updated dependencies [7e859b7]
- Updated dependencies [338f60f]
- Updated dependencies [fa809c2]
- Updated dependencies [ec47497]
- Updated dependencies [5ff45fc]
- Updated dependencies [ed52e63]
  - askif@0.3.0
