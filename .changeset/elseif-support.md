---
"askif": minor
---

Add `.elseif()` to `ask.if`. Every condition is asked in one batch and the first true one, in order, wins. `.unsure(handler, { on: "stop" | "skip" })` controls what an unsure condition does to the rest of the chain, and `IfResult` gains `index`, `condition` and `unsureIndexes`.
