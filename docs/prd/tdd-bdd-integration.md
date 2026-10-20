# PRD: TDD-BDD Integration for ADW Build Pipeline

## Problem Statement

ADW's build phase treats testing as an afterthought. The build agent runs `/implement` — a straight "read plan, write code" flow with no intermediate verification. Tests only run in a separate phase after the entire implementation is complete, meaning behavioral drift isn't caught until late in the pipeline when fixes are expensive in tokens.

The scenario pipeline compounds this: the scenario agent generates valuable BDD scenarios, the plan validation phase burns tokens comparing plan text against scenario text via LLM, and then the step definition agent removes the most valuable scenarios (those requiring runtime infrastructure) as "ungeneratable" — despite the recently built test harness providing exactly the mock infrastructure those scenarios need.

The result is a pipeline that spends significant tokens generating and validating test artifacts, throws away the most useful ones, and never uses the remaining ones to guide implementation. Testing and implementation are disconnected processes rather than a unified feedback loop.

## Solution

Integrate TDD principles into the ADW build phase so that BDD scenarios serve as the RED tests that drive implementation. The build agent follows a red-green-refactor loop: read a scenario, generate its step definition, verify it fails (RED), implement code to make it pass (GREEN), refactor. This makes testing an integral part of implementation rather than a separate phase.

Replace the multi-round plan validation loop with a single-pass alignment check after the parallel plan/scenario phase. Drop the separate step definition generation phase entirely — the build agent generates step definitions incrementally during its TDD loop. Add a step definition independence check in the review phase to catch accommodating tests.

When a project has unit tests enabled (`## Unit Tests: enabled` in `.adw/project.md`), the build agent also writes unit tests during the TDD loop, with BDD scenarios serving as the independent proof layer that catches any tests written to accommodate the implementation rather than verify behavior.

## User Stories

1. As an ADW operator, I want the build agent to use BDD scenarios as RED tests during implementation, so that behavioral drift is caught during build rather than in a separate test phase.

2. As an ADW operator, I want the build agent to generate step definitions incrementally during the TDD loop, so that I don't need a separate step definition generation phase that costs additional tokens.

3. As an ADW operator, I want the step definition generator to know about the test harness (mock GitHub API, Claude CLI stub, git remote mock, fixture repos), so that scenarios requiring runtime infrastructure are no longer removed as "ungeneratable."

4. As an ADW operator, I want the plan validation loop (validate -> resolve -> re-validate) replaced with a single-pass alignment check, so that plan-scenario alignment costs one agent invocation instead of up to N retry rounds.

5. As an ADW operator, I want the review phase to verify that step definitions test behavior through public interfaces rather than tautologically asserting what the build agent wrote, so that the independence between scenario specification and implementation is maintained.

6. As an ADW operator, I want the build agent to follow vertical slicing (one test -> one implementation -> repeat) rather than horizontal slicing (all tests -> all code), so that each behavior is verified before moving to the next.

7. As an ADW operator, I want the `/implement_tdd` skill to load TDD reference files (tests.md, mocking.md, interface-design.md, deep-modules.md, refactoring.md) on demand rather than inlining everything in the prompt, so that baseline token cost stays low and detailed guidance is only consumed when relevant.

8. As an ADW operator, I want the build agent to conditionally use `/implement_tdd` when BDD scenarios exist for the issue, and fall back to `/implement` when they don't, so that projects without BDD scenarios continue working unchanged.

9. As an ADW operator, I want the orchestrator pipeline to drop the separate `executeStepDefPhase` and replace `executePlanValidationPhase` with a lightweight alignment step, so that the pipeline has fewer agent spawns and lower total token cost.

10. As an ADW operator running a project with `## Unit Tests: enabled`, I want the build agent to write unit tests during the TDD loop alongside step definitions, so that I get finer-grained test coverage while BDD scenarios remain the independent proof layer.

11. As an ADW operator, I want the plan and scenario phases to continue running in parallel (as they do today), so that neither agent's output influences the other and maximum independence is preserved.

12. As an ADW operator, I want the single-pass alignment step to run after the parallel plan/scenario phase completes, so that the build agent receives coherent, non-contradictory inputs.

13. As an ADW operator, I want the `/implement_tdd` skill to instruct the agent to decide when to run scenarios based on the plan structure (e.g., after each task in the step-by-step tasks), so that verification frequency adapts to the complexity of the work rather than following a rigid per-scenario or per-batch rule.

14. As an ADW operator, I want the `/implement_tdd` skill to be a proper skill (not a command), so that it can reference multiple files and benefit from the skill system's modularity and `target: true` support.

## Implementation Decisions

### New `/implement_tdd` skill

- Lives in `.claude/skills/implement-tdd/` with `target: true` in frontmatter.
- `SKILL.md` contains the autonomous TDD build workflow as a meta-prompt template (same pattern as `/implement` — shapes how the agent works, plan content shapes what it builds).
- References the existing TDD reference files: `tests.md`, `mocking.md`, `interface-design.md`, `deep-modules.md`, `refactoring.md`. These files are copied into the skill directory (not symlinked) so they travel with `target: true`.
- The workflow instructs the build agent to:
  1. Read the plan and the `.feature` files tagged `@adw-{issueNumber}`.
  2. For each behavior/task: read or write the step definition (RED), verify it fails, implement code (GREEN), verify it passes, refactor if needed.
  3. When `## Unit Tests: enabled` in `.adw/project.md`, also write a unit test before implementing each behavior.
  4. Decide when to run scenarios based on plan task structure (not rigidly per-scenario).
  5. Report completed work with `git diff --stat`.
- The skill does NOT ask for user approval (unlike the interactive `/tdd` skill). The plan serves as the specification that the TDD skill normally gets from the user.

### Single-pass alignment (replaces plan validation)

- A new lightweight phase that runs once after the parallel plan + scenario phase completes.
- One agent reads both the plan and the scenario files, identifies conflicts, and resolves them in a single pass.
- No retry loop. If the agent can't resolve a conflict, it flags it in the plan as a warning for the build agent.
- The GitHub issue remains the source of truth for conflict resolution.
- Implemented as a new command/skill (e.g., `/align_plan_scenarios`) invoked by a new `executeAlignmentPhase` function.

### Step definition generation changes

- Update `generate_step_definitions.md` to remove the generatable/ungeneratable classification entirely.
- Add awareness of the test harness infrastructure: mock GitHub API server, Claude CLI stub, git remote mock, fixture repo setup.
- This command is no longer invoked as a separate phase — the build agent generates step definitions during its TDD loop. The command may still be useful as a reference or for standalone invocations.

### Build agent routing

- `buildAgent.ts` conditionally selects `/implement_tdd` when BDD scenarios exist for the issue (detected by scanning for `.feature` files tagged `@adw-{issueNumber}`).
- Falls back to `/implement` when no scenarios exist.
- When `/implement_tdd` is selected, scenario file paths are passed as additional context to the build agent.

### Orchestrator pipeline changes

- Remove `executeStepDefPhase` from all orchestrators that use it (`adwSdlc.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`).
- Replace `executePlanValidationPhase` with `executeAlignmentPhase` (single-pass) in the same orchestrators.
- New pipeline: `install -> [plan || scenarios] -> alignment -> build (TDD) -> test -> review -> document`
- `adwPlanBuild.tsx` and `adwPlanBuildTest.tsx` don't currently use scenarios — they can optionally adopt the new pipeline or stay unchanged.

### Review phase addition

- Update `review.md` to include a step definition independence verification.
- The review agent checks: "Do the step definitions test behavior through public interfaces, or do they tautologically assert what the implementation does?"
- This catches the independence risk introduced by having the build agent write both step definitions and implementation.

## Testing Decisions

### What makes a good test

Tests should verify observable behavior through public interfaces, not implementation details. A good test reads like a specification ("user can checkout with valid cart") and survives internal refactors. Tests that break when you rename an internal function — but behavior hasn't changed — are testing implementation, not behavior.

### Modules to test

- **`/implement_tdd` skill behavior**: Verify via BDD scenarios that the build agent follows the TDD loop (generates step defs, runs RED, implements GREEN). Use the existing test harness with the Claude CLI stub configured to return appropriate fixture responses for TDD-style interactions.
- **Single-pass alignment**: Verify that given a plan and conflicting scenarios, the alignment agent resolves conflicts correctly. Test with fixture plans and feature files that have known mismatches.
- **Build agent routing**: Verify that `buildAgent.ts` selects `/implement_tdd` when scenarios exist and `/implement` when they don't. Unit-testable with mock file system checks.
- **Step def independence check in review**: Verify via BDD scenarios that the review agent flags accommodating step definitions. Use fixture step defs that are tautological vs. ones that test real behavior.

### Prior art

- Existing BDD scenarios in `features/` with step definitions in `features/step_definitions/` — the same pattern used throughout ADW.
- Test harness in `test/mocks/` (mock GitHub API, Claude CLI stub, git remote mock, fixture repos) — recently built specifically to enable dynamic integration testing.
- Vitest unit tests in `adws/cost/__tests__/` — prior art for unit testing ADW modules.

## Out of Scope

- **Migrating existing commands to skills**: The broader effort to move `.claude/commands/` to `.claude/skills/` is a separate initiative. This PRD only creates the new `/implement_tdd` skill and alignment command.
- **Modifying the interactive `/tdd` skill**: The existing TDD skill remains unchanged for interactive use. `/implement_tdd` is a separate, autonomous skill.
- **E2E/Playwright test integration**: The Playwright-based E2E testing flow for web apps is unaffected. This PRD focuses on BDD scenario integration with the build phase.
- **Test harness expansion**: The test harness already provides the mock infrastructure needed. Expanding it to cover additional external services is out of scope.
- **Scenario agent changes**: The scenario agent continues to generate `.feature` files from GitHub issues. Its behavior is unchanged.
- **Cost module changes**: Cost tracking continues to work via the existing `PhaseCostRecord` system. New phases (alignment) will produce cost records using the same mechanism.

## Further Notes

- The plan and scenario phases already run in parallel via `runPhasesParallel()`. This is preserved.
- The `parseUnitTestsEnabled()` function in `projectConfig.ts` already handles the `## Unit Tests` setting. The `/implement_tdd` skill reads this to decide whether to also write unit tests.
- The test harness (`test/mocks/test-harness.ts`) provides: mock GitHub API server (`github-api-server.ts`), Claude CLI stub (`claude-cli-stub.ts`), git remote mock (`git-remote-mock.ts`), and fixture repo setup (`setupFixtureRepo()`). The step definition generator should reference these when generating step definitions that need runtime infrastructure.
- Token savings estimate: dropping the plan validation retry loop (up to N agent spawns) and the separate step definition phase (1 agent spawn) removes 2-N agent invocations per workflow run. The single-pass alignment adds 1 invocation. Net saving: 1 to N-1 agent spawns per run.
- The `/implement_tdd` skill should set `target: true` so it gets copied to target repos during `adw_init`, allowing developers to use it interactively as well.
