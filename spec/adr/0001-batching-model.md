# ADR 0001: Batching model

- Status: accepted for 0.1
- Spec: 0.1

## Context

TypeScript joins sibling calls by starting a chain on the next microtask and flushing two microtasks later. The JVM has no microtask queue. A timer window would be nondeterministic and untestable.

Three options were compared:

1. An explicit `Batch` scope. Kotlin submits when the lambda returns. Java calls `Batch.submit()`.
2. A fixed collection window on a scheduler, as an implicit default.
3. No batching except a single multi-question call the user builds by hand.

## Decision

Option 1. A call outside a batch is a batch of one and submits when it is run. Calls that share a conformance group share one batch. There is no implicit time window.

Option 2 is rejected as a default. It can be revisited as an opt-in later; it is not in 0.1.

The scope is not tied to one state. A batch may contain several states. Packing rules (same backend, same state, question limit, state limit) are the spec's, not the scope's. One state still uses `decide`. Several states use `decideMany` only when the backend opts in.

`ask.batch(state) { askIf(condition) }` remains available so the common one-state case does not repeat the state.

## Consequences

- Conformance groups map directly onto a batch. The matrix does not encode the microtask window.
- Users who never open a batch pay one `decide` per call. The README has to show a batch that is shorter than the unbatched form, or the cost saving will go unused.
- Cancelling one handle does not cancel the `decide` its batch-mates are waiting on (ADR 0002).
