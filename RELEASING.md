# Releasing

Publishing to npm is automated via [Changesets](https://github.com/changesets/changesets) and
GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)), using npm's
OIDC-based **trusted publishing** — no `NPM_TOKEN` secret exists anywhere in this repo or its
CI. This page covers the one-time npm-side setup that makes that possible, then the ongoing
day-to-day flow.

**The actual `npm publish` call is a custom script** ([`.github/scripts/publish.ts`](.github/scripts/publish.ts)), not `changeset publish` directly. `changeset publish` auto-detects this as a pnpm workspace and shells out to `pnpm publish` — but pnpm's OIDC trusted-publishing support works by delegating to npm internally, and has a reported, unresolved bug ([pnpm/pnpm#9812](https://github.com/pnpm/pnpm/issues/9812)) where that delegation doesn't reliably reach npm's own OIDC path even with a new-enough npm present. Calling `npm publish` ourselves, directly, sidesteps it. The script still emits the same `git-tag` events `changesets/action` expects, so GitHub releases and git tags work exactly as they would with the default `changeset publish` path.

`askif`, `@askif/jev`, and `@askif/openai` version **independently** (not lockstep) — a changeset
can bump any subset of them, since `.changeset/config.json` has no `fixed`/`linked` group. This is
a deliberate difference from this author's other pnpm-workspace projects: unlike a tightly-coupled
package family, the backend adapters (`@askif/jev`, `@askif/openai`, and eventually
`@askif/anthropic`) are each independent, with their own release cadence.

## One-time npm bootstrap (human only — needs an npmjs.com login)

I can't do any of this myself; it needs an interactive session on npmjs.com.

1. **The `@askif` organization** already exists (reserved before `@askif/jev` was split out).
   Nothing here needs a paid plan — every scoped package publishes with `access: public` (see
   `publishConfig` in `packages/jev/package.json` and `packages/openai/package.json`; `askif`
   itself is unscoped, which defaults to public).

2. **All three packages have been published once, by hand** (`askif@0.1.0`, `@askif/jev@0.1.0`,
   `@askif/openai@0.1.0`) — so this step, which trusted publishing normally requires before it can
   be configured, is already done. A future new package needs the same one manual, OTP-gated
   `npm publish` (use `npm`, not `pnpm publish`) before step 3 for it.

3. **Configure a Trusted Publisher for each package**, on each package's npmjs.com settings page
   → "Publishing access" → "Trusted Publisher" → GitHub Actions:
   - Organization or user: `asakaxgit`
   - Repository: `askif`
   - Workflow filename: `release.yml`
   - Environment: leave blank (this workflow doesn't use a GitHub Environment)

   Repeat for `askif`, `@askif/jev`, and `@askif/openai`.

Once this is done, `release.yml` can publish every future version with no npm credentials in CI
at all — just the `id-token: write` permission already in the workflow.

**Heads up on timing:** until step 3 is done, any push to `main` with zero pending changesets
will make `release.yml` attempt to publish whatever versions are currently in each
`package.json` — and fail with a plain npm auth error (harmless, not a partial or corrupted
publish, just a red X on that workflow run) since there's no trusted publisher configured yet
and no `NPM_TOKEN` to fall back on.

## Ongoing release flow

There are two ways to create the changeset that starts a release — pick whichever's more
convenient. Either way, what happens next is identical (step 3 onward).

**Option A — locally, as part of a normal PR:**

1. When your change should ship a new version, run:

   ```bash
   pnpm changeset
   ```

   Pick which package(s) changed and the semver bump (patch/minor/major — chosen per package,
   independently), and write a one-line summary — this becomes the changelog entry. Commit the
   generated `.changeset/*.md` file as part of your PR.

2. Merge your PR to `main` as usual.

**Option B — the "Bump version" workflow, with no local checkout:**

1. Go to Actions → **Bump version** → "Run workflow". Pick which package(s) (`askif`,
   `@askif/jev`, `@askif/openai`, or `all`), the bump type, and type a one-line summary.
2. It opens a small PR containing just the generated changeset file (no code changes). Review
   and merge it.

Both options land the same kind of changeset file on `main`, just through a different path
(Option A rides along with a normal code-change PR; Option B is for bumping the version on its
own, with nothing else to review). Neither one bumps `package.json` or publishes anything by
itself — that's step 3 onward, below, and it's the same regardless of which option you used.

3. `release.yml` runs on the push to `main`, sees the pending changeset(s), and opens (or
   updates) a single **"Version Packages"** pull request — it bumps `package.json` for whichever
   package(s) have pending changesets, updates each one's `CHANGELOG.md`, and consumes the
   changeset file(s). If an adapter's `askif` dependency needs bumping too because `askif` itself
   got a version bump, changesets does that automatically for both `@askif/jev` and
   `@askif/openai` (`updateInternalDependencies: "patch"` in the config). This PR accumulates
   every pending changeset until it's merged, so multiple unrelated changes can ship together in
   one release, or you can merge it right away for a fast release — your call.

4. When you merge the **Version Packages** PR, `release.yml` runs again, finds no pending
   changesets, and runs `pnpm release` (build, then [`.github/scripts/publish.ts`](.github/scripts/publish.ts)) —
   publishing every package whose version isn't on the registry yet, via `npm publish` and
   trusted publishing.

No local `npm publish`/`npm login` is needed again after the one-time bootstrap above.

### A change that doesn't need a release

If a PR touches a package's files but shouldn't trigger a version bump (a test-only change, a
comment, CI config), run `pnpm changeset add --empty` instead of `pnpm changeset` — this
satisfies `pnpm changeset status` (which `release.yml` doesn't currently enforce as a required
check, but is good practice to keep green) without bumping anything.
