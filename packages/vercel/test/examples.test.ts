// examples/basic.ts is excluded: it calls the live AI Gateway and needs a key.
import { test } from "node:test";

test("examples/backends.ts", async () => {
  await import("../examples/backends.js");
});
