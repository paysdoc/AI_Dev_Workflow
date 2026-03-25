# Patch: Insert Step 5 into review.md

## Metadata
adwId: `x2q5aa-review-phase-step-de`
reviewChangeRequest: `specs/issue-307-adw-yxq5og-review-phase-step-de-sdlc_planner-step-def-independence-check.md`

## Issue Summary
**Original Spec:** specs/issue-307-adw-yxq5og-review-phase-step-de-sdlc_planner-step-def-independence-check.md
**Issue:** `.claude/commands/review.md` was not modified. The spec requires a "Step 5: Step Definition Independence Check" section between Step 4 (Coding Guidelines Check) and the Issue Severity Reference section. The file is identical to origin/dev. Two prior patch specs acknowledged this gap but were never applied.
**Solution:** Insert the Step 5 section into `.claude/commands/review.md` between Step 4 and `## Issue Severity Reference`, using the content defined in `specs/patch/patch-adw-x2q5aa-apply-step5-review-md.md`.

## Files to Modify
Use these files to implement the patch:

- `.claude/commands/review.md` — Insert new `## Step 5: Step Definition Independence Check` section (line 64, between Step 4 and Issue Severity Reference)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Insert Step 5 section into review.md
- Open `.claude/commands/review.md`
- Locate the end of `## Step 4: Coding Guidelines Check` — the last line is `- Report violations as \`tech-debt\` reviewIssues with the specific guideline and file/line location`
- Insert the following markdown block **after** that line and **before** `## Issue Severity Reference`:

```markdown

## Step 5: Step Definition Independence Check

Verify that step definitions generated during the build phase test behavior through public interfaces rather than tautologically asserting what the build agent wrote.

### Guard Clauses — Skip this step if either condition is true:
- **No scenarios.md**: If `.adw/scenarios.md` is absent from the target repository, skip this step entirely
- **No step definitions in diff**: If `git diff origin/<default> --name-only` contains no files in the step definitions directory, skip this step entirely
- **No tagged feature files**: If no `.feature` files with `@adw-{issueNumber}` tags exist, skip this step

### Read Step Definitions and Implementation Code
- Read the step definition files changed in the current branch (`git diff origin/<default> --name-only` filtered to the step_definitions directory)
- Read the corresponding `.feature` files for context on the scenario's behavioral intent
- Read the implementation source files changed in the branch diff (non-test, non-step-definition files)

### Evaluate Independence — Flag Anti-Patterns

For each step definition, check for these three anti-patterns by comparing the step definition code against the implementation code and the scenario's behavioral specification:

1. **Internal assertion** (`tech-debt`) — The step definition imports or directly references implementation internals (private functions, internal modules, unexported helpers) rather than exercising public interfaces. Flag step definitions that assert on implementation internals rather than observable behavior, and describe which internal is being asserted on. Internal coupling makes tests brittle but they still provide some verification value.

2. **Tautological pass** (`blocker`) — The step definition asserts on a value that is hardcoded or guaranteed to match regardless of whether the intended behavior works (e.g., asserting that a function returns the exact value it was stubbed to return, or asserting on a constant). Flag step definitions that would pass regardless of whether the intended behavior works, and explain why the assertion is tautological. Tautological assertions provide no verification value and must be rewritten.

3. **Structural mirroring** (`tech-debt`) — The step definition's logic closely mirrors the implementation structure (e.g., repeating the same sequence of calls as the implementation rather than testing the observable output). Flag step definitions that mirror the implementation structure rather than the scenario's behavioral specification, and contrast the step definition with the scenario intent.

Public interface assertions are those that:
- Call exported functions, methods, or API endpoints
- Assert on return values, output, or externally visible state
- Do not reach into private methods, internal variables, or module internals

### Report Violations
- Add each violation as a `reviewIssue` with the appropriate severity (`blocker` for tautological pass, `tech-debt` for internal assertion and structural mirroring)
- Each reviewIssue should include the step definition file, the scenario name, and the specific assertion that violates independence
```

### Step 2: Verify the insertion
- Read `.claude/commands/review.md` after the edit
- Confirm `## Step 5: Step Definition Independence Check` appears between `## Step 4: Coding Guidelines Check` and `## Issue Severity Reference`
- Confirm no duplicate or misplaced sections

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx tsc --noEmit` — TypeScript type check (root config)
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check (adws config)
- `bun run lint` — Lint check
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-307"` — Run feature scenarios (must pass, not 0 scenarios)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression scenarios to verify zero regressions

## Patch Scope
**Lines of code to change:** ~35 lines added to `.claude/commands/review.md`
**Risk level:** low
**Testing required:** BDD scenarios tagged `@adw-307` must pass; regression scenarios must remain green
