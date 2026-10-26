# ADR 0002: Concurrency surface

- Status: accepted for 0.1
- Spec: 0.1

## Context

Kotlin callers want `suspend`. Java callers need ordinary methods and `CompletableFuture`. A `suspend` function on the JVM is a method with a `Continuation` parameter, which is not a Java API.

Handlers in TypeScript may return a promise and the chain awaits it. Java lambdas cannot be suspend functions.

## Decision

The implementation core is coroutines.

- Kotlin-facing methods are `suspend` and marked so they do not appear in the Java bytecode view (`@JvmSynthetic`).
- The same operations are exposed to Java as blocking methods (`askIs`, `probability`, `run`, `submit`) and as `*Async` methods that return `CompletableFuture`.
- Blocking methods hop to a dedicated dispatcher whose threads are named `askif-blocking`. Calling a blocking method from one of those threads throws `IllegalStateException` instead of deadlocking. Handlers run on that thread when the chain was started with a blocking `run`, so a handler must not call a blocking askif method.
- Java implements a backend by extending `JavaBackend` and returning `CompletableFuture` from `decideAsync`. Kotlin implements the `Backend` interface directly.
- Handlers are `fun interface`s and are synchronous in 0.1. Async handlers are deferred (see `spec/TODO.md`).
- `kotlinx-coroutines-core` provides `CompletableFuture` interop (`future` / `await`). The retired `kotlinx-coroutines-jdk8` artifact is not a dependency.
- Cancelling one `Handle` completes that handle with cancellation and leaves the batch's `decide` / `decideMany` call and the other handles running. A failed question does not cancel its siblings. The batch scope is a supervisor, not a scope that cancels children on the first failure.
- `configure` updates an `AtomicReference`. Concurrent `configure` and in-flight batches do not tear the config object; a batch reads the reference when it submits and when it judges.

## Consequences

- Java pulls in `kotlin-stdlib` and `kotlinx-coroutines-core`. Documented in `kotlin/README.md`. Accepted.
- The public Java surface has no `Continuation`, no `Pair`, no Kotlin `Result`, and no top-level `*Kt` functions.
- Explicit API mode plus the binary-compatibility validator keep that surface a reviewed dump in `kotlin/askif/api/`.
