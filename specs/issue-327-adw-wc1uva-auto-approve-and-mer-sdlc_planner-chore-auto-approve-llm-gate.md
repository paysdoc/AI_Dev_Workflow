# Feature: Auto-approve and merge chore PRs with LLM diff gate

## Metadata
issueNumber: `327`
adwId: `wc1uva-auto-approve-and-mer`
issueJson: `{"number":327,"title":"Auto-approve and merge chore PRs with LLM diff gate","body":"## Summary\n\nChore PRs currently stop after plan + build + PR creation and wait for human review. Since chores are defined as config-only, documentation-only, dependency bumps, or CI/CD changes with no application logic impact, they should auto-approve and auto-merge — with a safety gate.\n\n## Design\n\n### New orchestrator: `adwChore.tsx`\n\nDedicated chore pipeline that replaces `adwPlanBuild.tsx` for `/chore` issue types:\n\n```\ninstall → plan → build → PR\n  → diffEvaluator (Haiku, structured JSON)\n  → post verdict comment to issue\n  → if \"safe\":       auto-approve + auto-merge\n  → if \"regression_possible\":\n      post escalation comment to issue\n      → test → review (with @regression proof) → document\n      → auto-approve + auto-merge\n```\n\n### New agent: `diffEvaluatorAgent.ts`\n\nLLM-based diff evaluation using **Haiku** (binary classification on small diffs). Returns structured JSON:\n\n```json\n{\n  \"verdict\": \"safe | regression_possible\",\n  \"reason\": \"one-line explanation\"\n}\n```\n\n**Safe (auto-merge):**\n- Documentation-only changes (`.md`, comments)\n- CI/CD pipeline changes (`.github/workflows/`, `.yml`)\n- Config file changes with no behavioral impact (`.eslintrc`, `.prettierrc`, `.gitignore`)\n- Dependency version bumps with no code changes\n- Renaming/reorganizing files with no logic changes\n\n**Regression possible (escalate to full SDLC):**\n- Any change to application source code (`.ts`, `.tsx`, `.js`, etc.)\n- Changes to test files (implies something behavioral changed)\n- Config changes that alter build output or runtime behavior (`tsconfig.json` compiler options, `package.json` scripts)\n- Any new exports, changed function signatures, or modified control flow\n\n### New phase: `diffEvaluationPhase.ts`\n\nRuns the diff evaluator agent, posts the verdict + reason as a comment on the issue (audit trail), and returns the verdict to the orchestrator for branching.\n\n### Routing change: `issueRouting.ts`\n\n- `/chore` → `adws/adwChore.tsx` (currently routes to `adwPlanBuild.tsx`)\n- `/pr_review` stays on `adwPlanBuild.tsx` — must never auto-merge\n\n### Model mapping changes\n\n- Add diff evaluator slash command to Haiku tier\n- Move `/ubiquitous-language` to Haiku tier\n\n### What this does NOT include\n\n- No scenario writer or plan-scenario alignment on the chore path\n- No KPI tracking on the chore path\n- No changes to `adwPlanBuild.tsx`\n\n## Rationale\n\n- The `/chore` classifier prompt is already strict (config-only, docs-only, dep bumps, CI/CD — no application logic)\n- But the build agent could drift beyond the issue description, so a post-build LLM diff gate catches regressions\n- When regression is detected, the full SDLC escalation (test + review with `@regression` proof + document) provides comprehensive safety\n- Dedicated orchestrator avoids contaminating `/pr_review` routing through `adwPlanBuild.tsx`","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T08:17:49Z","comments":[],"actionableComment":null}`

## Feature Description
Chore PRs currently stop after plan + build + PR creation and wait for human review. Since chores are defined as config-only, documentation-only, dependency bumps, or CI/CD changes with no application logic impact, they should auto-approve and auto-merge — with an LLM-based safety gate that evaluates the diff to catch regressions.

This feature introduces a dedicated chore orchestrator (`adwChore.tsx`) with a branching pipeline: after plan + build + PR, an LLM diff evaluator (Haiku) classifies the diff as "safe" or "regression_possible". Safe diffs auto-merge immediately. Regression-possible diffs escalate through test → review → document → auto-merge.

## User Story
As an ADW operator
I want chore PRs to auto-approve and auto-merge after an LLM verifies the diff is safe
So that low-risk maintenance changes ship without manual review bottlenecks

## Problem Statement
Chore issues (config-only, docs-only, dependency bumps, CI/CD changes) currently route to `adwPlanBuild.tsx` which stops after PR creation, requiring manual human review. This creates unnecessary bottlenecks for low-risk changes that by definition have no application logic impact. However, the build agent could drift beyond the issue description, so blindly auto-merging without validation is unsafe.

## Solution Statement
Create a dedicated chore orchestrator (`adwChore.tsx`) with a post-build LLM diff gate. A new `diffEvaluatorAgent` uses Haiku to classify the git diff as "safe" (auto-merge) or "regression_possible" (escalate to full test → review → document pipeline). The verdict is posted as an audit comment on the issue. The routing in `issueRouting.ts` is updated so `/chore` issues flow through this new orchestrator instead of `adwPlanBuild.tsx`.

## Relevant Files
Use these files to implement the feature:

- `adws/types/issueRouting.ts` — Contains `issueTypeToOrchestratorMap` where `/chore` routing must change from `adwPlanBuild.tsx` to `adwChore.tsx`
- `adws/types/issueTypes.ts` — Contains `SlashCommand` union type where `/diff_evaluator` must be added; also re-exports routing maps
- `adws/core/modelRouting.ts` — Contains `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST` where `/diff_evaluator` must be added (Haiku tier)
- `adws/core/constants.ts` — Contains `OrchestratorId` enum where `Chore` must be added
- `adws/core/workflowMapping.ts` — Resolves orchestrator scripts; no changes needed but must verify new routing works
- `adws/adwPlanBuild.tsx` — Existing orchestrator used as template for new `adwChore.tsx`; NOT modified
- `adws/adwSdlc.tsx` — Full SDLC orchestrator showing review + document + auto-merge pattern to follow for escalation path
- `adws/adwPlanBuildTestReview.tsx` — Shows how auto-merge phase is composed with test + review phases
- `adws/agents/commandAgent.ts` — Generic `runCommandAgent<T>()` pattern for new diff evaluator agent
- `adws/agents/index.ts` — Agent exports barrel where new agent must be registered
- `adws/phases/autoMergePhase.ts` — Existing auto-merge phase used directly in chore orchestrator
- `adws/phases/index.ts` — Phase exports barrel where new phase must be registered
- `adws/phases/phaseCommentHelpers.ts` — `postIssueStageComment()` for posting verdict comments
- `adws/workflowPhases.ts` — Workflow phases re-export barrel where new phase must be added
- `adws/core/phaseRunner.ts` — `CostTracker`, `runPhase`, `PhaseResult` used by orchestrators
- `adws/phases/workflowInit.ts` — `WorkflowConfig` type and `initializeWorkflow` function
- `adws/phases/workflowCompletion.ts` — `completeWorkflow`, `handleWorkflowError`
- `adws/README.md` — Must be updated with new `adwChore.tsx` orchestrator documentation
- `README.md` — Project structure section must list the new files
- `guidelines/coding_guidelines.md` — Coding conventions to follow
- `app_docs/feature-fvzdz7-auto-approve-merge-after-review.md` — Reference for auto-merge phase integration pattern
- `app_docs/feature-u8okxe-bug-sdlc-chore-classifier.md` — Reference for issue type routing changes

### New Files
- `adws/adwChore.tsx` — Dedicated chore orchestrator with LLM diff gate and branching pipeline
- `adws/agents/diffEvaluatorAgent.ts` — LLM-based diff evaluation agent using Haiku for binary classification
- `adws/phases/diffEvaluationPhase.ts` — Phase that runs the diff evaluator, posts verdict comment, returns verdict
- `.claude/commands/diff_evaluator.md` — Slash command prompt for the diff evaluator agent

## Implementation Plan
### Phase 1: Foundation
Add the new `/diff_evaluator` slash command to the type system and model routing maps. Add the `Chore` orchestrator ID to the constants. This establishes the infrastructure before any new files are created.

### Phase 2: Core Implementation
1. Create the `/diff_evaluator` slash command prompt (`.claude/commands/diff_evaluator.md`) that instructs the LLM to classify a git diff as "safe" or "regression_possible" with structured JSON output.
2. Create the diff evaluator agent (`diffEvaluatorAgent.ts`) using the `runCommandAgent<T>()` pattern, extracting the structured verdict from agent output.
3. Create the diff evaluation phase (`diffEvaluationPhase.ts`) that runs the agent, posts the verdict as an audit comment on the issue, and returns the verdict to the orchestrator.
4. Create the chore orchestrator (`adwChore.tsx`) with the branching pipeline:
   - Install → Plan → Build → Test → PR → Diff Evaluation
   - If safe: Auto-merge
   - If regression_possible: Escalation comment → Review → Document → Auto-merge

### Phase 3: Integration
1. Update `issueRouting.ts` to route `/chore` → `adws/adwChore.tsx`.
2. Register new exports in barrel files (`agents/index.ts`, `phases/index.ts`, `workflowPhases.ts`).
3. Update `README.md` and `adws/README.md` with new orchestrator documentation.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Add `/diff_evaluator` to SlashCommand type
- In `adws/types/issueTypes.ts`, add `'/diff_evaluator'` to the `SlashCommand` union type

### Step 2: Add `/diff_evaluator` to model/effort routing maps
- In `adws/core/modelRouting.ts`, add `/diff_evaluator` to all four maps:
  - `SLASH_COMMAND_MODEL_MAP`: `'/diff_evaluator': 'haiku'`
  - `SLASH_COMMAND_MODEL_MAP_FAST`: `'/diff_evaluator': 'haiku'`
  - `SLASH_COMMAND_EFFORT_MAP`: `'/diff_evaluator': 'low'`
  - `SLASH_COMMAND_EFFORT_MAP_FAST`: `'/diff_evaluator': 'low'`
- Also move `/ubiquitous-language` to Haiku tier as specified in the issue (note: `/ubiquitous-language` is not currently in the maps — this is a no-op since it's a Claude Code skill, not a slash command; skip if not present)

### Step 3: Add `Chore` to OrchestratorId constants
- In `adws/core/constants.ts`, add `Chore: 'chore-orchestrator'` to the `OrchestratorId` object

### Step 4: Create the diff evaluator slash command prompt
- Create `.claude/commands/diff_evaluator.md` with:
  - Instructions to analyze the git diff (from `git diff {defaultBranch}...HEAD`)
  - Classification rules for "safe" vs "regression_possible" (per issue specification)
  - Required JSON output format: `{ "verdict": "safe" | "regression_possible", "reason": "one-line explanation" }`
  - The command receives the diff and the issue context as arguments

### Step 5: Create the diff evaluator agent
- Create `adws/agents/diffEvaluatorAgent.ts` following the `commandAgent.ts` pattern:
  - Define a `DiffEvaluatorVerdict` type: `{ verdict: 'safe' | 'regression_possible'; reason: string }`
  - Implement `runDiffEvaluatorAgent()` using `runCommandAgent<DiffEvaluatorVerdict>()`
  - Pass the git diff as the command argument
  - Extract structured JSON from agent output using a `extractDiffVerdict()` function
- Export the agent from `adws/agents/index.ts`

### Step 6: Create the diff evaluation phase
- Create `adws/phases/diffEvaluationPhase.ts`:
  - Implement `executeDiffEvaluationPhase(config: WorkflowConfig)` returning `PhaseResult` extended with `verdict: 'safe' | 'regression_possible'`
  - Run the diff evaluator agent with the git diff (via `execSync` calling `git diff {defaultBranch}...HEAD` in the worktree)
  - Post the verdict + reason as an issue comment (audit trail) using `repoContext.issueTracker.commentOnIssue()`
  - If the agent fails or output is unparseable, default to `'regression_possible'` (fail-safe)
  - Return standard `PhaseResult` fields plus the `verdict`
- Export the phase from `adws/phases/index.ts` and `adws/workflowPhases.ts`

### Step 7: Create the chore orchestrator
- Create `adws/adwChore.tsx` following the `adwPlanBuild.tsx` pattern:
  - Parse arguments with `parseOrchestratorArguments()` (scriptName: `'adwChore.tsx'`)
  - Initialize with `initializeWorkflow()` using `OrchestratorId.Chore`
  - Run phases sequentially:
    1. `executeInstallPhase`
    2. `executePlanPhase`
    3. `executeBuildPhase`
    4. `executeTestPhase` (unit tests only, same as adwPlanBuild)
    5. `executePRPhase`
    6. `executeDiffEvaluationPhase`
  - Branch on the diff evaluation verdict:
    - If `'safe'`: run `executeAutoMergePhase` directly
    - If `'regression_possible'`: post escalation comment on issue, then run `executeReviewPhase` → `executeDocumentPhase` → `executeAutoMergePhase`
  - Call `completeWorkflow()` with appropriate metrics

### Step 8: Update routing — `/chore` → `adwChore.tsx`
- In `adws/types/issueRouting.ts`, change `issueTypeToOrchestratorMap['/chore']` from `'adws/adwPlanBuild.tsx'` to `'adws/adwChore.tsx'`

### Step 9: Update adws/README.md
- Add `adwChore.tsx` to the orchestrator documentation:
  - Usage: `bunx tsx adws/adwChore.tsx <issueNumber> [adw-id]`
  - Description: Dedicated chore pipeline with LLM diff gate
  - Phases: install → plan → build → test → PR → diff evaluation → (auto-merge | escalation → review → document → auto-merge)
- Update the "Workflow selection" table in the trigger section to show `/chore` → `adwChore.tsx`

### Step 10: Update README.md project structure
- Add `adwChore.tsx` to the orchestrators list in the project structure section
- Add `diffEvaluatorAgent.ts` to the agents list
- Add `diffEvaluationPhase.ts` to the phases list
- Add `diff_evaluator.md` to the commands list

### Step 11: Validate
- Run `bun run lint` to check for linting errors
- Run `bun run build` to verify TypeScript compilation
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify type checking passes

## Testing Strategy

### Edge Cases
- Diff evaluator agent fails or returns unparseable output → default to `'regression_possible'` (fail-safe)
- Empty diff (no changes) → should be `'safe'` since there's nothing to regress
- Very large diff → Haiku should still be able to classify file extensions and patterns
- PR URL missing when auto-merge phase runs → existing guard in `executeAutoMergePhase` handles this gracefully
- Merge conflicts during auto-merge → existing `mergeWithConflictResolution()` handles retry with `/resolve_conflict` agent

## Acceptance Criteria
- `/chore` issues route to `adwChore.tsx` instead of `adwPlanBuild.tsx`
- Diff evaluator uses Haiku model tier with `low` reasoning effort
- Safe diffs (docs, CI/CD, config) auto-approve and auto-merge without human intervention
- Regression-possible diffs (source code changes, test changes) escalate through review + document before auto-merge
- Verdict is posted as an audit comment on the GitHub issue
- Unparseable diff evaluator output defaults to `'regression_possible'` (fail-safe)
- No changes to `adwPlanBuild.tsx`
- No scenario writer, plan-scenario alignment, or KPI tracking on the chore path
- TypeScript compiles cleanly with zero type errors
- Linter passes with no new errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root-level type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type checking

## Notes
- The `/ubiquitous-language` model tier change mentioned in the issue is a no-op: `/ubiquitous-language` is a Claude Code skill invoked via `SKILL.md`, not a slash command in the `SlashCommand` type or model routing maps. It does not appear in `SLASH_COMMAND_MODEL_MAP`.
- `adwPlanBuild.tsx` is NOT modified — `/pr_review` still routes through it unchanged.
- The escalation path in the chore orchestrator reuses existing phases (`executeReviewPhase`, `executeDocumentPhase`, `executeAutoMergePhase`) with no modifications.
- The diff evaluator defaults to `'regression_possible'` on any error — this is a deliberate fail-safe to prevent unsafe auto-merges.
- The chore orchestrator does not include scenario writing, plan-scenario alignment, or KPI tracking — these are explicitly out of scope per the issue specification.
- Follow the coding guidelines: files under 300 lines, single responsibility, strict TypeScript, no `any`, no decorators.
