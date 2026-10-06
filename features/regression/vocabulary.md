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

1. **Subprocess** — a real ADW process (an orchestrator, the workflow-init driver, a cron trigger)
   started asynchronously (`spawn` with `detached: true`, never `spawnSync`) through the hermetic
   subprocess harness described under "Smoke processes" below. The child reaches GitHub only through
   a `gh` shadow backed by the mock server, and a timeout kills its whole process group. Asserts
   against state files written by the orchestrator, recorded GitHub API calls captured by the mock
   server, the process's output, or the launches a cron made.

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
| G4 | `an issue {int} exists in the mock issue tracker` | Applies an issue fixture to mock-server state for issue number N: an open issue created and last updated an hour ago, so the cron's grace period has passed, labelled `adw:feature`, which the cron's eligibility filter admits and the webhook gatekeeper routes to the SDLC orchestrator. Replaces the issue map, so the scenario holds exactly this issue, and records N in `World.seededIssues` | mock-query | mock server state |
| G5 | `no spawn lock exists for issue {int}` | Removes the spawn-gate lock file the spawn gate writes for `acme/widgets#N` (`getSpawnLockFilePath`, under `agents/spawn_locks/`), whoever holds it; a lock that is already absent is fine | phase-import | spawn-lock artefact |
| G6 | `a state file exists for adwId {string} at stage {string}` | Writes a minimal state JSON for adwId under the test worktree at the given workflow stage | subprocess / phase-import | state file artefact |
| G7 | `the cron sweep is configured with empty queue` | Keeps only the issues the scenario seeded (`World.seededIssues`, set by G4) in the mock-server issue list, so the server's default fixture issues are gone and the seeded ones stay; with none seeded the list is empty and the cron probe finds no eligible issue | mock-query | mock server state |
| G8 | `the mock GitHub API records all PR-list calls` | Enables the mock server to record GET /repos/.../pulls requests (default on; explicit step for clarity) | mock-query | recorded requests |
| G9 | `the claude-cli-stub is loaded with fixture {string}` | Sets `MOCK_FIXTURE_PATH` env var in the harness env to the named payload path | subprocess | stub behaviour |
| G10 | `the mock GitHub API is configured to return PR {int} as merged` | Patches the mock-server PR state so PR N has `merged: true` and `state: closed`, in place: every other field an earlier Given recorded for it, its head branch above all, is kept | mock-query | mock server state |
| G11 | `the worktree for adwId {string} is initialised at branch {string}` | Materialises `test/fixtures/cli-tool/` as a git repository in a temp directory under `os.tmpdir()` whose name carries the adwId: a `.gitignore` for the stub's marker, payload and invocation files, `git init -b main`, one commit under the harness identity, a bare clone of it as `origin`, fetched so `refs/remotes/origin/main` exists, and the branch checked out. Every git call uses `REAL_GIT_PATH` when set, since under the hooks the git-mock turns `clone` and `fetch` into no-ops. Registers the worktree in World, and its removal on World's cleanup list, which the `@regression` After hook runs | phase-import | worktree artefact |
| G12 | `the mock GitHub API is configured to accept label applications` | Seeds mock-server state so POST /repos/.../issues/:n/labels returns 200 and records the call | mock-query | mock server state |
| G13 | `a per-issue feature file at {string} is seeded into the worktree for adwId {string} from fixture {string}` | Copies the named fixture (`test/fixtures/scenarios/promotion/<file>`) into the test worktree at the supplied path | subprocess | worktree artefact |
| G14 | `the seeded scenario in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated today` | Inserts `@promotion-suggested-<today>` into the tag block above the (single) seeded scenario header | subprocess | worktree artefact |
| G15 | `the seeded scenario in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated {int} days ago` | Inserts `@promotion-suggested-<today − N days>` into the tag block above the (single) seeded scenario header | subprocess | worktree artefact |
| G16 | `the seeded scenario named {string} in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated today` | For multi-scenario files: targets the scenario whose `Scenario:` line matches the given name and inserts `@promotion-suggested-<today>` | subprocess | worktree artefact |
| G17 | `the seeded scenario named {string} in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated {int} days ago` | Multi-scenario variant for N-days-ago pre-tagging | subprocess | worktree artefact |
| G18 | `the ADW codebase is checked out` | Background no-op; codebase is always present in the test environment. Defined in `features/regression/step_definitions/givenSteps.ts`. | mock-query | test environment state |
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
| W1 | `the {string} orchestrator is invoked with adwId {string} and issue {int}` | Runs the named orchestrator as a child process through the hermetic subprocess harness (see "Smoke processes"), against the `acme/widgets` workspace the harness lays out under a temporary `TARGET_REPOS_DIR`, with `--issue-type`, `--target-repo` and `--clone-url`. The name is one of `sdlc`, `chore`, `plan`, `build`, `test`, `patch`, `merge`, `document`, `pr-review` or `promotion-sweep`; any other name (there is no `review` and no `init`) fails the step, listing them. Records the exit code and the output, then replays the child's GitHub writes against the mock. `promotion-sweep` has no workflow and no worktree of its own and acts on the workspace itself, so the step registers the workspace as the worktree of the adwId, which T18 and T19 read, and has the `gh` shadow land the pull requests the sweep merges on the workspace's default branch. Fails, naming the hook it needs, in a scenario with no subprocess harness, one that carries neither `@subprocess` nor `@webhook` | subprocess | exit code + state file + recorded requests |
| W9 | `the workflow is initialised with config {string}` | Runs the init driver (`features/regression/drivers/workflowInitDriver.ts`) as a child process the way W1 runs an orchestrator: `initializeWorkflow` for the orchestrator the label names (`<script stem>-<adwId>`, such as `adwPlan-surface-01`) and for the one issue the scenario seeded, then stops. Records the exit code and the output, then replays the child's GitHub writes. Fails in a scenario without the subprocess harness | subprocess | exit code + state file + output + recorded requests |
| W10 | `the cron probe runs once` | Runs `adws/triggers/trigger_cron.ts --target-repo acme/widgets` as a child process through the hermetic subprocess harness, with the launch recorder intercepting every `bunx` launch, until its first `POLL:` line; waits for the launch it makes for a candidate and for the launches to settle, kills the process group and replays. Records no exit code: the harness killed the cron, so T5 fails after it. Fails in a scenario without the subprocess harness | subprocess | launch records + recorded requests |
| W13 | `the pause-queue resume scan runs` | Invokes `resumeWorkflow` on the seeded pause-queue entry to attempt resumption | phase-import | recorded auth + comment calls |
| W14 | `the cron poll batch runs` | Invokes `checkAndTrigger` one cycle (or the `ensureAppAuthForRepo` + `fetchOpenIssues` slice) to simulate a single cron tick | phase-import | recorded auth + issue-fetch calls |
| W15 | `the framework upgrade commits the regen excluding {string}` | Drives the REAL `commitOps.commitChanges(realRun, …, { excludePaths: [<path>] })` over the temp worktree — the exact production call `adwUpgrade` makes — recording the produced commit; any throw is captured for the downstream assertions | phase-import | git artefact (recorded commit) |
| W16 | `the git/gh guard is run across the repository` | Runs the repository's git/gh guard (`bunx tsx adws/checkGitGhGuard.ts`) as a subprocess from the ADW checkout root; records its exit status and combined stdout/stderr on the World | subprocess | exit code + log stream |

W2–W8 and W11 are retired: no scenario ever ran them. Phases are driven by W-S1–W-S4 and webhooks by W-WH1–W-WH5 and W-CD1, and the numbers are not reused.

---

## Then — State / Mock / Artefact Assertions

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| T1 | `the state file for adwId {string} records workflowStage {string}` | Reads `agents/<adwId>/state.json`, or failing that `.adw/state.json` under the worktree G6 or G11 registered for the adwId, and asserts its `workflowStage` field equals the expected value. Fails naming every path it tried when no state file exists. Never reads source files, whichever hooks ran. (State file is an *artefact*, not a source file — permitted read.) | subprocess / phase-import | state file artefact |
| T2 | `the mock GitHub API recorded a comment on issue {int}` | Queries recorded requests; asserts at least one POST /repos/.../issues/N/comments was captured | mock-query | recorded requests |
| T3 | `the mock GitHub API recorded a comment containing the text {string}` | Queries recorded requests; parses comment bodies; asserts one contains the expected string | mock-query | recorded requests |
| T4 | `the git-mock recorded a commit on branch {string}` | Queries git-mock invocations in World; asserts a `git commit` call on the named branch was recorded | mock-query | git invocations |
| T5 | `the orchestrator subprocess exited {int}` | Reads `World.lastExitCode`; asserts it equals N. The field is `-1` until a subprocess When step (W1, W9) records an exit code, so the step fails when no subprocess ran, and after W10, which kills the cron it runs and records none. Never reads source files, whichever hooks ran. | subprocess | exit code |
| T6 | `the spawn-gate lock for issue {int} is released` | Asserts no lock file exists at `getSpawnLockFilePath({owner:'acme',repo:'widgets'}, N)`. Fails naming that path while any process holds the lock | phase-import | spawn-lock artefact |
| T7 | `the mock harness recorded zero PR-merge calls` | Queries recorded requests; asserts no `PUT /repos/.../pulls/:n/merge` was captured | mock-query | recorded requests |
| T8 | `the mock GitHub API recorded a PR creation for issue {int}` | Queries recorded requests; asserts a POST /repos/.../pulls was captured referencing issue N | mock-query | recorded requests |
| T9 | `the state file for adwId {string} records no error` | Reads state JSON; asserts no `error` field or `errorMessage` is set | subprocess / phase-import | state file artefact |
| T10 | `the mock GitHub API recorded {int} total API calls` | Queries recorded requests length; asserts exact count | mock-query | recorded requests |
| T11 | `the git-mock recorded a push to branch {string}` | Reads the git-mock's invocation log, `MockContext.gitLogPath`. `setupMockInfrastructure` creates it empty per setup and points `MOCK_GIT_LOG` at it. `test/mocks/git-remote-mock.ts` appends one JSONL `{ subcommand, args, cwd }` per network subcommand it intercepts (`push`, `fetch`, `clone`, `pull`, `ls-remote`). The step asserts a `push` whose args include the branch. Fails listing the recorded invocations | mock-query | git-mock invocation log |
| T12 | `the mock GitHub API recorded an application of the {string} label on issue {int}` | Queries recorded requests; asserts a POST /repos/.../issues/N/labels whose body contains the label name was captured | mock-query | recorded requests |
| T13 | `the mock harness recorded zero applications of the {string} label on issue {int}` | Asserts no recorded POST /repos/.../issues/N/labels carrying the named label | mock-query | recorded requests |
| T14 | `the mock harness recorded zero comment posts on issue {int}` | Queries recorded requests; asserts no POST /repos/.../issues/N/comments was captured | mock-query | recorded requests |
| T15 | `the artefact file at {string} in the worktree for adwId {string} carries a "@promotion-suggested-" tag dated today on the seeded scenario` | Reads the artefact file, locates the (single) seeded scenario header, asserts a `@promotion-suggested-<today>` token is present in its tag block | subprocess | file artefact |
| T16 | `the artefact file at {string} in the worktree for adwId {string} carries no "@promotion-suggested-" tag on the seeded scenario` | Reads the artefact file, locates the (single) seeded scenario header, asserts no `@promotion-suggested-*` token is present in its tag block | subprocess | file artefact |
| T17 | `the artefact file at {string} in the worktree for adwId {string} carries exactly one "@promotion-suggested-" tag on the seeded scenario` | Reads the artefact file, locates the (single) seeded scenario header, asserts exactly one `@promotion-suggested-*` token is present (defensive against the slice-#4 append-rather-than-refresh bug) | subprocess | file artefact |
| T18 | `the artefact file at {string} in the worktree for adwId {string} carries a "@promotion-suggested-" tag dated today on the scenario named {string}` | Multi-scenario variant of the dated-today assertion. Reads the file under the worktree registered for the adwId and asserts the token among the tags of the scenario whose `Scenario:` line matches the given name: the tag lines directly above that line and those directly above `Feature:`, which every scenario of the feature inherits. The promotion sweep writes its marker into the Feature's block | subprocess | file artefact |
| T19 | `the artefact file at {string} in the worktree for adwId {string} carries no "@promotion-suggested-" tag on the scenario named {string}` | Multi-scenario variant of the no-tag assertion, over the same tags as T18. After a promotion sweep it reads the workspace's default branch as the `gh` shadow's landing left it, so it fails when the sweep suggested the scenario | subprocess | file artefact |
| T20 | `the mock GitHub API recorded a comment on issue {int} containing the seeded scenario name {string}` | Asserts a recorded comment POST whose body contains the supplied scenario name substring | mock-query | recorded requests |
| T21 | `the mock harness recorded zero comment posts on issue {int} referencing the seeded scenario name {string}` | Asserts no recorded comment POST whose body contains the supplied scenario name substring | mock-query | recorded requests |
| T22 | `the ADW TypeScript type-check passes` | Runs `bunx tsc --noEmit --incremental false` at the ADW repo root and asserts exit 0. Build info is disabled so the check writes nothing into the checkout, which is read-only in the Docker leg. | subprocess | exit code |
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

## Given/When/Then — Framework Content Hash (@framework-hash)

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

## Given/When/Then — Pause Queue Reset-Time Wait (@pause-queue-reset-time)

These phrases drive three things in-process (phase-import pattern): the real pause path (`runPhase`
rejecting with a `RateLimitError`), the pure pause-queue decider (`decidePauseQueueAction`) and the
real pause-queue scanner (`scanPauseQueue`). The Claude CLI is replaced by an injected probe exec
seam, and `gh` is shadowed on `PATH` with its comment posts replayed against the mock GitHub API.
Relaunches are caught by a fixture orchestrator or a `bunx` shadow. Every assertion targets a
runtime artefact: the pause-queue state file (`agents/paused_queue.json`), the workflow's top-level
state file (`agents/<adwId>/state.json`), the action the decider returns, the probe invocations
recorded at the exec seam, the argv a relaunch records, or the requests the mock GitHub API
recorded. No step reads, greps or parses a source file, satisfying the Rot-Detection Rubric. The
definitions live in `feature-910.steps.ts` and the pause-queue harness it builds on,
`feature-902.steps.ts` and `feature-902-queue.steps.ts`.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-PQ1 | `a workflow for issue {int} is running its {string} phase for the target repository {string}` | Builds a `WorkflowConfig` for a fresh adwId (throwaway worktree and orchestrator state directory, the given target repository, no repo context so the pause path posts nothing) and writes its top-level state at stage `running` | phase-import | state file artefact |
| G-PQ2 | `a pause-queue entry with a reset time of {string} and {int} probe failures` | Builds an in-memory `PausedWorkflow` targeting `acme/widgets` with the given ISO-8601 `resetsAt` and probe-failure count, as the decider's entry input | phase-import | decider input |
| G-PQ3 | `a pause-queue entry with no reset time and {int} probe failures` | As G-PQ2, with no `resetsAt` | phase-import | decider input |
| G-PQ4 | `the rate-limit probe classification is {string}` | Sets the decider's `ProbeClassification` to the given verdict (`clear`, `limited`, `failed`, `unknown`) with no reset facts | phase-import | decider input |
| G-PQ5 | `the rate-limit probe classification is {string} with a {string} limit that resets at {string}` | As G-PQ4, plus the limit type and `resetsAt` (epoch seconds converted from the given ISO-8601 instant, as the probe classifier reports it) | phase-import | decider input |
| G-PQ6 | `the cron host's clock reads {string}` | Pins the instant the scanner hands the decider through its `now` seam; a later use moves it (also used as a When step); cleared after each scenario | phase-import | scanner clock seam |
| G-PQ7 | `the paused workflow for issue {int} was queued with a {string} limit that resets at {string}` | Writes `rateLimitType` and the ISO-8601 `resetsAt` onto the issue's seeded entry in the pause-queue state file | phase-import | pause-queue state artefact |
| G-PQ8 | `the paused workflow for issue {int} has already recorded {int} unknown probe failures` | Sets the issue's seeded entry's `probeFailures` in the pause-queue state file and records it as the baseline for "has not gained a probe failure" | phase-import | pause-queue state artefact |
| G-PQ9 | `a workflow for issue {int} was paused in the rate-limit queue for the target repository {string} by a release that recorded no reset time or limit type` | Writes a legacy-shaped entry (no `resetsAt`, no `rateLimitType`) as raw JSON straight into the pause-queue state file, bypassing `appendToPauseQueue`, pointing at a fixture orchestrator | phase-import | pause-queue state artefact |
| G-PQ10 | `the Claude CLI answers the rate-limit probe with exit code {int} and {word}:` | Sets the injected probe exec seam's canned reply: the exit code, and the doc-string body on `stdout` or `stderr` | phase-import | stub behaviour (probe exec seam) |
| W-PQ1 | `the {string} phase is stopped by a rate-limit error carrying a {string} limit that resets at {string}` | Drives the real pause path: `runPhase` with a phase function that throws `RateLimitError(phase, { rateLimitType, resetsAt })` (`resetsAt` in epoch seconds), `process.exit` intercepted for the call; registers the entry the pause path wrote | phase-import | pause-queue + state file artefacts |
| W-PQ2 | `the {string} phase is stopped by a rate-limit error carrying a {string} limit with no reset time` | As W-PQ1, with a limit type only | phase-import | pause-queue + state file artefacts |
| W-PQ3 | `the {string} phase is stopped by a rate-limit error carrying no limit type and no reset time` | As W-PQ1, with no limit facts | phase-import | pause-queue + state file artefacts |
| W-PQ4 | `the pause-queue decider is consulted at {string}` | Calls the real pure `decidePauseQueueAction` with the entry, the classification, the given instant, the production strike budget (`MAX_UNKNOWN_PROBE_FAILURES`) and the `acme/widgets` scanning cron; records the returned action | phase-import | returned action |
| W-PQ5 | `the pause-queue scanner runs {int} probe cycle(s)` | Runs the real `scanPauseQueue` N times as the `acme/widgets` cron (cycle counts that are multiples of `PROBE_INTERVAL_CYCLES`), through the injected probe and the pinned clock when one is set; replays the shadowed `gh issue comment` posts against the mock GitHub API; records the probe invocation count before and after. Defined as the regex `^the pause-queue scanner runs (\d+) probe cycles?$` | phase-import | pause-queue state + recorded requests + probe invocations |
| T-PQ1 | `the workflow for issue {int} is recorded at workflow stage {string}` | Reads the top-level state file of the issue's adwId (`agents/<adwId>/state.json`); asserts `workflowStage` | phase-import | state file artefact |
| T-PQ2 | `the pause queue entry for issue {int} records the limit type {string}` | Asserts the issue's entry in the pause-queue state file carries the given `rateLimitType` | phase-import | pause-queue state artefact |
| T-PQ3 | `the pause queue entry for issue {int} records the reset time {string}` | Parses the entry's stored `resetsAt` and asserts it is the same instant as the given one | phase-import | pause-queue state artefact |
| T-PQ4 | `the pause queue entry for issue {int} stores its reset time as an ISO 8601 timestamp` | Asserts the stored `resetsAt` is an ISO-8601 date-time string; an epoch number fails | phase-import | pause-queue state artefact |
| T-PQ5 | `the pause queue entry for issue {int} records no reset time` | Asserts the entry has no `resetsAt`; `null` or a defaulted value fails | phase-import | pause-queue state artefact |
| T-PQ6 | `the pause queue entry for issue {int} records no limit type` | Asserts the entry has no `rateLimitType`; `null` or a defaulted value fails | phase-import | pause-queue state artefact |
| T-PQ7 | `the pause queue still holds the workflow for issue {int}` | Asserts the issue's entry (matched by its adwId) is present in the pause-queue state file | phase-import | pause-queue state artefact |
| T-PQ8 | `the pause queue no longer holds the workflow for issue {int}` | Asserts the issue's entry is absent from the pause-queue state file | phase-import | pause-queue state artefact |
| T-PQ9 | `the pause queue entry for issue {int} has not gained a probe failure` | Asserts the entry's `probeFailures` still equals the recorded baseline | phase-import | pause-queue state artefact |
| T-PQ10 | `the pause queue entry for issue {int} records {int} probe failure(s)` | Asserts the entry's `probeFailures` equals N | phase-import | pause-queue state artefact |
| T-PQ11 | `the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:` | For each `issue` row of the data table, asserts the entry is present and its `probeFailures` equals the recorded baseline | phase-import | pause-queue state artefact |
| T-PQ12 | `the pause-queue decider returns {string}` | Asserts the kind of the action the decider returned (`skip_before_reset`, `resume`, `refresh_reset`, `count_strike`, `evict`) | phase-import | returned action |
| T-PQ13 | `the pause-queue decider returns {string} with the reset time {string}` | Asserts the returned action's kind and that the reset time it carries is the given instant | phase-import | returned action |
| T-PQ14 | `the pause-queue decider neither resumes, strikes nor evicts the entry` | Asserts the returned action's kind is none of `resume`, `count_strike`, `evict` | phase-import | returned action |
| T-PQ15 | `the pause-queue decider sets no new reset time on the entry` | Asserts the returned action carries no reset time | phase-import | returned action |
| T-PQ16 | `the scanner did not run the rate-limit probe` | Asserts the probe exec seam recorded no invocation during the most recent scanner run | mock-query | recorded probe invocations |
| T-PQ17 | `the scanner ran the rate-limit probe once per probe cycle` | Asserts the probe exec seam recorded exactly one invocation per requested cycle during the most recent scanner run | mock-query | recorded probe invocations |
| T-PQ18 | `the paused workflow for issue {int} is relaunched under its original adwId` | Waits (up to 10 s) for the relaunch's invocation record, written by the fixture orchestrator or, for an entry the real pause path wrote, by the `bunx` shadow; asserts its argv starts with the issue number and the entry's original adwId | phase-import | relaunch invocation record |

This scenario also reuses seven already-registered phrases — no new rows needed: `the mock GitHub API
is configured to accept issue comments` (G1), `the ADW codebase is checked out` (G18), `a workflow for
issue {int} is paused in the rate-limit queue for the target repository {string}` (G20, now defined in
the relocated `feature-902-queue.steps.ts`), `the mock GitHub API recorded a comment on issue {int}`
(T2), `the mock GitHub API recorded a comment containing the text {string}` (T3), `the mock harness
recorded zero comment posts on issue {int}` (T14) and `the ADW TypeScript type-check passes` (T22).
The git/gh guard pair it uses is registered above as W16/T34.

## Given/When/Then — Pause-Queue Ownership and Remove-Before-Spawn Resume (@pause-queue-ownership)

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

## Given/When/Then — Surface phases and lifecycles

These rows run in-process (phase-import) through `features/regression/support/phaseRun.ts`. A phase,
or an orchestrator's lifecycle, of the production code runs against `mockForgeProviders` (an
`acme/widgets` forge that records every comment it posts, every label it applies, every pull request
it creates and every secret it sets as the HTTP calls would, answers `getDefaultBranch` with `main`,
and refuses every port method the rows do not call), the fixture worktree G11 made, and the
Claude CLI stub. `commentOnPullRequest` posts to GitHub's issue-comments endpoint for the pull
request. The stub is delivered as `<worktree>/.adw-stub-manifest.json`, copied from the manifest G3
named, because the agent runner passes no `MOCK_*` variable to it; a manifest answers per slash
command, and one that would write `.adw/state.json`, anything under `agents/` or anything beyond
the worktree is refused. The phase runs under the name the production orchestrator passes to
`runPhase`, so the stage artefacts are the production ones: `adwPlan` names no phase, and its plan
phase writes no `plan_*` stage. `adwTest` names its unit-test phase `test`; adwSdlc and adwChore
name none of the phases these rows drive, so those runs write no stage and the top-level state
keeps the `starting` W-S1 seeds. A phase no orchestrator runs is driven directly (W-S4), and the
dependency-audit setup, which returns no `PhaseResult`, is driven through its `deps` seam (W-S3).
Every assertion targets a runtime artefact: the phase run's outcome, the top-level state file
(`agents/<adwId>/state.json`), the requests the mock GitHub API recorded, the scenario proof a
phase produced, the git-mock's invocation log, the commands W-S3 recorded, or the spawn-lock
artefact (`agents/spawn_locks/`). No step reads a source file, satisfying the Rot-Detection Rubric.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-S1 | `the worktree for adwId {string} has the plan for issue {int} committed on its branch` | Writes `specs/issue-<N>-adw-<adwId>-sdlc_planner-surface-plan.md` into the worktree G11 registered and commits it, so a build phase has the plan it reads | phase-import | worktree artefact |
| G-S2 | `a pull request {int} for issue {int} is open on the branch {string} with a review comment to address` | Replaces the mock server's pull-request and comment maps with one open pull request `N` (title `Issue <issue>`, body `Implements #<issue>`, head the branch, base `main`) and one review comment on it from `reviewer`, so the PR-review phases read the pull request and the comment they address | mock-query | mock server state |
| G-S3 | `the worktree for adwId {string} has a scenario for issue {int} committed on its branch` | Writes `features/feature-<N>.feature`, tagged `@adw-<N>`, into the worktree G11 registered and commits it, so the alignment and plan-validation phases find the issue's scenarios | phase-import | worktree artefact |
| G-S4 | `the worktree for adwId {string} has step definitions committed on its branch` | Writes `features/step_definitions/surface.steps.ts`, in the fixture's default step definition directory, into the worktree G11 registered and commits it, so the scenario proof finds step definitions and runs the fixture's scenario command for each tag | phase-import | worktree artefact |
| W-S1 | `the {string} phase of the {string} orchestrator runs for adwId {string}` | Builds the `WorkflowConfig` (the seeded issue, the worktree, the mock forge, the initial top-level state `starting`; `agents/<adwId>/` cleared first, since a state left behind skips a completed phase), delivers the stub, and runs `runPhase` over the phase function under the production phase name, with `process.exit` trapped and cost records kept rather than posted. Records whether it resolved, the error it threw, or the exit code it ended the process with. The phase function is called as its orchestrator calls it: the review phase with the empty scenario-proof path passed when no proof preceded it, and the scenario fix phase with the proof of a failed run of the fixture's `@review-proof` blocker tag. The scenario proof the phase left on the workflow context is recorded on the World. The orchestrator/phase pairs it drives are `plan`/`plan`, `build`/`build`, `test`/`unit test` (phase name `test`), `chore`/`review`, `chore`/`diff evaluation`, `sdlc`/`alignment`, `sdlc`/`scenario test`, `sdlc`/`scenario fix` and `sdlc`/`review`; it refuses any other pair before it builds a config | phase-import | phase run outcome |
| W-S2 | `the {string} orchestrator's lifecycle runs for adwId {string}` | Builds the same config and runs `runWithOrchestratorLifecycle` with a workflow that records that it ran and who the spawn-gate lock names while it does | phase-import | lifecycle outcome |
| W-S3 | `the dependency-audit setup runs for adwId {string} on a host whose environment sets every secret it propagates` | Builds the same config under `init-orchestrator`, the id the deleted adwInit ran the setup under, and calls `executeDepauditSetup` with three `deps`: an `execWithRetry` that records each command and its cwd and runs nothing, a `getEnv` that answers every secret, and the mock forge's `codeHost`. Records what it returned, or what it threw | phase-import | dependency-audit outcome |
| W-S4 | `the {string} phase, which no orchestrator runs, is driven directly for adwId {string}` | As W-S1, for a phase no orchestrator in `adws/*.tsx` runs (`plan validation`), and refuses any other phase. It runs `runPhase` with no phase name under adwSdlc's identity | phase-import | phase run outcome |
| T-S1 | `the {string} phase run succeeded` | Asserts the recorded outcome is for that phase and the phase run resolved | phase-import | phase run outcome |
| T-S2 | `the {string} phase run failed` | Asserts the recorded outcome is for that phase, the run did not resolve and threw an error. An exit of the process, the pause or timeout path, is not a failure | phase-import | phase run outcome |
| T-S3 | `the spawn-gate lock for issue {int} was held by the orchestrator while its lifecycle ran` | Asserts the lifecycle was for that issue, ran its workflow and returned true, and that the lock named this process while the workflow ran | phase-import | lifecycle outcome + spawn-lock artefact |
| T-S4 | `the orchestrator's lifecycle for adwId {string} did not run the workflow` | Asserts the lifecycle for that adwId returned false without running its workflow, and neither threw nor ended the process | phase-import | lifecycle outcome |
| T-S5 | `the spawn-gate lock for issue {int} is still held by the other live process` | Reads the real lock for `acme/widgets#N`; asserts it names a process other than this one, and that process is live | phase-import | spawn-lock artefact |
| T-S6 | `the mock harness recorded zero comment posts on issue {int} containing the text {string}` | Asserts no recorded POST to `/issues/N/comments` carries a body containing the text | mock-query | recorded requests |
| T-S7 | `the mock GitHub API recorded a comment on pull request {int} containing the text {string}` | Asserts a recorded POST to `/issues/N/comments` carries a body containing the text. Fails giving the number of comment posts recorded for that number | mock-query | recorded requests |
| T-S8 | `the dependency-audit setup ran the command {string} in the worktree for adwId {string}` | Asserts the recorded setup was for that adwId, finished without an error and returned its result, and that it asked its `execWithRetry` for that command with the worktree G11 registered for the adwId as its cwd. Fails listing the recorded calls | phase-import | dependency-audit outcome |
| T-S9 | `the mock GitHub API recorded the Actions secret {string} set on the repository {string}` | Asserts a recorded PUT to `/repos/<owner>/<repo>/actions/secrets/<name>`. Fails listing the recorded PUT URLs | mock-query | recorded requests |
| T-S10 | `the {string} phase run failed with an error that names {string}` | Asserts what T-S2 asserts, and that the message of the error the run failed with contains the text | phase-import | phase run outcome |
| T-S11 | `the scenario proof ran no tag` | Asserts the scenario proof recorded on the World holds no tag result, as when the proof finds no step definitions | phase-import | phase run outcome (scenario proof) |
| T-S12 | `the scenario proof records a blocker failure for the tag {string}` | Asserts the recorded scenario proof holds a result for the tag that is a blocker, ran and failed, and that the proof records blocker failures | phase-import | phase run outcome (scenario proof) |

These rows also reuse already-registered phrases, so they need no new rows: `the ADW codebase is
checked out` (G18, Background), G3, G4, G5, G11, G-PQ14 (`another live process holds the spawn lock
for issue {int} in the repository {string}`, whose process and lock the `@regression` After hook
releases), T1, T2, T3, T6, T8, T11, T12 (`the mock GitHub API recorded an application of the {string} label
on issue {int}`), T14 (`the mock harness recorded zero comment posts on issue {int}`) and T-PY3
(`the scenario proof records no blocker failures`, which reads the same recorded proof).

---

## Given/When/Then — Webhook Cron On Every Event (@webhook)

These phrases drive the real exported `dispatchWebhookEvent(req, res, rawBody, mintEventBoundary)`
in-process (phase-import pattern). The request is a fake that carries `x-github-event` and, when
signed, `x-hub-signature-256`; the response records the status code and body the dispatcher writes.
By default `mintEventBoundary` returns a fake boundary whose providers throw if touched, so no
provider is ever minted: W-WH1 to W-WH5 use it. The Cancel Directive rows below pass a minter of their
own, over a throwaway target workspace. Launches are caught by the shared launch recorder
(`features/regression/support/launchRecorder.ts`): a `bunx` shadow put first on `PATH` for the
dispatch, which records its argv and exits at once. A cron launch is a record that names
`adws/triggers/trigger_cron.ts` and `--target-repo <repository>`. Every assertion targets a runtime
artefact: the response the dispatcher wrote, the launches the recorder captured, or the cron registry
record. No step reads, greps or parses a source file, satisfying the Rot-Detection Rubric.

The definitions live in `webhookCronSteps.ts`. Every `@webhook` scenario starts with
`GITHUB_WEBHOOK_SECRET` unset, the GitHub App variables blank, `SLACK_WEBHOOK_URL` unset and
`agents/.auth_gate` cleared. Each is restored afterwards, together with the cron registry entries and
cron logs the scenario touched.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-WH1 | `no cron is running for the repository {string}` | Removes the repository's cron registry entry (`agents/cron/<owner>_<repo>.json`) after saving it for restoration | phase-import | cron registry artefact |
| G-WH2 | `a cron is already running for the repository {string}` | Registers the live test process as the repository's cron (`writeCronPid(<repo>, process.pid)`) after saving any existing entry for restoration | phase-import | cron registry artefact |
| G-WH3 | `the webhook secret is set to {string}` | Sets `GITHUB_WEBHOOK_SECRET`, which the dispatcher reads at call time | phase-import | SUT input (environment) |
| W-WH1 | `the webhook receives an approved review from the repository {string}` | Dispatches an unsigned `pull_request_review` event (`submitted`, `review.state` approved) naming the repository (`full_name`, `clone_url`) with the launch recorder on `PATH`, then waits until no new launch has been recorded for a quiet window | phase-import | recorded response + launch records |
| W-WH2 | `the webhook receives an approved review from the repository {string}, signed with the secret {string}` | As W-WH1, with `x-hub-signature-256` set to `sha256=` plus the HMAC-SHA256 of the raw body under the given secret | phase-import | recorded response + launch records |
| W-WH3 | `the webhook receives a {string} event with the action {string} from the repository {string}` | As W-WH1 for an unsigned event of the given type and action, carrying only the fields its branch reads (a pull request number, an issue number, a plain comment) | phase-import | recorded response + launch records |
| W-WH4 | `the webhook receives an approved review that names no repository` | As W-WH1, with no `repository` object in the payload | phase-import | recorded response + launch records |
| W-WH5 | `the webhook receives a {string} delivery whose body is not valid JSON` | As W-WH1 for an unsigned delivery of the given event type whose raw body is truncated JSON | phase-import | recorded response + launch records |
| T-WH1 | `the webhook answers {int} with the status {string}` | Asserts the recorded status code and that the recorded body is exactly the given status, so a reason such as `auth_gate_set` or `duplicate` fails it | phase-import | recorded response |
| T-WH2 | `the webhook answers {int} with the error {string}` | Asserts the recorded status code and that the recorded body is exactly the given error | phase-import | recorded response |
| T-WH3 | `exactly one cron is launched, for the repository {string}` | Waits (bounded) for a cron launch record, then asserts the recorder holds exactly one cron launch and that it names `--target-repo <repo>` | mock-query | launch records |
| T-WH4 | `nothing other than that cron is launched` | Asserts every launch the recorder captured is a cron launch: no workflow or other `bunx` launch was made | mock-query | launch records |
| T-WH5 | `no cron is launched` | Asserts the recorder captured no cron launch | mock-query | launch records |
| T-WH6 | `the cron that was already running is still the one registered for the repository {string}` | Reads the repository's cron registry record and asserts it still names the pid G-WH2 registered, so the dispatch neither replaced nor removed the running cron | phase-import | cron registry artefact |

This scenario also reuses `the ADW codebase is checked out` (G18, Background no-op), now defined in
`givenSteps.ts`.

---

## Given/When/Then — Cancel Directive (@webhook)

`## Cancel` is not an orchestrator stage: the trigger that receives the comment resets the issue's
workflow itself, in `handleCancelDirective`. These rows drive the real exported `dispatchWebhookEvent`
in-process under the `@webhook` hooks above, with a signed `issue_comment`, and read what the handler
leaves. The boundary the dispatcher mints is over the throwaway `acme/widgets` workspace the subprocess
harness lays out (`features/regression/support/webhookTarget.ts`): a real `GitContext` bound to that
workspace, so the handler's worktree removal runs real git there and never reaches the checkout, and
the recording mock forge, whose issue tracker answers `fetchComments`, `getIssueTitle` and
`deleteComment` from the mock GitHub API. Every assertion targets a runtime artefact: the
`agents/<adwId>/` directory, git's own listings of the workspace (`git worktree list`, `git branch`),
or the requests the mock GitHub API recorded. The dispatcher's answer and the cron it launches are
deliberately not asserted: they are the dispatcher's, not the handler's. The seeded state names no
process, so the handler signals nothing. No step reads a source file, satisfying the Rot-Detection
Rubric. The definitions live in `cancelDirectiveSteps.ts`.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-CD1 | `the target repository's workspace holds a worktree for issue {int} on the branch {string}` | Adds a worktree on a new branch off `main` to the workspace, at the path the workspace's `GitContext` gives the branch, under `.worktrees/`. Fails unless the branch holds `-issue-<N>-`, as ADW's branch names do, since the handler removes only the worktrees whose directory name does | phase-import | worktree artefact |
| G-CD2 | `issue {int} holds an ADW workflow comment for adwId {string}` | Adds to the issue's comments in the mock state the comment ADW's own formatter writes when a workflow starts, which carries the adwId as the handler finds it in production. Fails for an adwId that is not made up for a scenario: the handler deletes `agents/<adwId>/` for every adwId an issue's comments name | mock-query | mock server state |
| W-CD1 | `the webhook receives the comment {string} on issue {int} from the repository {string}, signed with the secret {string}` | Adds the comment to the issue's comments in the mock state, since GitHub holds a comment when it delivers it (through the state, not a recorded POST, which T14 counts). Then dispatches `issue_comment` with the action `created`, `repository.full_name` and `clone_url`, `issue.number` and `comment.body`, signed as W-WH2 signs, with the launch recorder on `PATH`. Fails first when an adwId in the issue's comments is not made up for a scenario | phase-import | recorded response + launch records |
| T-CD1 | `the checkout holds no state for adwId {string}` | Asserts `agents/<adwId>/` is gone. Fails naming the path | phase-import | state directory artefact |
| T-CD2 | `the target repository's workspace holds no worktree for issue {int}` | Asserts git lists no worktree of the workspace whose directory name holds `-issue-<N>-`, and that no such directory is left under `.worktrees/`. Fails listing any left | phase-import | git artefact |
| T-CD3 | `the target repository's workspace holds no branch {string}` | Asserts `git branch --list` of the workspace names no such branch | phase-import | git artefact |
| T-CD4 | `the mock GitHub API recorded the deletion of every comment on issue {int}` | Asserts a recorded `DELETE /repos/acme/widgets/issues/comments/<id>` for every comment the mock still holds for the issue (it keeps a comment after a DELETE of it, so these are the comments the issue held when the comment was delivered), and that there is at least one. Fails listing the recorded DELETEs | mock-query | recorded requests |

This section also reuses already-registered phrases, so they need no new rows: `the ADW codebase is
checked out` (G18, Background), G4 (the seeded issue), G-SP2 (the prior run's top-level state, which
carries no `pid`), G-WH3 (the webhook secret) and T14 (no comment posted).

---

## Given/When/Then — Smoke processes (@subprocess)

These rows run a real ADW process as a child of the Cucumber process, through the hermetic
subprocess harness (`features/regression/support/subprocessHarness.ts`, `subprocessRun.ts` and
`subprocessDrivers.ts`). W1 runs an orchestrator, W9 the workflow-init driver
(`features/regression/drivers/workflowInitDriver.ts`) and W10 the cron trigger. Each of them fails
without the harness, and a row opts in by carrying `@subprocess` next to `@regression`. A `@webhook`
row is given the same harness, so the Givens it shares with the subprocess rows (G-SP2's claim and its
cleanup, the throwaway workspace) work there. The harness is never keyed on `@smoke` or `@surface`,
because the in-process surface rows need none.

**What the `@regression and (@subprocess or @webhook)` Before hook sets up.** A temporary root under
`os.tmpdir()` holding the child's `TARGET_REPOS_DIR` and `HOME`, the `gh` shadow's state and log, and
the `gh` shadow itself. The target workspace, `acme/widgets`, is the `test/fixtures/cli-tool/`
fixture committed on `main` under `TARGET_REPOS_DIR`, with an `origin` of
`https://github.com/acme/widgets.git` (never contacted), a local `refs/remotes/origin/main`, and a
committed `.adw-version` equal to the framework hash, which the upgrade gate would otherwise park the
issue over. It is laid out the first time a step needs it. The hook also creates a launch recorder,
saves then removes `agents/.auth_gate` (a cron child would otherwise skip its poll and SIGTERM live
orchestrators), saves `agents/paused_queue.json`, which a paused run appends to, and snapshots the
cron registry entry and log of `acme/widgets`. Teardown is on
`World.cleanup`: it kills every process group the harness started, removes the `agents/<adwId>/` and
`logs/<adwId>/` of every claimed adwId (only one made up for a scenario, `surface-…`,
`throwaway<N>-…` or a smoke file's `<name>-smoke-<N>`, is accepted), releases the `acme/widgets` spawn lock of every claimed issue,
restores the auth gate, the pause queue and the cron files byte for byte, disposes the launch recorder and removes the
temporary root.

**The child's environment.** It starts from the Cucumber process's own and forces: a fake but
syntactically complete `GITHUB_PAT`; `GH_TOKEN`, the GitHub App, Cost API, Slack and R2 variables and
`CLOUDFLARE_ACCOUNT_ID` set to an empty string, present rather than unset, because `dotenv` fills only
the names that are absent, from the checkout's `.env`; `COST_REPORT_CURRENCIES` set to `,`, which names
no currency once split, where an empty value would fall back to `EUR` and a completed workflow would
fetch exchange rates; `CLAUDE_CODE_PATH` set to the Claude CLI stub; the temporary `TARGET_REPOS_DIR`
and `HOME`; `ADW_TARGET_GUARDRAILS=off`; the harness git identity; and `PATH` led by the `gh` shadow,
then the launch recorder's `bunx`, then the git mock and the rest. Only the child's `PATH` is changed,
never the Cucumber process's. The child is started through the absolute path of `bunx`, so the
recorder's shadow never intercepts the harness's own launch, and every `bunx` call the child makes is
recorded instead of run. The cron's cadence variables are pinned high, so its one tick runs no sweep
against the checkout's shared state.

**The `gh` shadow** (`test/mocks/gh-cli-shadow.ts`, behind a `/bin/sh` wrapper named `gh`) answers
reads (`auth token`, `repo view`, `issue view` and `list`, `pr view` and `list`, and `api` GETs of
comments and reviews) from a forge state file written from the mock GitHub API's state before the
run, and applies its own writes to that file, so a later read in the same run sees them. Each write
(comments, label edits, issue create, edit and close, `pr create`, `merge`, `review` and `comment`,
`label create`, `secret set`, and `api -X` with POST, PATCH, PUT or DELETE) is appended to a log as
the REST request it stands for, and GraphQL is logged and answered with an empty data object. Any
other call is logged, written to stderr as `gh shadow: unsupported: <argv>` and exits 1, and fails the
step after the run even when the process swallowed the failure and exited 0. The harness replays the
log against the mock GitHub API after the child has exited, never while it runs: the child's `gh`
calls are synchronous, and one that waited on the in-process mock server would deadlock it. The
existing Then steps then see the child's writes as they see an HTTP call's.

**Landing a merge.** The shadow's forge has no git behind it, so a merge only marks the pull request
merged. Where a run's repository stands in for the remote, W1 sets `ADW_GH_LAND_PATH` to the
workspace, which is what it does for `promotion-sweep`. The shadow then lands each pull request the
run merges, as GitHub does: the workspace's `main` and `refs/remotes/origin/main` are fast-forwarded
to the head of the merged branch before the call returns, so what the pull request carried is where
production puts it although the process then deletes its branch and worktree. A merge that cannot
fast-forward, or a workspace that is not on the base branch, fails the call and logs nothing of it.

**The stub's manifest.** The Claude CLI stub searches its cwd and every directory above it for
`.adw-stub-manifest.json`, and the nearest one wins. G3's manifest is delivered as
`<TARGET_REPOS_DIR>/.adw-stub-manifest.json`, above the workspace and every worktree a run creates,
and under `os.tmpdir()`, so a search that starts in the ADW checkout finds none.

**The full-pipeline smoke rows.** `adw_chore_diff_verdicts`, `adw_sdlc_happy_path` and
`pause_resume_rate_limit` run W1 `chore` or `sdlc` end to end. Each manifest answers per slash
command, and its top-level `onCommitCommand` stands in for `/commit`, so every agent whose phase
commits must leave a change. `/chore` and `/feature` write the plan at
`specs/issue-<N>-adw-<adwId>-sdlc_planner-<name>.md`, where `getPlanFilePath` finds it. The build
agent's command and `/document` write a file; the build agent's command is `/implement`, or
`/implement-tdd` once a feature tagged `@adw-<N>` is in the worktree, as in the SDLC row.
`/scenario_writer` writes a feature tagged `@adw-<N>`, and the agents whose callers parse JSON answer
with it. `/generate_step_definitions` writes no step definition: with one, the scenario proof would
run the fixture's fenced scenario command, which exits 127. `/generate_branch_name` runs with the ADW
checkout as its cwd, never finds the manifest, and falls back to `<type>-issue-<N>`. The fixture's
`N/A` unit-test command yields no JUnit report, hence the `adw:unverified` label. The pause row
answers every call with a `seven_day` limit and a reset in 2100. The plan phase's rejection is
enqueued, because only `five_hour` is slept out in process (`adws/core/rateLimitWaitPolicy.ts`), so
the run records `paused` and exits 0.

**Timeouts.** An orchestrator is bounded at 120 s, the init driver at 30 s, and the cron at 60 s for
its first `POLL:` line. A process that outlives its bound fails the step with the tail of its output,
after its whole process group is killed. W10 kills the cron once it has polled and its launches have
settled, so it records no exit code, and T5 fails after it.

Every assertion reads a runtime artefact: the exit code, the process's output, the top-level state
file, the requests the mock GitHub API recorded after the replay, or the launches the recorder
caught. No step reads a source file, satisfying the Rot-Detection Rubric. The definitions live in
`subprocessSteps.ts` and `promotionSweepSteps.ts`.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-SP1 | `a workflow for adwId {string} is awaiting merge of PR {int} from branch {string}` | Claims the adwId, lays out the target workspace, creates the branch on its `origin` (a commit off `main` and `refs/remotes/origin/<branch>`, so a worktree can be added for it), seeds an open mock PR N for that head branch, and writes the adwId's top-level state at stage `awaiting_merge` for `acme/widgets`, with the issue the scenario seeded when it seeded exactly one | subprocess | state file artefact + mock server state |
| G-SP2 | `a prior run for adwId {string} recorded workflowStage {string} for the repository {string}` | Claims the adwId and writes its top-level state at the given stage with the given repository identity, so a launch for `acme/widgets` finds a prior run of another repository | subprocess | state file artefact |
| G-SP3 | `the target repository's workspace declares its regression vocabulary in {string}` | Commits on the workspace's `main` a vocabulary registry, `features/regression/vocabulary.md`: one `subprocess` `When` phrase, one `Then`, and the surface example `Exit codes of the widgets CLI`. Then commits `.adw/scenarios.md`, the file the workspace already holds, with `## Per-Issue Scenario Directory`, `## Regression Scenario Directory` and `## Vocabulary Registry` added. Fails for any other path: ADW reads the declaration from `.adw/scenarios.md` alone | subprocess | workspace git artefact |
| G-SP4 | `the target repository's workspace has committed {string} holding the scenario {string}, which the promotion scorer rates {int}` | Commits a feature file of that one scenario: a `Given` the registry does not know, then as many `When` and `And` steps naming its `subprocess` phrase as the score needs, and a `Then`. First runs the real `parseScenarios` and `score` over it against the registry the workspace committed, and fails, giving the score it got, unless that is N, so a scorer that moves the score fails here and not in a Then | subprocess | workspace git artefact |
| G-SP5 | `the target repository has {int} promotion issue(s) whose pull request merged in the last {int} days` | Leaves exactly N closed `regression-promotion` issues in the mock server's state, none for 0, whatever it held before. Each promotes a feature no file names (`Promotes: feature-92<nn>`), so the reconcile of the candidate does not change, and has a merged pull request linking it (`Implements #92<nn>`), merged half the window ago. Seeded through the state, never through recorded requests, since T7 counts the recorded merges | mock-query | mock server state |
| G-SP6 | `{int} more per-issue scenarios were added to, and since removed from, the target repository's default branch in the last {int} days` | Commits a feature of N scenarios under `features/per-issue/` on the workspace's `main`, then a commit that removes it, as the per-issue sweep removes a file after its merge. `git log -p` still counts the additions, which are the ramp's denominator, and the sweep lists no extra candidate. Committed now, which is inside the window | subprocess | workspace git artefact |
| T-SP1 | `the mock GitHub API recorded a merge of PR {int}` | Asserts a recorded `PUT` whose path ends in `/pulls/N/merge`; the message lists what was recorded | mock-query | recorded requests |
| T-SP2 | `the orchestrator subprocess's output contains {string}` | Asserts the combined stdout and stderr of the last process the harness ran (`World.lastOutput`) contains the text; shows the output's last 40 lines on failure | subprocess | log stream |
| T-SP3 | `the cron launched no orchestrator` | Asserts the launch recorder holds no record that runs an `adws/adw<Name>.tsx` orchestrator or the promotion sweep; other `bunx` launches, such as the guardrails probe, are not counted | subprocess | launch records |
| T-SP4 | `the {string} orchestrator was launched for issue {int}` | Asserts the name is one the harness runs and that exactly one recorded launch runs that orchestrator's script with the issue number as its first argument; keeps that launch for T-SP5 | subprocess | launch records |
| T-SP5 | `that launch named the target repository {string}` | Asserts the launch T-SP4 kept carries `--target-repo <repository>` | subprocess | launch records |

**The promotion sweep.** The sweep never invokes the Claude CLI stub. It builds a worktree on
`chore/promotion-sweep` off `origin/main`, lists, reads and scores the per-issue features there against
the vocabulary `.adw/scenarios.md` declares, and never reads the workspace's checkout, so G-SP3, G-SP4
and G-SP6 commit on `main` and move `refs/remotes/origin/main` with each commit. The ramp's N is
3 + round(4 × min(r, 0.5) ÷ 0.5), where r is the number of closed `regression-promotion` issues whose
pull request merged in the last 90 days (G-SP5), over the number of `Scenario:` lines added under
`features/per-issue/` in that time (G-SP4, G-SP6). When a candidate scores at least N the sweep commits
its marker, a Feature-level tag `@promotion-suggested-<date>` above `Feature:`, in that worktree, pushes
the branch, opens and merges a pull request, files the promotion issue and removes the worktree and its
branch. The `gh` shadow lands the merge (above), so T18 and T19 read the marker where production puts
it. T-SP2 reads the sweep's own report line, `promotionSweep: threshold <N>, originated <k>, …`, which
states N.

This section also reuses already-registered phrases, so they need no new rows: `the ADW codebase is
checked out` (G18, Background), G3 (its manifest is delivered as the marker above), G4 (the seeded
issue, labelled `adw:feature` and old enough for the cron's grace period), G7 (keeps the issues G4
seeded), G10 (marks the PR merged in place), W1, W9, W10, T1, T2, T3, T5, T7, T8, T9, T12, T14, T-S6,
and T18 and T19 (the marker the sweep lands, read in the workspace W1 registered under the adwId).

## Given/When/Then — Envelope Conformance Gate and Rate-Limited Claude CLI Stub (@envelope-conformance)

These phrases drive ADW's stream-json envelope conformance gate (`adws/jsonl/`) and the regression
suite's Claude CLI stub (`test/mocks/claude-cli-stub.ts`). The gate runs as a subprocess through its
package script (`bun run jsonl:check`, exactly as CI runs it) and in-process (phase-import) through
`checkConformance`, `updateFixtureEnvelopes` and `probeClaudeJsonlSchema` over throwaway inputs. The
stub runs as a subprocess the way an agent spawns the CLI. The real Claude CLI is never spawned: the
schema probe gets a throwaway fake CLI on `CLAUDE_CODE_PATH`, and the rate-limit probe and the agent
run get the pause-queue harness's injected exec seam and a fake child process. Every input is a
throwaway copy under `os.tmpdir()`: committed fixtures are read or copied, never modified, and the
probe writes a throwaway copy of the schema, never `adws/jsonl/schema.json`. Every assertion targets a
runtime artefact: the gate's exit code and report, the per-fixture results `checkConformance` returns
(pass or fail, missing required fields by dot-path, informational unknown fields), the copy the
fixture updater rewrote, the argv the fake CLI recorded, the stub's stdout and exit code, the
rate-limit probe's classification and the agent run's result. No step reads, greps or parses a source
file, satisfying the Rot-Detection Rubric. The definitions live in `feature-909.steps.ts` and
`feature-909-tooling.steps.ts`; W-EC6, W-EC7, T-EC14 and T-EC15 live in the pause-queue harness's
`feature-902.steps.ts`.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-EC1 | `a copy of the committed JSONL fixture captured from a real rate limit` | Copies the committed capture of a real rate-limited session (`adws/jsonl/fixtures/session-rate-limited.jsonl`, one message per line) into a fresh throwaway directory under `os.tmpdir()`; later steps mutate and check only that copy | phase-import | fixture input (SUT input, not source) |
| G-EC2 | `a copy of the committed JSONL error-result fixture` | Copies the committed error-result fixture (`adws/jsonl/fixtures/result-error.jsonl`) into a fresh throwaway directory and records the `result` value of the copy's first message as the baseline T-EC8 compares against | phase-import | fixture input (SUT input, not source) |
| G-EC3 | `in that copy the {string} message no longer carries the field {string}` | Deletes the field, a dot-path such as `rate_limit_info.status`, from every message of the given `type` in the throwaway copy and rewrites the copy one message per line: a single-field drift, the way a CLI change arrives | phase-import | fixture input (SUT input, not source) |
| G-EC4 | `in that copy the {string} message carries {string} under its stale name {string}` | Moves the field's value to its stale name (such as `is_error` to `isError`) on every message of the given `type` in the throwaway copy that carries the field | phase-import | fixture input (SUT input, not source) |
| G-EC5 | `a copy of the api_retry system message the Claude CLI documents:` | Writes the DocString, one `system`/`api_retry` JSON line as the Claude CLI's headless documentation publishes it, as `system-api-retry.jsonl` in a fresh throwaway directory | phase-import | fixture input (SUT input, not source) |
| G-EC6 | `the Claude CLI answers the schema probe with:` | Writes a throwaway fake Claude CLI that appends its argv to a record file and prints the DocString as its stream-json output, points `CLAUDE_CODE_PATH` at it (the previous value is put back after the scenario) and copies the committed schema to a throwaway path for the probe to write. The record path is baked into the script rather than passed in a `MOCK_*` variable, which the probe's spawn environment drops | phase-import | stub behaviour (fake Claude CLI) |
| G-EC7 | `the Claude CLI stub is asked for its rate-limited response` | Arms the next W-EC5 run with the stub's on-demand switch, `MOCK_RESPONSE=rate-limited` | subprocess | stub behaviour |
| G-EC8 | `a copy of the Claude CLI stub's rate-limited response` | Runs the Claude CLI stub as W-EC5 does, with `MOCK_RESPONSE=rate-limited`, and writes its stdout as a JSONL file in a fresh throwaway directory, for the gate to check like any fixture | subprocess | fixture input (stub output, SUT input) |
| G-EC9 | `the Claude CLI answers the rate-limit probe with the committed JSONL fixture captured from a real rate limit` | Sets the rate-limit probe exec seam's reply (`probeStub.result`, from `feature-902.steps.ts`) to the committed rate-limited capture on `stdout` with exit code 1 | phase-import | stub behaviour (probe exec seam) |
| G-EC10 | `the Claude CLI answers the rate-limit probe with the Claude CLI stub's rate-limited response` | Runs the Claude CLI stub with `MOCK_RESPONSE=rate-limited` and sets the probe exec seam's reply to its stdout and exit code | subprocess | stub behaviour (probe exec seam) |
| G-EC11 | `the Claude CLI answers the rate-limit probe with the Claude CLI stub's default response` | Runs the Claude CLI stub with no response switch and sets the probe exec seam's reply to its stdout and exit code | subprocess | stub behaviour (probe exec seam) |
| W-EC1 | `the envelope conformance gate is run through its package script entry point` | Runs `bun run jsonl:check` from the ADW checkout root as a subprocess, exactly as CI runs the gate over the committed fixtures, the committed schema and ADW's stream parser; records its exit status and stdout | subprocess | exit code + log stream |
| W-EC2 | `the envelope conformance gate checks that copy` | Calls the gate's check in-process, `checkConformance(<committed schema>, <throwaway directory>)`, over the copy's directory; records the per-fixture results: pass or fail, missing required fields by dot-path, informational unknown fields, parser and extractor errors | phase-import | returned conformance results |
| W-EC3 | `the fixture updater runs over that copy` | Calls `updateFixtureEnvelopes(<committed schema>, <throwaway directory>)` in-process, the updater behind `bun run jsonl:update` that a failing gate report points to; it rewrites the copy in place | phase-import | fixture copy rewritten by the updater |
| W-EC4 | `the schema probe runs` | Calls `probeClaudeJsonlSchema(<throwaway schema path>)` in-process; the probe spawns the fake Claude CLI G-EC6 installed, which records the argv it receives | phase-import | recorded argv |
| W-EC5 | `the Claude CLI stub is run` | Spawns `test/mocks/claude-cli-stub.ts` the way an agent spawns the CLI (`--print --verbose --output-format stream-json` and a prompt, no stream delay), with G-EC7's switch when armed; records its stdout and exit code | subprocess | log stream + exit code |
| W-EC6 | `the rate-limit probe runs` | Calls the real `probeRateLimit` with the injected exec seam (`probeStub.exec`, never a spawned CLI) and records its classification. Defined in `feature-902.steps.ts` | phase-import | returned probe classification |
| W-EC7 | `the same Claude CLI output is streamed through an agent run` | Streams the probe exec seam's stdout, newline-terminated, through the real `handleAgentProcess` on a fake child process (one `data` event, then `close`) and records the `AgentResult`. Defined in `feature-902.steps.ts` | phase-import | returned agent result |
| T-EC1 | `the envelope conformance gate exits 0` | Asserts the exit status W-EC1 recorded is 0; the gate's stdout is shown on failure | subprocess | exit code |
| T-EC2 | `the envelope conformance gate reports no failing fixture` | Asserts W-EC1's stdout carries no failing-fixture marker (`✗`) | subprocess | log stream |
| T-EC3 | `the envelope conformance gate fails` | Asserts at least one result W-EC2 recorded did not pass | phase-import | returned conformance results |
| T-EC4 | `the envelope conformance gate passes` | Asserts every result W-EC2 recorded passed | phase-import | returned conformance results |
| T-EC5 | `the envelope conformance gate reports {string} missing from the {string} message` | Asserts one of W-EC2's missing-required-field reports names the field's dot-path for that message `type`; a report with no message prefix also counts | phase-import | returned conformance results |
| T-EC6 | `the envelope conformance gate flags no field of the {string} message as unknown` | Asserts none of W-EC2's informational unknown-field reports (extra fields, or "no schema coverage") belongs to that message `type` | phase-import | returned conformance results |
| T-EC7 | `the envelope conformance gate flags none of these fields of the {string} message as unknown:` | For each `field` row of the data table, asserts no unknown-field report W-EC2 recorded for that message `type` names the field | phase-import | returned conformance results |
| T-EC8 | `that copy's {string} message keeps its original {string} value` | Reads the copy W-EC3 rewrote and asserts the message's field still equals the baseline G-EC2 recorded | phase-import | fixture copy rewritten by the updater |
| T-EC9 | `the schema probe requested {string} output from the Claude CLI` | Reads the argv the fake Claude CLI recorded for the probe's last invocation; asserts `--output-format` is followed by the given format | phase-import | recorded argv |
| T-EC10 | `the schema probe requested verbose output from the Claude CLI` | Asserts the argv recorded for the probe's last invocation includes `--verbose` | phase-import | recorded argv |
| T-EC11 | `the stub's output carries a rate_limit_event that rejects the request` | Parses W-EC5's stdout line by line; asserts a `rate_limit_event` whose `rate_limit_info.status` is `rejected` | subprocess | log stream |
| T-EC12 | `the stub's rate_limit_event names a reset time that has not yet passed` | Asserts that event's `rate_limit_info.resetsAt`, in epoch seconds like the real capture, is later than now | subprocess | log stream |
| T-EC13 | `the stub's output ends with a result whose api_error_status is {int} and whose is_error is {word}` | Asserts the last line of W-EC5's stdout is a `result` carrying that `api_error_status` and that `is_error`. Defined as a regex whose last group accepts only `true` or `false` | subprocess | log stream |
| T-EC14 | `the agent run ends rate-limited` | Asserts the `AgentResult` W-EC7 recorded has `rateLimited: true`. Defined in `feature-902.steps.ts` | phase-import | returned agent result |
| T-EC15 | `the rate-limit probe reports {string}` | Asserts the verdict of the classification W-EC6 recorded (`clear`, `limited`, `failed` or `unknown`). Defined in `feature-902.steps.ts` | phase-import | returned probe classification |

G-EC9, G-EC10 and G-EC11 are literal phrases on purpose: a single parameterised phrase would collide
with `the Claude CLI answers the rate-limit probe with exit code {int} and {word}:`. The scenario's
`<reply>` outline column expands to G-EC9 and G-EC10. This section also reuses already-registered
phrases, so they need no new rows: `the ADW codebase is checked out` (G18), `the ADW TypeScript
type-check passes` (T22) and the git/gh guard pair W16/T34.

---

## Given/When/Then — Cost Records, the Cost API and Worker Deploy Detection (@cost-records)

These phrases drive three things. First, the real `handleAgentProcess` (phase-import): a fake Claude
CLI child emits the JSONL a scenario describes (assistant turns, and a `result` message whose
`modelUsage` carries each model's tokens and `costUSD`), and the phase's records are built with the
real `createPhaseCostRecords`, several runs folded with `mergeModelUsageMaps`, as the phases build
them; the divergence check is the real `checkDivergence`. The completion comment's cost section is
rendered by the real `formatCostCommentSection` in a child process
(`features/regression/drivers/feature-936-cost-section-driver.ts`), because `SHOW_COST_IN_COMMENTS` is
bound when `adws/core/config.ts` is imported. Second, the cost API: a local HTTP server records what
the real `CostTracker.commit` posts from a child process
(`features/regression/drivers/feature-936-commit-driver.ts`, since `COST_API_URL` is bound at import),
and the cost-api Worker's real ingest and query handlers answer in-process from an in-memory SQLite
database (`node:sqlite`) that carries the Worker's real migrations. Third, the deploy workflow's change
detection: a throwaway git repository laid out like ADW's (a default branch, a release branch, both
Workers' files and a copy of `.github/workflows/deploy-workers.yml`) receives a release merge, and a
port of `dorny/paths-filter`'s push-event path runs in a checkout of it. The workflow file is the
system under test's configuration: its push trigger and the `dorny/paths-filter` step's inputs and
filters are executed against the push, never asserted on. Every git command runs with the host's git
configuration switched off and through the `PATH` captured when the module loads, so the `@regression`
git-mock, which turns `clone` and `fetch` into no-ops, never intercepts it.

Every assertion targets a runtime artefact: the cost records the phase built, the divergence verdict,
the cost section the driver printed, the requests the recording cost API received, the Worker's query
responses, git's diff of the throwaway repository, or the change detection's outcome. No step reads,
greps or parses a source file to assert on it, satisfying the Rot-Detection Rubric. Costs are compared
at four decimals, the precision the cost section shows. The definitions live in
`feature-936-costRecords.steps.ts`, `feature-936-costApi.steps.ts` and `feature-936-deploy.steps.ts`,
with their helpers `feature-936-costRun.ts`, `feature-936-usd.ts`, `feature-936-costApiWorker.ts`,
`feature-936-throwawayRepo.ts`, `feature-936-pathsFilter.ts` and `feature-936-workflowConfig.ts`. Their
state is module-scoped and is reset or released by hooks keyed on `@cost-records`.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-CR1 | `cost comments are enabled` | Sets `SHOW_COST_IN_COMMENTS=true` in the environment the cost-section driver runs with; otherwise the driver runs with it set empty, since dotenv never overrides a variable that is already set. Reset before every scenario | subprocess | cost-section driver environment (SUT input) |
| G-CR2 | `an agent run of the {string} phase whose Claude CLI result message reports:` | Describes a run of the phase that streams no assistant turn and ends with a `result/success` message: one `modelUsage` entry per row (`model`, `input`, `output`, `cache_read`, `cache_write`, `costUSD`), with `total_cost_usd` the rows' sum | phase-import | fake Claude CLI stream (SUT input) |
| G-CR3 | `a first/second agent run of the {string} phase whose Claude CLI result message reports:` | As G-CR2, for another run of the same phase; W-CR1 folds every run of the phase | phase-import | fake Claude CLI stream (SUT input) |
| G-CR4 | `that result message reports a total cost of ${float}` | Sets the last described result message's `total_cost_usd` to the figure, apart from its per-model `costUSD` figures | phase-import | fake Claude CLI stream (SUT input) |
| G-CR5 | `an agent run of the {string} phase that streams these assistant turns for model {string}:` | Describes a run that streams one `assistant` message per row for the model: the row's message id, `input_tokens`, `cache_creation_input_tokens` and `cache_read_input_tokens`, and a text block of the given character count. It has no result message until G-CR7 adds one | phase-import | fake Claude CLI stream (SUT input) |
| G-CR6 | `an agent run of the {string} phase that streams these assistant turns for model {string} and is stopped before the Claude CLI writes its result message:` | As G-CR5; the fake CLI child then closes with no exit code and never writes a result message | phase-import | fake Claude CLI stream (SUT input) |
| G-CR7 | `the agent run ends with a Claude CLI result message that reports:` | Ends the last described run with a result message, as G-CR2 describes one | phase-import | fake Claude CLI stream (SUT input) |
| G-CR8 | `a cost API that records the cost records posted to it` | Starts a local HTTP server on `127.0.0.1` (ephemeral port) that records each request's method, path, `Authorization` header and JSON body and answers 201; the `@cost-records` After hook stops it | mock-query | recording cost API (mock HTTP server) |
| G-CR9 | `the cost API stores for project {string} a {string} record of issue {int} for model {string} with computed_cost_usd {float} and reported_cost_usd {float}` | Ingests one record (fixed token usage, provider `anthropic`) for the project through the cost-api Worker's real `handleIngest`, running in-process against an in-memory SQLite database that carries the Worker's real migrations; fails unless the Worker answers 201 | phase-import | Worker ingest response (artefact) |
| G-CR10 | `a throwaway repository whose default branch is {string} and whose {string} holds the previous release` | Creates a git repository in a temp directory on the default branch, holding a README, each Worker's `wrangler.toml` and a source file, and a copy of the checkout's `.github/workflows/deploy-workers.yml`; commits it as the previous release and branches the release branch from it. The `@cost-records` After hook removes it | phase-import | git artefact (throwaway repository) |
| G-CR11 | `a commit on {string} that is not yet on {string} changes {string}` | Fails unless the two names are the repository's default and release branches, then commits a change to the file on the default branch | phase-import | git artefact (throwaway repository) |
| G-CR12 | `a( later) pull request that changes {string} has been merged into {string} with a merge commit` | Fails unless the name is the default branch, then commits the change on a fresh `feature-<n>` branch off it and merges that branch back with `--no-ff`, as a pull-request merge lands | phase-import | git artefact (throwaway repository) |
| W-CR1 | `the {string} phase builds its cost records from its agent run(s)` | Feeds each described run of the phase, in order, to the real `handleAgentProcess` through a fake CLI child, then builds the phase's records with the real `createPhaseCostRecords` (several runs folded with `mergeModelUsageMaps`), with status `success` only when every run's cost came from a finalized result message | phase-import | built cost records (artefact) |
| W-CR2 | `the phase runner posts the {string} phase's cost records to the cost API` | Runs `features/regression/drivers/feature-936-commit-driver.ts` as a child process with `COST_API_URL` set to G-CR8's server and a scenario token; the driver commits the phase's built records through the real `CostTracker.commit`. Fails unless the driver exits 0 | subprocess | exit code + recorded requests |
| W-CR3 | `the cost breakdown and the per-issue costs of project {string} are requested from the cost API` | Calls the Worker's real `handleGetProjects`, `handleGetCostBreakdown` and `handleGetCostIssues` for the project against G-CR9's database and records the cost breakdown and the per-issue costs they answer | phase-import | Worker query responses (artefact) |
| W-CR4 | `{string} is merged into {string} with a merge commit, the way releases are merged` | Fails unless the two names are the default and release branches, then merges the default branch into the release branch with `--no-ff` and records the push: the release branch's commit before and after the merge | phase-import | git artefact (merge commit) |
| W-CR5 | `the change-detection step of the deploy workflow runs for the push of that merge to {string}` | Fails unless the name is the release branch, then clones the throwaway repository and runs the deploy workflow's change detection in the clone for the recorded push: the workflow's push trigger decides whether it fires, then the port of `dorny/paths-filter`'s push-event path evaluates the step's `base` and `ref` inputs against the push event, finds the changed files (git fetches, merge-base deepening, `git diff --name-only`) and matches them against the step's filters. Records `not-triggered`, `failed` (a git command or ref the action would fail on) or `completed` with each Worker marked or not | phase-import | change-detection outcome (artefact) |
| W-CR6 | `the change-detection step of the deploy workflow runs for the push of that merge to {string} in a checkout that holds only the pushed commit` | As W-CR5, in a checkout that holds only the pushed commit, fetched at depth 1, as `actions/checkout` makes by default | phase-import | change-detection outcome (artefact) |
| T-CR1 | `the {string} cost record for model {string} holds a reported cost of ${float}` | Asserts the built record's `reportedCostUsd` equals the figure at four decimals; fails when it is absent | phase-import | built cost record (artefact) |
| T-CR2 | `the {string} cost record for model {string} holds a computed cost of ${float}` | Asserts the built record's `computedCostUsd` equals the figure at four decimals | phase-import | built cost record (artefact) |
| T-CR3 | `the {string} cost record for model {string} holds no reported cost` | Asserts the built record has no `reportedCostUsd` | phase-import | built cost record (artefact) |
| T-CR4 | `the {string} cost record for model {string} carries estimated tokens:` | Asserts the built record's `estimatedTokens` equal the table row (`input`, `output`, `cache_read`, `cache_write`) | phase-import | built cost record (artefact) |
| T-CR5 | `the {string} cost record for model {string} carries actual tokens:` | Asserts the built record's `actualTokens` equal the table row | phase-import | built cost record (artefact) |
| T-CR6 | `the {string} cost record for model {string} carries no actual tokens` | Asserts the built record has no `actualTokens` | phase-import | built cost record (artefact) |
| T-CR7 | `the divergence check fires for the {string} cost record for model {string}` | Asserts the real `checkDivergence` over the record's computed and reported costs reports a divergence, a difference of more than 5% | phase-import | divergence verdict (artefact) |
| T-CR8 | `the divergence check does not fire for the {string} cost record for model {string}` | Asserts `checkDivergence` reports no divergence; a record with no reported cost never diverges | phase-import | divergence verdict (artefact) |
| T-CR9 | `the divergence check fires for no {string} cost record` | Asserts the phase built records and `checkDivergence` reports a divergence for none of them | phase-import | divergence verdict (artefact) |
| T-CR10 | `the completion comment's cost section warns that {string} on {string} computed ${float} against a reported ${float}, a {float}% difference` | Renders the section once per scenario: `features/regression/drivers/feature-936-cost-section-driver.ts` runs as a child with the built records on stdin, `COST_REPORT_CURRENCIES=USD` and G-CR1's setting, and prints what the real `formatCostCommentSection` returns. Asserts the output carries `Cost Divergence Detected` and the item `**<phase>** (<model>): computed $<computed> vs reported $<reported> (<percent>% diff)` | subprocess | rendered cost section (driver stdout) |
| T-CR11 | `the completion comment's cost section carries no cost divergence warning` | Asserts the section, rendered as T-CR10 renders it, carries `Cost Breakdown` and no `Cost Divergence Detected` | subprocess | rendered cost section (driver stdout) |
| T-CR12 | `the completion comment's cost section reports estimated against actual tokens for {string} on {string}:` | For each row of the table, asserts the rendered section's `Estimate vs Actual Tokens` table holds a row of the phase, the model, the token type and its estimated, actual, delta and delta % figures, exactly as the row gives them | subprocess | rendered cost section (driver stdout) |
| T-CR13 | `the completion comment's cost section reports no estimated against actual tokens for {string} on {string}` | Asserts the rendered section carries `Cost Breakdown` and its `Estimate vs Actual Tokens` table holds no row for the phase and model | subprocess | rendered cost section (driver stdout) |
| T-CR14 | `the cost API received a {string} record for model {string} with reported_cost_usd {float} and computed_cost_usd {float}` | Among the records of every `POST /api/cost` G-CR8's server recorded, finds the phase's record for the model; asserts its `reported_cost_usd` equals the figure and its `computed_cost_usd` lies within 1e-9 of the figure | mock-query | recorded requests |
| T-CR15 | `the cost API's cost breakdown gives model {string} a cost of ${float}` | Asserts the cost breakdown W-CR3 recorded lists the model with a `totalCost` equal to the figure at four decimals | phase-import | Worker query response (artefact) |
| T-CR16 | `the cost API's per-issue costs give the {string} phase of issue {int} a cost of ${float}` | Asserts the per-issue costs W-CR3 recorded list the issue, and that the issue's phase has a `cost` equal to the figure at four decimals | phase-import | Worker query response (artefact) |
| T-CR17 | `a comparison of {string} with the default branch {string} finds no changed file` | Fails unless the two names are the release and default branches, then asserts `git diff --name-only <default>...<release>` in the throwaway repository lists no file | phase-import | git artefact (diff) |
| T-CR18 | `the change detection marks the {string} Worker for deployment` | Asserts the outcome W-CR5 or W-CR6 recorded is `completed` with the Worker's filter marked | phase-import | change-detection outcome (artefact) |
| T-CR19 | `the change detection leaves the {string} Worker out of the deployment` | Asserts the workflow was not triggered, or the outcome is `completed` with the Worker's filter not marked | phase-import | change-detection outcome (artefact) |
| T-CR20 | `the change detection either fails or marks the {string} Worker for deployment` | Asserts the outcome is `failed`, or `completed` with the Worker marked: never a silent skip | phase-import | change-detection outcome (artefact) |

This scenario also reuses already-registered phrases, so they need no new rows: `the ADW codebase is
checked out` (G18), `the ADW TypeScript type-check passes` (T22) and the git/gh guard pair W16/T34.
