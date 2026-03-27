# Chore Auto-Approve and Merge with LLM Diff Gate

**ADW ID:** wc1uva-auto-approve-and-mer
**Date:** 2026-03-27
**Specification:** specs/issue-327-adw-wc1uva-auto-approve-and-mer-sdlc_planner-chore-auto-approve-llm-gate.md

## Overview

Chore PRs (config-only, docs-only, dependency bumps, CI/CD changes) now auto-approve and auto-merge without human review. A dedicated orchestrator (`adwChore.tsx`) runs a post-build LLM diff gate using Haiku to classify the diff as `safe` (auto-merge immediately) or `regression_possible` (escalate through review → document → auto-merge). The verdict is posted as an audit comment on the GitHub issue.

## What Was Built

- **`adwChore.tsx`** — Dedicated chore orchestrator with branching pipeline (safe path vs. escalation path)
- **`diffEvaluatorAgent.ts`** — LLM-based diff evaluation agent using Haiku with binary classification
- **`diffEvaluationPhase.ts`** — Phase that runs the agent, posts the verdict comment, and returns the verdict
- **`.claude/commands/diff_evaluator.md`** — Slash command prompt with classification rules and JSON output spec
- **Routing update** — `/chore` issues now route to `adwChore.tsx` instead of `adwPlanBuild.tsx`
- **Type system update** — `/diff_evaluator` added to `SlashCommand` union, `Chore` added to `OrchestratorId`
- **Model routing** — `/diff_evaluator` mapped to Haiku tier with `low` reasoning effort (both normal and fast maps)

## Technical Implementation

### Files Modified

- `adws/types/issueRouting.ts`: Changed `/chore` routing from `adws/adwPlanBuild.tsx` to `adws/adwChore.tsx`
- `adws/types/issueTypes.ts`: Added `/diff_evaluator` to `SlashCommand` union type
- `adws/core/constants.ts`: Added `Chore: 'chore-orchestrator'` to `OrchestratorId`
- `adws/core/modelRouting.ts`: Added `/diff_evaluator` (Haiku, `low` effort) to all four routing maps; also added `/implement-tdd` and `/align_plan_scenarios` entries
- `adws/agents/index.ts`: Registered `runDiffEvaluatorAgent` export
- `adws/phases/index.ts`: Registered `executeDiffEvaluationPhase` and `DiffEvaluationPhaseResult` exports
- `adws/workflowPhases.ts`: Added `executeDiffEvaluationPhase` to re-export barrel
- `adws/README.md`: Added `adwChore.tsx` orchestrator documentation and updated workflow selection table
- `README.md`: Added new files to project structure section

### Key Changes

- The chore pipeline is: `install → plan → build → test → PR → diff evaluation → (safe: auto-merge) | (regression_possible: escalation comment → review → document → auto-merge)`
- The diff evaluator uses `runCommandAgent<DiffEvaluatorVerdict>()` — the generic agent runner — so it participates in cost tracking and log capture automatically
- Fail-safe by design: any agent failure, unparseable output, or invalid verdict value defaults to `regression_possible` to prevent unsafe auto-merges
- Empty diff (no changes) is short-circuited to `safe` without invoking the LLM
- Verdict and reason are posted as a formatted comment on the GitHub issue for audit trail

## How to Use

The chore pipeline is invoked automatically when ADW processes a `/chore` issue. No manual invocation is needed in normal operation.

To run manually:

```bash
bunx tsx adws/adwChore.tsx <issueNumber> [adw-id] [--issue-type /chore]
```

The orchestrator will:
1. Install dependencies and plan the chore
2. Build and run unit tests
3. Create a pull request
4. Run the LLM diff gate and post the verdict as an issue comment
5. Either auto-merge (safe) or escalate through review + document + auto-merge (regression possible)

## Configuration

No additional configuration required. The diff evaluator uses the existing `ANTHROPIC_API_KEY` and `CLAUDE_CODE_PATH` environment variables.

Model routing is pre-configured:
- Normal mode: Haiku, `low` effort
- Fast mode: Haiku, `low` effort

## Testing

- Trigger a `/chore` issue in ADW and verify it routes to `adwChore.tsx` (not `adwPlanBuild.tsx`)
- Confirm the diff verdict comment appears on the GitHub issue
- For a docs-only or CI/CD-only chore: verify `safe` verdict and direct auto-merge
- For a chore where the build agent touched source files: verify `regression_possible` verdict and escalation through review → document → auto-merge
- Force an agent failure (invalid `ANTHROPIC_API_KEY`) to verify the fail-safe defaults to `regression_possible`

## Notes

- `adwPlanBuild.tsx` is unchanged — `/pr_review` issues continue to route through it and are never auto-merged
- The chore path has no scenario writer, plan-scenario alignment, or KPI tracking (out of scope per spec)
- The escalation path reuses existing `executeReviewPhase`, `executeDocumentPhase`, and `executeAutoMergePhase` without modification
- `/ubiquitous-language` model tier change mentioned in the issue is a no-op: it is a Claude Code skill, not a slash command in the routing maps
