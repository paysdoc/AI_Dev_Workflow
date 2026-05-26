# Feature: Persist branch name per `adwId` so `branchName-agent` never re-fires mid-workflow

## Metadata
issueNumber: `524`
adwId: `sh8m9r-branchname-agent-re`
issueJson: `{"number":524,"title":"branchName-agent re-fires mid-workflow and creates orphan worktree, orphaning prior phase artifacts","body":"During a single ADW run, branchName-agent (/generate_branch_name) can be invoked more than once. When the second invocation returns a slightly different slug than the first, the orchestrator creates a NEW branch and worktree and proceeds in it — while the plan, scenarios, and any other artifacts committed during phase-1 sit on the first branch and are never seen by later phases. The build phase then fails with 'Cannot read plan file at <new-worktree>/specs/issue-N-plan.md'. Acceptance: (1) Once branchName is chosen for an adwId it is persisted in top-level workflow state and reused on every subsequent invocation; (2) if runGenerateBranchNameAgent is somehow called a second time within the same adwId, detect mismatch with persisted name and abort with a clear error; (3) regression test simulating two workflowInit calls with the same adwId/issueNumber/issueType returning different slugs asserts only one branch/worktree is created; (4) optional follow-up: findPlanFile searches sibling worktrees and surfaces a clearer error naming the orphan worktree.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-26T09:03:06Z"}`

## Feature Description
ADW assigns each workflow run a stable `adwId` and runs it inside a per-issue git worktree. The worktree's branch name is produced by an LLM agent (`/generate_branch_name`, wrapped by `runGenerateBranchNameAgent`) the first time `initializeWorkflow` runs for that workflow. The LLM produces a free-form semantic slug; there is **no determinism guarantee** that two invocations return the same slug.

Today the branch-name selection cascade in `adws/phases/workflowInit.ts` only avoids re-invoking the agent when one of these is true: a caller supplied `options.cwd`, the issue comments carried a recovered `recoveryState.branchName`, or `findWorktreeForIssue` discovered an on-disk worktree by directory-name pattern. When a phase re-enters `initializeWorkflow` and *none* of those hold (e.g. the issue's "Branch Created" comment was cleared, the worktree branch was pruned, or worktree discovery runs against a different cwd than where the worktree was created), the agent is invoked **again**. A second, slightly different slug yields a brand-new branch and worktree, and every artifact committed in phase 1 (plan, scenarios, alignment) is stranded on the original branch. The build phase then dies with `Cannot read plan file at <new-worktree>/specs/issue-N-plan.md`.

This feature makes the chosen branch name a **persisted, authoritative property of the `adwId`**: written to the top-level workflow state file (`agents/{adwId}/state.json`) the first time it is resolved, and consulted as the highest-priority source on every subsequent `initializeWorkflow` call for that `adwId`. The LLM agent is invoked at most once per `adwId`. A defense-in-depth guard aborts loudly if the agent is ever invoked a second time and returns a name that disagrees with the persisted one, instead of silently forking into an orphan worktree.

This complements — and depends on — the prior "Deterministic Branch-Name Assembly" work (issue #455, adwId `7dp24s`), which narrowed the LLM to emit only a slug and moved `<prefix>-issue-<N>-<slug>` assembly into a pure function. That change removed *intra-call* drift; this change removes *cross-call* drift.

## User Story
As an **ADW operator running unattended workflows against real repositories**
I want **each `adwId` to commit to exactly one branch name, reused on every phase re-entry**
So that **plan, scenarios, and build all land on the same branch, and a workflow never strands its phase-1 artifacts on an orphan worktree that later phases cannot see**.

## Problem Statement
`adws/phases/workflowInit.ts` chooses a branch via this cascade:

1. `options.cwd` → reuse caller-provided worktree (branch name left unresolved).
2. `recoveryState.branchName` → reuse branch recovered from issue comments.
3. `findWorktreeForIssue(issueType, issueNumber)` → reuse any worktree whose dir matches `^{prefix}-issue-{N}-`.
4. fall back to `runGenerateBranchNameAgent` (non-deterministic LLM slug).

The persisted top-level state `branchName` — which the schema already supports (`AgentState.branchName`) and which `AgentStateManager.readTopLevelState` / `writeTopLevelState` can already read and merge — is **never consulted**. So when steps 1–3 all miss on a re-entry, step 4 runs again and can return a different slug, producing a second branch/worktree and orphaning prior artifacts. The concrete production incident: `cv2hai-rfc-split-worker-api` / issue #95 produced `...-scrape-deck` (plan committed here) and later `...-scrape-deck-ports` (empty, used by build), wedging the workflow until a human fast-forward-merged the orphan branch.

## Solution Statement
Make the persisted top-level-state `branchName` the **first and authoritative** source in the branch-name cascade, and persist the resolved name the moment it is chosen by any path:

1. Extract branch-name resolution out of `workflowInit.ts` into a small, single-responsibility, unit-testable module `adws/phases/branchNameResolution.ts` exposing:
   - `readPersistedBranchName(adwId)` — returns the `branchName` stored in `agents/{adwId}/state.json`, or `undefined`.
   - `persistBranchName(adwId, branchName)` — merges `{ branchName }` into the top-level state.
   - `resolveWorkflowBranchName({ adwId, issueType, issue, logsDir, recoveryState })` — resolves the branch name with priority **persisted state → recovery comments → LLM generation**, persists the result, and throws a clear error if the LLM is invoked a second time and returns a name that disagrees with a now-persisted one.
2. Rewire both `runGenerateBranchNameAgent` call sites in `workflowInit.ts` (the target-repo path and the local-repo path) to go through `resolveWorkflowBranchName`, so the agent can fire at most once per `adwId`.
3. In the local path, treat a persisted `branchName` as authoritative over `findWorktreeForIssue` (skip pattern discovery when a persisted name exists), then locate-or-recreate that branch's worktree — so a re-entry can never adopt a sibling worktree's branch.
4. Include the resolved `branchName` in the canonical top-level-state initialization write so the persisted record is explicit and covers every resolution path.
5. (Optional follow-up, criterion 4) Harden `findPlanFile` to search sibling `.worktrees/{prefix}-issue-{N}-*/specs/` when the local worktree has no plan, and make the "Cannot read plan file" errors name the sibling/orphan worktree if one is found.

Because the top-level state file is keyed by `adwId` (host-global, under the ADW repo's `agents/` directory) and not by worktree cwd, this also closes the "lookup runs against a different cwd" gap noted in the issue.

## Relevant Files
Use these files to implement the feature:

- `adws/phases/workflowInit.ts` — **primary change site.** Contains the branch-name cascade (the `options.cwd` / target-repo / local-repo branches) and the two `runGenerateBranchNameAgent` call sites. Also performs the canonical top-level-state init write that must now include `branchName`. (File is currently 388 lines — over the 300-line guideline; extraction reduces it.)
- `adws/agents/gitAgent.ts` — defines `runGenerateBranchNameAgent`, which returns `{ ..., branchName }` (fully-assembled `<prefix>-issue-<N>-<slug>`). The new resolver wraps this; no change needed here, but it is the unit under guard.
- `adws/agents/index.ts` — re-exports `runGenerateBranchNameAgent` (the new module imports it from `../agents`).
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState` / `writeTopLevelState` (merging, atomic write) and `getTopLevelStatePath`. The persistence primitives the resolver builds on; no change needed.
- `adws/types/agentTypes.ts` — `AgentState.branchName?: string` already exists; confirms no schema change is required.
- `adws/core/index.ts` — re-exports `AgentStateManager`, `log`, `type RecoveryState`, `type GitHubIssue`, `type IssueClassSlashCommand` consumed by the new module.
- `adws/types/workflowTypes.ts` — `RecoveryState` interface (`branchName: string | null`), the recovery source the resolver consults second.
- `adws/vcs/worktreeQuery.ts` — `findWorktreeForIssue`; understand its pattern matching to correctly gate it behind the persisted-name check.
- `adws/vcs/branchOperations.ts` — `generateBranchName` / `validateSlug` (deterministic assembly from #455); referenced for context, no change.
- `adws/agents/planAgent.ts` — `findPlanFile` / `getPlanFilePath` / `readPlanFile` (criterion 4, optional follow-up).
- `adws/phases/buildPhase.ts` and `adws/phases/planValidationPhase.ts` — the two `Cannot read plan file at ${planPath}` throw sites (criterion 4, optional follow-up: clearer error message).

Conditional documentation (matched against `.adw/conditional_docs.md` for this task):
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — top-level `agents/{adwId}/state.json`, `AgentStateManager`, `workflowStage`, schema fields. Directly governs the persistence approach.
- `app_docs/feature-7dp24s-deterministic-branch-name-assembly.md` — `runGenerateBranchNameAgent` slug-only contract and `generateBranchName`/`validateSlug`. Direct predecessor; explains why assembly is already deterministic and why only cross-call reuse remains.
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — `workflowInit.ts`, worktree creation, target-repo `cwd` handling.
- `app_docs/feature-hx6dg4-robustness-hardening-retry-logic-resilience.md` — `initializeWorkflow()` pre-flight checks and `createWorktree()` base-ref logic.
- `README.md` and `adws/README.md` — project structure and the "Worktree discovery and branch lookup" / "State-file overwrite races" failure-mode history that motivates determinism at a single point.

### New Files
- `adws/phases/branchNameResolution.ts` — the extracted resolver module (`readPersistedBranchName`, `persistBranchName`, `resolveWorkflowBranchName`).
- `adws/phases/__tests__/branchNameResolution.test.ts` — Vitest unit tests for the resolver (unit tests are enabled for this repo; see Testing Strategy).

## Implementation Plan
### Phase 1: Foundation — extract the resolver with persistence priority
Create `adws/phases/branchNameResolution.ts` as the single source of truth for "what branch does this `adwId` use." It reads/writes the persisted top-level-state `branchName` and wraps `runGenerateBranchNameAgent`, encoding the priority **persisted → recovery → generate** with a mismatch guard. This isolates the decision into a pure-at-the-edges, unit-testable unit and removes branching complexity from `workflowInit.ts` (which is over the 300-line guideline).

### Phase 2: Core Implementation — rewire `workflowInit.ts` to the resolver
Replace both inline `recovery-or-generate` blocks (target-repo path and local-repo path) with calls to `resolveWorkflowBranchName`. Gate `findWorktreeForIssue` behind "no persisted branch name" so a persisted name is authoritative. Include `branchName` in the canonical top-level-state init write so the persisted record is explicit for every path.

### Phase 3: Integration & validation
Add unit tests proving: persisted name short-circuits the agent; two sequential resolutions with differing agent slugs yield one branch and exactly one agent call (criterion 3); the mismatch guard throws (criterion 2). Run the full validation suite (lint, type-check, unit tests, build, regression BDD) to confirm zero regressions. Optionally implement criterion 4 (sibling-worktree plan search + clearer error) as a defensive safety net layered on top of the now-prevented orphan.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Create the branch-name resolution module
- Create `adws/phases/branchNameResolution.ts`.
- Import `AgentStateManager`, `log`, and types `RecoveryState`, `GitHubIssue`, `IssueClassSlashCommand` from `../core`; import `runGenerateBranchNameAgent` from `../agents`.
- Implement `readPersistedBranchName(adwId: string): string | undefined`:
  - Return `AgentStateManager.readTopLevelState(adwId)?.branchName ?? undefined`.
- Implement `persistBranchName(adwId: string, branchName: string): void`:
  - Call `AgentStateManager.writeTopLevelState(adwId, { branchName })` (merge semantics already preserve sibling fields).
- Implement `resolveWorkflowBranchName(args: { adwId: string; issueType: IssueClassSlashCommand; issue: GitHubIssue; logsDir: string; recoveryState: RecoveryState }): Promise<string>`:
  1. Guard clause: `const persisted = readPersistedBranchName(adwId);` — if truthy, `log` "Reusing persisted branch name for adwId …" and return it (the agent is never called).
  2. Guard clause: if `recoveryState.branchName` is truthy, `log` "Reusing branch from previous workflow: …", call `persistBranchName(adwId, recoveryState.branchName)`, and return it.
  3. Otherwise call `const { branchName: generated } = await runGenerateBranchNameAgent(issueType, issue, logsDir);`.
  4. Re-read persisted state (`const persistedNow = readPersistedBranchName(adwId);`) — if `persistedNow` exists and `persistedNow !== generated`, `throw new Error(...)` with an operator-legible message naming both names, the `adwId`, and issue #524, stating it is refusing to fork into a new worktree.
  5. `log` "Branch name generated: …", call `persistBranchName(adwId, generated)`, and return `generated`.
- Keep the function flat (guard clauses, max depth ~2) per the coding guidelines; add a JSDoc block documenting the priority order and the guard.

### Task 2: Rewire the target-repo branch path in `workflowInit.ts`
- Import `resolveWorkflowBranchName`, `readPersistedBranchName`, and `persistBranchName` from `./branchNameResolution`.
- In the `else if (targetRepoWorkspacePath)` branch, replace the inline `if (recoveryState.branchName) { … } else { runGenerateBranchNameAgent … }` block with:
  - `branchName = await resolveWorkflowBranchName({ adwId: resolvedAdwId, issueType, issue, logsDir, recoveryState });`
  - then the existing `ensureWorktree(branchName, defaultBranch, targetRepoWorkspacePath)` + `copyClaudeCommandsToWorktree` + log lines unchanged.

### Task 3: Rewire the local-repo branch path in `workflowInit.ts`
- In the final `else` branch:
  - Compute `const persistedBranchName = readPersistedBranchName(resolvedAdwId);`.
  - Gate discovery: `const issueWorktree = persistedBranchName ? null : findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath);` (persisted name is authoritative — never adopt a sibling worktree's branch when we already committed to one).
  - In the `if (issueWorktree)` branch, keep existing reuse behavior (`mergeLatestFromDefaultBranch`, `copyEnvToWorktree`, log) unchanged. (Persistence for this path is covered by Task 4's init write.)
  - In the `else` branch, replace the inline `recovery-or-generate` block with `branchName = await resolveWorkflowBranchName({ adwId: resolvedAdwId, issueType, issue, logsDir, recoveryState });`, then keep the existing `getWorktreeForBranch(branchName)` locate-or-`ensureWorktree`-create logic unchanged.

### Task 4: Persist `branchName` in the canonical top-level-state init write
- In the `AgentStateManager.writeTopLevelState(resolvedAdwId, { … })` call that sets `workflowStage: 'starting'`, add the resolved branch name conditionally: `...(branchName ? { branchName } : {})`.
- The conditional spread ensures the `options.cwd` path (where `branchName` stays `''`) never clobbers a previously persisted name. Merge semantics make this idempotent with the resolver's own persist.

### Task 5: Add unit tests for the resolver
- Create `adws/phases/__tests__/branchNameResolution.test.ts` following the conventions in `adws/core/__tests__/topLevelState.test.ts` (real `AgentStateManager`, a unique `adwId` per test, `afterEach` removes `agents/{adwId}`) and `adws/agents/__tests__/gitAgent.test.ts` (`vi.mock` the agent dependency).
- Mock `runGenerateBranchNameAgent` (from `../../agents`) so its return slug is controllable per call.
- Cases:
  1. No persisted, no recovery → resolver calls the agent once, returns the generated name, and persists it (assert `readTopLevelState(adwId).branchName` equals the generated name).
  2. Persisted name present → resolver returns it and the agent mock is **not** called (criterion 1).
  3. `recoveryState.branchName` present, nothing persisted → resolver returns and persists the recovery name without calling the agent.
  4. **Two sequential `resolveWorkflowBranchName` calls, same `adwId`, agent configured to return slug A then slug B** → first call returns A and persists it; second call returns A (not B); assert the agent mock was invoked **exactly once** (criterion 3 — "only one branch/worktree is created").
  5. Mismatch guard (criterion 2) → configure the agent mock to, as a side effect, persist a different name before returning (simulating a concurrent writer during the LLM call), then assert `resolveWorkflowBranchName` rejects with the "Refusing to fork" error.

### Task 6: (Optional follow-up — criterion 4) Sibling-worktree plan search and clearer error
- In `adws/agents/planAgent.ts`, extend `findPlanFile` (and therefore `getPlanFilePath`/`planFileExists`/`readPlanFile`) so that when no plan is found in the current worktree's `specs/`, it scans sibling `.worktrees/{prefix}-issue-{N}-*/specs/` directories for a matching `issue-{N}-adw-*-sdlc_planner-*.md` and returns that path if found. Keep this read-only and defensive; flatten with guard clauses.
- In `adws/phases/buildPhase.ts` and `adws/phases/planValidationPhase.ts`, when the plan read fails, enrich the thrown message: if a sibling worktree holds the plan, name that orphan worktree path explicitly so an operator can act.
- This phase is explicitly optional; the primary fix (Tasks 1–5) prevents the orphan from being created. If deferred, record it as a follow-up.

### Task 7: Run all validation commands
- Run every command in the Validation Commands section and confirm each exits without error.

## Testing Strategy
### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope.

- New `adws/phases/__tests__/branchNameResolution.test.ts` covers the resolver as described in Task 5: persisted short-circuit, recovery reuse, generate-and-persist, the two-call single-branch regression (criterion 3), and the mismatch-abort guard (criterion 2).
- Use the existing test conventions: real `AgentStateManager` against a unique per-test `adwId` with `afterEach` cleanup (mirrors `topLevelState.test.ts`), and `vi.mock` for the agent layer (mirrors `gitAgent.test.ts`). Do not mock `AgentStateManager` itself — exercising the real merge/atomic-write path is what proves persistence.
- The existing `adws/core/__tests__/topLevelState.test.ts` already asserts the `branchName` field round-trips through top-level state (the `pid/pidStartedAt/lastSeenAt/branchName` case); no change required there, but it must continue to pass.

### Edge Cases
- **Cleared "Branch Created" comment**: `recoveryState.branchName` is null on re-entry, but a persisted `branchName` exists → resolver returns the persisted name; no agent call.
- **Pruned worktree branch**: persisted name exists but `getWorktreeForBranch` returns nothing → the local path recreates the worktree for the persisted branch via `ensureWorktree`; no agent call, no new slug.
- **`findWorktreeForIssue` matches a sibling orphan while a persisted name exists**: discovery is skipped because the persisted name is authoritative.
- **`options.cwd` provided**: branch name is intentionally left unresolved; Task 4's conditional spread must not write an empty `branchName` over a persisted one.
- **Corrupted/unreadable top-level state**: `readTopLevelState` returns null (existing behavior), so `readPersistedBranchName` returns `undefined`; the resolver proceeds to recovery/generate and the post-generation re-read guard still protects against a concurrent valid write.
- **Target-repo workflows**: persistence is keyed by `adwId` under the ADW host's `agents/` dir, independent of the target-repo worktree cwd — confirm the resolver works identically for the `targetRepoWorkspacePath` path.
- **First-ever run**: nothing persisted, no recovery → agent fires exactly once, result persisted.

## Acceptance Criteria
- Once `branchName` is resolved for an `adwId`, it is written to `agents/{adwId}/state.json` and read back as the highest-priority source on every subsequent `initializeWorkflow` call for that `adwId`; `runGenerateBranchNameAgent` is not called a second time within the same `adwId`. (Criterion 1)
- If `runGenerateBranchNameAgent` is somehow invoked a second time within the same `adwId` and returns a name differing from the persisted one, `resolveWorkflowBranchName` throws a clear, operator-legible error (names both branch names, the `adwId`, and references the no-fork intent) rather than creating a second worktree. (Criterion 2)
- A unit test simulates two `resolveWorkflowBranchName` calls with the same `adwId` where the underlying agent would return different slugs, and asserts the second call returns the first name with the agent invoked exactly once (only one branch created). (Criterion 3)
- Both `runGenerateBranchNameAgent` call sites in `workflowInit.ts` route through `resolveWorkflowBranchName`; the local path treats a persisted name as authoritative over `findWorktreeForIssue`.
- (Optional, follow-up) `findPlanFile` falls back to sibling worktrees and the "Cannot read plan file" errors name the orphan worktree when one holds the plan. (Criterion 4)
- `bun run lint`, both `tsc --noEmit` checks, `bun run test:unit`, `bun run build`, and the `@regression` BDD suite all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint passes with no errors.
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check passes (new module + rewired `workflowInit.ts` type-check clean).
- `bun run test:unit` — all Vitest unit tests pass, including the new `branchNameResolution.test.ts` and the existing `topLevelState.test.ts`.
- `bun run build` — build completes with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression BDD suite passes (no regression in worktree/branch behavior).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-sh8m9r-branchname-agent-re"` — runs any per-issue BDD scenarios generated for this issue (if the scenario phase produces them).

## Notes
- `.adw/coding_guidelines.md` applies. The change is built to satisfy: **single responsibility** (resolution extracted to its own module; `workflowInit.ts` shrinks back under the 300-line guideline), **clarity over cleverness** (guard clauses, named helpers, explicit priority order), **immutability/purity at the edges** (persistence side effects isolated in `persistBranchName`; the priority decision is straight-line), and **type safety** (no `any`; reuse the existing `AgentState.branchName` field and `RecoveryState` type).
- This builds directly on issue #455 / adwId `7dp24s` (Deterministic Branch-Name Assembly), which already guarantees the *assembled name from a given slug* is deterministic. #524 closes the remaining gap: the *slug itself* is non-deterministic across LLM calls, so the chosen name must be persisted and reused rather than regenerated.
- No new libraries are required, so no install command is needed (for reference, this repo's library install command from `.adw/commands.md` is `bun add <package>`).
- No schema migration: `AgentState.branchName` already exists and `readTopLevelState`/`writeTopLevelState` already support it (verified by the existing `topLevelState.test.ts` round-trip case).
- The persisted top-level state is keyed by `adwId` and lives under the ADW host's `agents/` directory, so the fix is robust to the "worktree created under a target-repo path / lookup runs against a different cwd" gap called out in the issue.
- Criterion 4 is intentionally scoped as an optional follow-up: once orphan creation is prevented (Tasks 1–5), the sibling-search fallback is a defensive net rather than a load-bearing fix. If time-boxed out, leave it as a tracked follow-up rather than blocking the core fix.
- Out of scope: populating `ctx.branchName` for downstream phases in the non-recovery path (a separate latent inconsistency), and pruning pre-existing orphan worktrees from past incidents.
