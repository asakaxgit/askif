#!/usr/bin/env -S npx tsx
// Writes a changeset file non-interactively, for the "Bump version" workflow
// (.github/workflows/version-bump.yml) — `pnpm changeset` itself is
// interactive (prompts for packages/bump/summary), which doesn't work from a
// workflow_dispatch input.
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BUMPS = ["patch", "minor", "major"] as const;
type Bump = (typeof BUMPS)[number];
const isBump = (value: string): value is Bump => BUMPS.some((bump) => bump === value);

const PACKAGES = ["askif", "@askif/jev"] as const;
type PackageName = (typeof PACKAGES)[number];

const [packagesArg, bumpArg, ...summaryParts] = process.argv.slice(2);
const summary = summaryParts.join(" ").trim();

if (bumpArg === undefined || !isBump(bumpArg)) {
  console.error(`error: bump must be one of ${BUMPS.join(", ")}, got ${JSON.stringify(bumpArg)}`);
  process.exit(1);
}
if (!summary) {
  console.error("error: a summary is required");
  process.exit(1);
}

const selected: readonly PackageName[] =
  packagesArg === "both" ? PACKAGES : PACKAGES.filter((pkg) => pkg === packagesArg);
if (selected.length === 0) {
  console.error(`error: packages must be ${PACKAGES.join(", ")}, or "both", got ${JSON.stringify(packagesArg)}`);
  process.exit(1);
}

const frontmatter = selected.map((pkg) => `"${pkg}": ${bumpArg}`).join("\n");
const slug = `version-bump-${randomBytes(4).toString("hex")}`;

mkdirSync(new URL("../../.changeset/", import.meta.url), { recursive: true });
const path = new URL(`../../.changeset/${slug}.md`, import.meta.url);
writeFileSync(path, `---\n${frontmatter}\n---\n\n${summary}\n`);
console.log(`wrote .changeset/${slug}.md (${bumpArg}, ${selected.join(", ")})`);
