// Runs the offline examples as integration tests, so the README's examples
// can't silently drift from actual behavior. The live Jev quickstart lives in
// @askif/jev's own examples/basic.ts, which needs a real API key.
import { test } from "node:test";

test("examples/if.ts", async () => {
  await import("../examples/if.js");
});

test("examples/switch.ts", async () => {
  await import("../examples/switch.js");
});

test("examples/score.ts", async () => {
  await import("../examples/score.js");
});

test("examples/batching.ts", async () => {
  await import("../examples/batching.js");
});

test("examples/configuration.ts", async () => {
  await import("../examples/configuration.js");
});

test("examples/backends.ts", async () => {
  await import("../examples/backends.js");
});

test("examples/errors.ts", async () => {
  await import("../examples/errors.js");
});
