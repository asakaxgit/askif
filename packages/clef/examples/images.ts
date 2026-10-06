// Asks Clef the questions in the manifests under test/fixtures/ about each image there,
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

const run = async (dir: URL, manifest: Entry[]): Promise<void> => {
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
};

// The generated shapes, then the real public-domain pictures (see SOURCES.md there).
for (const name of ["images", "public-domain"]) {
  const dir = new URL(`../test/fixtures/${name}/`, import.meta.url);
  await run(dir, JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8")));
}
