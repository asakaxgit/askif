// Asks Clef the questions in test/fixtures/images/manifest.json about each generated image,
// and prints whether the answers match what was expected. Talks to the live Cloudflare API.
//
// Run with: CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... pnpm --filter @askif/clef run example:images
import { readFileSync } from "node:fs";
import { ask } from "../src/index.js";

type Entry = {
  file: string;
  contentType: string;
  questions: { kind: "yesno" | "choice"; question: string; options?: string[]; expected: boolean | string }[];
};

const dir = new URL("../test/fixtures/images/", import.meta.url);
const manifest: Entry[] = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));

for (const { file, contentType, questions } of manifest) {
  const photo = `data:${contentType};base64,${readFileSync(new URL(file, dir)).toString("base64")}`;
  for (const q of questions) {
    let got: boolean | string;
    if (q.kind === "yesno") {
      got = await ask.is({ photo }, q.question);
    } else {
      const chain = ask.switch({ photo }, q.question);
      for (const option of q.options ?? []) chain.case(option);
      got = (await chain).choice;
    }
    console.log(got === q.expected ? "ok  " : "FAIL", file, "-", q.question, "->", got, `(expected ${q.expected})`);
  }
}
