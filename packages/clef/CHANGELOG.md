# @askif/clef

## 0.2.0

### Minor Changes

- 72db138: Work around HTTP 413 on small JPEGs with metadata. When the REST API answers 413, the backend retries once with the JPEG metadata (Exif, XMP, ICC, IPTC, comments, thumbnails, DPI) removed losslessly. New option `imageMetadata`: `"retry"` (default), `"strip"` (always remove it, also over a binding) or `"keep"`.
- 338f60f: Read images with askif's `extractImages()`. Clef still takes up to 4 PNG, JPEG, or WebP images, and always sends `{ content_type, base64 }`. Too many images fails with `UNSUPPORTED_INPUT` instead of `BACKEND_FAILED`.
- 5ff45fc: Prompt-injection protection is on by default. States lose hidden characters and HTML comments and are capped in length. OpenAI fences each state with a per-request nonce. A state that looks injected sets `suspected_injection`, and `.unsure()` can route that call to unsure. `images: "explicit"` lifts only `image()` values. `protection: false` keeps the previous request body for OpenAI, Jev (including multipart images and packed multiState), Clef, and Vercel (`vercel()` HTTP and `vercelDecide()`).

### Patch Changes

- fa809c2: Images at a URL or in a bucket. `imageUrl(url)` and `bucketImage({ provider: "r2" | "s3" | "gcs", bucket, key })` put an image in the state without its bytes. `createAsk({ resolveImage })` downloads them for a backend that can't fetch them. Without it, the call fails with `UNSUPPORTED_INPUT` before any request. Backends list the kinds they fetch in `imageSources`. `@askif/openai` sends URLs as they are when it talks to OpenAI itself, and other endpoints can opt in with `imageUrls: true`. Only values returned by `imageUrl()` / `bucketImage()` are fetched. A look-alike in state JSON stays text.
  
  Type change for backend authors: `ImageSource` is now a union, so read a base64 image with `base64Source(image, name)` instead of `image.source.data`. `image()` still returns a base64-typed image.
- c05dd6f: `@askif/jev` can send PNG and JPEG images when `jev()` is called with `images: true`. Image input stays off unless that option is set, and a state that contains an image then fails with `UNSUPPORTED_INPUT` instead of being sent as text. A packed `decideMany` call numbers those images in one list.
  
  The `@askif/clef` README records the current clef-flash list price ($0.038 per million input tokens) and the 24,576-token context of hosted clef-flash.
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
