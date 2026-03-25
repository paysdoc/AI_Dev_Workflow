# Feature: Remove ungeneratable classification from step def generator, add test harness awareness

## Metadata
issueNumber: `303`
adwId: `y55dlm-remove-ungeneratable`
issueJson: `{"number":303,"title":"Remove ungeneratable classification from step def generator, add test harness awareness","body":"## Parent PRD\n\n`specs/prd/tdd-bdd-integration.md`\n\n## What to build\n\nUpdate `generate_step_definitions.md` to remove the generatable/ungeneratable scenario classification entirely. The test harness (`test/mocks/test-harness.ts`) now provides the runtime infrastructure that previously made scenarios \"ungeneratable\": mock GitHub API server, Claude CLI stub, git remote mock, and fixture repo setup.\n\nAdd documentation about the test harness capabilities to the step definition generator's instructions so it can produce step definitions for scenarios that need runtime infrastructure (running servers, mocked LLM calls, external service dependencies) by leveraging the harness.\n\nSee PRD sections: \"Step definition generation changes\" and \"Further Notes\" for test harness details.\n\n## Acceptance criteria\n\n- [ ] `generate_step_definitions.md` no longer classifies scenarios as generatable/ungeneratable\n- [ ] `generate_step_definitions.md` no longer removes scenarios from `.feature` files\n- [ ] `generate_step_definitions.md` documents the test harness infrastructure (mock GitHub API, Claude CLI stub, git remote mock, fixture repo setup) and instructs the agent to use it when generating step definitions for scenarios requiring runtime infrastructure\n- [ ] The `removedScenarios` output field is retained for backward compatibility but always returns an empty array\n- [ ] Existing BDD regression scenarios continue to pass\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 3","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T13:48:32Z","comments":[{"author":"paysdoc","createdAt":"2026-03-25T20:43:00Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
The `/generate_step_definitions` slash command currently classifies BDD scenarios as "generatable" or "ungeneratable" and removes ungeneratable scenarios from `.feature` files. This was necessary because there was no way to generate step definitions for scenarios requiring runtime infrastructure (running servers, mocked LLM calls, external service dependencies).

With the mock infrastructure layer now in place (`test/mocks/test-harness.ts`, `test/mocks/github-api-server.ts`, `test/mocks/claude-cli-stub.ts`, `test/mocks/git-remote-mock.ts`), all scenarios can now have step definitions generated — the test harness provides the runtime infrastructure that previously made scenarios "ungeneratable". This feature removes the classification entirely and adds test harness documentation to the step definition generator so it can produce step definitions for all scenarios.

## User Story
As a developer using ADW
I want the step definition generator to generate step definitions for all BDD scenarios without removing any
So that no scenarios are lost during the step definition generation phase and all scenarios are tested

## Problem Statement
The current step definition generator classifies scenarios into "generatable" and "ungeneratable" categories, then removes ungeneratable scenarios from `.feature` files. This was a pragmatic workaround when no mock infrastructure existed, but it causes scenarios to be permanently deleted from feature files. Now that the test harness provides mock GitHub API, Claude CLI stub, git remote mock, and fixture repo setup, this classification is unnecessary and harmful — scenarios that require runtime infrastructure can now have step definitions generated using the test harness.

## Solution Statement
1. Remove the classification logic (steps 5 and 6) from `generate_step_definitions.md`
2. Add a new section documenting the test harness infrastructure and how to use it for scenarios requiring runtime infrastructure
3. Keep the `removedScenarios` field in the JSON output for backward compatibility, but always return an empty array
4. Update `stepDefPhase.ts` to remove the warning comment logic for removed scenarios (since none will ever be removed)
5. Update the existing BDD regression scenario that validates the "removes ungeneratable scenarios" behavior to reflect the new behavior
6. Update the step definition that validates ungeneratable scenario removal

## Relevant Files
Use these files to implement the feature:

- `.claude/commands/generate_step_definitions.md` — The main slash command to modify. Remove classification steps (5 and 6), add test harness documentation, update output spec.
- `adws/agents/stepDefAgent.ts` — Agent wrapper that parses `removedScenarios` from JSON output. The `RemovedScenario` type and `parseRemovedScenarios` function should be retained for backward compatibility but will always produce empty arrays.
- `adws/phases/stepDefPhase.ts` — Phase orchestrator that posts a warning comment for removed scenarios. The removed-scenarios warning comment logic should be removed since `removedScenarios` will always be empty.
- `features/step_def_generation_review_gating.feature` — Existing BDD feature with a scenario that validates ungeneratable scenario removal. This scenario must be updated to reflect the new behavior.
- `features/step_definitions/stepDefGenReviewGatingSteps.ts` — Step definitions for the above feature. The step that checks for ungeneratable/remove instructions must be updated.
- `test/mocks/test-harness.ts` — The test harness providing `setupMockInfrastructure()`, `teardownMockInfrastructure()`, `setupFixtureRepo()`, `teardownFixtureRepo()`. Referenced in the new documentation section.
- `test/mocks/types.ts` — Types for `MockConfig`, `MockContext`, `MockServerState`, `FixtureRepoContext`. Referenced in the new documentation section.
- `test/mocks/github-api-server.ts` — GitHub API mock server. Referenced in the new documentation section.
- `test/mocks/claude-cli-stub.ts` — Claude CLI stub. Referenced in the new documentation section.
- `test/mocks/git-remote-mock.ts` — Git remote mock. Referenced in the new documentation section.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

## Implementation Plan
### Phase 1: Foundation
Update the `/generate_step_definitions` slash command to remove the generatable/ungeneratable classification entirely. Replace the classification steps (5 and 6) with a new section documenting the test harness infrastructure available for scenarios requiring runtime infrastructure. Keep the `removedScenarios` output field in the JSON spec but instruct that it must always be an empty array.

### Phase 2: Core Implementation
Update the step definition phase (`stepDefPhase.ts`) to remove the dead code path that posts warning comments about removed scenarios. Update the existing BDD scenario and step definition that validated the ungeneratable scenario removal behavior to instead validate the new behavior: the command no longer classifies or removes scenarios, and it documents the test harness.

### Phase 3: Integration
Run all regression BDD scenarios to ensure backward compatibility. Verify that the `removedScenarios` output field is retained (backward compatibility for `stepDefAgent.ts` parsing) and always empty. Validate that no existing step definitions or features break.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Update `generate_step_definitions.md` — Remove classification and add test harness docs
- Remove Step 5 ("Classify scenarios") entirely — delete the generatable/ungeneratable classification logic
- Remove Step 6 ("Remove ungeneratable scenarios") entirely — delete the instructions to remove scenarios from `.feature` files
- Renumber remaining steps (old Step 7 "Generate step definitions" becomes Step 5, etc.)
- Add a new section (before the generation step) documenting the test harness infrastructure:
  - **Mock GitHub API server** (`test/mocks/github-api-server.ts`): local HTTP server on a random port that mimics `api.github.com`; supports runtime state setup via `/_mock/state` and request recording via `/_mock/requests`
  - **Claude CLI stub** (`test/mocks/claude-cli-stub.ts`): executable script accepting the same flags as the real Claude CLI; streams canned JSONL fixtures from `test/fixtures/jsonl/`
  - **Git remote mock** (`test/mocks/git-remote-mock.ts`): wrapper that no-ops `push`, `fetch`, `clone`, `pull`, `ls-remote` while delegating local git operations to the real binary
  - **Fixture repo setup** (`test/mocks/test-harness.ts`): `setupFixtureRepo()` copies `test/fixtures/{name}/` to a temp directory and initializes it as a git repo; `teardownFixtureRepo()` cleans up
  - **Test harness** (`test/mocks/test-harness.ts`): `setupMockInfrastructure()` wires all three mocks together and sets env vars (`CLAUDE_CODE_PATH`, `GH_HOST`, `PATH`); `teardownMockInfrastructure()` restores originals
  - Instruct the agent to use Cucumber `Before`/`After` hooks with the test harness when generating step definitions for scenarios that require runtime infrastructure
- Update the command description line at the top to remove "remove ungeneratable scenarios"
- Update the JSON output specification: keep `removedScenarios` field but note it must always be an empty array `[]` for backward compatibility

### Step 2: Update `stepDefPhase.ts` — Remove warning comment logic
- Remove the `if (result.removedScenarios.length > 0 ...)` block that posts a warning comment on the issue
- The phase should still call `runStepDefAgent` and read `removedScenarios` (for backward compatibility), but no longer act on it

### Step 3: Update BDD scenario for the new behavior
- In `features/step_def_generation_review_gating.feature`, update the scenario "generate_step_definitions command removes ungeneratable scenarios" (around line 39):
  - Change the scenario name to reflect that the command no longer removes scenarios and instead documents the test harness
  - Update the Given/When/Then steps to verify that the command:
    - Does NOT instruct classifying scenarios as generatable/ungeneratable
    - Does NOT instruct removing scenarios from feature files
    - Documents the test harness infrastructure (mentions test harness, mock infrastructure, or `setupMockInfrastructure`)
    - Retains `removedScenarios` in the output as an empty array

### Step 4: Update step definitions for the changed scenario
- In `features/step_definitions/stepDefGenReviewGatingSteps.ts`, update or replace the step definitions that validated ungeneratable scenario removal:
  - Remove or update the step `it should instruct removing scenarios that require runtime infrastructure, mocked LLMs, or external services`
  - Remove or update the step `it should instruct returning the list of removed scenarios in the output`
  - Add new step definitions that validate:
    - The command does not classify scenarios as generatable/ungeneratable
    - The command does not instruct removing scenarios
    - The command documents the test harness infrastructure
    - The `removedScenarios` field is still present in the output format

### Step 5: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no type errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for additional type checking
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify all regression scenarios pass

## Testing Strategy
### Edge Cases
- `removedScenarios` output field must remain in the JSON output spec (backward compatibility with `stepDefAgent.ts` parsing)
- The `RemovedScenario` type and `parseRemovedScenarios` function in `stepDefAgent.ts` must remain unchanged — they handle backward compatibility
- The step definition phase must continue to function if the agent returns a non-empty `removedScenarios` array (even though the command should never produce one)
- Existing BDD scenarios tagged `@regression` that reference the old behavior must be updated, not just deleted

## Acceptance Criteria
- `generate_step_definitions.md` no longer contains "Generatable" or "Ungeneratable" classification instructions
- `generate_step_definitions.md` no longer instructs removing scenarios from `.feature` files
- `generate_step_definitions.md` contains documentation about the test harness infrastructure (mock GitHub API, Claude CLI stub, git remote mock, fixture repo setup) and instructs the agent to use it
- The `removedScenarios` output field is retained in the JSON output spec but documented as always being an empty array
- `stepDefPhase.ts` no longer posts warning comments about removed scenarios
- All `@regression` BDD scenarios pass
- TypeScript compilation passes with no errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Build/type-check the project to verify no type errors
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type check for adws module
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to validate zero regressions

## Notes
- The `RemovedScenario` interface and `parseRemovedScenarios` in `stepDefAgent.ts` are intentionally kept unchanged for backward compatibility — the agent may still return the field, and the parser must handle it gracefully.
- The `stepDefPhase.ts` warning comment logic is dead code after this change (since `removedScenarios` will always be empty), but the `result.removedScenarios` field is still read so the phase remains resilient to unexpected agent output.
- Follow `guidelines/coding_guidelines.md` — particularly clarity over cleverness, modularity, and code hygiene (remove unused code paths like the warning comment block).
