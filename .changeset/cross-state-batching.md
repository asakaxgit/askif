---
"askif": minor
"@askif/jev": minor
---

Same-tick questions about different states can share one backend call when the backend sets `multiState`. `maxStatesPerBatch` (default 16) caps how many states go in that call; `1` turns it off. `@askif/jev` can opt in with `jev({ multiState: true })` — it is off by default — and then packs the states into one `{ items }` state, pointing each question at its own item. Other backends are unchanged. A bad answer fails only that question.

A packed call counts images across its distinct states and will not exceed `limits.maxImages`. States are not rewritten, so image numbers stay local to each state. `extractImages(state, { from })` continues the numbering when a backend puts several states' images into one list.

**Breaking:** `Backend.decide` now resolves to `QuestionResult` (`Answer` or `{ error }`) instead of `Answer`. A `{ error }` result fails only that question. Callers that read `kind` or `probability` on the result need to narrow first (`"kind" in result`).
