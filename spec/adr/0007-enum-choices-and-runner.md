# ADR 0007: Enum-typed choices, the runner, and spec versioning

- Status: accepted for 0.1
- Spec: 0.1

## Context

Three open questions in the epic are small enough to close for this slice without extra artifacts.

## Decision

- Enum-typed choices (`askSwitch(state, question, Team::class)`) are not in 0.1. Choices are `String`. Adding an enum overload changes `SwitchResult.choice` and the Java overloads; it can land later without breaking the string API if the string methods stay. The conformance result records a string either way.
- The runner is TypeScript, executed with `tsx`, which is already a root devDependency. A neutral runner would be a third toolchain for no behavioural gain. Ajv, used only by the runner, lives in `spec/runner/` with its own `package-lock.json` so the pnpm root stays untouched.
- `spec/VERSION` is `0.1`. Language packages do not yet declare the spec version they implement. That declaration belongs with the first published JVM artifact, when there is a place to write it. The directory is not renamed to `spec/0.1/`; one current spec is enough until a second version exists.

## Open — needs the owner

- Enum-typed choices in a later minor: yes or no. 0.1 proceeds without them.
- Whether `spec/VERSION` should become a field in each published manifest. Deferred with publishing, not forgotten.
