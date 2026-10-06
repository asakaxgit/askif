// Building instances against different Clef configurations. Runs offline, no
// credentials needed: constructing a `clef()` backend never touches the
// network or reads credentials — only calling it does, and this file never
// calls one. Also runs as an integration test (test/examples.test.ts).
//
// Run with: npx tsx examples/backends.ts
import assert from "node:assert/strict";
import { createAsk } from "askif";
import { clef } from "../src/index.js";

// The default `ask` uses "clef" with CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN.
// Make your own instance for the cheaper model or explicit credentials.
const flash = createAsk({ backend: clef({ model: "clef-flash" }) });
const explicit = createAsk({
  backend: clef({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, apiToken: process.env.CLOUDFLARE_API_TOKEN }),
});

// Inside a Cloudflare Worker, use the AI binding instead of the REST API:
//   export default { fetch: (req, env) => createAsk({ backend: clef({ binding: env.AI }) }).is(...) }
const viaBinding = createAsk({ backend: clef({ binding: { run: async () => ({}) } }) });

assert.equal(typeof flash.if, "function");
assert.equal(typeof explicit.if, "function");
assert.equal(typeof viaBinding.if, "function");
