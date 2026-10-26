# askif for the JVM

Kotlin core for spec 0.1. It implements `askIf` / `askIs` / `askSwitch` / `score` / `probability`, explicit `Batch`, and `MockBackend`. OpenAI and Jev backends are not in this slice, and nothing here is published.

```sh
./gradlew test
./gradlew :conformance:installDist
node --import tsx ../spec/runner/src/run.ts --lang=kotlin
```

Compile with JDK 21. Bytecode is 17. `java-interop-tests` compiles and runs on JDK 17. Kotlin language and API versions are 2.0, compiled by Kotlin 2.2.

The Maven group `io.github.asakaxgit` is a placeholder in the build file only. There is no `maven-publish` plugin. Replace the group before any repository upload. See [`spec/adr/0005-build-and-naming.md`](../spec/adr/0005-build-and-naming.md).

## Java

`State` is `kotlinx.serialization.json.JsonElement`. `Ask.create` takes a `Backend`. Java code extends `JavaBackend` and implements `decideAsync`.

Blocking methods are `askIs`, `probability`, and `run`. `*Async` returns `CompletableFuture`. `suspend` functions are hidden from Java. Blocking calls hop to threads named `askif-blocking`; calling a blocking method from one of those threads throws `IllegalStateException`.

A switch arm is `option`, because `case` is not a Java method name. The else branch is `orElse`. Open a batch with `openBatch`, queue `*Handle` calls, then `submit`. Cancelling one `Handle` does not cancel the batch's `decide`.

## Not in 0.1

Images, `maxImages` packing, implicit microtask batching, async handlers, and prompt-injection protection stay on TypeScript. The error codes `UNSUPPORTED_INPUT` and `BACKEND_UNAVAILABLE` exist and are not thrown. Batch keys are the kotlinx JSON encoding of the raw state, not the canonical key tracked in [`spec/TODO.md`](../spec/TODO.md).
