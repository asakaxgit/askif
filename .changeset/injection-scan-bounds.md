---
"askif": patch
"@askif/jev": patch
---

Injection scans no longer backtrack on long whitespace or newline runs, and each state is scanned once. A `data:image/...;base64,` string is treated as an image only when the payload is standard base64 and within the size cap. `ask.is` and `ask.probability` still return a boolean and a number; `suspected_injection` stays on `ask.if`, `ask.switch`, and `ask.score`, and the flag is best-effort.
