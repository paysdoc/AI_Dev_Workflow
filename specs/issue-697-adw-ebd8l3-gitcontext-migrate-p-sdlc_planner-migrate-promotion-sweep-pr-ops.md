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
3. **`git <args>` ×2** (`loadStats` → `promotionStatsLoader`'s auto-ramp numerator/denominator `git log` queries) — shelled out with a bare `process.cwd()`, an instance of the wrong-base-repo bug the epic exists to kill.

This slice routes all three onto `GitContext`: it adds a small **PR-changed-files view** method and a **bounded `git log` read** method, extends the existing `createPR` to carry **labels**, rewires the three dep-builders in `adwPromotionSweep.tsx` to call the context (already partially migrated — the mover already uses `gitCtx.defaultBranch`/`createWorktreeForNewBranch`/`commitChanges`/`pushBranch`), and removes `adws/adwPromotionSweep.tsx` from the guard `ALLOWLIST`. After this slice the `ALLOWLIST` contains only permanent bootstrap/diagnostic entries — the residual-migration category is empty.

The value: the promotion sweep's PR and stats operations gain correct per-command auth + git identity + `cwd`; the `git log` wrong-`cwd` bug is fixed (the stats reads now run against the context base path); the temp-file PR-body dance is deleted; and the guard's allowlist shrinks to zero residual entries, making it impossible to reintroduce the wrong-repo class from this orchestrator.

## User Story

As an ADW maintainer (PRD user stories 5 and 18)
I want `adwPromotionSweep`'s `gh pr view`, `gh pr create`, and `git log` operations to route through `GitContext`, and the file removed from the git-guard allowlist
So that git identity, auth token, and `cwd` are always correct for the promotion sweep's PR/stats operations, and it becomes impossible to reintroduce the wrong-repo class of bug from this orchestrator.

## Problem Statement

`adws/adwPromotionSweep.tsx` is the final file on the `checkGitGhGuard.ts` `ALLOWLIST` in the "residual — migrate to GitContext methods (follow-up)" category. It bypasses `GitContext` at three sites:

- **`fetchChangedFilesFromPR`** runs `execWithRetry(`gh pr view ${prNumber} --repo … --json files`)`. No GitContext method exposes `gh pr view --json files` yet (`fetchPRDetails` requests a different JSON field set), so this is the "add PR view as needed" the issue calls for.
- **The mover's `createPR` dep** hand-builds `gh pr create --title "…" --body-file "<tmp>" --base … --head … --repo … --label "…"`, including a temp-file write/unlink, manual double-quote escaping, and a URL→number regex. `GitContext.createPR` already exists but takes no labels, so the mover cannot use it as-is.
- **`loadStats`** injects `runGit: (args, opts) => execWithRetry(`git ${args}`, opts)` with `cwd: process.cwd()` into `promotionStatsLoader`. In a long-lived process whose `process.cwd()` may not be the target repo, the two `git log` queries resolve against the wrong working tree — the wrong-base-repo bug.

All three are literal `gh `/`git ` command strings that the guard flags, so the file cannot leave the `ALLOWLIST` until they route through `GitContext`. Until it does, the guard cannot enforce repo-context authority over the promotion sweep, and the epic's allowlist still carries a residual entry.

## Solution Statement

Mirror the established migration pattern from the immediately-preceding slices (#691–#696): extend the `GitContext` surface with thin, named methods (command strings live in the guard-exempt `adws/gitContext/` package), route the consumer through them, and shrink the `ALLOWLIST`.

1. **Add a PR-changed-files view to `GitContext`.** Add `prChangedFilesCmd(owner, repo, prNumber)` → `gh pr view <n> --repo <o>/<r> --json files` to `adws/gitContext/commands/prCommands.ts`, and a thin `GitContext.fetchPRChangedFiles(prNumber): string` method routing through `#run()` (returns raw JSON, parsed by the caller — exactly like the sibling `fetchPRDetails`/`fetchPRList`). Runs at the context base path.

2. **Extend `createPR` with optional labels.** Add an optional `labels?: readonly string[]` parameter to `createPRCmd` (append `--label '<l>'` per label) and to `GitContext.createPR(title, body, headBranch, baseBranch?, labels?)`. Backward-compatible: the only other caller (`adws/providers/github/githubCodeHost.ts`) passes four args and is unaffected.

3. **Add a bounded `git log` read to `GitContext`.** Add `gitReadOps.logRead(run, args, cwd)` → `git <args>` and a thin `GitContext.gitLogRead(args, cwd?): string` method (defaults `cwd` to the context base path, like `lsRemote`/`headShort`/`log`). This is the read-only seam the promotion-stats loader needs; the loader (`promotionStatsLoader.ts`) and its pure unit tests stay **untouched** — only what `adwPromotionSweep.tsx` injects as `runGit` changes (the same "preserve the injection seam, keep tests green" discipline #696 used for `ReconcileDeps.branchExistsOnRemote`).

4. **Rewire `adwPromotionSweep.tsx` through the existing `gitCtx`.** `main()` already builds one context (`gitContextFor({ owner, repo, selfHost: true })`) and threads it into `buildMoverDeps`. Thread the same `gitCtx` into `buildCommenterDeps`, and:
   - `fetchChangedFilesFromPR(prNumber, gitCtx)` → `gitCtx.fetchPRChangedFiles(prNumber)`.
   - mover `createPR` dep → `gitCtx.createPR(title, body, head, base, labels)`, parsing the number from the returned URL (delete the temp-file/`os.tmpdir()` block).
   - commenter `loadStats` → `runGit: (args, opts) => gitCtx.gitLogRead(args, opts.cwd)` with `cwd: gitCtx.basePath` (fixes the wrong-`cwd` bug).
   - Drop the now-unused `execWithRetry` and `os` imports.

5. **Tighten the guard.** Remove `'adws/adwPromotionSweep.tsx'` from the `ALLOWLIST` in `adws/checkGitGhGuard.ts`. The residual category is now empty (leave only the bootstrap and diagnostic entries).

The new code paths inherit per-command auth + git identity + explicit `cwd` for free because every method delegates through the same `#run()` chokepoint. The pre-existing `@adw-697` BDD feature file (`features/per-issue/feature-697.feature`) is the RED contract this plan must turn GREEN.

## Relevant Files

Use these files to implement the feature:

### Files to modify
- `adws/gitContext/commands/prCommands.ts` — pure `gh` command-string builders (guard-exempt package). Add `prChangedFilesCmd(owner, repo, prNumber)`; extend `createPRCmd` with an optional `labels?: readonly string[]` final parameter appending `--label '<l>'` per label.
- `adws/gitContext/gitReadOps.ts` — package-private git-read op module. Add `logRead(run, args, cwd)` returning `run(`git ${args}`, cwd)`; add it to the exported `gitReadOps` object.
- `adws/gitContext/gitContext.ts` — the `GitContext` deep module. Add `fetchPRChangedFiles(prNumber): string` (delegates to `prChangedFilesCmd` via `#run`); extend `createPR` with the optional `labels` parameter (pass through to `createPRCmd`); add `gitLogRead(args, cwd?): string` (delegates to `gitReadOps.logRead`, defaulting `cwd` to `this.#basePath`). Import `prChangedFilesCmd` alongside the other PR command imports.
- `adws/adwPromotionSweep.tsx` — the orchestrator. Thread `gitCtx` into `buildCommenterDeps`; rewrite `fetchChangedFilesFromPR` to take `gitCtx` and call `fetchPRChangedFiles`; rewrite the mover `createPR` dep to call `gitCtx.createPR(...)`; rewrite the commenter `loadStats` `runGit`/`cwd` to use `gitCtx.gitLogRead`/`gitCtx.basePath`; remove the `execWithRetry` and `os` imports.
- `adws/checkGitGhGuard.ts` — remove the single `'adws/adwPromotionSweep.tsx'` `ALLOWLIST` entry (and its trailing comment + the now-empty "residual" comment block).

### Files to read for pattern (do not necessarily modify)
- `adws/gitContext/commands/prCommands.ts` — existing `fetchPRDetailsCmd`/`createPRCmd` shape; the `--head` explicit-design comment on `createPRCmd` (why `gh pr create` need not run from the worktree).
- `adws/gitContext/commands/labelCommands.ts` — `applyLabelCmd` uses `--add-label '<name>'`; mirror that single-quote label form in `createPRCmd`.
- `adws/gitContext/gitReadOps.ts` — `Runner` type + `lsFiles`/`headShort`/`diff`/`log` shape; `logRead` is a direct sibling.
- `adws/gitContext/remoteOps.ts` — the #696 addition; canonical example of how thin a new op + method pair is (the `lsRemote` `cwd ?? base` default mirrors `gitLogRead`).
- `adws/github/prApi.ts` — `defaultFindPRByBranch`/`commentOnPR`/`fetchPRDetails` already route through `gitContextForRepo(...)`; confirms the function-call form is **not** a guard violation (only literal `gh `/`git ` strings are).
- `adws/promotion/promotionStatsLoader.ts` — `PromotionStatsLoaderDeps.runGit(args, { cwd })` seam (left untouched); the two `git log` arg strings (`log --since=… --grep=…`, `log --since=… -p -- <glob>`) that `gitLogRead` will run.
- `adws/promotion/promotionMover.ts` — `PromotionMoverDeps.createPR(opts) => { number, url }` contract the rewired dep must still satisfy.
- `adws/promotion/promotionCommenter.ts` — `PromotionCommenterDeps` (`fetchChangedFiles`, `loadStats`) the rewired commenter dep must still satisfy.
- `adws/providers/github/githubCodeHost.ts` — the other `ctx.createPR(...)` caller (4 args); confirms the new `labels` parameter must be optional.
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — `makeSpyExec()` + `validOptions()` helpers used to assert command string, `cwd`, and injected env for new methods.
- `adws/gitContext/__tests__/gitReadOps.test.ts` — fake-`Runner` op-test shape to mirror for `logRead`.
- `features/per-issue/feature-697.feature` — the pre-existing `@adw-697` RED scenario contract (the new methods + de-allowlisting must make it GREEN).
- `specs/issue-696-adw-vl60su-gitcontext-migrate-g-sdlc_planner-migrate-fetch-merge-lsremote-ops.md` — the immediately-preceding slice; mirror its three-phase structure and ALLOWLIST-removal step.
- `specs/prd/git-context-repo-authority.md` — parent PRD (user stories 5, 18; the `#run` chokepoint / no-cwd-fallback contract).

### Conditional docs (matched against `.adw/conditional_docs.md`)
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns `adws/gitContext/**`, `commands/**`, `gitContextFactory.ts`; conditions explicitly cover "adding a new `gh` operation method to `GitContext` (follow the thin-method + package-private-op pattern)" and the #691–#696 migration precedent.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — owns `adws/checkGitGhGuard.ts`; conditions cover "migrating a residual allowlisted file to GitContext methods and removing it from the ALLOWLIST" and the `lint:git-guard` remedy.
- `app_docs/feature-28aysq-hitl-label-tag-lifecycle.md` — conditions cover "wiring new I/O dependencies into `buildMoverDeps` in `adwPromotionSweep.tsx`" and `PromotionCommenterDeps` extension (the dep-builders rewired here).
- `app_docs/feature-y8r69q-auto-ramping-promotion-threshold.md` — conditions cover `loadPromotionStats`/`PromotionStatsLoaderDeps` (the stats loader whose `runGit` seam is rebacked).
- `app_docs/feature-2wrg9y-promotion-mover-regression-pr.md` — `runPromotionMover` / regression-promotion PR (the mover `createPR` dep).
- `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` — `runPromotionCommenter` / commenter deps.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — how the single launch-boundary `GitContext` (`gitContextFor`) is built and threaded (the `gitCtx` reused here).

### New Files
- _None._ All new command/op code lives in existing files inside the guard-exempt `adws/gitContext/` package; the BDD feature file already exists.
- (Tests extend existing files — see Testing Strategy. No new test file is required because command builders are covered indirectly via `gitContextOperations.test.ts`, matching the convention used for `prCommands`/`labelCommands`.)

## Implementation Plan

### Phase 1: Foundation — extend the GitContext surface
Add the three additive surface pieces. All are backward-compatible and break nothing; they can land and be unit-tested before any call-site change.
- `prChangedFilesCmd` + `GitContext.fetchPRChangedFiles` — the new PR view.
- `createPRCmd` optional `labels` + `GitContext.createPR` optional `labels` — extend the existing PR-create surface.
- `gitReadOps.logRead` + `GitContext.gitLogRead` — the bounded git-log read (cwd defaults to base path).

### Phase 2: Core Implementation — route `adwPromotionSweep.tsx` through GitContext
Rewire the three dep-builders to call the context, reusing the `gitCtx` already constructed in `main()`. Delete the temp-file PR-body block and the `execWithRetry`/`os` imports. The pure `promotion/` modules and their tests are untouched — only the injected closures change.

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

### 3. Add the bounded `git log` read op + method
- In `adws/gitContext/gitReadOps.ts`, add `function logRead(run: Runner, args: string, cwd: string): string { return run(`git ${args}`, cwd); }` and include `logRead` in the exported `gitReadOps` object. Add a one-line doc comment: read-only `git` arg-string passthrough scoped to the promotion-stats `git log` queries (its sole consumer).
- In `gitContext.ts`, add (in the `// ── Git read ops ──` section):
  `gitLogRead(args: string, cwd?: string): string { return gitReadOps.logRead((cmd, c) => this.#run(cmd, { cwd: c }), args, cwd ?? this.#basePath); }`

### 4. Unit-test the new surface
- In `adws/gitContext/__tests__/gitReadOps.test.ts`, add a `logRead` case against a fake recording `Runner`: assert it issues `git <args>` with the given `cwd` and returns the runner output.
- In `adws/gitContext/__tests__/gitContextOperations.test.ts`, add `describe` blocks (using `makeSpyExec()` + `validOptions()`):
  - `fetchPRChangedFiles(7)` issues `gh pr view 7 --repo acme/webapp --json files`, `cwd` === base path, env carries `GH_TOKEN` + `GIT_AUTHOR_*` (covers §1a).
  - `createPR(title, body, head, base, ['regression-promotion'])` issues a command containing `gh pr create`, `--head "<head>"`, `--label 'regression-promotion'`, passes `body` as stdin `input`, `cwd` === base path, token present (covers §1b); and `createPR(title, body, head)` (no labels) emits **no** `--label` (backward-compat).
  - `gitLogRead('log --since="X" --grep="^regression-promotion:"')` issues `git log --since="X" --grep="^regression-promotion:"`, `cwd` === base path (default), token + identity present (covers §1c); and `gitLogRead(args, '/some/wt')` honors an explicit cwd.

### 5. Rewire `fetchChangedFilesFromPR` (commenter + mover shared)
- In `adws/adwPromotionSweep.tsx`, change the signature to `fetchChangedFilesFromPR(prNumber: number, gitCtx: GitContext)` and the body to parse `gitCtx.fetchPRChangedFiles(prNumber)` (drop the `repoInfo`/`execWithRetry` use; the JSON shape `{ files: [...] }` and the modified/removed mapping are unchanged).
- Update both call sites: `buildCommenterDeps` and `buildMoverDeps` now pass `gitCtx` to `fetchChangedFilesFromPR`.

### 6. Thread `gitCtx` into `buildCommenterDeps` and rewire `loadStats`
- Add `gitCtx: GitContext` to `buildCommenterDeps(...)`; pass it at the `main()` call site.
- `fetchChangedFiles: async () => fetchChangedFilesFromPR(prNumber, gitCtx)`.
- Rewrite `loadStats` to inject the context-backed reader:
  `runGit: (args, opts) => gitCtx.gitLogRead(args, opts.cwd)` and `cwd: gitCtx.basePath` (replacing `process.cwd()`). Leave the rest of the `loadPromotionStats({...})` deps (`now`, `perIssueGlob`, `log`) unchanged.

### 7. Rewire the mover `createPR` dep
- In `buildMoverDeps`, replace the `createPR` closure body with:
  ```ts
  createPR: (opts) => {
    const url = gitCtx.createPR(opts.title, opts.body, opts.head, opts.base, opts.labels);
    const match = /\/pull\/(\d+)$/.exec(url);
    return { number: match ? parseInt(match[1], 10) : 0, url };
  },
  ```
- Delete the temp-file block (`os.tmpdir()`, `fs.writeFileSync`, `fs.unlinkSync`) and the manual `--label`/double-quote string assembly. (`opts.cwd` is no longer needed — `createPR` runs at the context base path with explicit `--head`/`--repo`; see Notes.)

### 8. Remove the dead imports
- In `adwPromotionSweep.tsx`, remove `execWithRetry` from the `./core/index.ts` import (keep `log`, `LogLevel`) and remove `import * as os from 'os';`. Keep `fs` (still used by mover `readFile`/`writeFile`) and `path` (still used by mover `writeFile` `path.dirname`).

### 9. Remove the `ALLOWLIST` entry
- In `adws/checkGitGhGuard.ts`, delete the `'adws/adwPromotionSweep.tsx'` line (and its trailing comment). Remove the now-empty `// residual — migrate to GitContext methods (follow-up)` comment block so only bootstrap + diagnostic categories remain.

### 10. Align the `@adw-697` step definitions
- Generate/align step definitions for `features/per-issue/feature-697.feature` so the scenario test phase drives them. Map the abstract ops to the new surface: `"pr-changed-files"` → `fetchPRChangedFiles`, `"pr-create"` → `createPR` (with a label), `"stats-log"` → `gitLogRead`. The guard scenarios (§2/§3) drive `scanFiles`/the guard run; the type-check scenario (§4) drives `tsc`. Keep assertions behavioral (recorded child-env token/identity, recorded `cwd`, guard `scannedCount`/violations, `tsc` exit) per the scenario rot-prevention rule — do not assert source structure.

### 11. Run all Validation Commands
- Execute every command in the `Validation Commands` section below and confirm each exits cleanly with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **`adws/gitContext/__tests__/gitReadOps.test.ts` (extend)** — pure `logRead` test against a fake recording `Runner`: asserts the `git <args>` string and the passed `cwd`, and that the runner output is returned verbatim. Mirrors the existing `lsFiles`/`diff`/`log` cases.
- **`adws/gitContext/__tests__/gitContextOperations.test.ts` (extend)** — for `fetchPRChangedFiles`, `createPR` (with and without labels), and `gitLogRead`, use `makeSpyExec()` to assert: the exact `gh `/`git ` command string, `cwd` (base path by default; explicit cwd honored for `gitLogRead`), the stdin `input` for `createPR`, and the injected child env (`GH_TOKEN`, `GIT_AUTHOR_*`). These prove the new methods inherit the `#run` auth/cwd chokepoint (the observable behavior the §1 scenarios assert).
- **`adws/promotion/__tests__/promotionStatsLoader.test.ts` (verify unchanged)** — must stay green; the `runGit` seam is preserved and the loader module is not modified. No change required.
- **`adws/promotion/__tests__/*` (verify unchanged)** — commenter/mover deps shapes (`fetchChangedFiles`, `loadStats`, `createPR => { number, url }`) are unchanged, so the pure promotion-module tests stay green.

### Edge Cases
- **`createPR` with no labels** — `githubCodeHost.ts` (4-arg call) and any future caller omitting `labels` emit no `--label` flag (backward-compatible; the `?? []` guard yields an empty append).
- **PR URL → number parse miss** — if `gh pr create`'s returned URL doesn't match `/\/pull\/(\d+)$/`, the dep returns `number: 0` (identical to the pre-migration behavior, which used the same regex).
- **`gitLogRead` default vs explicit cwd** — called without `cwd` it runs at the context base path (the §1c assertion and the wrong-`cwd` fix); called with an explicit `cwd` it honors it (so the `opts.cwd` the loader passes — now `gitCtx.basePath` — flows through unchanged).
- **`process.cwd()` ≠ target repo** — the previous `loadStats` bug: the two `git log` queries now run with `cwd = gitCtx.basePath`, so `git log` resolves against the correct repository regardless of the process working directory.
- **Scenario name containing a single quote** — `createPRCmd` single-quotes the title (pre-existing behavior shared with all `createPR` callers); a literal `'` in a scenario name is an unescaped edge identical to today's risk and out of scope for this slice (the mover's `slugify` only affects branch/file names, not the title).
- **`gh pr view --json files` for a PR with no file changes** — returns `{ "files": [] }`; `data.files.map(...)` yields `[]` and the commenter/mover loops are no-ops (unchanged).

## Acceptance Criteria
- [ ] `GitContext` exposes `fetchPRChangedFiles(prNumber)` (`gh pr view --json files`), a `createPR(..., labels?)` overload carrying `--label`, and `gitLogRead(args, cwd?)` — each routed through the `#run()` per-command-auth chokepoint.
- [ ] `adws/adwPromotionSweep.tsx` issues zero direct `git`/`gh` shell-outs: `fetchChangedFilesFromPR` uses `fetchPRChangedFiles`, the mover `createPR` dep uses `gitCtx.createPR`, and `loadStats` uses `gitCtx.gitLogRead` with `cwd = gitCtx.basePath`.
- [ ] The `execWithRetry` and `os` imports are removed from `adws/adwPromotionSweep.tsx`.
- [ ] `adws/adwPromotionSweep.tsx` is removed from the `ALLOWLIST` in `adws/checkGitGhGuard.ts` (residual category now empty).
- [ ] `bun run lint:git-guard` passes (zero violations) with the file now scanned (not skipped).
- [ ] All `@adw-697` scenarios in `features/per-issue/feature-697.feature` pass.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run test:unit`, and `bun run build` all succeed with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint:git-guard` — git/gh CLI guard; MUST pass with `adwPromotionSweep.tsx` no longer allowlisted (primary acceptance gate; proves `scannedCount` now includes the file with zero violations).
- `bunx tsc --noEmit -p adws/tsconfig.json` — type-check the `adws/` project (catches the `createPR` signature change, the new imports, and any accidental import cycle; backs §4 of the feature).
- `bun run lint` — ESLint across the repo (code hygiene; flags the removed `execWithRetry`/`os` imports if any reference remains).
- `bun run test:unit` — full vitest suite (extended `gitReadOps`/`gitContextOperations` tests, unchanged `promotionStatsLoader`/promotion-module tests).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-697"` — runs the per-issue scenario contract for this slice (the three §1 #run scenarios, the §2 de-allowlist scan, the §3 whole-repo guard pass, and the §4 type-check).
- `bun run build` — `tsc` build to verify no build errors.

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (it does), strictly adhere to it: keep each new `GitContext` method a one-line delegation; keep the command builders pure string functions; isolate side effects at the `#run` boundary; prefer the early-return/guard-clause style already in the file.
- **Library install command** (`.adw/commands.md`): `bun add <package>` if ever needed — this slice adds **no** new dependencies.
- **Why extend `createPR` rather than create-then-`applyLabel`** — one atomic `gh pr create --label …` matches the pre-migration behavior (label applied at creation), avoids a second round-trip and a separate failure mode, and keeps the mover dep a single call. The `labels` parameter is optional so the existing `githubCodeHost` caller is untouched.
- **Why a generic-shaped `gitLogRead` rather than two named stat methods** — the alternative (two purpose-named builders + refactoring `promotionStatsLoader`'s `runGit` seam into two specific deps) would change a pure module and its 8-case unit test for no behavioral gain. `gitLogRead` keeps the loader and its tests byte-for-byte unchanged (the #696 "preserve the seam" discipline), routes through `#run` for correct auth/cwd, and confines the `git <args>` string to the guard-exempt package. It is read-only and has exactly one consumer (the stats loader); the doc comment records that scope. The auth/cwd contract the PRD cares about is fully honored — only the "one method per named operation" aesthetic is relaxed, deliberately and locally.
- **`createPR` runs at the context base path, not the worktree** — the mover previously passed `cwd: worktreePath`. With explicit `--repo` and `--head "<branch>"` (and the branch already pushed via `gitCtx.pushBranch` beforehand), `gh pr create` does not need the worktree cwd; running at the base path is correct and matches the `createPRCmd` `--head` design comment (which exists precisely to avoid cwd-based head inference). This also deletes the temp-body-file dance, since `#run` pipes the body via stdin (`--body-file -`).
- **Function calls are not guard violations** — the file keeps calling `defaultFindPRByBranch`, `commentOnPR`, and `addIssueLabel` (from `prApi`/`issueApi`), which already route through `gitContextForRepo(...)` internally. The guard flags only literal `gh `/`git ` command strings, so these are out of scope and stay as-is.
- **Import-cycle check** — `adwPromotionSweep.tsx` already imports `GitContext` (type) and `gitContextFor`; the new method calls add no new module edges. `prCommands.ts`/`gitReadOps.ts` are leaf string/op modules with no inbound cycle risk. `tsc` will surface any regression.
- **Blocked by #696** — this slice builds on the #696 surface-extension + ALLOWLIST-shrinking precedent (`remoteOps`/`lsRemote`); #696 is merged to `dev` (commit `2f645c3`). After this slice the residual-migration ALLOWLIST category is empty — only permanent bootstrap (`launchGitContext`, `gitContextFactory`, `targetRepoManager`, `upgradeClaim`, `githubAppAuth`) and diagnostic (`healthCheck*`) entries remain.
- **BDD-first** — `features/per-issue/feature-697.feature` already exists (the RED contract); do not rewrite it. The implementation must make it GREEN; step definitions are generated/aligned in Task 10 and frozen by the Gherkin-freeze guard during the fix loop.
