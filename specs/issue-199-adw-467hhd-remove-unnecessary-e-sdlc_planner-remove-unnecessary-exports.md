# Chore: Remove unnecessary exports across the codebase

## Metadata
issueNumber: `199`
adwId: `467hhd-remove-unnecessary-e`
issueJson: `{"number":199,"title":"Remove unnecessary exports across the codebase","body":"Remove ~30 exports that are only used internally within their own files, plus barrel re-exports that no consumer imports.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T13:26:32Z","comments":[],"actionableComment":null}`

## Chore Description
Many functions and constants across the ADW codebase are exported but only used within their own file. This inflates the public API surface, makes it harder to reason about module boundaries, and creates false positives when analysing dead code. An audit identified ~30 exports that should have their `export` keyword removed. Additionally, barrel `index.ts` files re-export these symbols even though no consumer imports them. A smaller set of exports exist solely for test-reset purposes but the corresponding tests were removed when ADW moved to BDD scenarios. This chore removes all unnecessary `export` keywords and cleans up barrel re-exports. No functional changes — only visibility modifiers change.

## Relevant Files
Use these files to resolve the chore:

### Section 1 — Internal helpers (remove `export` from source)
- `adws/core/issueClassifier.ts` — contains `stripFencedCodeBlocks` and `extractAdwCommandFromText` (used only within this file)
- `adws/core/orchestratorCli.ts` — contains `extractIssueTypeOption` and `parseIssueNumber` (used only within this file)
- `adws/core/costPricing.ts` — contains `getModelPricing` (used only within this file)
- `adws/core/retryOrchestrator.ts` — contains `getAdwIdFromState` (used only within this file)
- `adws/github/projectBoardApi.ts` — contains `findRepoProjectId`, `findIssueProjectItem`, `getStatusFieldOptions`, `updateProjectItemStatus` (only `moveIssueToStatus` is called externally)
- `adws/github/prCommentDetector.ts` — contains `ADW_COMMIT_PATTERN` (used only within this file)

### Section 2 — Agent formatter/helper functions (remove `export` from source)
- `adws/agents/prAgent.ts` — `formatPullRequestArgs`, `extractPrUrlFromOutput`
- `adws/agents/documentAgent.ts` — `formatDocumentArgs`, `extractDocPathFromOutput`
- `adws/agents/kpiAgent.ts` — `formatKpiArgs`
- `adws/agents/scenarioAgent.ts` — `formatScenarioArgs`
- `adws/agents/validationAgent.ts` — `formatValidationArgs`
- `adws/agents/resolutionAgent.ts` — `formatResolutionArgs`
- `adws/agents/patchAgent.ts` — `formatPatchArgs`
- `adws/agents/reviewRetry.ts` — `mergeReviewResults`, `REVIEW_AGENT_COUNT`
- `adws/agents/crucialScenarioProof.ts` — `runCrucialScenarioProof`, `shouldRunScenarioProof`

### Section 3 — Barrel re-exports to clean up
- `adws/agents/index.ts` — remove re-exports of all Section 2 symbols
- `adws/core/index.ts` — remove re-exports of `classifyWithAdwCommand`, `computeModelCost`, `getModelPricing`, `extractIssueTypeOption`, `parseIssueNumber`
- `adws/index.ts` — remove re-export of `formatPatchArgs`

### Section 4 — Test-reset hooks (remove `export` from source)
- `adws/core/costReport.ts` — `resetLastKnownRates`
- `adws/triggers/webhookGatekeeper.ts` — `resetCronSpawnedForRepo`
- `adws/triggers/webhookHandlers.ts` — `recordMergedPrIssue`, `resetMergedPrIssues`
- `adws/triggers/trigger_webhook.ts` — `resetPrReviewTriggers`, `getPrReviewTriggersMap`

### Section 5 — Trigger internals (remove `export` from source)
- `adws/triggers/trigger_cron.ts` — `fetchOpenIssues`, `hasAdwWorkflowComment`, `isWithinGracePeriod`, `filterEligibleIssues`, `checkAndTrigger`, `RawIssue`
- `adws/triggers/trigger_webhook.ts` — `shouldTriggerPrReview`, `handleIssueCostRevert`, `resolveWebhookPort`
- `adws/triggers/concurrencyGuard.ts` — `getInProgressIssueCount`
- `adws/triggers/cronProcessGuard.ts` — `getCronPidFilePath`, `readCronPid`, `removeCronPid`

### Section 6 — Backward-compat re-exports (remove)
- `adws/adwBuild.tsx` — re-exports `parseArguments`, `printBuildSummary` from `adwBuildHelpers.ts`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Remove `export` from internal helpers in core and github modules

- In `adws/core/issueClassifier.ts`: remove `export` keyword from `stripFencedCodeBlocks` function and `extractAdwCommandFromText` function. Keep the functions intact, just remove the `export` keyword.
- In `adws/core/orchestratorCli.ts`: remove `export` keyword from `extractIssueTypeOption` function and `parseIssueNumber` function.
- In `adws/core/costPricing.ts`: remove `export` keyword from `getModelPricing` function.
- In `adws/core/retryOrchestrator.ts`: remove `export` keyword from `getAdwIdFromState` function.
- In `adws/github/projectBoardApi.ts`: remove `export` keyword from `findRepoProjectId`, `findIssueProjectItem`, `getStatusFieldOptions`, and `updateProjectItemStatus` functions. Leave `moveIssueToStatus` exported (it is the public API).
- In `adws/github/prCommentDetector.ts`: remove `export` keyword from `ADW_COMMIT_PATTERN` const.

### 2. Remove `export` from agent formatter/helper functions

- In `adws/agents/prAgent.ts`: remove `export` keyword from `formatPullRequestArgs` function and `extractPrUrlFromOutput` function.
- In `adws/agents/documentAgent.ts`: remove `export` keyword from `formatDocumentArgs` function and `extractDocPathFromOutput` function.
- In `adws/agents/kpiAgent.ts`: remove `export` keyword from `formatKpiArgs` function.
- In `adws/agents/scenarioAgent.ts`: remove `export` keyword from `formatScenarioArgs` function.
- In `adws/agents/validationAgent.ts`: remove `export` keyword from `formatValidationArgs` function.
- In `adws/agents/resolutionAgent.ts`: remove `export` keyword from `formatResolutionArgs` function.
- In `adws/agents/patchAgent.ts`: remove `export` keyword from `formatPatchArgs` function.
- In `adws/agents/reviewRetry.ts`: remove `export` keyword from `mergeReviewResults` function and `REVIEW_AGENT_COUNT` const.
- In `adws/agents/crucialScenarioProof.ts`: remove `export` keyword from `runCrucialScenarioProof` function and `shouldRunScenarioProof` function.

### 3. Clean up barrel re-exports in `adws/agents/index.ts`

Remove the following re-exports from `adws/agents/index.ts`:
- From the `crucialScenarioProof` block: remove `runCrucialScenarioProof` and `shouldRunScenarioProof` (keep the `type ScenarioProofResult` export)
- From the `patchAgent` block: remove `formatPatchArgs` (keep `runPatchAgent`)
- From the `reviewRetry` block: remove `mergeReviewResults` and `REVIEW_AGENT_COUNT` (keep `runReviewWithRetry`, `type ReviewRetryResult`, `type ReviewRetryOptions`, `type MergedReviewResult`)
- From the `prAgent` block: remove `formatPullRequestArgs` and `extractPrUrlFromOutput` (keep `runPullRequestAgent`)
- From the `documentAgent` block: remove `formatDocumentArgs` and `extractDocPathFromOutput` (keep `runDocumentAgent`)
- From the `kpiAgent` block: remove `formatKpiArgs` (keep `runKpiAgent`)
- From the `scenarioAgent` block: remove `formatScenarioArgs` (keep `runScenarioAgent`)
- From the `validationAgent` block: remove `formatValidationArgs` (keep `runValidationAgent`, `findScenarioFiles`, `readScenarioContents`, `type ValidationResult`, `type MismatchItem`)
- From the `resolutionAgent` block: remove `formatResolutionArgs` (keep `runResolutionAgent`, `type ResolutionResult`, `type ResolutionDecision`)

### 4. Clean up barrel re-exports in `adws/core/index.ts`

- From the cost pricing export line (line 85): remove `getModelPricing` and `computeModelCost` from the export statement. Keep `MODEL_PRICING` and `type ModelPricing`.
- From the issue classifier export line (line 118): remove `classifyWithAdwCommand`. Keep `classifyIssueForTrigger`, `classifyGitHubIssue`, `extractAdwIdFromText`.
- From the orchestrator CLI export line (line 128): remove `extractIssueTypeOption` and `parseIssueNumber`. Keep `extractCwdOption`, `printUsageAndExit as printOrchestratorUsage`, `parseOrchestratorArguments`, `buildRepoIdentifier`, `type OrchestratorArgs`.

### 5. Clean up barrel re-export in `adws/index.ts`

- From the agents re-export block (lines 48-68): remove `formatPatchArgs`.

### 6. Remove `export` from test-reset hooks

- In `adws/core/costReport.ts`: remove `export` keyword from `resetLastKnownRates` function.
- In `adws/triggers/webhookGatekeeper.ts`: remove `export` keyword from `resetCronSpawnedForRepo` function.
- In `adws/triggers/webhookHandlers.ts`: remove `export` keyword from `recordMergedPrIssue` function and `resetMergedPrIssues` function.
- In `adws/triggers/trigger_webhook.ts`: remove `export` keyword from `resetPrReviewTriggers` function and `getPrReviewTriggersMap` function.

### 7. Remove `export` from trigger internals

- In `adws/triggers/trigger_cron.ts`: remove `export` keyword from `fetchOpenIssues` function, `hasAdwWorkflowComment` function, `isWithinGracePeriod` function, `filterEligibleIssues` function, `checkAndTrigger` function, and `RawIssue` interface.
- In `adws/triggers/trigger_webhook.ts`: remove `export` keyword from `shouldTriggerPrReview` function, `handleIssueCostRevert` function, and `resolveWebhookPort` function.
- In `adws/triggers/concurrencyGuard.ts`: remove `export` keyword from `getInProgressIssueCount` function.
- In `adws/triggers/cronProcessGuard.ts`: remove `export` keyword from `getCronPidFilePath` function, `readCronPid` function, and `removeCronPid` function.

### 8. Remove backward-compat re-exports from `adws/adwBuild.tsx`

- Remove the re-export line: `export { parseArguments, printBuildSummary } from './adwBuildHelpers';`

### 9. Run validation commands

- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to confirm no type errors from removed exports.
- Run `bun run lint` to check for linting issues.
- Run `bun run test` to confirm no import breakage and all tests pass.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bunx tsc --noEmit` — Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project
- `bun run lint` — Run linter to check for code quality issues
- `bun run test` — Run tests to validate no import breakage

## Notes
- IMPORTANT: Strictly adhere to coding guidelines in `guidelines/coding_guidelines.md`, especially "Code hygiene — Remove unused variables, functions, and imports."
- This chore changes ONLY visibility modifiers (`export` keyword removal) — no functional logic changes.
- The `RawIssue` interface in `trigger_cron.ts` is a type-only export but since it's a standalone script interface (not a `type` keyword export), it should have `export` removed per the issue scope.
- `adws/providers/repoContext.ts` exports are OUT OF SCOPE (provider migration incomplete).
- `adws/agents/claudeAgent.ts` → `runPrimedClaudeAgentWithCommand` is OUT OF SCOPE (recently added, intended for future use).
- Type-only exports (`export type`, `export interface`) used elsewhere are OUT OF SCOPE (zero runtime cost).
- When removing items from barrel export blocks, if the block becomes empty, remove the entire import/export block and its comment header.
