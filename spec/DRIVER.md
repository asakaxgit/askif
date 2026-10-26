# Conformance driver protocol

Spec version: see [`VERSION`](VERSION) (`0.1`).

A driver is a small CLI in front of one language's real implementation. The runner in [`runner/`](runner/) owns comparison and the criteria matrix. Drivers do not import the runner, and the runner does not import any language's library.

## Invocation

The runner starts one process per case, writes the case JSON to stdin, and reads one JSON object from stdout. Diagnostics go to stderr. The process exits `0` when it produced a result object, including when the implementation under test threw (those failures are data). It exits non-zero only when the driver itself cannot run the case (invalid case, a script step was missing, an unknown op).

```text
node --import tsx conformance/typescript/driver.ts   # reference driver
kotlin/conformance/build/install/conformance/bin/conformance
```

The TypeScript driver lives in `conformance/typescript/` until Phase 0a moves `packages/` to `typescript/`. It will move with that PR to `typescript/conformance/`. It imports the `askif` sources in place and does not publish a package.

`spec/drivers.json` maps a language id to the argv the runner spawns, with the repository root as the working directory.

## What the driver runs

The case shape is [`schema/case.schema.json`](schema/case.schema.json).

- `config` is the initial `Ask` configuration. Omitted fields stay at the defaults (threshold `0.5`, unsure band `[0.2, 0.8]`, minConfidence `0.5`, maxBatchSize `32`, maxStatesPerBatch `16`). `protection` is `false` or a partial override. Omitted means the implementation default. JVM 0.1 leaves protection unimplemented; those cases are tagged `deferred` and the runner does not send them to Kotlin.
- `backend` configures the scripted backend (`multiState`, `hasDecideMany`, `limits`). A second scripted backend exists only when `script.override` is set. A call with `"backend": "override"` uses it.
- `script.decide` / `script.decideMany` are consumed in order, one step per call. `"throw": true` fails the whole call. `answers` is either a positional array or `{ "each": <answer> }` repeated for every question in that call. `byKind` answers by question content instead of position (`yesno` keyed by condition, `choice` / `scale` keyed by the instruction string), for a group whose questions are not in the same order on every language. An answer with `"error"` is a per-question `AskError` of that code. An answer with `"throw": true` fails that question with a non-`AskError` cause (the implementation reports `BAD_RESPONSE`).
- `calls` run by ascending `group`. A group is one batch scope: the TypeScript driver invokes the group in one turn (the microtask window); the Kotlin driver opens one explicit `Batch` and submits it when the group ends. Groups themselves are sequential. `configure` applies at its position inside the group and does not produce a result row. `count` expands one call into that many calls in the same group; `statePrefix` / `conditionPrefix` append the index.

Yes/no questions are sent as instructions `{ "condition": <text>, "question": "Is `condition` true of the state?" }`. Switch descriptions default to JSON `null`. `other` defaults to `"None of the other options fit"`. A score level whose description is omitted is sent as its key. Question ids inside one `decide` or `decideMany` payload are `q0`, `q1`, … in payload order.

## Result object

```json
{
  "id": "IF-03/band-edge-low",
  "results": [{ "branch": "unsure", "probability": 0.2 }],
  "handlersRun": [["unsure"]],
  "errors": [null],
  "backendCalls": 1,
  "decide": [{ "state": "x", "questionCount": 1, "questions": [] }],
  "decideMany": [],
  "overrideDecide": [],
  "overrideDecideMany": []
}
```

`results`, `handlersRun`, and `errors` align with the calls that are not `configure`, after `count` expansion. `errors[i]` is an `AskError` code or `null`. A thrown code becomes `{ "error": "<CODE>" }` in `results`. `afterStartError` records a code thrown by `afterStart` after a successful call. `backendCalls` is `decide.length + decideMany.length` for the default backend (override calls are separate).

Branch results (`if`, `switch`, `score`) include `flags`: `["suspected_injection"]` or `null`. `is` / `probability` results are only `{ "value": ... }`. Each recorded `decide` and `decideMany` includes `context` (`protection`, `images`) when the implementation passed one, or `null` when it did not. JVM 0.1 records `null` and does not set injection flags; the runner does not ask it to.

Handler names: `then`, `elseif`, `else`, `unsure`, `case` (winning option handler), `other`, `level`. Only handlers the case lists are attached.

Numbers in `expect` compare within the case `epsilon`, default `1e-6`. Every other JSON value compares by subset: keys present in `expect` must match, and extra keys on the actual value are ignored. JSON `null` matches only `null`. Drivers always emit `criteria` on a yes/no question (`null` when the call set none) and always emit `description` on an option. The runner does this diff.

## Language tags

`tags` include `core` (every driver) or `ts-only` / `deferred` (TypeScript only until a later slice implements them). The matrix cell for a language that does not run a criterion is `skipped`, not a failure. A `core` criterion with a failing case is a failure. CI fails on any red cell and on a criterion that has no case.

## Out of this protocol

End-to-end provider scripts (`spec/e2e/`) are Phase 3.5. Canonical sorted-key batch identity is [0g](TODO.md) and is not part of the 0.1 driver contract. Cases use string states, or one JSON value repeated by reference in the case file, so key order cannot diverge.
