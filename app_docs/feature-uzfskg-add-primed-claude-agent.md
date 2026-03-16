# Add Primed Claude Agent

**ADW ID:** uzfskg-add-runprimedclaudea
**Date:** 2026-03-16
**Specification:** specs/issue-189-adw-uzfskg-add-runprimedclaudea-sdlc_planner-add-primed-claude-agent.md

## Overview

Introduces `runPrimedClaudeAgentWithCommand`, a thin wrapper around `runClaudeAgentWithCommand` that prepends `/install` (which calls `/prime`) to the agent prompt before executing a slash command — all within the same CLI invocation so both steps share the same context window. The plan agent and scenario agent now call this primed variant, eliminating redundant codebase exploration that each previously performed independently.

## What Was Built

- `runPrimedClaudeAgentWithCommand` function in `adws/agents/claudeAgent.ts`
- Updated `runPlanAgent` and `runPrReviewPlanAgent` in `planAgent.ts` to use the primed variant
- Updated `runScenarioAgent` in `scenarioAgent.ts` to use the primed variant
- Barrel export of `runPrimedClaudeAgentWithCommand` from `adws/agents/index.ts`
- Unit tests in `adws/agents/__tests__/claudeAgent.test.ts` covering prompt composition

## Technical Implementation

### Files Modified

- `adws/agents/claudeAgent.ts`: Added `runPrimedClaudeAgentWithCommand` (lines 136–171)
- `adws/agents/planAgent.ts`: Switched import and call sites for `runPlanAgent` and `runPrReviewPlanAgent` to use `runPrimedClaudeAgentWithCommand`
- `adws/agents/scenarioAgent.ts`: Switched import and call site for `runScenarioAgent` to use `runPrimedClaudeAgentWithCommand`
- `adws/agents/index.ts`: Added `runPrimedClaudeAgentWithCommand` to the Claude Agent export block
- `adws/agents/__tests__/claudeAgent.test.ts`: New unit test file (98 lines)

### Key Changes

- **Prompt composition**: Builds a two-step prompt `/install\n\nOnce /install completes, run: <command> <quoted-args>` using the same `escapeArg` shell-quoting logic as the base function
- **Delegation**: The composed prompt is passed as the `args` parameter to `runClaudeAgentWithCommand` with an empty `command`, reusing all spawn, streaming, state tracking, and retry logic unchanged
- **Drop-in replacement**: Identical function signature to `runClaudeAgentWithCommand` — callers only change the function name
- **Scope**: Only plan and scenario agents use the primed variant; build, test, review, git, PR, document, patch, KPI, and resolution agents remain unchanged

## How to Use

The function is a drop-in replacement for `runClaudeAgentWithCommand` in agents that benefit from pre-indexed project context:

```typescript
import { runPrimedClaudeAgentWithCommand } from './claudeAgent';

const result = await runPrimedClaudeAgentWithCommand(
  '/feature',          // slash command to run after priming
  [issueNumber, title, body],  // args passed to the command
  'Plan',              // agent name for logging
  outputFile,          // JSONL output path
  model,               // e.g. 'sonnet'
  effort,              // optional: 'low' | 'medium' | 'high' | 'max'
  onProgress,          // optional progress callback
  statePath,           // optional state directory
  cwd                  // optional working directory
);
```

The resulting Claude CLI invocation receives the prompt:
```
/install

Once /install completes, run: /feature 'issueNumber' 'title' 'body'
```

## Configuration

No new configuration required. The function inherits all configuration from `runClaudeAgentWithCommand` (model, effort, state path, working directory).

Only add priming to agents that need full project context at the start of their run. Agents receiving focused context from prior workflow phases (build, test, review, etc.) should continue using `runClaudeAgentWithCommand` directly.

## Testing

```bash
bun run test
```

Unit tests in `adws/agents/__tests__/claudeAgent.test.ts` verify:
- Prompt starts with `/install` followed by a blank line and the actual command
- String args are properly shell-escaped and appended
- Array args are each quoted and joined with spaces
- All parameters (model, effort, statePath, cwd) are forwarded correctly

## Notes

- **Token tradeoff**: `/install` adds upfront token cost per agent invocation, offset by eliminating redundant codebase exploration each agent previously performed independently.
- **PR review plan agent** (`runPrReviewPlanAgent`) also uses the primed variant since it generates revision plans that benefit from project context.
- **Other agents**: Build, test, review, git, PR, document, patch, KPI, validation, and resolution agents do NOT use the primed variant — they receive focused context from prior phases.
