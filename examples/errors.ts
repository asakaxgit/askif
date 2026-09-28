// Errors are standard Error objects with a `code`. Runs offline, no API key
// needed. Also runs as an integration test — see test/examples.test.ts.
//
// Run with: npx tsx examples/errors.ts
import assert from "node:assert/strict";
import { createAsk, isAskError, mock } from "../src/index.js";

const backend = mock(() => {
  throw new Error("network timeout");
});
const ask = createAsk({ backend });

let caught: unknown;
try {
  await ask.is("cat", "is animal");
} catch (error) {
  if (isAskError(error) && error.code === "BACKEND_FAILED") console.error(error.cause);
  caught = error;
}

assert.ok(isAskError(caught) && caught.code === "BACKEND_FAILED");
