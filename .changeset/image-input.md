---
"askif": minor
---

Add `image()`, `extractImages()`, `isImage`, `Image`, and `ImageSource`. `image()` takes bytes, standard base64, base64url, or a data URL (PNG, JPEG, WebP, GIF) and stores standard base64. `BackendLimits.maxImages` is how many images a backend accepts.

A state that contains image data is rejected with `UNSUPPORTED_INPUT` when the backend does not set `maxImages`, or when it contains more images than that limit. Those states used to be sent through as text, including to `@askif/jev`, `mock`, and third-party backends.
