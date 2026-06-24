# Feature: GitContext — migrate promotion-sweep PR ops

## Metadata
issueNumber: `697`
adwId: `ebd8l3-gitcontext-migrate-p`
issueJson: `{"number":697,"title":"GitContext: migrate promotion-sweep PR ops","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md`\n\n## What to build\nMigrate adwPromotionSweep's `gh pr view/create` + git ops onto GitContext (`createPR` exists; add PR view as needed), removing its ALLOWLIST entry.\n\n## Acceptance criteria\n- [ ] adwPromotionSweep routes through GitContext (no raw gh/git)\n- [ ] Removed from `ALLOWLIST`\n- [ ] `lint:git-guard` passes; tests green\n\n## Blocked by\n- Blocked by #696\n\n## Touched Files\n- adws/gitContext/gitContext.ts\n- adws/adwPromotionSweep.tsx\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 5\n- User story 18","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-23T11:45:30Z","comments":[],"actionableComment":null}`

## Feature Description

This is one slice of the **GitContext repo-context authority** epic (parent PRD: `specs/prd/git-context-repo-authority.md`). The PRD makes a single `GitContext` deep module the sole authority for "which repo's filesystem/remote" a git/`gh` command targets, injecting per-command auth and an explicit `cwd` through one private `#run()` chokepoint so a call site can never silently shell out against the wrong repository (the recurring "wrong-base-repo" / `GH_TOKEN`-bleed bug class that has caused ~13 incidents). A CI guard (`adws/checkGitGhGuard.ts`, run as `lint:git-guard`) structurally forbids raw `git `/`gh ` shell-outs outside the `adws/gitContext/` package; files not yet migrated sit on an `ALLOWLIST` that shrinks slice by slice.

`adws/adwPromotionSweep.tsx` — the CLI orchestrator for the scenario-promotion mechanism (commenter pass + regression-promotion mover pass) — is the **last residual** allowlisted file. It still issues **three** raw `execWithRetry` shell-outs:

1. **`gh pr view <n> --json files`** (`fetchChangedFilesFromPR`) — the PR changed-file lookup that *both* the commenter and the mover depend on.
2. **`gh pr create … --label …`** (the mover's `createPR` dep) — opens the regression-promotion PR, hand-building the command (temp body-file, double-quote escaping, URL→number parse).
3. **`git log …` ×2** (`loadStats` → `promotionStatsLoader`'s auto-ramp numerator/denominator `git log` queries) — shelled out with a bare `process.cwd()`, an instance of the wrong-base-repo bug the epic exists to kill.

This slice routes all three onto `GitContext`: it adds a small **PR-changed-files view** method and a **bounded `git log --since` read** method, extends the existing `createPR` to carry **labels**, rewires the three dep-builders in `adwPromotionSweep.tsx` to call the context (the mover already uses `gitCtx.defaultBranch`/`createWorktreeForNewBranch`/`commitChanges`/`pushBranch`), and removes `adws/adwPromotionSweep.tsx` from the guard `ALLOWLIST`. After this slice the `ALLOWLIST` contains only permanent bootstrap/diagnostic entries — the residual-migration category is empty.

The value: the promotion sweep's PR and stats operations gain correct per-command auth + git identity + `cwd`; the `git log` wrong-`cwd` bug is fixed (the stats reads now run against the authoritative context base path); the temp-file PR-body dance is deleted; and the guard's allowlist shrinks to zero residual entries — without opening any free-form `git`/`gh` escape hatch on `GitContext`.

## User Story

As an ADW maintainer (PRD user stories 5 and 18)
I want `adwPromotionSweep`'s `gh pr view`, `gh pr create`, and `git log` operations to route through `GitContext`, and the file removed from the git-guard allowlist
So that git identity, auth token, and `cwd` are always correct for the promotion sweep's PR/stats operations, and it becomes impossible to reintroduce the wrong-repo class of bug from this orchestrator.

## Problem Statement

`adws/adwPromotionSweep.tsx` is the final file on the `checkGitGhGuard.ts` `ALLOWLIST` in the "residual — migrate to GitContext methods (follow-up)" category. It bypasses `GitContext` at three sites:

- **`fetchChangedFilesFromPR`** runs `execWithRetry(`gh pr view ${prNumber} --repo … --json files`)`. No GitContext method exposes `gh pr view --json files` yet (`fetchPRDetails` requests a different JSON field set), so this is the "add PR view as needed" the issue calls for.
- **The mover's `createPR` dep** hand-builds `gh pr create --title "…" --body-file "<tmp>" --base … --head … --repo … --label "…"`, including a temp-file write/unlink, manual double-quote escaping, and a URL→number regex. `GitContext.createPR` already exists but takes no labels, so the mover cannot use it as-is.
- **`loadStats`** injects `runGit: (args, opts) => execWithRetry(`git ${args}`, opts)` with `cwd: process.cwd()` into `promotionStatsLoader`. In the long-lived cron process whose `process.cwd()` is the ADW **framework** repo (not the target), the two `git log` queries resolve against the wrong working tree — so the auto-ramp threshold's numerator (promotion-commit count) and denominator (per-issue scenario additions) are computed against the wrong repository's history.

All three are literal `gh `/`git ` command strings that the guard flags, so the file cannot leave the `ALLOWLIST` until they route through `GitContext`. Until it does, the guard cannot enforce repo-context authority over the promotion sweep, and the epic's allowlist still carries a residual entry.

## Solution Statement

Mirror the established migration pattern from the immediately-preceding slices (#691–#696): extend the `GitContext` surface with thin, **named, bounded** methods (command strings live in the guard-exempt `adws/gitContext/` package), route the consumer through them, and shrink the `ALLOWLIST`.

1. **Add a PR-changed-files view to `GitContext`.** Add `prChangedFilesCmd(owner, repo, prNumber)` → `gh pr view <n> --repo <o>/<r> --json files` to `adws/gitContext/commands/prCommands.ts`, and a thin `GitContext.fetchPRChangedFiles(prNumber): string` method routing through `#run()` (returns raw JSON, parsed by the caller — exactly like the sibling `fetchPRDetails`/`fetchPRList`). Runs at the context base path.

2. **Extend `createPR` with optional labels.** Add an optional `labels?: readonly string[]` parameter to `createPRCmd` (append `--label '<l>'` per label) and to `GitContext.createPR(title, body, headBranch, baseBranch?, labels?)`. Backward-compatible: the only other caller (`adws/providers/github/githubCodeHost.ts`) passes four args and is unaffected.

3. **Add a bounded `git log --since` read to `GitContext` — not a free-form git passthrough.** Add `gitReadOps.logSince(run, opts, cwd)` and `GitContext.logSince(opts, cwd?): string`, where `opts` is a **fixed, closed flag vocabulary** — `{ since: string; grep?: string; oneline?: boolean; patch?: boolean; pathspec?: string }` — that can only ever assemble a `git log` command. This is the design-critical choice: a generic `gitLogRead(args: string)` that runs `git ${args}` would be the first arbitrary-git escape hatch in the entire epic (any future `ctx.gitLogRead('reset --hard origin/main')` would run unflagged, defeating the guard the epic exists to enforce). A bounded `logSince` keeps `GitContext` structurally incapable of running anything but a `git log` read, in keeping with every focused method added in #658–#696.

4. **Rebacker the promotion-stats seam (one consumer) onto the bounded method.** `promotionStatsLoader`'s `runGit(args, { cwd })` dependency is a *free git-command-string* seam — it cannot call a bounded `logSince(opts)` without a generic bridge. Replace it with a structured `gitLogSince: (opts: LogSinceOptions) => string` dependency: the loader keeps **all** of its pure parsing (commit counting, `+ Scenario:` counting, the 90-day `since`, the warn-and-return-0 guards) and merely builds two **option objects** instead of two arg strings. The two assembled commands are byte-for-byte identical to today's. Blast radius is exactly one module + its own unit test, because `loadPromotionStats` has one production caller (`adwPromotionSweep`).

5. **Rewire `adwPromotionSweep.tsx` through the existing `gitCtx`.** `main()` already builds one context (`gitContextFor({ owner, repo, selfHost: true })`) and threads it into `buildMoverDeps`. Thread the same `gitCtx` into `buildCommenterDeps`, and:
   - `fetchChangedFilesFromPR(prNumber, gitCtx)` → `gitCtx.fetchPRChangedFiles(prNumber)`.
   - mover `createPR` dep → `gitCtx.createPR(title, body, head, base, labels)`, parsing the number from the returned URL (delete the temp-file/`os.tmpdir()` block).
   - commenter `loadStats` → `loadPromotionStats({ gitLogSince: (opts) => gitCtx.logSince(opts), perIssueGlob, now, log })` (the base-path `cwd` default fixes the wrong-`cwd` bug).
   - Drop the now-unused `execWithRetry` and `os` imports.

6. **Tighten the guard.** Remove `'adws/adwPromotionSweep.tsx'` from the `ALLOWLIST` in `adws/checkGitGhGuard.ts`. The residual category is now empty (leave only the bootstrap and diagnostic entries).

The new code paths inherit per-command auth + git identity + explicit `cwd` for free because every method delegates through the same `#run()` chokepoint. The pre-existing `@adw-697` BDD feature file (`features/per-issue/feature-697.feature`) is the RED contract this plan must turn GREEN.

## Relevant Files

Use these files to implement the feature:

### Files to modify
- `adws/gitContext/commands/prCommands.ts` — pure `gh` command-string builders (guard-exempt package). Add `prChangedFilesCmd(owner, repo, prNumber)`; extend `createPRCmd` with an optional `labels?: readonly string[]` final parameter appending `--label '<l>'` per label.
- `adws/gitContext/gitReadOps.ts` — package-private git-read op module. Add `logSince(run, opts, cwd)` with the bounded `LogSinceOptions` flag vocabulary; export the `LogSinceOptions` type; add `logSince` to the exported `gitReadOps` object.
- `adws/gitContext/index.ts` — re-export the `LogSinceOptions` type so the promotion-stats loader can import it type-only.
- `adws/gitContext/gitContext.ts` — the `GitContext` deep module. Add `fetchPRChangedFiles(prNumber): string` (delegates to `prChangedFilesCmd` via `#run`); extend `createPR` with the optional `labels` parameter (pass through to `createPRCmd`); add `logSince(opts, cwd?): string` (delegates to `gitReadOps.logSince`, defaulting `cwd` to `this.#basePath`). Import `prChangedFilesCmd` and the `LogSinceOptions` type.
- `adws/promotion/promotionStatsLoader.ts` — replace the `runGit: (args, { cwd }) => string` + `cwd` deps on `PromotionStatsLoaderDeps` with a structured `gitLogSince: (opts: LogSinceOptions) => string`; rewrite `countPromotionCommits`/`countPerIssueScenarioAdditions` to build option objects. Keep `perIssueGlob`, `now`, `log`, `isoDateMinus90Days`, and both pure parsers unchanged.
- `adws/adwPromotionSweep.tsx` — the orchestrator. Thread `gitCtx` into `buildCommenterDeps`; rewrite `fetchChangedFilesFromPR` to take `gitCtx` and call `fetchPRChangedFiles`; rewrite the mover `createPR` dep to call `gitCtx.createPR(...)`; rewrite the commenter `loadStats` dep to inject `gitLogSince: (opts) => gitCtx.logSince(opts)`; remove the `execWithRetry` and `os` imports.
- `adws/checkGitGhGuard.ts` — remove the single `'adws/adwPromotionSweep.tsx'` `ALLOWLIST` entry (and its trailing comment + the now-empty "residual" comment block).

### Files to read for pattern (do not necessarily modify)
- `adws/gitContext/commands/prCommands.ts` — existing `fetchPRDetailsCmd`/`createPRCmd` shape; the `--head` explicit-design comment on `createPRCmd` (why `gh pr create` need not run from the worktree).
- `adws/gitContext/commands/labelCommands.ts` — `applyLabelCmd` uses `--add-label '<name>'`; mirror that single-quote label form in `createPRCmd`.
- `adws/gitContext/gitReadOps.ts` — `Runner` type + `lsFiles`/`headShort`/`diff`/`log` shape; `logSince` is a direct sibling (the existing `log` is a fixed-format `git log "<branch>"`; `logSince` is the bounded `--since` variant the stats queries need).
- `adws/gitContext/remoteOps.ts` — the #696 addition; canonical example of how thin a new op + method pair is (the `lsRemote` `cwd ?? base` default mirrors `logSince`).
- `adws/github/prApi.ts` — `defaultFindPRByBranch`/`commentOnPR`/`fetchPRDetails` already route through `gitContextForRepo(...)`; confirms the function-call form is **not** a guard violation (only literal `gh `/`git ` strings are).
- `adws/promotion/promotionStatsLoader.ts` — the `runGit` seam being rebacked and the two `git log` arg strings (`log --since=… --grep=…`, `log --since=… -p -- <glob>`) `logSince` must reproduce byte-for-byte.
- `adws/promotion/promotionMover.ts` — `PromotionMoverDeps.createPR(opts) => { number, url }` contract the rewired dep must still satisfy (**interface unchanged**; the adapter ignores the now-unused `opts.cwd`).
- `adws/promotion/promotionCommenter.ts` — `PromotionCommenterDeps` (`fetchChangedFiles`, `loadStats`) the rewired commenter dep must still satisfy.
- `adws/providers/github/githubCodeHost.ts` — line 92 `ctx.createPR(title, body, source, target)` (4 args); confirms the new `labels` parameter must be optional and the URL-string return is preserved.
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — `makeSpyExec()` + `validOptions()` helpers used to assert command string, `cwd`, stdin `input`, and injected env for new methods.
- `adws/gitContext/__tests__/gitReadOps.test.ts` — fake-`Runner` op-test shape to mirror for `logSince`.
- `adws/promotion/__tests__/promotionStatsLoader.test.ts` — the 6-case loader test to rewrite for the structured `gitLogSince` seam.
- `features/per-issue/feature-697.feature` — the pre-existing `@adw-697` RED scenario contract (the new methods + de-allowlisting must make it GREEN).
- `specs/issue-696-adw-vl60su-gitcontext-migrate-g-sdlc_planner-migrate-fetch-merge-lsremote-ops.md` — the immediately-preceding slice; mirror its new-op-module + thin-method + ALLOWLIST-removal structure.
- `specs/prd/git-context-repo-authority.md` — parent PRD (user stories 5, 18; the `#run` chokepoint / no-cwd-fallback contract).

### Conditional docs (matched against `.adw/conditional_docs.md`)
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns `adws/gitContext/**`, `commands/**`, `gitContextFactory.ts`; conditions explicitly cover "adding a new `gh` operation method to `GitContext` (follow the thin-method + package-private-op pattern)" and the #691–#696 migration precedent.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — owns `adws/checkGitGhGuard.ts`; conditions cover "migrating a residual allowlisted file to GitContext methods and removing it from the ALLOWLIST" and the `lint:git-guard` remedy.
- `app_docs/feature-y8r69q-auto-ramping-promotion-threshold.md` — conditions cover `loadPromotionStats`/`PromotionStatsLoaderDeps` and the `loadStats` dep injection (the `runGit` → `gitLogSince` seam refactor).
- `app_docs/feature-2wrg9y-promotion-mover-regression-pr.md` — `runPromotionMover` / regression-promotion PR and "wiring new I/O dependencies into `buildMoverDeps` in `adwPromotionSweep.tsx`" (the mover `createPR`/`fetchChangedFiles` deps).
- `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` — `runPromotionCommenter` / commenter deps and the `adwPromotionSweep.tsx` orchestrator key.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — how the single launch-boundary `GitContext` (`gitContextFor`) is built and threaded (the `gitCtx` reused here).

### New Files
- _None._ All new command/op code lives in existing files inside the guard-exempt `adws/gitContext/` package; the BDD feature file already exists. Tests extend existing files (see Testing Strategy).

## Implementation Plan

### Phase 1: Foundation — extend the GitContext surface
Add the additive, backward-compatible surface pieces. All break nothing and can land/unit-test before any call-site change.
- `prChangedFilesCmd` + `GitContext.fetchPRChangedFiles` — the new PR view.
- `createPRCmd` optional `labels` + `GitContext.createPR` optional `labels` — extend the existing PR-create surface.
- `gitReadOps.logSince` (bounded flag vocabulary) + `GitContext.logSince` — the `git log --since` read (cwd defaults to base path); export `LogSinceOptions`.

### Phase 2: Core Implementation — reback the stats seam and route the orchestrator through GitContext
- Reback `promotionStatsLoader`'s `runGit` seam onto a structured `gitLogSince(opts)` dep (pure parsing untouched; commands byte-identical).
- Rewire the three dep-builders in `adwPromotionSweep.tsx` to call `gitCtx`, reusing the context already constructed in `main()`. Delete the temp-file PR-body block and the `execWithRetry`/`os` imports.

### Phase 3: Integration — enforce via the guard and validate
Remove the `ALLOWLIST` entry, confirm `lint:git-guard` passes with the file now scanned (`scannedCount` includes it, zero violations), align the `@adw-697` step definitions, and run the full validation suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add the PR-changed-files command builder + method
- In `adws/gitContext/commands/prCommands.ts`, add:
  `export function prChangedFilesCmd(owner: string, repo: string, prNumber: number): string { return `gh pr view ${prNumber} --repo ${owner}/${repo} --json files`; }`
- In `adws/gitContext/gitContext.ts`, add `prChangedFilesCmd` to the existing `./commands/prCommands` import, and add the method beside `fetchPRDetails`:
  `fetchPRChangedFiles(prNumber: number): string { return this.#run(prChangedFilesCmd(this.#owner, this.#repo, prNumber)); }`

### 2. Extend `createPR` with optional labels
- In `prCommands.ts`, change `createPRCmd` to accept an optional final `labels?: readonly string[]` and append one `--label '<l>'` per label (single-quoted, mirroring `applyLabelCmd`):
  build `const labelArgs = (labels ?? []).map(l => ` --label '${l}'`).join('');` and append it after `baseArg`. Keep the existing `--head` comment.
- In `gitContext.ts`, change `createPR` to `createPR(title: string, body: string, headBranch: string, baseBranch?: string, labels?: readonly string[]): string` and pass `labels` through to `createPRCmd(...)`. The `{ input: body }` stdin form is unchanged.

### 3. Add the bounded `git log --since` read op + method
- In `adws/gitContext/gitReadOps.ts`, add and export the flag vocabulary type:
  `export interface LogSinceOptions { since: string; grep?: string; oneline?: boolean; patch?: boolean; pathspec?: string; }`
- Add `function logSince(run: Runner, opts: LogSinceOptions, cwd: string): string` that assembles the command in the existing order — base `git log`, `--since="<since>"`, optional `--grep="<grep>"`, then `--no-merges`, optional `--oneline`, optional `-p`, and (when `pathspec`) a trailing ` -- <pathspec>` — then `return run(cmd, cwd)`. Use array-push/filter assembly (no deep nesting) per the coding guidelines. Add `logSince` to the exported `gitReadOps` object with a one-line doc comment (bounded `git log --since` read; only assembles a log command).
- Re-export `LogSinceOptions` from `adws/gitContext/index.ts`.
- In `gitContext.ts` (in the `// ── Git read ops ──` section), add:
  `logSince(opts: LogSinceOptions, cwd?: string): string { return gitReadOps.logSince((cmd, c) => this.#run(cmd, { cwd: c }), opts, cwd ?? this.#basePath); }`
  and import the `LogSinceOptions` type from `./gitReadOps`.

### 4. Reback the promotion-stats loader seam
- In `adws/promotion/promotionStatsLoader.ts`, import the `LogSinceOptions` type (type-only, from `../gitContext`). Replace `runGit` + `cwd` on `PromotionStatsLoaderDeps` with `gitLogSince: (opts: LogSinceOptions) => string`.
- Rewrite `countPromotionCommits` to call `deps.gitLogSince({ since: isoSince, grep: '^regression-promotion:', oneline: true })` and `countPerIssueScenarioAdditions` to call `deps.gitLogSince({ since: isoSince, patch: true, pathspec: deps.perIssueGlob })`. Keep both `try/catch` warn-and-return-0 contracts and the pure parsing (`.split('\n').filter(...)`, `.match(/^\+\s*Scenario:/gm)`) verbatim.

### 5. Unit-test the new GitContext surface
- In `adws/gitContext/__tests__/gitReadOps.test.ts`, add `logSince` cases against a fake recording `Runner`: `{ since, grep, oneline }` → `git log --since="<since>" --grep="<grep>" --no-merges --oneline`; `{ since, patch, pathspec }` → `git log --since="<since>" --no-merges -p -- <pathspec>`; bare `{ since }` → `git log --since="<since>" --no-merges`; assert the recorded `cwd` and returned output.
- In `adws/gitContext/__tests__/gitContextOperations.test.ts`, add `describe` blocks (using `makeSpyExec()` + `validOptions()`):
  - `fetchPRChangedFiles(7)` issues `gh pr view 7 --repo acme/webapp --json files`, `cwd` === base path, env carries `GH_TOKEN` + `GIT_AUTHOR_*` (covers feature-697 §1a).
  - `createPR(title, body, head, base, ['regression-promotion'])` issues a command containing `gh pr create`, `--head "<head>"`, `--label 'regression-promotion'`, passes `body` as stdin `input`, token present (covers §1b); and `createPR(title, body, head)` (no labels) emits **no** `--label` (backward-compat).
  - `logSince({ since:'X', grep:'^regression-promotion:', oneline:true })` issues `git log --since="X" --grep="^regression-promotion:" --no-merges --oneline`, `cwd` === base path (default), token + identity present (covers §1c); and `logSince(opts, '/some/wt')` honors an explicit cwd.

### 6. Rewrite the promotion-stats loader test for the new seam
- In `adws/promotion/__tests__/promotionStatsLoader.test.ts`, change `makeDeps` to provide `gitLogSince: vi.fn().mockReturnValue('')` (drop `runGit`/`cwd`). Update the happy-path mocks to branch on the **options object** (`opts.grep` for the numerator, `opts.patch` for the denominator) instead of `args.includes('--grep')`/`args.includes('-p')`. Rewrite case (e) to assert `gitLogSince` was called with `{ since: EXPECTED_SINCE, grep: '^regression-promotion:', oneline: true }`. Preserve cases (a)–(f) behavioral intent (counts 2 / 3, empty → {0,0}, throw → {0,0}, `+`-lines only).

### 7. Rewire `fetchChangedFilesFromPR` (commenter + mover shared)
- In `adws/adwPromotionSweep.tsx`, change the signature to `fetchChangedFilesFromPR(prNumber: number, gitCtx: GitContext)` and the body to parse `gitCtx.fetchPRChangedFiles(prNumber)` (drop the `repoInfo`/`execWithRetry` use; the JSON shape `{ files: [...] }` and the modified/removed mapping are unchanged).
- Update both call sites: `buildCommenterDeps` and `buildMoverDeps` now pass `gitCtx` to `fetchChangedFilesFromPR`.

### 8. Thread `gitCtx` into `buildCommenterDeps` and rewire `loadStats`
- Add `gitCtx: GitContext` to `buildCommenterDeps(...)`; pass it at the `main()` call site.
- `fetchChangedFiles: async () => fetchChangedFilesFromPR(prNumber, gitCtx)`.
- Rewrite `loadStats` to inject the bounded reader and drop `runGit`/`cwd`:
  `loadStats: () => loadPromotionStats({ gitLogSince: (opts) => gitCtx.logSince(opts), perIssueGlob, now: () => new Date(), log: (msg, level) => log(msg, (level ?? 'info') as LogLevel) })`.

### 9. Rewire the mover `createPR` dep
- In `buildMoverDeps`, replace the `createPR` closure body with:
  ```ts
  createPR: (opts) => {
    const url = gitCtx.createPR(opts.title, opts.body, opts.head, opts.base, opts.labels);
    const match = /\/pull\/(\d+)$/.exec(url);
    return { number: match ? parseInt(match[1], 10) : 0, url };
  },
  ```
- Delete the temp-file block (`os.tmpdir()`, `fs.writeFileSync`, `fs.unlinkSync`) and the manual `--label`/double-quote string assembly. (`opts.cwd` is no longer needed — `createPR` runs at the context base path with explicit `--head`/`--repo`; see Notes. `PromotionMoverDeps.createPR` keeps its `cwd` field — the adapter just ignores it, so `promotionMover.ts` is untouched.)

### 10. Remove the dead imports
- In `adwPromotionSweep.tsx`, remove `execWithRetry` from the `./core/index.ts` import (keep `log`, `LogLevel`) and remove `import * as os from 'os';`. Keep `fs` (still used by mover `readFile`/`writeFile`) and `path` (still used by mover `writeFile` `path.dirname`).

### 11. Remove the `ALLOWLIST` entry
- In `adws/checkGitGhGuard.ts`, delete the `'adws/adwPromotionSweep.tsx'` line (and its trailing comment). Remove the now-empty `// residual — migrate to GitContext methods (follow-up)` comment block so only bootstrap + diagnostic categories remain.

### 12. Run the git/gh guard
- Run `bun run lint:git-guard`. Confirm `adws/adwPromotionSweep.tsx` is now in the scanned set (the report's scanned count includes it) and there are **zero** violations.

### 13. Align the `@adw-697` step definitions
- Generate/align step definitions for `features/per-issue/feature-697.feature` so the scenario test phase drives them. Map the abstract ops to the new surface: `"pr-changed-files"` → `fetchPRChangedFiles`, `"pr-create"` → `createPR` (with a label), `"stats-log"` → `logSince`. §1d reuses the `"pr-changed-files"` op but additionally snapshots the parent `process.env` before the op and asserts it is byte-for-byte unchanged afterward (the `#run` per-command-auth isolation property — auth/identity go into the child env only, the parent process env is never mutated). The guard scenarios (§2/§3) drive `scanFiles`/the guard run; the type-check scenario (§4) drives `tsc`. Keep assertions behavioral (recorded child-env token/identity, recorded `cwd`, the parent-env-unchanged snapshot, guard `scannedCount`/violations, `tsc` exit) per the scenario rot-prevention rule — do not assert source structure.

### 14. Run all Validation Commands
- Execute every command in the `Validation Commands` section below and confirm each exits cleanly with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **`adws/gitContext/__tests__/gitReadOps.test.ts` (extend)** — pure `logSince` tests against a fake recording `Runner`: the numerator shape (`grep` + `oneline`), the denominator shape (`patch` + `pathspec`), and the bare-`since` shape; assert the assembled command string, the passed `cwd`, and that the runner output is returned verbatim. Mirrors the existing `lsFiles`/`diff`/`log` cases.
- **`adws/gitContext/__tests__/gitContextOperations.test.ts` (extend)** — for `fetchPRChangedFiles`, `createPR` (with and without labels), and `logSince`, use `makeSpyExec()` to assert: the exact `gh `/`git ` command string, `cwd` (base path by default; explicit cwd honored for `logSince`), the stdin `input` for `createPR`, and the injected child env (`GH_TOKEN`, `GIT_AUTHOR_*`). These prove the new methods inherit the `#run` auth/cwd chokepoint (the observable behavior the feature-697 §1 scenarios assert).
- **`adws/promotion/__tests__/promotionStatsLoader.test.ts` (rewrite)** — switch from the free-string `runGit` seam to the structured `gitLogSince(opts)` dep; assert the loader builds the correct option objects (numerator `{ grep, oneline }`, denominator `{ patch, pathspec }`) and preserves all counting/error behavior (cases a–f).
- **`adws/promotion/__tests__/promotionMover.test.ts` / `promotionCommenter.test.ts` (verify unchanged)** — the `PromotionMoverDeps.createPR => { number, url }` and `PromotionCommenterDeps.fetchChangedFiles`/`loadStats` shapes are unchanged, so the pure promotion-module tests stay green.
- **No orchestrator-level test for `adwPromotionSweep.tsx`** — it is a thin `main()` CLI wrapper with no exported pure logic; behavior is covered by the deep-module tests above plus the `@adw-697` BDD scenarios (which exercise the real `GitContext` methods and the real guard).

### Edge Cases
- **`createPR` with no labels** — `githubCodeHost.ts` (4-arg call) and any future caller omitting `labels` emit no `--label` flag (backward-compatible; the `?? []` guard yields an empty append).
- **PR URL → number parse miss** — if `gh pr create`'s returned URL doesn't match `/\/pull\/(\d+)$/`, the dep returns `number: 0` (identical to the pre-migration behavior, which used the same regex).
- **`logSince` default vs explicit cwd** — called without `cwd` it runs at the context base path (the §1c assertion and the wrong-`cwd` fix); called with an explicit `cwd` it honors it. For the self-host promotion sweep, base path === the former `process.cwd()`, so the command lands in the same tree — but now derived from an authoritative path, not a mutable ambient one.
- **`logSince` reproduces today's commands byte-for-byte** — numerator `git log --since="X" --grep="^regression-promotion:" --no-merges --oneline`; denominator `git log --since="X" --no-merges -p -- <glob>`. The `--no-merges` sits before `--oneline`/`-p`, matching the current arg order, so `promotionStatsLoader`'s parsers see identical output.
- **`gitLogSince` throws** (not a git repo / transient gh-less env) — the loader's existing `try/catch` returns count `0`, so the threshold falls back to bootstrap behavior exactly as before.
- **Scenario name containing a single quote** — `createPRCmd` single-quotes the title (pre-existing behavior shared with all `createPR` callers); a literal `'` in a scenario name is an unescaped edge identical to today's risk and out of scope for this slice (the mover's `slugify` only affects branch/file names, not the title).
- **`gh pr view --json files` for a PR with no file changes** — returns `{ "files": [] }`; `data.files.map(...)` yields `[]` and the commenter/mover loops are no-ops (unchanged).

## Acceptance Criteria
- [ ] `GitContext` exposes `fetchPRChangedFiles(prNumber)` (`gh pr view --json files`), a `createPR(..., labels?)` extension carrying `--label`, and a **bounded** `logSince(opts, cwd?)` (`git log --since` only — no free-form git passthrough) — each routed through the `#run()` per-command-auth chokepoint.
- [ ] `adws/adwPromotionSweep.tsx` issues zero direct `git`/`gh` shell-outs: `fetchChangedFilesFromPR` uses `fetchPRChangedFiles`, the mover `createPR` dep uses `gitCtx.createPR`, and `loadStats` injects `gitLogSince: (opts) => gitCtx.logSince(opts)`.
- [ ] `adws/promotion/promotionStatsLoader.ts` takes a structured `gitLogSince` dep (no free-string git runner) and its unit tests pass against the new seam.
- [ ] The `execWithRetry` and `os` imports are removed from `adws/adwPromotionSweep.tsx`.
- [ ] `adws/adwPromotionSweep.tsx` is removed from the `ALLOWLIST` in `adws/checkGitGhGuard.ts` (residual category now empty).
- [ ] `bun run lint:git-guard` passes (zero violations) with the file now scanned (not skipped).
- [ ] All `@adw-697` scenarios in `features/per-issue/feature-697.feature` pass.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run test:unit`, and `bun run build` all succeed with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint:git-guard` — git/gh CLI guard; MUST pass with `adwPromotionSweep.tsx` no longer allowlisted (primary acceptance gate; proves `scannedCount` now includes the file with zero violations).
- `bunx tsc --noEmit -p adws/tsconfig.json` — type-check the `adws/` project (catches the `createPR`/loader signature changes, the new imports, and any accidental import cycle; backs §4 of the feature).
- `bun run lint` — ESLint across the repo (code hygiene; flags the removed `execWithRetry`/`os` imports if any reference remains).
- `bun run test:unit` — full vitest suite (extended `gitReadOps`/`gitContextOperations` tests, rewritten `promotionStatsLoader` test, unchanged promotion-module tests).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-697"` — runs the per-issue scenario contract for this slice (the four §1 #run scenarios — §1a/§1b/§1c op token/identity/cwd plus the §1d parent-env-isolation check — the §2 de-allowlist scan, the §3 whole-repo guard pass, and the §4 type-check).
- `bun run build` — `tsc` build to verify no build errors.

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (it does), strictly adhere to it: keep each new `GitContext` method a one-line delegation; keep the command builders pure string functions; isolate side effects at the `#run` boundary; prefer the early-return/guard-clause style already in the file; remove dead imports (`execWithRetry`, `os`).
- **Library install command** (`.adw/commands.md`): `bun add <package>` if ever needed — this slice adds **no** new dependencies.
- **Why a bounded `logSince(opts)` rather than a generic `gitLogRead(args)`** — a free-string `gitLogRead(args) => git ${args}` method would keep `promotionStatsLoader` and its test byte-for-byte unchanged, but it would be the **first arbitrary-git escape hatch** in the entire #658–#696 epic: `ctx.gitLogRead('reset --hard origin/main')` (or any other subcommand) would run unflagged, since the guard only scans for literal `git `/`gh ` strings at call sites, not method calls. That directly undercuts the control this epic exists to build. A closed `LogSinceOptions` vocabulary makes `GitContext` structurally incapable of running anything but a `git log` read, matching every focused method shipped in prior slices. The cost — rebacking one injectable seam (`promotionStatsLoader.runGit` → `gitLogSince`) and rewriting its 6-case unit test — is contained (one production consumer) and mechanical (string-substring assertions become structured-option assertions, which read better). The #696 "preserve the seam" precedent does not apply here: #696 preserved a **boolean** seam (`branchExistsOnRemote → boolean`), which carries no escape-hatch risk; preserving a *free git-command-string* seam does.
- **Why extend `createPR` rather than create-then-`applyLabel`** — one atomic `gh pr create --label …` matches the pre-migration behavior (label applied at creation), avoids a second round-trip and a separate failure mode, and keeps the mover dep a single call. The `labels` parameter is optional so the existing `githubCodeHost` caller is untouched.
- **`createPR` runs at the context base path, not the worktree** — the mover previously passed `cwd: worktreePath`. With explicit `--repo` and `--head "<branch>"` (and the branch already pushed via `gitCtx.pushBranch` beforehand), `gh pr create` does not need the worktree cwd; running at the base path is correct and matches the `createPRCmd` `--head` design comment (which exists precisely to avoid cwd-based head inference). This also deletes the temp-body-file dance, since `#run` pipes the body via stdin (`--body-file -`).
- **Function calls are not guard violations** — the file keeps calling `defaultFindPRByBranch`, `commentOnPR`, and `addIssueLabel` (from `prApi`/`issueApi`), which already route through `gitContextForRepo(...)` internally. The guard flags only literal `gh `/`git ` command strings, so these are out of scope and stay as-is.
- **Import-cycle check** — `promotionStatsLoader.ts` taking a **type-only** import of `LogSinceOptions` from `adws/gitContext` adds no runtime edge and no cycle (`adws/gitContext` does not import `adws/promotion`). `adwPromotionSweep.tsx` already imports `GitContext` (type) and `gitContextFor`, and the promotion module; wiring `gitCtx.logSince` into `loadStats` adds no new module edge. `prCommands.ts`/`gitReadOps.ts` are leaf string/op modules. `tsc` will surface any regression.
- **Blocked by #696** — this slice is the final consumer migration in the epic and builds on the #696 surface-extension + ALLOWLIST-shrinking precedent (`remoteOps`/`lsRemote`); #696 is merged to `dev` (commit `2f645c3`, PR #710). After this slice the residual-migration ALLOWLIST category is empty — only permanent bootstrap (`launchGitContext`, `gitContextFactory`, `targetRepoManager`, `upgradeClaim`, `githubAppAuth`) and diagnostic (`healthCheck*`) entries remain.
- **BDD-first** — `features/per-issue/feature-697.feature` already exists (the RED contract); do not rewrite it. The implementation must make it GREEN; step definitions are generated/aligned in Task 13 and frozen by the Gherkin-freeze guard during the fix loop.
