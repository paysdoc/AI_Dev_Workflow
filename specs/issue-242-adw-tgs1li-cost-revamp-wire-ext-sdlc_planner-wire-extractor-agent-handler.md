# Feature: Wire Extractor into Agent Process Handler with Real-Time Streaming

## Metadata
issueNumber: `242`
adwId: `tgs1li-cost-revamp-wire-ext`
issueJson: `{"number":242,"title":"Cost revamp: wire extractor into agent process handler with real-time streaming","body":"## Parent PRD\n\nSee `specs/prd-cost-module-revamp.md` on the `dev` branch.\n\n## What to build\n\nExtend the Anthropic extractor to provide real-time token tracking and wire it into the workflow's agent process handler.\n\n- Extend the Anthropic extractor to parse per-turn `message.usage` fields from `assistant` JSONL messages, with deduplication by `message.id` (multiple content blocks from the same API call share identical usage)\n- Estimate output tokens from content block character length (~4 chars/token) since per-turn `output_tokens` is unreliable (reflects message start, not completion)\n- Replace inline cost parsing in `agentProcessHandler.ts` with the new `TokenUsageExtractor` — feed stdout chunks to extractor, poll `getCurrentUsage()` for progress comments\n- Failed/crashed agent runs now contribute their accumulated cost (extractor has data even without a `result` message)\n- Progress comments show real-time estimated token counts (sum of input + cache + estimated output as \"~X tokens (estimated)\")\n- At phase completion, log estimate-vs-actual to console (absolute numbers and percentage)\n\nRefer to the parent PRD's \"Anthropic extractor specifics\" and \"Estimate-vs-actual reporting\" sections for full design rationale.\n\n## Acceptance criteria\n\n- [ ] Anthropic extractor parses `assistant` message `usage` fields with `message.id` deduplication\n- [ ] Output tokens estimated from content block character length during streaming\n- [ ] `agentProcessHandler.ts` uses `TokenUsageExtractor` instead of inline JSONL cost parsing\n- [ ] `getCurrentUsage()` returns accurate real-time token data (input + cache from per-turn usage, output from estimation)\n- [ ] When `result` message arrives, all values replaced with authoritative numbers from `modelUsage`\n- [ ] Failed agent runs (non-zero exit, missing result) still return accumulated cost via the extractor\n- [ ] Progress comments update with real-time token estimates (no longer stale)\n- [ ] Estimate-vs-actual difference (numbers + percentage) logged to console at phase completion\n- [ ] Unit tests cover: multi-turn streaming with deduplication, output token estimation accuracy, incomplete stream handling (no result message), finalization replacing estimates with actuals\n- [ ] All existing type checks still pass","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-19T10:37:27Z","comments":[],"actionableComment":null}`

## Feature Description
This feature extends the Anthropic token usage extractor (introduced in #241) from a result-only parser to a real-time streaming token tracker, then wires it into the agent process handler to replace inline JSONL cost parsing. During agent execution, per-turn `assistant` messages provide live input/cache token counts while output tokens are estimated from content block character length. When the `result` message arrives, estimates are replaced with authoritative numbers. Progress comments posted to GitHub issues now show live token estimates instead of stale values. Failed agent runs contribute their accumulated cost (the extractor always has data). At phase completion, the estimate-vs-actual difference is logged to console.

## User Story
As a workflow operator
I want real-time token estimates in progress comments and accurate cost tracking even for failed runs
So that I can monitor phase costs as they happen and never lose visibility into billed tokens

## Problem Statement
Currently, progress comments posted during long-running phases (e.g., build) show stale cost values because the JSONL parser only extracts costs from the final `result` message. The `AnthropicTokenUsageExtractor` from #241 also only parses `result` messages. Per-turn `assistant` messages contain `message.usage` fields with real-time token counts, but they are ignored. Additionally, failed agent runs (non-zero exit, missing `result`) lose all token data because cost is only extracted at finalization.

## Solution Statement
1. **Extend the extractor** to parse `assistant` JSONL messages: extract `message.usage` fields (input/cache tokens from per-turn data), deduplicate by `message.id`, and estimate output tokens from content block character length (~4 chars/token). When `result` arrives, replace all estimates with authoritative numbers.
2. **Wire into `agentProcessHandler.ts`**: create the extractor, feed every stdout chunk to it, and poll `getCurrentUsage()` for progress comments. On close, build `AgentResult` cost fields from extractor data regardless of exit code.
3. **Update progress comments**: show real-time estimated token counts as "~X tokens (estimated)" in the running token footer.
4. **Estimate-vs-actual logging**: at phase completion, log the delta between pre-finalization estimates and post-finalization actuals to console (absolute numbers and percentage).

## Relevant Files
Use these files to implement the feature:

### Core extractor (extend)
- `adws/cost/providers/anthropic/extractor.ts` — The `AnthropicTokenUsageExtractor` class to extend with per-turn `assistant` message parsing, `message.id` deduplication, and output token estimation
- `adws/cost/types.ts` — `TokenUsageExtractor` interface, `ModelUsageMap`, `TokenUsageMap` types; may need a method addition for estimated usage
- `adws/cost/index.ts` — Barrel exports for the cost module
- `adws/cost/providers/anthropic/index.ts` — Barrel exports for Anthropic provider
- `adws/cost/providers/anthropic/pricing.ts` — Pricing tables (read-only reference)
- `adws/cost/computation.ts` — `computeCost()` and `checkDivergence()` (read-only reference)

### Agent process handling (wire in)
- `adws/agents/agentProcessHandler.ts` — Main file to modify: replace `JsonlParserState` cost fields with `TokenUsageExtractor`, feed chunks to extractor, build `AgentResult` from extractor data
- `adws/agents/jsonlParser.ts` — Currently handles token extraction from `result` messages via `parseJsonlOutput`; cost extraction responsibility moves to extractor (keep text/tool/progress parsing)
- `adws/agents/claudeAgent.ts` — `AgentResult` interface and `runClaudeAgentWithCommand` function; may need `AgentResult` updated to carry extractor usage data

### Progress comments (update)
- `adws/phases/buildPhase.ts` — Uses progress callback and `runningTokenTotal`; update to poll extractor via returned cost data for real-time progress
- `adws/core/workflowCommentParsing.ts` — `formatRunningTokenFooter()` function; may need update for estimated vs actual display format
- `adws/github/workflowCommentsIssue.ts` — `WorkflowContext` type and `formatBuildProgressComment`; may need update for estimated token display

### Type definitions (reference)
- `adws/types/costTypes.ts` — Old `ModelUsageMap` type with fixed fields (used by existing code; coexists during migration)
- `adws/types/agentTypes.ts` — `TokenUsageSnapshot` type used in token limit handling
- `adws/core/tokenManager.ts` — `computeTotalTokens`, `computePrimaryModelTokens` (still used for token limit checks)
- `adws/core/costReport.ts` — `mergeModelUsageMaps`, `computeTotalCostUsd`, `buildCostBreakdown` (existing cost reporting)

### Conditional documentation (read for context)
- `app_docs/feature-ku956a-cost-revamp-core-com-cost-module-core-vitest.md` — Documentation from #241 explaining the cost module architecture
- `specs/prd-cost-module-revamp.md` — Parent PRD with full design rationale for the cost revamp
- `app_docs/feature-1773328453611-p5xexp-running-token-totals.md` — Running token totals feature documentation

### Guidelines
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

### Tests (extend)
- `adws/cost/__tests__/extractor.test.ts` — Existing extractor tests to extend with new streaming scenarios
- `vitest.config.ts` — Vitest configuration (already set up)

### New Files
- None — all changes extend existing files

## Implementation Plan
### Phase 1: Foundation — Extend the Anthropic Extractor
Extend `AnthropicTokenUsageExtractor` to parse per-turn `assistant` JSONL messages. The extractor currently only handles `result` messages. It needs to:

1. Parse `assistant` messages that contain `message.usage` fields with per-turn token counts (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`)
2. Deduplicate by `message.id` — multiple content blocks from the same API call share identical usage, so the same message ID should only contribute once
3. Accumulate input and cache tokens from per-turn `message.usage` (these are accurate)
4. Estimate output tokens from content block character length using ~4 chars/token ratio, since per-turn `output_tokens` reflects message start, not completion
5. Track estimated usage separately so that when the `result` message arrives, all values are replaced with authoritative numbers from `modelUsage`
6. Add a method to retrieve pre-finalization estimated usage for estimate-vs-actual comparison

The `TokenUsageExtractor` interface in `types.ts` may need an additional method like `getEstimatedUsage()` to expose the estimate snapshot before finalization replaces it.

### Phase 2: Core Implementation — Wire into Agent Process Handler
Replace the cost-related portions of `agentProcessHandler.ts`:

1. Create an `AnthropicTokenUsageExtractor` instance alongside the existing `JsonlParserState`
2. Feed every stdout chunk to `extractor.onChunk(text)` in addition to `parseJsonlOutput()`
3. On the `close` event, build cost-related `AgentResult` fields from the extractor:
   - `modelUsage`: convert extractor's `ModelUsageMap` (snake_case `Record<string, number>`) to the old `ModelUsageMap` format (fixed camelCase fields) for backward compatibility with existing code
   - `totalCostUsd`: use `extractor.getReportedCostUsd()` when finalized, otherwise compute from extractor usage + pricing
   - For failed runs (non-zero exit, no `result` message): extractor still has accumulated per-turn data, so cost fields are populated
4. The `jsonlParser.ts` `parseJsonlOutput` function continues handling text extraction, tool use progress, and turn counting — only cost extraction responsibility shifts to the extractor
5. Token limit checking continues using the existing `state.totalTokens` + `computePrimaryModelTokens` path from `parseJsonlOutput` (the extractor doesn't need to duplicate this)

### Phase 3: Integration — Progress Comments and Estimate-vs-Actual
Wire the real-time extractor data into the progress comment system:

1. **Progress comments**: In `buildPhase.ts` (and similar phases), the progress callback fires every 60 seconds. Currently it posts `build_progress` comments with turn/tool counts. Update to include real-time estimated token counts from the extractor. The approach: `agentProcessHandler.ts` exposes the extractor's `getCurrentUsage()` via a callback or by attaching it to the progress info, so phases can poll it.
2. **Estimated token display**: Format real-time estimates as "~X tokens (estimated)" in the running token footer. Once finalized, show actual numbers without the "estimated" qualifier.
3. **Estimate-vs-actual logging**: At phase completion (after the agent process closes), compare the last estimated usage snapshot against the finalized actual usage. Log the delta (absolute numbers and percentage) to console via `log()`. This helps operators calibrate trust in the real-time estimates over time.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extend `TokenUsageExtractor` interface with estimation method
- Read `adws/cost/types.ts`
- Add `getEstimatedUsage(): ModelUsageMap` method to the `TokenUsageExtractor` interface — returns the last pre-finalization estimated usage for estimate-vs-actual comparison
- This method captures the accumulated per-turn estimates before the `result` message replaces them with actuals

### Step 2: Extend `AnthropicTokenUsageExtractor` to parse `assistant` messages
- Read `adws/cost/providers/anthropic/extractor.ts`
- Add handling for `assistant` JSONL messages in `onChunk()`:
  - Parse messages where `type === 'assistant'` and `message.usage` exists
  - Extract `message.id` for deduplication — maintain a `Set<string>` of seen message IDs
  - From `message.usage`, accumulate: `input_tokens` → `input`, `cache_creation_input_tokens` → `cache_write`, `cache_read_input_tokens` → `cache_read`
  - Do NOT use `output_tokens` from `message.usage` (unreliable — reflects message start, not completion)
  - Estimate output tokens from content block character length: sum all `text` content block lengths, divide by 4 (chars/token ratio)
  - Accumulate into a separate `estimatedUsage: ModelUsageMap` that tracks per-turn running totals
  - When parsing, the model name is not present in per-turn messages — use a default model key or determine from the `system` init message
- When `result` message arrives (existing `handleResultMessage`):
  - Before replacing, snapshot the current estimated usage into `lastEstimatedUsage`
  - Then replace `modelUsage` with authoritative data from `result` as before
- Implement `getEstimatedUsage()` returning the `lastEstimatedUsage` snapshot (or current estimated usage if not yet finalized)
- The model identifier for per-turn accumulation: the extractor should accept an optional model hint in the constructor, or detect it from the `system` init message's `model` field, or from the first `assistant` message's `message.model` field

### Step 3: Wire extractor into `agentProcessHandler.ts`
- Read `adws/agents/agentProcessHandler.ts`
- Import `AnthropicTokenUsageExtractor` from `../../cost`
- In `handleAgentProcess()`:
  - Create an `AnthropicTokenUsageExtractor` instance
  - In the `stdout.on('data')` handler, call `extractor.onChunk(text)` alongside existing `parseJsonlOutput()`
  - On the `close` event, for all code paths (success, failure, token limit):
    - If extractor is finalized, use `extractor.getReportedCostUsd()` as `totalCostUsd`
    - If not finalized (failed/crashed run), compute cost from `extractor.getCurrentUsage()` using `computeCost()` and `getAnthropicPricing()`
    - Convert extractor's `ModelUsageMap` (snake_case `Record<string, number>`) to the old `ModelUsageMap` format (fixed camelCase fields) for backward compatibility with `AgentResult.modelUsage`
    - For failed runs: populate `totalCostUsd` and `modelUsage` from extractor data (these were previously undefined/missing)
  - Expose the extractor instance or a `getCurrentUsage` function on the returned promise/result so phases can poll during execution
- Add `extractor` or `getEstimatedTokens` to `AgentResult` or provide a side channel (e.g., pass extractor reference through the progress callback)

### Step 4: Update `AgentResult` to carry extractor-based cost data
- Read `adws/agents/claudeAgent.ts`
- Ensure `AgentResult` interface can represent cost from both finalized and non-finalized extractors:
  - `totalCostUsd` already exists — ensure it's populated for all exit paths
  - `modelUsage` already exists — ensure it's populated for all exit paths
  - Consider adding `estimatedUsage` and `actualUsage` fields for estimate-vs-actual tracking
  - Consider adding `costSource: 'extractor_finalized' | 'extractor_estimated'` to indicate whether cost came from the `result` message or from streaming estimates

### Step 5: Add real-time token estimates to progress comments
- Read `adws/phases/buildPhase.ts`
- The progress callback currently fires every 60 seconds and posts `build_progress` comments
- To get real-time token data into progress comments, one approach:
  - Pass the extractor's `getCurrentUsage()` method via the progress callback info (add a `tokenEstimate` field to `ProgressInfo`)
  - Or: have `agentProcessHandler.ts` include current extractor usage in every progress callback invocation
- In `buildPhase.ts`, when the progress callback fires:
  - Read the estimated token data from the callback info
  - Compute a running total including this phase's estimated tokens
  - Set `ctx.runningTokenTotal` with the estimated values
  - The `formatRunningTokenFooter` will then show the estimate in the comment
- Update the token footer to show "~X tokens (estimated)" during streaming and "X tokens" after finalization

### Step 6: Update `formatRunningTokenFooter` for estimated display
- Read `adws/core/workflowCommentParsing.ts`
- Add an `isEstimated` boolean parameter (or detect from context) to `formatRunningTokenFooter()`
- When `isEstimated` is true, format the token count with a `~` prefix and "(estimated)" suffix
- When false (finalized), show the actual count without qualifiers

### Step 7: Add estimate-vs-actual logging at phase completion
- Read `adws/phases/buildPhase.ts` (and similar phase files)
- After `runBuildAgent()` returns (agent process has closed):
  - If the `AgentResult` contains both `estimatedUsage` and `actualUsage` (finalized):
    - Compute the delta for each token type
    - Compute percentage difference
    - Log to console: `log("Estimate vs actual: input: 1000 estimated → 1050 actual (+5.0%), output: 500 estimated → 480 actual (-4.0%)", 'info')`
  - If not finalized (failed run), log a note that cost is from estimates only

### Step 8: Update Vitest tests for extended extractor
- Read `adws/cost/__tests__/extractor.test.ts`
- Add test cases:
  - **Multi-turn streaming with deduplication**: Feed multiple `assistant` messages with same `message.id` → verify usage is counted only once
  - **Per-turn accumulation**: Feed multiple `assistant` messages with different IDs → verify accumulated input/cache tokens sum correctly
  - **Output token estimation**: Feed `assistant` messages with text content blocks → verify output tokens estimated at ~4 chars/token
  - **Estimate replaced by actuals**: Feed `assistant` messages, then a `result` message → verify `getCurrentUsage()` reflects `result` data, and `getEstimatedUsage()` reflects pre-finalization estimates
  - **Incomplete stream (no result)**: Feed only `assistant` messages → verify `getCurrentUsage()` returns accumulated estimates, `isFinalized()` is false
  - **Mixed content blocks**: Feed messages with both text and tool_use blocks → verify only text blocks contribute to output estimation
  - **Empty message.usage**: Feed assistant message without `message.usage` field → verify graceful handling

### Step 9: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify root-level type checks pass
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific type checks pass
- Run `bun run test:unit` to verify all Vitest unit tests pass (existing + new)

## Testing Strategy
### Edge Cases
- Assistant message with no `message.usage` field — extractor should skip silently
- Assistant message with no `message.id` field — count as unique (no deduplication possible)
- Multiple content blocks from same `message.id` — usage deduplicated, but all text blocks contribute to output estimation
- Zero-length text content blocks — contribute 0 estimated output tokens
- Tool-use content blocks — do not contribute to output token estimation
- Result message arrives before any assistant messages — estimated usage is empty, actual usage from result is authoritative
- No result message (agent crashed/killed) — `getCurrentUsage()` returns accumulated per-turn estimates, `isFinalized()` is false
- Token limit termination — extractor has partial per-turn data; `totalCostUsd` computed from estimates
- Very large text blocks — output estimation uses integer division (Math.ceil or Math.round for chars/4)
- Model identification: per-turn messages may not include model name — use constructor hint or detect from `system` message

## Acceptance Criteria
- [ ] Anthropic extractor parses `assistant` message `usage` fields with `message.id` deduplication
- [ ] Output tokens estimated from content block character length during streaming (~4 chars/token)
- [ ] `agentProcessHandler.ts` uses `TokenUsageExtractor` (via `AnthropicTokenUsageExtractor`) instead of inline JSONL cost parsing for cost fields
- [ ] `getCurrentUsage()` returns accurate real-time token data (input + cache from per-turn usage, output from estimation)
- [ ] When `result` message arrives, all values replaced with authoritative numbers from `modelUsage`
- [ ] Failed agent runs (non-zero exit, missing result) still return accumulated cost via the extractor
- [ ] Progress comments update with real-time token estimates formatted as "~X tokens (estimated)"
- [ ] Estimate-vs-actual difference (numbers + percentage) logged to console at phase completion
- [ ] Unit tests cover: multi-turn streaming with deduplication, output token estimation accuracy, incomplete stream handling (no result message), finalization replacing estimates with actuals
- [ ] All existing type checks still pass (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root-level TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run test:unit` — Run all Vitest unit tests (existing + new extractor streaming tests)

## Notes
- **Backward compatibility**: The old `ModelUsageMap` type in `adws/types/costTypes.ts` uses fixed camelCase fields (`inputTokens`, `outputTokens`, etc.) while the new cost module uses `Record<string, number>` with snake_case keys. The wire-up in `agentProcessHandler.ts` must convert between these formats until the full migration (future issue) replaces the old type everywhere.
- **Model identification for per-turn messages**: Claude CLI `assistant` JSONL messages may not include the model name. The extractor should use the model passed to the agent (available in `handleAgentProcess` as the `model` parameter) or detect it from the `system` init message. The constructor should accept an optional model hint.
- **Token limit checking preserved**: The existing token limit mechanism in `agentProcessHandler.ts` uses `state.totalTokens` from `parseJsonlOutput()` → `computePrimaryModelTokens()`. This continues to work alongside the new extractor. The extractor's per-turn accumulation is for progress comments, not for token limit decisions (which require primary-model-only filtering).
- **`parseJsonlOutput` not replaced entirely**: The JSONL parser retains responsibility for text content extraction, tool use tracking, turn counting, and state management. Only the cost extraction responsibility shifts to the extractor.
- **Coding guidelines**: Follow `guidelines/coding_guidelines.md` — clarity over cleverness, modularity, immutability, type safety, pure functions, no decorators.
- **Unit Tests note**: `.adw/project.md` has `## Unit Tests: disabled` for general ADW work, but the Vitest tests in `adws/cost/__tests__/` are the deliverable of issue #241 and this issue extends them. These are cost module tests, not workflow tests.
