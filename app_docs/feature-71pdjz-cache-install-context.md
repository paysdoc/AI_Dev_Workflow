# Cache Install Context

**ADW ID:** 71pdjz-cache-install-contex
**Date:** 2026-03-21
**Specification:** specs/issue-253-adw-71pdjz-cache-install-contex-sdlc_planner-cache-install-context.md

## Overview

Introduces an install phase that runs the `/install` agent once at the start of every orchestrator, extracts the file contents it reads from JSONL output, and injects the cached context into subsequent agent prompts. Previously, `/install` (which chains `/prime`) was embedded in 6 slash commands and executed independently up to 3 times per SDLC run — each time re-discovering the same project structure, wasting tokens and latency.

## What Was Built

- `installAgent.ts` — Agent wrapper that spawns a Claude CLI process running `/install` with issue context and `cwd = worktreePath`
- `installPhase.ts` — Phase that runs the install agent, parses its JSONL `stream-json` output to extract file contents, writes `agents/{adwId}/install_cache.md`, and sets `config.installContext`
- `extractInstallContext()` — Pure function that correlates `tool_use` blocks with their `tool_result` responses to reconstruct file contents from JSONL
- Context preamble injection via new `contextPreamble?: string` parameter on `runClaudeAgentWithCommand()`
- `/install` entries added to all 4 model/effort maps in `config.ts`
- `installContext?: string` field added to `WorkflowConfig` and `PRReviewWorkflowConfig`
- `'install_running' | 'install_completed' | 'install_failed'` stages added to `WorkflowStage` type
- Install phase wired into all 8 orchestrators between initialization and the first task phase
- `/install` references stripped from 6 slash commands (`/feature`, `/bug`, `/chore`, `/scenario_writer`, `/pr_review`, `/generate_step_definitions`)

## Technical Implementation

### Files Modified

- `adws/agents/claudeAgent.ts`: Added `contextPreamble?: string` as last parameter; when provided, prepends it to the prompt before the slash command
- `adws/phases/workflowInit.ts`: Added `installContext?: string` to `WorkflowConfig` interface
- `adws/phases/prReviewPhase.ts`: Added `installContext?: string` to `PRReviewWorkflowConfig` interface
- `adws/core/config.ts`: Added `/install` to `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`
- `adws/types/workflowTypes.ts`: Extended `WorkflowStage` union with install stages
- `adws/agents/planAgent.ts`: Added `contextPreamble?` to `runPlanAgent()` and `runPrReviewPlanAgent()`
- `adws/agents/scenarioAgent.ts`: Added `contextPreamble?` to `runScenarioAgent()`
- `adws/agents/stepDefAgent.ts`: Added `contextPreamble?` to `runStepDefAgent()`
- `adws/phases/planPhase.ts`, `scenarioPhase.ts`, `stepDefPhase.ts`, `prReviewPhase.ts`: Pass `config.installContext` as `contextPreamble`
- `adws/adwSdlc.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildDocument.tsx`, `adwPlan.tsx`, `adwPrReview.tsx`: Added install phase between initialization and first task phase
- `adws/agents/index.ts`, `adws/phases/index.ts`, `adws/workflowPhases.ts`, `adws/index.ts`: Export barrels updated

### New Files

- `adws/agents/installAgent.ts`: Agent wrapper for `/install` command
- `adws/phases/installPhase.ts`: Phase orchestrator and JSONL parser

### Key Changes

- **JSONL correlation**: `extractInstallContext()` builds a `Map<toolUseId, {name, input}>` from assistant messages, then matches `tool_result` entries by `tool_use_id` to reconstruct file contents. Read results become `## File: {path}` sections; Bash results become `## Command: {cmd}` sections.
- **Non-fatal design**: The install phase follows the `stepDefPhase.ts` pattern — all errors are caught and logged as warnings. If it fails, downstream agents receive no `contextPreamble` and function normally (without the optimization).
- **Cache file**: Extracted context is written to `agents/{adwId}/install_cache.md` and stored on `config.installContext`. On recovery, the install agent always re-runs (no skip based on existing cache).
- **Context injection format**: The preamble wraps extracted content in `<project-context>` tags with a directive telling agents not to re-read files or run `/install`.
- **PR review orchestrator**: `adwPrReview.tsx` uses `PRReviewWorkflowConfig` so it calls `runInstallAgent` directly rather than `executeInstallPhase`, then manually sets `config.installContext`.

## How to Use

The install phase runs automatically at the start of every orchestrator. No manual steps are required.

To inspect what was cached for a given run:
1. Find the ADW ID for the run (logged as `ADW ID: {id}` in output)
2. Read `agents/{adwId}/install_cache.md`

To verify context injection is working:
1. Look for the log line `Install context cached ({N} chars)` after the install phase
2. Subsequent agents will log `Context preamble: {N} chars` when the preamble is prepended

## Configuration

`/install` is registered in `adws/core/config.ts` with:
- Model: `sonnet` (both normal and fast mode)
- Effort: `medium` (normal mode), `low` (fast mode)

## Testing

BDD scenarios covering this feature are in `features/cache_install_context.feature` with step definitions in `features/step_definitions/cacheInstallContextSteps.ts`.

Run scenarios:
```
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags @cache-install-context
```

Dry-run to verify step definitions parse:
```
NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run
```

## Notes

- If the install agent runs but reads no files (empty JSONL or all tool results are errors), `config.installContext` remains unset and the preamble is silently skipped — agents fall back to discovering context themselves.
- The slash commands (`/feature`, `/bug`, etc.) no longer contain "Read and execute install.md" — agents rely entirely on the injected `contextPreamble`. If the install phase was skipped, agents will operate without pre-loaded context.
- Very large install outputs (many files read) result in a large context preamble. No truncation is applied; Claude CLI handles context window limits.
