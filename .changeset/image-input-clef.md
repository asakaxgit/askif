---
"@askif/clef": minor
---

Read images with askif's `extractImages()`. Clef still takes up to 4 PNG, JPEG, or WebP images, and always sends `{ content_type, base64 }`. Too many images fails with `UNSUPPORTED_INPUT` instead of `BACKEND_FAILED`.
