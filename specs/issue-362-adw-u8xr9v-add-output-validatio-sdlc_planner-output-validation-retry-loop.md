# Feature: Output validation retry loop in commandAgent

## Metadata
issueNumber: `362`
adwId: `u8xr9v-add-output-validatio`
issueJson: `{"number":362,"title":"Add output validation retry loop to commandAgent","body":"## Problem\n\nThe LLM frequently ignores structural output instructions, returning malformed JSON, wrong keys, prose instead of JSON, or otherwise invalid output. When `extractOutput` fails today, the entire phase fails with no recovery attempt.\n\n## Solution\n\nAdd a generic output validation retry loop inside `commandAgent.runCommandAgent()` that detects structural failures and retries with a corrective prompt until the output conforms to the expected JSON schema.\n\n### Prerequisites\n\nMigrate these 5 direct agents to use `commandAgent`:\n- `reviewAgent`\n- `validationAgent`\n- `alignmentAgent`\n- `resolutionAgent`\n- `testAgent`\n\nThese agents already call `runClaudeAgentWithCommand` under the hood — the pre/post logic they have (scenario file discovery, screenshot handling, etc.) is orthogonal to the retry and happens outside the agent invocation.\n\n### Schema definitions\n\nEach of the 10 agents that produce structured output defines a JSON Schema object co-located with its `extractOutput` function:\n\n| Agent | Output type |\n|---|---|\n| `diffEvaluatorAgent` | `DiffVerdict` |\n| `documentAgent` | doc path string |\n| `dependencyExtractionAgent` | dependency array |\n| `prAgent` | PR content |\n| `stepDefAgent` | removed scenarios |\n| `reviewAgent` | `ReviewResult` |\n| `validationAgent` | `ValidationResult` |\n| `alignmentAgent` | `AlignmentResult` |\n| `resolutionAgent` | `ResolutionResult` |\n| `testAgent` | `TestResult[]` |\n\nThe JSON Schema serves double duty: runtime validation and LLM retry prompt content.\n\n### `extractOutput` contract change\n\n`extractOutput` validates against the JSON Schema and returns a structured error with the specific validation message (not a bare throw). This allows the retry loop to feed detailed error information back to the LLM.\n\n### Retry loop\n\nLives inside `commandAgent.runCommandAgent()`, wrapping the `extractOutput` call:\n\n1. Call `extractOutput` on `result.output`\n2. If validation fails, spawn a **new** `claude --print` session (same agent machinery) with:\n   - **Model:** Haiku (reformatting is a cheap task)\n   - **Prompt:** original command description + args, full `result.output`, JSON Schema, specific validation error\n3. Call `extractOutput` on the retry output\n4. Repeat up to **10 retries total**\n5. **Early exit:** if the same validation error repeats **3 times consecutively**, bail out (the problem is the schema or prompt, not the model being stubborn)\n6. If all retries exhausted, throw with the last validation error\n\nDifferent validation errors reset the consecutive counter.\n\n### Retry prompt structure\n\n```\nYou were invoked with [command] with arguments: [args].\nYou returned the following output:\n[full result.output]\n\nThis output failed validation against the expected JSON schema:\n[schema]\n\nValidation error: [error]\n\nReturn ONLY valid JSON matching the schema above.\n```\n\n### Design decisions\n\n- **No session resume:** Each retry is a fresh `--print` invocation, not `--resume`. The CLI's `--resume` and `--print` flags don't mix.\n- **Full output in retry:** The entire `result.output` is sent, not just extracted fragments. The LLM can completely ignore instructions and return something wildly off, so we don't try to be clever about pre-extraction.\n- **Haiku for retries:** The original agent may use Opus/Sonnet for complex work, but reformatting malformed JSON is a Haiku-tier task.\n- **Same machinery:** Retries go through the same agent spawn infrastructure (not a bare API call), keeping the invocation path uniform.\n- **DRY:** Single retry loop in `commandAgent` covers all 10 agents after migration.","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-03-30T14:52:24Z","comments":[{"author":"paysdoc","createdAt":"2026-03-30T14:57:16Z","body":"## Take action"},{"author":"paysdoc","createdAt":"2026-03-30T15:05:14Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Add a generic output validation retry loop inside `commandAgent.runCommandAgent()` that detects structural output failures (malformed JSON, wrong keys, prose instead of JSON) and retries with a corrective Haiku prompt until the output conforms to the expected JSON Schema. As a prerequisite, migrate the 5 remaining direct agents (`reviewAgent`, `validationAgent`, `alignmentAgent`, `resolutionAgent`, `testAgent`) to use `commandAgent`, and define JSON Schema objects across all 10 agents that produce structured output. The `extractOutput` contract changes from bare throws/nulls to a structured `ExtractionResult<T>` discriminated union, enabling the retry loop to feed specific validation errors back to the LLM.

## User Story
As an ADW operator
I want malformed LLM output to be automatically retried with a corrective prompt
So that transient structural failures don't crash entire workflow phases

## Problem Statement
The LLM frequently ignores structural output instructions, returning malformed JSON, wrong keys, prose instead of JSON, or otherwise invalid output. When `extractOutput` fails today, the entire phase fails with no recovery attempt. Some agents (validationAgent, resolutionAgent) have ad-hoc retry logic, but it's duplicated and doesn't provide the LLM with enough error context to self-correct.

## Solution Statement
Add a single retry loop inside `commandAgent.runCommandAgent()` that wraps `extractOutput` with JSON Schema validation. On failure, spawn a fresh Haiku `claude --print` session with the original output, the JSON Schema, and the specific validation error — giving the LLM maximum context to produce conforming output. Cap at 10 retries with an early exit after 3 consecutive identical errors. Migrate all 10 structured-output agents to this unified path, eliminating per-agent retry duplication.

## Relevant Files
Use these files to implement the feature:

### Core files to modify
- `adws/agents/commandAgent.ts` — Central change: add `outputSchema` to `CommandAgentConfig`, change `extractOutput` return type to `ExtractionResult<T>`, implement the retry loop with Haiku retries
- `adws/agents/claudeAgent.ts` — Reference for `runClaudeAgentWithCommand` API (model, effort, args); retry invocations will call through this same function
- `adws/core/jsonParser.ts` — Existing `extractJson<T>()` and `extractJsonArray<T>()` utilities used by agents; will be leveraged inside updated `extractOutput` functions
- `adws/core/modelRouting.ts` — Reference for model/effort routing; retry loop hardcodes Haiku model
- `adws/types/agentTypes.ts` — `AgentResult` type, `AgentIdentifier` union
- `adws/types/issueTypes.ts` — `SlashCommand` type union

### Agents to migrate (currently call `runClaudeAgentWithCommand` directly)
- `adws/agents/reviewAgent.ts` — Migrate to `commandAgent`; add JSON Schema for `ReviewResult`; change `extractOutput` to return `ExtractionResult<ReviewResult>`
- `adws/agents/validationAgent.ts` — Migrate to `commandAgent`; add JSON Schema for `ValidationResult`; remove ad-hoc retry logic
- `adws/agents/alignmentAgent.ts` — Migrate to `commandAgent`; add JSON Schema for `AlignmentResult`
- `adws/agents/resolutionAgent.ts` — Migrate to `commandAgent`; add JSON Schema for `ResolutionResult`; remove ad-hoc retry logic
- `adws/agents/testAgent.ts` — Migrate `runTestAgent` to `commandAgent`; add JSON Schema for `TestResult[]`; `runResolveTestAgent`/`runResolveE2ETestAgent` have no structured output and stay as-is

### Agents already on commandAgent (add JSON Schema + update extractOutput)
- `adws/agents/diffEvaluatorAgent.ts` — Add JSON Schema for `DiffEvaluatorVerdict`; update `extractDiffVerdict` to return `ExtractionResult<DiffEvaluatorVerdict>`
- `adws/agents/documentAgent.ts` — Add JSON Schema for doc path string; update `extractDocPathFromOutput` to return `ExtractionResult<string>`
- `adws/agents/dependencyExtractionAgent.ts` — Add JSON Schema for dependency array; update `parseDependencyArray` to return `ExtractionResult<number[]>`
- `adws/agents/prAgent.ts` — Add JSON Schema for `PrContent`; update `extractPrContentFromOutput` to return `ExtractionResult<PrContent>`
- `adws/agents/stepDefAgent.ts` — Add JSON Schema for `RemovedScenario[]`; update `parseRemovedScenarios` to return `ExtractionResult<RemovedScenario[]>`

### Barrel export
- `adws/agents/index.ts` — Update exports for migrated agents and new types (`ExtractionResult`, schema objects)

### BDD scenarios (already written, verify alignment)
- `features/output_validation_retry_loop.feature` — Primary feature file for this issue (already exists)
- `features/retry_logic_resilience.feature` — Cross-referenced scenarios tagged `@adw-u8xr9v-add-output-validatio` (update to reflect new commandAgent retry replacing per-agent retry)
- `features/single_pass_alignment_phase.feature` — Cross-referenced scenario for `parseAlignmentResult` fallback (update to reflect new ExtractionResult contract)

### Reference (read-only)
- `guidelines/coding_guidelines.md` — Coding guidelines to follow
- `adws/agents/installAgent.ts` — Reference pattern: simplest commandAgent consumer (no extractOutput)

### New Files
- None — all changes are modifications to existing files. The `ajv` library will be added as a dependency.

## Implementation Plan
### Phase 1: Foundation
Install `ajv` (the standard JSON Schema validator for JavaScript/Bun). Define the `ExtractionResult<T>` discriminated union type and add the `outputSchema` field to `CommandAgentConfig<T>`. Update `runCommandAgent` to handle the new `ExtractionResult<T>` return type from `extractOutput` (initially without the retry loop, just unwrapping the result so all existing agents keep working).

### Phase 2: Update existing commandAgent consumers
Update the 5 agents already using `commandAgent` (diffEvaluatorAgent, documentAgent, dependencyExtractionAgent, prAgent, stepDefAgent) to:
1. Define a JSON Schema object co-located with `extractOutput`
2. Update `extractOutput` to return `ExtractionResult<T>` (parse + validate against schema)
3. Pass the schema in `CommandAgentConfig.outputSchema`

### Phase 3: Migrate 5 direct agents to commandAgent
Migrate reviewAgent, validationAgent, alignmentAgent, resolutionAgent, and testAgent (the `runTestAgent` function) from direct `runClaudeAgentWithCommand` calls to `commandAgent`. Each migration:
1. Creates a `CommandAgentConfig<T>` with command, agentName, outputFileName, extractOutput, and outputSchema
2. Replaces the direct call with `runCommandAgent(config, options)`
3. Maps the result back to the agent's existing public return type
4. Preserves all pre/post logic (arg formatting, scenario discovery, etc.) outside the commandAgent call

### Phase 4: Core — Retry loop implementation
Implement the retry loop inside `runCommandAgent()`:
1. Call `extractOutput` on `result.output`
2. If `ExtractionResult.success === false`, spawn a new `claude --print` session via `runClaudeAgentWithCommand` with Haiku model, retry prompt containing original command + args + full output + JSON Schema + validation error
3. Call `extractOutput` on retry output
4. Repeat up to 10 retries total
5. Early exit after 3 consecutive identical validation errors
6. On success, return the parsed result
7. On exhaustion, throw with the last validation error

### Phase 5: Cleanup and integration
Remove ad-hoc per-agent retry logic from validationAgent and resolutionAgent. Update barrel exports in `adws/agents/index.ts`. Update cross-referenced BDD scenarios in `retry_logic_resilience.feature` and `single_pass_alignment_phase.feature` to reflect the new centralized retry.

## Step by Step Tasks

### Step 1: Install ajv dependency
- Run `bun add ajv` to install the JSON Schema validation library
- Verify import works with a quick type-check

### Step 2: Define ExtractionResult<T> and update CommandAgentConfig
- In `adws/agents/commandAgent.ts`, define the `ExtractionResult<T>` discriminated union:
  ```typescript
  export type ExtractionResult<T> =
    | { success: true; data: T }
    | { success: false; error: string };
  ```
- Add optional `outputSchema` field to `CommandAgentConfig<T>` (type: `Record<string, unknown>` — a JSON Schema object)
- Change `extractOutput` type from `(output: string) => T` to `(output: string) => ExtractionResult<T>`
- Update `runCommandAgent` to unwrap `ExtractionResult`: if `success`, set `parsed = result.data`; if `!success`, throw with `result.error` (temporary — retry loop replaces this in Step 8)
- Export `ExtractionResult` from the module

### Step 3: Update diffEvaluatorAgent to new extractOutput contract
- Define `DIFF_VERDICT_SCHEMA` JSON Schema object for `DiffEvaluatorVerdict` (`{ verdict: 'safe' | 'regression_possible', reason: string }`)
- Update `extractDiffVerdict` to return `ExtractionResult<DiffEvaluatorVerdict>`:
  - On success: `{ success: true, data: { verdict, reason } }`
  - On failure: `{ success: false, error: "..." }` (replaces the current fallback-to-regression_possible pattern)
- Add `outputSchema: DIFF_VERDICT_SCHEMA` to the `CommandAgentConfig`
- Note: the current fallback behavior (defaulting to `regression_possible`) moves to the phase-level caller (`diffEvaluationPhase.ts`), not `extractOutput` — `extractOutput` must report failure honestly so the retry loop can act on it

### Step 4: Update documentAgent to new extractOutput contract
- Define `DOC_PATH_SCHEMA` JSON Schema object for a non-empty string
- Update `extractDocPathFromOutput` to return `ExtractionResult<string>`
- Add `outputSchema: DOC_PATH_SCHEMA` to the `CommandAgentConfig`

### Step 5: Update dependencyExtractionAgent to new extractOutput contract
- Define `DEPENDENCY_ARRAY_SCHEMA` JSON Schema object for an array of positive integers
- Update `parseDependencyArray` to return `ExtractionResult<number[]>`
- Add `outputSchema: DEPENDENCY_ARRAY_SCHEMA` to the `CommandAgentConfig`

### Step 6: Update prAgent to new extractOutput contract
- Define `PR_CONTENT_SCHEMA` JSON Schema object for `PrContent` (`{ title: string, body: string }`)
- Update `extractPrContentFromOutput` to return `ExtractionResult<PrContent>`
- Add `outputSchema: PR_CONTENT_SCHEMA` to the `CommandAgentConfig`

### Step 7: Update stepDefAgent to new extractOutput contract
- Define `REMOVED_SCENARIOS_SCHEMA` JSON Schema object for `{ removedScenarios: RemovedScenario[] }`
- Update `parseRemovedScenarios` to return `ExtractionResult<RemovedScenario[]>`
- Add `outputSchema: REMOVED_SCENARIOS_SCHEMA` to the `CommandAgentConfig`

### Step 8: Implement retry loop in commandAgent.runCommandAgent()
- Import `runClaudeAgentWithCommand` for retry invocations
- After calling `extractOutput`, if `result.success === false`:
  1. Build the retry prompt: original command + args, full `result.output`, JSON Schema (from `config.outputSchema`), validation error (from `extractionResult.error`)
  2. Spawn a new `runClaudeAgentWithCommand` call with:
     - Model: `'haiku'`
     - No effort override (Haiku doesn't need one)
     - Agent name: `${config.agentName}-retry-${attemptNumber}`
     - Output file: retry-specific JSONL file in the same logs dir
  3. Call `extractOutput` on the retry output
  4. Repeat up to 10 retries total
  5. Track consecutive identical errors; bail after 3 consecutive
  6. Different errors reset the counter
  7. On success, return the parsed result
  8. On exhaustion, throw `OutputValidationError` with the last validation error message
- If `config.extractOutput` is undefined or `config.outputSchema` is undefined, skip the retry loop entirely (backward compatible)
- Add logging for each retry attempt (attempt number, error message)

### Step 9: Migrate reviewAgent to commandAgent
- Define `REVIEW_RESULT_SCHEMA` JSON Schema for `ReviewResult` (`{ success: boolean, reviewSummary: string, reviewIssues: ReviewIssue[], screenshots: string[] }`)
- Create `extractReviewResult(output: string): ExtractionResult<ReviewResult>` using `extractJson<ReviewResult>` + schema validation via ajv
- Define `reviewAgentConfig: CommandAgentConfig<ReviewResult>` with command `/review`, agentName, outputFileName, extractOutput, outputSchema
- Replace the direct `runClaudeAgentWithCommand` call with `runCommandAgent(reviewAgentConfig, options)`
- Map `CommandAgentResult<ReviewResult>` back to the existing `ReviewAgentResult` interface (preserve `passed`, `blockerIssues` computed fields)
- Keep `formatReviewArgs()` as the pre-logic for argument formatting
- Update `adws/agents/index.ts` exports

### Step 10: Migrate validationAgent to commandAgent
- Define `VALIDATION_RESULT_SCHEMA` JSON Schema for `ValidationResult` (`{ aligned: boolean, mismatches: MismatchItem[], summary: string }`)
- Create `extractValidationResult(output: string): ExtractionResult<ValidationResult>` using extractJson + schema validation
- Define `validationAgentConfig: CommandAgentConfig<ValidationResult>` with command `/validate_plan_scenarios`
- Replace direct `runClaudeAgentWithCommand` call with `runCommandAgent`
- **Remove the existing ad-hoc retry logic** (the one-retry-if-null pattern) — the commandAgent retry loop now handles this with up to 10 retries and better error context
- Keep `formatValidationArgs()` and `findScenarioFiles()` as pre-logic
- Update exports

### Step 11: Migrate alignmentAgent to commandAgent
- Define `ALIGNMENT_RESULT_SCHEMA` JSON Schema for `AlignmentResult` (`{ aligned: boolean, warnings: string[], changes: string[], summary: string }`)
- Create `extractAlignmentResult(output: string): ExtractionResult<AlignmentResult>` using extractJson + schema validation
- Define `alignmentAgentConfig: CommandAgentConfig<AlignmentResult>` with command `/align_plan_scenarios`
- Replace direct `runClaudeAgentWithCommand` call with `runCommandAgent`
- Keep `formatAlignmentArgs()` as pre-logic
- **Remove `parseAlignmentResult` export** — replaced by `extractAlignmentResult` inside the config; phase-level callers that need graceful degradation handle it at their level
<!-- ADW-WARNING: Removing parseAlignmentResult will break the @adw-305 @regression scenario "AlignmentResult interface is exported from the agents module" in features/single_pass_alignment_phase.feature (line 163) which asserts parseAlignmentResult is exported. That scenario is not tagged @adw-u8xr9v-add-output-validatio and must be updated separately. -->
- Update exports

### Step 12: Migrate resolutionAgent to commandAgent
- Define `RESOLUTION_RESULT_SCHEMA` JSON Schema for `ResolutionResult` (`{ resolved: boolean, decisions: ResolutionDecision[] }`)
- Create `extractResolutionResult(output: string): ExtractionResult<ResolutionResult>` using extractJson + schema validation
- Define `resolutionAgentConfig: CommandAgentConfig<ResolutionResult>` with command `/resolve_plan_scenarios`
- Replace direct `runClaudeAgentWithCommand` call with `runCommandAgent`
- **Remove the existing ad-hoc retry logic** (the retry-if-unresolved-and-null pattern)
- Keep `formatResolutionArgs()` as pre-logic
- Update exports

### Step 13: Migrate testAgent (runTestAgent) to commandAgent
- Define `TEST_RESULTS_SCHEMA` JSON Schema for `TestResult[]` (array of `{ testName: string, passed: boolean, ... }`)
- Create `extractTestResults(output: string): ExtractionResult<TestResult[]>` using `extractJsonArray` + schema validation
- Define `testAgentConfig: CommandAgentConfig<TestResult[]>` with command `/test`
- Replace the direct `runClaudeAgentWithCommand` call in `runTestAgent` with `runCommandAgent`
- Map `CommandAgentResult<TestResult[]>` back to the existing `TestAgentResult` interface (preserve `allPassed`, `failedTests` computed fields)
- **Leave `runResolveTestAgent` and `runResolveE2ETestAgent` unchanged** — they have no structured output extraction
- Update exports

### Step 14: Update barrel exports in index.ts
- Export `ExtractionResult` type from `commandAgent`
- Update migrated agent exports (remove `parseAlignmentResult`, `parseValidationResult` if no longer needed externally)
- Ensure all schema objects are exported for BDD scenario verification

### Step 15: Update cross-referenced BDD scenarios
- In `features/retry_logic_resilience.feature`: update the `@adw-u8xr9v-add-output-validatio` tagged scenarios (resolution agent retry, validation agent retry) to reflect that per-agent retry logic is removed and the commandAgent retry loop handles retries
- In `features/single_pass_alignment_phase.feature`: update the `@adw-u8xr9v-add-output-validatio` tagged scenario for `parseAlignmentResult` to reflect the new `ExtractionResult` contract

### Step 16: Update phase-level callers for new error handling
- Review `adws/phases/diffEvaluationPhase.ts` — if `extractOutput` previously returned a safe fallback (e.g., `regression_possible`) on parse failure, the phase caller now needs to handle the case where the retry loop exhausts and throws. Add a try-catch that defaults to `regression_possible` at the phase level.
- Review `adws/phases/alignmentPhase.ts` — similarly, add graceful degradation at the phase level for alignment failures (the current `parseAlignmentResult` fallback to `aligned: true` with warnings moves here).
- Review `adws/phases/planValidationPhase.ts` — the orchestrator-level retry loop (`MAX_VALIDATION_RETRY_ATTEMPTS`) remains; only the per-agent retry is removed.
- Review any other phase files that call the migrated agents and ensure error handling is appropriate.

### Step 17: Run validation commands
- Run `bunx tsc --noEmit` to verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific compilation
- Run `bun run lint` to check code quality
- Run `bun run build` to verify no build errors
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-u8xr9v-add-output-validatio and @regression"` to run the BDD scenarios for this feature

## Testing Strategy
### Edge Cases
- Agent output is completely empty string — `extractOutput` should return `{ success: false, error: "Empty output" }`
- Agent output is valid JSON but wrong shape (e.g., array instead of object) — schema validation catches it
- Agent output contains JSON embedded in prose — `extractJson` extracts it, then schema validates
- Retry itself returns malformed output — loop continues to next retry
- Retry returns a different validation error — consecutive counter resets
- Same error 3 times in a row — early exit before reaching 10 retries
- All 10 retries fail — throws with last error
- `extractOutput` defined but `outputSchema` undefined — retry loop is skipped (backward compatible)
- `extractOutput` undefined — no parsing or retry attempted
- Rate limit during retry — `RateLimitError` propagates up (not caught by retry loop)
- Auth expiry during retry — propagates up (not caught by retry loop)

## Acceptance Criteria
- All 10 structured-output agents define a co-located JSON Schema object
- All 10 agents' `extractOutput` functions return `ExtractionResult<T>` (not bare values or throws)
- `CommandAgentConfig<T>` includes an optional `outputSchema` field
- The retry loop in `runCommandAgent` retries up to 10 times with Haiku model
- The retry loop exits early after 3 consecutive identical errors
- The retry prompt includes original command, full output, JSON Schema, and validation error
- Each retry is a fresh `claude --print` invocation via `runClaudeAgentWithCommand`
- Per-agent retry logic is removed from validationAgent and resolutionAgent
- All 5 previously-direct agents (review, validation, alignment, resolution, test) now use `commandAgent`
- TypeScript type-check passes (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`)
- Lint passes (`bun run lint`)
- Build passes (`bun run build`)
- All `@adw-u8xr9v-add-output-validatio @regression` BDD scenarios pass

## Validation Commands

- `bunx tsc --noEmit` — TypeScript type-check (root config)
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type-check (ADW config)
- `bun run lint` — Lint check
- `bun run build` — Build verification
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-u8xr9v-add-output-validatio and @regression"` — BDD scenarios for this feature
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite

## Notes
- **New dependency:** `ajv` (JSON Schema validator). Install with `bun add ajv`.
- **Coding guidelines:** Follow `guidelines/coding_guidelines.md` strictly — no `any` types, prefer pure functions, keep files under 300 lines, immutability, strict TypeScript.
- **Unit tests disabled:** Per `.adw/project.md`, no unit tests are created. BDD scenarios are the validation mechanism.
- **Backward compatibility:** Agents without `extractOutput` or without `outputSchema` skip the retry loop entirely, preserving existing behavior for agents like `installAgent`, `buildAgent`, `planAgent`.
- **Phase-level fallbacks:** Some agents currently embed fallback logic inside `extractOutput` (e.g., diffEvaluator defaults to `regression_possible`, alignment defaults to `aligned: true`). After migration, these fallbacks move to the phase-level callers. The `extractOutput` function must report failure honestly so the retry loop has the opportunity to fix the output before the fallback kicks in.
- **Cross-referenced scenarios:** The `retry_logic_resilience.feature` and `single_pass_alignment_phase.feature` files have scenarios tagged `@adw-u8xr9v-add-output-validatio` that reference per-agent retry and parse-fallback behavior. These must be updated to reflect the new centralized retry in commandAgent.
- **testAgent scope:** Only `runTestAgent` (which extracts `TestResult[]`) is migrated. `runResolveTestAgent` and `runResolveE2ETestAgent` have no structured output extraction and remain as direct `runClaudeAgentWithCommand` calls.
