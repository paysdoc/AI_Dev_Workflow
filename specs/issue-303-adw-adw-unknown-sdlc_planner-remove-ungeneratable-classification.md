# Feature: Remove Ungeneratable Classification from Step Def Generator, Add Test Harness Awareness

## Metadata
issueNumber: `303`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description

The step definition generator (`generate_step_definitions.md`) currently classifies scenarios as "generatable" or "ungeneratable" and removes the ungeneratable ones from `.feature` files. The rationale was that scenarios requiring runtime infrastructure (running servers, mocked LLM calls, external service dependencies) could not be tested in a static context.

However, the test harness (`test/mocks/test-harness.ts`) now provides exactly the mock infrastructure those scenarios need: a mock GitHub API server, a Claude CLI stub, a git remote mock, and fixture repo setup. The "ungeneratable" classification is now obsolete — all scenarios can be tested by leveraging the harness.

This feature removes the generatable/ungeneratable classification entirely from the step def generator, documents the test harness capabilities so the agent knows to use it when generating step definitions for infrastructure-dependent scenarios, and retains the `removedScenarios` output field (always returning `[]`) for backward compatibility.

## User Story
As an ADW operator,
I want the step definition generator to know about the test harness infrastructure,
So that scenarios requiring runtime infrastructure are no longer removed as "ungeneratable" and step definitions can be generated for all scenarios.

## Problem Statement

The step definition generator removes scenarios that require runtime infrastructure (mock servers, LLM calls, external services), calling them "ungeneratable." This means the most valuable BDD scenarios — those exercising full integration paths — are silently deleted from feature files, providing no regression protection. The test harness built in issue #275 (`lnef5d`) now provides all the mock infrastructure needed to implement those scenarios.

## Solution Statement

Update `generate_step_definitions.md` to:
1. Remove steps 5 and 6 (classify scenarios / remove ungeneratable scenarios) entirely.
2. Add a test harness reference section documenting the four mock components (`test/mocks/test-harness.ts`, `test/mocks/github-api-server.ts`, `test/mocks/claude-cli-stub.ts`, `test/mocks/git-remote-mock.ts`) and how to use `setupMockInfrastructure()` / `teardownMockInfrastructure()` in Cucumber `Before`/`After` hooks.
3. Instruct the agent to use the harness when generating step definitions for scenarios that require runtime infrastructure.
4. Keep the `removedScenarios` JSON output field but always return `[]`.

## Relevant Files

- `.claude/commands/generate_step_definitions.md` — the slash command to update; steps 5 and 6 must be removed, test harness docs added
- `test/mocks/test-harness.ts` — test harness orchestrator providing `setupMockInfrastructure()` / `teardownMockInfrastructure()`; must be documented in the command
- `test/mocks/github-api-server.ts` — mock GitHub API server; document available control endpoints (`/_mock/state`, `/_mock/requests`, `/_mock/reset`)
- `test/mocks/claude-cli-stub.ts` — Claude CLI stub executable; document `MOCK_FIXTURE_PATH` / `MOCK_STREAM_DELAY_MS` env vars
- `test/mocks/git-remote-mock.ts` — git remote mock executable; document no-op behavior for remote operations
- `test/mocks/types.ts` — shared types (`MockConfig`, `MockContext`, `MockServerState`) referenced in harness usage examples
- `app_docs/feature-lnef5d-mock-infrastructure-layer.md` — documentation of mock infrastructure layer; read for full harness API reference
- `app_docs/feature-ex60ng-step-def-gen-review-gating.md` — documentation of the original step def gen feature; read for context on what was built and why

### New Files
None — this is a documentation-only update to an existing slash command.

## Implementation Plan

### Phase 1: Foundation
Read and understand the current `generate_step_definitions.md` command fully, including its output contract. Read `test/mocks/test-harness.ts` and related mock files to document the harness API accurately.

### Phase 2: Core Implementation
Rewrite `generate_step_definitions.md`:
- Remove the generatable/ungeneratable classification section (step 5) and the "Remove ungeneratable scenarios" section (step 6)
- Renumber remaining steps
- Add a new section documenting the test harness and its four components, with usage examples for Cucumber hooks
- Instruct the generator to use the harness for infrastructure-dependent step definitions
- Update the output schema description to note that `removedScenarios` is retained for backward compatibility but always returns `[]`

### Phase 3: Integration
Run the regression BDD suite to verify existing scenarios continue to pass and no step definitions or feature files are broken.

## Step by Step Tasks

### Step 1: Read the current command and mock files
- Read `.claude/commands/generate_step_definitions.md` in full
- Read `test/mocks/test-harness.ts` to understand `setupMockInfrastructure()`, `teardownMockInfrastructure()`, and `MockContext`
- Read `test/mocks/types.ts` to understand `MockConfig`, `MockContext`, `MockServerState`
- Read `app_docs/feature-lnef5d-mock-infrastructure-layer.md` for the authoritative harness usage reference

### Step 2: Update `generate_step_definitions.md`
- Remove **Step 5: Classify scenarios** (the generatable/ungeneratable classification block) entirely
- Remove **Step 6: Remove ungeneratable scenarios** entirely
- Renumber the remaining steps so they are consecutive (step 5 becomes new step 5: Generate step definitions, etc.)
- Add a new section **Test Harness Infrastructure** (after step 4 / before Generate step definitions) that documents:
  - Overview: four mock components wired by `test/mocks/test-harness.ts`
  - `setupMockInfrastructure()` / `teardownMockInfrastructure()` for Cucumber `Before`/`After` hooks
  - Mock GitHub API server: available control endpoints (`/_mock/state`, `/_mock/requests`, `/_mock/reset`)
  - Claude CLI stub: `MOCK_FIXTURE_PATH`, `MOCK_STREAM_DELAY_MS` env vars
  - Git remote mock: no-ops remote operations, delegates local git to real binary
  - Fixture repo: `setupFixtureRepo()` / `teardownFixtureRepo()` for scenarios needing a real git working directory
  - Example import block and `Before`/`After` hook pattern
- Update the Generate step definitions section to add an instruction: when a scenario requires runtime infrastructure (servers, LLM calls, external services), generate step definitions that use the test harness rather than skipping the scenario
- Update the **Output** section's `removedScenarios` description: "Always returns an empty array `[]`. Retained for backward compatibility."

### Step 3: Verify type-check and lint pass
- Run `bunx tsc --noEmit -p adws/tsconfig.json`
- Run `bun run lint`

### Step 4: Run regression BDD suite
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` and confirm all scenarios pass

## Testing Strategy

### Edge Cases
- The `removedScenarios` array in the JSON output must always be `[]` after this change — verify the output schema description is unambiguous
- Existing feature files that were previously modified by step def gen (scenarios removed) are not affected by this change; the change only affects future invocations
- Scenarios tagged `@adw-{issueNumber}` that previously would have been classified as ungeneratable will now receive step definitions using the test harness — the instructions must be specific enough for the agent to implement them correctly

## Acceptance Criteria

- [ ] `generate_step_definitions.md` no longer contains the "Classify scenarios" (generatable/ungeneratable) section
- [ ] `generate_step_definitions.md` no longer contains the "Remove ungeneratable scenarios" section
- [ ] `generate_step_definitions.md` documents the test harness infrastructure (mock GitHub API, Claude CLI stub, git remote mock, fixture repo setup) and instructs the agent to use it for scenarios requiring runtime infrastructure
- [ ] The `removedScenarios` output field is retained in the JSON schema but always returns an empty array `[]`
- [ ] `bun run lint` passes with zero errors
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` passes with zero errors
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` passes with zero failures

## Validation Commands

```bash
# Type-check ADW TypeScript
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint

# Run regression BDD scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- This is a documentation-only change to a slash command prompt file (`generate_step_definitions.md`). No TypeScript source files are modified.
- The `removedScenarios` field is kept in the output schema because `stepDefAgent.ts` parses this field from the agent's JSON output (`StepDefAgentResult`). Removing it from the schema would require updating the agent parser — out of scope for this issue.
- The test harness documentation should be concrete enough for the step def generator agent to produce working code: it needs import paths, function signatures, and env var names — not just a conceptual overview.
- Per the PRD (`specs/prd/tdd-bdd-integration.md` §"Step definition generation changes"), this command is no longer invoked as a separate pipeline phase (that responsibility moves to the build agent TDD loop). Updating the command now keeps it accurate for standalone invocations and as a reference.
