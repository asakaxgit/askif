#!/usr/bin/env -S npx tsx
// Publishes every workspace package whose current version isn't on the
// registry yet, using `npm publish` directly rather than `pnpm publish` —
// pnpm's OIDC trusted-publishing support works by shelling out to npm
// internally, and has a reported, unresolved bug (pnpm/pnpm#9812) where
// that delegation doesn't reliably reach npm's own OIDC path even with a
// new-enough npm present. Calling npm ourselves sidesteps it entirely.
//
// Used as changesets/action's `publish:` command (see release.yml). Emits
// the "git-tag" ndjson events changesets/action reads from
// process.env.CHANGESETS_OUTPUT, so it still creates GitHub releases and
// pushes git tags exactly as `changeset publish` would.
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packagesDir = fileURLToPath(new URL("../../packages/", import.meta.url));
const outputPath = process.env.CHANGESETS_OUTPUT;

type PackageJson = {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
};

const readPackageJson = (dir: string): PackageJson =>
  JSON.parse(readFileSync(`${packagesDir}${dir}/package.json`, "utf8"));

const isPublished = (name: string, version: string): boolean => {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const failed: string[] = [];

for (const dir of packageDirs) {
  const pkg = readPackageJson(dir);
  if (pkg.private) continue;

  if (isPublished(pkg.name, pkg.version)) {
    console.log(`${pkg.name}@${pkg.version} is already published, skipping`);
    continue;
  }

  console.log(`Publishing ${pkg.name}@${pkg.version}...`);
  // Keep going if one package fails (e.g. a brand-new package with no npm
  // Trusted Publisher yet), so the others still publish and get tagged; the
  // job still fails at the end so it isn't missed.
  try {
    execFileSync("npm", ["publish"], { cwd: `${packagesDir}${dir}`, stdio: "inherit" });
  } catch {
    console.error(`Failed to publish ${pkg.name}@${pkg.version}`);
    failed.push(`${pkg.name}@${pkg.version}`);
    continue;
  }

  if (outputPath !== undefined) {
    const event = { type: "git-tag", tag: `${pkg.name}@${pkg.version}`, packageName: pkg.name };
    appendFileSync(outputPath, `${JSON.stringify(event)}\n`);
  }
}

if (failed.length > 0) {
  console.error(`Failed to publish: ${failed.join(", ")}`);
  process.exitCode = 1;
}
