# Bug: agentic_kpis.md updated but never pushed

## Metadata
issueNumber: `196`
adwId: `jm6pnw-push-adw-kpis`
issueJson: `{"number":196,"title":"push adw_kpis","body":"/bug \n\nThe agentic_kpis.md file is updated but never pushed","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T11:25:00Z","comments":[],"actionableComment":null}`

## Bug Description
The KPI phase (`adws/phases/kpiPhase.ts`) runs the KPI agent which updates `app_docs/agentic_kpis.md` in the ADW repo root, but the phase never commits or pushes the changes. The file is updated locally and then the changes are lost when the worktree is cleaned up or the workflow ends.

**Expected behavior:** After the KPI agent successfully updates `app_docs/agentic_kpis.md`, the changes should be committed and pushed to the remote so KPI data is persisted.

**Actual behavior:** The file is updated on disk but never committed or pushed. The feature docs explicitly note: "No git operations in KPI phase: unlike the document phase, `executeKpiPhase` never commits or pushes."

## Problem Statement
The `executeKpiPhase` function in `adws/phases/kpiPhase.ts` lacks commit and push operations after the KPI agent updates `app_docs/agentic_kpis.md`. The document phase (`documentPhase.ts`) correctly commits and pushes its output, but the KPI phase was implemented without these git operations.

## Solution Statement
Add a `commitAndPushKpiFile` function to `adws/vcs/commitOperations.ts` following the existing `commitAndPushCostFiles` pattern, and call it from `kpiPhase.ts` after the KPI agent succeeds. The function will stage only `app_docs/agentic_kpis.md`, commit with a KPI-specific message, fetch/rebase to avoid conflicts, and push to the current branch.

## Steps to Reproduce
1. Run the full SDLC orchestrator: `bunx tsx adws/adwSdlc.tsx <issueNumber>`
2. Observe that `app_docs/agentic_kpis.md` is updated locally by the KPI agent
3. Check `git status` — the file has uncommitted changes
4. The workflow completes without committing or pushing the KPI file
5. The KPI data is lost

## Root Cause Analysis
When the KPI tracking feature was implemented (issue #148, ADW ID `8ar0fo`), the design intentionally omitted git operations from `executeKpiPhase`. The feature docs state: "No git operations in KPI phase: unlike the document phase, executeKpiPhase never commits or pushes. The updated app_docs/agentic_kpis.md lives in the ADW repo and is committed separately (e.g. via /commit_cost or a manual commit)."

However, there is no automatic mechanism that commits and pushes `app_docs/agentic_kpis.md`. The `/commit_cost` command only handles files under `projects/`, not `app_docs/`. Manual commits are unreliable in an automated workflow. The result is that KPI data is always lost.

## Relevant Files
Use these files to fix the bug:

- `adws/phases/kpiPhase.ts` — The KPI phase that needs commit+push after the agent succeeds
- `adws/vcs/commitOperations.ts` — Contains `commitAndPushCostFiles` pattern to follow; add `commitAndPushKpiFile` here
- `adws/vcs/index.ts` — Export barrel; needs to export the new function
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

## Step by Step Tasks

### Step 1: Add `commitAndPushKpiFile` to `commitOperations.ts`
- Add a new exported function `commitAndPushKpiFile(cwd?: string): boolean` to `adws/vcs/commitOperations.ts`
- Follow the exact pattern of `commitAndPushCostFiles`:
  1. `git status --porcelain -- "app_docs/agentic_kpis.md"` to check for changes
  2. `git add "app_docs/agentic_kpis.md"` to stage only the KPI file
  3. `git commit -m "kpis: update agentic_kpis"` to commit
  4. `getCurrentBranch(cwd)` to get the current branch
  5. `git fetch origin "<branch>"` to sync
  6. `git rebase --autostash "origin/<branch>"` to rebase
  7. `git push origin "<branch>"` to push
- Return `true` if committed+pushed, `false` if no changes or on failure
- Wrap in try/catch, log errors with `log()`, return `false` on failure (non-fatal, matching the KPI phase's non-fatal design)

### Step 2: Export `commitAndPushKpiFile` from `adws/vcs/index.ts`
- Add `commitAndPushKpiFile` to the commit operations export block in `adws/vcs/index.ts`

### Step 3: Call `commitAndPushKpiFile` in `kpiPhase.ts` after agent success
- Import `commitAndPushKpiFile` from `'../vcs'` in `adws/phases/kpiPhase.ts`
- After the KPI agent returns successfully (after the `AgentStateManager.writeState` success block at ~line 88), call `commitAndPushKpiFile()` with no `cwd` argument (the KPI agent writes to the ADW repo root)
- This call is already inside the try/catch that makes the phase non-fatal, so push failures won't block the workflow

### Step 4: Run validation commands

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript compilation check
- `bun run lint` — Lint check for code quality
- `bun run test` — Run tests to validate zero regressions

## Notes
- The fix follows the existing `commitAndPushCostFiles` pattern in `commitOperations.ts` for consistency.
- The `commitAndPushKpiFile` call is inside the existing try/catch in `executeKpiPhase`, preserving the non-fatal design — push failures are logged but never block the workflow.
- The function stages only `app_docs/agentic_kpis.md`, not all changes, to avoid accidentally committing unrelated files.
- No new libraries are required.
