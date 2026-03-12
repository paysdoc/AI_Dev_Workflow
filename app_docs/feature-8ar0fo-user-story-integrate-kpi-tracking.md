# Integrate Agentic KPI Tracking into ADW Workflow

**ADW ID:** 8ar0fo-user-story-integrate
**Date:** 2026-03-12
**Specification:** specs/issue-148-adw-ba2xc9-user-story-integrate-sdlc_planner-integrate-kpi-tracking.md

## Overview

This feature wires the existing `/track_agentic_kpis` slash command into the automated ADW SDLC workflow pipeline, so KPI metrics are captured automatically after every run. It also generifies the slash command to eliminate hardcoded Python references in favour of the project's configured package manager, and introduces a non-fatal KPI phase that never blocks workflow completion.

## What Was Built

- **KPI Agent** (`adws/agents/kpiAgent.ts`) — invokes `/track_agentic_kpis` via `runClaudeAgentWithCommand`, writing `app_docs/agentic_kpis.md` to the ADW repo (CWD `undefined`, not the target worktree)
- **KPI Phase** (`adws/phases/kpiPhase.ts`) — orchestrates the KPI agent; wraps everything in a try/catch so failures are logged but never block the workflow
- **Generified slash command** (`.claude/commands/track_agentic_kpis.md`) — replaced all `python -c "print(...)"` expressions with `{package_manager} -e "console.log(...)"` using JS syntax; added a Setup section that reads the package manager from `.adw/commands.md` (falls back to `node`); added `worktree_path` to the state_json schema
- **Type system updates** — `/track_agentic_kpis` added to `SlashCommand`; `'kpi-agent'` added to `AgentIdentifier`
- **Model/effort mappings** — `/track_agentic_kpis` maps to `haiku` / `medium` (normal) and `haiku` / `low` (fast)
- **SDLC orchestrator integration** (`adws/adwSdlc.tsx`) — KPI phase chained after the document phase and before `completeWorkflow`, with cost/usage accumulation
- **Unit tests** — `adws/agents/__tests__/kpiAgent.test.ts` and `adws/phases/__tests__/kpiPhase.test.ts`

## Technical Implementation

### Files Modified

- `.claude/commands/track_agentic_kpis.md`: removed all Python references; added Setup section for runtime resolution; replaced inline calculations with JS expressions; added `worktree_path` schema field
- `adws/types/issueTypes.ts`: added `'/track_agentic_kpis'` to the `SlashCommand` union type
- `adws/types/agentTypes.ts`: added `'kpi-agent'` to the `AgentIdentifier` union type
- `adws/core/config.ts`: added `/track_agentic_kpis` entries to all four model/effort maps
- `adws/core/__tests__/slashCommandModelMap.test.ts`: updated entry count assertions from 19 → 20; added `/track_agentic_kpis` value assertions
- `adws/agents/index.ts`: exported `runKpiAgent` and `formatKpiArgs`
- `adws/phases/index.ts`: exported `executeKpiPhase`
- `adws/workflowPhases.ts`: re-exported `executeKpiPhase`
- `adws/adwSdlc.tsx`: imported and chained `executeKpiPhase` after document phase; updated workflow header comment (step 8: KPI, step 9: finalize)

### New Files

- `adws/agents/kpiAgent.ts`: `formatKpiArgs` + `runKpiAgent` following the `documentAgent.ts` pattern
- `adws/agents/__tests__/kpiAgent.test.ts`: unit tests for both exported functions
- `adws/phases/kpiPhase.ts`: `executeKpiPhase` following the `documentPhase.ts` pattern
- `adws/phases/__tests__/kpiPhase.test.ts`: unit tests including non-fatal failure behaviour

### Key Changes

- **Non-fatal design**: `executeKpiPhase` wraps its entire body in try/catch, returning `{ costUsd: 0, modelUsage: {} }` on any error — KPI failures never propagate to the outer orchestrator
- **ADW repo CWD**: `runKpiAgent` passes `undefined` as the `cwd` argument to `runClaudeAgentWithCommand`, ensuring `app_docs/agentic_kpis.md` is written to the ADW repo, not the target worktree
- **`allAdws` list construction**: starts with `['adw_plan_iso']`; appends one `'adw_patch_iso'` per `reviewRetries` to accurately reflect the number of planning/patching iterations
- **Package manager resolution**: the slash command reads `.adw/commands.md` at runtime to find the configured package manager (e.g. `bun`), falling back to `node` if absent
- **`worktree_path` support**: when present in state_json, the diff command becomes `git -C <worktree_path> diff origin/main --shortstat` instead of the bare `git diff`

## How to Use

The KPI phase runs automatically as part of the SDLC workflow (`adws/adwSdlc.tsx`). No manual steps are required for standard operation.

To inspect or manually trigger KPI tracking:

1. Ensure `app_docs/agentic_kpis.md` exists or will be created on first run.
2. Build the state JSON:
   ```json
   {
     "adw_id": "<adwId>",
     "issue_number": 148,
     "issue_class": "feature",
     "plan_file": "specs/issue-148-plan.md",
     "all_adws": ["adw_plan_iso"],
     "worktree_path": "/path/to/worktree"
   }
   ```
3. Run the slash command directly:
   ```
   /track_agentic_kpis '<state_json>'
   ```
4. The command updates `app_docs/agentic_kpis.md` with the new row and recalculates summary KPIs.

## Configuration

| Setting | Location | Default |
|---|---|---|
| Package manager | `.adw/commands.md` → `## Package Manager` | `node` |
| KPI model (normal) | `adws/core/config.ts` → `SLASH_COMMAND_MODEL_MAP` | `haiku` |
| KPI model (fast) | `adws/core/config.ts` → `SLASH_COMMAND_MODEL_MAP_FAST` | `haiku` |
| KPI effort (normal) | `adws/core/config.ts` → `SLASH_COMMAND_EFFORT_MAP` | `medium` |
| KPI effort (fast) | `adws/core/config.ts` → `SLASH_COMMAND_EFFORT_MAP_FAST` | `low` |

No new environment variables are required.

## Testing

```bash
# TypeScript compilation check
bunx tsc --noEmit -p adws/tsconfig.json

# Full test suite (includes new KPI agent/phase tests and updated map tests)
bun run test

# Run only KPI-related tests
bun run test adws/agents/__tests__/kpiAgent.test.ts
bun run test adws/phases/__tests__/kpiPhase.test.ts
bun run test adws/core/__tests__/slashCommandModelMap.test.ts
```

Key test scenarios covered:
- `formatKpiArgs` produces valid JSON with all required keys
- `runKpiAgent` calls `runClaudeAgentWithCommand` with `/track_agentic_kpis`, `haiku` model, `medium` effort, and `undefined` CWD
- `allAdws` list is `['adw_plan_iso']` when `reviewRetries` is 0 or undefined
- `allAdws` list appends N `'adw_patch_iso'` entries when `reviewRetries` is N
- Phase does not throw on agent failure (non-fatal)
- Phase logs error and writes failure state without propagating the error
- No `pushBranch` or `runCommitAgent` calls in the KPI phase

## Notes

- **No git operations in KPI phase**: unlike the document phase, `executeKpiPhase` never commits or pushes. The updated `app_docs/agentic_kpis.md` lives in the ADW repo and is committed separately (e.g. via `/commit_cost` or a manual commit).
- **GitLab provider removed**: this branch also removes the GitLab code host provider (`adws/providers/gitlab/`) as unrelated cleanup from the prior merged PR.
- **Streak calculation**: "Current Streak" counts consecutive rows from the bottom of the ADW KPIs table where Attempts ≤ 2; the JavaScript expression replaces the former Python equivalent.
