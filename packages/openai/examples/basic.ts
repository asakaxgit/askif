// Run with: OPENAI_API_KEY=... pnpm --filter @askif/openai run example
import { ask } from "../src/index.js";

// Yes/no
await ask.if("cat", "is animal", () => {
  console.log("cat is animal");
});

await ask
  .if("toaster", "is animal", () => console.log("toaster is animal"))
  .else(() => console.log("toaster is not animal"));

if (await ask.is("penguin", "can fly")) console.log("penguin can fly");
else console.log("penguin can't fly");

// One of several options
const ticket = "Shoes arrived in the wrong size. Also I was charged twice.";
const team = await ask
  .switch(ticket, "Which team should handle this?")
  .case("returns", "Exchanges, wrong or damaged items", () => console.log("→ returns"))
  .case("shipping", "Delivery status, delays, lost packages", () => console.log("→ shipping"))
  .case("billing", "Charges, invoices, payment problems", () => console.log("→ billing"))
  .unsure(() => console.log("→ manual triage"));
console.log(team.ranking);

// A position on a scale
const bug = "The export button crashes the settings page in Safari. It works in Chrome.";
await ask
  .score(bug, "How severe is the reported issue?")
  .level("Cosmetic; no impact to functionality", () => console.log("backlog"))
  .level("Broken or degraded feature, but workaround exists", () => console.log("this sprint"))
  .level("Blocking issue; no workaround exists", () => console.log("page on-call"))
  .unsure(() => console.log("needs a human look"));
