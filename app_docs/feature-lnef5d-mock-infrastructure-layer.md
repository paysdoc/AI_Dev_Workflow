# Mock Infrastructure Layer

**ADW ID:** lnef5d-mock-infrastructure
**Date:** 2026-03-24
**Specification:** specs/issue-275-adw-3n5bwi-mock-infrastructure-sdlc_planner-mock-infrastructure-layer.md

## Overview

Adds a complete mock infrastructure layer for ADW behavioral testing, intercepting the three external boundaries — the Claude Code CLI, the GitHub API, and git remote operations — so Cucumber BDD scenarios can exercise real orchestration code against canned fixtures without hitting live services. This enables deterministic, fast, and cost-free CI test runs of the full plan→build→test→review pipeline.

## What Was Built

- **Claude CLI Stub** (`test/mocks/claude-cli-stub.ts`) — executable script that accepts the same flags as the real Claude CLI and streams canned JSONL fixtures to stdout
- **GitHub API Mock Server** (`test/mocks/github-api-server.ts`) — local HTTP server mimicking `api.github.com` with fixture-based responses, runtime state setup, and request recording
- **Git Remote Mock** (`test/mocks/git-remote-mock.ts`) — executable wrapper that no-ops `push`, `fetch`, `clone`, `pull`, `ls-remote` while delegating all local git operations to the real binary
- **Test Harness** (`test/mocks/test-harness.ts`) — wires all three mocks together with `setupMockInfrastructure()`/`teardownMockInfrastructure()` functions for Cucumber `Before`/`After` hooks
- **Shared Types** (`test/mocks/types.ts`) — `MockConfig`, `RecordedRequest`, `MockServerState`, and fixture assembly interfaces
- **JSONL Fixtures** — envelope templates (`assistant-message.jsonl`, `result-message.jsonl`) and agent payloads (`plan-agent.json`, `build-agent.json`, `review-agent.json`)
- **GitHub Fixtures** — default JSON responses for issues, PRs, and comments
- **BDD Feature + Steps** — `features/mock_infrastructure.feature` with 6 scenarios and full step definitions in `features/step_definitions/mockInfrastructureSteps.ts`
- Additional feature files for each mock component: `claude_cli_stub.feature`, `git_remote_mock.feature`, `github_api_mock_server.feature`

## Technical Implementation

### Files Modified

- `test/mocks/types.ts`: New — shared TypeScript interfaces (`MockConfig`, `RecordedRequest`, `MockServerState`, `FixtureAssemblyOptions`)
- `test/mocks/claude-cli-stub.ts`: New — executable stub; selects payload by `MOCK_FIXTURE_PATH` env var or by detecting `/implement`, `/review`, `/feature` in the prompt; streams JSONL with configurable delay via `MOCK_STREAM_DELAY_MS`
- `test/mocks/github-api-server.ts`: New — Node.js HTTP server with a route table for core GitHub REST endpoints plus GraphQL; control endpoints `POST /_mock/state`, `GET /_mock/requests`, `POST /_mock/reset`
- `test/mocks/git-remote-mock.ts`: New — executable wrapper using `spawnSync` to delegate non-intercepted subcommands to the real git binary (resolved via `REAL_GIT_PATH` or `which -a git`)
- `test/mocks/test-harness.ts`: New — orchestrates mock startup, env-var injection (`CLAUDE_CODE_PATH`, `GH_HOST`, `PATH`), and reversible teardown
- `test/fixtures/jsonl/envelopes/`: New — `assistant-message.jsonl` and `result-message.jsonl` envelope templates conforming to `JsonlAssistantMessage` / `ClaudeCodeResultMessage` types
- `test/fixtures/jsonl/payloads/`: New — `plan-agent.json`, `build-agent.json`, `review-agent.json` (arrays of `ContentBlock` objects)
- `test/fixtures/github/`: New — `default-issue.json`, `default-pr.json`, `default-comments.json`
- `features/mock_infrastructure.feature`: New — 6 BDD scenarios tagged `@mock-infrastructure @regression`
- `features/step_definitions/mockInfrastructureSteps.ts`: New — Given/When/Then steps using `fetch()`, `spawnSync`, and the test harness
- `features/step_definitions/claudeCliStubSteps.ts`, `gitRemoteMockSteps.ts`, `githubApiMockServerSteps.ts`: New — component-level step definitions
- `adws/providers/types.ts`: Minor — two-line addition (new provider type field)
- `adws/phases/buildPhase.ts`, `adws/phases/testPhase.ts`: Minor updates for compatibility
- `adws/agents/validationAgent.ts`: Minor update

### Key Changes

- Fixtures are split into **envelopes** (JSONL structural templates) and **payloads** (agent-specific content), so payloads can be hand-maintained independently of message structure changes.
- The GitHub mock server uses a **route table** (`RouteDefinition[]`) rather than hardcoded `if/else`, making it straightforward to add new endpoints (e.g., Jira, GitLab) by appending entries.
- Environment variables are **saved and restored** by the test harness — no leakage between Cucumber scenarios.
- The git remote mock uses `which -a git` to find the real binary behind itself, preventing infinite recursion when the script is named `git` on `PATH`.
- Control endpoints (`/_mock/state`, `/_mock/requests`, `/_mock/reset`) allow Cucumber `Given`/`Then` steps to configure and assert mock server state without shared globals.

## How to Use

### Running mock infrastructure scenarios

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"
```

### Using the test harness in a Cucumber hook

```ts
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../test/mocks/test-harness.ts';
import type { MockContext } from '../../test/mocks/types.ts';

let mockCtx: MockContext;

Before({ tags: '@mock-infrastructure' }, async () => {
  mockCtx = await setupMockInfrastructure();
});

After({ tags: '@mock-infrastructure' }, async () => {
  await teardownMockInfrastructure(mockCtx);
});
```

### Configuring per-scenario GitHub state

```ts
// In a Given step
await fetch(`${mockCtx.serverUrl}/_mock/state`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ issues: { '42': { title: 'Custom Issue', state: 'open' } } }),
});
```

### Pointing the Claude CLI stub to a specific fixture

Set `MOCK_FIXTURE_PATH` to the absolute path of a payload JSON file before spawning the stub. When unset, the stub auto-selects based on `/implement`, `/review`, or `/feature` in the prompt.

### Adding a new GitHub API endpoint

Append a `RouteDefinition` entry to the route table in `test/mocks/github-api-server.ts`:

```ts
{ method: 'GET', pattern: '/repos/:owner/:repo/releases', handler: handleReleases }
```

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `MOCK_FIXTURE_PATH` | auto-detected | Absolute path to a JSONL payload JSON file for the CLI stub |
| `MOCK_STREAM_DELAY_MS` | `10` | Delay in ms between streamed JSONL lines |
| `REAL_GIT_PATH` | resolved at runtime | Absolute path to the real git binary (avoids PATH recursion) |
| `GH_HOST` | set by test harness | Redirects `gh api` calls to the mock server |
| `CLAUDE_CODE_PATH` | set by test harness | Points to `test/mocks/claude-cli-stub.ts` |

## Testing

Run all mock infrastructure scenarios:

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"
```

Run regression suite to verify no breakage:

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Type-check:

```bash
bunx tsc --noEmit
```

## Notes

- All three mock components operate at ADW's existing extension points (`CLAUDE_CODE_PATH`, `GH_HOST`, `PATH`) — no changes to production orchestration code are required.
- The GitHub mock uses the Node.js `http` module (not `Bun.serve()`) to avoid ESM/CJS issues with `import.meta.url` resolution in the Cucumber test runner environment.
- Fixture reset between scenarios (`POST /_mock/reset`) is called automatically by the test harness teardown — scenarios must not share mock state.
- The Docker CI image and the minimal fixture target repo (`test/fixtures/cli-tool/`) are out of scope for this feature and tracked separately.
