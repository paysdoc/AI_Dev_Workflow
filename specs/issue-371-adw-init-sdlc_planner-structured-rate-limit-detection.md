# Feature: Structured JSONL rate limit detection and runPhasesParallel pause fix

## Metadata
issueNumber: `371`
adwId: `init`
issueJson: `{"number":371,"title":"Fix false-positive rate limit detection and runPhasesParallel pause bypass"}`

## Feature Description
Replace the brittle `text.includes()` string matching in `agentProcessHandler.ts` with structured JSON parsing of JSONL messages emitted by Claude Code CLI. This eliminates false-positive rate limit detection that occurs when agents read ADW source code containing the detection strings. Additionally, fix `runPhasesParallel()` so that `RateLimitError` triggers the pause queue instead of a hard workflow failure.

## User Story
As an ADW operator running the cron trigger on the ADW repo itself
I want rate limit detection to use structured JSONL message types instead of raw string matching
So that agents reading ADW source code do not falsely trigger rate limit kills

## Problem Statement
1. `agentProcessHandler.ts` uses `text.includes()` on raw stdout chunks to detect rate limits, auth errors, and context compaction. When an agent reads ADW source files containing these literal strings (e.g., `"overloaded_error"` in `agentProcessHandler.ts`), the detection fires on tool result content — a false positive that kills the agent and fails the workflow.
2. `runPhasesParallel()` in `phaseRunner.ts` bypasses the `RateLimitError` catch in `runPhase()`, causing `RateLimitError` to propagate to `handleWorkflowError()` (exit 1) instead of `handleRateLimitPause()` (exit 0 + pause queue).
3. `parseJsonlOutput()` has no cross-chunk line buffering — JSONL lines split across `data` events silently fail to parse.

## Solution Statement
1. Extend `parseJsonlOutput()` in `claudeStreamParser.ts` to handle `rate_limit_event` and `system` JSONL message types, setting detection flags on `JsonlParserState`.
2. Add a `lineBuffer` field to `JsonlParserState` for cross-chunk line buffering.
3. Replace all three `text.includes()` blocks in `agentProcessHandler.ts` with checks against the parser state flags after `parseJsonlOutput()` returns.
4. Add `RateLimitError` catch to `runPhasesParallel()` in `phaseRunner.ts`.

Detection rules (structured JSONL):

| Signal | JSONL type | Trigger condition |
|--------|-----------|-------------------|
| Rate limit | `type: "rate_limit_event"` | `rate_limit_info.status === "rejected"` |
| Auth error | `type: "system"`, `subtype: "api_retry"` | `error === "authentication_error"` (any attempt) |
| Server error | `type: "system"`, `subtype: "api_retry"` | `error !== "authentication_error"` AND `attempt >= 2` |
| Compaction | `type: "system"`, `subtype: "compact_boundary"` | Any occurrence |

## Relevant Files
Use these files to implement the feature:

- `adws/core/claudeStreamParser.ts` — Main parser. Add detection flags to `JsonlParserState`, handle `rate_limit_event` and `system` types, add line buffering.
- `adws/agents/agentProcessHandler.ts` — Replace `text.includes()` blocks (lines 86-119) with state flag checks after `parseJsonlOutput()`.
- `adws/core/phaseRunner.ts` — Add `RateLimitError` catch to `runPhasesParallel()` (lines 165-181).
- `adws/types/agentTypes.ts` — Reference for `RateLimitError` class and `AgentResult` interface (read-only, no changes needed).
- `adws/phases/workflowCompletion.ts` — Reference for `handleRateLimitPause()` signature (read-only, no changes needed).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

### New Files
- `adws/core/__tests__/claudeStreamParser.test.ts` — Unit tests for the new detection logic and line buffering in `parseJsonlOutput()`.

## Implementation Plan
### Phase 1: Foundation — Cross-chunk line buffering and parser state flags
Add `lineBuffer` and detection flag fields to `JsonlParserState`. Refactor `parseJsonlOutput()` to buffer partial lines across calls, so every complete JSONL line is parsed exactly once.

### Phase 2: Core Implementation — Structured JSONL detection
Add handling for `rate_limit_event` and `system` message types inside `parseJsonlOutput()`. Set the appropriate detection flags when trigger conditions are met. Replace the three `text.includes()` blocks in `agentProcessHandler.ts` with post-parse flag checks.

### Phase 3: Integration — runPhasesParallel fix
Add `RateLimitError` catch to `runPhasesParallel()` matching the pattern in `runPhase()`.

## Step by Step Tasks

### Step 1: Add detection flags and line buffer to `JsonlParserState`
- In `adws/core/claudeStreamParser.ts`, add the following fields to `JsonlParserState`:
  - `lineBuffer: string` — accumulates partial JSONL lines across `data` chunks (initialize to `''`)
  - `rateLimitRejected: boolean` — set when `rate_limit_event` with `status === "rejected"` is parsed
  - `authErrorDetected: boolean` — set when `system` `api_retry` with `error === "authentication_error"` is parsed
  - `serverErrorDetected: boolean` — set when `system` `api_retry` with `error !== "authentication_error"` and `attempt >= 2` is parsed
  - `compactionDetected: boolean` — set when `system` `compact_boundary` is parsed

### Step 2: Implement cross-chunk line buffering in `parseJsonlOutput()`
- Refactor `parseJsonlOutput()` to prepend `state.lineBuffer` to the incoming `text` before splitting on `\n`
- After splitting, treat the last segment as a potential partial line: if the incoming `text` does not end with `\n`, store the last segment in `state.lineBuffer` instead of parsing it
- Only parse complete lines (those terminated by `\n`)
- This replaces the current `text.split('\n').filter(line => line.trim())` approach

### Step 3: Add structured JSONL message detection to `parseJsonlOutput()`
- After `JSON.parse(line)` succeeds, add detection for:
  - `parsed.type === 'rate_limit_event'`: check `parsed.rate_limit_info?.status === 'rejected'` → set `state.rateLimitRejected = true`
  - `parsed.type === 'system' && parsed.subtype === 'api_retry'`: check `parsed.error === 'authentication_error'` → set `state.authErrorDetected = true`. Otherwise check `parsed.attempt >= 2` → set `state.serverErrorDetected = true`
  - `parsed.type === 'system' && parsed.subtype === 'compact_boundary'` → set `state.compactionDetected = true`

### Step 4: Replace `text.includes()` blocks in `agentProcessHandler.ts`
- Remove the three `text.includes()` detection blocks (auth error lines 86-95, rate limit lines 97-110, compaction lines 112-119)
- After the `parseJsonlOutput(text, state, wrappedOnProgress, statePath)` call, add flag checks:
  - `if (!rateLimitDetected && (state.rateLimitRejected || state.serverErrorDetected))` → set `rateLimitDetected = true`, log, kill
  - `if (!authErrorDetected && state.authErrorDetected)` → set `authErrorDetected = true`, log, kill
  - `if (!compactionDetected && state.compactionDetected)` → set `compactionDetected = true`, log, kill
- The local boolean variables (`rateLimitDetected`, `authErrorDetected`, `compactionDetected`) remain as guards to prevent duplicate kills — they gate the kill action while the state flags gate the detection

### Step 5: Add `RateLimitError` catch to `runPhasesParallel()`
- In `adws/core/phaseRunner.ts`, wrap the `Promise.all()` call in `runPhasesParallel()` with a try/catch
- In the catch block, check `if (err instanceof RateLimitError)` and call `handleRateLimitPause()` (lazy import, same pattern as `runPhase()`)
- Re-throw the error after handling (same pattern as `runPhase()`)

### Step 6: Write unit tests for `parseJsonlOutput()` detection and buffering
- Create `adws/core/__tests__/claudeStreamParser.test.ts`
- Test cases for detection:
  - `rate_limit_event` with `status: "rejected"` sets `rateLimitRejected`
  - `rate_limit_event` with `status: "allowed"` or `"allowed_warning"` does NOT set `rateLimitRejected`
  - `system` `api_retry` with `error: "authentication_error"` sets `authErrorDetected`
  - `system` `api_retry` with `error: "unknown"` and `attempt: 1` does NOT set `serverErrorDetected`
  - `system` `api_retry` with `error: "unknown"` and `attempt: 2` sets `serverErrorDetected`
  - `system` `compact_boundary` sets `compactionDetected`
  - Tool result content containing detection strings (e.g., `overloaded_error`, `compact_boundary`) does NOT set any flags (the false-positive scenario)
- Test cases for line buffering:
  - Complete JSONL line in a single chunk is parsed
  - JSONL line split across two chunks is parsed correctly after the second chunk
  - Multiple complete lines in a single chunk are all parsed
  - Trailing partial line is buffered and completed by subsequent chunk

### Step 7: Run validation commands
- Run `bun run lint` to check for linting issues
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` for type checking
- Run `bun run test` to run unit tests
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to run regression scenarios

## Testing Strategy
### Unit Tests
- `adws/core/__tests__/claudeStreamParser.test.ts`:
  - Detection flag tests: verify each JSONL message type correctly sets (or does not set) the corresponding flag
  - False-positive test: feed tool result content containing literal detection strings, verify no flags are set
  - Line buffering tests: verify partial lines are buffered and assembled correctly across calls
  - Existing behavior tests: verify `assistant` and `result` message parsing still works correctly with the buffering refactor

### Edge Cases
- JSONL line split across 3+ chunks (multi-split)
- Empty chunks between partial lines
- Chunk containing exactly one `\n` with no content
- Multiple detection events in a single chunk (e.g., `rate_limit_event` and `system` on consecutive lines)
- `rate_limit_event` with `overageStatus: "rejected"` but `status: "allowed"` — should NOT trigger (overage rejection alone is not a rate limit)
- `api_retry` with `attempt: 2` followed by `attempt: 1` (new retry sequence) — `serverErrorDetected` remains true once set

## Acceptance Criteria
- Agents reading ADW source code containing `overloaded_error`, `502 Bad Gateway`, `You've hit your limit`, etc. do NOT trigger false rate limit kills
- `rate_limit_event` with `status: "rejected"` correctly triggers process kill and pause queue
- `system` `api_retry` with `authentication_error` correctly triggers process kill
- `system` `api_retry` with non-auth errors at `attempt >= 2` correctly triggers process kill and pause queue
- `system` `compact_boundary` correctly triggers process kill for context restart
- `runPhasesParallel()` correctly routes `RateLimitError` through `handleRateLimitPause()` instead of `handleWorkflowError()`
- JSONL lines split across stdout chunks are correctly reassembled and parsed
- All existing unit tests pass
- All `@regression` BDD scenarios pass
- No linting or type errors

## Validation Commands

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check ADW module
- `bun run test` — Run unit tests (including new `claudeStreamParser.test.ts`)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression BDD scenarios

## Notes
- `pauseQueueScanner.ts` probe is intentionally left unchanged — it uses `claude --print` which is a different code path and may not emit `rate_limit_event`.
- The `rate_limit_event` schema is not officially documented by Anthropic. The field values are derived from production log analysis: `status` can be `"allowed"`, `"allowed_warning"`, or `"rejected"`; `overageStatus` can be `"allowed"` or `"rejected"`; `rateLimitType` observed only as `"five_hour"`.
- The `text.includes()` approach matched some strings (`"502 Bad Gateway"`, `"You've hit your limit"`) that represent billing/usage cap messages rather than API rate limits. These are now subsumed by `rate_limit_event` (CLI emits `status: "rejected"` for billing caps) and `api_retry` (for server errors). If a billing cap message does not produce either signal, Claude CLI handles it internally.
