# ADR 0006: Shared source

- Status: accepted for 0.1
- Spec: 0.1

## Context

Every new language re-implements the decision kernel unless something is shared. The epic lists four options:

1. Transpile TypeScript to the JVM.
2. Kotlin Multiplatform, and rewrite the published TypeScript on top of it.
3. A Rust or WASM core with thin bindings.
4. Hand-written ports, plus generation of the data that is really data, pinned by the conformance suite.

## Decision

Option 4, with the JVM port in Kotlin.

- Option 1 has no maintained toolchain that keeps the chain's types or replaces the microtask batch window. Rejected.
- Option 2 stays possible later because the kernel (confidence, ranking, score, pack) is plain Kotlin with no `java.*`. It is not the 0.1 plan: it would replace the published TypeScript reference and drop the narrowed choice keys.
- Option 3 adds a native or WASM artifact to a library whose value is a small dependency set. Rejected for 0.1.
- Code generation from `spec/` is deferred, not rejected. The case schema describes tests, not the wire. Generating `Question` / `Answer` / error codes from it now would churn both languages before a wire schema exists. 0.1 types are hand-written and the conformance matrix is the pin. A generator comes back when adapters need a shared prompt and JSON schema (Phase 3), at which point CI should fail on a stale checkout.

## Consequences

- Two hand-written kernels. The matrix is what stops them drifting.
- Multiplatform is not set up. The kernel files are simply kept free of `java.*` so a later move is a package move, not a rewrite.
