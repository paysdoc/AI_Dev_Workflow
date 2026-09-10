# Runbook: extracting `@paysdoc/devplatform`

Operator steps for Phase B of the GitContext extraction (PRD:
`specs/prd/gitcontext-library-extraction.md`). The PRD deliberately keeps these
out of the issue pipeline: they need npm credentials, repository creation, and
history surgery that no agent should perform. This file is also the parking
place for the five issues that cannot be filed until the library repository
and the first publish exist (see "Deferred issues" at the end).

Naming (decided 2026-09-10): repository `paysdoc/devplatform`, package
`@paysdoc/devplatform`. The word *forge* stays in the API (`forgeProviders`,
`IssueTrackerForge`, `CodeHostForge`, …); see the Forge entry in
`UBIQUITOUS_LANGUAGE.md`.

Entry points:

| Subpath | Contents |
|---|---|
| `.` | forge ports (`IssueTracker`, `CodeHost`, `BoardManager`) and the domain model |
| `./providers` | `forgeProviders()` and the GitHub, GitLab, and Jira adapters |
| `./git` | `GitContext`, executor, worktree/workspace/claim ops, `consoleLogger` |

## 0. Gate

Do nothing below until every one of these is merged to `dev` and released
to `main`:

| Slice | Issue |
|---|---|
| Extraction-readiness guard rule | #816 |
| Domain model into provider package | #817 |
| GitLab/Jira injected config + logger port | #818 |
| GitHub adapter reaches only executor/ports/domain model | #819 (HITL) |
| Callers off legacy layer, wave 1 (orchestrators/phases/core/proof) | #820 |
| Callers off legacy layer, wave 2 (triggers) + delete legacy layer | #821 |
| Retire #796 transitional construction sites | #822 |
| `forgeProviders()` + launch boundary rewire | #823 (HITL) |

Status 2026-09-10: closed. PRs #825–#833 merged to `dev`, released to `main`
via #836.

Verification that the gate is actually closed, run on `main`:

```bash
bun run lint:git-guard          # all four rules green
git grep -lE "from ['\"]\.\./\.\./(core|types|github)" -- adws/gitContext adws/providers | grep -v __tests__
# must print nothing
```

## 1. npm account (one-time)

1. Enable 2FA on the `paysdoc` npm user (already owns `@paysdoc/depaudit`).
2. Decide the auth path for CI:
   - Preferred: **trusted publishing (OIDC)**. Configured on npmjs.com under
     the package settings after the package exists, pointing at
     `paysdoc/devplatform` and the release workflow filename. This means the
     **first publish is manual** (step 6) because the package must exist
     before a trusted publisher can be linked to it.
   - Fallback: a **granular automation token** scoped to `@paysdoc/devplatform`
     only, stored as the `NPM_TOKEN` repository secret. No classic tokens.

## 2. Create the repository

```bash
gh repo create paysdoc/devplatform --public --description "Forge ports and adapters (GitHub, GitLab, Jira) over a forge-neutral git/worktree core" --license MIT
```

`--license` makes GitHub auto-initialise `main` with a LICENSE commit. That
is intended: step 3 rebases the filtered history onto it. Branch protection
is set in step 4 after L1 merges.

## 3. Filter and seed history

Work in a throwaway clone; never run filter-repo in the working checkout.
Clone `main` only: ADW's default branch is `dev`, and a default clone leaves
HEAD on `dev`, so later commits silently land on the wrong branch (this
happened on 2026-09-10).

There is no rename map. Every surviving file either has always lived under
one of the two directories or was created there fresh (verified 2026-09-10:
the only `git log --follow` rename entries are the eight intra-boundary moves
from `adws/gitContext/` into `adws/providers/github/`, which filter-repo keeps
on its own). The vcs modules those files were modelled on still exist as live
files in ADW and are not part of the library. History before 2026-06-22
(#658, the GitContext package's creation) stays in ADW.

The filtered history contains merge commits (76 of 158 on 2026-09-10), so it
cannot be rebased onto the LICENSE commit; `git rebase --root` replays every
commit and conflicts on the first merge. Instead the filtered root is
**grafted** onto the LICENSE commit and the graft is baked in by a second
filter-repo pass restricted to the filtered range, which leaves the LICENSE
commit itself (GitHub-signed) untouched so the push is a fast-forward.

```bash
git clone --no-local --branch main --single-branch https://github.com/paysdoc/AI_Dev_Workflow /tmp/dp-extract
cd /tmp/dp-extract
brew install git-filter-repo   # or pip install git-filter-repo
git filter-repo \
  --path adws/gitContext/ \
  --path adws/providers/ \
  --path-rename adws/gitContext/:src/git/ \
  --path-rename adws/providers/:src/providers/
ROOT=$(git rev-list --max-parents=0 main)
git remote add origin https://github.com/paysdoc/devplatform
git fetch origin main
LIC=$(git rev-parse origin/main)
git replace --graft "$ROOT" "$LIC"
git filter-repo --force --refs "$LIC..main"
git replace -d "$ROOT"
```

Sanity checks before pushing, all of which must hold **with replace refs
disabled** (`GIT_NO_REPLACE_OBJECTS=1`) to prove the graft is baked into real
objects and not merely honoured locally:

```bash
GIT_NO_REPLACE_OBJECTS=1 git rev-list --max-parents=0 main            # == $LIC
GIT_NO_REPLACE_OBJECTS=1 git merge-base --is-ancestor "$LIC" main     # exit 0 → fast-forward push
git rev-list --count main                                             # hundreds, not single digits
git log --follow --format='%h %ad %s' --date=short main -- src/git/gitContext.ts | tail -1
#   → the 2026-06-22 #658 creation commit
git ls-files | grep -vE '^src/'                                       # prints nothing
```

Then `git push -u origin main`.

Two consequences of the directory rename to fix immediately after the push,
as one commit each:

1. **Provider imports.** `src/providers/**` reaches the git core through
   relative paths that still spell `../gitContext`; rewrite the directory
   segment to `../git` (23 files on 2026-09-10; leave the local
   `gitContextFixture` test file alone). The reverse direction needs nothing:
   `src/git/__tests__` reaching `../../providers` still resolves.
2. **LICENSE.** The graft keeps LICENSE only in the root commit's tree; the
   first filtered commit's tree "deletes" it. Re-add it in the bootstrap
   commit (step 4).

## 4. Bootstrap and register with ADW

The filtered tree is `src/` only: no manifest, no tsconfig, no test config.

1. **Bootstrap commit, by hand, on `main`:**
   - `LICENSE` (copy from the root commit: `git show "$LIC":LICENSE`).
   - `package.json` skeleton: `"name": "@paysdoc/devplatform"`,
     `"version": "0.0.0-development"`, `"type": "module"`, `"license": "MIT"`,
     `repository`, scripts `typecheck` (`tsc --noEmit`), `test:unit`
     (`vitest run`), `test`; devDependencies `typescript`, `vitest`,
     `@types/node`, and `tsx` (the `.claude/hooks` run `bunx tsx …`). The
     build/exports configuration is issue L1.
   - `tsconfig.json` (noEmit, `include: ["src/**/*.ts"]`) and
     `vitest.config.ts` (`include: ['src/**/__tests__/**/*.test.ts']`).
   - `.github/adw.yml` containing `guardrails: true`.
   - `.github/workflows/ci.yml`: typecheck and vitest. With the import fix
     from step 3 it is **green from this commit** (verified 2026-09-10:
     36 test files, 834 tests). The guard is added to CI by L3.
   - `.github/workflows/release.yml`: placeholder that L2 replaces. The
     filename is what the npm trusted publisher links to.
   - `.gitignore` (`node_modules/`, `dist/`, `.env*`), `README.md`, `bun.lock`.
2. **No `/adw_init` by hand.** It does not write `.adw-version` (only
   `adwUpgrade.tsx` does), so a missing `.adw-version` still triggers the
   upgrade gate on the first issue. Filing L1 (step 4.5) parks it behind a
   `#UPG` tracking issue whose regen run executes `/adw_init` in a worktree,
   writes `.adw/`, `.adw-version`, the starter guardrail `settings.json`,
   runs `depaudit setup`, propagates `SOCKET_API_TOKEN` and
   `SLACK_WEBHOOK_URL`, and opens a PR that auto-merges (`hitl` unset). L1
   re-queues on the next tick.
3. **Register with the ADW host.** Add the repository to the `paysdoc-adw`
   GitHub App installation (github.com/settings/installations). Nothing
   else: the webhook calls `ensureCronProcess` on the first event for the
   repo, which spawns `trigger_cron.ts --target-repo paysdoc/devplatform`
   (verify: `Spawning cron trigger for paysdoc/devplatform` in the webhook
   log, and `agents/cron/paysdoc_devplatform.json`). Respect the
   single-host constraint. Cron PID files and spawn locks are keyed per
   repo, so a second cron process on the same host is supported.
   Every agent spawn in the new clone logs `Ignoring N permissions.allow
   entries from .claude/settings.json: this workspace has not been trusted`
   until the clone path is trusted. Harmless for the pipeline (agents run
   with `--dangerously-skip-permissions`); silence it by opening Claude Code
   there once, or set `projects["<TARGET_REPOS_DIR>/paysdoc/devplatform"]
   .hasTrustDialogAccepted: true` in `~/.claude.json`.
4. Create the `hitl` label (`--color ee35f5 --description "Human in the loop"`).
5. File L1, L2, L3 (bodies below). L1 first; L2 and L3 carry a
   `## Blocked by` section naming L1's number.
6. Secrets: none by hand under OIDC. `NPM_TOKEN` only on the token fallback.
7. **No branch protection.** ADW's merge path is a bare `gh pr merge --merge`
   with no `--auto` and no status-check polling, so required checks would
   reject every ADW merge while CI is pending, starting with the upgrade
   regen PR. ADW's own `dev` and `main` are unprotected for the same reason.
   Revisit if the merge path ever learns to wait for checks.

## 5. Add the Forge glossary entry (ADW side, any time before A1)

`UBIQUITOUS_LANGUAGE.md` gains a **Forge** entry under "Providers and
platforms". Done 2026-09-10.

## 6. First publish (manual)

After L1 merges and CI is green on `main`. A bare `npm publish` would publish
whatever `package.json` says, which is `0.0.0-development`, so the version is
set locally and discarded, and the release tag is written by hand so
semantic-release has a baseline to count from.

```bash
cd /tmp/dp-extract && git checkout main && git pull   # any clone of paysdoc/devplatform
bun install && bun run build
npm version 1.0.0 --no-git-tag-version
npm publish --access public
git checkout -- package.json           # discard the version bump
git tag v1.0.0 && git push origin v1.0.0
```

Then, on npmjs.com, link the trusted publisher (repo `paysdoc/devplatform`,
workflow `release.yml`). From here on, L2's release workflow publishes.

Verify: `npm view @paysdoc/devplatform version` prints `1.0.0`;
`npm pack --dry-run` shows `dist/` with `.d.ts` files and no `src/`;
`npx semantic-release --dry-run` on `main` reports no release (or a patch
above 1.0.0 if commits have landed since), never 1.0.0 again.

## 7. Drain the ADW queue, then file the switchover

1. Wait until no ADW issue on `paysdoc/AI_Dev_Workflow` is in a stage that
   `stageClassifier` classes as `active` or `awaiting_merge`. Read the
   top-level state files, not labels (`gh issue list --label a,b,c` is an
   AND filter and finds nothing):

   ```bash
   for f in agents/*/state.json; do
     jq -r 'select(.repoIdentity.repo == "AI_Dev_Workflow") | "#\(.issueNumber) \(.workflowStage)"' "$f"
   done | sort -u | grep -vE ' (completed|abandoned|discarded)$'
   # Also: `gh issue list --state open` shows no `adw:*`-labelled issue.
   # Stale `starting` entries for already-closed issues are leftovers of
   # superseded spawns and do not count.
   ```

   Human-gated and retriable stages (`merge_blocked`, `review_failed`,
   `paused_*`) are left alone; their PRs will conflict after A1 and are
   recovered afterwards with `## Retry` or `## Cancel`.
2. Triggers stay running. Any issue that spawns during A1's build branches
   off pre-A1 `dev` and its PR conflicts on up to ~91 files after the merge.
   The resolve_conflict agent handles those on the new library code; if it
   fails, `## Cancel` and re-run.
3. File A1 (switchover, HITL) and A2 (Dependabot) on `paysdoc/AI_Dev_Workflow`
   with the bodies below. A1 spawns on the next cron tick; that is intended.
4. **Human review of A1's PR** (these are not acceptance criteria the agent
   can meet):
   - Run the full suite locally: `bun run test`, `bun run test:unit`,
     `bun run lint:git-guard`, `bun run lint:docs-index`, BDD regression.
   - Trigger one live smoke workflow (a trivial chore issue on a target
     repo) from the PR branch and confirm it completes through PR creation.
   - Tag the pre-merge commit: `git tag pre-gitcontext-switchover <sha>` and
     push the tag.
   - Then approve.
5. **What happened on 2026-09-10 and how to restart A1.** The first A1 run
   (PR #843, plan only) stopped at its own Step 1 gate: ADW's launch
   boundary and three readers reached around the forge ports into the
   GitHub adapter and into git-core internals, and the published barrels
   correctly do not export those names. The fix is not to widen the
   library's surface with GitHub-named exports; it is L4 (a forge-keyed
   `createForgeCredentials` factory, `paysdoc/devplatform#9`) plus A0
   (route ADW's callers through the ports, #844, HITL). #840 carries
   `## Blocked by #844` and a Step 1 gate on L4's release.

   Restarting A1 once A0 has merged **and** L4 is on npm (the cross-repo
   dependency is not enforced by ADW; check `npm view` by hand):
   - Post `## Cancel` on #840. That kills any orchestrator, removes the
     local worktree and branch, deletes `agents/<adwId>/`, clears the bot
     comments and drops the spawn dedup, so cron respawns the issue fresh
     on the next tick. It does **not** touch the remote branch or PR #843;
     the respawn reuses the existing remote branch.
   - **Never close PR #843 (or any unmerged ADW PR) by hand.** The webhook
     treats an unmerged close as abandonment, closes the linked issue, and
     a closed blocker counts as satisfied, so A2 (#841) would spawn and
     build against pre-switchover code.

## 8. Rollback

A broken switchover is recovered by hand-reverting the A1 merge commit on
`dev` and `main`. ADW runs on the library after A1, so it cannot repair its
own switch. The `pre-gitcontext-switchover` tag from step 7.4 marks the
last known-good commit.

---

## Deferred issues

**Body rule (learned 2026-09-10):** ADW's dependency parser treats any `#N`
within 80 characters after *blocked by*, *depends on*, *requires*,
*prerequisite*, *waiting on* or *after* as a blocking issue, fail-closed,
in the repo the issue lives in. Both L4 and A0 were deferred on a prose
"prerequisite for … #840". Outside the `## Blocked by` section, refer to
issues by number without the hash.

### L1 — Package build, exports map, CI (repo: `paysdoc/devplatform`, AFK)

**Parent PRD:** `paysdoc/AI_Dev_Workflow` `specs/prd/gitcontext-library-extraction.md`

**What to build:** Compiled ESM plus type declarations via `tsc`, emitted to
`dist/`. `src/index.ts` re-exporting the forge ports and the domain model
from `src/providers/types.ts`. `package.json` `exports` map with three entry
points: `"."` → forge ports and domain model; `"./providers"` →
`forgeProviders`, `ForgeProvidersOptions`, `ForgeProviderDeps`, and the three
adapters; `"./git"` → `GitContext`, the executor, worktree/workspace/claim
ops, `consoleLogger`. `files` limited to `dist/`, `README.md`, `LICENSE`.
Make the hand-added CI (typecheck + vitest) green.

**Acceptance criteria:**
- [ ] `bun run build` produces `dist/**/*.js` + `dist/**/*.d.ts`; `npm pack --dry-run` lists no `src/`
- [ ] A Node consumer (`node -e "import('@paysdoc/devplatform')"`) and a Bun consumer resolve all three subpaths from the packed tarball
- [ ] `./git` import pulls no adapter module and no `forgeProviders` (verify with an import-graph assertion); root import pulls no adapter module
- [ ] CI green on typecheck + vitest

**Blocked by:** none.
**User stories:** 14, 15.

### L2 — Release automation with agent-prefixed commit parser (repo: `paysdoc/devplatform`, AFK)

**What to build:** semantic-release on push to `main`. `parserOpts.headerPattern`
accepts an optional `<agent-name>: ` prefix before the conventional type, e.g.
`build-agent: feat: …` → minor, `review-patch-agent: fix: …` → patch,
`plan-orchestrator: chore: …` → no release, plain `feat: …` → minor. Unit tests
for the pattern; a CI dry-run job (`semantic-release --dry-run`) on PRs so a
never-publishing configuration is caught before merge. Publishing via OIDC
trusted publishing (`id-token: write`), falling back to `NPM_TOKEN` if the
secret is present. The baseline is the hand-pushed `v1.0.0` tag from the
first manual publish; the workflow must never recompute 1.0.0.

**Acceptance criteria:**
- [ ] Parser unit tests cover agent-prefixed and plain commits for patch, minor, and none
- [ ] PR dry-run job shows the computed next version in the log
- [ ] First CI-driven release after 1.0.0 publishes `1.0.1` or `1.1.0` from a real merged commit
- [ ] No long-lived broad npm credential in the repository

**Blocked by:** L1.
**User stories:** 16, 17, 18, 19, 20.

### L3 — Port the git/gh guard (repo: `paysdoc/devplatform`, AFK)

**What to build:** Bring `checkGitGhGuard.ts` and the `guard/` module over
with two rules; wire into CI.

- **Shell-out rule**, exempt set = `src/git/` (the git core, the only package
  that may run git commands) and `src/providers/github/` (the GitHub adapter,
  whose `gh` command strings feed the core executor). This mirrors ADW's
  two-entry `EXEMPT_PACKAGES`. The adapter holds over 60 `gh …` string
  literals across 13 files; an exempt set of the core alone would flag every
  one of them.
- **Construction rule**, walked over the whole tree (ADW prunes the two
  packages from this rule; the library must not), with a sanctioned-site
  allowlist of exactly one file: `src/providers/forgeProviders.ts`. Verified
  2026-09-10: it is the only non-test call site of the adapter factories in
  the two packages, and nothing in them calls `new GitContext` outside tests.
- The identity rule is **not** ported: it guards consumers composing
  cwd-derived identity into `forgeProviders`, and nothing inside the library
  calls `forgeProviders` outside tests.
- The extraction-readiness rule is **not** ported: it has nothing to guard
  once the packages are the whole repo.

**Acceptance criteria:**
- [ ] A `git`/`gh` shell-out anywhere but `src/git/` and `src/providers/github/` fails CI; both exempt packages pass
- [ ] A call to an adapter factory or `new GitContext` from any non-test file other than `forgeProviders.ts` fails CI
- [ ] Guard test suite (both directions) relocated and green
- [ ] `bun run lint:git-guard` in CI

**Blocked by:** L1.
**User stories:** 22.

### L4 — Forge-keyed credential factory (repo: `paysdoc/devplatform`, AFK) — filed as `paysdoc/devplatform#9`

**Parent PRD:** `paysdoc/AI_Dev_Workflow` `specs/prd/gitcontext-library-extraction.md`. Unblocks the ADW switchover (AI_Dev_Workflow issue 840), whose build stopped because ADW's launch boundary can only build a `TokenProvider` and a bootstrap `GitIdentity` through GitHub-named exports that the published barrels do not carry. The consumer must not name a forge; the library resolves the implementation from the forge name, the way `forgeProviders()` already does for the tracker, code host and board.

## What to build

One forge-keyed factory in `src/providers/`, exported from `@paysdoc/devplatform/providers`:

```ts
createForgeCredentials(options: {
  forge: ForgeSelection;          // same selection object forgeProviders() takes
  identity: RepoIdentifier;
  deps?: ForgeCredentialDeps;     // per-forge, mirrors ForgeProviderDeps
}): { tokenProvider: TokenProvider; gitIdentity: GitIdentity }
```

Dispatch on `forge.codeHost`:

- **github** — `tokenProvider` is today's `createGitHubTokenProvider` fed by today's `resolveContextToken` chain (installation token when the App is configured, else PAT, else `gh auth token`), with `alternateIdentityPat` honoured. `gitIdentity` is today's `resolveBootstrapGitIdentity` (App-bot identity when the App is configured, else env, else git config, else the fallback). `deps.github` carries what the launch boundary currently injects by hand: `appConfig` (`GitHubAppConfig | null`, already resolved from env by the caller), `pat?`, `alternateIdentityPat?`, `ghAuthToken?` (test seam), `env?`, `exec?`.
- **gitlab** — there is no GitLab `TokenProvider` in the tree today. Add the minimal one: a `TokenProvider` whose `credentialEnv` supplies `GitLabConfig.token` for both purposes; `gitIdentity` from env → git config → fallback (no bot derivation). `deps.gitlab` is the existing `GitLabConfig`.
- Unknown code host: throw at construction, same as `forgeProviders()`.

Also:
- Move `createLiteralTokenProvider` out of `src/providers/github/` into the git core and export it from `@paysdoc/devplatform/git` — it is a fixed-string `TokenProvider` with no forge knowledge and every ADW test fixture uses it. Keep the GitHub file re-exporting it so nothing inside the library moves.
- Do **not** add the GitHub-named helpers (`createGhRepoApi`, `readLocalRepoInfo`, `ghAuthToken`, `resolveContextToken`, `getInstallationToken`, …) to any barrel. They stay adapter-internal; the factory is the only new public name.

## Acceptance criteria
- [ ] `createForgeCredentials` is importable from `@paysdoc/devplatform/providers`; `createLiteralTokenProvider` from `@paysdoc/devplatform/git`; a committed test packs the tarball and asserts both names resolve at runtime and in the emitted `.d.ts`
- [ ] Unit tests: github branch reproduces the three token-resolution paths and the App-bot identity; gitlab branch supplies the config token and env/git-config identity; unknown code host throws
- [ ] `@paysdoc/devplatform/git` still imports nothing from `src/providers/**` (existing import-graph assertion stays green)
- [ ] `bun run test`, `test:unit`, `lint:git-guard` green
- [ ] Merged with a `feat:` commit so semantic-release publishes a minor version

## Blocked by
none

### A0 — Route ADW callers through the forge ports (repo: `paysdoc/AI_Dev_Workflow`, **HITL**) — filed as #844

**Parent PRD:** `specs/prd/gitcontext-library-extraction.md`. Runbook: `specs/runbooks/gitcontext-extraction.md`. Unblocks the ADW switchover (issue 840, kept open on purpose), whose first build stopped because ADW still reaches around the forge ports into the GitHub adapter and into git-core internals. Everything below is ADW-side and needs nothing new from the library; the launch boundary itself is untouched here and moves to the library's forge-keyed credential factory in the switchover issue.

## What to build

1. **Route the three raw-GitHub call sites through the ports.**
   - `adws/core/issueRecord.ts`: replace `createGhRepoApi(ctx).fetchIssue` + `parseGitHubIssue` with the `IssueTracker.fetchIssue` port. Callers receive the port through the launch boundary's `BoundProviders`; thread it rather than constructing anything.
   - `adws/forge/hitlBoardNotifier.ts`: replace the bound repo API (`fetchIssue`, `fetchAllPRs`) and `selectPreferredPR` with `IssueTracker.fetchIssue` and `CodeHost.listPullRequests` / `findPullRequestByBranch`. If the preferred-PR choice (open over merged, newest first) is not expressible on the port's `PullRequestRecord`, add the missing field to the domain model in `adws/providers/types.ts` and both adapters, not a GitHub-only helper.
   - `adws/healthCheckChecks.ts`: `authenticatedUser()` → `CodeHost.getAuthenticatedUser()`; `fetchIssue` → `IssueTracker.fetchIssue`.
2. **Local repo identity without the GitHub adapter.** Replace every `readLocalRepoInfo` import (`orchestratorCli`, `healthCheck.tsx`, `pauseQueueScanner`, `trigger_cron`, `launchGitContext`'s default) with an ADW-owned `readLocalRepoIdentity(cwd?)` in `adws/core/` composed from `readOriginRemoteUrl` (git core) and `parseOwnerRepoFromUrl` (provider types, host-neutral). Same error message on failure.
3. **SSH clone URL without the GitHub adapter.** `adws/core/targetRepoManager.ts`: replace `convertToSshUrl` with a host-neutral conversion (`https://<host>/<owner>/<repo>[.git]` → `git@<host>:<owner>/<repo>.git`, anything else passed through) owned by ADW. Keep the re-export name so existing callers compile, or update them.
4. **Delete ADW tests of library internals.** `adws/vcs/__tests__/commitOperations.test.ts` and `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` test `commitOps`/`branchOps` that now live in `@paysdoc/devplatform`; delete them. `features/regression/step_definitions/feature-818.steps.ts` and `feature-820.steps.ts` instantiate `GitLabApiClient` directly; rewrite those steps against the `CodeHost` port or drop the scenario steps that exist only to prove the extracted module's shape, and update the matching `.feature` files. Regression tag counts must not regress for anything else.
5. **Guard.** No new `git`/`gh` shell-out anywhere; `lint:git-guard` unchanged and green.

After this issue, the only ADW imports that resolve into `adws/providers/github/**` or `adws/providers/gitlab/**` are test fixtures and `adws/core/launchGitContext.ts`, which the switchover issue replaces.

## Acceptance criteria
- [ ] `git grep -l "providers/github\|providers/gitlab\|providers/jira" -- adws features test ':!adws/providers' ':!**/__tests__/**'` lists only `adws/core/launchGitContext.ts` and `adws/core/githubAppAuth.ts`
- [ ] No non-test import of `adws/gitContext/<module>`; only the barrel
- [ ] Unit suite, typecheck, `lint:git-guard`, `lint:docs-index`, BDD regression green
- [ ] Living docs for `issueRecord`, `hitlBoardNotifier`, `healthCheck`, `targetRepoManager` updated where they describe the removed helpers

## Blocked by
none

### A1 — ADW switchover to `@paysdoc/devplatform` (repo: `paysdoc/AI_Dev_Workflow`, **HITL**) — filed as #840, body as revised 2026-09-10

**Parent PRD:** `specs/prd/gitcontext-library-extraction.md`. Runbook: `specs/runbooks/gitcontext-extraction.md` step 7.

**Prerequisites (both must be done before this builds):** #844 merged (ADW callers routed through the forge ports), and `paysdoc/devplatform#9` released on npm (forge-keyed `createForgeCredentials`). The first attempt at this issue (PR #843, plan only) stopped because neither existed; the plan it wrote is still valid apart from its Step 1 and the launch-boundary mapping below.

**Step 1 gate:** `npm view @paysdoc/devplatform versions` lists a version above 1.0.0 whose `/providers` barrel exports `createForgeCredentials` and whose `/git` barrel exports `createLiteralTokenProvider`. If not, stop and report; do not open a PR.

**What to build:** One atomic migration. Add `@paysdoc/devplatform` at that version as an exact-pinned dependency; rewrite every `adws/gitContext` import to `@paysdoc/devplatform/git` and every `adws/providers` import to `@paysdoc/devplatform` (ports, domain model) or `@paysdoc/devplatform/providers` (`forgeProviders`, adapters, `createForgeCredentials`). Rewrite `adws/core/launchGitContext.ts` so the token provider and bootstrap git identity come from `createForgeCredentials({ forge, identity, deps })` with `deps.github` built from `adws/core/githubAppAuth.ts`'s env-read App config, the PAT and the alternate-identity PAT; delete the direct imports of `resolveContextToken`, `ghAuthToken`, `createGitHubTokenProvider`, `readLocalRepoInfo` and `resolveBootstrapGitIdentity`. Test fixtures take `createLiteralTokenProvider` from `@paysdoc/devplatform/git`; `test/mocks/gitContextFixture.ts` replaces the one under `adws/providers/github/__tests__/`. Repoint `buildLaunchBoundary` at the library's `forgeProviders` and `GitContext`; delete `adws/gitContext/` and `adws/providers/`; set ADW's guard `EXEMPT_PACKAGES` to the empty set, delete the extraction-readiness rule, and remove the now-stale `adws/providers/forgeProviders.ts` entry from `SANCTIONED_CONSTRUCTION_SITES`; update the identity/construction rules to recognise the imported names; update `features/regression/**/feature-729.feature` path references; retire the living docs for the extracted modules and their `conditional_docs.md` entries.

**Rule:** no ADW module outside test fixtures imports a forge-named symbol (`createGitHub*`, `createGitLab*`, `GitLabApiClient`, `Jira*`) from the library. Production code sees only `forgeProviders`, `createForgeCredentials`, `GitContext`, the ports and the domain model.

**Acceptance criteria:**
- [ ] No `adws/gitContext/` or `adws/providers/` directory; no relative import of either remains
- [ ] `git grep -lE "createGitHub|createGitLab|GitLabApiClient|JiraApiClient|JiraIssueTracker" -- adws ':!**/__tests__/**'` prints nothing
- [ ] Guard exempt set empty; a git/gh shell-out anywhere in ADW fails CI; `SANCTIONED_CONSTRUCTION_SITES` lists only the launch boundary
- [ ] Full unit suite, typecheck, BDD regression green
- [ ] `feature-729.feature` and living docs updated; `bun run lint:docs-index` green

Operator verification (smoke workflow, rollback tag) is runbook step 7.4, not
an acceptance criterion.

**User stories:** 23, 24, 25, 26, 27, 29.

## Blocked by
#844

### A2 — Dependabot for `@paysdoc/devplatform` (repo: `paysdoc/AI_Dev_Workflow`, AFK)

**What to build:** `.github/dependabot.yml` watching npm, restricted to
`@paysdoc/devplatform` (`allow: dependency-name`), weekly, labelled
`dependencies`. Bump PRs are merged by hand; document in `adws/README.md`
that bot PRs sit outside the issue-keyed pipeline and must not be labelled
`adw:*`. (The webhook already ignores them: it handles only
`pull_request.closed`, keyed by an `issue-N` branch pattern.)

**Acceptance criteria:**
- [ ] Dependabot opens a PR when a new library version is published
- [ ] The PR is not picked up by cron or webhook (no ADW comments on it)
- [ ] README note present

**Blocked by:** A1.
**User stories:** 28.
