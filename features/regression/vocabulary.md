# Regression Vocabulary Registry

## Rot-Detection Rubric

A vocabulary phrase is valid for `@regression` use **only when it asserts an observable system
behaviour** — not a source-code property. Concretely, a phrase MUST NOT reference:

- File shape (does a file exist? how many lines? what extension?)
- File content via substring match (`readFileSync(...).includes(...)`)
- Structural source-file assertions (`JSON.parse(readFileSync(config.ts))`)

A phrase **may** reference the *outputs* of a system under test (state files written by an
orchestrator, recorded calls on a mock server, git artifacts produced by a phase) because those are
**artefacts**, not source files. This distinction is documented per phrase below.

## Three Permitted Execution Patterns

1. **Subprocess** — `spawnSync('bun', ['adws/<orchestrator>.tsx', adwId, issueNum], { env })`.
   Asserts against state files written by the orchestrator, recorded GitHub API calls captured by
   the mock server, or branch artefacts produced by the orchestrator.

2. **Phase import** — `import { <phaseFn> } from 'adws/phases/<phaseFile>'`. Build a mocked
   `WorkflowConfig`, call the phase, assert state mutations visible through the config or the
   mock harness's recorded calls.

3. **Mock query** — Call `context.mockServer.getRecordedRequests()` or inspect git-mock
   interactions recorded in `RegressionWorld`. Assert against the recorded sequence without
   running any subprocess.

---

## Given — Mock Setup

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G1 | `the mock GitHub API is configured to accept issue comments` | Seeds mock-server state so POST /issues/:n/comments returns 201 | mock-query | mock server state |
| G2 | `the git-mock has a clean worktree at branch {string}` | Resets the git-mock recorded invocations; sets expected branch name in World | mock-query | recorded git invocations |
| G3 | `the claude-cli-stub is loaded with manifest {string}` | Sets `MOCK_MANIFEST_PATH` env var in the harness env to the named manifest path | subprocess | stub behaviour |
| G4 | `an issue {int} exists in the mock issue tracker` | Applies an issue fixture to mock-server state for issue number N | mock-query | mock server state |
| G5 | `no spawn lock exists for issue {int}` | Ensures the orchestrator lock file for issue N is absent from the worktree temp dir | subprocess | orchestrator lock artefact |
| G6 | `a state file exists for adwId {string} at stage {string}` | Writes a minimal state JSON for adwId under the test worktree at the given workflow stage | subprocess / phase-import | state file artefact |
| G7 | `the cron sweep is configured with empty queue` | Sets mock-server issue list to empty so the cron probe finds no eligible issues | mock-query | mock server state |
| G8 | `the mock GitHub API records all PR-list calls` | Enables the mock server to record GET /repos/.../pulls requests (default on; explicit step for clarity) | mock-query | recorded requests |
| G9 | `the claude-cli-stub is loaded with fixture {string}` | Sets `MOCK_FIXTURE_PATH` env var in the harness env to the named payload path | subprocess | stub behaviour |
| G10 | `the mock GitHub API is configured to return PR {int} as merged` | Patches the mock-server PR state so PR N has `merged: true` and `state: closed` | mock-query | mock server state |
| G11 | `the worktree for adwId {string} is initialised at branch {string}` | Creates a fresh temp git repo, sets it as the target worktree in World, checks out branch | subprocess | worktree artefact |

---

## When — Orchestrator / Phase Invocation

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| W1 | `the {string} orchestrator is invoked with adwId {string} and issue {int}` | Spawns `bun adws/adw<Orchestrator>.tsx adwId issueNum` with the harness env; captures exit code | subprocess | exit code + state file |
| W2 | `the plan phase is executed with config {string}` | Imports `executePlanPhase` from `adws/phases/planPhase`, builds mocked `WorkflowConfig`, calls it | phase-import | state mutation |
| W3 | `the build phase is executed with config {string}` | Imports `executeBuildPhase`, builds mocked config, calls it | phase-import | state mutation |
| W4 | `the review phase is executed with config {string}` | Imports `executeReviewPhase`, builds mocked config, calls it | phase-import | state mutation |
| W5 | `the PR phase is executed with config {string}` | Imports `executePRPhase`, builds mocked config, calls it | phase-import | state mutation |
| W6 | `the auto-merge phase is executed with config {string}` | Imports `executeAutoMergePhase`, builds mocked config, calls it | phase-import | recorded PR merge call |
| W7 | `the document phase is executed with config {string}` | Imports `executeDocumentPhase`, builds mocked config, calls it | phase-import | recorded comment call |
| W8 | `the install phase is executed with config {string}` | Imports `executeInstallPhase`, builds mocked config, calls it | phase-import | state mutation |
| W9 | `the workflow is initialised with config {string}` | Imports `initializeWorkflow`, builds mocked config, calls it | phase-import | state file artefact |
| W10 | `the cron probe runs once` | Spawns the ADW SDLC orchestrator in cron mode with an empty queue in the harness env | subprocess | recorded requests |
| W11 | `the webhook handler receives a {string} event for issue {int}` | POSTs a synthetic GitHub webhook payload to the orchestrator's webhook listener | subprocess | recorded requests + state |
| W12 | `the KPI phase is executed with config {string}` | Imports `executeKpiPhase`, builds mocked config, calls it | phase-import | recorded KPI artefact |

---

## Then — State / Mock / Artefact Assertions

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| T1 | `the state file for adwId {string} records workflowStage {string}` | Reads the state JSON written by the orchestrator under test; asserts the `workflowStage` field equals the expected value. (State file is an *artefact*, not a source file — permitted read.) | subprocess / phase-import | state file artefact |
| T2 | `the mock GitHub API recorded a comment on issue {int}` | Queries recorded requests; asserts at least one POST /repos/.../issues/N/comments was captured | mock-query | recorded requests |
| T3 | `the mock GitHub API recorded a comment containing the text {string}` | Queries recorded requests; parses comment bodies; asserts one contains the expected string | mock-query | recorded requests |
| T4 | `the git-mock recorded a commit on branch {string}` | Queries git-mock invocations in World; asserts a `git commit` call on the named branch was recorded | mock-query | git invocations |
| T5 | `the orchestrator subprocess exited {int}` | Reads `World.lastExitCode`; asserts it equals N | subprocess | exit code |
| T6 | `the spawn-gate lock for issue {int} is released` | Asserts the orchestrator lock artefact for issue N is absent after the subprocess completes | subprocess | orchestrator lock artefact |
| T7 | `the mock harness recorded zero PR-merge calls` | Queries recorded requests; asserts no PATCH /repos/.../pulls/:n with `merged: true` was captured | mock-query | recorded requests |
| T8 | `the mock GitHub API recorded a PR creation for issue {int}` | Queries recorded requests; asserts a POST /repos/.../pulls was captured referencing issue N | mock-query | recorded requests |
| T9 | `the state file for adwId {string} records no error` | Reads state JSON; asserts no `error` field or `errorMessage` is set | subprocess / phase-import | state file artefact |
| T10 | `the mock GitHub API recorded {int} total API calls` | Queries recorded requests length; asserts exact count | mock-query | recorded requests |
| T11 | `the git-mock recorded a push to branch {string}` | Queries git-mock invocations; asserts a `git push` call referencing the named branch was recorded | mock-query | git invocations |
