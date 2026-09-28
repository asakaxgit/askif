#!/usr/bin/env node
// Writes a changeset file non-interactively, for the "Bump version" workflow
// (.github/workflows/version-bump.yml) — `pnpm changeset` itself is
// interactive (prompts for packages/bump/summary), which doesn't work from a
// workflow_dispatch input.
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const [packages, bump, ...summaryParts] = process.argv.slice(2);
const summary = summaryParts.join(" ").trim();

const VALID_BUMPS = ["patch", "minor", "major"];
if (!VALID_BUMPS.includes(bump)) {
  console.error(`error: bump must be one of ${VALID_BUMPS.join(", ")}, got ${JSON.stringify(bump)}`);
  process.exit(1);
}
if (!summary) {
  console.error("error: a summary is required");
  process.exit(1);
}

const selected = packages === "both" ? ["askif", "@askif/jev"] : [packages];
if (selected.some((pkg) => pkg !== "askif" && pkg !== "@askif/jev")) {
  console.error(`error: packages must be "askif", "@askif/jev", or "both", got ${JSON.stringify(packages)}`);
  process.exit(1);
}

const frontmatter = selected.map((pkg) => `"${pkg}": ${bump}`).join("\n");
const slug = `version-bump-${randomBytes(4).toString("hex")}`;

mkdirSync(new URL("../../.changeset/", import.meta.url), { recursive: true });
const path = new URL(`../../.changeset/${slug}.md`, import.meta.url);
writeFileSync(path, `---\n${frontmatter}\n---\n\n${summary}\n`);
console.log(`wrote .changeset/${slug}.md (${bump}, ${selected.join(", ")})`);
