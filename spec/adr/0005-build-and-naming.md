# ADR 0005: Build, artifacts, and names

- Status: accepted for 0.1
- Spec: 0.1

## Context

The JVM port needs a build that Java and Kotlin both consume, a package root, and a Maven `groupId`. Central Portal will not accept a bare `askif` group. The owner is registering a reverse-domain; the value is not decided. Nothing in this slice is published.

## Decision

- Gradle, Kotlin DSL, version catalog at `kotlin/gradle/libs.versions.toml`. Multi-project: `:askif`, `:conformance`, `:java-interop-tests`.
- No Maven build, and no `maven-publish` plugin in this slice. No GPG, no Sonatype, no GitHub release workflow for Kotlin.
- Artifact id of the core is `askif`. Later adapters, not created here, would be `askif-openai` and `askif-jev`. Kotlin package root is `askif`.
- Coordinates use the placeholder group `io.github.asakaxgit`. It is written only in the Gradle build, with a comment that it is not a registered coordinate and must be replaced before any publish. Version is `0.1.0-SNAPSHOT`.
- JVM entry points: `askIf`, `askIs`, `askSwitch`, `score`, `probability`. `case` is a Java keyword, so the switch builder method is `option`, matching the issue's Java sketch. `orElse` replaces `else`. `elseIf` is the `elseif` chain.
- `confidenceOf` lives on `Decision`, not as a top-level function, so Java does not see a `*Kt` class.
- Explicit API mode is on for `:askif`. The binary-compatibility dump is checked in CI (`apiCheck`). Dokka HTML is generated in CI and is not published.

## Consequences

- A search for the placeholder group finds the build file and this ADR, not a Central package.
- The first publishing PR has to replace the group, add signing, and only then is the placeholder allowed to disappear.

## Open — needs the owner

- The real `groupId` once the domain is registered.
- Whether Central namespace verification has been started. This slice does not start it; it cannot, without the domain.
