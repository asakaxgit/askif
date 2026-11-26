---
"askif": minor
"@askif/openai": minor
"@askif/clef": patch
"@askif/jev": patch
"@askif/vercel": patch
---

Images at a URL or in a bucket. `imageUrl(url)` and `bucketImage({ provider: "r2" | "s3" | "gcs", bucket, key })` put an image in the state without its bytes. `createAsk({ resolveImage })` downloads them for a backend that can't fetch them. Without it, the call fails with `UNSUPPORTED_INPUT` before any request. Backends list the kinds they fetch in `imageSources`. `@askif/openai` sends URLs as they are when it talks to OpenAI itself, and other endpoints can opt in with `imageUrls: true`. Only values returned by `imageUrl()` / `bucketImage()` are fetched. A look-alike in state JSON stays text.

Type change for backend authors: `ImageSource` is now a union, so read a base64 image with `base64Source(image, name)` instead of `image.source.data`. `image()` still returns a base64-typed image.
