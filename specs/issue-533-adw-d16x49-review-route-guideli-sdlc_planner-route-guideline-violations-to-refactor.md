# Feature: Route Coding Guideline Violations to /refactor via remediationStrategy

## Metadata
issueNumber: `533`
adwId: `d16x49-review-route-guideli`
issueJson: `{"number":533,"title":"review: route guideline violations to /refactor via remediationStrategy field","body":"...","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-02T14:22:07Z","comments":[],"actionableComment":null}`

## Feature Description
The passive judge review (`/review`) currently reports coding-guideline violations only as `tech-debt`, which the patch cycle silently logs and leaves on the branch. This feature makes guideline violations in **changed files** a blocker that is routed to `/refactor` (instead of `/patch`), so the automated SDLC and PR review pipelines enforce coding standards before a PR is approved — without operator intervention.

The routing is expressed via a new optional field `remediationStrategy: "refactor" | "patch"` on `ReviewIssue`. The reviewer emits one consolidated `blocker` with `remediationStrategy: "refactor"` summarising all violations across changed files, and `executeReviewPatchCycle` separates patch blockers (current behaviour) from refactor blockers (new path that invokes the `/refactor` skill on the affected files).

## User Story
As an ADW operator running the SDLC or PR-review pipeline,
I want coding-guideline violations in newly-changed files to block the review and be auto-corrected via the `/refactor` skill before the PR is approved,
So that merged code consistently honours `.adw/coding_guidelines.md` without me having to manually re-run a refactor pass.

## Problem Statement
- `review.md` Step 3 emits guideline violations as `tech-debt`, which are non-blocking and silently logged.
- There is no automated remediation path for guideline drift — operators must spot violations in PRs and ask for a refactor manually.
- Reviewers also flag pre-existing violations in untouched files, creating noisy reports the operator must filter mentally.
- The patch cycle has only one remediation route (`/patch`), so even if the reviewer flagged violations as blockers today, they would be sent to `/patch` (one-shot bug fix) rather than the dedicated `/refactor` skill, which is the right tool for systematic guideline application.

## Solution Statement
1. Extend the `ReviewIssue` type with an optional `remediationStrategy: "refactor" | "patch"` field (default `"patch"` when absent).
2. Update `review.md` Step 3 to:
   - Scope violations to **changed files only** (files in `git diff origin/<default>`).
   - Emit **one consolidated `blocker`** with `remediationStrategy: "refactor"` whose `issueDescription` lists the affected files and the rules they violate.
3. Refactor `executeReviewPatchCycle` to:
   - Split blockers into `patchBlockers` and `refactorBlockers`.
   - Run all `patchBlockers` first via the existing `patchAgent → buildAgent` loop.
   - If `refactorBlockers` are present, invoke a thin `refactorAgent` (`/refactor` slash command) once with the consolidated file list, then run `buildAgent`.
   - Commit and push after both passes complete (single commit per cycle, as today).
4. Update `pr_review.md` to mirror `review.md` Step 3 awareness so the planning prompt also flags guideline-violation files that should be refactored.
5. Register the `/refactor` slash command in the type, model, and effort routing maps so the existing slash-command plumbing covers the new agent.

The existing `MAX_REVIEW_RETRY_ATTEMPTS` cap on the orchestrator-level retry loop continues to prevent infinite loops — no additional guard is added.

## Relevant Files
Use these files to implement the feature:

- `adws/agents/reviewAgent.ts` — defines `ReviewIssue` and `reviewResultSchema`; both need the new optional field.
- `adws/agents/patchAgent.ts` — reference for the thin slash-command wrapper pattern that `refactorAgent.ts` will follow.
- `adws/agents/index.ts` — barrel export; needs to re-export the new agent.
- `adws/phases/reviewPhase.ts` — `executeReviewPatchCycle` is where the routing logic lives; the entire blocker loop needs restructuring.
- `adws/phases/prReviewPhase.ts` — no direct code change needed (the patch cycle is shared via `reviewPhase.ts`); referenced for context only and noted in `## Notes` below.
- `.claude/commands/review.md` — Step 3 (Coding Guidelines Check) and the JSON output schema example need updating.
- `.claude/commands/pr_review.md` — planning prompt; gets a coding-guidelines step mirroring the spirit of `review.md` Step 3 so plans for PR reviews include explicit refactor tasks for guideline-violation files.
- `.claude/skills/refactor/SKILL.md` — read-only; documents how `/refactor` consumes file-list args (used to validate the prompt format the new agent will produce).
- `adws/types/issueTypes.ts` — `SlashCommand` union must include `/refactor`.
- `adws/core/modelRouting.ts` — `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, and `SLASH_COMMAND_EFFORT_MAP_FAST` need entries for `/refactor`.
- `adws/agents/__tests__/` — location for the new unit test for `refactorAgent`.
- `adws/phases/__tests__/` — location for the new unit test for `executeReviewPatchCycle` routing logic.
- `.adw/coding_guidelines.md` — guidelines to honour in the implementation; in particular Nesting & Extraction and TypeScript Practices.
- `.adw/project.md` — confirms unit tests are enabled and lists relevant directories.
- `app_docs/feature-cudwfe-passive-judge-review-phase.md` — conditional docs: relevant when modifying `reviewPhase.ts` or the `/review` slash command.
- `app_docs/feature-1bg58c-scenario-test-fix-phases.md` — conditional docs: relevant when changing the review/scenario retry composition that `adwSdlc.tsx` and friends drive.

### New Files
- `adws/agents/refactorAgent.ts` — thin wrapper invoking `runClaudeAgentWithCommand('/refactor', ...)` that returns an `AgentResult`. Mirrors the structure of `patchAgent.ts`.
- `adws/agents/__tests__/refactorAgent.test.ts` — vitest unit test covering arg formatting and the model/effort lookup.
- `adws/phases/__tests__/reviewPhase.test.ts` — vitest unit test verifying `executeReviewPatchCycle` splits blockers by `remediationStrategy`, runs the patch loop and the refactor branch in the right order, and commits once at the end.

## Implementation Plan
### Phase 1: Foundation
Extend the type surface so the new field, agent, and slash command are first-class citizens before any caller code uses them.

- Add `remediationStrategy?: 'refactor' | 'patch'` to `ReviewIssue` in `adws/agents/reviewAgent.ts` and extend `reviewResultSchema` to permit the new field as an enum.
- Add `'/refactor'` to the `SlashCommand` union in `adws/types/issueTypes.ts`.
- Add `/refactor` entries to all four routing maps in `adws/core/modelRouting.ts` (`sonnet`/`high` is appropriate — `/refactor` performs targeted refactors that benefit from solid reasoning but are less open-ended than `/patch`).

### Phase 2: Core Implementation
Implement the new agent and update the review prompt/routing to use it.

- Create `adws/agents/refactorAgent.ts`: a single exported `runRefactorAgent(adwId, refactorBlocker, logsDir, statePath?, cwd?, issueBody?)` function that builds args from the consolidated blocker (passes `refactorBlocker.issueDescription` so the `/refactor` skill can extract the affected file paths) and invokes `runClaudeAgentWithCommand('/refactor', args, 'Refactor', outputFile, model, effort, undefined, statePath, cwd)`.
- Re-export `runRefactorAgent` from `adws/agents/index.ts`.
- Update `.claude/commands/review.md` Step 3:
  - Constrain the scan to files emitted by `git diff origin/<default> --name-only`.
  - Stop emitting per-violation `tech-debt` items; instead emit **one** consolidated `blocker` with `remediationStrategy: "refactor"` whose `issueDescription` lists each affected file and the rule(s) it violates, and whose `issueResolution` says "Run `/refactor` on the listed files".
  - Update the "Output Structure" JSON example to include the optional `remediationStrategy` field.
- Refactor `executeReviewPatchCycle` in `adws/phases/reviewPhase.ts`:
  - Compute `const patchBlockers = blockerIssues.filter(b => (b.remediationStrategy ?? 'patch') === 'patch')` and `const refactorBlockers = blockerIssues.filter(b => b.remediationStrategy === 'refactor')`.
  - Extract the existing per-blocker patch+build body into a private `applyPatchBlocker(blocker, deps): Promise<{costUsd, modelUsage}>` helper (keeps the loop body shallow per the nesting discipline guideline).
  - Loop `patchBlockers` calling `applyPatchBlocker` and accumulating cost/usage.
  - If `refactorBlockers.length > 0`, call a new private `applyRefactor(refactorBlockers, deps)` helper that invokes `runRefactorAgent` once (the reviewer is contracted to consolidate, but the helper handles `>1` defensively by passing all of them) and then runs `runBuildAgent`.
  - Keep the final `runCommitAgent` + `pushBranch` exactly where it is today — a single commit/push per cycle covers both branches.

### Phase 3: Integration
Update the PR-review planner prompt and verify the end-to-end change is wired through every consumer.

- Update `.claude/commands/pr_review.md`:
  - Add an instruction (in the `## Instructions` section) directing the planner to inspect `git diff origin/<default>` for files violating `.adw/coding_guidelines.md` and to include a final step in the generated plan that explicitly invokes `/refactor` on those files when violations exist. This mirrors the *spirit* of `review.md` Step 3 without changing the markdown-plan output shape of `pr_review.md`.
- Verify (by reading, no code change needed) that `adwSdlc.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, and `adwPrReview.tsx` all import `executeReviewPatchCycle` from `./phases` / `./workflowPhases` — they do today, so the routing change is picked up automatically by every orchestrator. Document the propagation in `## Notes` so the next reader does not duplicate work.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add `remediationStrategy` to `ReviewIssue`
- In `adws/agents/reviewAgent.ts`, extend the `ReviewIssue` interface with `remediationStrategy?: 'refactor' | 'patch'`.
- Extend `reviewResultSchema.properties.reviewIssues.items.properties` with `remediationStrategy: { type: 'string', enum: ['refactor', 'patch'] }`.
- Do NOT add `remediationStrategy` to the `required` array — it stays optional with implicit default `"patch"`.

### 2. Register `/refactor` in the slash-command type system
- In `adws/types/issueTypes.ts`, add `'/refactor'` to the `SlashCommand` union (under a `// Refactor` comment).
- In `adws/core/modelRouting.ts`, add `'/refactor': 'sonnet'` to both `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST`, and `'/refactor': 'high'` to both `SLASH_COMMAND_EFFORT_MAP` and `SLASH_COMMAND_EFFORT_MAP_FAST`.

### 3. Create the refactor agent
- Create `adws/agents/refactorAgent.ts`:
  - Imports: `runClaudeAgentWithCommand`, `AgentResult` from `./claudeAgent`; `getModelForCommand`, `getEffortForCommand`, `log` from `../core`; `ReviewIssue` from `./reviewAgent`.
  - Export `runRefactorAgent(adwId, refactorBlocker, logsDir, statePath?, cwd?, issueBody?): Promise<AgentResult>` following the structure of `runPatchAgent`.
  - The agent receives the consolidated refactor blocker and passes `refactorBlocker.issueDescription` (which the reviewer populates with the affected file paths and rules) as the args string. The `/refactor` skill's LLM extracts file paths from the description; passing the description preserves rule context for skill prompts that surface it.
  - Output file: `path.join(logsDir, 'refactor-agent.jsonl')`.
- Re-export `runRefactorAgent` from `adws/agents/index.ts`.

### 4. Update `review.md` Step 3
- Replace Step 3 with the following structure:
  - Read `.adw/coding_guidelines.md` (fall back to `guidelines/coding_guidelines.md`); if neither exists, skip.
  - Compute changed files via `git diff origin/<default> --name-only`.
  - Inspect ONLY those changed files for violations against the guidelines.
  - If any violations are found, emit a SINGLE `reviewIssue` with `issueSeverity: "blocker"` and `remediationStrategy: "refactor"`, whose `issueDescription` enumerates the affected files and the specific rules each violates (one line per file recommended for downstream parsing), and whose `issueResolution` reads "Run `/refactor` on the listed files".
  - If no violations are found, emit nothing for this step (no `tech-debt` placeholder).
- Update the "Output Structure" JSON example block to include the new optional `remediationStrategy` field on the example item.
- Add a one-line note under "Issue Severity Reference" describing what `remediationStrategy` is for and that it defaults to `"patch"` when omitted.

### 5. Refactor `executeReviewPatchCycle`
- In `adws/phases/reviewPhase.ts`, restructure `executeReviewPatchCycle`:
  - Split blockers into `patchBlockers` and `refactorBlockers` based on `remediationStrategy` (default `"patch"`).
  - Extract a private async helper `applyPatchBlocker(blocker, ctx): Promise<{costUsd, modelUsage}>` containing the existing per-blocker `runPatchAgent → runBuildAgent` sequence so the loop body in `executeReviewPatchCycle` stays at depth 1.
  - Loop `patchBlockers` (each calling `applyPatchBlocker` and merging cost/usage).
  - If `refactorBlockers.length > 0`, call a new private async helper `applyRefactor(blockers, ctx)` that invokes `runRefactorAgent` once (passing the **first** consolidated blocker — the reviewer is contracted to consolidate; defensively, if more than one is present, the helper logs a warning and processes each in sequence) and then runs `runBuildAgent`, merging cost/usage.
  - Keep `runCommitAgent` + `pushBranch` at the end (one commit/push per cycle, as today).
  - Update the `phaseCostRecords` `phase` label to `'reviewPatch'` (unchanged) — no breaking change.
- The function signature stays the same, so no orchestrator changes are required.

### 6. Update `pr_review.md` to mirror Step 3 awareness
- In `.claude/commands/pr_review.md`, add a bullet under `## Instructions` (immediately after the existing coding-guidelines bullet) directing the planner to:
  - Inspect `git diff origin/<default>` for files that violate `.adw/coding_guidelines.md`.
  - If any violations exist in changed files, append a final step to the generated plan titled "Apply coding guidelines via /refactor" whose body lists the affected files and instructs the implementer to run `/refactor` on them.
- This is intentionally lighter than `review.md` Step 3: `pr_review.md` produces a markdown plan (not JSON), so the awareness is expressed as a plan-step instruction rather than a structured blocker emission. The actual enforcement still happens later in the pipeline via `review.md` (passive judge) → `executeReviewPatchCycle`.

### 7. Add unit tests
- Create `adws/agents/__tests__/refactorAgent.test.ts`:
  - Mock `runClaudeAgentWithCommand` and verify `runRefactorAgent` calls it with `command = '/refactor'`, `args = refactorBlocker.issueDescription`, the correct output file name, and the model/effort returned by `getModelForCommand`/`getEffortForCommand`.
- Create `adws/phases/__tests__/reviewPhase.test.ts` (or add to an existing test file if one exists for the phases module):
  - Mock `runPatchAgent`, `runBuildAgent`, `runRefactorAgent`, `runCommitAgent`, `pushBranch`.
  - Case 1: only patch blockers → patchAgent called per blocker, refactorAgent NOT called, commit+push called once.
  - Case 2: only one refactor blocker → patchAgent NOT called, refactorAgent called once with that blocker, buildAgent called once, commit+push called once.
  - Case 3: mixed (patch + refactor) → patchAgents run before refactor, refactorAgent runs after all patches, commit+push called once at the end.
  - Case 4: blocker with no `remediationStrategy` defaults to `"patch"`.

### 8. Run the validation commands
- Execute every command in `## Validation Commands` below in the listed order and verify each exits with status 0.

## Testing Strategy
### Unit Tests
- `adws/agents/__tests__/refactorAgent.test.ts` — verifies the new thin wrapper invokes `/refactor` with the correct args, output-file path, model, and effort. Mocks `runClaudeAgentWithCommand` and `core` (model/effort lookups) following the pattern in `gitAgent.test.ts`.
- `adws/phases/__tests__/reviewPhase.test.ts` — verifies `executeReviewPatchCycle`:
  - Splits blockers correctly by `remediationStrategy` (default `"patch"` honoured when field is absent).
  - Runs all patch blockers first, in input order.
  - Runs the refactor branch exactly once after all patch blockers.
  - Calls `runCommitAgent` and `pushBranch` exactly once per cycle, after both branches.
  - Aggregates `costUsd` and `modelUsage` across patch+refactor paths.
  - Returns the cost record with the existing `'reviewPatch'` phase label.

### Edge Cases
- A blocker without `remediationStrategy` is treated as `"patch"` (default).
- An empty `blockerIssues` array still produces a commit (or skips entirely if the existing behaviour is to skip — verify in test).
- Multiple refactor blockers (defensive: reviewer is contracted to consolidate, but the helper still produces a single buildAgent pass).
- Patch blocker fails — existing behaviour (continue / log) is preserved.
- Refactor agent fails — the cycle still commits any patch changes that succeeded; the orchestrator-level retry cap (`MAX_REVIEW_RETRY_ATTEMPTS`) handles persistent refactor failures.
- No `.adw/coding_guidelines.md` present — Step 3 emits no refactor blocker, behaviour identical to today.
- Coding-guideline violation in an untouched file — Step 3 ignores it (scoped to `git diff` set).

## Acceptance Criteria
- `ReviewIssue` type includes optional `remediationStrategy: "refactor" | "patch"` (absent value treated as `"patch"`).
- `reviewResultSchema` permits `remediationStrategy` with the enum values; does not require it.
- `.claude/commands/review.md` Step 3 emits a single consolidated `blocker` with `remediationStrategy: "refactor"` only for guideline violations in files appearing in `git diff origin/<default>`.
- `.claude/commands/pr_review.md` `## Instructions` includes a directive to add a `/refactor` plan step for changed-file guideline violations.
- `executeReviewPatchCycle` runs all `patch` blockers first (each: `patchAgent` → `buildAgent`), then if `refactor` blockers exist runs a single `refactorAgent → buildAgent` pass, then commits and pushes exactly once.
- Pre-existing guideline violations in unchanged files do not become blockers.
- `/refactor` is registered in the `SlashCommand` union and all four routing maps.
- New unit tests (`refactorAgent.test.ts`, `reviewPhase.test.ts`) pass.
- `bunx tsc --noEmit` and `bun run lint` and the `Additional Type Checks` command pass without errors or warnings introduced by this change.
- The existing `MAX_REVIEW_RETRY_ATTEMPTS` cap is the only infinite-loop guard — no additional guard is introduced.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — make sure dependencies are present (no new packages are added by this feature).
- `bun run lint` — ESLint over the repo.
- `bunx tsc --noEmit` — root TypeScript type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the `## Additional Type Checks` command from `.adw/commands.md`.
- `bun run build` — production build.
- `bun run test:unit` — vitest run; must include the two new test files and produce zero failures.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — `## Run Regression Scenarios`; must report zero failures to confirm no behavioural regressions in the BDD suite.

## Notes
- `.adw/coding_guidelines.md` is the active guideline file. The implementation must honour, in particular: max-depth-2 nesting (extract `applyPatchBlocker`/`applyRefactor` helpers to keep `executeReviewPatchCycle` flat), avoid `any` (use the existing `ReviewIssue`, `ModelUsageMap`, `PhaseCostRecord` types), and the comment policy (no narration of what the code does — only why a non-obvious choice is made, e.g. the consolidated-blocker contract assumption in `applyRefactor`).
- No new library is required. `bun add <package>` is not invoked.
- `prReviewPhase.ts` is not directly modified. The PR-review orchestrator (`adwPrReview.tsx`) already calls `executeReviewPhase` and `executeReviewPatchCycle` from `reviewPhase.ts`, so the routing change applies to PR-review automatically. The issue body's mention of `prReviewPhase.ts` refers to the *flow*, not to direct edits in the file — calling this out so the implementer does not duplicate work.
- The `/refactor` skill recently changed to require an explicit file list and exit silently when no files are passed (see commits `c2a9200` and `4da4628`). The reviewer is therefore contracted to enumerate file paths in `issueDescription`; the new `runRefactorAgent` forwards that description verbatim so the skill's LLM has a clean, deterministic file list to act on.
- Infinite-loop protection: relies entirely on the existing `MAX_REVIEW_RETRY_ATTEMPTS` cap in each orchestrator's review retry loop (`adwSdlc.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPrReview.tsx`). If a refactor pass repeatedly fails to fix a violation, the cap exits the loop and the existing failure-handling path takes over — no new guard is added.
- The four orchestrators that import `executeReviewPatchCycle` pick up the new routing transparently because the function signature is unchanged.
- Future consideration (out of scope): if reviewer drift across runs produces multiple non-consolidated refactor blockers, `applyRefactor` already handles that case defensively by processing each in sequence; tightening the reviewer prompt later is the cleaner fix.
