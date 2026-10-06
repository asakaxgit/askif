// Runs the offline example as an integration test, so it can't drift from
// actual behavior. examples/basic.ts is excluded: it talks to the live
// Cloudflare Workers AI API and needs Cloudflare credentials.
import { test } from "node:test";

test("examples/backends.ts", async () => {
  await import("../examples/backends.js");
});
