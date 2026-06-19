# Feature: Deterministic branch-identity fallback when adwId recovery fails

## Metadata
issueNumber: `641`
adwId: `gvsub5-feat-deterministic-b`
issueJson: `{"number":641,"title":"feat: deterministic branch-identity fallback when adwId recovery fails","body":"## Parent PRD\n\n`specs/prd/stage-recovery-resume-in-place.md`\n\n## What to build\n\nPure `deterministicBranchName(classifier, issueNumber)` and a `branchMatchesIssue` predicate (slug ignored for matching). Insert a step in branch-name resolution between recovery-comment reuse and LLM generation: when the canonical `adwId` cannot be recovered, derive the deterministic branch, find the existing branch/worktree, and **recover the adwId/state from that worktree** rather than minting a fresh adwId that would alias the existing worktree. A re-classification that changes the prefix is an accepted, intentional new branch. See PRD \"Implementation Decisions\" (branch identity fallback module) and the \"Further Notes\" loose-end on adwId recovery.\n\n## Acceptance criteria\n\n- [ ] When `resolveAdwId` fails, the existing `{classifier}-issue-{N}` branch is reused (no new branch / second PR)\n- [ ] adwId/state recovered from the matched worktree (no fresh adwId aliasing an existing worktree)\n- [ ] Re-classification yielding a different prefix produces a new branch (accepted)\n- [ ] Normal recovery path (adwId recovered from comments) is unchanged\n- [ ] Pure unit tests for `deterministicBranchName` format and `branchMatchesIssue`\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 7\n- User story 8\n- User story 17\n- User story 22","state":"OPEN","author":"paysdoc","labels":["hitl","adw:feature"],"createdAt":"2026-06-19T17:38:15Z","comments":[],"actionableComment":null}`

## Feature Description

When a workflow's canonical `adwId` cannot be recovered from issue comments (the `## :rocket: ADW Workflow Started` / stage comments were deleted, edited, or never persisted), ADW currently mints a **fresh** `adwId` via `generateAdwId()` and — when no local worktree happens to match the issue pattern — regenerates a brand-new branch name through the LLM. Both behaviours are damaging:

1. A new LLM-generated slug produces a **second branch** (`feature-issue-641-some-other-slug`) and therefore a **second pull request** for the same issue.
2. Even when the existing worktree *is* rediscovered by pattern (`findWorktreeForIssue`), the run proceeds under the **fresh adwId**, orphaning the prior run's state (`agents/{oldAdwId}/state.json` — completed phases, plan path, cost records) and **aliasing** one worktree with two adwIds.

This feature inserts a deterministic fallback into branch-name resolution. When the canonical adwId is unrecoverable, ADW derives the deterministic branch identity `{classifier}-issue-{N}`, finds the existing branch/worktree that **matches the issue regardless of slug**, recovers the **original adwId and its state** from that worktree's persisted state, and resumes under that identity. A re-classification that legitimately changes the branch prefix (e.g. `/feature` → `/bug`) is treated as an intentional new branch and falls through to normal LLM generation.

The value: an issue whose ADW comments are lost still converges on a single branch, a single PR, and a single continuous state history instead of forking into duplicate, half-complete work.

## User Story

As an **ADW operator** whose issue lost its ADW workflow comments (manual deletion, comment-clearing, a `## Cancel`/re-run race, or a never-persisted branch name)
I want the next workflow run to **reuse the existing branch and recover the original adwId/state**
So that the issue does not sprout a second branch, a second pull request, or a stranded half-finished state directory.

(Addresses user stories 7, 8, 17, 22 from the parent `stage-recovery-resume-in-place` PRD.)

## Problem Statement

Branch + adwId identity for an issue is currently anchored **only** to the ADW comment trail:

- `detectRecoveryState(issue.comments)` (in `workflowInit.ts`) extracts `recoveryState.adwId` and `recoveryState.branchName` by scanning comments.
- `resolveAdwId` in `takeoverHandler.ts` likewise extracts the adwId via `extractLatestAdwId(comments)`; on failure it returns `null` and the candidate is spawned **fresh** (`spawn_fresh`).
- When the comment trail is gone, `initializeWorkflow(issueNumber, null, …)` resolves `resolvedAdwId = adwId ?? recoveryState.adwId ?? generateAdwId(issue.title)` → a **brand-new** adwId.
- Branch-name resolution (`resolveWorkflowBranchName` → `resolveInternal`) then has the priority chain **persisted state → recovery comment → LLM generation**. With a fresh adwId and no recovery comment, it goes straight to the **LLM**, producing a new slug and a new branch.

There is no step that, when the adwId is lost, reconstructs identity from the **deterministic, slug-independent** part of the branch name (`{classifier}-issue-{N}`) that ADW itself always assembles. The comment trail is treated as the sole source of truth for identity, so losing it loses the branch and the state.

Note: `findWorktreeForIssue` partially mitigates case 1 by adopting a *local* worktree that matches the issue pattern — but only if that worktree still exists on disk, and it never recovers the original adwId, so case 2 (state aliasing) remains.

## Solution Statement

Introduce a small, pure **branch-identity** vocabulary plus a deterministic fallback step wired into the existing resolution flow:

1. **Pure predicates** (`adws/vcs/branchIdentity.ts`):
   - `deterministicBranchName(classifier, issueNumber)` → the stable, slug-free identity `{prefix}-issue-{N}` (prefix from `branchPrefixMap`, e.g. `feature-issue-641`).
   - `branchMatchesIssue(branchName, classifier, issueNumber)` → `true` when `branchName` belongs to this issue **and** classifier, **ignoring the slug**. Matches the canonical prefix and that classifier's aliases (mirroring `findWorktreeForIssue`), and is sensitive to the issue-number boundary (`feature-issue-641` and `feature-issue-641-foo` match; `feature-issue-64`, `feature-issue-6411` do not). A different classifier prefix → no match → intentional new branch.

2. **Identity-recovery helper** (`adws/phases/branchIdentityFallback.ts`, I/O isolated and dependency-injected):
   - `findExistingBranchForIssue(issueType, issueNumber, deps)` → scans existing branches/worktrees and returns the first whose name satisfies `branchMatchesIssue`, or `null`.
   - `recoverAdwIdForBranch(branchName, deps)` → reverse-looks-up the owning adwId by enumerating `agents/<adwId>/state.json` and returning the adwId whose persisted `branchName` matches (most-recently-active wins on ties). This is the mechanism for "recover the adwId/state from that worktree" — **the branch name does not embed the adwId** (only plan *files* do), so the persisted top-level state is the authority.

3. **Wire into branch-name resolution** (`branchNameResolution.ts`): insert a new step in `resolveInternal` **between** the recovery-comment reuse and the LLM call. When neither persisted nor recovery-comment branch exists, call `findExistingBranchForIssue`; if a match is found, persist and return it (no LLM, no second branch). If none, fall through to the LLM exactly as today.

4. **Wire adwId recovery into `workflowInit.ts`**: when `adwId` is not supplied and `recoveryState.adwId` is `null`, attempt `findExistingBranchForIssue` + `recoverAdwIdForBranch` (using the freshly-classified `issueType`) **before** falling back to `generateAdwId()`. A recovered adwId means the run resumes under the original identity — its persisted branch name flows through the existing **persisted-state** path of `resolveInternal`, and its `completedPhases` recover through the existing resume logic.

5. **Preserve the happy path**: every new step is guarded so that when `recoveryState.adwId` is present (the normal recovery path) nothing changes — the fallback is reached only when canonical recovery has already failed.

This keeps identity assembly deterministic at a single point (consistent with the README "Worktree discovery and branch lookup" lesson), reuses the existing `branchPrefixMap`/`branchPrefixAliases` and state-store conventions, and adds no new external dependencies.

## Relevant Files

Use these files to implement the feature:

- `adws/vcs/branchOperations.ts` — Home of the existing pure branch-name vocabulary (`generateBranchName` → `{prefix}-issue-{N}-{slug}`, `validateSlug`, `inferIssueTypeFromBranch`). The new predicates mirror these conventions; this file confirms the authoritative branch format. Already ~299 lines, so the new predicates go in a sibling module to respect the <300-line guideline.
- `adws/types/issueRouting.ts` — `branchPrefixMap` and `branchPrefixAliases`. `deterministicBranchName` uses the canonical map; `branchMatchesIssue` uses both (canonical + aliases) per classifier.
- `adws/vcs/worktreeQuery.ts` — `findWorktreeForIssue` and `listWorktrees`. Reference pattern for slug-agnostic, alias-aware issue→worktree matching; the new finder reuses/extends this approach for branches.
- `adws/vcs/worktreeOperations.ts` — `getWorktreeForBranch`, `getWorktreePath`, `worktreeExists`. Used to resolve the matched branch back to a worktree path.
- `adws/vcs/index.ts` — Barrel export for the `vcs` module; the new `branchIdentity.ts` exports are re-exported here.
- `adws/phases/branchNameResolution.ts` — **Primary integration point.** `resolveInternal` holds the persisted → recovery-comment → LLM chain; the deterministic-branch step is inserted between recovery-comment and LLM. Keep the `agentFn`/dependency-injection test seam.
- `adws/phases/workflowInit.ts` — **Second integration point.** `initializeWorkflow` resolves `resolvedAdwId` (line ~150) and runs branch/worktree resolution (lines ~205–228). adwId recovery is wired in here, after classification, before `generateAdwId`.
- `adws/core/stateHelpers.ts` — `findOrchestratorStatePath` shows the `fs.readdirSync(AGENTS_STATE_DIR/...)` enumeration pattern the reverse-lookup follows.
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState(adwId)` / `getTopLevelStatePath` / `writeTopLevelState`; reverse-lookup reads each adwId's top-level `branchName`.
- `adws/core/config.ts` — `AGENTS_STATE_DIR` (root of the `agents/<adwId>/` state store enumerated by the reverse-lookup).
- `adws/triggers/cronStageResolver.ts` — `extractLatestAdwId` (the comment-based adwId recovery that "fails") and `getLastActivityFromState` (reused to break ties when multiple adwIds match a branch).
- `adws/triggers/takeoverHandler.ts` — `resolveAdwId` / `evaluateCandidate`; documents the `spawn_fresh` decision that triggers a fresh-adwId run when comment recovery fails. Context only (no functional change required here for the acceptance criteria), but read to confirm the upstream behaviour.
- `adws/core/workflowCommentParsing.ts` — `detectRecoveryState`, `extractAdwIdFromComment`, `extractBranchNameFromComment`; defines `RecoveryState` semantics the fallback must not disturb on the happy path.
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — Conditional doc (matches this task's conditions): the per-adwId branch-name persistence contract, `resolveWorkflowBranchName`/`readPersistedBranchName`/`persistBranchName`, and the issue-#524 anti-fork guard. Read before modifying `branchNameResolution.ts`.

### New Files

- `adws/vcs/branchIdentity.ts` — Pure module: `deterministicBranchName(classifier, issueNumber)` and `branchMatchesIssue(branchName, classifier, issueNumber)`. No I/O.
- `adws/vcs/__tests__/branchIdentity.test.ts` — Pure unit tests for both predicates (format, slug-agnosticism, alias handling, number-boundary, classifier mismatch).
- `adws/phases/branchIdentityFallback.ts` — I/O-isolated recovery helpers: `findExistingBranchForIssue(issueType, issueNumber, deps)` and `recoverAdwIdForBranch(branchName, deps)`. Dependencies injected for testability.
- `adws/phases/__tests__/branchIdentityFallback.test.ts` — Unit tests for the finder + reverse-lookup with injected fakes (matching branch found / not found, reclassification mismatch, multiple-adwId tie-break, no-state-dir).

## Implementation Plan

### Phase 1: Foundation
Establish the pure branch-identity vocabulary with no dependencies on I/O or workflow state. `deterministicBranchName` and `branchMatchesIssue` are written against `branchPrefixMap`/`branchPrefixAliases` and fully unit-tested first, so the integration steps build on a verified primitive. This mirrors the README "deterministic at a single point" lesson and the existing `generateBranchName` conventions.

### Phase 2: Core Implementation
Build the identity-recovery helper module (`branchIdentityFallback.ts`) that turns the pure predicates into a usable fallback: locate the existing branch/worktree for an issue (slug-agnostic) and reverse-look-up its owning adwId from the persisted state store. Keep all filesystem/git access behind an injected `deps` object so the logic is unit-testable without a real repo, following the `TakeoverDeps` / `agentFn`-injection patterns already in the codebase.

### Phase 3: Integration
Wire the fallback into the two existing decision points — branch-name resolution (`resolveInternal`) and adwId resolution (`initializeWorkflow`) — strictly behind the "canonical recovery failed" guard so the normal path is untouched. Branch reuse (criterion 1) and adwId/state recovery (criterion 2) become consistent because both resolve to the same recovered identity; reclassification (criterion 3) falls through to the LLM because the predicates reject a mismatched prefix.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1 — Create the pure branch-identity module
- Create `adws/vcs/branchIdentity.ts`.
- Implement `deterministicBranchName(classifier: IssueClassSlashCommand, issueNumber: number): string` returning `` `${branchPrefixMap[classifier]}-issue-${issueNumber}` `` (e.g. `/feature`, `641` → `feature-issue-641`).
- Implement `branchMatchesIssue(branchName: string, classifier: IssueClassSlashCommand, issueNumber: number): boolean`:
  - Build the candidate prefixes `[branchPrefixMap[classifier], ...branchPrefixAliases[classifier]]`.
  - Return `true` iff `branchName` equals `{prefix}-issue-{N}` or starts with `{prefix}-issue-{N}-` for one of those prefixes (slug ignored, issue-number boundary enforced so `641` ≠ `64`/`6411`).
  - Use a guard-clause style; no nested pyramids (coding guideline).
- Add JSDoc on both functions documenting the format and the slug-agnostic / prefix-sensitive contract.

### Step 2 — Export the new predicates from the vcs barrel
- Add `export { deterministicBranchName, branchMatchesIssue } from './branchIdentity';` to `adws/vcs/index.ts` (placed near the `worktreeQuery`/`branchOperations` exports).

### Step 3 — Pure unit tests for the predicates (criterion 5)
- Create `adws/vcs/__tests__/branchIdentity.test.ts` (vitest).
- `deterministicBranchName`: asserts `feature-issue-641`, `bugfix-issue-12`, `chore-issue-7`, `review-issue-3`, `adwinit-issue-641` for `/feature`,`/bug`,`/chore`,`/pr_review`,`/adw_init` (every classifier in `branchPrefixMap`, matching BDD scenario §1).
- `branchMatchesIssue`: covers exact match, slug-suffixed match, alias match (`feat-issue-641-x` for `/feature`), number-boundary rejection (`feature-issue-64`, `feature-issue-6411`), and classifier-mismatch rejection (`feature-issue-641-x` vs `/bug`).
- Run `bun run test:unit` for this file and confirm green before proceeding.

### Step 4 — Create the identity-recovery helper module
- Create `adws/phases/branchIdentityFallback.ts`.
- Define an injectable deps interface (default implementation provided), e.g.:
  - `listCandidateBranches(cwd?)` → string[] of branch names (local + worktree branches; reuse `listWorktrees`/`git branch --list` and `getWorktreeForBranch`).
  - `listAdwIds()` → string[] from `fs.readdirSync(AGENTS_STATE_DIR)` (directories only).
  - `readTopLevelState(adwId)` → `AgentStateManager.readTopLevelState`.
- Implement `findExistingBranchForIssue(issueType, issueNumber, deps?)`: returns the first candidate branch satisfying `branchMatchesIssue(branch, issueType, issueNumber)`, or `null`. Isolate the per-branch test as a named predicate (no nested loops with inline branching).
- Implement `recoverAdwIdForBranch(branchName, deps?)`: enumerate adwIds, read each top-level state, return the adwId whose `state.branchName === branchName` (slug-exact); on multiple matches, pick the most-recently-active via `getLastActivityFromState`. Return `null` when none match.
- Keep the module under 300 lines and side effects at the boundary (guideline §5/§Nesting).

### Step 5 — Insert the deterministic-branch step into branch-name resolution
- In `adws/phases/branchNameResolution.ts` `resolveInternal`, add a new step **after** the `recoveryState.branchName` block and **before** the `agentFn(...)` LLM call.
- Add an injected finder parameter (default `findExistingBranchForIssue`) following the existing `agentFn` injection seam, so tests can supply a fake.
- Logic: call the finder with `issueType` and `issue.number`; if it returns a branch, `log(...)`, `persistBranchName(adwId, found)`, and `return found`. Otherwise continue to the LLM exactly as today.
- Preserve the issue-#524 post-LLM mismatch guard unchanged.
- Update `_resolveWorkflowBranchNameForTest` and `resolveWorkflowBranchName` signatures to thread the optional finder dep.

### Step 6 — Wire adwId recovery into workflowInit
- In `adws/phases/workflowInit.ts`, after issue classification produces `issueType` and **only when** `adwId` is not supplied and `recoveryState.adwId` is `null`:
  - Call `findExistingBranchForIssue(issueType, issueNumber)`; if a branch is found, call `recoverAdwIdForBranch(branch)`.
  - If an adwId is recovered, use it as `resolvedAdwId` (instead of `generateAdwId(...)`), log the recovery, and let the existing persisted-name / `completedPhases` resume logic pick up the prior state.
  - If nothing is recovered, fall back to `generateAdwId(issue.title)` exactly as today.
- Ensure classification happens before this block (reorder minimally if needed — `resolvedAdwId` is currently computed before classification; move the fresh-mint fallback to just after classification, keeping `adwId ?? recoveryState.adwId` precedence first so the happy path is byte-for-byte unchanged).
- Guard: when `recoveryState.adwId` is present, skip the fallback entirely (criterion 4).

### Step 7 — Unit tests for the fallback module and integration seams
- Create `adws/phases/__tests__/branchIdentityFallback.test.ts`:
  - `findExistingBranchForIssue`: match found among candidates; reclassification prefix mismatch → `null`; alias prefix matched; no candidates → `null`.
  - `recoverAdwIdForBranch`: single match returns adwId; multiple matches → most-recently-active; no state dir / no match → `null`.
- Extend `adws/phases/__tests__/branchNameResolution.test.ts` with a case proving the new step: no persisted, no recovery-comment, finder returns an existing branch → that branch is returned and persisted, and the agent is **not** called (criterion 1). Add the negative case: finder returns `null` → LLM is called exactly once (happy path unchanged, criterion 4).
- Use injected fakes (no real git/fs); follow the existing `vi.mock('../../agents', …)` and `_resolveWorkflowBranchNameForTest` conventions.

### Step 8 — Run the full validation suite
- Run every command in **Validation Commands** and fix any lint/type/test failure until all pass with zero regressions.

## Testing Strategy

### Unit Tests
Unit tests are enabled for this repo (`.adw/project.md` → `## Unit Tests: enabled`); they run under vitest (`bun run test:unit`, globs `adws/**/__tests__/**/*.test.ts`).

- **`adws/vcs/__tests__/branchIdentity.test.ts`** (pure, required by criterion 5):
  - `deterministicBranchName` returns `{prefix}-issue-{N}` for every classifier in `branchPrefixMap`.
  - `branchMatchesIssue` is `true` for exact, slug-suffixed, and alias-prefixed branches of the same classifier; `false` for a different classifier's prefix and for issue-number-boundary near-misses.
- **`adws/phases/__tests__/branchIdentityFallback.test.ts`**:
  - `findExistingBranchForIssue` returns the matching branch, `null` on reclassification mismatch, `null` when no candidate matches.
  - `recoverAdwIdForBranch` returns the owning adwId, tie-breaks on most-recent activity, returns `null` when the state store has no match.
- **`adws/phases/__tests__/branchNameResolution.test.ts`** (extend existing):
  - New step returns + persists an existing branch and skips the LLM when the finder matches (criterion 1).
  - Finder returns `null` → LLM called exactly once; persisted/recovery-comment precedence and the issue-#524 mismatch guard remain unchanged (criterion 4).

### Edge Cases
- Issue-number boundary: `feature-issue-641` must match issue 641 but not `feature-issue-64` or `feature-issue-6411`.
- Empty-slug branch (`feature-issue-641` with no trailing slug) still matches.
- Alias vs canonical prefix: a branch created with an alias (`feat-issue-641-…`) matches `/feature`; `chore` has no aliases.
- **Reclassification** (criterion 3): existing branch `feature-issue-641-…` but current classification `/bug` → `branchMatchesIssue` is `false` → finder returns `null` → LLM generates a new `bugfix-issue-641-…` branch.
- Reverse-lookup with **multiple** adwIds whose persisted `branchName` matches → most-recently-active wins (deterministic).
- Reverse-lookup when `AGENTS_STATE_DIR` is absent/empty, or a state file is missing its `branchName` field → returns `null` (falls through to fresh adwId; no throw).
- **Happy path untouched** (criterion 4): `recoveryState.adwId` present → fallback never runs; persisted-name path returns immediately.
- Branch matches on disk but no owning state is recoverable → branch is still reused (criterion 1) while adwId falls back to fresh-mint (best-effort; documented).

## Acceptance Criteria
- When `resolveAdwId` / comment-based recovery fails, the existing `{classifier}-issue-{N}` branch is reused — no new branch and no second PR (verified by the branchNameResolution test where the finder match short-circuits the LLM).
- The original adwId/state is recovered from the matched worktree's persisted state via `recoverAdwIdForBranch`; no fresh adwId aliases an existing worktree (verified by `branchIdentityFallback` reverse-lookup tests and the workflowInit wiring).
- A re-classification that yields a different prefix produces a new branch — `branchMatchesIssue` returns `false` and resolution falls through to LLM generation (verified by the reclassification-mismatch tests).
- The normal recovery path (adwId recovered from comments) is byte-for-byte unchanged — the fallback is guarded behind `recoveryState.adwId == null` (verified by the unchanged happy-path tests).
- Pure unit tests exist for `deterministicBranchName` format and `branchMatchesIssue` (criterion 5).
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build`, and `bun run test:unit` all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun run lint` — ESLint; zero errors.
- `bunx tsc --noEmit` — Root type check; zero type errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW workspace type check (additional type check from `.adw/commands.md`); zero type errors.
- `bun run build` — `tsc` build; succeeds.
- `bun run test:unit` — Full vitest suite; all tests pass (no regressions in `branchNameResolution`, `workflowInit`, `takeoverHandler`, etc.).
- `bunx vitest run adws/vcs/__tests__/branchIdentity.test.ts adws/phases/__tests__/branchIdentityFallback.test.ts adws/phases/__tests__/branchNameResolution.test.ts` — Targeted run of the new and extended suites; all green.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) apply: prefer pure functions with isolated side effects, files < 300 lines (the reason the predicates go in a new `branchIdentity.ts` rather than the already-~299-line `branchOperations.ts`), guard clauses over nested conditionals, no `any`, no decorators, declarative iteration, and JSDoc on the public API.
- **No new dependencies.** Install command for reference (`.adw/commands.md`): `bun add <package>` — not needed for this feature.
- **Parent PRD is absent from the repo.** `specs/prd/stage-recovery-resume-in-place.md` (referenced by the issue) does **not** exist in this branch; the "Implementation Decisions" / "Further Notes" sections it cites are unavailable. The issue body + acceptance criteria are therefore the binding contract. The implementer should not block on the missing PRD; if it lands later, reconcile naming of the "branch identity fallback module" with this implementation.
- **Key architectural fact — the branch name does not contain the adwId.** `generateBranchName` produces `{prefix}-issue-{N}-{slug}`; only plan *files* embed `-adw-{adwId}-` (the `adwId.ts` doc-comment describing a `-adw-` branch template is stale). Consequently "recover the adwId from that worktree" is implemented as a **reverse-lookup over `agents/<adwId>/state.json` by persisted `branchName`**, not by parsing the branch string. This is the single most important implementation nuance.
- `findWorktreeForIssue` already adopts a *local* worktree by issue pattern, but (a) only when the worktree is present on disk and (b) without recovering the adwId. This feature supersedes that gap by recovering identity from persisted state, and remains compatible with the existing worktree-adoption path in `workflowInit.ts`.
- Keep the I/O behind injected `deps` (mirroring `TakeoverDeps` and the `agentFn` seam) so the new logic is unit-testable without a live git repo or real `agents/` store — this is also what lets the BDD/unit tests assert criteria 1–4 deterministically.
- Guard ordering matters: always evaluate `adwId ?? recoveryState.adwId` **first**; only reach the deterministic fallback when both are absent, so the normal recovery path is provably unchanged (criterion 4).
