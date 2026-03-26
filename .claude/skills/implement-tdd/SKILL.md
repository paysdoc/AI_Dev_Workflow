---
name: implement-tdd
description: Autonomous TDD build agent. Implements a plan using red-green-refactor with BDD scenarios as RED tests. Use when the build agent should drive implementation through existing .feature files tagged with the issue number.
target: true
---

# Implement with TDD

Follow the `Instructions` to implement the `Plan` using a red-green-refactor loop, then `Report` the completed work.

## Instructions

### 1. Read the Plan

Read the plan provided as input. The plan describes the work to implement — follow its tasks and relevant files exactly. Only read the files listed in the plan's `## Relevant Files` section. Trust the plan.

### 2. Identify RED Tests

Read `.adw/scenarios.md` to find the scenario directory and the command for running scenarios by tag. Read `.adw/commands.md` for the `## Run Scenarios by Tag` command if present.

Read all `.feature` files tagged with `@adw-{issueNumber}` (where `{issueNumber}` is the issue number from the plan or current branch). These BDD scenarios are your RED tests — they define the behaviors to implement.

Read any existing step definition files to understand what infrastructure is already in place. Step definitions may depend on test harness or mock infrastructure (see **Test Harness Awareness** below). Understand what runtime support is available before writing new step definitions.

If no `.feature` files tagged `@adw-{issueNumber}` exist, proceed with the plan implementation directly — the TDD loop applies only when BDD scenarios exist.

### 3. Red-Green-Refactor Loop

**Vertical slicing only.** Do NOT write all step definitions first and then all implementation. Work one scenario at a time.

```
WRONG (horizontal):
  RED:   step1, step2, step3, step4
  GREEN: impl1, impl2, impl3, impl4

RIGHT (vertical):
  RED → GREEN: step1 → impl1
  RED → GREEN: step2 → impl2
  ...
```

For each scenario, in order:

**RED — Write or complete step definitions**
- Write the step definitions needed for this scenario (or verify they already exist)
- Run the scenario to verify it fails: the test must be RED before you implement
- If the scenario already passes, skip to the next one

**GREEN — Implement to pass**
- Write the minimal code needed to make this scenario pass
- Run the scenario to verify it passes: the test must be GREEN before moving on
- Do not add code beyond what this scenario requires

**REFACTOR — Clean up**
- Once GREEN, look for duplication, shallow modules, and other candidates (see [refactoring.md](refactoring.md))
- Run the scenario after each refactor step to stay GREEN
- Never refactor while RED

Repeat for every scenario tagged with `@adw-{issueNumber}`.

If a scenario cannot be made to pass and the plan does not address it, add a `// TODO: scenario <name> could not be made to pass — <reason>` comment near the relevant step definition and move on.

### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section:
- If unit tests are **disabled** or the section is **absent**: skip unit tests entirely — only BDD scenarios drive the TDD loop.
- If unit tests are **enabled**: integrate unit tests as a first-class part of the red-green-refactor loop for each scenario.

**When unit tests are enabled — red-green-refactor per scenario:**

| phase    | activity                                          |
| -------- | ------------------------------------------------- |
| RED      | Write step definition + unit test                 |
| GREEN    | Implement code to pass both scenario and unit test |
| REFACTOR | Clean up while keeping both green                 |

**When unit tests are disabled or absent:**

| phase    | activity                              |
| -------- | ------------------------------------- |
| RED      | Write step definition                 |
| GREEN    | Implement code to pass scenario       |
| REFACTOR | Clean up while keeping scenario green |

**RED phase (when enabled):** Write the step definition AND a unit test alongside it, before implementation code (test-first). The unit test targets the specific function/module introduced for this scenario's vertical slice. Do NOT write all unit tests first then all implementation — unit tests are written as part of the vertical slice for each scenario, following the same principle as step definitions. Follow [tests.md](tests.md) for guidance on writing good unit tests. Follow [mocking.md](mocking.md) for guidance on mocking in unit tests.

**GREEN phase (when enabled):** The GREEN phase verifies that both the BDD scenario and unit tests pass. Implementation is considered GREEN only when both pass.

**REFACTOR phase (when enabled):** Clean up while keeping both the BDD scenario and unit test green.

**BDD scenarios are the independent proof layer** — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they carry accommodation risk. They supplement, not replace, BDD scenarios.

### 5. Verification Frequency

Use your judgement about when to run verification. You do not need to run tests after every single line of code. Verify at natural boundaries: after completing a step definition block, after writing enough implementation to plausibly pass a scenario, or when the plan task structure suggests a checkpoint.

### 6. Test Harness Awareness

Do NOT classify any scenario as "ungeneratable." The following mock infrastructure is available for step definitions that need runtime support:

- **Mock GitHub API server** (`test/mocks/github-api-server.ts`) — for scenarios involving GitHub API calls
- **Claude CLI stub** (`test/mocks/claude-cli-stub.ts`) — for scenarios involving Claude Code CLI interactions
- **Git remote mock** (`test/mocks/git-remote-mock.ts`) — for scenarios involving git remote operations
- **Fixture repo setup** (`test/fixtures/cli-tool/`) — for scenarios needing a real git-initialized working directory
- **Test harness** (`test/mocks/test-harness.ts`) — orchestrates all mock infrastructure

If the target repo does not have these paths, use whatever test infrastructure is available in that repo. The key principle: runtime-dependent scenarios are implementable — they just require appropriate mock setup in step definitions.

### 7. Design Guidance

- See [interface-design.md](interface-design.md) for designing testable interfaces
- See [deep-modules.md](deep-modules.md) for hiding complexity behind small interfaces
- See [mocking.md](mocking.md) for when and how to mock at system boundaries
- See [tests.md](tests.md) for good vs. bad test examples

## Plan

$ARGUMENTS

## Report

- Summarize the work completed in a concise bullet point list
- For each scenario: note whether RED→GREEN succeeded or if issues were flagged
- Report the files and total lines changed with `git diff --stat`
