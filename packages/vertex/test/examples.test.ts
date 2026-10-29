import { test } from "node:test";
import type { TestContext } from "node:test";

const quiet = (t: TestContext): void => {
  t.mock.method(console, "log", () => undefined);
  t.mock.method(console, "error", () => undefined);
};

test("examples/backends.ts", async (t) => {
  quiet(t);
  await import("../examples/backends.js");
});
