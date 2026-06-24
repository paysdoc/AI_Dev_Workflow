# Feature: GitContext — migrate phase-level git reads (ls-files / rev-parse / diff / log)

## Metadata
issueNumber: `694`
adwId: `alilj4-gitcontext-migrate-p`
issueJson: `{"number":694,"title":"GitContext: migrate phase-level git reads (ls-files/rev-parse/diff/log)","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md`\n\n## What to build\nAdd `lsFiles`/`headShort`/`diff`/`log` read methods and migrate the phase-level git-read sites, removing their ALLOWLIST entries.\n\n## Acceptance criteria\n- [ ] git-read methods on GitContext\n- [ ] worktreeSetup, workflowInit, diffEvaluationPhase, prCommentDetector, checkLivingDocsIndex route through GitContext\n- [ ] Those files removed from `ALLOWLIST`\n- [ ] `lint:git-guard` passes; tests green\n\n## Blocked by\n- Blocked by #693\n\n## Touched Files\n- adws/gitContext/gitContext.ts\n- adws/phases/worktreeSetup.ts\n- adws/phases/workflowInit.ts\n- adws/phases/diffEvaluationPhase.ts\n- adws/github/prCommentDetector.ts\n- adws/checkLivingDocsIndex.ts\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 5\n- User story 8","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-23T11:45:27Z","comments":[],"actionableComment":null}`

## Feature Description

This is one slice of the **GitContext** epic (parent PRD: `specs/prd/git-context-repo-authority.md`). The epic introduces a single repo-context authority — the `GitContext` deep module — that owns **every** git and `gh` interaction in ADW, so that "which repo's filesystem" and "which repo's auth" are resolved in exactly one place and can never default to the wrong repo. A CI guard (`adws/checkGitGhGuard.ts`, run via `bun run lint:git-guard`) fails the build when any file outside the `adws/gitContext/` package shells out to `git`/`gh` directly, *unless* that file is on a temporary `ALLOWLIST`. Each migration slice removes its files from the ALLOWLIST once they route through `GitContext`.

This slice migrates the remaining **phase-level and diagnostic git *read* operations** (no writes): the working-tree file listing (`git ls-files`), the short HEAD commit hash (`git rev-parse --short HEAD`), the branch diff (`git diff <base>...HEAD`), and the branch commit-history log (`git log`). It adds four read methods to `GitContext` — `lsFiles`, `headShort`, `diff`, `log` — routes the five call-site files through them, and deletes those five files from the `ALLOWLIST`.

The immediate value: five more files become structurally incapable of running git against the wrong repository, and the per-command auth/env-isolation guarantees of `GitContext` extend to these reads. The directly-preceding sibling slice #693 (merged to `dev` as `72672b7`) migrated the VCS probe/branch ops using the exact same pattern this slice follows — new package-private ops module + thin `GitContext` methods + ALLOWLIST removal + integration tests.

## User Story

As an **ADW maintainer** (PRD user stories 5 and 8),
I want **every phase-level and diagnostic git read to route through `GitContext`, with the build failing if any of these files shells out to git directly**,
So that **a new call site cannot reintroduce the wrong-repo class of bug, and the "route through the context" guarantee is enforced mechanically rather than by convention**.

## Problem Statement

Five files still shell out to `git` directly for read operations and are therefore parked on the `checkGitGhGuard.ts` `ALLOWLIST` (four under the "residual — migrate to GitContext methods" category, one under "diagnostic"):

- `adws/phases/worktreeSetup.ts` — `git ls-files "<prefix>"` (×2, in `getTrackedBasenames` and `getTrackedTopDirs`) with `cwd: worktreePath`.
- `adws/phases/workflowInit.ts` — `git rev-parse --short HEAD` (framework version log line) with implicit `process.cwd()`.
- `adws/phases/diffEvaluationPhase.ts` — `git diff <defaultBranch>...HEAD` with `cwd: worktreePath` and `maxBuffer: 10 MB`.
- `adws/github/prCommentDetector.ts` — `git log "<branch>" --format="%aI %s" --no-merges` with caller-supplied `cwd`.
- `adws/checkLivingDocsIndex.ts` — `git ls-files` (no prefix) with implicit `process.cwd()`.

While allowlisted, these reads can resolve `cwd` to the wrong repository (the framework root instead of a target-repo worktree) — exactly the failure class the PRD eliminates. `GitContext` has no read methods named `lsFiles`/`headShort`/`diff`/`log` yet, so there is nowhere to route them.

## Solution Statement

Mirror the established #693 pattern exactly:

1. **Add a package-private read-ops module** `adws/gitContext/gitReadOps.ts` exposing pure `(run, …) => …` functions: `lsFiles`, `headShort`, `diff`, and `log` (sibling to `worktreeProbeOps.ts` / `branchOps.ts`). Each takes the injected `Runner = (command, cwd) => string` seam so it is testable without a real context. Errors **propagate** (no internal swallow), so each call site keeps its own existing error handling unchanged.
2. **Add four thin `GitContext` methods** (`lsFiles`, `headShort`, `diff`, `log`) that delegate to `gitReadOps`, threading the private `#run` chokepoint (per-command auth + git identity + explicit `cwd`, never mutating `process.env`).
3. **Raise the default `execSync` buffer** in `GitContext`'s `defaultExec` to 10 MB so `diff` preserves the large-output ceiling the current `getGitDiff` relies on (and which `git log` on a long branch benefits from). This is the only behavior-sensitive infra change; it is strictly more permissive (no regression).
4. **Route the five files** through the new methods, obtaining a `GitContext` at each site the way its neighbours already do (thread the existing `gitCtx`/`config.gitContext`, or construct one from the local repo via `gitContextForRepo(readLocalRepoInfo(), …)` for the standalone diagnostic). Remove the now-unused `execSync` imports.
5. **Delete the five `ALLOWLIST` entries** in `checkGitGhGuard.ts`. After migration the guard scans these files and must find zero git/gh command strings.
6. **Add unit tests** for the four new methods (spy-`ExecFn`, asserting exact command string, `cwd`, per-command env injection, parsing, and error propagation), and update the existing tests whose call shapes change.

Faithfulness is the priority: this is a pure routing migration with **no intended behavior change**, except one latent-bug correction the PRD explicitly seeks — `git log`/diff now run in the correct target-repo base path instead of the framework root (documented in Notes).

## Relevant Files

Use these files to implement the feature:

### Files to modify (the seven Touched Files)
- `adws/gitContext/gitContext.ts` — Add the four read methods (`lsFiles`, `headShort`, `diff`, `log`) in a new `// ── Git read ops ──` section, each delegating to `gitReadOps` via `(cmd, c) => this.#run(cmd, { cwd: c })`. Raise `defaultExec`'s `execSync` `maxBuffer` to `10 * 1024 * 1024` (both the `input` and non-`input` branches).
- `adws/phases/worktreeSetup.ts` — `getTrackedBasenames`/`getTrackedTopDirs` take a `GitContext` and call `ctx.lsFiles(worktreePath, prefix)`; `copyClaudeAssetsToWorktree` gains a `gitContext: GitContext` parameter and threads it down. Remove `import { execSync } from 'child_process'`. Keep both helpers' existing `try { … } catch { return new Set() }` wrappers.
- `adws/phases/workflowInit.ts` — Replace `execSync('git rev-parse --short HEAD')` with `gitCtx.headShort(frameworkRepoRoot)` (keeping the surrounding `try/catch`); pass `gitCtx` to the two `copyClaudeAssetsToWorktree(worktreePath)` calls (lines ~231, ~253); hoist the `frameworkRepoRoot` computation so it is available at the version-log site. Remove the now-unused `import { execSync }`.
- `adws/phases/diffEvaluationPhase.ts` — `getGitDiff` takes the `GitContext` and calls `ctx.diff(`${defaultBranch}...HEAD`, worktreePath)` inside its existing `try/catch` (returns `''` + warn on failure); `executeDiffEvaluationPhase` passes `config.gitContext`. Remove `import { execSync }`.
- `adws/github/prCommentDetector.ts` — `getLastAdwCommitTimestamp(branchName, gitContext, cwd?)` calls `gitContext.log(branchName, cwd)` inside its existing `try/catch`; `getUnaddressedComments` constructs `gitContextForRepo(repoInfo)` and passes it down (public callers stay unchanged). Remove `import { execSync }`; add `import { gitContextForRepo } from './gitContextFactory'` and the `GitContext` type import.
- `adws/checkLivingDocsIndex.ts` — `listTrackedFiles` constructs a self-host context `gitContextForRepo(readLocalRepoInfo(), { selfHost: true })` and calls `ctx.lsFiles(process.cwd())`. Remove `import { execSync }`; import `gitContextForRepo`/`readLocalRepoInfo` from `./github/gitContextFactory`.
- `adws/checkGitGhGuard.ts` — Remove the five `ALLOWLIST` entries: `adws/checkLivingDocsIndex.ts`, `adws/github/prCommentDetector.ts`, `adws/phases/diffEvaluationPhase.ts`, `adws/phases/workflowInit.ts`, `adws/phases/worktreeSetup.ts`.

### Pattern/reference files (read, do not necessarily change)
- `adws/gitContext/worktreeProbeOps.ts` — The exact sibling read-ops module shape to mirror for `gitReadOps.ts` (package-private, injected `Runner`, one file per read concern).
- `adws/gitContext/branchOps.ts` / `adws/gitContext/worktreeQueryOps.ts` — More precedent for the ops-module idiom (`localBranches`, `mainRepoPath`, `worktreeBranches` added in #693).
- `adws/gitContext/commitOps.ts` — Precedent for read methods that take a `cwd`/worktree path (`getHeadTreeHash`, `hasUncommittedChanges`).
- `adws/gitContext/types.ts` — `ExecFn` (already supports `input`; `maxBuffer` is set inside `defaultExec`, not on this seam), `GitContextOptions`, `GitContextDeps`.
- `adws/github/gitContextFactory.ts` — `gitContextForRepo`, `gitContextForSync`, `readLocalRepoInfo` (the permanently-allowlisted bootstrap remote read used to construct a self-host context for the diagnostic gate).
- `adws/triggers/trigger_cron.ts` (≈line 362) and `adws/phases/prReviewPhase.ts` (≈line 59) — The two public callers of `hasUnaddressedComments`/`getUnaddressedComments`; confirm they remain source-compatible (no signature change).
- `git show 72672b7` — The full #693 migration diff (gitContext methods + ops module + ALLOWLIST removal + `gitContextOperations.test.ts`), the template for this slice.

### Documentation to consult (conditional docs — these own the touched files)
- `specs/prd/git-context-repo-authority.md` — Parent PRD; user stories 5 and 8 are the acceptance frame.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — **Owns `adws/gitContext/**`**; the authority on `GitContext` construction, `#run` chokepoint, `commandEnv`, base-path resolution, and the package-private ops-module convention. Read before editing `gitContext.ts` / adding `gitReadOps.ts`.
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — **Owns `adws/phases/worktreeSetup.ts`**; covers `copyClaudeAssetsToWorktree` and the `target:` gitignore policy. Read before changing that signature.
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — **Owns `adws/phases/workflowInit.ts`**; context for the worktree/branch-resolution flow surrounding the version-log line.

### New Files
- `adws/gitContext/gitReadOps.ts` — Package-private read-ops module: `export const gitReadOps = { lsFiles, headShort, diff, log }`, each a pure function over the injected `Runner`.
- `adws/gitContext/__tests__/gitReadOps.test.ts` — Focused unit tests for the four new `GitContext` read methods (or, following #693 precedent, these may instead be appended to `adws/gitContext/__tests__/gitContextOperations.test.ts`).

## Implementation Plan

### Phase 1: Foundation — GitContext read methods
Add `adws/gitContext/gitReadOps.ts` with four pure functions over the `Runner` seam, then add the four delegating methods to `GitContext` and raise the `defaultExec` buffer. This is self-contained, fully unit-testable, and unblocks every call-site migration. No call sites change yet, so `lint:git-guard` still passes (the five files remain allowlisted).

### Phase 2: Core Implementation — route the five call sites
Migrate each of the five files to call the new `GitContext` methods, obtaining a context the way its neighbours do, and remove the dead `execSync` imports. Keep every existing `try/catch` wrapper so error behavior is byte-identical at each site. Update the tests whose call shapes change (`worktreeSetup.test.ts` real-exec context; `workflowInit.test.ts` mock `gitCtx.headShort`).

### Phase 3: Integration — flip the guard and prove green
Delete the five `ALLOWLIST` entries from `checkGitGhGuard.ts`. Run `bun run lint:git-guard` (must scan the five files and find zero violations), then `bun run lint`, the type checks, the unit suite, and `bun run build`. Re-run the migrated diagnostic gate `bunx tsx adws/checkLivingDocsIndex.ts` to confirm it still passes end-to-end through `GitContext`.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1 — Create `adws/gitContext/gitReadOps.ts`
- New file mirroring `worktreeProbeOps.ts` structure (header comment, `type Runner = (command: string, cwd: string) => string;`).
- Implement four functions; errors **propagate** (do not wrap in try/catch — call sites handle errors):
  - `function lsFiles(run: Runner, cwd: string, prefix?: string): string[]` → `const cmd = prefix ? `git ls-files "${prefix}"` : 'git ls-files'; return run(cmd, cwd).split('\n').filter(Boolean);`
  - `function headShort(run: Runner, cwd: string): string` → `return run('git rev-parse --short HEAD', cwd);` (`#run` already trims).
  - `function diff(run: Runner, range: string, cwd: string): string` → `return run(`git diff ${range}`, cwd);`
  - `function log(run: Runner, branchName: string, cwd: string): string` → `return run(`git log "${branchName}" --format="%aI %s" --no-merges`, cwd);`
- Export `export const gitReadOps = { lsFiles, headShort, diff, log };` (name the local `log` function to avoid confusion only if needed — there is no `log` import in this module, so `log` is safe).

### Task 2 — Add the four methods + raise the buffer in `adws/gitContext/gitContext.ts`
- Add `import { gitReadOps } from './gitReadOps';` alongside the other ops-module imports.
- In `defaultExec`, add `maxBuffer: 10 * 1024 * 1024` to **both** `execSync` option objects (the `input !== undefined` branch and the default branch) so large diffs/logs do not throw `ENOBUFS`.
- Add a new section after the "Worktree / branch probe reads" block:
  ```ts
  // ── Git read ops ──────────────────────────────────────────────────────────────

  lsFiles(cwd: string, prefix?: string): string[] {
    return gitReadOps.lsFiles((cmd, c) => this.#run(cmd, { cwd: c }), cwd, prefix);
  }

  headShort(cwd?: string): string {
    return gitReadOps.headShort((cmd, c) => this.#run(cmd, { cwd: c }), cwd ?? this.#basePath);
  }

  diff(range: string, cwd: string): string {
    return gitReadOps.diff((cmd, c) => this.#run(cmd, { cwd: c }), range, cwd);
  }

  log(branchName: string, cwd?: string): string {
    return gitReadOps.log((cmd, c) => this.#run(cmd, { cwd: c }), branchName, cwd ?? this.#basePath);
  }
  ```
- No new public types → `adws/gitContext/index.ts` needs no change (verify).

### Task 3 — Unit-test the four methods
- Create `adws/gitContext/__tests__/gitReadOps.test.ts` (or append to `gitContextOperations.test.ts`), reusing the `validOptions()` / `makeSpyExec()` helpers from `gitContextOperations.test.ts`.
- For each method assert: exact command string built; `cwd` passed (explicit arg, and default-to-`basePath` for `headShort`/`log`); `GH_TOKEN` and all four `GIT_*` env vars injected; `process.env` not mutated; parsing/return value; and that an exec throw **propagates** (e.g. `expect(() => ctx.lsFiles('/wt')).toThrow()`).
  - `lsFiles`: `git ls-files "<prefix>"` with prefix, `git ls-files` without; splits lines and drops blanks.
  - `headShort`: `git rev-parse --short HEAD`; returns trimmed hash; defaults `cwd` to `basePath`.
  - `diff`: `git diff <range>` with the passed range and `cwd`.
  - `log`: `git log "<branch>" --format="%aI %s" --no-merges`; defaults `cwd` to `basePath`.

### Task 4 — Migrate `adws/phases/worktreeSetup.ts`
- Add `import type { GitContext } from '../gitContext';`. Remove `import { execSync } from 'child_process';`.
- `getTrackedBasenames(worktreePath, prefix)` → `getTrackedBasenames(ctx: GitContext, worktreePath: string, prefix: string)`, body: keep the `try { return new Set(ctx.lsFiles(worktreePath, prefix).map((f) => path.basename(f))); } catch { return new Set(); }`.
- `getTrackedTopDirs(worktreePath, prefix)` → `getTrackedTopDirs(ctx: GitContext, worktreePath: string, prefix: string)`, body: keep the `try/catch` returning `new Set()`, mapping `ctx.lsFiles(worktreePath, prefix)` to top-level dir names.
- `copyClaudeAssetsToWorktree(worktreePath)` → `copyClaudeAssetsToWorktree(worktreePath: string, gitContext: GitContext)`; pass `gitContext` to both helper calls.

### Task 5 — Migrate `adws/phases/workflowInit.ts`
- Remove `import { execSync } from 'child_process';` (confirm line ~200 is its only use first).
- Hoist `const frameworkRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');` to before the version-log block (reuse it in the existing `if (targetRepo)` upgrade-gate block too, replacing the duplicate computation).
- Replace the version-log body, keeping the `try/catch`:
  ```ts
  try {
    const commitHash = gitCtx.headShort(frameworkRepoRoot);
    log(`ADW version: ${commitHash}`, 'info');
  } catch {
    // Not in a git repo or git unavailable — skip version logging
  }
  ```
- Pass `gitCtx` to both `copyClaudeAssetsToWorktree(worktreePath)` calls (≈lines 231 and 253) → `copyClaudeAssetsToWorktree(worktreePath, gitCtx)`.
- Note: `headShort(frameworkRepoRoot)` is intentional — it logs the **framework** repo's HEAD (the "ADW version"), so `cwd` must be the framework root regardless of whether `gitCtx` is self-host or target. `git rev-parse` needs no auth, so `gitCtx`'s token is irrelevant here.

### Task 6 — Migrate `adws/phases/diffEvaluationPhase.ts`
- Remove `import { execSync } from 'child_process';`.
- `getGitDiff(worktreePath, defaultBranch)` → `getGitDiff(ctx: GitContext | undefined, worktreePath: string, defaultBranch: string)`:
  ```ts
  function getGitDiff(ctx: GitContext | undefined, worktreePath: string, defaultBranch: string): string {
    if (!ctx) return '';
    try {
      return ctx.diff(`${defaultBranch}...HEAD`, worktreePath);
    } catch (error) {
      log(`Failed to get git diff: ${error}`, 'warn');
      return '';
    }
  }
  ```
- In `executeDiffEvaluationPhase`, call `getGitDiff(config.gitContext, worktreePath, defaultBranch)`. Add `import type { GitContext } from '../gitContext';`.
- Preserve the existing fail-safe: an empty diff (including the no-context / git-error case) classifies as `safe` exactly as today.

### Task 7 — Migrate `adws/github/prCommentDetector.ts`
- Remove `import { execSync } from 'child_process';`. Add `import { gitContextForRepo } from './gitContextFactory';` and `import type { GitContext } from '../gitContext';`.
- `getLastAdwCommitTimestamp(branchName, cwd?)` → `getLastAdwCommitTimestamp(branchName: string, gitContext: GitContext, cwd?: string)`; replace the `execSync(...)` with `const output = gitContext.log(branchName, cwd);` inside the existing `try/catch` (which logs and returns `null` on failure).
- In `getUnaddressedComments`, construct the context once and pass it through:
  ```ts
  const gitContext = gitContextForRepo(repoInfo);
  const lastAdwCommit = getLastAdwCommitTimestamp(prDetails.headBranch, gitContext);
  ```
- `getUnaddressedComments` and `hasUnaddressedComments` keep their existing `(prNumber, repoInfo)` signatures — the two public callers (`trigger_cron.ts`, `prReviewPhase.ts`) need no change.

### Task 8 — Migrate `adws/checkLivingDocsIndex.ts`
- Remove `import { execSync } from 'child_process';`. Add `import { gitContextForRepo, readLocalRepoInfo } from './github/gitContextFactory';`.
- Replace `listTrackedFiles`:
  ```ts
  function listTrackedFiles(): string[] {
    const ctx = gitContextForRepo(readLocalRepoInfo(), { selfHost: true });
    return ctx.lsFiles(process.cwd());
  }
  ```
- Behavior preserved: on git failure the read propagates (the gate crashes loudly, as today), rather than silently passing on an empty file set.

### Task 9 — Remove the five ALLOWLIST entries in `adws/checkGitGhGuard.ts`
- Delete these lines from `ALLOWLIST`:
  - `'adws/checkLivingDocsIndex.ts'` (under "diagnostic")
  - `'adws/github/prCommentDetector.ts'` (under "residual")
  - `'adws/phases/diffEvaluationPhase.ts'`
  - `'adws/phases/workflowInit.ts'`
  - `'adws/phases/worktreeSetup.ts'`
- Leave the remaining bootstrap/diagnostic/residual entries intact.

### Task 10 — Update existing tests affected by signature changes
- `adws/phases/__tests__/worktreeSetup.test.ts`: the `copyClaudeAssetsToWorktree(tempDir)` calls now need a second arg. Construct a real-exec `GitContext` against the temp repo (dummy identity is fine since `lsFiles` uses the explicit `worktreePath` cwd):
  ```ts
  const ctx = new GitContext({
    owner: 'o', repo: 'r', selfHost: true, token: 't',
    gitIdentity: { authorName: 'T', authorEmail: 't@e.co', committerName: 'T', committerEmail: 't@e.co' },
    frameworkRepoRoot: tempDir, targetReposDir: tempDir,
  });
  copyClaudeAssetsToWorktree(tempDir, ctx);
  ```
  (The default `execSync` runner runs real `git ls-files` in `tempDir`, preserving the E4a–E4e fixture assertions.)
- `adws/phases/__tests__/workflowInit.test.ts`: add `headShort: vi.fn().mockReturnValue('abc1234')` to the `mockGitCtx` object so the version-log line resolves. (`copyClaudeAssetsToWorktree` is already mocked there, so its new arg needs no test change.)
- Search for any other callers of the changed signatures across the repo (including `features/` step definitions) and update them: `grep -rn "copyClaudeAssetsToWorktree\|getLastAdwCommitTimestamp" --include=*.ts --include=*.tsx`.

### Task 11 — Add a focused test for the migrated diagnostic and detector (optional but recommended)
- Add/extend a unit test asserting `getLastAdwCommitTimestamp` parses `%aI %s` output and returns the timestamp of the first ADW-formatted commit, using a spy-exec `GitContext` (no real git). This locks the `git log` migration's parsing contract.

### Task 12 — Run all Validation Commands
- Execute every command in the `Validation Commands` section and confirm zero errors and zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope (framework: `vitest`, run via `bun run test:unit`).

- **New — `gitReadOps`/`GitContext` read methods** (`adws/gitContext/__tests__/gitReadOps.test.ts` or appended to `gitContextOperations.test.ts`): for each of `lsFiles`, `headShort`, `diff`, `log`, assert the exact command string, the `cwd` (explicit arg and `basePath` default where applicable), per-command `GH_TOKEN` + four `GIT_*` env injection, `process.env` non-mutation, two-context isolation (a shared spy never bleeds tokens), return-value parsing, and error propagation on a throwing spy. These are the highest-value tests — they assert externally observable behaviour (command/cwd/env), matching the PRD's testing philosophy and the #693 precedent.
- **Updated — `worktreeSetup.test.ts`**: existing E4a–E4e fixture tests continue to pass with the new `copyClaudeAssetsToWorktree(tempDir, ctx)` signature and a real-exec `GitContext`, proving `lsFiles` correctly drives the tracked-file/tracked-dir gitignore policy against a real temp repo.
- **Updated — `workflowInit.test.ts`**: `mockGitCtx.headShort` stub keeps the initialization path green; asserts the migration did not alter the init flow.
- **New (recommended) — `prCommentDetector`**: spy-exec `GitContext` confirms `getLastAdwCommitTimestamp` builds the correct `git log` command and parses the first ADW-formatted commit timestamp.

### Edge Cases
- **`lsFiles` with no prefix vs. with prefix** — `checkLivingDocsIndex` (no prefix → all tracked files) vs. `worktreeSetup` (prefix → scoped); verify both command shapes and that blank trailing lines are filtered out.
- **`git` failure at each site** — propagation is caught by each call site's own wrapper: `worktreeSetup` → empty `Set`; `workflowInit` → version log skipped; `diffEvaluationPhase` → `''` + warn → `safe`; `prCommentDetector` → `null` + error log; `checkLivingDocsIndex` → propagates (loud crash, preserved).
- **Empty / no-context diff** — `executeDiffEvaluationPhase` with `config.gitContext === undefined` or an empty diff still classifies `safe` (existing fail-open behavior, deliberately preserved).
- **Large diff (> 1 MB)** — the 10 MB `maxBuffer` bump prevents `ENOBUFS`; the prior code set exactly 10 MB.
- **`headShort` target-repo run** — passing `frameworkRepoRoot` (not `basePath`) keeps the "ADW version" log pointing at the framework repo even when `gitCtx` is a target context.
- **`git log` base path** — defaulting to `basePath` correctly targets the target-repo workspace for target runs (a latent-bug correction; see Notes), while equalling the prior `process.cwd()` (= `REPO_ROOT`) for self-host runs.
- **Guard regression** — after ALLOWLIST removal, `lint:git-guard` must report the five files as scanned-and-clean (no violation), and re-adding a raw `git`/`gh` string to any of them must fail the guard (the invariant is now mechanically enforced).

## Acceptance Criteria
- [ ] `GitContext` exposes `lsFiles`, `headShort`, `diff`, and `log` read methods, backed by a new `adws/gitContext/gitReadOps.ts` package-private ops module.
- [ ] `adws/phases/worktreeSetup.ts`, `adws/phases/workflowInit.ts`, `adws/phases/diffEvaluationPhase.ts`, `adws/github/prCommentDetector.ts`, and `adws/checkLivingDocsIndex.ts` route all their git reads through `GitContext` and no longer import/use `execSync` for git.
- [ ] Those five files are removed from `ALLOWLIST` in `adws/checkGitGhGuard.ts`.
- [ ] `bun run lint:git-guard` passes (the five files scanned, zero violations).
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all pass with zero regressions.
- [ ] `bunx tsx adws/checkLivingDocsIndex.ts` still passes end-to-end (now via `GitContext`).
- [ ] No behavior change at any call site except the documented `git log`/diff base-path correction for target repos; public signatures of `getUnaddressedComments`/`hasUnaddressedComments` are unchanged (cron + prReviewPhase untouched).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions (sourced from `.adw/commands.md`):

- `bun run lint:git-guard` — **primary acceptance gate**: confirms no direct git/gh shell-outs outside `GitContext`; the five migrated files must now be scanned and clean.
- `bun run lint` — ESLint, including the dead-`execSync`-import check (unused imports must be gone).
- `bunx tsc --noEmit` — root type check (the `test` script) across all new/changed signatures.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW project type check (additional type check from `.adw/commands.md`).
- `bun run test:unit` — full Vitest suite; new `gitReadOps`/method tests plus updated `worktreeSetup`/`workflowInit` tests pass, zero regressions.
- `bun run build` — `tsc` build to verify no build errors.
- `bunx tsx adws/checkLivingDocsIndex.ts` — re-run the migrated diagnostic gate end-to-end (now constructs a self-host `GitContext`); must still report all checks passed.

## Notes
- **No coding-guidelines file present.** Neither `.adw/coding_guidelines.md` nor `guidelines/coding_guidelines.md` exists in this repo; follow the in-repo conventions instead (the #693 ops-module pattern is the canonical reference).
- **No new libraries.** This slice adds zero dependencies. (Per `.adw/commands.md`, the library install command would be `bun add <package>` if one were needed.)
- **Intentional latent-bug correction (PRD-aligned).** `prCommentDetector`'s `git log` previously ran with an implicit `process.cwd()` (= framework `REPO_ROOT` for the cron). For self-host runs `basePath` equals that, so behavior is identical. For **target** repos, routing through `GitContext` makes `git log` run in the correct target-repo `basePath` instead of the framework root where the branch does not exist — exactly the wrong-repo class this PRD eliminates. This is a fix, not a regression; call it out in the PR body.
- **Diagnostic gate now requires auth context.** `checkLivingDocsIndex.ts` constructs a real `GitContext`, which resolves a token via `gitContextForRepo` (GitHub App → `GH_TOKEN` → `gh auth token`). The gate is a manually/CI-run one-off (not wired into `package.json` scripts), and CI/operators have `gh` auth available, so this is an accepted consequence of the "no context-free git" invariant. If a token-free local run is ever needed, that is a separate follow-up — do **not** weaken `GitContext`'s mandatory-token contract for it.
- **`maxBuffer` bump is global to `defaultExec`.** Raising it to 10 MB affects every spawned command, not just `diff`. This is strictly more permissive (commands that fit under 1 MB are unaffected; only the previously-failing >1 MB case now succeeds) and matches the diff ceiling the code already relied on. Spy-`ExecFn` tests do not exercise `maxBuffer` (it only applies to the real `execSync` path), so no test depends on the value.
- **Error-propagation design choice.** All four `gitReadOps` functions let exec errors propagate; every call site retains its pre-existing `try/catch` (or, for `checkLivingDocsIndex`, its pre-existing no-catch). This keeps error behavior byte-identical and the ops module pure — distinct from `worktreeProbeOps`, whose callers expected swallow-to-null/`missing`.
- **`copyClaudeAssetsToWorktree` signature change blast radius.** Verified the only production caller is `workflowInit.ts` (two sites); it is re-exported through `phases/index.ts`, `workflowInit.ts`, and `adws/index.ts` but not called elsewhere in `adws/`. Re-grep including `features/` step definitions before finalizing (Task 10).
- **Method naming.** The four method names (`lsFiles`, `headShort`, `diff`, `log`) are taken verbatim from the issue's acceptance criteria. `GitContext` has no pre-existing members or imports named `log`, so the `log` method does not collide.
