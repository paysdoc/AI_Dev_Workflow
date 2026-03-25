# Detect Context Compaction and Restart Build Agent

**ADW ID:** `9zcqhw-detect-context-compa`
**Date:** 2026-03-25
**Specification:** `specs/issue-298-adw-9zcqhw-detect-context-compa-sdlc_planner-detect-compaction-restart.md`

## Overview

When the build agent runs long enough for Claude Code to hit its context window limit, Claude Code automatically compacts the conversation — a lossy operation that degrades agent output quality. This feature detects the `compact_boundary` event in the JSONL stream, terminates the agent, and restarts it using the existing token-limit continuation mechanism, giving the new agent fresh context with the original plan and partial output.

## What Was Built

- **Compaction detection** in `agentProcessHandler.ts` — detects `"subtype":"compact_boundary"` in the stdout JSONL stream, sets a flag, and kills the process with SIGTERM
- **`compactionDetected` field** on `AgentResult` — signals the build phase that restart is needed
- **`compaction_recovery` workflow stage** — a new `WorkflowStage` type and `STAGE_HEADER_MAP` entry distinct from `token_limit_recovery`
- **Build phase continuation handler** — handles `compactionDetected` in the `buildPhase.ts` while loop, identically to `tokenLimitExceeded`, using the shared `MAX_TOKEN_CONTINUATIONS` limit
- **`formatCompactionRecoveryComment()`** — posts a distinct GitHub issue comment so observers can distinguish compaction restarts from token-limit restarts
- **`buildContinuationPrompt()` refactor** — accepts a `reason` parameter (`'token_limit' | 'compaction'`) so the continuation context message accurately reflects why the previous agent was terminated

## Technical Implementation

### Files Modified

- `adws/agents/agentProcessHandler.ts`: Added `compactionDetected` flag, detection block for `"subtype":"compact_boundary"`, and close-handler resolution block returning `compactionDetected: true`
- `adws/types/agentTypes.ts`: Added `compactionDetected?: boolean` field to `AgentResult` interface
- `adws/types/workflowTypes.ts`: Added `'compaction_recovery'` to the `WorkflowStage` type union
- `adws/core/workflowCommentParsing.ts`: Added `':warning: Context Compaction Recovery': 'compaction_recovery'` to `STAGE_HEADER_MAP`
- `adws/github/workflowCommentsIssue.ts`: Added `formatCompactionRecoveryComment()` and wired it into the `formatWorkflowComment()` switch
- `adws/phases/buildPhase.ts`: Added `compactionDetected` handling block after the `tokenLimitExceeded` block; updated `buildContinuationPrompt` calls to pass an explicit reason
- `adws/phases/planPhase.ts`: Refactored `buildContinuationPrompt()` to accept `reason: 'token_limit' | 'compaction'` with default `'token_limit'`

### Key Changes

- Compaction detection is placed **before** the token-limit check in the stdout handler, ensuring it fires on the correct event type without interfering with existing logic
- The close handler handles `compactionDetected` **between** `tokenLimitReached` and the normal `code === 0` path — if both flags are somehow set, `tokenLimitReached` takes precedence
- The shared `MAX_TOKEN_CONTINUATIONS` counter applies to **both** token-limit and compaction continuations combined, preventing infinite restart loops
- `buildContinuationPrompt()` produces a distinct continuation context message for compaction restarts: _"terminated because Claude Code compacted the conversation context, which is lossy"_
- The `compaction_recovery` issue comment is structurally identical to `token_limit_recovery` but uses different header text, so workflow comment parsing correctly identifies resume state

## How to Use

This feature is fully automatic — no configuration is required.

1. Run the ADW build workflow normally.
2. If the build agent's context is compacted by Claude Code, the agent is automatically terminated.
3. A `compaction_recovery` comment is posted to the GitHub issue indicating the continuation number.
4. A fresh build agent is spawned with the original plan and a summary of the previous agent's partial output.
5. The new agent reads the working tree and continues from where the previous agent left off.
6. This process repeats up to `MAX_TOKEN_CONTINUATIONS` times (shared with token-limit continuations).

## Configuration

No new configuration required. The feature reuses the existing `MAX_TOKEN_CONTINUATIONS` constant from `adws/phases/buildPhase.ts`.

## Testing

The feature includes a new BDD scenario file:

- `features/detect_compaction_restart_build_agent.feature` — Cucumber scenarios covering compaction detection, agent restart, comment posting, and the shared continuation counter limit

Run with:
```
bun run test
```

Or target the specific tag:
```
bunx cucumber-js --tags @adw-9zcqhw-detect-context-compa
```

## Notes

- **Scope**: Build agent only. Other agents (plan, review, etc.) do not handle `compactionDetected` — compaction has only been observed to be problematic for the long-running build agent.
- **Partial JSONL lines**: The `compact_boundary` string may be split across two `data` events in rare cases. This matches the existing pattern for auth error detection (`"subtype":"api_retry"`) which uses the same `text.includes()` approach and has been reliable in practice.
- **Multiple compactions**: Each continuation agent may also trigger compaction. The shared `MAX_TOKEN_CONTINUATIONS` limit prevents infinite restarts.
