# askif

## 0.2.0

### Minor Changes

- a96b7d9: Add `.elseif()` to `ask.if`. Every condition is asked in one batch and the first true one, in order, wins. `.unsure(handler, { mode: "stop" | "skip" })` controls what an unsure condition does to the rest of an `.elseif()` chain.
  
  **Breaking:** `IfResult` is now a union on `branch` (`"then" | "elseif" | "else" | "unsure"`) and handlers receive the result for their own branch. `else` results no longer have `probability`, so use the new `probabilities` (one per condition) or narrow on `branch`. `then`, `elseif` and `unsure` results gain `index` and `condition`, and every result gains `unsureIndexes`.

## 0.1.1

### Patch Changes

- b81f951: Add a README to each published package (npmjs.com was showing "No README data" for both) and a `repository` field pointing at this repo.
