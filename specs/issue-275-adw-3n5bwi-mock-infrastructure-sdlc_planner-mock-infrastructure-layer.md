# Feature: Mock Infrastructure Layer

## Metadata
issueNumber: `275`
adwId: `3n5bwi-mock-infrastructure`
issueJson: `{"number":275,"title":"Mock infrastructure: Claude CLI stub, GitHub API mock, git remote mock","body":"## Parent PRD\n\n`specs/prd/prd-review-revamp.md`\n\n## What to build\n\nBuild the mock layer for behavioral testing. Three components that intercept ADW's external boundaries:\n\n**Claude CLI Stub** — A script that:\n- Accepts the same CLI arguments as the real Claude Code CLI\n- Reads canned JSONL fixture files and streams them to stdout\n- Is pointed to via the existing `CLAUDE_CODE_PATH` environment variable\n- Fixtures are split into envelope (JSONL message structure) and payload (agent-specific content)\n\n**GitHub API Mock Server** — A local HTTP server that:\n- Mimics `api.github.com` endpoints (issue fetch, comment posting, PR creation, labels, etc.)\n- Loads fixture defaults from JSON files\n- Supports programmatic setup via Given steps (e.g., configure issue state per scenario)\n- Records all incoming requests for assertion in Then steps\n\n**Git Remote Mock** — Intercepts network-touching git commands:\n- `git push`, `git fetch`, `git clone` (from remote) are intercepted/no-oped\n- All local git operations run for real: `init`, `add`, `commit`, `branch`, `checkout`, `merge`, `diff`\n\nSee PRD sections: \"Claude CLI Stub\", \"GitHub API Mock Server\", \"Git Remote Mock\", \"JSONL Fixture Management\".\n\n## Acceptance criteria\n\n- [ ] Claude CLI stub script exists and streams canned JSONL when invoked\n- [ ] Stub accepts the same arguments as real CLI (`--print`, `--verbose`, `--output-format stream-json`, `--model`, etc.)\n- [ ] JSONL fixtures exist for at least plan, build, and review agent responses\n- [ ] Fixtures are split into envelope (structure) and payload (content)\n- [ ] GitHub API mock server starts on a configurable port\n- [ ] Mock server returns fixture responses for core endpoints (issues, comments, PRs)\n- [ ] Mock server supports programmatic state setup (add/modify fixtures at runtime)\n- [ ] Mock server records all incoming requests and exposes them for assertions\n- [ ] Git remote operations (push, fetch, clone) are intercepted without errors\n- [ ] Local git operations (init, add, commit, branch, etc.) work normally\n- [ ] Integration test for GitHub API mock server (start, request, verify recording)\n\n## Blocked by\n\nNone — can start immediately.\n\n## User stories addressed\n\n- User story 19\n- User story 20\n- User story 21","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-23T17:00:40Z","comments":[],"actionableComment":null}`

## Feature Description
Build the mock infrastructure layer that intercepts ADW's three external boundaries — the Claude Code CLI, the GitHub API, and git remote operations — enabling behavioral testing of real orchestration code against canned fixtures. This layer allows ADW's Cucumber BDD scenarios to exercise the full workflow pipeline (plan → build → test → review) without hitting real external services, producing deterministic, fast, and cost-free test runs.

## User Story
As an ADW developer
I want mock implementations for the Claude CLI, GitHub API, and git remote operations
So that I can write behavioral tests that exercise real orchestration code against predictable fixtures without external dependencies

## Problem Statement
ADW orchestrators (`adwPlanBuild`, `adwSdlc`, etc.) coordinate multiple external systems — Claude Code CLI (for AI agent execution), GitHub API (for issue/PR operations), and git remotes (for push/fetch/clone). Currently there is no way to test these orchestration flows without calling real services, which is slow, expensive, non-deterministic, and blocks CI automation.

## Solution Statement
Implement three mock components that slot into ADW's existing extension points:

1. **Claude CLI Stub** — An executable script pointed to via `CLAUDE_CODE_PATH` that accepts the same CLI arguments and streams canned JSONL fixtures to stdout, replacing the real Claude CLI process.
2. **GitHub API Mock Server** — A local HTTP server that mimics `gh api` endpoints, loads fixture defaults from JSON files, supports programmatic state configuration via Cucumber Given steps, and records all requests for assertion in Then steps.
3. **Git Remote Mock** — A wrapper that intercepts network-touching git commands (`push`, `fetch`, `clone`) while allowing all local git operations to run normally.

All three components are wired together by a test harness module that Cucumber hooks call during setup/teardown.

## Relevant Files
Use these files to implement the feature:

- `adws/core/environment.ts` — Defines `CLAUDE_CODE_PATH` resolution and `getSafeSubprocessEnv()`. The stub must satisfy the same contract that `resolveClaudeCodePath()` validates.
- `adws/agents/claudeAgent.ts` — Spawns the Claude CLI process with specific args (`--print`, `--verbose`, `--output-format stream-json`, `--model`, etc.). The stub must accept these flags.
- `adws/agents/agentProcessHandler.ts` — Parses JSONL stdout from the spawned process, extracts tokens, and builds `AgentResult`. Fixtures must produce output this handler can parse.
- `adws/core/claudeStreamParser.ts` — Defines `JsonlAssistantMessage`, `JsonlResultMessage`, `ContentBlock` types. Fixtures must conform to these types.
- `adws/types/agentTypes.ts` — Defines `AgentResult`, `ClaudeCodeResultMessage`, `TokenUsageSnapshot`. The result fixture line must conform to `ClaudeCodeResultMessage`.
- `adws/providers/types.ts` — Defines `IssueTracker`, `CodeHost`, `RepoContext`, `WorkItem`, `MergeRequest` interfaces. The GitHub mock server responses must satisfy these shapes.
- `adws/providers/github/githubIssueTracker.ts` — GitHub `IssueTracker` implementation that calls `gh api`. Mock server must serve the same response shapes.
- `adws/providers/github/githubCodeHost.ts` — GitHub `CodeHost` implementation. Mock server must serve PR and branch responses.
- `adws/github/issueApi.ts` — Low-level `gh api` calls for issues. Defines the JSON shapes the mock must return.
- `adws/github/prApi.ts` — Low-level `gh api` calls for PRs. Defines the JSON shapes the mock must return.
- `adws/github/workflowComments.ts` — Comment posting patterns the mock must record.
- `adws/vcs/branchOperations.ts` — Git branch operations using `execSync`. Remote-touching commands here need interception.
- `adws/vcs/commitOperations.ts` — Git commit operations including `git push`. Push commands need interception.
- `adws/vcs/worktreeOperations.ts` — Worktree operations that may touch remotes.
- `adws/cost/providers/anthropic/extractor.ts` — `AnthropicTokenUsageExtractor` that parses result messages for cost data. Fixtures must include realistic `usage` fields.
- `features/step_definitions/commonSteps.ts` — Existing Cucumber step pattern to follow for new mock step definitions.
- `features/support/register-tsx.mjs` — Cucumber TSX registration for step definitions.
- `cucumber.js` — Cucumber configuration file.
- `guidelines/coding_guidelines.md` — Coding standards to follow (clarity, modularity, type safety, <300 lines per file, no unit tests for ADW).
- `specs/prd/prd-review-revamp.md` — Parent PRD with detailed requirements for Stream 1 (behavioral tests).

### New Files

- `test/mocks/claude-cli-stub.ts` — Executable TypeScript stub that reads JSONL fixture files and streams them to stdout. Compiled to a standalone script.
- `test/mocks/github-api-server.ts` — Local HTTP server that mimics GitHub API endpoints with fixture-based responses and request recording.
- `test/mocks/git-remote-mock.ts` — Git wrapper script that no-ops remote commands while passing through local operations.
- `test/mocks/test-harness.ts` — Wires all three mocks together; provides `setup()` and `teardown()` functions for Cucumber hooks.
- `test/mocks/types.ts` — Shared types for mock configuration, recorded requests, and fixture schemas.
- `test/fixtures/jsonl/envelopes/assistant-message.jsonl` — JSONL envelope template for assistant-type messages.
- `test/fixtures/jsonl/envelopes/result-message.jsonl` — JSONL envelope template for result-type messages.
- `test/fixtures/jsonl/payloads/plan-agent.json` — Hand-maintained payload for plan agent responses (text content, tool uses).
- `test/fixtures/jsonl/payloads/build-agent.json` — Hand-maintained payload for build agent responses.
- `test/fixtures/jsonl/payloads/review-agent.json` — Hand-maintained payload for review agent responses.
- `test/fixtures/github/default-issue.json` — Default GitHub issue fixture response.
- `test/fixtures/github/default-pr.json` — Default GitHub PR fixture response.
- `test/fixtures/github/default-comments.json` — Default GitHub comments fixture response.
- `features/mock_infrastructure.feature` — BDD feature file validating the mock infrastructure itself.
- `features/step_definitions/mockInfrastructureSteps.ts` — Step definitions for mock infrastructure validation scenarios.

## Implementation Plan
### Phase 1: Foundation
Establish the directory structure, shared types, and JSONL fixture format. The fixture format is the bedrock — every other component reads or produces data in this format.

Key decisions:
- Fixtures are split into **envelope** (JSONL message structure matching `claudeStreamParser.ts` types) and **payload** (agent-specific content like text blocks and tool uses). Envelopes are auto-updatable; payloads are hand-maintained.
- The `test/mocks/` directory contains all mock implementations. The `test/fixtures/` directory contains all fixture data.
- Shared types in `test/mocks/types.ts` define `MockConfig`, `RecordedRequest`, and fixture assembly interfaces.

### Phase 2: Core Implementation
Build the three mock components in dependency order:

1. **Claude CLI Stub** — Reads a fixture file path from an environment variable or CLI flag, assembles JSONL lines from envelope + payload, streams them to stdout with realistic delays, then exits 0. Must accept the same flags as the real CLI (`--print`, `--verbose`, `--output-format stream-json`, `--model`, `--effort`).

2. **GitHub API Mock Server** — A Bun HTTP server (`Bun.serve()`) that:
   - Routes requests to handlers matching `gh api` URL patterns (e.g., `/repos/:owner/:repo/issues/:number`)
   - Loads fixture defaults from `test/fixtures/github/` JSON files
   - Exposes a control endpoint (`POST /_mock/state`) for programmatic state setup from Given steps
   - Records all incoming requests to an in-memory array exposed via `GET /_mock/requests`
   - Starts on a configurable port (default: 0 for random assignment)

3. **Git Remote Mock** — A shell wrapper script that:
   - Inspects the git subcommand
   - For `push`, `fetch`, `clone` (from remote): prints a success message and exits 0
   - For all other subcommands: delegates to the real `git` binary
   - Placed on `PATH` before the real git during test runs

### Phase 3: Integration
Wire everything together via `test-harness.ts` which:
- Starts the GitHub API mock server and captures its port
- Sets `CLAUDE_CODE_PATH` to point to the compiled stub
- Prepends the git mock wrapper to `PATH`
- Sets `GH_HOST` / mock URL environment variables so `gh api` calls route to the mock server
- Provides `setup()` and `teardown()` functions compatible with Cucumber `Before`/`After` hooks
- Creates a Cucumber feature file (`mock_infrastructure.feature`) that validates all three mocks work correctly

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create directory structure and shared types
- Create the `test/mocks/` and `test/fixtures/` directory trees
- Create `test/mocks/types.ts` with:
  - `MockConfig` interface (ports, fixture paths, feature flags)
  - `RecordedRequest` interface (method, url, headers, body, timestamp)
  - `FixtureAssemblyOptions` interface (envelope path, payload path, delay between lines)
  - `MockServerState` interface (issues map, PRs map, comments map, labels map)
- Follow `guidelines/coding_guidelines.md` — strict TypeScript, explicit types, no `any`

### Step 2: Create JSONL envelope templates
- Create `test/fixtures/jsonl/envelopes/assistant-message.jsonl` — a template for `JsonlAssistantMessage` type from `claudeStreamParser.ts`, with placeholder content blocks
- Create `test/fixtures/jsonl/envelopes/result-message.jsonl` — a template for `ClaudeCodeResultMessage` type from `agentTypes.ts`, with realistic `usage`, `costUsd`, `durationMs`, `sessionId` fields
- Ensure envelopes conform to the types in `claudeStreamParser.ts` and `agentTypes.ts`

### Step 3: Create agent payload fixtures
- Create `test/fixtures/jsonl/payloads/plan-agent.json` — content blocks for a plan agent response (text with plan markdown, tool_use blocks for Write/Read tools)
- Create `test/fixtures/jsonl/payloads/build-agent.json` — content blocks for a build agent response (tool_use blocks for Edit/Bash tools, text blocks with status)
- Create `test/fixtures/jsonl/payloads/review-agent.json` — content blocks for a review agent response (text with review markdown)
- Each payload is an array of `ContentBlock` objects matching the types in `claudeStreamParser.ts`

### Step 4: Create GitHub API fixture defaults
- Create `test/fixtures/github/default-issue.json` — a default issue response matching the shape returned by `gh api` in `issueApi.ts` (number, title, body, state, author, labels, comments)
- Create `test/fixtures/github/default-pr.json` — a default PR response matching the shape returned by `gh api` in `prApi.ts` (number, title, body, head, base, html_url)
- Create `test/fixtures/github/default-comments.json` — a default comments array response

### Step 5: Build the Claude CLI stub
- Create `test/mocks/claude-cli-stub.ts` as an executable script (with `#!/usr/bin/env bun` shebang)
- Parse CLI arguments: `--print`, `--verbose`, `--dangerously-skip-permissions`, `--output-format`, `--model`, `--effort`, and the trailing prompt string
- Read the `MOCK_FIXTURE_PATH` environment variable to locate the JSONL fixture file to stream
- If `MOCK_FIXTURE_PATH` is not set, derive the fixture from the prompt content (detect `/implement`, `/feature`, `/review` slash commands to select plan/build/review payloads)
- Assemble JSONL output by combining envelope templates with the selected payload
- Stream each JSONL line to stdout with a small delay (configurable via `MOCK_STREAM_DELAY_MS`, default 10ms) to simulate real streaming
- Exit with code 0 on success
- Keep the file under 300 lines per coding guidelines

### Step 6: Build the GitHub API mock server
- Create `test/mocks/github-api-server.ts` using `Bun.serve()`
- Implement route handlers for core GitHub API endpoints:
  - `GET /repos/:owner/:repo/issues/:number` — returns issue fixture
  - `POST /repos/:owner/:repo/issues/:number/comments` — records comment, returns 201
  - `GET /repos/:owner/:repo/issues/:number/comments` — returns comments fixture
  - `PATCH /repos/:owner/:repo/issues/:number` — records state change (close, label)
  - `POST /repos/:owner/:repo/pulls` — records PR creation, returns PR fixture
  - `GET /repos/:owner/:repo/pulls/:number` — returns PR fixture
  - `GET /repos/:owner/:repo/pulls/:number/reviews` — returns empty reviews array
  - `POST /graphql` — handles GraphQL queries for project board operations
- Implement control endpoints:
  - `POST /_mock/state` — accepts JSON body to configure issue/PR/comment state for a scenario
  - `GET /_mock/requests` — returns the array of all recorded requests
  - `POST /_mock/reset` — clears recorded requests and resets state to fixture defaults
- Load fixture defaults from `test/fixtures/github/` JSON files on startup
- Record every incoming request (method, URL, headers, body, timestamp) in an in-memory array
- Export `startMockServer(port?: number)` and `stopMockServer()` functions
- Keep each route handler concise; split into helper functions if needed to stay under 300 lines

### Step 7: Build the git remote mock
- Create `test/mocks/git-remote-mock.ts` as an executable script (with `#!/usr/bin/env bun` shebang)
- Inspect `process.argv` to determine the git subcommand
- For intercepted commands (`push`, `fetch`, `clone`, `pull` with remote args, `ls-remote`):
  - Print a mock success message to stdout (e.g., `"Everything up-to-date"` for push)
  - Exit with code 0
- For all other commands: spawn the real git binary (resolved via `which git` at startup, or `REAL_GIT_PATH` env var) with the original arguments, piping stdio through
- Handle edge cases: `git remote` subcommands that only query (like `git remote -v`) should pass through; only network-touching operations are intercepted

### Step 8: Build the test harness
- Create `test/mocks/test-harness.ts` that exports:
  - `setupMockInfrastructure(config?: Partial<MockConfig>): Promise<MockContext>` — starts GitHub mock server, configures env vars (`CLAUDE_CODE_PATH`, `PATH` with git mock, `GH_HOST`), returns context with server port, cleanup function
  - `teardownMockInfrastructure(ctx: MockContext): Promise<void>` — stops the mock server, restores original env vars
  - `MockContext` interface with server URL, recorded requests accessor, state setter
- The harness must be idempotent — calling setup twice without teardown should not leak servers
- Environment variable changes must be reversible (save originals, restore on teardown)

### Step 9: Create Cucumber feature file for mock infrastructure validation
- Create `features/mock_infrastructure.feature` with scenarios:
  - **Scenario: Claude CLI stub streams canned JSONL** — Given a JSONL fixture, When the stub is invoked with standard CLI args, Then stdout contains valid JSONL lines matching the fixture
  - **Scenario: GitHub API mock server returns fixture responses** — Given the mock server is running, When a GET request is made to the issue endpoint, Then the response matches the default fixture
  - **Scenario: GitHub API mock server records requests** — Given the mock server is running, When a POST comment request is made, Then the request appears in the recorded requests
  - **Scenario: GitHub API mock server supports programmatic state setup** — Given custom issue state is configured via the control endpoint, When the issue endpoint is queried, Then the response reflects the custom state
  - **Scenario: Git remote mock intercepts push** — Given the git mock is on PATH, When `git push` is executed, Then it succeeds without network access
  - **Scenario: Git remote mock passes through local operations** — Given the git mock is on PATH, When `git status` is executed, Then it returns real local status
- Tag all scenarios with `@mock-infrastructure` and `@regression`

### Step 10: Create Cucumber step definitions for mock infrastructure
- Create `features/step_definitions/mockInfrastructureSteps.ts`
- Implement Given/When/Then steps matching the scenarios in Step 9
- Use the test harness (`setupMockInfrastructure`/`teardownMockInfrastructure`) in Before/After hooks scoped to `@mock-infrastructure` tag
- For Claude CLI stub steps: spawn the stub as a child process, collect stdout, parse JSONL
- For GitHub mock server steps: use `fetch()` to make HTTP requests against the running mock server
- For git mock steps: use `execSync()` to run git commands with the mock on PATH
- Follow the step definition patterns in `features/step_definitions/commonSteps.ts`

### Step 11: Run validation commands
- Run `bunx tsc --noEmit` to verify all new TypeScript compiles
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific compilation
- Run `bun run lint` to verify code quality
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"` to validate the mock infrastructure scenarios pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify no regressions

## Testing Strategy
### Edge Cases
- Claude CLI stub invoked with no `MOCK_FIXTURE_PATH` and an unrecognized slash command — should fall back to a generic fixture or exit with a clear error
- GitHub mock server receives a request for an endpoint not yet implemented — should return 404 with a descriptive message and still record the request
- Git remote mock encounters a git subcommand with both local and remote semantics (e.g., `git fetch --dry-run`) — should intercept based on the subcommand, not flags
- GitHub mock server `/_mock/state` receives malformed JSON — should return 400 with error details
- Claude CLI stub receives unknown flags — should ignore them gracefully (like the real CLI ignores unknown flags)
- Test harness called without teardown from a previous run — should detect and clean up the orphaned server
- Multiple Cucumber scenarios running in sequence — mock state must be fully reset between scenarios via `/_mock/reset`

## Acceptance Criteria
- [ ] `test/mocks/claude-cli-stub.ts` exists and is executable; when invoked with `--print --output-format stream-json`, it streams valid JSONL to stdout
- [ ] The stub accepts all flags used by `claudeAgent.ts`: `--print`, `--verbose`, `--dangerously-skip-permissions`, `--output-format stream-json`, `--model`, `--effort`
- [ ] JSONL fixtures exist in `test/fixtures/jsonl/` for plan, build, and review agent responses
- [ ] Each fixture is split into envelope (`.jsonl` structure files) and payload (`.json` content files)
- [ ] `test/mocks/github-api-server.ts` starts on a configurable port and serves fixture responses for issues, comments, and PRs
- [ ] Mock server supports runtime state configuration via `POST /_mock/state`
- [ ] Mock server records all incoming requests, retrievable via `GET /_mock/requests`
- [ ] `test/mocks/git-remote-mock.ts` intercepts `push`, `fetch`, `clone` without errors and passes through local operations
- [ ] `test/mocks/test-harness.ts` wires all mocks together with `setup()`/`teardown()` functions
- [ ] `features/mock_infrastructure.feature` contains at least 6 scenarios covering all three mock components
- [ ] All scenarios tagged `@mock-infrastructure` pass: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"`
- [ ] All regression scenarios still pass: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`
- [ ] `bunx tsc --noEmit` passes with zero errors
- [ ] `bun run lint` passes with zero errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type-check all TypeScript (root tsconfig)
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check ADW-specific code
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"` — Run mock infrastructure BDD scenarios
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression scenarios to ensure no regressions

## Notes
- **Coding guidelines**: Strictly follow `guidelines/coding_guidelines.md` — clarity over cleverness, files under 300 lines, strict TypeScript, no `any`, isolate side effects at boundaries, functional programming style.
- **No unit tests**: `.adw/project.md` specifies `Unit Tests: disabled`. BDD scenarios are ADW's validation mechanism.
- **GitHub API uses `gh` CLI**: The existing codebase calls GitHub via `execSync('gh api ...')`, not direct HTTP. The mock server must be reachable via a `GH_HOST` environment variable or by setting `GH_TOKEN` and routing `gh api` calls to the mock. Alternatively, the mock server can intercept at the provider interface level. Investigate during implementation which approach is cleanest.
- **Bun HTTP server**: Use `Bun.serve()` for the GitHub API mock server — it's the runtime already in use and requires no additional dependencies.
- **No new dependencies required**: All components can be built with Bun builtins (`Bun.serve()`, `Bun.spawn()`, `Bun.file()`), Node.js `child_process`, and the existing `@cucumber/cucumber` framework.
- **Docker image is out of scope**: Per the PRD, the Docker image for CI is a separate concern. This issue focuses on the mock components that work on the host for local dev.
- **Fixture target repo is out of scope**: The minimal fixture repo at `test/fixtures/cli-tool/` is referenced in the PRD but belongs to a separate issue. This issue provides the mock infrastructure that the fixture repo will later use.
- **Future extensibility**: The mock server should be designed so that adding new endpoints (e.g., for Jira, GitLab) follows the same pattern. Use a route table rather than hardcoded if/else chains.
