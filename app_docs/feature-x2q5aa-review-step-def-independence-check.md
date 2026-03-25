# Review Phase: Step Definition Independence Check

**ADW ID:** x2q5aa-review-phase-step-de
**Date:** 2026-03-25
**Specification:** specs/issue-307-adw-yxq5og-review-phase-step-de-sdlc_planner-step-def-independence-check.md

## Overview

Adds a Step 5 independence check to `.claude/commands/review.md` that instructs the review agent to verify that generated step definitions test behavior through public interfaces rather than tautologically asserting what the build agent wrote. This prevents accommodating step definitions from silently passing the review phase even though they provide no real quality assurance.

## What Was Built

- **BDD feature file** (`features/review_step_def_independence.feature`) — 13 scenarios validating that `review.md` contains the independence check instructions, tagged `@adw-307` and `@regression`
- **Step definitions** (`features/step_definitions/reviewStepDefIndependenceSteps.ts`) — 236-line Cucumber step definition file implementing all scenario assertions by reading and inspecting the `review.md` file content
- **Patch specs** — Two patch specs (`specs/patch/patch-adw-x2q5aa-apply-step5-review-md.md`, `specs/patch/patch-adw-x2q5aa-insert-step5-review-md.md`) detailing the exact `review.md` content to insert

## Technical Implementation

### Files Modified

- `features/review_step_def_independence.feature`: New BDD feature file with 13 scenarios covering section presence, skip guards, anti-pattern detection, and severity classification
- `features/step_definitions/reviewStepDefIndependenceSteps.ts`: New step definitions that verify `review.md` content by reading the file and asserting on specific keywords and structural positions
- `specs/patch/patch-adw-x2q5aa-apply-step5-review-md.md`: Patch spec defining the exact Step 5 section to insert into `review.md`
- `specs/patch/patch-adw-x2q5aa-insert-step5-review-md.md`: Revised patch spec for applying Step 5 after the tag fix

### Key Changes

- **New Step 5 section** to be inserted into `review.md` between Step 4 (Coding Guidelines Check) and `## Issue Severity Reference` — instructs the review agent to detect and flag step definition anti-patterns
- **Three anti-patterns** evaluated per step definition:
  1. **Internal assertion** (`tech-debt`) — step def imports/references unexported implementation internals
  2. **Tautological pass** (`blocker`) — assertion passes regardless of whether the intended behavior works
  3. **Structural mirroring** (`tech-debt`) — step def logic mirrors implementation structure rather than observable output
- **Guard clauses** skip the check when `.adw/scenarios.md` is absent, no step definitions are in the branch diff, or no `@adw-{issueNumber}` feature files exist
- **Severity mapping**: tautological pass → `blocker`; internal assertion and structural mirroring → `tech-debt`

### Step 5 Content (from patch spec)

```markdown
## Step 5: Step Definition Independence Check

Verify that step definitions generated during the build phase test behavior through public interfaces
rather than tautologically asserting what the build agent wrote.

### Guard Clauses — Skip this step if either condition is true:
- **No scenarios.md**: If `.adw/scenarios.md` is absent from the target repository, skip this step entirely
- **No step definitions in diff**: If `git diff origin/<default> --name-only` contains no files in the
  step definitions directory, skip this step entirely
- **No tagged feature files**: If no `.feature` files with `@adw-{issueNumber}` tags exist, skip this step

### Read Step Definitions and Implementation Code
- Read the step definition files changed in the current branch
- Read the corresponding `.feature` files for context on the scenario's behavioral intent
- Read the implementation source files changed in the branch diff (non-test, non-step-definition files)

### Evaluate Independence — Flag Anti-Patterns

1. **Internal assertion** (`tech-debt`) — imports/references unexported implementation internals
2. **Tautological pass** (`blocker`) — assertion guaranteed to pass regardless of behavior
3. **Structural mirroring** (`tech-debt`) — logic mirrors implementation structure rather than observable output

### Report Violations
- Add each violation as a `reviewIssue` with appropriate severity
- Include: step definition file, scenario name, specific assertion
```

## How to Use

The check runs automatically as part of the `/review` slash command whenever:

1. The target repository has `.adw/scenarios.md`
2. The branch diff includes step definition file changes
3. `.feature` files tagged `@adw-{issueNumber}` exist

The review agent evaluates each changed step definition and emits `reviewIssue` entries for any anti-patterns detected. Tautological pass violations block the review (`blocker`); internal coupling and structural mirroring emit warnings (`tech-debt`).

## Configuration

No new configuration required. The check respects the existing `.adw/scenarios.md` presence as its primary guard.

## Testing

Run the new scenarios and regression suite:

```bash
# New scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-yxq5og-review-phase-step-de"

# Regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- This is primarily a prompt change to `review.md`; the independence check is performed by the LLM review agent reading the instructions, not by TypeScript orchestration code.
- The three anti-patterns (internal assertion, tautological pass, structural mirroring) align with the ADW coding guideline that "agent-written unit tests are unreliable as quality gates."
- The `blocker` severity for tautological pass violations is intentional — a test that always passes provides zero quality assurance.
- The check was validated by BDD scenarios that inspect `review.md` for the presence and ordering of the independence check section and its specific keyword markers.
