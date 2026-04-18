# Feature: Fix PAT fallback in GitHubBoardManager (ensureColumns + createBoard)

## Metadata
issueNumber: `446`
adwId: `hjcays-ensurecolumns-fails`
issueJson: `{"number":446,"title":"ensureColumns fails under app token: 'Resource not accessible by integration' — project board columns never created","body":"## Summary\n\nADW workflows are not creating the required Status columns (e.g. `Blocked`, `In Review`) on GitHub project boards. `GitHubBoardManager.ensureColumns` throws `gh: Resource not accessible by integration` when it queries the `ProjectV2` Status field under the GitHub App installation token. The board ends up with whatever columns were already there — missing ADW-required lanes such as `Blocked`.\n\nError from workflow `sy47h7-cli-skeleton-osv-sca` at `2026-04-17T14:10:55.930Z`:\n\n```\ngh: Resource not accessible by integration\n... while querying ProjectV2 field options for projectId PVT_kwHOADGAcc4BU6OU\n```\n\nThis bug has recurred: it was \"fixed\" in `b449834` (`fix: use PAT upfront for all project board operations`) and subsequently worked around in `ec4069e` / `80e64ea` (bulk mutation shape). Both passes patched only the legacy `adws/github/projectBoardApi.ts` and missed the new provider file introduced in PR #428 (`1c2a07e`).\n\n## Steps to Reproduce\n\n1. Configure an ADW target repo that is **user-owned** (not org-owned) — user-owned Projects V2 require a PAT; GitHub App installation tokens are rejected.\n2. Ensure the repo has a linked Projects V2 board.\n3. Trigger an ADW workflow that runs board-initialization (the `setupProjectBoard` path that calls `findBoard` → `ensureColumns`).\n\n**Observed:** `ensureColumns` logs `Failed to get status field options: ...Resource not accessible by integration...`, returns `false`, the function silently proceeds, and the board never gets the missing columns.\n\n**Expected:** All columns declared in `BOARD_COLUMNS` are present on the board after `ensureColumns` completes.\n\n## Root Cause\n\n`adws/providers/github/githubBoardManager.ts` has **partial** PAT-fallback coverage:\n\n- `findBoard()` (lines 78-97) does a *lazy* PAT fallback — tries the app token first, retries with `GITHUB_PAT` if the result is null, then **restores the original app token in its `finally` block** (line 92).\n- `createBoard()` (lines 106-172) does **no** PAT handling at all.\n- `ensureColumns()` (lines 181-196) calls `getStatusFieldOptions` (lines 226-262), which issues `gh api graphql` directly with **no** PAT fallback. Same for `updateStatusFieldOptions` (lines 264-279).\n\nProduction flow: `findBoard` runs → uses PAT in its inner retry → finally restores the app token → `ensureColumns` runs → `GH_TOKEN` is back to the app token → `getStatusFieldOptions` hits GitHub under the app token → `Resource not accessible by integration`.\n\nThe legacy `adws/github/projectBoardApi.ts::moveIssueToStatus` has the correct pattern from `b449834`: PAT set *upfront* in an outer try, restored in the outer finally, so **every** GraphQL call within the method runs under PAT. That pattern was never ported to the provider.\n\n### Why the fix slipped through twice\n\n- `1c2a07e` (PR #428) introduced `githubBoardManager.ts` as part of the BoardManager provider refactor. It copied only a truncated version of the PAT-fallback pattern — just the lazy retry in `findBoard`, nothing on the other methods.\n- `b449834` fixed the symptom in the legacy file (`projectBoardApi.ts::moveIssueToStatus`) but didn't audit the new provider.\n- `ec4069e` / `80e64ea` changed the mutation *shape* (bulk `updateProjectV2Field` with `ProjectV2SingleSelectFieldOptionInput[]`) but didn't touch auth handling.\n\n## Proposed Fix\n\nScope: `adws/providers/github/githubBoardManager.ts` only. Leave `adws/github/projectBoardApi.ts` untouched (different concern — per-issue status moves — already correctly patched).\n\n1. Add a private `withProjectBoardAuth<T>(fn: () => Promise<T>): Promise<T>` wrapper on `GitHubBoardManager` that applies the `b449834` pattern: `refreshTokenIfNeeded`, swap `GH_TOKEN` to `GITHUB_PAT` upfront if configured and different, restore in `finally`.\n2. Route all three public methods (`findBoard`, `createBoard`, `ensureColumns`) through `withProjectBoardAuth`.\n3. Delete the stale lazy-retry block in `findBoard` (lines 84-94) — redundant once the PAT is set upfront.\n\nReference implementation: `adws/github/projectBoardApi.ts::moveIssueToStatus` (lines 224-296).\n\n## Affected Files\n\n- `adws/providers/github/githubBoardManager.ts` — all three public methods + private helpers\n- No changes to `adws/github/projectBoardApi.ts` (already correct)\n- No changes to `adws/providers/github/githubIssueTracker.ts` (delegates to the already-correct legacy function)\n\n## Test Gap\n\nThe existing `features/project_board_pat_fallback.feature` checks only that specific strings exist in `adws/github/projectBoardApi.ts` — source-string linting, not behavioral testing. It does not inspect `githubBoardManager.ts` at all, and static greps cannot verify that a wrapper is actually invoked at runtime.\n\nA real-runtime integration test against a sandbox GitHub project is required to prevent a third regression. This is explicitly **out of scope for this PR** and tracked as a future effort — see the deferred design notes in auto-memory (`project_future_grill_integration_testing.md`). Open a follow-up issue when ready to design that.\n\n## References\n\n- Error log: workflow `sy47h7-cli-skeleton-osv-sca`, `2026-04-17T14:10:55.930Z`, projectId `PVT_kwHOADGAcc4BU6OU`\n- PR #428 — introduced `githubBoardManager.ts` (commit `1c2a07e`)\n- Commit `b449834` — correct reference pattern in `projectBoardApi.ts`\n- Commit `ec4069e` — bulk mutation shape change (did not re-audit auth)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-18T09:28:02Z","comments":[],"actionableComment":null}`

## Feature Description
Port the upfront PAT-swap auth pattern from `adws/github/projectBoardApi.ts::moveIssueToStatus` into the provider `adws/providers/github/githubBoardManager.ts` so that every GraphQL call issued by `findBoard`, `createBoard`, and `ensureColumns` runs under `GITHUB_PAT` when the GitHub App installation token cannot access Projects V2 (user-owned repos). Today, only `findBoard` has a partial lazy retry — it sets the PAT inside an inner block and restores the app token before returning, leaving `ensureColumns` / `createBoard` back on the app token for all of their subsequent GraphQL calls. The result is `gh: Resource not accessible by integration` during Status-field queries and mutations, and ADW-required lanes (`Blocked`, `In Review`, etc.) silently never get added to the board.

The fix introduces a private `withProjectBoardAuth<T>` wrapper that refreshes the token, swaps `GH_TOKEN → GITHUB_PAT` once at method entry, and unconditionally restores the original `GH_TOKEN` in a `finally` block. The three public methods are rewritten to delegate their bodies to this wrapper; the stale inner lazy-retry in `findBoard` is removed because it becomes redundant. No behavior changes for the no-PAT case (the wrapper is a no-op when `GITHUB_PAT` is not configured or equals the current token). Value: ADW workflows targeting user-owned repos will now create all required board columns on first run, preventing silent downstream failures (issues that can never be moved to `Blocked`, `In Review`, etc.).

## User Story
As an ADW operator running workflows against a user-owned GitHub repository with a linked Projects V2 board
I want `GitHubBoardManager.ensureColumns` to succeed when only `GITHUB_PAT` (not the GitHub App installation token) can access Projects V2
So that all ADW-required board columns are present after `initializeWorkflow` runs and downstream phases can move issues through `Blocked`, `In Review`, and other lanes without silent failures.

## Problem Statement
`GitHubBoardManager` (added in PR #428, commit `1c2a07e`) has asymmetric PAT-fallback coverage:

- `findBoard()` only sets `GITHUB_PAT` inside an inner retry block (lines 84-94) and restores the app token in its inner `finally` (line 92) before returning. This means by the time `ensureColumns()` runs, `GH_TOKEN` is back to the app token.
- `createBoard()` (lines 106-172) has no PAT handling.
- `ensureColumns()` (lines 181-196) delegates to `getStatusFieldOptions` and `updateStatusFieldOptions` which issue `gh api graphql` directly, with no PAT handling.

On user-owned Projects V2, the app token is refused with `Resource not accessible by integration`, `getStatusFieldOptions` logs a warning and returns `null`, and `ensureColumns` silently returns `false`. The board keeps whatever columns already existed — the `Blocked` lane that workflow-error handlers depend on is never created.

This has already recurred twice: `b449834` fixed the same symptom in the legacy `adws/github/projectBoardApi.ts::moveIssueToStatus` but did not audit the then-new `githubBoardManager.ts`; `ec4069e` / `80e64ea` later changed the mutation shape but did not touch auth.

## Solution Statement
Apply the `b449834` upfront-PAT-swap pattern uniformly to every public method on `GitHubBoardManager`:

1. Add a private method `withProjectBoardAuth<T>(fn: () => Promise<T>): Promise<T>` that calls `refreshTokenIfNeeded(owner, repo)`, checks `isGitHubAppConfigured() && GITHUB_PAT && GITHUB_PAT !== process.env.GH_TOKEN`, and if true saves `GH_TOKEN`, sets it to `GITHUB_PAT`, runs `fn()`, and restores the original token in a `finally` block. Log once (`info` level) when the swap occurs.
2. Rewrite `findBoard()`, `createBoard(name)`, and `ensureColumns(boardId)` to wrap their existing bodies in a single `return this.withProjectBoardAuth(async () => { ... });` call.
3. Delete the now-redundant inner lazy-retry block in `findBoard` (lines 84-94). `queryProjectId` remains unchanged because the wrapper already sets the correct token before it runs.
4. Add targeted unit tests that stub `process.env.GH_TOKEN` / `GITHUB_PAT` and assert: (a) wrapper swaps and restores the token, (b) restore happens even if the wrapped function throws, (c) no-op behavior when PAT is absent or equal to current token.
5. Add a BDD feature file (`features/fix_board_manager_pat_auth.feature`, tagged `@adw-446` at the feature level with `@regression` on each regression scenario) that inspects `adws/providers/github/githubBoardManager.ts` — this is source-level static checking like the existing `project_board_pat_fallback.feature`, to prevent the specific regression where someone re-adds unwrapped GraphQL calls to public methods. This closes the pattern-level test gap; true behavioral integration testing against a sandbox GitHub project is tracked as a separate out-of-scope effort.

Scope discipline: no changes to `projectBoardApi.ts`, `githubIssueTracker.ts`, or any caller of `GitHubBoardManager`. The wrapper is private to the class; it is not exported or reused elsewhere (YAGNI — the legacy file has its own local implementation and does not need refactoring).

## Relevant Files
Use these files to implement the feature:

- `adws/providers/github/githubBoardManager.ts` — **primary file to modify.** Contains `GitHubBoardManager` class with `findBoard` (lines 78-97), `createBoard` (106-172), `ensureColumns` (181-196), and private helpers `queryProjectId` (200-224), `getStatusFieldOptions` (226-262), `updateStatusFieldOptions` (264-279). The wrapper will be added as a new private method; the three public methods will be rewritten to delegate through it; the inner lazy-retry in `findBoard` will be deleted.
- `adws/github/projectBoardApi.ts` — **reference only, do not modify.** Lines 224-296 (`moveIssueToStatus`) are the canonical implementation of the upfront-PAT-swap pattern that must be ported. Use the structure of this function as the exact template for the wrapper's control flow.
- `adws/github/githubAppAuth.ts` — exports `refreshTokenIfNeeded(owner?, repo?)` (line 253) and `isGitHubAppConfigured(): boolean` (line 46). Already imported by `githubBoardManager.ts`.
- `adws/core/config.ts` — re-exports `GITHUB_PAT` (line 18) from `environment.ts`. Already imported by `githubBoardManager.ts`.
- `adws/core/environment.ts` — defines `export const GITHUB_PAT = process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;` (line 70). No changes needed.
- `adws/providers/types.ts` — declares `BoardManager` interface (`findBoard`, `createBoard`, `ensureColumns`) and `BOARD_COLUMNS`. The public contract does not change.
- `adws/providers/__tests__/boardManager.test.ts` — existing vitest unit test file. Add a new `describe('withProjectBoardAuth wrapper behavior', ...)` block here.
- `features/project_board_pat_fallback.feature` — existing BDD feature covering `projectBoardApi.ts` only. Reference for scenario style; **do not modify.**
- `features/step_definitions/projectBoardPatFallbackSteps.ts` — existing steps for the legacy file. Reference only; new steps for the new feature file will live in their own file.
- `features/step_definitions/commonSteps.ts` — check whether the `Given "<file>" is read` / `Then the file contains "..."` steps already exist here (they almost certainly do — used by many feature files). If so, the new feature file can reuse them without writing new step definitions.
- `app_docs/feature-qm6gwx-board-manager-provider.md` — conditional doc: BoardManager provider introduction. Read for context on how `findBoard` / `createBoard` / `ensureColumns` are invoked from `workflowInit.ts` and what "Blocked on error" flow depends on these columns existing.
- `app_docs/feature-w12d7t-fix-board-update-mutation.md` — conditional doc: prior fix to the same provider that established `mergeStatusOptions` and the bulk-mutation shape. Read to understand the current `ensureColumns` implementation and why the unit-test pattern in `boardManager.test.ts` was structured as it is.
- `app_docs/feature-9tknkw-project-board-pat-fallback.md` — conditional doc: canonical description of the upfront-PAT-swap pattern applied to `moveIssueToStatus`. The plan ports this exact pattern.
- `guidelines/coding_guidelines.md` — target-repo coding guidelines; keep files under 300 lines, prefer pure functions, isolate side effects at boundaries. The wrapper is a side-effectful boundary by design and should be explicitly scoped to minimize its effect window.

### New Files
- `features/fix_board_manager_pat_auth.feature` — new BDD feature file that asserts `adws/providers/github/githubBoardManager.ts` contains the upfront-PAT-swap pattern: has a `withProjectBoardAuth<T>` wrapper that calls `refreshTokenIfNeeded` before swapping, guards the swap with `isGitHubAppConfigured` and `GITHUB_PAT`, saves + assigns + restores `process.env.GH_TOKEN`, and that each of `findBoard` / `createBoard` / `ensureColumns` delegates to the wrapper. Also asserts the stale lazy-retry and in-method GH_TOKEN swap have been removed from `findBoard`, and that `projectBoardApi.ts` still retains its upfront PAT fallback. Feature-level tag: `@adw-446`; regression scenarios additionally tagged `@regression`.

## Implementation Plan

### Phase 1: Foundation
Understand the exact shape of the reference implementation and confirm the scope.

- Re-read `adws/github/projectBoardApi.ts` lines 224-296 to lock in the control flow: outer `try` with `let savedToken`, `let usingPatFallback`, token swap, operation, unconditional restore in outer `finally`.
- Confirm `adws/providers/github/githubBoardManager.ts` already imports `GITHUB_PAT`, `isGitHubAppConfigured`, and `refreshTokenIfNeeded` (lines 9-10). No new imports needed.
- Verify via Grep that `withProjectBoardAuth` is not already a used symbol elsewhere (it isn't, but confirm).

### Phase 2: Core Implementation
Introduce the wrapper, rewrite the three public methods, remove the now-redundant inner retry, and add unit tests.

- Add a new private method `withProjectBoardAuth<T>(fn: () => Promise<T>): Promise<T>` immediately after the `// ── Private helpers ─────────` comment on line 198. The method takes the repository context from `this.repoInfo`, performs the swap, invokes `fn()`, and restores the token. Log a one-line `info` message only when the swap actually occurs (matching the legacy wording: `"Using GITHUB_PAT for project board operations (app tokens lack Projects V2 access)"`).
- Rewrite `findBoard()` to call `return this.withProjectBoardAuth(async () => this.queryProjectId(owner, repo))`. Remove the inner `if (!projectId && isGitHubAppConfigured() && …)` retry block (lines 84-94). Remove the standalone `refreshTokenIfNeeded` call on line 80 because the wrapper now owns it.
- Wrap the body of `createBoard(name)` in `return this.withProjectBoardAuth(async () => { /* existing body */ })`.
- Wrap the body of `ensureColumns(boardId)` in `return this.withProjectBoardAuth(async () => { /* existing body */ })`.
- Preserve all existing behavior inside the wrapped bodies — no refactoring of `queryProjectId`, `getStatusFieldOptions`, `updateStatusFieldOptions`. They continue to use `execSync` with whatever `GH_TOKEN` is live in the environment when they run.
- Keep the existing `queryProjectId` `try/catch` that returns `null` and logs a `warn` — this is the right behavior for "no project linked at all", distinct from the auth failure that the wrapper now prevents.
- Ensure the file remains under 300 lines (per `guidelines/coding_guidelines.md`). Current file is ~290 lines; the wrapper adds ~20, deletion of the inner retry removes ~11. Net ~+9 lines. Expected final: ~299. If it crosses 300, the wrapper can be hoisted to a sibling `withAuthToken` helper in the same file (still local).

### Phase 3: Integration
Add tests, a BDD regression feature, and run validation.

- Add a new `describe('GitHubBoardManager.withProjectBoardAuth', …)` block to `adws/providers/__tests__/boardManager.test.ts`. Tests cover: (1) when `GITHUB_PAT` is set and different from `GH_TOKEN` and the app is configured, the wrapper swaps `GH_TOKEN` during `fn` execution and restores on return; (2) restore happens even if `fn` throws; (3) no-op when `GITHUB_PAT` is undefined; (4) no-op when `GITHUB_PAT` equals current `GH_TOKEN`. Use `vi.stubEnv` or manual save/restore in `beforeEach`/`afterEach` so tests don't leak env state. Mock `isGitHubAppConfigured` and `refreshTokenIfNeeded` via `vi.mock('../../github/githubAppAuth', …)`. Do **not** invoke the real `execSync`/`gh` — the wrapper itself is pure w.r.t. the inner function.
- Create `features/fix_board_manager_pat_auth.feature` (feature-level tag `@adw-446`, regression scenarios additionally tagged `@regression`) with scenarios targeting `adws/providers/github/githubBoardManager.ts`. At minimum:
  - `GitHubBoardManager` defines a `withProjectBoardAuth` wrapper
  - The wrapper is generic (`withProjectBoardAuth<T>`, `() => Promise<T>`, `Promise<T>`)
  - The wrapper calls `refreshTokenIfNeeded` before swapping `GH_TOKEN`
  - The wrapper guards the PAT swap with `isGitHubAppConfigured` and `GITHUB_PAT` presence
  - The wrapper assigns `GITHUB_PAT` to `process.env.GH_TOKEN`
  - The wrapper saves the original `GH_TOKEN` before swapping
  - The wrapper restores the original `GH_TOKEN` in a `finally` block
  - `findBoard` delegates to `withProjectBoardAuth`
  - `createBoard` delegates to `withProjectBoardAuth`
  - `ensureColumns` delegates to `withProjectBoardAuth`
  - `findBoard` no longer contains the stale lazy PAT retry log message
  - `findBoard` no longer performs an in-method `GH_TOKEN` swap
  - `projectBoardApi.ts` retains its upfront PAT fallback for `moveIssueToStatus`
  - ADW TypeScript type-check passes
- Reuse existing step definitions in `features/step_definitions/commonSteps.ts` (the `Given "<path>" is read` / `Then the file contains "<text>"` pair). Only add new step definitions if a new predicate is actually needed. If a new step is required (e.g., "Then withProjectBoardAuth restores GH_TOKEN in a finally block"), create `features/step_definitions/boardManagerPatFallbackSteps.ts`.
- Run the full validation suite (`Validation Commands` below) to confirm zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Read and confirm scope
- Read `adws/providers/github/githubBoardManager.ts` in full. Note exact line ranges: `findBoard` (78-97), `createBoard` (106-172), `ensureColumns` (181-196), private helpers (198-279).
- Read `adws/github/projectBoardApi.ts` lines 224-296 for the reference pattern.
- Confirm (via Grep) that `withProjectBoardAuth` is not an existing symbol anywhere in the repo.

### 2. Add the `withProjectBoardAuth` private method
- Insert the wrapper immediately after the `// ── Private helpers ─────` marker on line 198 in `adws/providers/github/githubBoardManager.ts`.
- Method signature: `private async withProjectBoardAuth<T>(fn: () => Promise<T>): Promise<T>`.
- Body mirrors `moveIssueToStatus` control flow:
  - Destructure `{ owner, repo }` from `this.repoInfo`.
  - Call `refreshTokenIfNeeded(owner, repo)`.
  - Declare `let savedToken: string | undefined;` and `let usingPatFallback = false;`.
  - In an outer `try`: if `isGitHubAppConfigured() && GITHUB_PAT && GITHUB_PAT !== process.env.GH_TOKEN`, set `savedToken = process.env.GH_TOKEN; process.env.GH_TOKEN = GITHUB_PAT; usingPatFallback = true;` and log `"Using GITHUB_PAT for project board operations (app tokens lack Projects V2 access)"` at `info` level.
  - Return `await fn()` inside the outer `try`.
  - In `finally`, `if (usingPatFallback) process.env.GH_TOKEN = savedToken;`.

### 3. Rewrite `findBoard()`
- Replace the body of `findBoard` (lines 78-97) with:
  - `const { owner, repo } = this.repoInfo;`
  - `return this.withProjectBoardAuth(async () => this.queryProjectId(owner, repo));`
- Remove the standalone `refreshTokenIfNeeded(owner, repo);` call (now inside the wrapper).
- Remove the entire inner lazy-retry block (the `if (!projectId && isGitHubAppConfigured() && GITHUB_PAT && GITHUB_PAT !== process.env.GH_TOKEN) { … }` and the trailing `return projectId;`).

### 4. Wrap `createBoard(name)`
- In `createBoard` (lines 106-172), wrap the existing body in `return this.withProjectBoardAuth(async () => { /* existing body verbatim */ });`.
- Keep the existing success log (`log('Created project board …', 'success')`) and return value inside the wrapped async closure.

### 5. Wrap `ensureColumns(boardId)`
- In `ensureColumns` (lines 181-196), wrap the existing body in `return this.withProjectBoardAuth(async () => { /* existing body verbatim */ });`.
- Ensure the `return true` / `return false` early exits inside the body remain inside the wrapped closure.

### 6. Smoke-check file length and structure
- Confirm the file is still under 300 lines (`guidelines/coding_guidelines.md` modularity rule).
- Confirm no behavior change in `queryProjectId`, `getStatusFieldOptions`, `updateStatusFieldOptions`.
- Confirm all three public methods each have exactly one `this.withProjectBoardAuth(` call.

### 7. Add unit tests for the wrapper
- Extend `adws/providers/__tests__/boardManager.test.ts` with a new `describe('GitHubBoardManager PAT fallback wrapper', ...)`.
- Add tests:
  - Wrapper swaps `process.env.GH_TOKEN` to `GITHUB_PAT` during `fn()` execution (assert inside the mocked `fn` that `process.env.GH_TOKEN === GITHUB_PAT`).
  - Wrapper restores original `GH_TOKEN` after `fn()` resolves.
  - Wrapper restores original `GH_TOKEN` after `fn()` throws (use `expect(...).rejects.toThrow` and assert env after).
  - Wrapper is a no-op when `GITHUB_PAT` is undefined.
  - Wrapper is a no-op when `GITHUB_PAT === process.env.GH_TOKEN`.
  - Wrapper is a no-op when `isGitHubAppConfigured()` returns `false`.
- Use `vi.mock('../../github/githubAppAuth', ...)` to control `isGitHubAppConfigured` and make `refreshTokenIfNeeded` a no-op.
- Save/restore `process.env.GH_TOKEN` and `process.env.GITHUB_PAT` in `beforeEach` / `afterEach` so tests do not leak state.
- Instantiate via the factory (`createGitHubBoardManager({ platform: 'github', owner: 'x', repo: 'y' })`) and cast to access the private method, or expose a test-only helper if access becomes awkward (prefer the cast — no production API change).

### 8. Create the BDD regression feature file
- Create `features/fix_board_manager_pat_auth.feature` tagged `@adw-446` at the feature level (matches existing convention for numeric issue IDs, e.g. `@adw-427`, `@adw-432`). Regression scenarios are additionally tagged `@regression`.
- Scenarios:
  - `GitHubBoardManager defines a withProjectBoardAuth wrapper` (@regression)
  - `withProjectBoardAuth is generic over the wrapped return type` (@regression)
  - `withProjectBoardAuth calls refreshTokenIfNeeded before swapping GH_TOKEN` (@regression)
  - `withProjectBoardAuth guards the PAT swap with isGitHubAppConfigured and GITHUB_PAT presence` (@regression)
  - `withProjectBoardAuth assigns GITHUB_PAT to process.env.GH_TOKEN` (@regression)
  - `withProjectBoardAuth saves the original GH_TOKEN before swapping` (@regression)
  - `withProjectBoardAuth restores the original GH_TOKEN in a finally block` (@regression)
  - `findBoard routes through withProjectBoardAuth` (@regression)
  - `createBoard routes through withProjectBoardAuth` (@regression)
  - `ensureColumns routes through withProjectBoardAuth` (@regression)
  - `findBoard no longer contains the stale lazy PAT retry log message` (@regression)
  - `findBoard no longer performs an in-method GH_TOKEN swap` (@regression)
  - `projectBoardApi.ts retains its upfront PAT fallback for moveIssueToStatus` (scope guard — @adw-446 only)
  - `TypeScript type-check passes after githubBoardManager PAT auth fix` (@regression)
- Use the existing `Given "<path>" is read` / `Then the file contains "<text>"` step pair from `features/step_definitions/commonSteps.ts` for all string-containment scenarios where possible.
- For multi-string predicates that cannot be expressed with the existing steps (e.g., "withProjectBoardAuth calls refreshTokenIfNeeded before swapping GH_TOKEN", "the findBoard method delegates to withProjectBoardAuth", "the findBoard method does not assign to process.env.GH_TOKEN", "the ADW TypeScript type-check passes"), create `features/step_definitions/boardManagerPatAuthSteps.ts` with the minimum new steps required.

### 9. Run validation
- Execute all commands listed in **Validation Commands**. Every command must pass.

## Testing Strategy

### Unit Tests
(Enabled per `.adw/project.md` — `## Unit Tests: enabled`.)

Add tests to `adws/providers/__tests__/boardManager.test.ts` in a new `describe('GitHubBoardManager PAT fallback wrapper', …)` block. The tests focus strictly on the wrapper's env-mutation contract, because the inner GraphQL calls are already covered indirectly by the existing `mergeStatusOptions` suite and by manual/integration verification.

Coverage:

- **Swap path:** when `GITHUB_PAT` is set, differs from the current `GH_TOKEN`, and `isGitHubAppConfigured()` returns `true`, the inner `fn` sees `process.env.GH_TOKEN === GITHUB_PAT`, and after the wrapper returns `process.env.GH_TOKEN` equals the pre-call value.
- **Restore-on-throw:** when `fn` throws synchronously or rejects, the outer `GH_TOKEN` is still restored.
- **No-op paths:** wrapper does not mutate `GH_TOKEN` when `GITHUB_PAT` is undefined, when it equals the current `GH_TOKEN`, or when `isGitHubAppConfigured()` returns `false`.
- **Log emission:** the "Using GITHUB_PAT for project board operations" `info` log fires exactly once on the swap path, and never on no-op paths. (Use a `log` spy via `vi.mock('../../core', …)` or via `vi.spyOn(console, ...)` depending on how `log` is plumbed — check the current test file for the established pattern before inventing a new one.)

Do not mock `execSync` or `gh`. The unit tests should not need to — they only cover the wrapper, not the inner GraphQL calls.

### Edge Cases
- `GITHUB_PAT` set to empty string — treated as falsy, wrapper is a no-op. Confirm by test.
- `GH_TOKEN` unset before the swap — `savedToken` is `undefined`; `finally` restores `undefined` (sets `process.env.GH_TOKEN = undefined` which typescript/node will coerce to the string `"undefined"`). Match the legacy implementation's behavior here exactly — the reference `moveIssueToStatus` has the same semantics. Add a test only if the legacy behavior is actually problematic; otherwise preserve it.
- Nested call — if somehow a public method calls another public method through `this` (it does not today), each invocation would re-enter the wrapper. Since the wrapper is idempotent (second call finds `GH_TOKEN === GITHUB_PAT` and becomes a no-op), nesting is safe. No code change needed; mention in the method's JSDoc for future maintainers.
- `fn` promise rejects with a non-Error value — `finally` still restores. Covered by the restore-on-throw test.
- Concurrent calls across two `GitHubBoardManager` instances in the same process — `process.env.GH_TOKEN` is process-global, so concurrent swaps could race. ADW is single-threaded per workflow and board-initialization is sequential, so this is not a real risk, but note it in the JSDoc as a known limitation.

## Acceptance Criteria
- `GitHubBoardManager.ensureColumns` returns `true` and actually mutates the project board when run against a user-owned Projects V2 repo with `GITHUB_PAT` configured and the GitHub App token lacking Projects V2 access.
- No `gh: Resource not accessible by integration` appears in logs during `findBoard` → `ensureColumns` in the reproduction flow.
- After a workflow's `initializeWorkflow` completes, the linked board contains all five columns from `BOARD_COLUMNS` (`Blocked`, `Todo`, `In Progress`, `Review`, `Done`) in addition to any pre-existing non-ADW columns.
- `adws/providers/github/githubBoardManager.ts` contains a `withProjectBoardAuth` private method, and each of `findBoard`, `createBoard`, `ensureColumns` calls `this.withProjectBoardAuth(` exactly once in its body.
- The stale inner lazy-retry inside `findBoard` is removed.
- The file stays under 300 lines (per `guidelines/coding_guidelines.md`).
- `adws/github/projectBoardApi.ts` and `adws/providers/github/githubIssueTracker.ts` are not modified.
- New unit tests cover the wrapper's swap / restore / restore-on-throw / no-op paths.
- New BDD feature file `features/fix_board_manager_pat_auth.feature` passes with `@adw-446` tag (regression scenarios also passing under `@regression`).
- All commands in **Validation Commands** pass with zero errors and zero new warnings.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — install dependencies (required only if any were added, which this plan does not add).
- `bun run lint` — ESLint must pass on all modified files.
- `bunx tsc --noEmit` — root TypeScript typecheck.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws-scoped TypeScript typecheck.
- `bun run build` — project build succeeds.
- `bun run test:unit` — vitest unit tests, including the new wrapper tests, all pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-446"` — new BDD scenarios pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression suite passes (must include the existing `@adw-9tknkw-project-board-fall-b` scenarios that verify `projectBoardApi.ts` was not collaterally broken).

## Notes
- The `guidelines/coding_guidelines.md` rule "Keep files under 300 lines" is the tightest constraint; the file currently sits ~290 lines. Net change is ~+9 lines (new wrapper ~+20, deleted inner retry ~-11). If the final count lands at or above 300, extract the wrapper to a local top-level helper in the same file (e.g., `async function withGraphQLAuth<T>(repoInfo: RepoInfo, fn: () => Promise<T>): Promise<T>`) and have the class method delegate to it. Do not split into a new file — the wrapper is only used here and a new module would add navigation overhead without benefit.
- The canonical reference is `adws/github/projectBoardApi.ts::moveIssueToStatus` lines 224-296. Copy its control flow exactly — down to the `let usingPatFallback = false;` variable name — so that future audits can grep for matching patterns across both files.
- Do not unify or share code with `moveIssueToStatus`. The two files belong to different layers (the legacy file is the caller for per-issue status moves from `githubIssueTracker`; the provider file is the per-board setup) and conflating them would re-couple the provider refactor that PR #428 intentionally separated. A truly shared helper in a third file is tempting but premature — YAGNI.
- The `features/fix_board_manager_pat_auth.feature` scenarios are static-string checks. They guard against the specific regression pattern (someone deleting `withProjectBoardAuth` or bypassing it in a new public method) but cannot prove runtime correctness against a live GitHub API. True behavioral integration testing against a sandbox GitHub project is explicitly out of scope — see `project_future_grill_integration_testing.md` in auto-memory (issue-body reference).
- Library install: none required — the wrapper uses only existing imports (`GITHUB_PAT`, `isGitHubAppConfigured`, `refreshTokenIfNeeded`, `log`, `process.env`).
- Auto-memory ties: `project_future_grill_integration_testing.md` tracks the deferred integration-testing effort, and the earlier conditional-doc files (`feature-qm6gwx-board-manager-provider.md`, `feature-w12d7t-fix-board-update-mutation.md`, `feature-9tknkw-project-board-pat-fallback.md`) cover the prior passes that introduced and previously patched this provider.
- Follow-up issue (out of scope for this PR): design and implement a real-runtime BDD scenario that creates a scratch Projects V2 board on a sandbox user-owned repo, runs `setupProjectBoard`, and asserts all five columns were actually created. Open once a suitable sandbox repo + tokens are budgeted.
