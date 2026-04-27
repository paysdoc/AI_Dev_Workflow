# Fix Janitor adwId Lookup via Issue Number

**ADW ID:** yw233r-dev-server-janitor-r
**Date:** 2026-04-27
**Specification:** specs/issue-499-adw-yw233r-dev-server-janitor-r-sdlc_planner-fix-janitor-adwid-lookup.md

## Overview

The dev server janitor was silently killing live ADW build agents because its branch-name parser searched for a `-adw-` segment that the production branch generator never produces. This fix replaces the broken directory-name parser with a two-step lookup: extract the issue number from the branch name, then scan `agents/*/state.json` files to find the matching adwId. Both protective signals (non-terminal workflow stage and orchestrator liveness) are now correctly restored for all production worktrees.

## What Was Built

- `extractIssueNumberFromDirName(dirName)` — new exported parser matching the real branch format (`-issue-<N>-`)
- `findActiveAdwIdForIssue(issueNumber, deps)` — state-file scanner that picks the freshest matching adwId by `lastSeenAt`
- Two new `JanitorDeps` fields: `listAdwStateDirs` and `readTopLevelStateRaw` for injectable state-dir enumeration
- `defaultListAdwStateDirs()` — default implementation reading `AGENTS_STATE_DIR`, filtering out `cron/` and non-directories
- Replaced the broken `extractAdwIdFromDirName` call in `runJanitorPass` step 2 with the two-step lookup
- Removed the dead `extractAdwIdFromDirName` function entirely
- Full test coverage for both new helpers plus updated `runJanitorPass` integration tests using real branch-name fixtures and the new state-file-driven path

## Technical Implementation

### Files Modified

- `adws/triggers/devServerJanitor.ts`: Replaced `extractAdwIdFromDirName` with `extractIssueNumberFromDirName` + `findActiveAdwIdForIssue`; extended `JanitorDeps` with `listAdwStateDirs` and `readTopLevelStateRaw`; added `defaultListAdwStateDirs`; wired both into `DEFAULT_DEPS`; swapped the lookup in `runJanitorPass` step 2
- `adws/triggers/__tests__/devServerJanitor.test.ts`: Deleted the fabricated-fixture `extractAdwIdFromDirName` test block; added `extractIssueNumberFromDirName` and `findActiveAdwIdForIssue` describe blocks; updated all `runJanitorPass` cases to real branch formats and the new state-file path; added live-build-agent skip regression test

### Key Changes

- **Root cause fixed:** The old `extractAdwIdFromDirName` searched for `-adw-` which `generateBranchName()` in `adws/vcs/branchOperations.ts` never emits — real branches are `${prefix}-issue-${issueNumber}-${slug}` with no adwId segment.
- **New lookup path:** Issue number is extracted from the directory name via `/-issue-(\d+)-/`, then `agents/*/state.json` files are scanned for a matching `issueNumber` field; the entry with the freshest `lastSeenAt` (heartbeat-maintained) wins.
- **Both protective signals restored:** Once `adwId` resolves to a non-null value, `isNonTerminal` (via `isActiveStage`) and `orchestratorAlive` (via `isAgentProcessRunning`) work as intended, preventing any live build agent from being SIGTERMed.
- **Cron directory excluded:** `defaultListAdwStateDirs` filters out `agents/cron/` which exists alongside adwId directories but is not a workflow state directory.
- **Tests fixed:** All prior tests asserted against the fabricated format `feature-issue-1-adw-abc-slug`; tests now use real formats like `feature-issue-55-scraper-visual-asset-capture` and `bugfix-issue-499-fix-janitor-adwid-lookup`.

## How to Use

No user-facing action required. The janitor runs automatically every `JANITOR_INTERVAL_CYCLES` (15) × 20s = 5 minutes. After this fix:

1. The janitor reads worktree directory names from each target repo's `.worktrees/` path.
2. For each worktree, it extracts the issue number from the directory name (e.g., `feature-issue-55-…` → `55`).
3. It scans `agents/*/state.json` to find the adwId whose state file has `issueNumber: 55` and the freshest `lastSeenAt`.
4. With a valid adwId, it reads the workflow stage and checks the orchestrator PID — and will skip killing if the stage is non-terminal and the PID is alive.
5. Only worktrees with a terminal stage, a dead PID, or no identifiable adwId (and older than 30 minutes) are cleaned up.

## Configuration

No new configuration. The state directory is read from `AGENTS_STATE_DIR` (exported from `adws/core/environment.ts`), which is the existing `agents/` directory used by all other ADW components.

## Testing

```bash
bunx vitest run adws/triggers/__tests__/devServerJanitor.test.ts
bun run test:unit
bunx tsc --noEmit -p adws/tsconfig.json
```

The key regression test is `"skips live build agent: non-terminal stage + alive PID + real branch name"` which exercises the production-bug path: a real branch name (`feature-issue-55-scraper-visual-asset-capture`), `workflowStage: 'build_running'`, PID alive, age > grace → `killProcessesInDirectory` must NOT be called.

## Notes

- **Residual risk:** If a state file is deleted or unreadable while the agent is still alive, `findActiveAdwIdForIssue` returns `null` and the 30-minute age check still reaps. This is the same failure mode as before the fix but with much narrower exposure (only crash-truncated state files, not every productive worktree). A follow-up should convert this path to a loud skip rather than a silent kill.
- **Incident recovery (issue #55):** The original victim build agent exited with code 143; the orchestrator wrote `Blocked` to the project board. Recovery: post `## Cancel` on issue #55, then re-run. This is out of scope for the fix.
- **No new dependencies:** The fix uses only existing types (`AgentState`) and existing infrastructure (`AGENTS_STATE_DIR`, `AgentStateManager.readTopLevelState`).
