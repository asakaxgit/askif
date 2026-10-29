---
"askif": minor
"@askif/vertex": minor
---

`fallback()` sends a failed primary call to a second backend and splits a Jev-sized batch into what that backend accepts. `@askif/vertex` uses Jev when `TYPESAFE_API_KEY` is set and Gemini on Vertex AI otherwise. A Jev connection failure, timeout, 5xx, or auth failure falls back for that call. 429, caller errors, and an explicit `vertex`, `openai`, or `mock` backend do not. Vertex authenticates with a Google ADC access token read on every request.
