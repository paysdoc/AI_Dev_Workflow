# Feature: Replace code-diff review proof with @crucial BDD scenario execution

## Metadata
issueNumber: `168`
adwId: `9emriw-refactor-review-phas`
issueJson: `{"number":168,"title":"Refactor review phase: replace code-diff proof with @crucial BDD scenario execution","body":"## Context\n\nThe review phase currently produces proof via code-diff analysis, lint/type checks, and screenshots. This is replaced by executing all \\`@crucial\\`-tagged BDD scenarios. Crucial scenario failures are blockers; the review passes if all crucial scenarios pass. Non-crucial failures from the current issue's scenarios are reported as tech-debt.\n\n## Depends on\n\n- #165 (Scenario Planner Agent — \\`@crucial\\` tags must exist and be maintained)\n- #167 (BDD test infrastructure and pipeline order in place)\n\n## Requirements\n\n### Review behaviour change\n\n- \\`/review\\` command executes all \\`@crucial\\` scenarios using the command from \\`.adw/scenarios.md\\`\n- Scenario execution results replace code-diff analysis as the primary proof\n- \\`@crucial\\` failures = blocker issues\n- Failures from \\`@adw-{issueNumber}\\` scenarios (current issue, non-crucial) = tech-debt\n- Review summary describes scenario results, not code diff\n\n### \\`review_proof.md\\` update (ADW project)\n\n- Updated to reflect scenario-based proof\n- Removes references to \\`bun run test\\` output and code-diff verification\n- Specifies that proof = \\`@crucial\\` scenario execution results\n\n### Backward compatibility\n\n- If \\`.adw/scenarios.md\\` does not exist in the target repo: fall back to current code-diff proof behaviour\n- This ensures projects that have not yet adopted BDD continue to work\n\n## Acceptance Criteria\n\n- Review phase runs \\`@crucial\\` scenarios and reports pass/fail\n- \\`@crucial\\` failures are reported as blockers\n- Current-issue scenario failures (non-crucial) are reported as tech-debt\n- Review proof posted to PR is scenario output, not code diff\n- Fallback to code-diff proof when \\`scenarios.md\\` is absent\n- ADW's own \\`review_proof.md\\` is updated to reflect the new approach","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-13T07:02:35Z","comments":[{"author":"paysdoc","createdAt":"2026-03-13T16:12:41Z","body":"## Take action\n"}],"actionableComment":null}`

## Feature Description
The review phase currently produces proof via code-diff analysis, test output summaries, lint/type-check verification, and spec compliance checklists. This feature replaces that proof mechanism with BDD scenario execution: all `@crucial`-tagged scenarios are executed, and their pass/fail results become the primary review proof. `@crucial` failures are blockers that prevent the PR from passing review. Non-crucial failures from the current issue's `@adw-{issueNumber}` scenarios are reported as tech-debt. Backward compatibility is maintained — repos without `.adw/scenarios.md` fall back to the existing code-diff proof behaviour.

## User Story
As an ADW workflow operator
I want the review phase to use `@crucial` BDD scenario execution as its primary proof mechanism
So that review proof reflects actual runtime behaviour rather than static code-diff analysis

## Problem Statement
The current review proof mechanism relies on code-diff analysis, test output summaries, and lint/type checks. These are static verification methods that don't demonstrate that the application actually works as specified. BDD scenarios test real behaviour, and `@crucial` scenarios form a regression safety net. Using scenario execution as proof provides stronger, more meaningful verification that the implementation meets requirements.

## Solution Statement
Run `@crucial` BDD scenarios **once** (via subprocess) at the start of each review iteration, before launching the 3 parallel review agents. Also run `@adw-{issueNumber}` scenarios for the current issue. Save the combined scenario output to a results file. Each review agent then reads those scenario results and classifies them: `@crucial` failures become `blocker` review issues, `@adw-{issueNumber}` non-crucial failures become `tech-debt` review issues. The review summary describes scenario results instead of code diffs. When `.adw/scenarios.md` is absent, the system falls back to the existing code-diff proof behaviour.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding standards to follow during implementation
- `adws/agents/reviewRetry.ts` — Multi-agent review retry loop; needs scenario execution step added before parallel review agents
- `adws/agents/reviewAgent.ts` — Review agent runner; needs to pass scenario results file path to the `/review` command
- `adws/agents/bddScenarioRunner.ts` — Existing BDD subprocess executor; needs new functions to run `@crucial` and tag-filtered scenarios returning structured results
- `adws/agents/index.ts` — Agent module barrel; needs to export new scenario runner functions
- `adws/phases/workflowCompletion.ts` — Review phase orchestration; needs to pass `issueNumber` and `projectConfig` to `runReviewWithRetry`
- `adws/phases/workflowInit.ts` — `WorkflowConfig` type definition (read-only reference)
- `adws/core/projectConfig.ts` — `ProjectConfig` type with `ScenariosConfig` and `scenariosMd` (read-only reference)
- `.claude/commands/review.md` — Review slash command prompt; needs scenario-aware proof instructions with fallback
- `.adw/review_proof.md` — ADW project proof requirements; needs rewrite for scenario-based proof
- `.adw/scenarios.md` — BDD scenario configuration (read-only reference for command templates)
- `.adw/commands.md` — Project commands including `runCrucialScenarios` and `runScenariosByTag` (read-only reference)
- `app_docs/feature-fix-review-process-8aatht-multi-agent-review-external-proof.md` — Documentation of multi-agent review architecture (read for context)
- `app_docs/feature-1773386463517-mvb88d-bdd-scenario-config.md` — Documentation of BDD scenario config (read for context)

### New Files
- `adws/agents/crucialScenarioProof.ts` — Orchestrates running `@crucial` and `@adw-{issueNumber}` scenarios, saves results to a file, returns structured outcome for the review retry loop

## Implementation Plan
### Phase 1: Foundation
Extend the BDD scenario runner to support running scenarios by arbitrary tags (not just `@adw-{issueNumber}`) and create the crucial-scenario proof orchestrator that runs both `@crucial` and `@adw-{issueNumber}` scenarios, classifies results, and writes them to a results file.

### Phase 2: Core Implementation
Integrate the crucial-scenario proof step into the review retry loop (`reviewRetry.ts`). Run scenarios once per review iteration before the 3 parallel review agents launch. Pass the scenario results file path to each review agent. Update the `/review` slash command to read scenario results and produce scenario-based proof. Update `ReviewRetryOptions` to carry `issueNumber` and `projectConfig`.

### Phase 3: Integration
Update `.adw/review_proof.md` to describe the new scenario-based proof format. Update `executeReviewPhase` in `workflowCompletion.ts` to pass the additional config needed. Ensure backward compatibility: when `scenariosMd` is empty, skip scenario execution and fall back to the existing code-diff proof behaviour.

## Step by Step Tasks

### Step 1: Read context documentation
- Read `app_docs/feature-fix-review-process-8aatht-multi-agent-review-external-proof.md` for multi-agent review architecture context
- Read `app_docs/feature-1773386463517-mvb88d-bdd-scenario-config.md` for BDD scenario configuration context
- Read `guidelines/coding_guidelines.md` for coding standards

### Step 2: Extend `bddScenarioRunner.ts` with a generic tag runner
- Add a new function `runScenariosByTag(tagCommand: string, tag: string, cwd?: string): Promise<BddScenarioResult>` that:
  - Takes the run-by-tag command template (e.g. `cucumber-js --tags "@{tag}"`)
  - Replaces `{tag}` with the provided tag
  - Runs it as a subprocess and returns `BddScenarioResult`
  - Returns a passing result when the command is `'N/A'` or empty (graceful skip)
- This generalises the existing `runBddScenarios` which is specific to `{issueNumber}` replacement
- Export the new function from `adws/agents/index.ts`

### Step 3: Create `crucialScenarioProof.ts`
- Create `adws/agents/crucialScenarioProof.ts` with:
  - Interface `ScenarioProofResult`:
    - `crucialPassed: boolean` — all `@crucial` scenarios passed
    - `crucialOutput: string` — stdout from `@crucial` run
    - `crucialExitCode: number | null`
    - `issueScenariosPassed: boolean` — `@adw-{issueNumber}` scenarios passed
    - `issueScenarioOutput: string` — stdout from issue-specific run
    - `issueScenarioExitCode: number | null`
    - `resultsFilePath: string` — path to the written results file
  - Function `runCrucialScenarioProof(options)` that:
    - Accepts `{ scenariosMd: string, runByTagCommand: string, runCrucialCommand: string, issueNumber: number, proofDir: string, cwd?: string }`
    - Runs `@crucial` scenarios using `runCrucialCommand` (from `.adw/commands.md`) via `runScenariosByTag` or directly via `runBddScenarios`-style subprocess
    - Runs `@adw-{issueNumber}` scenarios using `runByTagCommand` with tag `adw-{issueNumber}`
    - Writes combined results to `{proofDir}/scenario_proof.md` as a structured markdown file with sections for each run
    - Returns `ScenarioProofResult`
  - Function `shouldRunScenarioProof(scenariosMd: string): boolean` — returns `true` when `.adw/scenarios.md` content is non-empty
- Export from `adws/agents/index.ts`

### Step 4: Update `ReviewRetryOptions` and `runReviewWithRetry`
- In `adws/agents/reviewRetry.ts`:
  - Add to `ReviewRetryOptions`:
    - `issueNumber: number`
    - `scenariosMd: string` — raw content of `.adw/scenarios.md`
    - `runCrucialCommand: string` — command to run `@crucial` scenarios
    - `runByTagCommand: string` — command template with `{tag}` placeholder
  - In `runReviewWithRetry`, at the top of each iteration (before launching parallel review agents):
    - Check `shouldRunScenarioProof(scenariosMd)`
    - If true: call `runCrucialScenarioProof(...)` with proofDir set to `agents/{adwId}/scenario_proof/`
    - Store the `ScenarioProofResult` for this iteration
    - If `@crucial` scenarios fail AND this is the last retry attempt: return with blockers immediately (scenarios are the source of truth)
  - Pass the `resultsFilePath` from `ScenarioProofResult` to each `runReviewAgent` call (add it as a new optional parameter)
  - Add `ScenarioProofResult` to `ReviewRetryResult` so the review phase can access scenario outcomes

### Step 5: Update `reviewAgent.ts` to pass scenario proof path
- In `adws/agents/reviewAgent.ts`:
  - Add an optional `scenarioProofPath?: string` parameter to `runReviewAgent`
  - Add it to `formatReviewArgs` — if provided, pass it as an additional argument after `applicationUrl`
  - This makes the scenario results file available to the `/review` slash command

### Step 6: Update `.claude/commands/review.md` for scenario-based proof
- Add a new variable: `scenarioProofPath: $5 if provided, otherwise empty`
- In the `Proof Requirements` section, add scenario-aware logic:
  - **If `scenarioProofPath` is provided and the file exists**: Read the scenario proof file. Use the scenario execution results as the primary proof. Classify `@crucial` failures as `blocker` issues. Classify non-crucial `@adw-{issueNumber}` failures as `tech-debt` issues. The `reviewSummary` should describe scenario pass/fail results.
  - **If `scenarioProofPath` is NOT provided**: Fall back to `.adw/review_proof.md` instructions (existing behaviour)
- Update the Instructions section to prioritise scenario proof when available:
  - Read the scenario proof markdown file
  - For each `@crucial` failure: create a `reviewIssue` with `issueSeverity: 'blocker'`, `issueDescription` describing the failing scenario, and `issueResolution` suggesting investigation
  - For each `@adw-{issueNumber}` non-crucial failure: create a `reviewIssue` with `issueSeverity: 'tech-debt'`
  - Still run type-check and lint as supplementary proof (these remain useful)
  - `reviewSummary` should describe: how many `@crucial` scenarios passed/failed, how many `@adw-{issueNumber}` scenarios passed/failed
  - `screenshots` array should contain the path to the scenario proof file as a proof artifact
- Maintain the existing fallback: if no scenario proof is provided, use the current `.adw/review_proof.md` instructions

### Step 7: Update `.adw/review_proof.md`
- Rewrite to describe scenario-based proof:
  - **Proof Type**: Primary proof is `@crucial` BDD scenario execution results. Supplementary checks: type-check (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`) and lint (`bun run lint`)
  - **Proof Format**: Scenario execution output is provided via a scenario proof file (path passed as argument). Review agents read and classify results.
  - **Classification rules**: `@crucial` failures = `blocker`, `@adw-{issueNumber}` non-crucial failures = `tech-debt`
  - **What NOT to Do**: Do NOT take browser screenshots. Do NOT start a dev server. Do NOT use code-diff as primary proof (scenario results are authoritative).
- Keep the proof attachment format (JSON output structure) the same

### Step 8: Update `executeReviewPhase` in `workflowCompletion.ts`
- Pass the additional fields to `runReviewWithRetry`:
  - `issueNumber: config.issueNumber`
  - `scenariosMd: config.projectConfig.scenariosMd`
  - `runCrucialCommand: config.projectConfig.commands.runCrucialScenarios`
  - `runByTagCommand: config.projectConfig.commands.runScenariosByTag`
- The `WorkflowConfig` already carries `projectConfig` with all needed fields, so no type changes needed

### Step 9: Export new types and functions from barrel files
- Update `adws/agents/index.ts` to export:
  - `runScenariosByTag` from `./bddScenarioRunner`
  - `runCrucialScenarioProof`, `shouldRunScenarioProof`, `ScenarioProofResult` from `./crucialScenarioProof`

### Step 10: Validate
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no type errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws type checking
- Run `bun run build` to verify no build errors

## Testing Strategy
### Unit Tests
Unit tests are disabled for this project (per `.adw/project.md`). Validation relies on type-checking, linting, and BDD scenarios.

### Edge Cases
- `.adw/scenarios.md` is absent → `scenariosMd` is empty string → `shouldRunScenarioProof` returns false → falls back to code-diff proof
- `@crucial` scenario command is `'N/A'` → `runScenariosByTag` returns passing result (graceful skip)
- No `@adw-{issueNumber}` scenarios exist → subprocess returns 0 (no scenarios matched) → treated as passing
- Both `@crucial` and `@adw-{issueNumber}` pass → review proof shows all green, `reviewIssues` is empty
- `@crucial` fails but `@adw-{issueNumber}` passes → blocker issues only
- `@crucial` passes but `@adw-{issueNumber}` fails → tech-debt issues only, review still passes (non-blocking)
- Review retry loop: `@crucial` fail → patch agent fixes code → re-run scenarios → pass on retry
- Scenario proof file directory doesn't exist → create it before writing
- Scenario command produces very large output → truncate in proof file to prevent memory issues

## Acceptance Criteria
- Review phase runs `@crucial` scenarios once per iteration and reports pass/fail
- `@crucial` failures are reported as `blocker` review issues
- Current-issue scenario failures (non-crucial `@adw-{issueNumber}`) are reported as `tech-debt` review issues
- Review proof posted to PR is based on scenario output, not code diff
- Fallback to code-diff proof when `.adw/scenarios.md` is absent (empty `scenariosMd`)
- ADW's own `.adw/review_proof.md` is updated to reflect the new scenario-based approach
- Type checking passes with no errors
- Linting passes with no errors
- Build completes successfully

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Verify root-level type checking passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Verify adws-specific type checking passes
- `bun run build` — Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` file must be followed strictly. Key points: prefer pure functions, isolate side effects, use TypeScript strict mode, prefer declarative patterns, keep files under 300 lines.
- The existing `runBddScenarios` function in `bddScenarioRunner.ts` uses `{issueNumber}` replacement. The new `runScenariosByTag` function uses `{tag}` replacement for generality — these are complementary, not conflicting.
- The review retry loop's patch-and-retry mechanism continues to work: if `@crucial` scenarios fail, the patch agent can attempt to fix the code, then scenarios re-run on the next iteration.
- The 3 parallel review agents all see the **same** scenario results (run once, shared via file), ensuring consistent proof across agents without wasting resources re-running scenarios 3 times.
- Scenario output can be large. The proof file should include stdout (truncated if over 10,000 characters) and the exit code for each run.
- This feature depends on #165 (Scenario Planner Agent) and #167 (BDD test infrastructure). Both are already merged.
