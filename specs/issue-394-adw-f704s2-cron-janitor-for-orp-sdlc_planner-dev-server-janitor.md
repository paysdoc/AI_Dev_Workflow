# Feature: Cron Janitor for Orphaned Dev Servers

## Metadata
issueNumber: `394`
adwId: `f704s2-cron-janitor-for-orp`
issueJson: `{"number":394,"title":"cron janitor for orphaned dev servers","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nAdd a new cron probe `adws/triggers/devServerJanitor.ts` that scans target repository worktrees on a 5-minute timer for orphaned dev server processes (the catastrophic safety net for SIGKILL'd orchestrators). It walks each target repo's `.worktrees/` directory, runs `lsof +D` per worktree to find process holders, and applies the kill decision rule: leave alone if (workflow stage is non-terminal AND the orchestrator PID is still alive) OR (the worktree is younger than 30 minutes). Otherwise SIGTERM the process, wait, SIGKILL survivors. Wires the probe into the existing `trigger_cron.ts` loop alongside `pauseQueueScanner` etc.\n\nThis is a deep module: single entry function `runJanitorPass()` encapsulating worktree discovery, lsof probe, age check, state file lookup, kill decision rule, and signal escalation. Unit-tested by mocking fs operations, the orchestrator state file reader, and `process.kill`.\n\nLands first as a safety net so the rest of the refactor can proceed without leaks accumulating.\n\n## Acceptance criteria\n\n- [ ] `adws/triggers/devServerJanitor.ts` exists exporting `runJanitorPass()`\n- [ ] Wired into `adws/triggers/trigger_cron.ts` on a 5-minute timer\n- [ ] Unit tests in `adws/triggers/__tests__/devServerJanitor.test.ts` cover all four cells of the (terminal-stage x PID-alive) x (younger-than-30-min x older-than-30-min) decision matrix\n- [ ] Tests verify SIGTERM/SIGKILL escalation\n- [ ] Manual smoke test: run `bunx tsx adws/triggers/trigger_cron.ts` against a worktree with a leaked dev server, observe cleanup after the grace period\n- [ ] Existing trigger_cron probes (pauseQueueScanner, etc.) still function\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 2\n- User story 3\n- User story 4\n- User story 39","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:02:56Z","comments":[],"actionableComment":null}`

## Feature Description
A cron-based janitor probe that scans target repository worktrees for orphaned dev server processes left behind by SIGKILL'd or crashed orchestrators. This is the catastrophic safety net ensuring leaked dev servers don't accumulate across workflow runs. The janitor discovers worktrees across all target repos, probes each for running processes via `lsof`, cross-references the workflow state file and orchestrator PID liveness, and applies a conservative kill decision rule with a 30-minute age grace period. Processes surviving SIGTERM are escalated to SIGKILL.

## User Story
As an ADW operator
I want orphaned dev server processes to be automatically detected and cleaned up
So that leaked processes from crashed orchestrators don't accumulate and consume system resources

## Problem Statement
When an ADW orchestrator is killed via SIGKILL (or crashes unexpectedly), the dev server processes it spawned inside worktrees are left running as orphans. These orphaned processes consume ports, memory, and CPU indefinitely. There is currently no automated mechanism to detect and clean up these leaked processes.

## Solution Statement
Add a janitor probe (`devServerJanitor.ts`) to the existing cron trigger loop that runs every 5 minutes. It walks all target repo worktrees, uses `lsof +D` to discover processes, reads the workflow state file to determine stage and orchestrator PID liveness, and applies a conservative kill rule: skip if the workflow is still active with a live orchestrator, or if the worktree is younger than 30 minutes. Otherwise, SIGTERM processes with SIGKILL escalation for survivors. The module is designed as a deep module with a single entry point `runJanitorPass()` and fully injectable dependencies for unit testing.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_cron.ts` — Main cron loop; the janitor probe will be wired here alongside `scanPauseQueue`. The pattern for calling probes on cycle intervals is established here.
- `adws/triggers/pauseQueueScanner.ts` — Reference implementation for a cron probe; follow its pattern of cycle-gated execution and exported scan function.
- `adws/triggers/cronStageResolver.ts` — Exports `isActiveStage()` for determining terminal vs non-terminal workflow stages. The janitor uses this to classify stages.
- `adws/triggers/__tests__/cronStageResolver.test.ts` — Reference for test patterns in the triggers test directory (Vitest, describe/it, pure function testing with injected dependencies).
- `adws/core/stateHelpers.ts` — Exports `isProcessAlive(pid)` and `isAgentProcessRunning(adwId)` for checking orchestrator PID liveness.
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState(adwId)` reads workflow state from `agents/{adwId}/state.json`.
- `adws/vcs/worktreeCleanup.ts` — Exports `killProcessesInDirectory(directoryPath)` which implements the `lsof +D` probe → SIGTERM → wait → SIGKILL pattern. The janitor can reuse this for the actual kill step.
- `adws/vcs/worktreeQuery.ts` — Exports `listWorktrees(cwd?)` for listing worktrees under `.worktrees/` in a given repo.
- `adws/core/environment.ts` — Exports `TARGET_REPOS_DIR` (default: `~/.adw/repos/`), the base directory for cloned target repos.
- `adws/core/config.ts` — Exports timing/interval constants like `PROBE_INTERVAL_CYCLES`. The janitor interval constant will be added here.
- `adws/core/adwId.ts` — Documents the branch naming format `<issueClass>-issue-<N>-adw-<adwId>-<name>`, used to extract adwId from worktree directory names.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `vitest.config.ts` — Vitest configuration; tests must be in `adws/**/__tests__/**/*.test.ts`.

### Conditional Documentation
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` — Read when working with cron stage resolver and trigger infrastructure.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — Read when working with `agents/<adwId>/state.json` and workflow stage queries.

### New Files
- `adws/triggers/devServerJanitor.ts` — The janitor probe module exporting `runJanitorPass()`.
- `adws/triggers/__tests__/devServerJanitor.test.ts` — Unit tests for the janitor decision logic, worktree discovery, and kill escalation.

## Implementation Plan
### Phase 1: Foundation
Define the types, constants, and pure decision logic for the janitor. The kill decision rule is the core of the module and should be implemented as a pure function with no side effects, making it directly testable. Add the janitor cycle interval constant to the config module.

### Phase 2: Core Implementation
Implement the deep module `devServerJanitor.ts` with a single entry function `runJanitorPass()`. Internally, it composes:
1. **Target repo discovery** — walk `TARGET_REPOS_DIR` to find all cloned repos
2. **Worktree enumeration** — use `listWorktrees(cwd)` per repo to find `.worktrees/` entries
3. **AdwId extraction** — parse directory names using the `{type}-issue-{N}-adw-{adwId}` pattern
4. **State lookup** — read `agents/{adwId}/state.json` for workflow stage
5. **Orchestrator PID check** — use `isAgentProcessRunning(adwId)` for liveness
6. **Age check** — `fs.statSync(worktreePath).birthtimeMs` compared to 30-minute threshold
7. **Process probe** — `lsof +D` to discover PIDs in each worktree
8. **Kill decision** — pure function applying the rule: skip if (non-terminal AND PID alive) OR (younger than 30 min)
9. **Kill execution** — reuse `killProcessesInDirectory()` from `worktreeCleanup.ts`

All OS-touching functions (fs, lsof, process.kill, state reader) are passed as injectable dependencies so unit tests can mock them.

### Phase 3: Integration
Wire `runJanitorPass()` into `trigger_cron.ts` on a 5-minute interval (every `JANITOR_INTERVAL_CYCLES` poll cycles). Follow the same pattern as `scanPauseQueue` — call the janitor in `checkAndTrigger()` gated by cycle count. Verify existing probes still function.

## Step by Step Tasks

### Step 1: Read conditional documentation
- Read `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` for cron trigger context
- Read `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` for state file patterns

### Step 2: Add janitor interval constant to config
- In `adws/core/config.ts`, add `JANITOR_INTERVAL_CYCLES` constant (default: 15 cycles = ~5 min at 20s poll interval)
- Export it from `adws/core/config.ts`
- Add re-export in `adws/core/index.ts`

### Step 3: Implement `adws/triggers/devServerJanitor.ts`
- Create the file with the following structure:
- **Types**: `JanitorDeps` interface for injectable dependencies (fs readdir/stat, listWorktrees, readTopLevelState, isAgentProcessRunning, killProcessesInDirectory, log), `WorktreeCandidate` for intermediate state
- **`extractAdwIdFromDirName(dirName: string): string | null`** — pure function, parses `{type}-issue-{N}-adw-{adwId}` pattern, returns adwId or null
- **`shouldCleanWorktree(isNonTerminal: boolean, orchestratorAlive: boolean, ageMs: number, gracePeriodMs: number): boolean`** — pure kill decision function: returns false (skip) if `(isNonTerminal && orchestratorAlive) || (ageMs < gracePeriodMs)`; returns true (kill) otherwise
- **`discoverTargetRepoWorktrees(deps): WorktreeCandidate[]`** — walks `TARGET_REPOS_DIR/{owner}/{repo}/` directories, calls `listWorktrees(cwd)` for each repo that has a `.git/` directory
- **`runJanitorPass(deps?): Promise<void>`** — main entry point:
  1. Call `discoverTargetRepoWorktrees()` to get all worktree paths
  2. For each worktree: extract adwId, read state, check orchestrator PID, check age, probe processes via lsof
  3. Apply `shouldCleanWorktree()` decision
  4. If should clean: call `killProcessesInDirectory()`
  5. Log actions taken
- Use default `deps` that wire to real implementations so callers just call `runJanitorPass()` with no args
- Export `runJanitorPass`, `shouldCleanWorktree`, `extractAdwIdFromDirName`, and `JANITOR_GRACE_PERIOD_MS` (30 minutes)

### Step 4: Write unit tests in `adws/triggers/__tests__/devServerJanitor.test.ts`
- **`shouldCleanWorktree` tests** — cover all cells of the decision matrix:
  - Non-terminal stage, PID alive, any age → false (skip)
  - Non-terminal stage, PID dead, younger than 30 min → false (skip, age grace)
  - Non-terminal stage, PID dead, older than 30 min → true (kill)
  - Terminal stage, PID alive, younger than 30 min → false (skip, age grace)
  - Terminal stage, PID alive, older than 30 min → true (kill)
  - Terminal stage, PID dead, younger than 30 min → false (skip, age grace)
  - Terminal stage, PID dead, older than 30 min → true (kill)
- **`extractAdwIdFromDirName` tests** — valid patterns, missing `adw-` prefix, edge cases
- **Kill escalation tests** — inject mock `killProcessesInDirectory` into `runJanitorPass` via deps and verify it is called for eligible worktrees and skipped for ineligible ones
- **Worktree discovery tests** — inject mock fs operations and verify correct enumeration of target repos and worktrees
- **No-state-file edge case** — verify worktree with no extractable adwId or no state file uses only the age check (treats stage as terminal, PID as dead)
- Follow the Vitest patterns from `cronStageResolver.test.ts`

### Step 5: Wire janitor into `trigger_cron.ts`
- Import `runJanitorPass` from `./devServerJanitor`
- Import `JANITOR_INTERVAL_CYCLES` from `../core`
- In the `checkAndTrigger()` function, add a cycle-gated call to `runJanitorPass()` following the `scanPauseQueue` pattern:
  ```
  if (cycleCount % JANITOR_INTERVAL_CYCLES === 0) {
    await runJanitorPass();
  }
  ```
- Place the call after the existing `scanPauseQueue(cycleCount)` call

### Step 6: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify type safety
- Run `bun run test` to verify unit tests pass (including new janitor tests)
- Run `bun run build` to verify no build errors

## Testing Strategy
### Unit Tests
Tests in `adws/triggers/__tests__/devServerJanitor.test.ts`:

1. **Decision matrix (shouldCleanWorktree)**: Pure function tests covering all 7 meaningful cells of the (terminal/non-terminal) x (PID alive/dead) x (young/old) matrix. The key insight: non-terminal + PID alive always skips regardless of age; all other combinations depend on age.

2. **AdwId extraction (extractAdwIdFromDirName)**: Tests for valid branch name patterns (`feature-issue-123-adw-abc123-slug`), patterns missing the `adw-` marker, bare directory names, and edge cases.

3. **Kill execution**: Mock the `deps.killProcessesInDirectory` callback, run `runJanitorPass()` against mock worktrees spanning all decision cells, assert kill is called exactly for the eligible candidates.

4. **Worktree discovery**: Mock `deps.readdir` and `deps.listWorktrees` to simulate multiple target repos with varying worktree counts, verify all are enumerated.

5. **SIGTERM/SIGKILL escalation**: The actual escalation logic lives in the existing `killProcessesInDirectory` (already tested via worktreeCleanup). The janitor tests verify the function is called with the correct worktree path.

### Edge Cases
- Worktree directory with no extractable adwId (e.g., manually created) → treated as terminal-stage + dead-PID, subject only to age check
- State file missing for a valid adwId → same as above
- Target repo directory exists but has no `.git/` → skipped
- `lsof` not available → `killProcessesInDirectory` already handles this silently
- Empty `TARGET_REPOS_DIR` (no target repos) → janitor completes with no action
- Worktree path no longer exists on disk between enumeration and probe → handle gracefully

## Acceptance Criteria
- `adws/triggers/devServerJanitor.ts` exists and exports `runJanitorPass()`
- `runJanitorPass` is wired into `trigger_cron.ts` on a 5-minute cycle interval
- Unit tests in `adws/triggers/__tests__/devServerJanitor.test.ts` cover all cells of the (terminal-stage x PID-alive) x (age) decision matrix
- Tests verify kill execution is invoked for eligible worktrees and skipped for ineligible ones
- `bun run lint`, `bunx tsc --noEmit`, and `bun run test` all pass
- Existing trigger_cron probes (`scanPauseQueue`, PR review polling) still function unchanged

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root-level type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check
- `bun run test` — Run all Vitest unit tests (includes new janitor tests + existing tests for zero regressions)
- `bun run build` — Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` coding guidelines must be followed throughout implementation. Key points: clarity over cleverness, modularity (<300 lines), immutability, type safety, pure functions with side effects at boundaries, declarative style.
- The existing `killProcessesInDirectory` in `adws/vcs/worktreeCleanup.ts` already implements the full lsof → SIGTERM → wait → SIGKILL pattern. The janitor reuses this rather than reimplementing kill logic.
- The janitor is designed as a deep module: a rich `runJanitorPass()` entry point hides all internal complexity (discovery, probing, decision, killing) behind a simple interface.
- All OS-interacting functions are injected via a `deps` parameter so the module is fully unit-testable without touching the filesystem, processes, or state files.
- The 30-minute grace period is deliberately conservative to avoid killing processes that belong to recently-started workflows whose state files haven't been written yet.
- `birthtimeMs` from `fs.statSync` is used for worktree age. On macOS this is reliable; on Linux `ctimeMs` may be more appropriate. For the initial implementation, `birthtimeMs` with a fallback to `ctimeMs` is sufficient.
