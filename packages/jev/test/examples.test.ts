// Runs the offline example as an integration test, so it can't drift from
// actual behavior. examples/basic.ts is excluded: it talks to the live
// TypeSafe API and needs a real API key.
import { test } from "node:test";

test("examples/backends.ts", async () => {
  await import("../examples/backends.js");
});
