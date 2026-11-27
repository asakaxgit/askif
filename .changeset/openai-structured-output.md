---
"@askif/openai": minor
---

New option `structuredOutput`: `"json_schema"` (default, unchanged), `"json_object"` (JSON mode) or `"prompt"` (no `response_format`). The two fallback modes write the answer's JSON Schema into the prompt and parse the reply leniently, for endpoints such as Ollama that ignore or reject `response_format: json_schema`. Not yet verified against a live endpoint.
