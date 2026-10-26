---
"askif": patch
"@askif/jev": patch
"@askif/openai": patch
---

Injection scans no longer backtrack on long whitespace or newline runs, and each state is scanned once. In `images: "auto"`, a data URL, a `{ content_type, base64 }` object, or an object shaped like `image()` is sent as an image only when the payload is standard base64 and within the size cap. Data URLs over 50,000 characters, or base64 wrapped across lines, are sent as text, not images. OpenAI's `<state` fence escape no longer backtracks on a long space run. `ask.is` and `ask.probability` still return a boolean and a number; `suspected_injection` stays on `ask.if`, `ask.switch`, and `ask.score`, and the flag is best-effort.
