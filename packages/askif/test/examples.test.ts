// Runs the offline examples as integration tests, so the README's examples
// can't silently drift from actual behavior. The live Jev quickstart lives in
// @askif/jev's own examples/basic.ts, which needs a real API key.
import { test } from "node:test";
import type { TestContext } from "node:test";

// The examples print what they do (that is their point), but under `node --test` that
// output shares stdout with the runner's own serialized messages, and when a write lands
// in the middle of one the runner fails the whole file with "Unable to deserialize cloned
// data" (seen in ~15% of runs with piped output under load). So the output is silenced
// here only; running an example directly still prints it.
const quiet = (t: TestContext): void => {
  t.mock.method(console, "log", () => undefined);
  t.mock.method(console, "error", () => undefined);
};

test("examples/if.ts", async (t) => {
  quiet(t);
  await import("../examples/if.js");
});

test("examples/switch.ts", async (t) => {
  quiet(t);
  await import("../examples/switch.js");
});

test("examples/score.ts", async (t) => {
  quiet(t);
  await import("../examples/score.js");
});

test("examples/batching.ts", async (t) => {
  quiet(t);
  await import("../examples/batching.js");
});

test("examples/configuration.ts", async (t) => {
  quiet(t);
  await import("../examples/configuration.js");
});

test("examples/backends.ts", async (t) => {
  quiet(t);
  await import("../examples/backends.js");
});

test("examples/errors.ts", async (t) => {
  quiet(t);
  await import("../examples/errors.js");
});
