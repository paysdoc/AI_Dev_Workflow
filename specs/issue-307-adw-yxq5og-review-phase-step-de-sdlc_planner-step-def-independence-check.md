# Feature: Review phase step definition independence check

## Metadata
issueNumber: `307`
adwId: `yxq5og-review-phase-step-de`
issueJson: `{"number":307,"title":"Review phase step definition independence check","body":"## Parent PRD\n\n`specs/prd/tdd-bdd-integration.md`\n\n## What to build\n\nAdd a step definition independence verification to the review phase. Since the build agent now generates both step definitions and implementation code during its TDD loop, the review phase must verify that step definitions actually test behavior through public interfaces rather than tautologically asserting what the build agent wrote.\n\nUpdate `review.md` to include this verification as part of the review agent's responsibilities. The check should evaluate each step definition and flag any that:\n- Assert on implementation internals rather than observable behavior\n- Would pass regardless of whether the intended behavior works\n- Mirror the implementation structure rather than the scenario's behavioral specification\n\nSee PRD section: \"Review phase addition\" for full details.\n\n## Acceptance criteria\n\n- [ ] `review.md` includes step definition independence verification instructions\n- [ ] The review agent checks whether step definitions test behavior through public interfaces\n- [ ] The review agent flags accommodating/tautological step definitions as issues\n- [ ] Independence violations are classified with appropriate severity (blocker or tech-debt)\n- [ ] The check does not trigger when no step definitions exist (e.g., projects without BDD scenarios)\n- [ ] Existing BDD regression scenarios continue to pass\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 5","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T13:49:29Z","comments":[],"actionableComment":null}`

## Feature Description
Add a step definition independence verification step to the review phase slash command (`review.md`). The build agent generates both step definitions and implementation code during its TDD loop, which creates a risk that step definitions tautologically assert what the build agent wrote rather than testing actual behavior through public interfaces. The review agent must verify that step definitions are genuinely independent of the implementation they test.

## User Story
As a development team using ADW
I want the review phase to verify that generated step definitions test behavior through public interfaces
So that BDD scenarios catch real bugs rather than just confirming what the build agent implemented

## Problem Statement
When the build agent generates both step definitions and implementation code in a single TDD loop, there is a structural risk that step definitions become "accommodating" — they may directly import implementation internals, mirror the implementation structure, or assert on values that are guaranteed to pass regardless of whether the intended behavior actually works. This undermines the value of BDD scenarios as an independent quality gate.

## Solution Statement
Add a new "Step Definition Independence Check" section to `review.md` that instructs the review agent to:
1. Detect whether step definitions exist for the current issue (skip if none exist)
2. Read both the step definitions and the implementation code they exercise
3. Evaluate each step definition against three independence criteria (no internal assertions, no tautological passes, no structural mirroring)
4. Flag violations as `blocker` (tautological/always-pass) or `tech-debt` (internal coupling) severity review issues

This is a prompt-only change to the review slash command — no TypeScript code changes are needed in the orchestration layer.

## Relevant Files
Use these files to implement the feature:

- `.claude/commands/review.md` — The review slash command that will receive the new step definition independence check section. This is the primary file to modify.
- `guidelines/coding_guidelines.md` — Contains the coding guidelines including the testing principle that agent-written unit tests are unreliable as quality gates. Provides context for why this independence check matters.
- `.adw/review_proof.md` — Review proof configuration showing current tag strategy. Context for understanding the review flow.
- `app_docs/feature-ex60ng-step-def-gen-review-gating.md` — Documentation of the step definition generation feature. Context for understanding how step definitions are generated.
- `app_docs/feature-9k4ut2-machine-readable-review-proof.md` — Documentation of the machine-readable review proof system. Context for understanding how the review agent reads proof configuration.
- `.claude/commands/generate_step_definitions.md` — The step definition generation command. Context for understanding what step definitions look like and how they are produced.
- `features/step_def_generation_review_gating.feature` — Existing BDD scenarios for step definition generation and review gating. Must continue to pass.

### New Files
- `features/review_step_def_independence.feature` — BDD scenarios validating the new step definition independence check in `review.md`
- `features/step_definitions/reviewStepDefIndependenceSteps.ts` — Step definitions for the new BDD scenarios

## Implementation Plan
### Phase 1: Foundation
Understand the existing review flow, step definition generation process, and how the review agent currently evaluates code. Read the review.md command structure and identify where the new check fits in the step sequence (after the existing coding guidelines check in Step 4, as a new Step 5).

### Phase 2: Core Implementation
Add the step definition independence verification section to `review.md` as a new step between the existing coding guidelines check (Step 4) and the Report section. The new step must:
- Detect whether step definition files exist for the current issue's `@adw-{issueNumber}` scenarios
- Skip the check entirely when no step definitions or no tagged scenarios exist
- Read both the step definitions and the implementation diff to compare them
- Evaluate three independence anti-patterns: internal assertions, tautological passes, structural mirroring
- Classify violations by severity: `blocker` for tautological/always-pass patterns, `tech-debt` for internal coupling

### Phase 3: Integration
Write BDD scenarios that verify the `review.md` file contains the independence check instructions and that the check conditions are correct (skip when no step defs, classify violations correctly). Ensure all existing regression scenarios continue to pass.

## Step by Step Tasks

### Task 1: Read and understand the current review.md structure
- Read `.claude/commands/review.md` in full
- Read `.claude/commands/generate_step_definitions.md` to understand step definition format
- Read `app_docs/feature-ex60ng-step-def-gen-review-gating.md` for context
- Identify the insertion point for the new step (after Step 4: Coding Guidelines Check)

### Task 2: Add step definition independence check to review.md
- Add a new `## Step 5: Step Definition Independence Check` section to `review.md`
- Insert it between the current Step 4 (Coding Guidelines Check) and the Issue Severity Reference section
- The section must include:
  - **Guard clause**: Check if step definition files exist in the scenario directory. If no step definitions exist (e.g., the project has no BDD scenarios or the step def gen phase was skipped), skip this step entirely.
  - **Guard clause**: Check if any `.feature` files with `@adw-{issueNumber}` tags exist. If none exist, skip this step.
  - **Read step definitions**: Read the step definition files that were generated or modified for this issue (files changed in the branch diff that are in the step definitions directory)
  - **Read implementation code**: Read the implementation source files changed in the branch diff (non-test, non-step-definition files)
  - **Evaluate independence criteria**: For each step definition, check three anti-patterns:
    1. **Internal assertion** — The step definition imports or directly references implementation internals (private functions, internal modules, unexported helpers) rather than exercising public interfaces. Severity: `tech-debt`
    2. **Tautological pass** — The step definition asserts on a value that is hardcoded or guaranteed to match regardless of whether the intended behavior works (e.g., asserting that a function returns the exact value it was stubbed to return, or asserting on a constant). Severity: `blocker`
    3. **Structural mirroring** — The step definition's logic closely mirrors the implementation structure (e.g., repeating the same sequence of calls as the implementation rather than testing the observable output). Severity: `tech-debt`
  - **Report violations**: Add each violation as a `reviewIssue` with the appropriate severity, describing which step definition is affected, which anti-pattern was detected, and how to fix it

### Task 3: Write BDD feature file for the independence check
- Create `features/review_step_def_independence.feature`
- Tag all scenarios with `@adw-307`
- Tag regression-worthy scenarios with `@regression`
- Include scenarios for:
  - `review.md` contains a step definition independence check section
  - The check instructs skipping when no step definitions exist
  - The check instructs skipping when no `@adw-{issueNumber}` feature files exist
  - The check evaluates internal assertion anti-pattern
  - The check evaluates tautological pass anti-pattern
  - The check evaluates structural mirroring anti-pattern
  - Internal assertion violations are classified as `tech-debt`
  - Tautological pass violations are classified as `blocker`
  - Structural mirroring violations are classified as `tech-debt`

### Task 4: Write step definitions for the BDD scenarios
- Create `features/step_definitions/reviewStepDefIndependenceSteps.ts`
- Implement step definitions that read `review.md` and verify the presence and content of the independence check section
- Use file-scanning patterns consistent with existing step definitions (see `features/step_definitions/stepDefGenReviewGatingSteps.ts` for patterns)

### Task 5: Run validation commands
- Run `bunx tsc --noEmit` to verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for ADW-specific type check
- Run `bun run lint` to verify linting passes
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-307"` to verify the new scenarios pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify existing regression scenarios still pass

## Testing Strategy

### Edge Cases
- No step definitions directory exists at all (project without BDD) — check must be skipped silently
- Step definitions exist but no `@adw-{issueNumber}` tagged feature files — check must be skipped
- Step definitions that import from the same package via public exports (should NOT be flagged)
- Step definitions that use `assert` on computed values from public function calls (should NOT be flagged)
- Step definitions that directly import internal helper functions not exported from the package index (should be flagged as `tech-debt`)

## Acceptance Criteria
- `review.md` contains a `Step 5: Step Definition Independence Check` section
- The check skips when no step definition files exist in the scenario directory
- The check skips when no `@adw-{issueNumber}` feature files exist
- The check evaluates step definitions against three anti-patterns: internal assertion, tautological pass, structural mirroring
- Tautological pass violations are classified as `blocker` severity
- Internal assertion and structural mirroring violations are classified as `tech-debt` severity
- Violations are reported as `reviewIssue` entries with description and resolution guidance
- All existing `@regression` tagged BDD scenarios continue to pass
- New BDD scenarios tagged `@adw-307` validate the independence check instructions

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — TypeScript type check (root config)
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check (adws config)
- `bun run lint` — Lint check
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-307"` — Run new feature scenarios
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression scenarios to verify zero regressions
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run` — Verify no undefined steps

## Notes
- This is primarily a prompt change to `review.md`, not a TypeScript orchestration change. The review agent (an LLM) reads these instructions and follows them during the review phase.
- The independence check is deliberately positioned after the coding guidelines check (Step 4) because it requires reading both implementation code and step definitions, which overlaps with the diff analysis already performed in earlier steps.
- The three anti-patterns (internal assertion, tautological pass, structural mirroring) are drawn from the issue description and align with the coding guidelines principle that "agent-written unit tests are unreliable as quality gates because an agent can write tests that always pass."
- No new libraries are required.
- The `blocker` severity for tautological pass violations is intentional — a test that always passes provides zero quality assurance and must be rewritten before the PR can proceed.
