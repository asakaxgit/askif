// Asks Clef one yes/no question about one image file and prints the probability of "yes".
// For trying your own photos, e.g. whether a return-request photo shows a damaged parcel.
// Talks to the live Cloudflare API.
//
// Run with: node --env-file=../../.env.local --import tsx examples/try-image.ts photo.jpg "shows a damaged parcel"
import { readFileSync } from "node:fs";
import { image } from "askif";
import { clef } from "../src/index.js";

const [file, condition] = process.argv.slice(2);
if (file === undefined || condition === undefined) {
  console.error('Usage: try-image.ts <image file> "<condition>"   (e.g. "shows a damaged parcel")');
  process.exit(1);
}

// The same question `ask.is(state, condition)` sends, so the number matches what `ask.if` would branch on.
const answers = await clef().decide(
  { photo: image(readFileSync(file)) },
  {
    q: {
      kind: "yesno",
      instructions: { condition, question: "Is `condition` true of the state?" },
    },
  },
);
const answer = answers["q"];
if (answer?.kind !== "yesno") throw new Error("No yes/no answer came back.");
console.log(`${file}: P("${condition}") = ${answer.probability.toFixed(3)}`);
