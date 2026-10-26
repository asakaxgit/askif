---
"askif": patch
"@askif/jev": patch
"@askif/openai": patch
---

Injection scans no longer backtrack on long whitespace or newline runs, and each state is scanned once. Values from `image()` are not cut by the 50,000-character string cap. An untrusted data URL, `{ content_type, base64 }` object, or object shaped like `image()` is sent as an image only when the payload is standard base64 and within 4 MiB of characters. Over that cap, or with line-wrapped base64, it is replaced with `[refused image: N chars]` rather than sent as text. OpenAI's `<state` fence escape no longer backtracks on a long space run. `ask.is` and `ask.probability` still return a boolean and a number; `suspected_injection` stays on `ask.if`, `ask.switch`, and `ask.score`, and the flag is best-effort.
