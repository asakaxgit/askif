# Spec follow-ups

Not part of the 0.1 JVM slice.

## 0g — canonical batch key

TypeScript keys a batch entry with `JSON.stringify([reducedState, context])` after protection runs. Kotlin 0.1 keys `Json.encodeToString` of the raw `JsonElement` and does not include a protection context (see the protection bullet below). Object key order is insertion order, not a sorted canonical form, and the two encoders are not promised to be byte-identical.

0.1 cases avoid the gap: states are strings, or a single JSON value that is only compared structurally inside one case. Do not add a case whose result depends on object key order until both languages hash a shared canonical JSON (sorted keys, defined number formatting) and the TypeScript batch map uses it too. That change belongs in `packages/askif` and is intentionally not in this slice.

## Deferred on the JVM (cases are `ts-only` / `deferred`)

- Input protection (`PR-01`…`PR-06`, TypeScript `guard.ts`): hidden-character and HTML-comment cleaning, string and state caps, injection markers, `flags: ["suspected_injection"]`, `unsureOnInjection`, `protection: false` and partial overrides, and `images: "explicit"`. The TypeScript batch key is `JSON.stringify([reducedState, context])`, so a protected call and a `protection: false` call do not share a request. JVM 0.1 keys the raw `JsonElement` only and its `decide` / `decideMany` take no `DecisionContext`. Adding that parameter is part of the protection slice, not 0.1.
- `UNSUPPORTED_INPUT` for an oversized state is the same code as the image rejection. The enum value exists on the JVM; nothing in 0.1 throws it.

- Image pipeline: `image()`, media-type sniffing, base64 / base64url / data URLs, `extractImages`, and `UNSUPPORTED_INPUT` when a state has more images than `limits.maxImages` (absent means none). The `UNSUPPORTED_INPUT` code exists on the JVM enum so the later slice does not add a code. Nothing in 0.1 rejects an image state.
- `maxImages` packing across states. The packer still has the budget parameter; with image counts of zero it does not split. `images: "explicit"` (PR-06) is part of the same deferred slice.
- Implicit microtask batching and "an un-awaited chain runs by itself". The JVM starts work only at `run()` / `Batch.submit()`. Not a conformance criterion; the TypeScript unit tests cover it.
- Async handlers (a handler that returns a promise). JVM handlers are synchronous. "The winning handler runs before the result is observable" is the core criterion (`IF-13`).

## Not in 0.1 at all

- Phase 0a (`packages/` → `typescript/`). The TypeScript driver stays in `conformance/typescript/` until that PR.
- Code generation of wire types from `spec/` (see ADR 0006). Hand-written kernel until a wire schema exists.
- Enum-typed choices (ADR 0007).
- Provider adapters, fake-provider e2e, Maven Central (Phase 3–4).
- `BACKEND_UNAVAILABLE` is a reserved code for adapters. No 0.1 criterion throws it.
