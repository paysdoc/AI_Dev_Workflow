# Bug: perIssueScenarioSweep strands removals locally — sync to origin and land the removal via a dedicated-branch PR

## Metadata
issueNumber: `758`
adwId: `cz390a-perissuescenarioswee`
issueJson: `{"number":758,"title":"perIssueScenarioSweep strands removals locally — no origin sync, direct default-branch push lease-rejects and is swallowed [adw:bug]","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-07-11T06:28:13Z"}`

## Bug Description
The per-issue scenario retention sweep (`runPerIssueScenarioSweep`, `adws/triggers/perIssueScenarioSweep.ts`, invoked ~once/day from `adws/triggers/trigger_cron.ts:237`) deletes `features/per-issue/feature-{N}.feature` files (and their step-def siblings) 14 days after the linked PR merged. It commits the removal locally but **the removal never reaches `origin`**.

Observed in production: two `chore: sweep stale per-issue scenarios (>14d post-merge)` bot-authored commits stranded on a local `dev` that was 47 commits behind `origin/dev`, never pushed.

**Expected:** a sweep run on a cron host whose local default branch is behind `origin` still lands the removal on `origin`, with no stranded local commits, and any push/merge failure is surfaced (logged at error) and retried — not silently swallowed.

**Actual:** the sweep commits onto a stale local default branch; the subsequent `--force-with-lease --force-if-includes` push is correctly lease-rejected (local is behind origin); the rejection is swallowed at `warn`; and because the removal was *committed* (files leave the git index), the next sweep no longer lists those files, so it never retries the push. The removal strands indefinitely.

## Problem Statement
Three distinct defects (all verified against code) combine so the sweep's removals never persist to `origin`:

1. **No origin sync before list/decide/commit.** `defaultPersistRemoval` (`perIssueScenarioSweep.ts:116`) only checks the checkout is *on* the default branch **by name** (`ctx.getCurrentBranch(ctx.basePath) !== branch`). There is no `git fetch origin <default> && git reset --hard origin/<default>` anywhere in the sweep path, and `trigger_cron.ts:237` calls `runPerIssueScenarioSweep()` with no preceding sync. Listing, staleness decisions, promotion-tag reads, and the commit all run against whatever stale local default branch the cron host happens to hold.

2. **The push is structurally doomed and the failure is swallowed.** `commitOps.pushBranch` (`commitOps.ts:106-120`) runs `git fetch origin "<default>"` then `git push --force-with-lease --force-if-includes -u origin "<default>"`. `--force-if-includes` requires the overwritten commits to already be in local history; when local `dev` is behind `origin/dev` it is not, so the push is correctly rejected. `defaultPersistRemoval`'s `catch` (`perIssueScenarioSweep.ts:126-128`) swallows it at `warn` (`"...leaving removal uncommitted for next sweep"`).

3. **The "self-heals on next sweep" claim is false for the committed path.** `removeAndCommitPaths` (`commitOps.ts:80-88`) **commits** the removal, so the files leave the git index. `defaultListFeatures` (`perIssueScenarioSweep.ts:56-63`) lists from `git ls-files` (the index), so the next sweep does not re-list them → finds nothing stale → returns early at `perIssueScenarioSweep.ts:206` → **never retries the push.** The docstring at `perIssueScenarioSweep.ts:50-55` and the comment at `:127` describe a self-heal that only holds for *uncommitted* working-tree deletions.

Additionally, pushing directly to the default branch is fragile even after an origin sync: the default branch can carry branch/commit protections that reject direct pushes (an environment-dependent failure mode on top of the lease rejection).

## Solution Statement
Replace the "commit-onto-local-default + force-push-default + swallow" persistence with a **dedicated-worktree → dedicated-branch → PR → immediate-merge** flow that mirrors the already-shipped `adwUpgrade` non-SDLC chore-PR pattern (`adwUpgrade.tsx:380-437`: push a dedicated branch → `createPR` → immediate `mergePR`, best-effort). The cron host's base checkout (`frameworkRepoRoot`) is never mutated.

Concretely, when the default persist path runs it:

1. **Syncs the base by construction.** It creates a dedicated worktree off **fresh `origin/<default>`** via `GitContext.createWorktreeForNewBranch(sweepBranch, defaultBranch)` — which runs `git fetch origin <default>` and `git worktree add -b <sweepBranch> <path> origin/<default>` (`worktreeCreateOps.ts:190-217`). **Listing, staleness reads, and removal all operate on this fresh worktree**, so there are no stale-base decisions (AC#2). `frameworkRepoRoot` is never `reset --hard`, so the running cron process's own checkout is never disturbed.

2. **Idempotency guard.** Before opening a PR, it checks for an existing **open** PR on the stable sweep branch via `defaultFindPRByBranch` (`adws/github/prApi.ts:61`). If one exists, it logs and skips — no duplicate PRs across the ~daily cadence.

3. **Removes + commits on the dedicated branch, then pushes that branch.** `removeAndCommitPaths(paths, msg, worktreePath)` on the sweep branch, then `pushBranch(sweepBranch, worktreePath)`. Because the sweep branch is freshly created off `origin/<default>` with no divergent remote history, the `--force-with-lease --force-if-includes` push succeeds (the lease/force-if-includes rejection only bites when overwriting a branch that moved underneath us — which never happens for a fresh dedicated branch).

4. **Opens a PR (base = default) and merges it immediately.** `createPR(title, body, sweepBranch, defaultBranch)` → parse the PR number with `extractPrNumber` (`adwBuildHelpers.ts:19`) → `mergePR(prNumber, repoInfo)` (`gh pr merge --merge`, `prCommands.ts:21`). **This resolves the issue's open design question** (see below).

5. **Surfaces failures at error and never strands.** Any push/PR/merge failure is logged at **`error`** (not swallowed at `warn`). On merge failure the PR is left **open** and is recoverable: because the removal was **never committed to the local base**, the files remain tracked on `origin/<default>` until the PR merges, so the next sweep re-lists them, the idempotency guard finds the still-open PR, and it waits rather than duplicating. On success the dedicated worktree and merged remote branch are cleaned up.

### Resolution of the open design question ("how does the chore PR get merged?")
**The sweep merges the PR itself, synchronously, via the existing `mergePR` (`gh pr merge --merge`) immediately after opening it — exactly as `adwUpgrade` does for its non-SDLC upgrade PR (`adwUpgrade.tsx:429`).** This is deliberately *not* the SDLC auto-merge (`autoMergeHandler.mergeWithConflictResolution` / `adwMerge.tsx`, which is bound to an issue + adwId + SDLC pipeline and has no generic "bare chore PR" entry point) and *not* a new label-based cron path. Immediate merge closes the pending-merge window, so idempotency stays trivial in the common case. If a target repo's default branch enforces required status checks that block an immediate merge, `mergePR` fails, the error is surfaced, and the PR is left open for a human/CI to merge — the same best-effort contract `adwUpgrade` already accepts. (GitHub-native `gh pr merge --auto` was rejected as the primary mechanism because it errors on repos that do *not* have auto-merge enabled, making it strictly less robust than immediate-merge on this codebase's own repo, where `adwUpgrade`'s immediate merge is proven to work.)

## Steps to Reproduce
1. On a cron host, check out the default branch (`dev`) and let it fall behind `origin/dev` (e.g. `origin/dev` advances 47 commits while the host is offline).
2. Ensure at least one `features/per-issue/feature-{N}.feature` exists whose linked PR merged more than 14 days ago (a stale candidate), with no `@promotion-suggested-*` tag.
3. Run the sweep (`runPerIssueScenarioSweep()`), as `trigger_cron.ts:237` does.
4. Observe: a local `chore: sweep stale per-issue scenarios (>14d post-merge)` commit is created on the local `dev`; `git push --force-with-lease --force-if-includes` is lease-rejected; the rejection is logged at `warn` and swallowed; `origin/dev` is unchanged.
5. Run the sweep again: the removed file is no longer in the index, so it is not re-listed; the sweep returns early and never retries the push. The local commit strands.

## Root Cause Analysis
The persistence step conflates three unsafe assumptions:
- **that the local default branch equals `origin/<default>`** — it only checks the branch *name*, never the ref, so it commits onto a stale base (`perIssueScenarioSweep.ts:116`);
- **that a direct force-with-lease push to the default branch is appropriate** — but `--force-if-includes` is (correctly) designed to reject exactly the behind-origin case, and the default branch may additionally be protection-guarded (`commitOps.ts:106-120`); and
- **that a swallowed, committed removal self-heals** — but committing removes the files from the index that `defaultListFeatures` re-lists from, breaking the retry loop the `catch` comment relies on (`perIssueScenarioSweep.ts:56-63`, `:126-128`).

The fix removes all three assumptions: never decide/commit against the local base (work off fresh `origin/<default>` in a dedicated worktree), never push the default branch directly (push a dedicated branch and open a PR), and never lose the retry signal (the removal is not committed to the base, so still-tracked files are re-listed until the PR lands), while surfacing failures at error instead of swallowing them.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/perIssueScenarioSweep.ts` — **primary fix.** Holds `runPerIssueScenarioSweep`, the pure `isScenarioStale` predicate, the `shouldSkipForPromotionState` promotion gate, `PerIssueSweepDeps`, and the buggy `defaultPersistRemoval` / `defaultListFeatures` / `defaultListStepDefSiblings` / `defaultReadFeatureContent`. The pure decision loop and predicates stay unchanged; the default I/O layer is rewired to a synced sweep worktree + PR persist; docstring `:50-55` and comment `:127` are corrected.
- `adws/gitContext/gitContext.ts` — the `GitContext` API used by the fix: `defaultBranch()`, `createWorktreeForNewBranch()`, `lsFiles()`, `removeAndCommitPaths()`, `pushBranch()`, `createPR()`, `mergePR()`, `removeWorktree()`, `deleteRemoteBranch()`. Read-only; no change.
- `adws/gitContext/commitOps.ts` — `pushBranch` (`--force-with-lease --force-if-includes`, the lease that rejects behind-origin) and `removeAndCommitPaths` (commits the removal → files leave the index). Read-only; explains why the fresh dedicated branch pushes cleanly. No change.
- `adws/gitContext/branchOps.ts` — `fetchAndResetToRemote` / `mergeLatestFromDefaultBranch` (origin-sync primitives) and `deleteRemoteBranch` (protected against `main`/`master`/`develop`; `chore/scenario-sweep` is deletable). Read-only reference.
- `adws/gitContext/worktreeCreateOps.ts` — `createWorktreeForNewBranch` fetches `origin/<base>` then `git worktree add -b <branch> <path> origin/<base>`; this is the "sync base by construction" primitive. Read-only reference.
- `adws/gitContext/commands/prCommands.ts` — `createPRCmd` (`gh pr create --head ... --base ...`) and `mergePRCmd` (`gh pr merge --merge`). Read-only reference for the PR/merge surface.
- `adws/adwUpgrade.tsx` — the precedent: `:380-437` push a dedicated branch → `createPullRequest` → immediate `mergePR`, best-effort, non-fatal, with `findPRByBranch` idempotency (`:266`). Model the sweep persist on this. Read-only reference.
- `adws/adwBuildHelpers.ts` — `extractPrNumber(prUrl)` (`:19`) parses the PR number from `createPR`'s returned URL. Reused by the fix.
- `adws/github/prApi.ts` — `defaultFindPRByBranch` (`:61`, returns `RawPR | null` with `.state`/`.number`) for the idempotency guard, and `mergePR` (`:238`, `{ success, error }`). Reused by the fix.
- `adws/github/githubApi.ts` — `getRepoInfo()` (`:18`) and `RepoInfo`; already used by the sweep. Read-only reference.
- `adws/triggers/trigger_cron.ts` — `:236-238` fires the sweep every `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` cycles (`config.ts:135`, default 4320 ≈ once/day). Confirms the fire-and-forget, unwrapped call site the fix must not crash. No change expected (the async persist is awaited inside `runPerIssueScenarioSweep`, which is already awaited here).
- `adws/triggers/__tests__/perIssueScenarioSweep.test.ts` — existing unit tests. The fully-injected tests and the `isScenarioStale` truth table stay green unchanged; the "default wiring through gitContextForRepo" block (`:343-410`) is rewritten for the new worktree+PR default path; new unit coverage is added for the persist orchestration.
- `features/per-issue/step_definitions/feature-739.steps.ts` — the real-git bare-remote BDD harness to model the #758 regression scenario on (temp repo + real `origin` bare remote, drives `runPerIssueScenarioSweep` in-process with injected deps, asserts on git artefacts). Read-only reference.
- `.adw/scenarios.md` — per-issue scenarios live in `features/per-issue/`, run by tag via `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"`. Read-only reference.

### New Files
- `adws/triggers/perIssueSweepPersist.ts` — extracts the new persist orchestration and sweep-base management out of `perIssueScenarioSweep.ts` so the latter stays under the 300-line coding-guideline limit and keeps a single responsibility. Exports:
  - a `SweepBase` type bundling the resolved collaborators `{ ctx, repoInfo, defaultBranch, sweepBranch, worktreePath, findOpenSweepPr, openPr, mergePr, log }`;
  - `prepareSweepBase()` — creates the dedicated worktree off fresh `origin/<default>` (best-effort; returns `null` on failure, logged);
  - `persistRemovalViaPr(paths, base)` — the fully-injected async orchestration (guard → remove+commit → push branch → open PR → immediate merge → surface errors); and
  - `cleanupSweepBase(base)` — best-effort worktree/remote-branch teardown.
  This is the unit-test and BDD-drive target.
- `features/per-issue/feature-758.feature` — `@adw-758`-tagged regression scenario: stale-base cron host (local default behind origin) → removal reaches origin via a pushed dedicated branch, with no stranded local commit and the PR opened+merged.
- `features/per-issue/step_definitions/feature-758.steps.ts` — real-git bare-remote step definitions modelled on `feature-739.steps.ts`; drives the real `persistRemovalViaPr` git flow against a local bare remote while faking only the gh-backed `findOpenSweepPr`/`openPr`/`mergePr` and `defaultBranch` seams.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the persist-orchestration module (`adws/triggers/perIssueSweepPersist.ts`)
- Define the stable constants: `SWEEP_BRANCH = 'chore/scenario-sweep'`, the commit message `'chore: sweep stale per-issue scenarios (>14d post-merge)'` (unchanged), and a PR title/body.
- Define `SweepBase` bundling the resolved collaborators (`ctx: GitContext`, `repoInfo: RepoInfo`, `defaultBranch: string`, `sweepBranch: string`, `worktreePath: string`, `findOpenSweepPr: (sweepBranch: string) => number | null`, `openPr: (sweepBranch: string, baseBranch: string) => string /* PR url */`, `mergePr: (prNumber: number) => { success: boolean; error?: string }`, `log`).
- Implement `prepareSweepBase(): SweepBase | null`:
  - Resolve `repoInfo = getRepoInfo()`, `ctx = gitContextForRepo(repoInfo)`, `defaultBranch = ctx.defaultBranch()`.
  - Best-effort clean any stale local worktree/branch: `ctx.removeWorktree(SWEEP_BRANCH)` (idempotent; ignore failures).
  - `worktreePath = ctx.createWorktreeForNewBranch(SWEEP_BRANCH, defaultBranch)` (fetches + branches off `origin/<default>`).
  - Wire the default gh-backed seams: `findOpenSweepPr` → `defaultFindPRByBranch(sweepBranch, repoInfo)` returning `pr.number` only when `pr.state.toUpperCase() === 'OPEN'`, else `null`; `openPr` → `ctx.createPR(PR_TITLE, PR_BODY, sweepBranch, baseBranch)`; `mergePr` → `mergePR(prNumber, repoInfo)`.
  - Return `null` (logged at `warn`) on any error so the sweep degrades to a no-op rather than crashing the unwrapped cron caller.
- Implement `async persistRemovalViaPr(paths, base): Promise<void>` with guard clauses (max-2 nesting; no `git add -A`):
  - `if (paths.length === 0) return;`
  - Idempotency: `const openPr = base.findOpenSweepPr(base.sweepBranch); if (openPr !== null) { log info "existing open sweep PR #N — skipping to avoid duplicate"; return; }`
  - `const committed = base.ctx.removeAndCommitPaths(paths, COMMIT_MSG, base.worktreePath); if (!committed) return;` (nothing staged — e.g. already removed on origin tip; no PR, no churn).
  - `base.ctx.pushBranch(base.sweepBranch, base.worktreePath);` (fresh branch → clean push). Wrap the push+PR+merge in a single try/catch that logs at **`error`** and returns (recoverable next sweep) — never rethrow.
  - `const prNumber = extractPrNumber(base.openPr(base.sweepBranch, base.defaultBranch)); if (!prNumber) { log error "could not resolve PR number"; return; }`
  - `const merge = base.mergePr(prNumber); if (!merge.success) { log error "sweep PR #N merge failed (left open, retried next sweep): <err>"; return; }` else `log success "sweep PR #N merged; removal landed on origin"`.
- Implement `cleanupSweepBase(base)`: best-effort `ctx.deleteRemoteBranch(SWEEP_BRANCH)` (only meaningful after a successful merge; harmless otherwise) and `ctx.removeWorktree(SWEEP_BRANCH)`; swallow failures (cleanup must never crash the cron).
- Follow `.adw/coding_guidelines.md`: guard clauses first, side effects isolated to these boundary functions, no decorators, immutable locals, JSDoc on each exported symbol.

### 2. Rewire the sweep defaults to the synced worktree (`adws/triggers/perIssueScenarioSweep.ts`)
- Extend `PerIssueSweepDeps.persistRemoval` to `(paths: readonly string[]) => void | Promise<void>` and `await` it at the call site (`:208`).
- Change the base-dependent defaults (`defaultListFeatures`, `defaultListStepDefSiblings`, `defaultReadFeatureContent`) and the persist default to operate on a **resolved `SweepBase`** rather than each independently resolving `gitContextForRepo(getRepoInfo())` + `ctx.basePath`:
  - `defaultListFeatures(base)` → `base.ctx.lsFiles(base.worktreePath, PER_ISSUE_DIR)` filtered by `FEATURE_FILENAME_RE`.
  - `defaultListStepDefSiblings(base, issueNum)` → `base.ctx.lsFiles(base.worktreePath, STEP_DEF_DIR)` filtered by `feature-${issueNum}.` prefix.
  - `defaultReadFeatureContent(base, filePath)` → `fs.readFileSync(path.join(base.worktreePath, filePath))`; `null` on error (fail-safe preserved).
  - `defaultPersistRemoval(base, paths)` → delegates to `persistRemovalViaPr(paths, base)`.
- In `runPerIssueScenarioSweep`, build the defaults via a **memoized lazy** `getBase()` so the worktree is created **at most once, only when a base-dependent default actually runs**, and never in fully-injected callers:
  - `let cachedBase: SweepBase | null | undefined; const getBase = () => { if (cachedBase === undefined) cachedBase = prepareSweepBase(); return cachedBase; };`
  - `listFeatures = deps?.listFeatures ?? (() => { const b = getBase(); return b ? defaultListFeatures(b) : []; });` and analogously for `listStepDefSiblings` (`[]` on null base), `readFeatureContent` (`null` on null base), and `persistRemoval` (`if (b) await persistRemovalViaPr(paths, b);`).
  - `getMergedAt` stays a remote gh query (`defaultGetMergedAt`, uses its own `gitContextForRepo(repoInfo)`) — it must NOT depend on `getBase()`.
  - After the loop returns, if `cachedBase` was created (`cachedBase != null`), call `cleanupSweepBase(cachedBase)` (best-effort) in a `finally`-style guard so the worktree is always torn down.
- Correct the now-false prose: rewrite the `defaultListFeatures` docstring (`:50-55`) to state that listing is done from a worktree synced to `origin/<default>` (not "self-healing via the local index"), and rewrite the persist comment (`:127`) to state that failures are surfaced at error and retried via the still-tracked files on origin (the removal is never committed to the base), not "left uncommitted for next sweep".
- Keep `isScenarioStale`, `shouldSkipForPromotionState`, and the promotion-exemption composition (`parsePromotionTagState`/`isPromotionExempt`) **unchanged** — the #739 promotion-awareness contract must be preserved.

### 3. Update unit tests (`adws/triggers/__tests__/perIssueScenarioSweep.test.ts`)
- Leave the `isScenarioStale` truth table and every **fully-injected** integration test unchanged — verify they still pass (they never trigger `getBase()`).
- Rewrite the `runPerIssueScenarioSweep — default wiring through gitContextForRepo` block (`:343-410`): the default persist path no longer calls `removeAndCommitPaths` on `basePath` + `pushBranch('dev', basePath)`. Update the mock `GitContext` to also stub `defaultBranch`, `createWorktreeForNewBranch` (returns a worktree path), `lsFiles` keyed on the worktree path, `removeAndCommitPaths`, `pushBranch`, `createPR` (returns a `.../pull/123` URL), `mergePR`, `removeWorktree`, `deleteRemoteBranch`, and `findPRByBranch`/`defaultFindPRByBranch`. Assert: worktree created off the default branch, listing via `lsFiles` on the worktree path, `removeAndCommitPaths` + `pushBranch` on `SWEEP_BRANCH`/worktree, `createPR` then `mergePR` invoked with the parsed PR number, and cleanup called.
- Add a focused unit suite for `persistRemovalViaPr` (in a new `adws/triggers/__tests__/perIssueSweepPersist.test.ts`) covering each branch with a fake `SweepBase`:
  - open sweep PR exists → guard skips (no remove/push/PR);
  - `removeAndCommitPaths` returns `false` → no push, no PR (no-op);
  - push throws → logged at **error**, no PR, returns (no crash);
  - `mergePr` returns `{ success:false }` → logged at **error**, PR left open, returns;
  - happy path → remove+commit, push `SWEEP_BRANCH`, open PR, `mergePr` called with the `extractPrNumber`-parsed number, success logged.

### 4. Add the BDD regression scenario (`features/per-issue/feature-758.feature` + step defs)
- Tag `@adw-758`. Author the scenario against the observable contract (git artefacts only — vocabulary surface "git artefacts: branches, commits, pushes, and worktree state"), e.g.:
  - `Given a stale per-issue scenario for issue N committed on the default branch of origin`
  - `And the local default branch is behind origin` (extra origin-only commits)
  - `When the per-issue scenario sweep persists the removal`
  - `Then the removal is pushed to origin on the dedicated sweep branch`
  - `And the local default branch has no new stranded commit`
  - `And a pull request for the removal was opened and merged`
- Implement `feature-758.steps.ts` modelled on `feature-739.steps.ts`:
  - Build a real temp repo with a real bare `origin` (`git init --bare` + `git clone`); seed + commit + push the stale `feature-N.feature` (+ sibling) to origin; then advance `origin/<default>` from a second clone so the primary workdir is **behind** origin (reproduces the 47-commits-behind condition).
  - Drive the real `persistRemovalViaPr` against the fixture: build a fixture `GitContext` (as `makeFixtureCtx` does), create the sweep worktree off `origin/<default>` for real, and pass a `SweepBase` whose git-backed ops are real and whose gh-backed seams are fakes — `findOpenSweepPr: () => null`, `openPr` returns a fake `.../pull/1` URL (recording the call), `mergePr: () => ({ success: true })` (recording the PR number). Invoke it via `runPerIssueScenarioSweep({ now, getMergedAt: fixed, listFeatures/listStepDefSiblings/readFeatureContent over the worktree, persistRemoval: (paths) => persistRemovalViaPr(paths, fixtureBase) })`.
  - Assertions: `git show origin/chore/scenario-sweep --name-status` (or `git ls-tree origin/chore/scenario-sweep`) shows the feature file **deleted** on origin (removal reached origin); the local default-branch `HEAD` is unchanged (no stranded commit); the `mergePr`/`openPr` fakes were invoked (PR path taken). Register any novel Given/When/Then phrases in the step-def header comment (do not auto-promote to `@regression`).
- Keep the fixture hermetic (no network, no real `gh`) and clean up temp dirs in an `After({ tags: '@adw-758' })` hook.

### 5. Run the validation commands
- Execute every command in the `Validation Commands` section and confirm zero errors and zero regressions (lint, both type-checks, unit tests, build, the `@adw-758` scenario green, and the `@adw-739` sweep scenario still green).

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands are the project-specific ones from `.adw/commands.md`.

- `bun run lint` — linter passes (code hygiene, no unused imports).
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (the new `SweepBase` seams and `persistRemovalViaPr` signature wire cleanly).
- `bun run test:unit` — unit tests pass, including the rewritten default-wiring block and the new `persistRemovalViaPr` suite; the `isScenarioStale` truth table and all fully-injected tests remain green (zero regression).
- `bun run build` — build succeeds with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-758"` — the new regression scenario is green: on a stale-base fixture (local default behind origin), the removal reaches origin on the dedicated sweep branch with no stranded local commit and a PR opened+merged. **Reproduces the bug before the fix (RED): with the old commit-to-local-default + force-push-default persist against a behind-origin base, the removal never reaches origin and/or a local commit strands; after the fix it is GREEN.**
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-739"` — the promotion-aware sweep scenario still passes (the promotion-exemption composition is preserved).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep files under 300 lines (hence the new `perIssueSweepPersist.ts` extraction), guard clauses over nested conditionals (max depth ~2), immutable locals, side effects isolated to the boundary persist/base functions, no decorators, JSDoc on exported symbols. The pure `isScenarioStale`/`shouldSkipForPromotionState` predicates stay pure and untouched.
- **No new libraries** — the fix reuses existing `GitContext`/`gh` primitives (`createWorktreeForNewBranch`, `removeAndCommitPaths`, `pushBranch`, `createPR`, `mergePR`, `removeWorktree`, `deleteRemoteBranch`), `extractPrNumber`, `defaultFindPRByBranch`, and `getRepoInfo`. If a dependency were ever needed, `.adw/commands.md` specifies the install command `bun add <package>` — none is needed here.
- **Cadence keeps duplicate-PR risk low.** `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` defaults to 4320 (≈ once/day at the 20s poll), so the only window for a duplicate PR is a sweep whose immediate merge failed (protected branch); the stable `chore/scenario-sweep` branch + `findOpenSweepPr` guard collapse that to a single open PR that a human/CI merges.
- **`frameworkRepoRoot` is never mutated.** The fix deliberately does **not** `fetchAndResetToRemote` the cron host's own base checkout (which could swap `adws/` files under the running cron mid-cycle) — all sweep work happens in a disposable `.worktrees/chore-scenario-sweep` worktree, consistent with the memory note on avoiding shared-checkout mutation and the KPI "don't disturb the active checkout" precedent.
- **BDD observability limit** (per project memory): a local bare remote cannot exercise real `gh pr create`/`gh pr merge`/`gh pr list`; the regression scenario therefore drives the real git worktree/commit/push flow and fakes only those gh-backed seams, pinning the callee-side contract (origin sweep-branch ref + local HEAD unchanged) rather than mock request recordings.
- **Conditional documentation** consulted per `.adw/conditional_docs.md` (matched conditions): `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` (owns `perIssueScenarioSweep.ts`), `app_docs/feature-oobdbg-bdd-cutover-polymorphic-prompts-sweep.md` (sweep + `trigger_cron` wiring), `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` (owns `commitOps.ts`; commit/push failures as handled results; the `adwUpgrade` dedicated-branch → PR → immediate-merge precedent), and `app_docs/feature-ne2we8-promotion-tag-state.md` / feature-739 (the promotion-exemption gate that must be preserved).
