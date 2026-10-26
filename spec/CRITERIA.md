# Criteria

Spec version: [`0.1`](VERSION). Language-specific API shape is not a criterion. A behaviour that cannot be executed through [`DRIVER.md`](DRIVER.md) is not a criterion either; those notes live in [`TODO.md`](TODO.md).

Each heading is one criterion. `tag` is `core` (every language) or `deferred` (TypeScript now, JVM later). `cases` lists the files under [`cases/`](cases/) that verify it. The runner fails the build when a heading has no case, a case names an unknown id, or a `core` cell is red.

Defaults, when a case does not say otherwise: threshold `0.5`, unsure band `[0.2, 0.8]`, minConfidence `0.5`, maxBatchSize `32`, maxStatesPerBatch `16`. Input protection (`PR-*`) is on in the TypeScript core and is not a shared 0.1 default.

## IF

### IF-01

- tag: core
- cases: IF-01/then

With no unsure handler, a yes/no probability strictly greater than the call's threshold selects branch `then`, index `0`, and runs the then handler.

### IF-02

- tag: core
- cases: IF-02/else, IF-02/threshold-edge

With no unsure handler, a probability less than or equal to the threshold selects branch `else` and runs the else handler. Equality is not `then`.

### IF-03

- tag: core
- cases: IF-03/band-inside, IF-03/band-edge-low, IF-03/band-edge-high, IF-03/above-band, IF-03/below-band

With an unsure handler, `p > high` selects `then`, `p < low` selects `else`, and `low <= p <= high` selects `unsure`. The band edges are unsure.

### IF-04

- tag: core
- cases: IF-04/per-call-threshold

A per-call threshold replaces the configured threshold for that call only.

### IF-05

- tag: core
- cases: IF-05/is-and-probability

`is` is true exactly when the yes/no probability is strictly greater than the threshold. `probability` returns that probability unchanged.

### IF-06

- tag: core
- cases: IF-06/first-true-wins

An `elseif` chain asks every condition. The first condition that holds wins, later true conditions do not run their handlers, and the result's `index` is that condition's position (`0` for the first). `probabilities` lists every condition in order.

### IF-07

- tag: core
- cases: IF-07/none-hold

When no condition holds and none was unsure, the branch is `else` and `probabilities` still lists every condition.

### IF-08

- tag: core
- cases: IF-08/one-batch

Every condition of one chain is sent in one `decide` call.

### IF-09

- tag: core
- cases: IF-09/per-branch-threshold, IF-09/per-branch-band

An `elseif` may set its own threshold or unsure band. It does not keep the previous branch's band when it sets one.

### IF-10

- tag: core
- cases: IF-10/unsure-stops

The default unsure mode is `stop`: the first unsure condition selects `unsure` and later conditions are not judged. `unsureIndexes` contains that index.

### IF-11

- tag: core
- cases: IF-11/skip-later-wins, IF-11/skip-falls-to-unsure, IF-11/skip-falls-to-else

Mode `skip`: an unsure condition does not match and the chain continues. A later condition that holds wins, and `unsureIndexes` still records the skipped one. If nothing holds and some condition was unsure, the branch is `unsure` (the first such index), not `else`. If nothing was unsure, the branch is `else`.

### IF-12

- tag: core
- cases: IF-12/criteria-not-inherited

Criteria on the first condition are not copied onto later conditions. A later condition sends criteria only when it sets them. Yes/no criteria use the keys `true` and `false`.

### IF-13

- tag: core
- cases: IF-13/winning-handler

Only the winning branch's handler runs, and it runs before that call's result is observable.

## SWITCH

### SW-01

- tag: core
- cases: SW-01/winner, SW-01/tie-keeps-order

The option with the highest probability wins. `ranking` is every declared option, probability descending. Equal probabilities keep declaration order. A missing probability is `0`.

### SW-02

- tag: core
- cases: SW-02/default-descriptions

An omitted option description is sent as JSON `null`. An omitted `other` description is sent as `"None of the other options fit"`.

### SW-03

- tag: core
- cases: SW-03/other-wins

`other` is an ordinary option key and can win.

### SW-04

- tag: core
- cases: SW-04/low-confidence

With an unsure handler, a backend-reported confidence strictly below `minConfidence` selects branch `unsure`. The winning choice is still reported.

### SW-05

- tag: core
- cases: SW-05/confidence-equals-min

Confidence equal to `minConfidence` is not unsure.

### SW-06

- tag: core
- cases: SW-06/computed-certain, SW-06/computed-uniform

When the backend omits confidence, it is `1 - H / log(n)`: `H` is the natural entropy of the ranking probabilities, skipping non-positive weights, and `n` is the number of options. The value is clamped to `[0, 1]`. A one-hot distribution is `1`. A uniform distribution of length at least 2 is `0`.

### SW-07

- tag: core
- cases: SW-07/duplicate-key

Declaring the same option key twice, including `other` against `other`, is `INVALID_QUESTION` and does not call the backend.

### SW-08

- tag: core
- cases: SW-08/too-few-options

Fewer than two options is `INVALID_QUESTION` and does not call the backend.

### SW-09

- tag: core
- cases: SW-09/max-options

More options than `limits.maxOptions` is `INVALID_QUESTION` and does not call the backend.

## SCORE

### SC-01

- tag: core
- cases: SC-01/weighted-score

The winning level is the first maximum probability, not the rounded weighted score. `score` is `sum(p_i * i)`. `normalized` is `score / (levels - 1)`. `index` is that winning position.

### SC-02

- tag: core
- cases: SC-02/split-ends, SC-02/tie-first-index

A split between the two ends does not select an empty middle level. Equal probabilities at two indexes select the earlier index.

### SC-03

- tag: core
- cases: SC-03/low-confidence

With an unsure handler, computed or reported confidence strictly below `minConfidence` selects branch `unsure`. The argmax level is still reported.

### SC-04

- tag: core
- cases: SC-04/descriptions

An omitted level description is sent as the level key. A provided description is sent in its place. The key itself is not added to the payload.

### SC-05

- tag: core
- cases: SC-05/too-few-levels, SC-05/max-levels

Fewer than two levels, or more levels than `limits.maxLevels`, is `INVALID_QUESTION` and does not call the backend.

### SC-06

- tag: core
- cases: SC-06/duplicate-level

Declaring the same level key twice is `INVALID_QUESTION` and does not call the backend.

### SC-07

- tag: core
- cases: SC-07/probability-length

A scale answer whose probability list length is not the level count is `BAD_RESPONSE` for that question. A sibling question in the same call still resolves.

## CONF

### CF-01

- tag: core
- cases: SW-06/computed-certain, SW-06/computed-uniform

Same formula as `SW-06`. Choice and score share it. Backend-reported confidence, when present, replaces it (`SW-04`).

## BATCH

### BA-01

- tag: core
- cases: BA-01/same-state

Questions about one state submitted in one group share one `decide` call. Payload keys are `q0`, `q1`, … in enqueue order.

### BA-02

- tag: core
- cases: BA-02/separate-states, BA-05/flag-without-decide-many

Distinct states in one group use separate `decide` calls when the backend does not pack states. A `multiState` flag without `decideMany` does the same.

### BA-03

- tag: core
- cases: BA-03/split-questions, LM-01/question-cap

A group's questions are split so each call stays within the effective question limit. Calls stay in first-seen order.

### BA-04

- tag: core
- cases: BA-04/decide-many, BA-04/one-state-uses-decide

When the backend is `multiState` and implements `decideMany`, distinct states in one group go to one `decideMany` call. Item ids are `q0`, `q1`, … across that payload. A single distinct state still uses `decide`, even if `decideMany` exists.

### BA-05

- tag: core
- cases: BA-05/state-cap, BA-05/question-cap-across-states, BA-05/backend-state-cap, BA-05/one-disables, BA-05/flag-without-decide-many

`maxStatesPerBatch` caps distinct states in one `decideMany` call. A leftover single state uses `decide`. `maxBatchSize` still caps questions inside a cross-state group. `maxStatesPerBatch` of `1` disables cross-state packing. See also `LM-02`.

### BA-06

- tag: core
- cases: BA-06/repeated-state

A repeated state counts once toward the state limit. Its questions stay on that state's call, in enqueue order.

### BA-07

- tag: deferred
- cases: BA-07/image-budget

While packing, images count once per distinct state. A chunk closes before it would pass `maxImages`. A state already over the limit is rejected before packing (`IMG-01`) and is not sent.

## LIMITS

### LM-01

- tag: core
- cases: LM-01/question-cap, LM-01/at-least-one

The question limit is `max(1, min(maxBatchSize, limits.maxQuestionsPerCall))`. A missing `maxQuestionsPerCall` does not cap below `maxBatchSize`.

### LM-02

- tag: core
- cases: BA-05/backend-state-cap, CFG-01/default-state-batch

The state limit is `1` unless the backend is `multiState` and implements `decideMany`. Otherwise it is `max(1, min(maxStatesPerBatch, limits.maxStatesPerCall))`. A missing `maxStatesPerCall` does not cap below `maxStatesPerBatch`.

## ERR

### ER-01

- tag: core
- cases: ER-01/backend-failed

A `decide` that throws fails every question in that call with `BACKEND_FAILED`. An `AskError` thrown by the backend is preserved; any other throwable is wrapped.

### ER-02

- tag: core
- cases: ER-02/one-question, ER-02/decide-many-item

A per-question `{ error }` or a `decideMany` item failure fails that question only. An `AskError` cause keeps its code. Any other cause is `BAD_RESPONSE`. Siblings in the same call still resolve.

### ER-03

- tag: core
- cases: ER-03/wrong-kind, ER-03/missing-answer

A missing payload entry or an answer whose kind is not the question's kind is `BAD_RESPONSE` for that question only.

### ER-04

- tag: core
- cases: ER-04/decide-many-throws

A `decideMany` that throws fails every item in that call with `BACKEND_FAILED`.

### ER-05

- tag: core
- cases: ER-05/elseif-after-start, ER-05/level-after-start

A chain method called after that chain has started (`run` / `handle`, or the TypeScript microtask that started it) is `CHAIN_STARTED`.

## CFG

### CFG-01

- tag: core
- cases: IF-02/threshold-edge, IF-03/band-inside, SW-05/confidence-equals-min, CFG-01/default-question-batch, CFG-01/default-state-batch

The defaults listed at the top of this file hold when the caller does not override them. In particular, 33 questions about one state take two calls (`32 + 1`), and 17 distinct states on a multi-state backend take a 16-item `decideMany` plus one `decide`.

### CFG-02

- tag: core
- cases: CFG-02/configure

`configure` changes the defaults used by later groups. It does not rewrite a group that already completed.

### CFG-03

- tag: core
- cases: CFG-03/override

A per-call backend is the only backend that call hits. The instance backend records no call for it.

## IMG

### IMG-01

- tag: deferred
- cases: IMG-01/text-only, IMG-01/too-many

A state that contains more images than `limits.maxImages` is `UNSUPPORTED_INPUT` and is not sent. Absent `maxImages` means the backend accepts no images.

### IMG-02

- tag: deferred
- cases: IMG-02/sniff, IMG-02/reject

`image` accepts raw bytes, standard base64, base64url, or a `data:image/...;base64,` URL. PNG, JPEG, GIF, and WebP are sniffed when no media type is given. Stored data is standard base64 with padding. An explicit media type is kept, lowercased. Unrecognised bytes, a non-image media type, or invalid base64 is `UNSUPPORTED_INPUT`.

### IMG-03

- tag: deferred
- cases: IMG-03/extract, IMG-03/from

`extractImages` replaces each image, data-URL string, and `{ content_type, base64 }` image object with `[image N]`, numbering from `1` or from `from`, in walk order. A state with no images is unchanged.

## PR

Prompt-injection protection shipped in the TypeScript core (`guard.ts`). JVM 0.1 does not implement it: these criteria are `deferred`. A clean state is unchanged, so the `core` cases stay valid with protection left on.

### PR-01

- tag: deferred
- cases: PR-01/strip-state, PR-01/truncate

State strings lose hidden and control characters (a ZWJ between emoji stays), then HTML comments, then each string is capped at `maxStringChars`. The cut does not leave a lone surrogate, and the suffix is `…[truncated N chars]`.

### PR-02

- tag: deferred
- cases: PR-02/state-cap

After cleaning, a state whose JSON text is longer than `maxStateChars` is `UNSUPPORTED_INPUT` and is not sent.

### PR-03

- tag: deferred
- cases: PR-03/unsure-before-threshold, PR-03/flags-without-unsure, PR-03/clean-omits-flags, PR-03/routing-off, PR-03/switch-unsure, PR-03/switch-flags, PR-03/score-unsure, PR-03/score-flags

A state that matches an injection marker sets `flags` to `["suspected_injection"]` on the branch result. With `unsureOnInjection` (the default) and an unsure handler, that route wins before the threshold or the confidence check, including when the probability or confidence is 1. Without an unsure handler the threshold or the ranking still decides, and `flags` is still set. `unsureOnInjection: false` keeps the threshold or the ranking and still sets `flags`. A clean state leaves `flags` null.

### PR-04

- tag: deferred
- cases: PR-04/off-keeps-state, PR-04/configure-restores, PR-04/per-call-not-packed, PR-04/cleaned-states-share

`protection: false` sends the state unchanged and records `context.protection: false` (images mode stays `"auto"`). A later partial `configure` merges over the defaults and turns protection back on. A per-call `protection: false` is not packed with a protected call. Two states that are equal after cleaning share one `decide`, and the backend sees the cleaned state.

### PR-05

- tag: deferred
- cases: PR-05/choice-description, PR-05/level-description, PR-05/criteria-comments

Developer text (choice descriptions, level descriptions, yes/no criteria) loses hidden characters and keeps HTML comments. Option keys are not cleaned.

### PR-06

- tag: deferred
- cases: PR-06/explicit-images, PR-06/data-url-rejected

`images: "explicit"` does not treat a data-URL string as an image, so a text-only backend accepts it. The default `"auto"` counts that string as an image and rejects it with `UNSUPPORTED_INPUT`.
