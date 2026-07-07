# Bug: Per-issue scenario sweep leaves uncommitted deletions and orphans step-def files

## Metadata
issueNumber: `735`
adwId: `qwfm4x-bug-per-issue-scenar`
issueJson: `{"number":735,"title":"bug: per-issue scenario sweep leaves uncommitted deletions and orphans step-def files","body":"## Summary\n\n`adws/triggers/perIssueScenarioSweep.ts` (the 14-day per-issue retention sweep, invoked every cron backlog cycle at `adws/triggers/trigger_cron.ts:214`) has two defects that together mean it **never actually removes stale scenarios from the repo** and instead leaves the cron host's working tree permanently dirty.\n\nObserved live: 67 `features/per-issue/feature-*.feature` files sit **unstaged-deleted** in the working tree (issues with PRs merged >14 days ago, i.e. ≤665), while all 85 sibling step-def files remain and none of the deletions are committed.\n\n## Defect 1 — deletions are never persisted (no `git rm`/commit)\n\n`runPerIssueScenarioSweep` deletes with a raw `fs.rmSync(filePath)` (line ~69) and neither it nor its caller (`trigger_cron.ts:214`) stages, commits, or pushes. Consequences:\n- The scenarios are **never removed from `origin/dev`** — the \"retention sweep\" retains nothing durably.\n- Every cron cycle re-`rmSync`s the same stale files, so the cron host's working tree accumulates uncommitted deletions indefinitely (currently 67). A perpetually dirty tree is a latent hazard for any git operation that assumes a clean checkout.\n\n## Defect 2 — orphaned step-def files\n\nThe filename filter `FEATURE_FILENAME_RE = /^feature-(\\d+)\\.feature$/` (line ~15) matches only the `.feature` file. The sibling `features/per-issue/step_definitions/feature-{N}.steps.ts` is left behind. Result: **19 feature files vs 85 step-def files on disk** — ~66 orphaned step-def files whose scenarios no longer exist.\n\n## Fix\n\n1. When sweeping `feature-{N}.feature`, also remove `features/per-issue/step_definitions/feature-{N}.steps.ts` (and any other framework-specific step-def extension) if present.\n2. Persist the removal: `git rm` the files (or `fs.rmSync` + stage) and commit + push to the default branch via `GitContext`, so the scenarios are actually removed from the repo rather than only the local tree. Guard the no-op case (nothing stale → no commit).\n\n## Out of scope — needs a human decision, do NOT change in this fix\n\nWhether auto-deletion should happen **at all**: per-issue scenarios now have **human-curated promotion value** (see the direct-relocation promotion decision / issue #734). A 14-day auto-delete races against manual promotion — a good candidate could be swept before a human promotes it. This fix should make the sweep *correct and persistent*; it must **not** change the retention window or disable the sweep. Flag the policy question for human triage separately.\n\n## Acceptance\n\n- Sweeping issue N removes both `feature-N.feature` and its step-def sibling.\n- The removal is committed and pushed (persists to the default branch); a clean cron run leaves **no** uncommitted working-tree deletions.\n- Unit/BDD coverage for: (a) both files removed, (b) removal is committed (git artefact), (c) no-op when nothing is stale.\n","state":"OPEN","author":"paysdoc","labels":["hitl","adw:bug"],"createdAt":"2026-07-07T15:54:00Z","comments":[],"actionableComment":null}`

## Bug Description

`adws/triggers/perIssueScenarioSweep.ts` is the 14-day per-issue scenario retention sweep, invoked every `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` cron cycle from `adws/triggers/trigger_cron.ts:214` (`await runPerIssueScenarioSweep();`). Its job is to remove a per-issue BDD scenario (`features/per-issue/feature-{N}.feature`) once the PR that linked issue `#N` was merged more than `RETENTION_DAYS` (14) ago.

It has two independent defects:

- **Defect 1 — deletions are never persisted.** The sweep removes each stale scenario with a raw `fs.rmSync(filePath)` (`defaultDeleteFile`, line 68–70) and neither it nor its caller stages, commits, or pushes. The deletion exists only as an **unstaged working-tree deletion** on the cron host's self-host checkout (`REPO_ROOT`, on the default branch `dev`). The scenario is **never removed from `origin/dev`**, and the working tree accumulates uncommitted deletions indefinitely (67 observed live). A perpetually dirty tree is a latent hazard for any downstream git operation that assumes a clean checkout.

- **Defect 2 — orphaned step-def siblings.** `FEATURE_FILENAME_RE = /^feature-(\d+)\.feature$/` matches only the `.feature` file. The paired step-definition `features/per-issue/step_definitions/feature-{N}.steps.ts` is never touched, so its step defs linger after the scenario is gone (~66 orphaned step-def files on disk).

**Expected behaviour:** sweeping issue `#N` removes both `features/per-issue/feature-N.feature` **and** `features/per-issue/step_definitions/feature-N.steps.ts` (and any other framework step-def extension), commits the removal, and pushes it to the default branch so the change persists to `origin/dev`. A clean cron run leaves no uncommitted working-tree deletions. When nothing is stale, no commit is created.

**Actual behaviour:** only the `.feature` file is `rmSync`'d in the working tree; the step-def sibling remains; nothing is staged/committed/pushed; the deletion persists only as uncommitted dirt and the scenario is never removed from `origin/dev`.

## Problem Statement

The retention sweep does not durably remove stale per-issue scenarios: (1) it removes only local working-tree copies of the `.feature` file without a `git rm`/commit/push, so the removal never reaches `origin/dev` and the cron host's working tree accumulates uncommitted deletions; and (2) it never removes the sibling step-definition file, orphaning it. The sweep must remove **both** files and **persist** the removal to the default branch via `GitContext`, while doing nothing (no commit) when nothing is stale — without changing the 14-day retention window or disabling the sweep.

## Solution Statement

Rework `runPerIssueScenarioSweep` so that, per stale issue `#N`, it collects **both** the feature file and every existing step-def sibling into a single removal set, then persists that set atomically through `GitContext`: `git rm` the paths, commit **scoped to only those paths**, and push to the default branch. Guard the no-op (empty removal set → no commit, no push).

Because `adws/triggers/**` is scanned by the raw-git CI guard (`adws/checkGitGhGuard.ts`) and only `adws/gitContext/**` is exempt, **all git operations must route through `GitContext` methods**. The existing `GitContext.commitChanges` is `git add -A` (commits the *entire* working tree), which is unsafe here — it would sweep unrelated dirty state into the commit. So we add a small **scoped** primitive to the exempt `adws/gitContext/` package:

- `commitOps.removeAndCommitPaths(run, paths, message, cwd)` — `git rm -f --ignore-unmatch -- <paths>`, then, only if the removal staged something for those pathspecs, `git commit -m <message> -- <paths>` (pathspec-scoped so unrelated staged/dirty state is untouched). Returns whether a commit was made.
- `GitContext.removeAndCommitPaths(paths, message, worktreePath)` — thin method delegating to `commitOps`, mirroring `commitChanges`/`pushBranch`.

The sweep's default file listing switches from `fs.readdirSync` (working tree) to `GitContext.lsFiles(basePath, 'features/per-issue')` (the git **index**). This is strictly more correct: staleness is decided on **tracked** scenarios (the repo is the source of truth, not a possibly-already-mutated working tree), it routes through `GitContext` (guard-clean), and it **self-heals the pre-existing 67 already-deleted-but-uncommitted files** — they are still tracked, so they are re-listed, `git rm`-staged, and committed on the first fixed run.

Step-def siblings are discovered the same way: `GitContext.lsFiles(basePath, 'features/per-issue/step_definitions')` filtered to basenames starting with `feature-{N}.` — matching `.steps.ts` and any other extension without hardcoding the framework.

The default persistence is **branch-guarded and fail-open**: it only mutates when the self-host checkout's current branch equals the default branch (never commit/push onto the wrong branch), and it wraps git work in try/catch and logs a warning on failure rather than throwing — so a transient git/gh error can never crash the cron loop (`trigger_cron.ts` does not wrap the `await runPerIssueScenarioSweep()` call). Because `pushBranch` pushes the whole default branch ref, a transient push failure self-heals on the next sweep that finds anything stale (the earlier local commit is carried along).

All side effects stay injectable behind `PerIssueSweepDeps`, keeping `isScenarioStale` pure and the sweep unit-testable without touching real git. A new `@adw-735` BDD scenario proves the git-artefact behaviour end-to-end over a real fixture repo with a bare origin remote (modeled on `feature-648`).

## Steps to Reproduce

1. On a self-host cron checkout (`REPO_ROOT` on default branch `dev`), have `features/per-issue/feature-{N}.feature` + `features/per-issue/step_definitions/feature-{N}.steps.ts` for an issue `#N` whose linked PR merged > 14 days ago.
2. Let the cron run a sweep cycle (or call `runPerIssueScenarioSweep()`).
3. Observe: `feature-{N}.feature` disappears from the working tree but `git status` shows it as an **unstaged deletion** (never committed); the sibling `feature-{N}.steps.ts` is **still present**; `origin/dev` is unchanged.
4. Repeat cycles: uncommitted deletions accumulate; step-def orphans pile up (live: 67 `.feature` deletions, ~66 orphaned `.steps.ts`).

Automated reproduction (this plan):
- **Unit (RED before fix):** a test asserting the sweep's persistence hook is invoked with **both** the feature path and its step-def sibling fails against current code (current code calls `deleteFile` per single `.feature` and never persists).
- **BDD (RED before fix):** `@adw-735` scenario asserts both files are removed from the index *and* a commit landed on / was pushed to the default branch — impossible with the current `fs.rmSync`-only code.

## Root Cause Analysis

- **Defect 1 root cause:** `runPerIssueScenarioSweep` treats "delete" as a filesystem operation (`fs.rmSync`) with no git awareness. There is no staging, commit, or push, and the caller doesn't add one either. The removal therefore never becomes a tree change on `dev` and never reaches `origin`. Listing via `fs.readdirSync` (working tree) also means a file already `rmSync`'d in a prior cycle is invisible on the next run, so those unstaged deletions are never re-processed and never get committed — they are stranded as permanent working-tree dirt.
- **Defect 2 root cause:** the discovery and removal logic is keyed solely on `FEATURE_FILENAME_RE` (`^feature-(\d+)\.feature$`), which by construction excludes the step-def sibling. Nothing ever computes or removes `features/per-issue/step_definitions/feature-{N}.steps.ts`.
- **Constraint that shapes the fix:** `adws/triggers/perIssueScenarioSweep.ts` is inside the region scanned by `adws/checkGitGhGuard.ts`; only `adws/gitContext/**` is exempt. So the fix cannot shell out to `git` from the sweep — it must call `GitContext` methods. The one existing commit method (`commitChanges` → `git add -A`) is too broad for a surgical, dirty-tree-tolerant removal, motivating a new scoped `removeAndCommitPaths` primitive inside the exempt package.

## Relevant Files

Use these files to fix the bug:

- `adws/triggers/perIssueScenarioSweep.ts` — **primary fix.** Rework `PerIssueSweepDeps`, `defaultListFeatures`, add step-def sibling discovery + `defaultPersistRemoval`, and change `runPerIssueScenarioSweep` to collect both files and persist via `GitContext`. Remove the now-unused `defaultDeleteFile`/`fs.rmSync` path.
- `adws/gitContext/commitOps.ts` — **add** `removeAndCommitPaths(run, paths, message, cwd)` (scoped `git rm` + pathspec-scoped commit) and export it on the `commitOps` object. This file is inside the guard-exempt `adws/gitContext/` package, so raw git strings are allowed here.
- `adws/gitContext/gitContext.ts` — **add** the `removeAndCommitPaths(paths, message, worktreePath)` method on the `GitContext` class under the "Commit/push ops" section, delegating to `commitOps` exactly like `commitChanges`/`pushBranch`. Reuse existing `defaultBranch()`, `getCurrentBranch()`, `lsFiles()`, and `pushBranch()`.
- `adws/triggers/__tests__/perIssueScenarioSweep.test.ts` — **update.** Replace the `deleteFile`-based tests with `persistRemoval`/`listStepDefSiblings`-based tests covering: (a) both feature + sibling removed, (b) persistence invoked once with the batch (commit path), (c) no-op when nothing is stale (persistence not called), plus a default-routing test through the mocked `gitContextForRepo`. Keep the `isScenarioStale` truth table and the `getMergedAt` fail-open / unrecognised-filename cases.
- `adws/gitContext/__tests__/commitOps.test.ts` — **add** unit coverage for `removeAndCommitPaths` using the existing prefix-keyed fake runner: asserts the `git rm ... --ignore-unmatch -- <paths>` + scoped `git commit ... -- <paths>` command sequence, and the no-op (returns `false`, no commit) when the scoped `git status --porcelain` is empty or `paths` is empty.
- `adws/triggers/trigger_cron.ts` — **read-only reference** (call site `trigger_cron.ts:214`). No change required; the sweep stays fail-open so the unwrapped `await` cannot crash the cron loop. Confirm no change is needed.
- `adws/core/stepDefDetection.ts` — reference for `stepDefExtensionsFor`/framework→extension mapping; used to justify the prefix-based (`feature-{N}.`) sibling match rather than hardcoding `.steps.ts`.
- `.adw/scenarios.md` — confirms per-issue scenario dir (`features/per-issue/`), BDD framework (`cucumber-js`), and that per-issue step defs live in `features/per-issue/step_definitions/`.
- `features/per-issue/step_definitions/feature-648.steps.ts` — **exemplar** for the new BDD step definitions: builds a real temp repo with a real bare `origin` remote (no network), drives a production `GitContext` method in-process, and asserts git-ref artefacts. Mirror its fixture setup, `After` cleanup, and git-artefact assertion style.

### New Files

- `features/per-issue/feature-735.feature` — new BDD scenario tagged `@adw-735` (plus an `@adw-{adwId}` tag per repo convention). Scenarios: (1) a stale per-issue scenario and its step-def sibling are both removed and the removal is committed to and pushed to the default branch (git artefact); (2) a fresh (< 14 day) scenario is left intact; (3) no-op — when nothing is stale, no new commit is created. All assertions target produced git artefacts (index membership, branch tip / commit presence on a real origin), never source-file text — satisfying the rot-prevention rule.
- `features/per-issue/step_definitions/feature-735.steps.ts` — step definitions driving `runPerIssueScenarioSweep` in-process over a fixture repo. Inject `listFeatures`/`getMergedAt`/`now` to control the stale/fresh set, and inject a fixture-scoped `persistRemoval` that calls the **real** `GitContext.removeAndCommitPaths(...)` + `GitContext.pushBranch(...)` (constructed with `frameworkRepoRoot` pointed at the fixture, like `feature-648`'s `makePushCtx`). Assert via `git ls-files` (files gone from the index) and against the bare origin (default-branch tip advanced / removed files absent from origin `HEAD`; unchanged in the no-op case). `After({ tags: '@adw-735' })` cleans up temp dirs. `features/` is guard-exempt, so `execSync('git …')` is allowed in this file.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the scoped removal primitive to the GitContext package

- In `adws/gitContext/commitOps.ts`, add a package-private function:
  - `removeAndCommitPaths(run: Runner, paths: readonly string[], message: string, cwd: string): boolean`
  - Guard: if `paths.length === 0` return `false`.
  - Build a single-quoted, space-joined pathspec token string from `paths` (reuse the same quoting style already used in `gitignoredSubset`).
  - `run(\`git rm -f --ignore-unmatch -- ${tokens}\`, cwd)` — stages deletion from index (and working tree); `--ignore-unmatch` keeps it idempotent when a path is already absent from the index (the pre-existing already-deleted case); `-f` matches the current unconditional-delete behaviour.
  - Read `git status --porcelain -- ${tokens}`; if it is empty/whitespace, return `false` (nothing to commit — no-op guard at the primitive level).
  - `run(\`git commit -m "${message.replace(/"/g, '\\"')}" -- ${tokens}\`, cwd)` — pathspec-scoped commit so unrelated staged/dirty state is not committed. Reuse the same message-escaping as `commitChanges`.
  - Return `true`.
- Add `removeAndCommitPaths` to the exported `commitOps` object.
- Keep the function under the file's existing style; do not disturb `commitChanges`/`pushBranch`/`committableExcludePaths`.

### 2. Expose the primitive on the GitContext class

- In `adws/gitContext/gitContext.ts`, under the `// ── Commit/push ops ──` section (next to `commitChanges`/`pushBranch`), add:
  - `removeAndCommitPaths(paths: readonly string[], message: string, worktreePath: string): boolean { return commitOps.removeAndCommitPaths((cmd, cwd) => this.#run(cmd, { cwd }), paths, message, worktreePath); }`
- No new imports needed (`commitOps` is already imported). Do not change `#run`, env, or identity handling.

### 3. Unit-test the new primitive

- In `adws/gitContext/__tests__/commitOps.test.ts`, add a `describe('removeAndCommitPaths')` block using the existing prefix-keyed fake runner:
  - Asserts, when scoped `git status --porcelain` reports a staged deletion, the command sequence is `git rm -f --ignore-unmatch -- '<a>' '<b>'` followed by `git commit -m "…" -- '<a>' '<b>'`, and the function returns `true`.
  - Asserts the no-op: empty scoped status → returns `false` and **no** `git commit` command is issued.
  - Asserts `paths: []` → returns `false` and issues **no** git commands.

### 4. Rework the sweep to remove both files and persist

- In `adws/triggers/perIssueScenarioSweep.ts`:
  - Add constants: `STEP_DEF_DIR = 'features/per-issue/step_definitions'`.
  - Replace the `deleteFile` dependency with two new injectable deps on `PerIssueSweepDeps`:
    - `listStepDefSiblings?: (issueNum: number) => string[]` — existing step-def sibling paths for issue N.
    - `persistRemoval?: (paths: readonly string[]) => void` — `git rm` + scoped commit + push (batch).
  - Change `defaultListFeatures` to list **tracked** files via `GitContext`:
    - `const ctx = gitContextForRepo(getRepoInfo());`
    - `return ctx.lsFiles(ctx.basePath, PER_ISSUE_DIR).filter(p => FEATURE_FILENAME_RE.test(path.basename(p)));`
    - Wrap in try/catch → `[]` (fail-open), matching the module's existing resilience posture.
  - Add `defaultListStepDefSiblings(issueNum)`: `gitContextForRepo(getRepoInfo()).lsFiles(ctx.basePath, STEP_DEF_DIR)` filtered to `path.basename(p).startsWith(\`feature-${issueNum}.\`)`; try/catch → `[]`.
  - Add `defaultPersistRemoval(paths)`:
    - Guard: `if (paths.length === 0) return;`
    - `const ctx = gitContextForRepo(getRepoInfo()); const branch = ctx.defaultBranch();`
    - Branch guard: `if (ctx.getCurrentBranch(ctx.basePath) !== branch) { log(warn 'checkout not on default branch'); return; }`
    - `const committed = ctx.removeAndCommitPaths(paths, 'chore: sweep stale per-issue scenarios (>14d post-merge)', ctx.basePath);`
    - `if (committed) ctx.pushBranch(branch, ctx.basePath);`
    - Wrap the whole body in try/catch → log a `'warn'` message; **never rethrow** (keep the cron loop alive).
  - Rewrite `runPerIssueScenarioSweep`:
    - Resolve `now`, `listFeatures`, `getMergedAt`, `listStepDefSiblings`, `persistRemoval`, `logger` from deps with the defaults above.
    - Iterate `listFeatures()`; keep the unrecognised-filename skip (`warn`) and the `getMergedAt` try/catch skip (`warn`).
    - For each stale file: compute `const siblings = listStepDefSiblings(issueNum);`, log an `'info'` line naming the feature + sibling count, and push `filePath` and `...siblings` into a `toRemove: string[]`.
    - After the loop: `if (toRemove.length === 0) return [];` (no-op guard — no persistence, no commit). Otherwise `persistRemoval(toRemove); return toRemove;`.
  - Delete `defaultDeleteFile` and drop the now-unused `fs` import **only if** `fs` is otherwise unused (it will be — listing moves to `GitContext.lsFiles`). Keep `path` (used for `basename`). Keep the `isScenarioStale` pure predicate unchanged.
  - Respect coding guidelines: guard clauses first, max ~2 nesting levels, side effects only inside the `default*` boundary functions, `readonly` on the `paths` params.

### 5. Update the sweep unit tests

- In `adws/triggers/__tests__/perIssueScenarioSweep.test.ts`:
  - Keep the `isScenarioStale` truth-table block unchanged.
  - Replace the `deleteFile` assertions with `persistRemoval` + `listStepDefSiblings` injection:
    - **(a) both files removed:** stale issue N with `listStepDefSiblings(N) => ['features/per-issue/step_definitions/feature-N.steps.ts']` → assert `persistRemoval` called once with `['features/per-issue/feature-N.feature', 'features/per-issue/step_definitions/feature-N.steps.ts']`, and the returned array equals that batch.
    - **(b) removal is committed (persistence invoked):** assert `persistRemoval` is called exactly once for a non-empty stale set (the commit path). Optionally assert a spy `persistRemoval` that forwards to a fake `removeAndCommitPaths` returning `true` triggers `pushBranch`.
    - **(c) no-op:** all files fresh/unmerged → assert `persistRemoval` is **not** called and the sweep returns `[]`.
    - Keep: fresh/unmerged files left alone; `getMergedAt` rejection does not abort others (`warn`); unrecognised filename skipped (`warn`).
    - Update the "default routes through gitContextForRepo" test to reflect the new default listing/persistence (mock `gitContextForRepo` to return a ctx exposing `lsFiles`, `defaultBranch`, `getCurrentBranch`, `removeAndCommitPaths`, `pushBranch`, `fetchMergedPRs` as needed), asserting `lsFiles` is used for discovery and `removeAndCommitPaths`/`pushBranch` for persistence when on the default branch.
  - Adjust the hoisted `fs`/`gitContextFactory` mocks so the default paths no longer depend on `fs.readdirSync`/`fs.rmSync`.

### 6. Add the BDD regression scenario (`@adw-735`)

- Create `features/per-issue/feature-735.feature`:
  - Header tags `@adw-735 @adw-qwfm4x-bug-per-issue-scenar` and a `Feature:` describing the persistent, sibling-aware sweep, plus a short observability/rot-prevention note (assert produced git artefacts only; no source-text reads), mirroring `feature-648`.
  - Scenario A — stale scenario is removed and persisted: Given a fixture repo with a bare origin on the default branch containing `feature-N.feature` + `feature-N.steps.ts` committed, and issue `#N` merged > 14 days ago; When the sweep runs; Then both files are absent from the tracked file set, a new commit exists on the default branch, and the origin default-branch tip advanced with both files absent from its tree.
  - Scenario B — fresh scenario preserved: a `< 14 day` issue's feature + step-def files remain tracked and no commit removing them exists.
  - Scenario C — no-op: with nothing stale, the sweep creates no new commit (default-branch tip unchanged).
- Create `features/per-issue/step_definitions/feature-735.steps.ts` modeled on `feature-648.steps.ts`:
  - Fixture builder: `git init --bare` origin + `git clone`, configure identity, commit the per-issue files on the default branch, `git push -u origin HEAD`.
  - Driver (When): call `runPerIssueScenarioSweep({ now, listFeatures, getMergedAt, listStepDefSiblings, persistRemoval })` where `listFeatures`/`listStepDefSiblings` enumerate the fixture's files, `getMergedAt`/`now` set staleness, and `persistRemoval` builds a fixture-scoped `GitContext` (real `frameworkRepoRoot`) and calls the production `removeAndCommitPaths` + `pushBranch`.
  - Assertions (Then): `git ls-files` membership in the fixture and `git ls-tree`/`git rev-parse` against the bare origin — all git artefacts.
  - `After({ tags: '@adw-735' })` removes temp dirs.
- Follow the vocabulary contract: prefer registered phrases where they exist; introduce novel phrases only as needed (as `feature-648` did) and keep them artefact-oriented.

### 7. Confirm the cron call site needs no change

- Re-read `adws/triggers/trigger_cron.ts:212-215`. Confirm the sweep remains fail-open (persistence never throws) so the unwrapped `await runPerIssueScenarioSweep()` cannot crash `checkAndTrigger()`. No edit expected; note this explicitly in the implementation summary.

### 8. Run the full validation suite

- Run every command in **Validation Commands** and ensure each passes with zero regressions, including the raw-git guard (proving the sweep contains no raw `git`/`gh` strings) and the new `@adw-735` scenario (RED before the fix, GREEN after).

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions. Commands are from `.adw/commands.md`.

- `bun install` — ensure dependencies are present (no new library required).
- `bun run lint` — linter passes (code hygiene: no unused `fs` import / `defaultDeleteFile`).
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (new `GitContext.removeAndCommitPaths` typing, `readonly string[]` params).
- `bunx tsx adws/checkGitGhGuard.ts` — **must exit 0**: proves `adws/triggers/perIssueScenarioSweep.ts` has no raw `git`/`gh` shell-outs (all git work routes through `GitContext`); the only new raw git lives in the exempt `adws/gitContext/` package and in the guard-exempt `features/` step defs.
- `bun run test:unit` — all vitest unit tests pass, including the updated `perIssueScenarioSweep.test.ts` (both-files-removed, persistence-invoked, no-op) and the new `commitOps.removeAndCommitPaths` tests.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-735"` — the new BDD scenario passes (both files removed from the index, removal committed and pushed to the default-branch origin, no-op leaves the tip unchanged). This is the end-to-end reproduction: it is RED on the current `fs.rmSync`-only code and GREEN after the fix.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite still green (no collateral breakage).

## Notes

- **No new library required.** If one were ever needed, `.adw/commands.md` `## Library Install Command` is `bun add <package>`.
- **Coding guidelines (`.adw/coding_guidelines.md`) are in force.** Keep `isScenarioStale` pure; isolate all git/fs side effects inside the `default*` boundary functions; use guard clauses and ≤2 nesting levels; prefer `readonly` params; remove the now-dead `fs` import / `defaultDeleteFile`. Files stay well under 300 lines. Note the guideline caveat that ADW treats BDD scenarios as the primary quality gate — but this repo has `## Unit Tests: enabled` in `.adw/project.md`, and the issue explicitly asks for unit **and** BDD coverage, so both are included.
- **Raw-git guard is the key architectural constraint.** `adws/triggers/**` is scanned; only `adws/gitContext/**` (and `features/`, `test/`, etc. directory names) are exempt. That is why the scoped `git rm`/commit primitive is added inside `adws/gitContext/commitOps.ts` and surfaced as a `GitContext` method, rather than shelled out from the sweep. Do not add raw `git`/`gh` strings to the sweep.
- **Why `lsFiles` (index) instead of `readdirSync` (working tree):** deciding staleness on tracked files makes the sweep idempotent and self-healing — it re-lists and commits the 67 pre-existing already-`rmSync`'d-but-uncommitted deletions on the first fixed run, satisfying "a clean cron run leaves no uncommitted working-tree deletions." A working-tree-only listing would never see those already-deleted files again and could never clean them up.
- **Why a scoped commit, not `commitChanges`:** `commitChanges` is `git add -A` and would commit any unrelated dirty state on the cron host. `removeAndCommitPaths` uses `git commit -- <paths>` so only the swept scenario/step-def paths are committed.
- **Branch-guard + fail-open:** the default persistence only commits/pushes when the self-host checkout is actually on the default branch, and never throws (it logs a warning), so a transient git/gh failure cannot crash the cron loop. Because `pushBranch` pushes the entire default-branch ref, a one-off push failure self-heals on the next sweep that finds anything stale.
- **Out of scope (do NOT implement here):** whether 14-day auto-deletion should happen at all given per-issue scenarios' human-curated promotion value (issue #734 direct-relocation decision). This fix makes the sweep correct and persistent only; it must not change `RETENTION_DAYS` or disable the sweep. The promotion-vs-retention race is a separate policy question for human triage — flag it in the PR description, do not encode a policy change here.
- **Commit-message convention:** the removal commit message (`chore: sweep stale per-issue scenarios (>14d post-merge)`) is deliberately generic and contains no issue number, since a single sweep may remove scenarios for many issues at once.
