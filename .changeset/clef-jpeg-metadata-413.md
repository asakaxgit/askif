---
"@askif/clef": minor
---

Work around HTTP 413 on small JPEGs with metadata. When the REST API answers 413, the backend retries once with the JPEG metadata (Exif, XMP, ICC, IPTC, comments, thumbnails, DPI) removed losslessly. New option `imageMetadata`: `"retry"` (default), `"strip"` (always remove it, also over a binding) or `"keep"`.
