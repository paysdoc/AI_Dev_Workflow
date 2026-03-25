# Feature: Fixture Target Repo + Test Harness + First Behavioral Review Scenario

## Metadata
issueNumber: `279`
adwId: `6bi1qq-fixture-target-repo`
issueJson: `{"number":279,"title":"Fixture target repo + test harness + first behavioral review scenario","body":"## Parent PRD\n\n`specs/prd/prd-review-revamp.md`\n\n## What to build\n\nCreate the fixture target repo, wire all mocks together into a test harness, and write the first behavioral BDD scenario that exercises the review phase end-to-end.\n\n**Fixture target repo** at `test/fixtures/cli-tool/`:\n- Minimal repo structure with `.adw/commands.md`, `.adw/project.md` (type: `cli`), `.adw/scenarios.md`, `.adw/review_proof.md`\n- Contains enough source files for agents to operate on\n- Initialized as a git repo during test setup\n\n**Test harness:**\n- Wires all mocks together: starts GitHub API mock server, configures `CLAUDE_CODE_PATH` to stub, sets up git remote mocking\n- Provides setup/teardown hooks for Cucumber scenarios\n- Configurable for Docker or host execution with the same interface\n- Manages environment variables for the test run\n\n**First behavioral scenario:**\n- Exercises the review phase with mocked boundaries\n- Asserts on observable outcomes: scenario proof generated, issue comment posted (via mock server recording), correct severity classification\n- Demonstrates the full mock infrastructure working together\n\nSee PRD sections: \"Fixture Target Repo\", \"Test Harness\", \"GitHub API Mock Server\".\n\n## Acceptance criteria\n\n- [ ] `test/fixtures/cli-tool/` exists with minimal `.adw/` config and source files\n- [ ] Test harness starts all mocks and configures environment before scenarios\n- [ ] Test harness tears down mocks cleanly after scenarios\n- [ ] Harness works on host (no Docker required for local development)\n- [ ] At least one behavioral BDD scenario exercises the review phase end-to-end\n- [ ] Scenario asserts on mock server recordings (e.g., comment posted with proof data)\n- [ ] Scenario passes deterministically with canned fixtures\n\n## Blocked by\n\n- Blocked by #275 (mock infrastructure: Claude CLI stub, GitHub API mock, git remote mock)\n\n## User stories addressed\n\n- User story 18\n- User story 22\n- User story 27","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-23T17:01:44Z","comments":[{"author":"paysdoc","createdAt":"2026-03-24T18:54:50Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Create a fixture target repository at `test/fixtures/cli-tool/`, extend the existing test harness to initialize it as a git repo during test setup, create a review-specific JSONL payload fixture, and write the first behavioral BDD scenario that exercises the review phase end-to-end with all mocks wired together. The scenario demonstrates deterministic, cost-free review testing using canned fixtures against the mock infrastructure from issue #275.

## User Story
As an ADW developer
I want a fixture target repo and BDD scenario that exercises the review phase end-to-end with mocked boundaries
So that I can validate review behavior deterministically without hitting live services

## Problem Statement
The mock infrastructure layer (issue #275) provides Claude CLI stub, GitHub API mock server, and git remote mock — but there is no fixture target repo for agents to operate on, no integration of these mocks into the review flow, and no behavioral BDD scenario proving the full mock stack works together for the review phase. Without a fixture repo and end-to-end scenario, the mock infrastructure remains untested as a cohesive system.

## Solution Statement
1. Create a minimal fixture target repo (`test/fixtures/cli-tool/`) with `.adw/` configuration and source files matching what a real CLI-type target repo would contain.
2. Extend the test harness (`test/mocks/test-harness.ts`) with a `setupFixtureRepo()` function that copies the fixture template to a temp directory and initializes it as a git repo (git init + initial commit).
3. Create a review-specific JSONL payload (`test/fixtures/jsonl/payloads/review-agent-structured.json`) that returns structured `ReviewResult` JSON parseable by `extractJson()`.
4. Write a BDD feature (`features/review_harness.feature`) with step definitions that exercise the review phase: set up mocks + fixture repo, run the review agent, post a comment to the mock GitHub API, and assert on recorded requests and structured output.

## Relevant Files
Use these files to implement the feature:

### Existing Files (Read/Modify)
- `test/mocks/test-harness.ts` — Extend with `setupFixtureRepo()` / `teardownFixtureRepo()` functions for fixture repo initialization and cleanup
- `test/mocks/types.ts` — Add `FixtureRepoContext` type for the fixture repo setup result
- `test/mocks/github-api-server.ts` — Reference for understanding mock server capabilities (no changes expected)
- `test/mocks/claude-cli-stub.ts` — Reference for understanding CLI stub payload selection (no changes expected)
- `test/mocks/git-remote-mock.ts` — Reference for understanding git mock interception (no changes expected)
- `test/fixtures/github/default-issue.json` — Reference fixture format for creating review-specific issue fixture
- `test/fixtures/jsonl/payloads/review-agent.json` — Reference for creating structured review payload
- `test/fixtures/jsonl/envelopes/assistant-message.jsonl` — Envelope template used by CLI stub
- `test/fixtures/jsonl/envelopes/result-message.jsonl` — Envelope template used by CLI stub
- `adws/agents/reviewAgent.ts` — Reference for `ReviewResult` / `ReviewIssue` interfaces (payload must match)
- `adws/agents/regressionScenarioProof.ts` — Reference for scenario proof flow
- `adws/agents/reviewRetry.ts` — Reference for `ReviewRetryOptions` and the full review loop
- `adws/core/jsonParser.ts` — Reference for `extractJson()` which parses review output
- `features/step_definitions/mockInfrastructureSteps.ts` — Reference pattern for mock infrastructure step definitions
- `features/mock_infrastructure.feature` — Reference pattern for mock infrastructure feature files
- `cucumber.js` — Cucumber config (no changes expected, already globs `features/**/*.feature`)
- `guidelines/coding_guidelines.md` — Coding guidelines to follow
- `app_docs/feature-lnef5d-mock-infrastructure-layer.md` — Documentation for the mock infrastructure layer

### New Files
- `test/fixtures/cli-tool/.adw/commands.md` — Build/test/lint command mappings for the fixture repo
- `test/fixtures/cli-tool/.adw/project.md` — Project configuration (type: cli, unit tests: disabled)
- `test/fixtures/cli-tool/.adw/scenarios.md` — BDD scenario configuration
- `test/fixtures/cli-tool/.adw/review_proof.md` — Review proof tag configuration
- `test/fixtures/cli-tool/.adw/providers.md` — Provider configuration (GitHub)
- `test/fixtures/cli-tool/src/cli.ts` — Minimal CLI entry point source file
- `test/fixtures/cli-tool/src/utils.ts` — Minimal utility source file
- `test/fixtures/cli-tool/package.json` — Minimal package.json
- `test/fixtures/cli-tool/tsconfig.json` — Minimal TypeScript config
- `test/fixtures/cli-tool/README.md` — One-line description of the fixture repo's purpose
- `test/fixtures/jsonl/payloads/review-agent-structured.json` — Structured review payload with `ReviewResult` JSON embedded in text content
- `features/review_harness.feature` — BDD feature exercising the review phase end-to-end
- `features/step_definitions/reviewHarnessSteps.ts` — Step definitions for the review harness scenario

## Implementation Plan

### Phase 1: Foundation — Fixture Target Repo
Create the minimal fixture target repo at `test/fixtures/cli-tool/` containing `.adw/` configuration files and source files. The fixture represents a typical CLI-type target repository that ADW agents would operate on. Files are static templates — git initialization happens at test runtime.

### Phase 2: Core Implementation — Review Payload & Harness Extension
1. Create a structured review-agent JSONL payload (`review-agent-structured.json`) that contains a `ReviewResult` JSON object embedded in a text content block, parseable by `extractJson()`. This ensures the CLI stub returns realistic structured review output.
2. Extend `test/mocks/types.ts` with a `FixtureRepoContext` interface tracking the temp directory path and cleanup function.
3. Extend `test/mocks/test-harness.ts` with `setupFixtureRepo()` that:
   - Copies `test/fixtures/cli-tool/` to a temp directory
   - Runs `git init` + `git add .` + `git commit` in the temp directory
   - Returns the temp path for use as `cwd` by agents
4. Add `teardownFixtureRepo()` that removes the temp directory.

### Phase 3: Integration — Behavioral BDD Scenario
Write `features/review_harness.feature` with a scenario that:
1. Sets up mock infrastructure (reusing existing harness)
2. Initializes the fixture repo as a temp git repo
3. Configures the GitHub mock with a review-specific issue
4. Points the CLI stub to the structured review payload
5. Spawns the CLI stub with a `/review` command and parses the output
6. Posts the review result as a comment to the mock GitHub API
7. Asserts: structured `ReviewResult` JSON was parsed, comment was recorded by the mock server, severity classifications are correct

## Step by Step Tasks

### Step 1: Create fixture target repo `.adw/` configuration files
- Create `test/fixtures/cli-tool/.adw/commands.md` with:
  - Package manager: bun
  - Install: bun install
  - Lint: echo "lint ok"
  - Type Check: echo "type check ok"
  - Run Tests: N/A
  - Run Build: echo "build ok"
  - Run E2E Tests: N/A
  - Run Scenarios by Tag: echo "1 scenario (1 passed)" (deterministic mock output)
  - Run Regression Scenarios: echo "1 scenario (1 passed)"
- Create `test/fixtures/cli-tool/.adw/project.md` with:
  - Project Overview describing it as a fixture CLI tool
  - Application Type: cli
  - Unit Tests: disabled
- Create `test/fixtures/cli-tool/.adw/scenarios.md` with:
  - Scenario Directory: features/
  - Run Scenarios by Tag: echo "1 scenario (1 passed)"
  - Run Regression Scenarios: echo "1 scenario (1 passed)"
- Create `test/fixtures/cli-tool/.adw/review_proof.md` with:
  - Tags table: @review-proof (blocker, not optional)
  - Supplementary Checks: echo commands that always succeed
  - Proof Format section
- Create `test/fixtures/cli-tool/.adw/providers.md` with:
  - Issue Tracker: github
  - Code Host: github

### Step 2: Create fixture target repo source files
- Create `test/fixtures/cli-tool/src/cli.ts` — minimal CLI entry point (~15 lines) that parses args and prints help
- Create `test/fixtures/cli-tool/src/utils.ts` — minimal utility module (~10 lines) with a `formatOutput()` function
- Create `test/fixtures/cli-tool/package.json` — minimal JSON with name, version, type: module, bin entry
- Create `test/fixtures/cli-tool/tsconfig.json` — minimal TS config with strict mode
- Create `test/fixtures/cli-tool/README.md` — one-line description: "Fixture CLI tool for ADW behavioral testing."

### Step 3: Create structured review-agent JSONL payload
- Create `test/fixtures/jsonl/payloads/review-agent-structured.json` containing a content block array where:
  - First block: type `text` with embedded JSON matching the `ReviewResult` interface:
    ```json
    {
      "success": true,
      "reviewSummary": "Review passed. Implementation follows the spec with clean code structure.",
      "reviewIssues": [
        {
          "reviewIssueNumber": 1,
          "screenshotPath": "",
          "issueDescription": "Minor: consider adding JSDoc to exported functions",
          "issueResolution": "Add documentation comments to public API",
          "issueSeverity": "tech-debt"
        }
      ],
      "screenshots": []
    }
    ```
  - The text wraps the JSON in a markdown code fence so `extractJson()` can parse it
- Verify the payload structure matches what `claude-cli-stub.ts` expects (array of `{ type, text }`)

### Step 4: Extend mock types with FixtureRepoContext
- Add to `test/mocks/types.ts`:
  ```typescript
  export interface FixtureRepoContext {
    /** Absolute path to the temporary fixture repo working directory. */
    repoDir: string;
    /** Removes the temp directory. */
    cleanup: () => void;
  }
  ```

### Step 5: Extend test harness with fixture repo setup/teardown
- Add to `test/mocks/test-harness.ts`:
  - `setupFixtureRepo(fixtureName?: string): FixtureRepoContext`
    - Defaults `fixtureName` to `'cli-tool'`
    - Resolves source path: `test/fixtures/{fixtureName}/`
    - Creates temp directory via `mkdtempSync` under `os.tmpdir()`
    - Recursively copies fixture files to temp directory (using `cpSync` with `recursive: true`)
    - Runs `git init`, `git add .`, `git commit -m "Initial fixture commit"` in the temp dir using the real git binary (via `REAL_GIT_PATH` or `findRealGit()`)
    - Returns `{ repoDir, cleanup }` where cleanup does `rm -rf` on the temp dir
  - `teardownFixtureRepo(ctx: FixtureRepoContext): void`
    - Calls `ctx.cleanup()`
  - Export both functions

### Step 6: Write the review harness BDD feature file
- Create `features/review_harness.feature` tagged `@review-harness @regression`:
  ```gherkin
  @review-harness @regression
  Feature: Review Phase End-to-End with Mock Infrastructure
    Exercises the review phase against a fixture target repo with all
    mock boundaries (Claude CLI stub, GitHub API mock, git remote mock)
    wired together by the test harness.

    Background:
      Given the mock infrastructure is running
      And the fixture repo "cli-tool" is initialized as a git repo

    Scenario: Review agent returns structured review result via CLI stub
      Given the Claude CLI stub is configured with the "review-agent-structured" payload
      When the Claude CLI stub is invoked with "/review" command
      Then the JSONL output should contain a valid assistant message
      And the assistant message text should contain a parseable ReviewResult JSON
      And the ReviewResult should have "success" equal to true
      And the ReviewResult should have 1 review issue with severity "tech-debt"

    Scenario: Review comment is posted to mock GitHub API
      Given the GitHub mock server has issue "42" configured
      When a review comment is posted to issue "42" with review proof data
      Then the mock server should have recorded a POST request to the issue comments endpoint
      And the recorded comment body should contain "Review passed"

    Scenario: Full review flow with fixture repo and all mocks
      Given the Claude CLI stub is configured with the "review-agent-structured" payload
      And the GitHub mock server has issue "42" configured
      When the review agent runs against the fixture repo for issue "42"
      Then the review should produce a structured ReviewResult
      And the ReviewResult should classify issues with correct severities
      And a comment should be posted to the mock GitHub API for issue "42"
      And the mock server recordings should contain the review proof data
  ```

### Step 7: Write step definitions for the review harness scenarios
- Create `features/step_definitions/reviewHarnessSteps.ts` with:
  - Import `Given`, `When`, `Then` from `@cucumber/cucumber`
  - Import `setupMockInfrastructure`, `teardownMockInfrastructure`, `setupFixtureRepo`, `teardownFixtureRepo` from `../../test/mocks/test-harness.ts`
  - Import types from `../../test/mocks/types.ts`
  - `Before({ tags: '@review-harness' })` hook: calls `setupMockInfrastructure()` and stores `MockContext`
  - `After({ tags: '@review-harness' })` hook: calls `teardownMockInfrastructure()` and `teardownFixtureRepo()`
  - **Given** steps:
    - "the mock infrastructure is running" — asserts `mockCtx` exists (setup done in Before hook)
    - "the fixture repo {string} is initialized as a git repo" — calls `setupFixtureRepo(name)`, stores `FixtureRepoContext`
    - "the Claude CLI stub is configured with the {string} payload" — sets `MOCK_FIXTURE_PATH` env var to the resolved payload path
    - "the GitHub mock server has issue {string} configured" — calls `mockCtx.setState()` with issue data
  - **When** steps:
    - "the Claude CLI stub is invoked with {string} command" — spawns the CLI stub via `spawnSync('bun', [stubPath, '--output-format', 'stream-json', prompt])` and captures output
    - "a review comment is posted to issue {string} with review proof data" — does `fetch(mockCtx.serverUrl + '/repos/test-owner/test-repo/issues/{num}/comments', { method: 'POST', body: JSON.stringify({ body: '...' }) })`
    - "the review agent runs against the fixture repo for issue {string}" — spawns CLI stub, parses output, posts comment to mock server
  - **Then** steps:
    - JSONL output validation (parse JSON lines, check message structure)
    - ReviewResult JSON extraction (use regex or JSON.parse to find embedded JSON)
    - Severity classification assertions
    - Mock server recording assertions (check `mockCtx.getRecordedRequests()`)
    - Comment body content assertions

### Step 8: Run validation commands
- Run `bunx tsc --noEmit` to verify type checking passes
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws type checking
- Run `bun run lint` to verify no lint issues
- Run `bun run build` to verify build succeeds
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-harness"` to verify the new scenarios pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"` to verify existing mock scenarios still pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify the full regression suite

## Testing Strategy

### Edge Cases
- Fixture repo copy fails if source directory doesn't exist — `setupFixtureRepo()` should throw a descriptive error
- Temp directory cleanup fails if files are locked — teardown should use best-effort `rm -rf`
- CLI stub invoked without `MOCK_FIXTURE_PATH` falls back to prompt-based detection — verify `/review` maps to `review-agent-structured.json` when configured
- Git init fails in temp directory — setup should propagate the error with context
- Mock server not running when comment is posted — step should fail with clear message
- JSONL output has no `text` block — `extractJson()` returns null, scenario asserts on this case
- Empty `reviewIssues` array — should be handled as "review passed with no issues"

## Acceptance Criteria
- `test/fixtures/cli-tool/` exists with `.adw/commands.md`, `.adw/project.md` (type: cli), `.adw/scenarios.md`, `.adw/review_proof.md`, and source files
- `test/mocks/test-harness.ts` exports `setupFixtureRepo()` and `teardownFixtureRepo()` functions
- `setupFixtureRepo()` copies fixture template to a temp dir and initializes it as a git repo
- `teardownFixtureRepo()` removes the temp directory cleanly
- `test/fixtures/jsonl/payloads/review-agent-structured.json` exists with a `ReviewResult`-shaped JSON payload
- `features/review_harness.feature` has at least 3 scenarios tagged `@review-harness @regression`
- Scenarios assert on: structured ReviewResult parsing, mock server comment recording, severity classification
- All scenarios pass deterministically with canned fixtures (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-harness"`)
- Existing `@mock-infrastructure` and `@regression` scenarios continue to pass
- No Docker required — harness works on host with `bun` and `node`

## Validation Commands

```bash
# Type check - root
bunx tsc --noEmit

# Type check - adws
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint

# Build
bun run build

# Run new review harness scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-harness"

# Run existing mock infrastructure scenarios (regression check)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"

# Run full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes
- The fixture repo's `.adw/scenarios.md` uses `echo` commands instead of real `cucumber-js` to ensure deterministic BDD proof output without requiring a full Cucumber environment inside the fixture. This is intentional — the fixture repo is a mock target, not a real project.
- The `review-agent-structured.json` payload embeds the `ReviewResult` JSON inside a markdown code fence within the text content block, matching how the real Claude CLI returns structured JSON that `extractJson()` parses.
- The `setupFixtureRepo()` function uses `mkdtempSync` for isolation — each scenario gets its own copy of the fixture repo, preventing cross-scenario contamination.
- The `git init` step in `setupFixtureRepo()` uses the real git binary (resolved via `findRealGit()` before PATH is modified by the mock), not the git remote mock wrapper.
- Guidelines: strictly follow `guidelines/coding_guidelines.md` — functional style, immutable data, no decorators, strict TypeScript, files under 300 lines.
- The three scenarios are designed to test progressively: component-level (CLI stub output), integration (mock server recording), and end-to-end (full review flow). This layered approach makes failures easier to diagnose.
