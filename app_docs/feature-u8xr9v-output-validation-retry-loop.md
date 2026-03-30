# Output Validation Retry Loop

**ADW ID:** u8xr9v-add-output-validatio
**Date:** 2026-03-30
**Specification:** specs/issue-362-adw-u8xr9v-add-output-validatio-sdlc_planner-output-validation-retry-loop.md

## Overview

Adds a generic output validation retry loop inside `commandAgent.runCommandAgent()` that detects structural output failures (malformed JSON, wrong keys, prose instead of JSON) and retries with a corrective Haiku prompt until the output conforms to the expected JSON Schema. As part of this, five previously direct agents (`reviewAgent`, `validationAgent`, `alignmentAgent`, `resolutionAgent`, `testAgent`) were migrated to use `commandAgent`, and all ten structured-output agents now define co-located JSON Schema objects and return the `ExtractionResult<T>` discriminated union from their `extractOutput` functions.

## What Was Built

- `ExtractionResult<T>` discriminated union (`{ success: true; data: T } | { success: false; error: string }`) replacing bare throws in `extractOutput` functions
- `OutputValidationError` custom error class thrown when all retries are exhausted
- `outputSchema` optional field added to `CommandAgentConfig<T>` accepting a JSON Schema object
- Retry loop in `runCommandAgent` (up to 10 retries via fresh Haiku `claude --print` sessions, early exit after 3 consecutive identical errors)
- Migration of `reviewAgent`, `validationAgent`, `alignmentAgent`, `resolutionAgent`, and `runTestAgent` from direct `runClaudeAgentWithCommand` calls to `commandAgent`
- JSON Schema definitions for all 10 structured-output agents
- Removal of ad-hoc per-agent retry logic from `validationAgent` and `resolutionAgent`
- Phase-level graceful degradation moved to `alignmentPhase.ts` and `planValidationPhase.ts`
- `ajv` added as a JSON Schema validation dependency
- BDD feature file (`features/output_validation_retry_loop.feature`) and step definitions (`features/step_definitions/outputValidationRetryLoopSteps.ts`)

## Technical Implementation

### Files Modified

- `adws/agents/commandAgent.ts`: Added `ExtractionResult<T>`, `OutputValidationError`, `outputSchema` config field, `buildRetryPrompt()`, `runRetryLoop()`, and wired the retry loop into `runCommandAgent()`
- `adws/agents/reviewAgent.ts`: Migrated to `commandAgent`; added `REVIEW_RESULT_SCHEMA` and `extractReviewResult` returning `ExtractionResult<ReviewResult>`
- `adws/agents/validationAgent.ts`: Migrated to `commandAgent`; added `validationResultSchema`; removed ad-hoc retry; `extractValidationResult` now returns `ExtractionResult<ValidationResult>`
- `adws/agents/alignmentAgent.ts`: Migrated to `commandAgent`; added `alignmentResultSchema`; `extractAlignmentResult` returns `ExtractionResult<AlignmentResult>`; removed `parseAlignmentResult` export
- `adws/agents/resolutionAgent.ts`: Migrated to `commandAgent`; added `RESOLUTION_RESULT_SCHEMA`; removed ad-hoc retry; `extractResolutionResult` returns `ExtractionResult<ResolutionResult>`
- `adws/agents/testAgent.ts`: `runTestAgent` migrated to `commandAgent`; added `TEST_RESULTS_SCHEMA`; `runResolveTestAgent`/`runResolveE2ETestAgent` unchanged
- `adws/agents/diffEvaluatorAgent.ts`: Added `DIFF_VERDICT_SCHEMA`; `extractDiffVerdict` returns `ExtractionResult<DiffEvaluatorVerdict>`
- `adws/agents/documentAgent.ts`: Added `DOC_PATH_SCHEMA`; `extractDocPathFromOutput` returns `ExtractionResult<string>`
- `adws/agents/dependencyExtractionAgent.ts`: Added `DEPENDENCY_ARRAY_SCHEMA`; `parseDependencyArray` returns `ExtractionResult<number[]>`
- `adws/agents/prAgent.ts`: Added `PR_CONTENT_SCHEMA`; `extractPrContentFromOutput` returns `ExtractionResult<PrContent>`
- `adws/agents/stepDefAgent.ts`: Added `REMOVED_SCENARIOS_SCHEMA`; `parseRemovedScenarios` returns `ExtractionResult<RemovedScenario[]>`
- `adws/agents/index.ts`: Exports `ExtractionResult`, schema objects, and updated agent exports
- `adws/phases/alignmentPhase.ts`: Added phase-level graceful degradation (fallback to `aligned: true` with warnings) for `OutputValidationError`
- `adws/phases/planValidationPhase.ts`: Phase-level graceful degradation for validation failures; orchestrator-level retry loop preserved
- `features/output_validation_retry_loop.feature`: Primary BDD feature file for this issue
- `features/step_definitions/outputValidationRetryLoopSteps.ts`: Cucumber step definitions (710 lines)
- `features/retry_logic_resilience.feature`: Updated `@adw-u8xr9v-add-output-validatio` scenarios to reflect centralized retry
- `features/single_pass_alignment_phase.feature`: Updated `@adw-u8xr9v-add-output-validatio` scenario for new `ExtractionResult` contract
- `package.json` / `bun.lock`: Added `ajv` dependency

### Key Changes

- **`ExtractionResult<T>` contract**: All `extractOutput` functions now return a discriminated union instead of throwing or returning null, giving the retry loop structured error information to feed back to the LLM.
- **Centralized retry loop**: `runRetryLoop()` in `commandAgent.ts` handles validation + retry for all agents uniformly — no per-agent retry code needed.
- **Haiku for retries**: Retry invocations use the `haiku` model (cheap reformatting task), while the original agent invocation keeps its configured model.
- **Early exit logic**: 3 consecutive identical validation errors trigger early exit to avoid wasting tokens when the schema or prompt itself is the problem.
- **Phase-level fallbacks**: Previously, some `extractOutput` functions embedded silent fallbacks (e.g., alignment returning `aligned: true` on parse failure). These now live at the phase level, only activating after the retry loop is exhausted.

## How to Use

The retry loop is transparent — it activates automatically when an agent's `CommandAgentConfig` includes both `extractOutput` and `outputSchema`.

To add retry support to a new agent:

1. Define a JSON Schema object for the agent's output type:
   ```typescript
   export const MY_RESULT_SCHEMA: Record<string, unknown> = {
     type: 'object',
     required: ['field1', 'field2'],
     properties: { field1: { type: 'string' }, field2: { type: 'boolean' } },
   };
   ```

2. Update `extractOutput` to return `ExtractionResult<T>`:
   ```typescript
   function extractMyResult(output: string): ExtractionResult<MyResult> {
     const parsed = extractJson<MyResult>(output);
     if (!parsed) return { success: false, error: 'No JSON found in output' };
     return { success: true, data: parsed };
   }
   ```

3. Add `outputSchema` to the agent's `CommandAgentConfig`:
   ```typescript
   const myAgentConfig: CommandAgentConfig<MyResult> = {
     command: '/my_command',
     agentName: 'my-agent',
     outputFileName: 'my-agent.jsonl',
     extractOutput: extractMyResult,
     outputSchema: MY_RESULT_SCHEMA,
   };
   ```

To handle retry exhaustion at the phase level:
```typescript
import { OutputValidationError } from '../agents/commandAgent';
try {
  const result = await runMyAgent(options);
} catch (err) {
  if (err instanceof OutputValidationError) {
    // graceful degradation here
  }
  throw err;
}
```

## Configuration

- **`MAX_RETRIES`**: 10 (hardcoded in `commandAgent.ts`)
- **`MAX_CONSECUTIVE_IDENTICAL_ERRORS`**: 3 (hardcoded in `commandAgent.ts`)
- **Retry model**: `haiku` (hardcoded; reformatting is a cheap task)
- **Backward compatibility**: Agents without `extractOutput` or `outputSchema` skip the retry loop entirely

## Testing

Run the BDD scenarios for this feature:
```
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-u8xr9v-add-output-validatio and @regression"
```

Run the full regression suite:
```
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

TypeScript type-check:
```
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- **`runResolveTestAgent` and `runResolveE2ETestAgent`** are not migrated — they have no structured output extraction.
- **`ajv`** is the JSON Schema validator used at the `extractOutput` layer; it is also referenced in the retry prompt sent to the LLM so it understands the required schema shape.
- **Per-agent retry removed**: `validationAgent` and `resolutionAgent` previously had one-shot ad-hoc retries with limited error context. These are removed; the `commandAgent` retry loop supersedes them with up to 10 retries and full error detail.
- **`parseAlignmentResult`** is no longer exported from `alignmentAgent` — callers that relied on graceful degradation now catch `OutputValidationError` in the phase layer.
