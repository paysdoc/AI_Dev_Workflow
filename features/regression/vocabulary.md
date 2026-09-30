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

## Observability Surfaces (Examples)

Scenarios in this repo can assert against the following observable surfaces:

| # | Surface | Evidence | Example |
|---|---------|----------|---------|
| 1 | State files | JSON or other structured output files written by orchestrators, CLI tools, or test fixtures | `agents/<adwId>/state.json` |
| 2 | Recorded HTTP requests | Request logs captured by a mock HTTP server fronting the system under test | mock server `getRecordedRequests()` |
| 3 | Git artefacts | Branches, commits, pushes, and worktree state produced by the system under test | `git log --oneline` on the worktree branch |
| 4 | Exit codes | Termination status of subprocesses spawned by the test harness | `spawnSync(...).status` |
| 5 | Log streams | stdout/stderr captured from spawned processes and asserted against by substring or regex | `spawnSync(...).stdout` |

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
| G12 | `the mock GitHub API is configured to accept label applications` | Seeds mock-server state so POST /repos/.../issues/:n/labels returns 200 and records the call | mock-query | mock server state |
| G13 | `a per-issue feature file at {string} is seeded into the worktree for adwId {string} from fixture {string}` | Copies the named fixture (`test/fixtures/scenarios/promotion/<file>`) into the test worktree at the supplied path | subprocess | worktree artefact |
| G14 | `the seeded scenario in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated today` | Inserts `@promotion-suggested-<today>` into the tag block above the (single) seeded scenario header | subprocess | worktree artefact |
| G15 | `the seeded scenario in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated {int} days ago` | Inserts `@promotion-suggested-<today − N days>` into the tag block above the (single) seeded scenario header | subprocess | worktree artefact |
| G16 | `the seeded scenario named {string} in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated today` | For multi-scenario files: targets the scenario whose `Scenario:` line matches the given name and inserts `@promotion-suggested-<today>` | subprocess | worktree artefact |
| G17 | `the seeded scenario named {string} in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated {int} days ago` | Multi-scenario variant for N-days-ago pre-tagging | subprocess | worktree artefact |
| G18 | `the ADW codebase is checked out` | Background no-op; codebase is always present in the test environment | mock-query | test environment state |
| G19 | `the cron is polling the target repository {string} from a host checked out at {string}` | Sets up two-repo world in World; seeds targetRepo and hostRepo paths | mock-query | test harness world state |
| G20 | `a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}` | Seeds a pause-queue entry for the target repo with the given issue number | mock-query / subprocess | pause-queue state artefact |
| G21 | `a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}, with its worktree remote pointing at {string}` | Seeds a pause-queue entry for the target repo with correct git remote configured in the fixture worktree | subprocess | pause-queue + worktree artefacts |
| G22 | `the rate-limit probe reports the limit has cleared` | Stubs the Claude CLI probe to return exit 0 / no rate-limit text | subprocess | stub behaviour |
| G23 | `GitHub App authentication has been pinned to the repository {string} by a stray activation` | Calls `activateGitHubAppAuth` for a non-target repo to simulate stray pinned-auth state | phase-import / mock-query | recorded auth calls |
| G24 | `an upgrade regen worktree whose command file ".claude/commands/adw_init.md" is gitignored by the real copy-init-command step` | Inits a REAL temp git repo, commits a baseline `.adw/project.md`, then runs the real `copyAdwInitCommandToWorktree` so the command file lands untracked AND gitignored — the production double-exclusion state whose *recorded commit tree* is asserted downstream (never file-on-disk existence) | phase-import | git artefact (temp-repo worktree) |
| G25 | `an upgrade regen worktree with a tracked, modified ".claude/commands/adw_init.md" that is not gitignored` | Inits a REAL temp git repo, commits `.adw/project.md` plus a tracked `.claude/commands/adw_init.md`, then modifies the command file (no `.gitignore` entry) — the self-host case whose *recorded commit tree* is asserted downstream (never file-on-disk existence) | phase-import | git artefact (temp-repo worktree) |
| G26 | `the worktree has a pending regen change to {string}` | Writes regenerated content to the named path in the temp worktree, leaving it as a pending (uncommitted) change for the next commit to capture into its *tree* | phase-import | git artefact (temp-repo worktree) |

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
| W13 | `the pause-queue resume scan runs` | Invokes `resumeWorkflow` on the seeded pause-queue entry to attempt resumption | phase-import | recorded auth + comment calls |
| W14 | `the cron poll batch runs` | Invokes `checkAndTrigger` one cycle (or the `ensureAppAuthForRepo` + `fetchOpenIssues` slice) to simulate a single cron tick | phase-import | recorded auth + issue-fetch calls |
| W15 | `the framework upgrade commits the regen excluding {string}` | Drives the REAL `commitOps.commitChanges(realRun, …, { excludePaths: [<path>] })` over the temp worktree — the exact production call `adwUpgrade` makes — recording the produced commit; any throw is captured for the downstream assertions | phase-import | git artefact (recorded commit) |
| W16 | `the git/gh guard is run across the repository` | Runs the repository's git/gh guard (`bunx tsx adws/checkGitGhGuard.ts`) as a subprocess from the ADW checkout root; records its exit status and combined stdout/stderr on the World | subprocess | exit code + log stream |

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
| T12 | `the mock GitHub API recorded an application of the {string} label on issue {int}` | Queries recorded requests; asserts a POST /repos/.../issues/N/labels whose body contains the label name was captured | mock-query | recorded requests |
| T13 | `the mock harness recorded zero applications of the {string} label on issue {int}` | Asserts no recorded POST /repos/.../issues/N/labels carrying the named label | mock-query | recorded requests |
| T14 | `the mock harness recorded zero comment posts on issue {int}` | Queries recorded requests; asserts no POST /repos/.../issues/N/comments was captured | mock-query | recorded requests |
| T15 | `the artefact file at {string} in the worktree for adwId {string} carries a "@promotion-suggested-" tag dated today on the seeded scenario` | Reads the artefact file, locates the (single) seeded scenario header, asserts a `@promotion-suggested-<today>` token is present in its tag block | subprocess | file artefact |
| T16 | `the artefact file at {string} in the worktree for adwId {string} carries no "@promotion-suggested-" tag on the seeded scenario` | Reads the artefact file, locates the (single) seeded scenario header, asserts no `@promotion-suggested-*` token is present in its tag block | subprocess | file artefact |
| T17 | `the artefact file at {string} in the worktree for adwId {string} carries exactly one "@promotion-suggested-" tag on the seeded scenario` | Reads the artefact file, locates the (single) seeded scenario header, asserts exactly one `@promotion-suggested-*` token is present (defensive against the slice-#4 append-rather-than-refresh bug) | subprocess | file artefact |
| T18 | `the artefact file at {string} in the worktree for adwId {string} carries a "@promotion-suggested-" tag dated today on the scenario named {string}` | Multi-scenario variant of the dated-today assertion; targets the scenario whose `Scenario:` line matches the given name | subprocess | file artefact |
| T19 | `the artefact file at {string} in the worktree for adwId {string} carries no "@promotion-suggested-" tag on the scenario named {string}` | Multi-scenario variant of the no-tag assertion | subprocess | file artefact |
| T20 | `the mock GitHub API recorded a comment on issue {int} containing the seeded scenario name {string}` | Asserts a recorded comment POST whose body contains the supplied scenario name substring | mock-query | recorded requests |
| T21 | `the mock harness recorded zero comment posts on issue {int} referencing the seeded scenario name {string}` | Asserts no recorded comment POST whose body contains the supplied scenario name substring | mock-query | recorded requests |
| T22 | `the ADW TypeScript type-check passes` | Runs `bunx tsc --noEmit` in the ADW codebase; asserts exit 0 | subprocess | exit code |
| T23 | `the resume authenticates against the target repository {string}` | Asserts recorded `activateGitHubAppAuth` or `ensureAppAuthForRepo` call with expected owner/repo | mock-query / phase-import | recorded auth calls |
| T24 | `the resume does not authenticate against the cron host's own repository {string}` | Inverse of T23: asserts no auth call for the cron host's own repository | mock-query / phase-import | recorded auth calls |
| T25 | `the resumed comment is recorded on issue {int} in the target repository {string}` | Asserts a POST to `/repos/{owner}/{repo}/issues/{n}/comments` was captured on the target repo | mock-query | recorded requests |
| T26 | `the resume completes without a remote-owner-mismatch failure between the target worktree and the declared repository` | Asserts no error thrown / no error comment recorded during resume | phase-import / mock-query | error state + recorded requests |
| T27 | `the mock harness recorded zero comment posts on issue {int} in the cron host's own repository {string}` | Asserts no comment recorded for the cron host's own repository | mock-query | recorded requests |
| T28 | `GitHub App authentication is re-asserted for the target repository {string} before any issues are fetched` | Asserts `ensureAppAuthForRepo(targetOwner, targetRepo)` recorded before the first `GET /repos/.../issues` call | mock-query | recorded auth + fetch call order |
| T29 | `the poll batch fetches open issues from the target repository {string}` | Asserts a `GET /repos/{owner}/{repo}/issues` recorded | mock-query | recorded requests |
| T30 | `the target repository's open issue {int} is visible to the poller` | Asserts the fetched issue list contains issue N | mock-query | recorded requests / response |
| T31 | `the regen commit is recorded on the worktree branch` | Asserts the commit call did NOT throw AND HEAD advanced past the pre-commit baseline (`git rev-parse HEAD`) — i.e. a new commit exists on the temp worktree branch. Asserts the produced git artefact, NOT file-on-disk state. (RED/GREEN pivot: before the #729 fix `commitChanges` throws on the doubly-excluded ignored path, so no commit is recorded.) | phase-import | git artefact (commit on branch) |
| T32 | `the recorded commit's tree includes {string}` | Asserts the named path is a member of the recorded commit's tree (`git show --name-only --format= HEAD`). Asserts commit-tree membership — the produced git artefact — NOT file-on-disk existence | phase-import | git artefact (commit tree) |
| T33 | `the recorded commit's tree excludes {string}` | Asserts the named path is NOT a member of the recorded commit's tree (`git show --name-only --format= HEAD`). Asserts commit-tree membership — the produced git artefact — NOT file-on-disk existence | phase-import | git artefact (commit tree) |
| T34 | `the git/gh guard reports no violations` | Asserts the exit status W16 recorded is 0; the guard's captured output is surfaced on failure | subprocess | exit code |

---

## Given/When/Then — Python Fixture E2E (@python-e2e)

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-PY1 | `the Python fixture target {string} is initialised as an ADW target repo` | Calls `setupFixtureRepo(fixtureName)` to copy `test/fixtures/<name>/` into a fresh temp git repo; stores the result on World as `pythonFixture` | phase-import | worktree artefact |
| W-PY1 | `ADW runs the scenario proof pipeline against the Python fixture for issue {int}` | Creates a temp `proofDir`, calls `loadProjectConfig(repoDir)` then `runScenarioProof(...)` over the fixture, stores `ScenarioProofResult` on World | phase-import | proof run artefact |
| T-PY1 | `the scenario proof for the Python fixture is not skipped` | Asserts `tagResults[0].skipped === false` — the `.py` step-def gate recognised the generated step defs so the run was not silently skipped | phase-import | proof run artefact |
| T-PY2 | `the scenario proof reports {int} passed and {int} failed` | Asserts `tagResults[0].counts` equals `{ passed, failed }` — the JUnit parser resolved the correct tally from the fixture's emitted report | phase-import | proof run artefact |
| T-PY3 | `the scenario proof records no blocker failures` | Asserts `hasBlockerFailures === false` | phase-import | proof run artefact |
| T-PY4 | `the proof run harvests at least {int} screenshot artifact` | Calls `harvestProofArtifacts(result.artifactsDir)`, asserts length ≥ N | phase-import | harvested image artefact |
| T-PY5 | `the composed proof comment shows the pass tally and an inline screenshot` | Calls `formatPrProofComment` with `r2Configured: true` and a fake-upload artifact list; asserts the produced markdown contains the tally and a `<details>` inline-screenshot embed | phase-import | produced comment body |
| T-PY6 | `publishing the proof posts a PR comment carrying the pass tally` | Calls `publishPrProof` with a capturing commenter; asserts the captured body contains the pass tally and `ADW_SIGNATURE` | phase-import | captured comment body |

---

## Given/When/Then — Framework Content Hash (@adw-537)

These phrases drive the pure `computeFrameworkHash` module (`adws/core/hashComputer.ts`) via an
in-process import (phase-import pattern). The fixture `adw_init` spec and fixture input files each
scenario writes are *inputs to the system under test* — throwaway temp-directory fixtures the step
itself constructs — never framework source files. Every assertion targets a runtime artefact: the
returned SHA256 digest, or the error the module raises. No step reads a source file's contents and
asserts against them, satisfying the Rot-Detection Rubric.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-HC1 | `a fixture framework whose adw_init spec declares hash inputs:` | Creates a throwaway temp directory and writes its `.claude/commands/adw_init.md` with a `hashInputs:` frontmatter list naming the given paths | phase-import | fixture input (SUT input, not source) |
| G-HC2 | `a fixture framework whose adw_init spec omits the hash inputs frontmatter` | Creates a throwaway temp directory and writes its `.claude/commands/adw_init.md` with frontmatter that has no `hashInputs:` key | phase-import | fixture input (SUT input, not source) |
| G-HC3 | `the fixture input file {string} contains {string}` | Writes the named file under the fixture framework root with the given content | phase-import | fixture input (SUT input, not source) |
| G-HC4 | `a second fixture framework whose adw_init spec declares hash inputs:` | Creates a second, independent throwaway temp directory and writes its `.claude/commands/adw_init.md` with a `hashInputs:` frontmatter list naming the given paths | phase-import | fixture input (SUT input, not source) |
| G-HC5 | `the fixture input file {string} in the second fixture framework contains {string}` | Writes the named file under the second fixture framework root with the given content | phase-import | fixture input (SUT input, not source) |
| W-HC1 | `the framework content hash is computed for the fixture framework` | Calls `computeFrameworkHash(fixtureRoot)` in-process and appends the returned digest to the recorded-hashes list | phase-import | returned digest (artefact) |
| W-HC2 | `the framework content hash computation is attempted for the fixture framework` | Calls `computeFrameworkHash(fixtureRoot)` in-process inside try/catch, recording either the returned digest or the thrown error | phase-import | returned digest / raised error (artefact) |
| W-HC3 | `the hash inputs in the fixture adw_init spec are reordered to:` | Rewrites the fixture framework's `hashInputs:` frontmatter list in the given order | phase-import | fixture input (SUT input, not source) |
| W-HC4 | `the fixture input file {string} is modified by a single byte` | Flips one byte of the named fixture input file's existing content | phase-import | fixture input (SUT input, not source) |
| W-HC5 | `the framework content hash is computed for the second fixture framework` | Calls `computeFrameworkHash(secondFixtureRoot)` in-process and appends the returned digest to the recorded-hashes list | phase-import | returned digest (artefact) |
| W-HC6 | `the framework content hash is computed for the ADW framework under test` | Calls `computeFrameworkHash(process.cwd())` in-process over the real ADW checkout and appends the returned digest to the recorded-hashes list | phase-import | returned digest (artefact) |
| T-HC1 | `the most recent computed hash is a 64-character lowercase hexadecimal SHA256 digest` | Asserts the last entry in the recorded-hashes list matches `^[0-9a-f]{64}$` | phase-import | returned digest (artefact) |
| T-HC2 | `the recorded hashes are all identical` | Asserts every entry in the recorded-hashes list equals the first entry | phase-import | returned digests (artefact) |
| T-HC3 | `the recorded hashes are all different` | Asserts every entry in the recorded-hashes list is pairwise distinct | phase-import | returned digests (artefact) |
| T-HC4 | `the hash computation fails with an error reporting the absent hash inputs declaration` | Asserts an error was thrown whose message mentions `hashInputs` | phase-import | raised error (artefact) |
| T-HC5 | `the hash computation fails with an error that names the missing input file {string}` | Asserts an error was thrown whose message contains the named missing file | phase-import | raised error (artefact) |

This scenario also reuses two already-registered phrases — no new rows needed: `the ADW codebase is
checked out` (G18, Background no-op) and `the ADW TypeScript type-check passes` (T22).

---

## Given/When/Then — Pause-Queue Ownership and Remove-Before-Spawn Resume (@adw-911)

These phrases drive the real pause-queue modules in-process (phase-import): the pure decider
(`decidePauseQueueAction`), the scanner (`scanPauseQueue`) and its resume path. They also drive one
real `adws/triggers/trigger_cron.ts --target-repo` subprocess. Their inputs are fixtures the steps
construct: decider input entries and probe classifications, entries seeded into the real queue
state file (saved and restored around every scenario), fixture orchestrator scripts in throwaway
temp worktrees, a stubbed probe exec seam, a pinned clock, and a spawn lock held by a throwaway
process. Every assertion targets a runtime artefact:

- the action the decider returns;
- the pause-queue state file `agents/paused_queue.json` (entry presence, strike count, last-probe
  time, reset time, limit type, target repository);
- the queue snapshot taken at the scanner's spawn seam;
- the launches the fixture orchestrators record;
- the probe calls recorded at the exec seam;
- the comments the mock GitHub API records.

No step reads a source file, satisfying the Rot-Detection Rubric.

`{scanning cron}` below is one of two launch identities the scenario names in prose:

- `the cron polling the target repository "<owner/repo>"`: launched with `--target-repo`; its
  identity is that repository; it is not the self-host cron.
- `the self-host cron on a host checked out at "<owner/repo>"`: launched without `--target-repo`;
  its identity is its checkout's repository; it is the self-host cron.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-PQ1 | `the Claude CLI answers the rate-limit probe with exit code {int} and {word}:` | Loads the rate-limit probe's injected exec stub with the exit code and the DocString as its `stdout` or `stderr` (`{word}`); every probe a later scan runs receives that reply, and each call is recorded | phase-import | probe exec stub (SUT input) |
| G-PQ2 | `the rate-limit probe classification is {string}` | Sets the probe verdict (`clear` / `failed` / `unknown` / `limited`) the decider is consulted with | phase-import | decider input (SUT input) |
| G-PQ3 | `the rate-limit probe classification is {string} with a {string} limit that resets at {string}` | Sets a probe verdict carrying the reported limit type and reset instant | phase-import | decider input (SUT input) |
| G-PQ4 | `a pause-queue entry recorded for the target repository {string}, with a reset time of {string} and {int} probe failure(s)` | Builds the decider's input entry with `--target-repo <repo>` in its `extraArgs`, the given `resetsAt` and strike count | phase-import | decider input (SUT input) |
| G-PQ5 | `a pause-queue entry recorded for the target repository {string}, with no reset time and {int} probe failure(s)` | As G-PQ4, with no `resetsAt` | phase-import | decider input (SUT input) |
| G-PQ6 | `a pause-queue entry recorded for no target repository, with a reset time of {string} and {int} probe failure(s)` | Builds a decider input entry with no `extraArgs` (a workflow launched without `--target-repo`), the given `resetsAt` and strike count | phase-import | decider input (SUT input) |
| G-PQ7 | `a pause-queue entry recorded for no target repository, with no reset time and {int} probe failure(s)` | As G-PQ6, with no `resetsAt` | phase-import | decider input (SUT input) |
| G-PQ8 | `a workflow for issue {int} is paused in the rate-limit queue with no target repository` | Seeds the real queue state file exactly as G20 does but with no `extraArgs` key — how the pause path records a workflow launched without `--target-repo` | phase-import | pause-queue state artefact |
| G-PQ9 | `the paused workflow for issue {int} has already recorded {int} unknown probe failures` | Writes the seeded entry's `probeFailures` into the queue file and makes it that entry's baseline | phase-import | pause-queue state artefact |
| G-PQ10 | `the paused workflow for issue {int} was last probed at {string}` | Writes the seeded entry's `lastProbeAt` into the queue file | phase-import | pause-queue state artefact |
| G-PQ11 | `the paused workflow for issue {int} was queued with a {string} limit that resets at {string}` | Writes the seeded entry's `rateLimitType` and `resetsAt` into the queue file | phase-import | pause-queue state artefact |
| G-PQ12 | `the cron host's clock reads {string}` | Pins the instant every later scan in the scenario hands its decider | phase-import | scanner input (SUT input) |
| G-PQ13 | `the orchestrator of the paused workflow for issue {int} exits as soon as it starts on its first launch` | Rewrites the seeded fixture orchestrator: its first launch records its argv and exits 1 at once; every later launch records its argv and stays alive (state kept in a marker file in the temp worktree) | phase-import | fixture orchestrator (SUT input) |
| G-PQ14 | `another live process holds the spawn lock for issue {int} in the repository {string}` | Starts a throwaway long-lived process and takes the real per-issue spawn lock for `<repo>#<issue>` under its pid | phase-import | spawn-lock state artefact |
| W-PQ1 | `the pause-queue decider is consulted at {string} by {scanning cron}` | Calls the pure `decidePauseQueueAction` with the prepared entry and probe classification, the given instant, the strike budget, and the named cron's launch identity; records the returned action | phase-import | returned decider action (artefact) |
| W-PQ2 | `the pause-queue scanner of {scanning cron} runs {int} probe cycle(s)` | Runs the real `scanPauseQueue` N times as the named cron, at cycle counts that are multiples of `PROBE_INTERVAL_CYCLES`. Each run uses the probe stub, any pinned clock, and a spawn seam that snapshots the queue file before delegating to the real `child_process.spawn`. After each cycle it replays the recorded `gh issue comment` calls against the mock GitHub API, and it counts the probe calls the run made | phase-import | queue state + fixture launches + recorded requests |
| W-PQ3 | `the pause-queue scanner of {scanning cron} runs two overlapping probe cycles, the second starting while the first cycle's relaunch of issue {int} is still inside its readiness window` | Starts one real scan without awaiting it; as soon as its spawn seam launches the issue's orchestrator, runs a second scan to completion, then awaits the first — real timers, no fakes | phase-import | queue state + fixture launches |
| W-PQ4 | `the process holding the spawn lock for issue {int} in the repository {string} exits` | Kills the process G-PQ14 started and waits until it is gone, leaving a stale lock the resume path clears by itself | phase-import | spawn-lock state artefact |
| W-PQ5 | `a cron trigger process launched with --target-repo {string} completes its first probing poll tick` | Spawns a real `bunx tsx adws/triggers/trigger_cron.ts --target-repo <repo>` with a fake PAT, blank GitHub App variables, a throwaway `TARGET_REPOS_DIR`, `PROBE_INTERVAL_CYCLES=1` and the Claude CLI stub. Waits for its startup line and then its first tick's `POLL:` or `checkAndTrigger: tick failed` line, then replays the recorded comments | subprocess | log stream + queue state + fixture launches |
| T-PQ1 | `the pause-queue decider returns {string}` | Asserts the kind of the action W-PQ1 recorded (`resume`, `skip_before_reset`, `skip_not_owner`, `count_strike`, `evict`, `refresh_reset`) | phase-import | returned decider action (artefact) |
| T-PQ2 | `the pause queue still holds the workflow for issue {int}` | Reads the queue state file; asserts an entry with the seeded adwId is present | phase-import | pause-queue state artefact |
| T-PQ3 | `the pause queue no longer holds the workflow for issue {int}` | Reads the queue state file; asserts no entry with the seeded adwId remains | phase-import | pause-queue state artefact |
| T-PQ4 | `the pause queue no longer held the workflow for issue {int} when its orchestrator was spawned` | Asserts the spawn seam was called for the issue's adwId and that the queue-file snapshot it took at that moment held no entry for it | phase-import | spawn-seam queue snapshot (artefact) |
| T-PQ5 | `the pause queue entry for issue {int} records {int} probe failure(s)` | Asserts the entry's `probeFailures` in the queue state file | phase-import | pause-queue state artefact |
| T-PQ6 | `the pause queue entry for issue {int} has not gained a probe failure` | Asserts the entry is still queued with `probeFailures` equal to its seeded baseline | phase-import | pause-queue state artefact |
| T-PQ7 | `the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:` | For each row of the `issue` data table, asserts the entry is still queued with `probeFailures` at its baseline | phase-import | pause-queue state artefact |
| T-PQ8 | `the pause queue entry for issue {int} still records its last probe at {string}` | Asserts the entry's `lastProbeAt` is the same instant as the given timestamp | phase-import | pause-queue state artefact |
| T-PQ9 | `the pause queue entry for issue {int} records the reset time {string}` | Asserts the entry's `resetsAt` is the same instant as the given timestamp | phase-import | pause-queue state artefact |
| T-PQ10 | `the pause queue entry for issue {int} records the limit type {string}` | Asserts the entry's `rateLimitType` | phase-import | pause-queue state artefact |
| T-PQ11 | `the pause queue entry for issue {int} still records the target repository {string}` | Asserts `--target-repo <repo>` is among the entry's `extraArgs` | phase-import | pause-queue state artefact |
| T-PQ12 | `the scanner did not run the rate-limit probe` | Asserts the probe exec stub recorded no call during the last scanner run | mock-query | recorded probe calls |
| T-PQ13 | `the scanner ran the rate-limit probe once per probe cycle` | Asserts the probe exec stub recorded exactly one call per cycle the last scanner run requested | mock-query | recorded probe calls |
| T-PQ14 | `the paused workflow for issue {int} is relaunched under its original adwId` | Waits for the fixture orchestrator's launch log; asserts its first launch's argv starts `[issueNumber, adwId]` | phase-import / subprocess | fixture launch log (artefact) |
| T-PQ15 | `the paused workflow for issue {int} is relaunched with the target repository {string}` | Asserts `--target-repo <repo>` is among the first launch's recorded argv | phase-import / subprocess | fixture launch log (artefact) |
| T-PQ16 | `the paused workflow for issue {int} has been relaunched {int} time(s)` | Waits (bounded) until the fixture's launch log holds exactly N launches, then asserts N | phase-import / subprocess | fixture launch log (artefact) |
| T-PQ17 | `the paused workflow for issue {int} has not been relaunched` | Waits briefly for any asynchronous launch record, then asserts the fixture's launch log holds no launch | phase-import / subprocess | fixture launch log (artefact) |

This scenario also reuses already-registered phrases, so they need no new rows: `the ADW codebase
is checked out` (G18, Background), G1, G20, G22, T2, T14, T22, T25, and the generic W16/T34 above.
