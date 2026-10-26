# ADR 0004: JSON and state

- Status: accepted for 0.1
- Spec: 0.1

## Context

A state is any JSON value. The core has to compare states for batching and hand them to backends without taking a reflection-based mapper.

Jackson in core would be familiar to Java services and would accept POJOs. It is a large dependency and it pulls reflection into the decision kernel.

## Decision

- Core depends on `kotlinx-serialization-json` only. No Jackson, no reflection.
- `State` on the public API is `JsonElement`. Helpers on `States` build one from a string, a number, a boolean, a map, a list, or a JSON document. Java calls `States.of("cat")` or `States.parse(...)`.
- `Question` and `Answer` are sealed Kotlin types, not JSON trees. A backend sees those types. Adapters, when they exist, encode them.
- Yes/no criteria keep the wire keys `true` and `false` inside conformance recordings. The Java property names are `yes` and `no` because `true` and `false` are not identifiers.
- An `askif-jackson` module that accepts POJOs and `JsonNode` is deferred with the publishing work. It is not a 0.1 artifact.
- Batch identity uses kotlinx's default encoding of the `JsonElement` (insertion order, no extra whitespace). Canonical sorted keys are `spec/TODO.md` item 0g, not this decision.

## Consequences

- Java callers who already have a POJO write a few lines to build a `JsonElement`, or pass a string. That is the 0.1 tax.
- The decision kernel's confidence, ranking, score, and pack functions do not import `java.*`. JSON encoding sits at the edge of the batch map, not in the math.
