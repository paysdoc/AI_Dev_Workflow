# Single-Pass Alignment Phase

**ADW ID:** irs6vj-single-pass-alignmen
**Date:** 2026-03-25
**Specification:** specs/issue-305-adw-a1vf0g-single-pass-alignmen-sdlc_planner-single-pass-alignment-phase.md

## Overview

Replaces the multi-round plan validation loop (`validate → resolve → re-validate`, up to `MAX_VALIDATION_RETRY_ATTEMPTS`) with a single-pass alignment step. A new `/align_plan_scenarios` command and `executeAlignmentPhase` function read both the implementation plan and tagged BDD `.feature` files, resolve conflicts using the GitHub issue as sole source of truth, and flag unresolvable conflicts as inline `<!-- ADW-WARNING: -->` comments rather than halting the workflow. This reduces token usage, eliminates multi-agent coordination overhead, and removes the risk of exhausting retry attempts.

## What Was Built

- `/align_plan_scenarios` slash command at `.claude/commands/align_plan_scenarios.md`
- `executeAlignmentPhase` function in `adws/phases/alignmentPhase.ts`
- `runAlignmentAgent` / `parseAlignmentResult` / `AlignmentResult` in `adws/agents/alignmentAgent.ts`
- `plan_aligning` and `plan_aligned` workflow stages wired into comment parsing and formatting
- `alignment-agent` added as a recognized `AgentIdentifier`
- `/align_plan_scenarios` registered in all four model/effort routing maps
- All three orchestrators (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`) updated to call alignment phase instead of validation loop

## Technical Implementation

### Files Modified

- `adws/phases/alignmentPhase.ts` — **New**: single-pass alignment phase; recovery guard, graceful skips for missing plan/scenarios, single `runAlignmentAgent` call, artifact commit on changes
- `adws/agents/alignmentAgent.ts` — **New**: thin wrapper around `/align_plan_scenarios`; `parseAlignmentResult` with safe fallback on non-JSON output; re-exports `findScenarioFiles`
- `.claude/commands/align_plan_scenarios.md` — **New**: slash command prompt (`target: false`); 5 positional args; outputs raw JSON `{aligned, warnings, changes, summary}`
- `adws/types/workflowTypes.ts` — Added `plan_aligning`, `plan_aligned` to `WorkflowStage` union
- `adws/types/agentTypes.ts` — Added `alignment-agent` to `AgentIdentifier` union
- `adws/types/issueTypes.ts` — Added `/align_plan_scenarios` to `SlashCommand` union
- `adws/core/modelRouting.ts` — Added `/align_plan_scenarios`: `opus` (default), `sonnet` (fast), effort `high`/`medium`
- `adws/core/workflowCommentParsing.ts` — Added `plan_aligning` to `STAGE_ORDER` and `STAGE_HEADER_MAP`
- `adws/github/workflowCommentsIssue.ts` — Added `formatPlanAligningComment`, `formatPlanAlignedComment`, wired into `formatWorkflowComment` switch
- `adws/phases/index.ts` — Exports `executeAlignmentPhase`
- `adws/agents/index.ts` — Exports `runAlignmentAgent`, `parseAlignmentResult`, `AlignmentResult`
- `adws/workflowPhases.ts` — Re-exports `executeAlignmentPhase`
- `adws/adwSdlc.tsx` — Uses `executeAlignmentPhase` after parallel plan+scenario, before build
- `adws/adwPlanBuildReview.tsx` — Same alignment phase integration
- `adws/adwPlanBuildTestReview.tsx` — Same alignment phase integration

### Key Changes

- **No retry loop**: `executeAlignmentPhase` calls `runAlignmentAgent` exactly once — no `for` loop, no `MAX_*_ATTEMPTS` constant
- **Never throws**: unresolvable conflicts become `<!-- ADW-WARNING: -->` inline comments in the plan; `parseAlignmentResult` falls back gracefully on non-JSON output
- **Recovery support**: `shouldExecuteStage('plan_aligning', recoveryState)` skips the phase on workflow resume if already completed
- **Graceful skips**: phase returns empty cost records if the plan file is missing or no `@adw-{issueNumber}`-tagged `.feature` files are found
- **Artifact commit**: if the alignment agent reports changes, `runCommitAgent` is called to commit updated plan/scenario files

## How to Use

The alignment phase runs automatically in the workflow — no manual invocation needed. It is positioned after the parallel plan + scenario phase and before the build phase.

To invoke the slash command directly (e.g., in a custom workflow):

1. Ensure plan and `.feature` files exist in the worktree
2. Run `/align_plan_scenarios <adwId> <issueNumber> <planFilePath> <scenarioDir> <issueJson>`
3. The command outputs raw JSON: `{"aligned": true|false, "warnings": [...], "changes": [...], "summary": "..."}`

## Configuration

Model routing (in `adws/core/modelRouting.ts`):

| Map | Value |
|-----|-------|
| `SLASH_COMMAND_MODEL_MAP` | `opus` |
| `SLASH_COMMAND_MODEL_MAP_FAST` | `sonnet` |
| `SLASH_COMMAND_EFFORT_MAP` | `high` |
| `SLASH_COMMAND_EFFORT_MAP_FAST` | `medium` |

No additional environment variables required beyond the standard ADW setup.

## Testing

Run the BDD regression suite to verify no regressions:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

The feature is covered by `features/single_pass_alignment_phase.feature` with step definitions in `features/step_definitions/singlePassAlignmentPhaseSteps.ts`.

## Notes

- The old `executePlanValidationPhase` and its agents (`validationAgent`, `resolutionAgent`) are retained for backward compatibility but are no longer called by any orchestrator. They can be removed in a future cleanup.
- `findScenarioFiles` is re-exported from `alignmentAgent.ts` so phases do not need to import from `validationAgent` directly.
- The slash command must produce raw JSON as its final message (no markdown, no code fences) to enable reliable programmatic parsing by `parseAlignmentResult`.
