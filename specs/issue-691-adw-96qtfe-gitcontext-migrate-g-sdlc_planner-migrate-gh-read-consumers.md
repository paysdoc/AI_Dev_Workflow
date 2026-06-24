# Feature: GitContext — migrate residual gh issue/PR read consumers (triggers/phases)

## Metadata
issueNumber: `691`
adwId: `96qtfe-gitcontext-migrate-g`
issueJson: `{"number":691,"title":"GitContext: migrate gh issue/PR read sites (triggers/phases)","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md` — completes the Enforcement section (drive the guard ALLOWLIST to zero; the guard shipped as a ratchet, not the spec'd invariant).\n\n## What to build\nAdd gh-read methods to GitContext (e.g. `listOpenIssues`, issue/PR `view` as needed; `fetchPRList` exists) and migrate the residual gh-read consumers onto them, removing each from the guard ALLOWLIST. Behavior unchanged; per-command auth via the existing `#run` chokepoint.\n\n## Acceptance criteria\n- [ ] New gh-read method(s) on GitContext, going through `#run`\n- [ ] concurrencyGuard, webhookGatekeeper, docsSelfCheck, takeoverHandler, perIssueScenarioSweep route through GitContext (no raw `gh`)\n- [ ] Those files removed from `ALLOWLIST` in checkGitGhGuard.ts\n- [ ] `bun run lint:git-guard` passes; unit tests green\n\n## Blocked by\nNone - can start immediately\n\n## Touched Files\n- adws/gitContext/gitContext.ts\n- adws/gitContext/commands/issueCommands.ts\n- adws/gitContext/commands/prCommands.ts\n- adws/triggers/concurrencyGuard.ts\n- adws/triggers/webhookGatekeeper.ts\n- adws/phases/docsSelfCheck.ts\n- adws/triggers/takeoverHandler.ts\n- adws/triggers/perIssueScenarioSweep.ts\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 5\n- User story 8\n- User story 18","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-06-23T11:45:25Z","comments":[],"actionableComment":null}`

## Feature Description

The `GitContext` deep module (`adws/gitContext/`) is ADW's single authority for every `git` and `gh` interaction: it bakes in the repo identity, resolves the filesystem base path in one constructor, and injects per-command auth (token/PAT + git identity) through a single private `#run()` chokepoint that never mutates `process.env`. A CI/lint guard (`adws/checkGitGhGuard.ts`, run via `bun run lint:git-guard`) fails the build on any direct `git`/`gh` shell-out outside the package.

That guard shipped as a **ratchet** rather than the invariant the PRD specifies: it carries an `ALLOWLIST` of files still permitted to shell out directly. The PRD's Enforcement section is only complete when that allowlist is driven to zero (excluding the permanent bootstrap/diagnostic entries that genuinely cannot use a context before it exists).

This feature migrates the five residual **gh-read** consumers off raw `gh` and onto new `GitContext` read methods, then removes each from the `ALLOWLIST`:

- `adws/triggers/concurrencyGuard.ts` — `gh issue list … --json number,comments` (in-progress issue count)
- `adws/triggers/webhookGatekeeper.ts` — `gh issue list … --json number,body` (×2: dependency unblock + abandoned-dependent close)
- `adws/phases/docsSelfCheck.ts` — `gh issue list … --search … --json number,title` (existing-refactor-issue dedup)
- `adws/triggers/takeoverHandler.ts` — `gh issue view … --json comments --jq '.comments'` (adwId resolution from issue comments)
- `adws/triggers/perIssueScenarioSweep.ts` — `gh pr list … --state merged --json body,mergedAt` (PR merge date lookup)

Behavior is unchanged end-to-end. The value is the structural guarantee: per-command auth (killing the `GH_TOKEN`-bleed class), correct base-path/repo scoping (killing the wrong-repo class), and a mechanically-enforced invariant rather than a convention-plus-allowlist.

## User Story

As an **ADW maintainer** (PRD user stories 5, 8, 18)
I want every residual issue/PR **read** site to go through `GitContext` and be removed from the guard allowlist
So that the `gh` target repo is never ambiguous, auth is applied per command rather than via a process-global, and a new call site cannot reintroduce the wrong-repo / token-bleed class of bug because direct `gh` reads become unrepresentable outside the package.

## Problem Statement

Five files still shell out to `gh` directly for issue/PR reads. They are tolerated only because they sit on the guard's `ALLOWLIST`. Each is an independent ad-hoc derivation of "which repo am I authenticated against and operating on": they call `gh … --repo ${owner}/${repo}` from the ambient `process.cwd()` with the ambient `process.env` (i.e. whatever `GH_TOKEN` the long-lived process last set). This is exactly the surface the GitContext PRD was written to eliminate:

- In a long-lived webhook process handling interleaved multi-repo events, the ambient token can be the wrong repo's (the `GH_TOKEN`-bleed class, PRD story 7).
- `takeoverHandler.resolveAdwId` failing to read comments against the right repo returns `null`, which silently degrades a *takeover* into a *fresh spawn* — a real correctness hazard for self-hosted issues.

Until these are migrated and de-allowlisted, the PRD's Enforcement invariant ("the build fails when someone shells out to git or gh directly", story 8) is not actually in force — it is a ratchet with five open exceptions.

## Solution Statement

Add three thin gh-**read** methods to `GitContext`, each delegating to a pure command-string builder under `adws/gitContext/commands/` and routed through the existing `#run()` chokepoint (per-command auth, explicit `cwd`, no `process.env` mutation) — mirroring the established thin-method + command-builder pattern (`fetchIssue`, `fetchPRList`, `fetchAllPRs`):

1. `listOpenIssues({ fields, search?, limit? })` — `gh issue list --repo o/r --state open --json <fields> [--search "…"] [--limit N]`. Covers concurrencyGuard, webhookGatekeeper (×2), and docsSelfCheck (the three differ only by projected fields / search / limit).
2. `issueComments(issueNumber)` — `gh issue view N --repo o/r --json comments --jq '.comments'`. Covers takeoverHandler.
3. `fetchMergedPRs(limit?)` — `gh pr list --repo o/r --state merged --json body,mergedAt --limit N`. Covers perIssueScenarioSweep.

Then migrate each consumer to construct a context via **`gitContextForRepo(repoInfo)`** (the established factory used throughout `adws/github/`, which auto-detects self-host so the base path always resolves to a directory that exists) and call the new method — preserving every existing function signature, `try/catch`, and JSON-parse shape so behavior is unchanged. `webhookGatekeeper.handleIssueClosedDependencyUnblock` already receives an optional per-event `gitContext`; it will prefer that and fall back to the factory.

Finally, remove the five files from the `ALLOWLIST` in `checkGitGhGuard.ts` and clean up the now-unused `execSync` / `execWithRetry` imports so `bun run lint:git-guard`, `lint`, type-check, and unit tests all pass.

## Relevant Files

Use these files to implement the feature:

### Core module — new read methods land here
- `adws/gitContext/gitContext.ts` — the `GitContext` class. Add `listOpenIssues`, `issueComments`, `fetchMergedPRs` as thin methods routed through `#run()` (mirroring `fetchIssue` / `fetchPRList`). Import the new command builders.
- `adws/gitContext/commands/issueCommands.ts` — pure `gh` issue command-string builders (no I/O). Add `listOpenIssuesCmd` (with a `ListOpenIssuesOptions` type) and `issueCommentsCmd`.
- `adws/gitContext/commands/prCommands.ts` — pure `gh` PR command-string builders. Add `fetchMergedPRsCmd`.

### Consumers to migrate (remove raw `gh`)
- `adws/triggers/concurrencyGuard.ts` — `fetchOpenIssuesWithComments` → `gitContextForRepo(repoInfo).listOpenIssues({ fields: ['number','comments'], limit: 100 })`. Drop the `execSync` import.
- `adws/triggers/webhookGatekeeper.ts` — `handleIssueClosedDependencyUnblock` (prefer the passed `gitContext`, else factory) and `closeAbandonedDependents` (factory) → `listOpenIssues({ fields: ['number','body'], limit: 100 })`. Change `import { spawn, execSync }` → `import { spawn }` (spawn is still used by `spawnDetached`/`ensureCronProcess`).
- `adws/phases/docsSelfCheck.ts` — `findExistingRefactorIssueDefault` → `gitContextForRepo(repoInfo).listOpenIssues({ fields: ['number','title'], search: \`docs-bloat: ${docPath}\`, limit: 5 })`. Drop `execWithRetry` from the `../core` import (note: this drops the per-call retry wrapper — acceptable, see Notes).
- `adws/triggers/takeoverHandler.ts` — `buildDefaultTakeoverDeps().resolveAdwId` → `gitContextForRepo(repoInfo).issueComments(issueNumber)` then `JSON.parse` → `extractLatestAdwId`. Drop the `execSync` import (its only use is `resolveAdwId`; `killProcess` uses `process.kill`, `resetWorktree` already uses a context).
- `adws/triggers/perIssueScenarioSweep.ts` — `defaultGetMergedAt` → `gitContextForRepo(getRepoInfo()).fetchMergedPRs(200)`. Drop the `execSync` import.

### Enforcement
- `adws/checkGitGhGuard.ts` — remove these five `ALLOWLIST` entries (and only these): `adws/phases/docsSelfCheck.ts`, `adws/triggers/concurrencyGuard.ts`, `adws/triggers/perIssueScenarioSweep.ts`, `adws/triggers/takeoverHandler.ts`, `adws/triggers/webhookGatekeeper.ts`. Leave all bootstrap/diagnostic/other-residual entries (e.g. `trigger_cron.ts`) untouched.

### Supporting context (read, do not necessarily modify)
- `adws/github/gitContextFactory.ts` — `gitContextForRepo(repoInfo)` (auto self-host detection + per-repo token); the construction helper every migrated consumer uses. Import it directly from `'../github/gitContextFactory'` (its established import path; it is **not** re-exported from `adws/github/index.ts`).
- `adws/triggers/cronStageResolver.ts` — `extractLatestAdwId(comments: { body: string }[])` consumes only `.body`, confirming `issueComments` need only preserve the comment `body` shape.
- `adws/github/issueApi.ts` / `adws/github/prApi.ts` — reference implementations of the `gitContextForRepo(repoInfo).method()` consumption pattern and its test mocking.
- `specs/prd/git-context-repo-authority.md` — the parent PRD (Solution, Enforcement, stories 5/7/8/18).

### Conditional docs (matched conditions — read before editing the relevant files)
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns `adws/gitContext/**`, `adws/gitContext/commands/**`, `adws/github/gitContextFactory.ts`. Condition: "When adding a new `gh` operation method or worktree method to `GitContext` (follow the thin-method + package-private-op pattern)" and "When working with `adws/gitContext/commands/` pure command builders or parsers".
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — owns `adws/checkGitGhGuard.ts`, `.github/workflows/git-cli-guard.yml`. Condition: "When migrating a residual allowlisted file to GitContext methods and removing it from the ALLOWLIST" and "When the `bun run lint:git-guard` script exits 1".
- `app_docs/feature-9gjajh-webhook-triggers.md` — owns `webhookGatekeeper.ts`. Condition: "When `classifyAndSpawnWorkflow`'s optional `gitContext` parameter … is relevant".
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — owns `takeoverHandler.ts`, `concurrencyGuard.ts`.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — owns `perIssueScenarioSweep.ts` (and `issueEligibility.ts`, which calls `isConcurrencyLimitReached`).
- `app_docs/feature-ih6ju7-app-docs-living-docs-post-write-guards.md` — owns `docsSelfCheck.ts`. Condition: "When implementing or troubleshooting `executeDocsPostWriteSelfCheck` or `DocsSelfCheckDeps`".
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` / `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` — also own `takeoverHandler.ts` (`EvaluateCandidateInput.gitContext`, `evaluateCandidate` recovery branches); read before touching `resolveAdwId`/deps.

### Existing test files to extend
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — `makeSpyExec` pattern (asserts command string, `cwd === basePath`, injected `GH_TOKEN`/`GIT_*`, trimmed return). Add cases for the three new methods.
- `adws/triggers/__tests__/takeoverHandler.test.ts` — extensive; deps are injected so existing cases stay green. Add a default-path case for `resolveAdwId`.
- `adws/triggers/__tests__/webhookGatekeeper.test.ts` — extend for the two `listOpenIssues` paths.
- `adws/triggers/__tests__/perIssueScenarioSweep.test.ts` — injects `getMergedAt`; add a default-path case routing through `fetchMergedPRs`.

### New Files
- `adws/triggers/__tests__/concurrencyGuard.test.ts` — no test exists today; add coverage for the `listOpenIssues` routing + in-progress count.
- `adws/phases/__tests__/docsSelfCheck.test.ts` — no test exists today; add coverage for `findExistingRefactorIssueDefault` routing through `gitContextForRepo(...).listOpenIssues` (mock the factory).

## Implementation Plan

### Phase 1: Foundation — add read methods to the GitContext package
Extend the pure command-builders, then add three thin methods on `GitContext` that route through `#run()`. This is purely additive; no consumer or guard change yet, so the codebase stays green throughout. After this phase the new methods exist and are unit-tested in isolation.

### Phase 2: Core Implementation — migrate the five consumers
Replace each raw `execSync`/`execWithRetry` `gh` call with `gitContextForRepo(repoInfo).<newMethod>(...)`, preserving every signature, `try/catch`, default-return, and JSON shape. Clean up the now-unused `child_process`/`core` imports. The webhook dependency-unblock path prefers its already-threaded per-event `gitContext`.

### Phase 3: Integration — flip the enforcement and validate
Remove the five entries from the guard `ALLOWLIST`, then run the full validation suite (`lint:git-guard`, `lint`, type-checks, unit tests, build) to confirm the invariant now holds with zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1 — Read context
- Read `specs/prd/git-context-repo-authority.md` (Solution + Enforcement), `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`, and `app_docs/feature-bq1f45-git-gh-cli-guard.md`.
- Re-read `adws/gitContext/gitContext.ts`, `adws/gitContext/commands/issueCommands.ts`, `adws/gitContext/commands/prCommands.ts`, and `adws/github/gitContextFactory.ts` to lock in the thin-method + command-builder + `gitContextForRepo` patterns.

### Step 2 — Add issue command builders
- In `adws/gitContext/commands/issueCommands.ts`, add an exported `ListOpenIssuesOptions` interface (`readonly fields: readonly string[]; readonly search?: string; readonly limit?: number`) and `listOpenIssuesCmd(owner, repo, opts)` that builds `gh issue list --repo o/r --state open --json <fields.join(',')>`, appending `--search "<search>"` and `--limit <limit>` only when provided.
- Add `issueCommentsCmd(owner, repo, issueNumber)` returning `gh issue view ${issueNumber} --repo ${owner}/${repo} --json comments --jq '.comments'`.

### Step 3 — Add PR command builder
- In `adws/gitContext/commands/prCommands.ts`, add `fetchMergedPRsCmd(owner, repo, limit = 200)` returning `gh pr list --repo ${owner}/${repo} --state merged --json body,mergedAt --limit ${limit}`.

### Step 4 — Add GitContext methods
- In `adws/gitContext/gitContext.ts`, import the new builders + `ListOpenIssuesOptions` from `./commands/issueCommands` and `fetchMergedPRsCmd` from `./commands/prCommands`.
- Add `listOpenIssues(opts: ListOpenIssuesOptions): string { return this.#run(listOpenIssuesCmd(this.#owner, this.#repo, opts)); }`.
- Add `issueComments(issueNumber: number): string { return this.#run(issueCommentsCmd(this.#owner, this.#repo, issueNumber)); }`.
- Add `fetchMergedPRs(limit?: number): string { return this.#run(fetchMergedPRsCmd(this.#owner, this.#repo, limit)); }`.
- Place them alongside the existing issue/PR read methods; keep them thin (no parsing — callers `JSON.parse`, matching `fetchIssue`/`fetchPRList`).

### Step 5 — Unit-test the new methods
- In `adws/gitContext/__tests__/gitContextOperations.test.ts`, using `makeSpyExec`, add cases asserting, for each new method: exact command string (including `--search`/`--limit` presence/absence and the `--jq '.comments'` form), `cwd === ctx.basePath`, injected `GH_TOKEN` + `GIT_*` env, no `process.env` mutation, and trimmed return value. Include `fetchMergedPRs()` defaulting to `--limit 200`.
- Run `bun run test:unit` (gitContext suite) — expect green.

### Step 6 — Migrate `concurrencyGuard.ts`
- Replace the `execSync('gh issue list … --json number,comments --limit 100')` in `fetchOpenIssuesWithComments` with `gitContextForRepo(repoInfo).listOpenIssues({ fields: ['number', 'comments'], limit: 100 })`.
- Add `import { gitContextForRepo } from '../github/gitContextFactory';`; remove the now-unused `import { execSync } from 'child_process';`. Keep the existing `try/catch` returning `[]`.

### Step 7 — Migrate `webhookGatekeeper.ts`
- In `handleIssueClosedDependencyUnblock`, build `const ctx = gitContext ?? gitContextForRepo(repoInfo);` and replace the `execSync` list with `ctx.listOpenIssues({ fields: ['number', 'body'], limit: 100 })`.
- In `closeAbandonedDependents`, replace the `execSync` list with `gitContextForRepo(repoInfo).listOpenIssues({ fields: ['number', 'body'], limit: 100 })` (signature unchanged → no `webhookHandlers.ts` change).
- Add `import { gitContextForRepo } from '../github/gitContextFactory';`; change `import { spawn, execSync } from 'child_process';` → `import { spawn } from 'child_process';`. Preserve both `try/catch` blocks.

### Step 8 — Migrate `docsSelfCheck.ts`
- In `findExistingRefactorIssueDefault`, replace the `execWithRetry('gh issue list … --search "docs-bloat: ${docPath}" --json number,title --limit 5')` with `gitContextForRepo(repoInfo).listOpenIssues({ fields: ['number', 'title'], search: \`docs-bloat: ${docPath}\`, limit: 5 })`.
- Add `import { gitContextForRepo } from '../github/gitContextFactory';`; remove `execWithRetry` from the `import { execWithRetry, log as defaultLog, type LogLevel } from '../core';` line. Keep the `try/catch` returning `null` and the `results.find(...title.includes(docPath))` filter.

### Step 9 — Migrate `takeoverHandler.ts`
- In `buildDefaultTakeoverDeps`, rewrite `resolveAdwId` to `const json = gitContextForRepo(repoInfo).issueComments(issueNumber); const comments = JSON.parse(json) as { body: string }[]; return extractLatestAdwId(comments);` inside the existing `try/catch` returning `null`.
- Add `import { gitContextForRepo } from '../github/gitContextFactory';`; remove `import { execSync } from 'child_process';` (no other use). Leave `resetWorktree`/`gitContextForSync` and all injected-deps seams untouched.

### Step 10 — Migrate `perIssueScenarioSweep.ts`
- In `defaultGetMergedAt`, replace the `execSync('gh pr list … --state merged --json body,mergedAt --limit 200')` with `gitContextForRepo(getRepoInfo()).fetchMergedPRs(200)`, keeping the `bodyLinksIssue` filter, `mergedAt` parsing, and `Promise.resolve(...)` returns intact.
- Add `import { gitContextForRepo } from '../github/gitContextFactory';`; remove `import { execSync } from 'child_process';`. Keep `getRepoInfo`/`bodyLinksIssue` imports.

### Step 11 — Add/extend consumer unit tests
- New `adws/triggers/__tests__/concurrencyGuard.test.ts`: `vi.mock('../../github/gitContextFactory')` with `gitContextForRepo` returning a fake ctx whose `listOpenIssues` returns canned JSON; assert in-progress count and the empty/throw → `[]` fallback (mirror `adws/github/__tests__/prApi.test.ts`).
- New `adws/phases/__tests__/docsSelfCheck.test.ts`: mock the factory; assert `findExistingRefactorIssueDefault` returns the matching issue number, `null` when none matches, and `null` on throw.
- Extend `webhookGatekeeper.test.ts`, `takeoverHandler.test.ts` (default-`resolveAdwId` path), and `perIssueScenarioSweep.test.ts` (default-`getMergedAt` path) to cover the factory-routed defaults.

### Step 12 — Remove the five ALLOWLIST entries
- In `adws/checkGitGhGuard.ts`, delete exactly the `adws/phases/docsSelfCheck.ts`, `adws/triggers/concurrencyGuard.ts`, `adws/triggers/perIssueScenarioSweep.ts`, `adws/triggers/takeoverHandler.ts`, and `adws/triggers/webhookGatekeeper.ts` lines from `ALLOWLIST`. Do not remove any other entry.

### Step 13 — Validate (zero regressions)
- Run every command in **Validation Commands**. All must exit 0. In particular `bun run lint:git-guard` must PASS with the five files now scanned (proving no residual raw `git`/`gh` remains in them), and `bun run test:unit` must be green.

## Testing Strategy

### Unit Tests
Unit tests are enabled (`.adw/project.md` → `## Unit Tests: enabled`).

- **GitContext read methods** (`adws/gitContext/__tests__/gitContextOperations.test.ts`, highest value — mirrors existing `defaultBranch` cases via `makeSpyExec`):
  - `listOpenIssues`: builds `gh issue list --repo o/r --state open --json number,comments --limit 100`; omits `--search`/`--limit` when not supplied; includes `--search "docs-bloat: <path>"` and `--limit 5` when supplied; runs with `cwd === basePath`; injects context `GH_TOKEN` + four `GIT_*` vars; does not mutate `process.env`; returns trimmed stdout.
  - `issueComments`: builds `gh issue view N --repo o/r --json comments --jq '.comments'`; same env/cwd/non-mutation assertions.
  - `fetchMergedPRs`: builds `gh pr list --repo o/r --state merged --json body,mergedAt --limit 200` (default) and honors an explicit limit.
- **Consumer routing** (mock `gitContextForRepo` per the `adws/github/__tests__/prApi.test.ts` precedent):
  - `concurrencyGuard`: in-progress count over canned issues/PRs; `[]` fallback on parse/throw.
  - `docsSelfCheck.findExistingRefactorIssueDefault`: match by title-contains, `null` when absent, `null` on throw.
  - `webhookGatekeeper`: `handleIssueClosedDependencyUnblock` prefers the passed `gitContext`; both paths parse `number,body` and filter dependents.
  - `takeoverHandler` default `resolveAdwId`: parses `issueComments` JSON → `extractLatestAdwId`; `null` on throw.
  - `perIssueScenarioSweep` default `getMergedAt`: parses `fetchMergedPRs` JSON, applies `bodyLinksIssue`, returns the parsed `mergedAt` date.

### Edge Cases
- **Self-host vs target repo base path**: `gitContextForRepo` auto-detects self-host, so `basePath` always resolves to an existing directory (framework root for self-host, `targetReposDir/owner/repo` for targets). This is why the factory (not a hardcoded `selfHost: false`) is used — a wrong base path would make `#run`'s `cwd` nonexistent and throw `ENOENT`. The correct `--repo owner/repo` argument keeps the gh target explicit regardless.
- **Empty result sets**: `listOpenIssues`/`fetchMergedPRs` returning `[]` → `JSON.parse('[]')` → no dependents / zero count / `null` merge date (unchanged).
- **Read failure (auth, transient, nonexistent cwd)**: every migrated site keeps its `try/catch` returning the prior safe default (`[]`, `null`), so a throw degrades exactly as before.
- **`takeoverHandler.resolveAdwId` → `null`**: still yields `spawn_fresh` (unchanged); correct self-host scoping via the factory prevents the *new* failure mode of mis-scoped reads silently turning a takeover into a fresh spawn.
- **`docsSelfCheck` retry loss**: the old call used `execWithRetry`; `#run` does not retry. A transient `gh` failure now resolves to `null` (dedup fails open → at worst a duplicate refactor issue is filed) — consistent with the existing fail-open `catch`. Documented in Notes.
- **Search quoting**: `--search "docs-bloat: ${docPath}"` preserves the original double-quoting; `docPath` is a repo-relative `app_docs/…md` path.
- **Guard exactness**: only the five entries are removed; `trigger_cron.ts` and all bootstrap/diagnostic entries remain allowlisted (verified by `lint:git-guard` still passing).

## Acceptance Criteria
- `GitContext` exposes `listOpenIssues`, `issueComments`, and `fetchMergedPRs`, each delegating to a pure command builder and routed through the `#run()` chokepoint (per-command auth, explicit cwd, no `process.env` mutation).
- `concurrencyGuard.ts`, `webhookGatekeeper.ts` (both call sites), `docsSelfCheck.ts`, `takeoverHandler.ts`, and `perIssueScenarioSweep.ts` contain no direct `git`/`gh` shell-outs; all issue/PR reads go through `gitContextForRepo(...)` methods.
- The five files are removed from `ALLOWLIST` in `adws/checkGitGhGuard.ts`; no other entry is changed.
- Now-unused `execSync` / `execWithRetry` imports are removed (no lint/unused-import failures); `webhookGatekeeper` retains `spawn`.
- Behavior is unchanged: every migrated function keeps its signature, `try/catch`, default return, and parsed shape.
- `bun run lint:git-guard` passes with the five files scanned; `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all succeed.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint:git-guard` — Git/GH CLI guard; must PASS (`✔ PASS No direct git/gh shell-outs outside GitContext`) with the five de-allowlisted files now scanned. This is the primary acceptance gate.
- `bun run test:unit` — Vitest (`vitest run`); all unit tests green, including the new GitContext-method and consumer-routing tests.
- `bun run lint` — ESLint (`eslint .`); zero errors, including no unused-import warnings from the removed `execSync`/`execWithRetry`.
- `bunx tsc --noEmit` — root type-check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW project type-check (additional type checks from `.adw/commands.md`); zero errors.
- `bun run build` — `tsc` build; no build errors.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep new methods pure/thin (clarity over cleverness, single responsibility, immutability — build command strings, return raw stdout, let callers parse). Use guard clauses, avoid `any`, prefer explicit types (`ListOpenIssuesOptions`, `readonly` fields). Remove unused imports (code hygiene). No new libraries required — this is internal refactoring using existing `child_process`/`gh` plumbing inside the package.
- **Library install command** (`.adw/commands.md`): `bun add <package>` — not needed here (no new dependencies).
- **Import path for the factory**: `gitContextForRepo` is imported directly from `'../github/gitContextFactory'` (its established convention across `adws/github/`); it is intentionally **not** re-exported from `adws/github/index.ts`, so no index change is in scope.
- **Why `gitContextForRepo`, not `gitContextForSync({…, selfHost: false})`**: the latter hardcodes a target base path; for self-hosted ADW issues that directory does not exist and `#run`'s `cwd` would throw `ENOENT`. `gitContextForRepo` auto-detects self-host, matching how `issueApi`/`prApi` already consume the context.
- **Generic `listOpenIssues` vs three named methods**: the three issue-list sites differ only by projected fields / search / limit, so one parameterized read method (a clean projection of "list open issues") is preferred over three near-duplicates while still owning all `gh`-flag assembly in the pure builder. `issueComments` and `fetchMergedPRs` are distinct enough to warrant their own methods, consistent with the existing `fetchPRList`/`fetchAllPRs` split.
- **`issueComments` vs the existing `fetchIssueComments`**: `fetchIssueComments` uses the REST endpoint (`gh api …/comments --paginate`), a different command and JSON shape from takeover's `gh issue view … --json comments --jq '.comments'`. A dedicated `issueComments` method preserves takeover's exact command (behavior unchanged); both ultimately expose a `body` field, which is all `extractLatestAdwId` reads.
- **Scope discipline**: do not modify `issueEligibility.ts`, `webhookHandlers.ts`, or `adws/github/index.ts` — all five consumer signatures are preserved so no out-of-scope caller edits are required. Per the recurring "worktree born with dependency reversion" hazard, diff the full `.claude/`/doc tree against `origin/dev` before finalizing and revert any out-of-scope command-file or doc changes that appear in the working tree.
- **Future work (not this issue)**: the remaining `ALLOWLIST` residual entries that perform writes or git operations (e.g. `trigger_cron.ts`, `autoMergeHandler.ts`, `branchOperations.ts`) are separate migration slices toward the PRD's zero-allowlist goal.
