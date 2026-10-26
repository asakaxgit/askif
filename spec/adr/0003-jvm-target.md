# ADR 0003: JVM bytecode and JDK toolchain

- Status: accepted for 0.1
- Spec: 0.1

## Context

Sealed interfaces are usable from Java 17 onward. Java 11 would force a worse model (abstract classes plus a manually closed set) and a lower Kotlin API surface. The issue recommends bytecode 17 and a JDK 21 toolchain.

## Decision

- Compile with a JDK 21 toolchain.
- Emit JVM bytecode 17 (`-jvm-target 17`, Java `release` 17).
- Kotlin language version and API version are pinned to 2.0, compiled by the Kotlin 2.2 compiler. The stdlib dependency is the 2.2 stdlib the compiler ships with; source does not use newer-than-2.0 language features.
- `java-interop-tests` is compiled as Java and executed on a JDK 17 toolchain, so the minimum runtime is actually tested.
- JDK 11 is not a 0.1 target.

## Consequences

- Android and other pre-17 runtimes are out of scope, matching the epic.
- Raising the language version later is a deliberate bump, not an accidental one.
- The owner can still ask for 11. It would be a new ADR, not a flag flip: sealed `Question` / `Answer` and the Java `instanceof` tests would have to change.

## Open

JDK 11 remains an open product question only in the sense that the owner has not signed the recommendation in the issue tracker. This ADR records the 0.1 choice as 17.
