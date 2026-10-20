---
"askif": minor
"@askif/jev": minor
---

Same-tick questions about different states can share one backend call when the backend sets `multiState`. `maxStatesPerBatch` (default 16) caps how many states go in that call; `1` turns it off. `@askif/jev` opts in and packs the states into one `{ items }` state, pointing each question at its own item. Other backends are unchanged. A bad answer fails only that question.
