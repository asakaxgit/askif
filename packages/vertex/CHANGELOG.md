# @askif/vertex

## 0.2.0

### Minor Changes

- ed52e63: `fallback()` sends a failed primary call to a second backend and splits a Jev-sized batch into what that backend accepts. `@askif/vertex` uses Jev when `TYPESAFE_API_KEY` is set and Gemini on Vertex AI otherwise. A Jev connection failure, timeout, 5xx, or auth failure falls back for that call. 429, caller errors, and an explicit `vertex`, `openai`, or `mock` backend do not. Vertex authenticates with a Google ADC access token read on every request.

### Patch Changes

- Updated dependencies [7e859b7]
- Updated dependencies [338f60f]
- Updated dependencies [338f60f]
- Updated dependencies [ec47497]
- Updated dependencies [c05dd6f]
- Updated dependencies [5ff45fc]
- Updated dependencies [ed52e63]
  - askif@0.3.0
  - @askif/jev@0.2.0
  - @askif/openai@0.2.0
