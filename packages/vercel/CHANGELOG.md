# @askif/vercel

## 0.2.0

### Minor Changes

- 5ff45fc: Prompt-injection protection is on by default. States lose hidden characters and HTML comments and are capped in length. OpenAI fences each state with a per-request nonce. A state that looks injected sets `suspected_injection`, and `.unsure()` can route that call to unsure. `images: "explicit"` lifts only `image()` values. `protection: false` keeps the previous request body for OpenAI, Jev (including multipart images and packed multiState), Clef, and Vercel (`vercel()` HTTP and `vercelDecide()`).
- 524778b: Initial release of `@askif/vercel`: a Vercel AI Gateway Decision API backend (`POST /v1/evaluate`) and optional AI SDK `vercelDecide` (`experimental_decide`).

### Patch Changes

- Updated dependencies [7e859b7]
- Updated dependencies [338f60f]
- Updated dependencies [ec47497]
- Updated dependencies [5ff45fc]
- Updated dependencies [ed52e63]
  - askif@0.3.0
