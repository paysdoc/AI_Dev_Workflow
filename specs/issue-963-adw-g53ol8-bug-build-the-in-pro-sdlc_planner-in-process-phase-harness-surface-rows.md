# Bug: Surface rows 02–05, 31 and 32 cannot run: there is no in-process phase harness, the Claude stub answers every agent alike, and the lock and worktree steps point at nothing

## Metadata
issueNumber: `963`
adwId: `g53ol8-bug-build-the-in-pro`
issueJson: `{"number":963,"title":"bug: build the in-process phase harness and move the plan, build and lock surface rows onto it","body":"Source: the `## Divergence` section of `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, item 3, and the hybrid execution model the record decides. Read both before planning.\n\nSplit from #935, which was too large for one run and is closed. The facts below come from #935's planning research. Check them against the code before relying on them.\n\nThis is the first of the surface-tier slices. It builds the in-process phase harness and moves six surface rows onto it. Divergence item 3 stays until the last slice.\n\n## Background\n\nEvery `@surface` row reaches W1 `the {string} orchestrator is invoked with adwId {string} and issue {int}` (an orchestrator subprocess), which is `pending`. ADR-0037 says surface scenarios import phase functions and run in seconds; only smoke scenarios run processes. Removing the `pending` markers would not help, because the parked bodies refer to things that don't exist:\n\n- orchestrator files that don't exist: `adwReview.tsx`, `adwInit`;\n- stages that don't exist: `initialized`, `cancelled`;\n- a lock path that is never written: `.adw/locks/issue-N.lock`. The real lock is `agents/spawn_locks/…` (`adws/triggers/spawnGate.ts`).\n\n**The Claude stub can't currently be programmed per run.** Agent spawns go through `getSafeSubprocessEnv()` (`adws/core/environment.ts`), which drops every `MOCK_*` variable, so only the cwd marker file `.adw-stub-manifest.json` reaches the stub. And one manifest answers every agent call alike.\n\n## What to build\n\n**Claude CLI stub** (`test/mocks/claude-cli-stub.ts`, `manifestInterpreter.ts`, `stubResponse.ts`):\n\n- **Per-command entries.** The manifest gains an optional `byCommand` map, keyed by the slash command that opens the prompt, with `{ jsonlPath, edits?, commits?, response? }` per entry.\n- **Error response.** A `{ \"kind\": \"error\" }` response streams an `is_error: true` result and exits 1.\n- **Value flags.** `--settings` and the other value-taking flags the agents pass (`adws/agents/claudeAgent.ts`) are treated as value flags in `extractPrompt`, so the guardrails JSON is never mistaken for the prompt.\n- **Refusal guard.** `applyManifest` refuses to write `.adw/state.json`, `agents/**`, or any other file a Then step asserts on as the system's output.\n- Unit-test all four.\n\n**Mock server** (`test/mocks/github-api-server.ts`): export a synchronous `getMockServerState()` snapshot. Add routes only as the rows below need them, recording requests and updating state the way the existing routes do.\n\n**Fixture worktree.** G11 `the worktree for adwId {string} is initialised at branch {string}` materialises `test/fixtures/cli-tool/` in a temp dir:\n\n- `git init -b main`, then commit with the harness identity using `REAL_GIT_PATH`;\n- create a bare clone as `origin` and fetch it, so `refs/remotes/origin/main` exists;\n- check out the branch;\n- add a `.gitignore` for the stub's marker, payload and invocation files.\n\nTemp paths live under `os.tmpdir()`, and the `@regression` After hook removes them.\n\n**In-process phase harness** (`features/regression/support/phaseRun.ts`, `mockForgeProviders.ts`):\n\n- **`buildPhaseConfig(world, adwId, orchestratorName)`.** Follows the shape of `feature-910.steps.ts`. It sets:\n  - the issue from `getMockServerState()`;\n  - `issueType` mapped from the orchestrator;\n  - the G11 worktree and `defaultBranch: 'main'`;\n  - temp `logsDir`;\n  - `AgentStateManager.initializeState`;\n  - `detectRecoveryState([])`;\n  - `loadProjectConfig(worktree)`;\n  - the initial top-level state `starting`, written exactly as `initializeWorkflow` writes it;\n  - a `GitContext` for the worktree without network;\n  - `repoContext` built from `mockForgeProviders`, for `acme/widgets`.\n\n  In-process code never builds a production launch boundary or touches the real `GITHUB_PAT`.\n- **Stub delivery.** Set `CLAUDE_CODE_PATH` to the stub and call `clearClaudeCodePathCache()`. Write the scenario's manifest to `<worktree>/.adw-stub-manifest.json`.\n- **Running a phase.** Call `runPhase(config, new NonPostingCostTracker(), fn, <phaseName>)`, using the same phase name the production orchestrator passes, so the stage artefacts are the production ones. `NonPostingCostTracker` records instead of posting.\n- **Exit trap.** Trap `process.exit` for the call by throwing a sentinel, as `feature-910.steps.ts` does. Record `{ resolved, error, exitCode }` on the World.\n- **`mockForgeProviders`.** Implements only the port methods the driven rows call. Any other method throws `mockForgeProviders: <method> not supported`.\n\n**World and hooks.**\n\n- The World gains `phaseOutcome`, `lifecycleOutcome` and a `cleanup` list.\n- The `@regression` After hook runs the cleanup list (last in, first out, each entry guarded) before `teardownMockInfrastructure()`.\n\n**Steps.**\n\n- **New W-S1** `the {string} phase of the {string} orchestrator runs for adwId {string}`. The orchestrator name selects `OrchestratorId`, `issueType` and the `runPhase` phase name.\n- **New W-S2** `the {string} orchestrator's lifecycle runs for adwId {string}`. Runs `runWithOrchestratorLifecycle(config, fn)`. `fn` records that it ran, and whether `readSpawnLockRecord` named this process while it ran.\n- **New Thens:**\n  - `the {string} phase run failed`;\n  - `the spawn-gate lock for issue {int} was held by the orchestrator while its lifecycle ran`;\n  - `the orchestrator's lifecycle for adwId {string} did not run the workflow`.\n- **T6 and G5** use the real `getSpawnLockFilePath({owner:'acme',repo:'widgets'}, N)`.\n\n**Rows to rewrite, in place, keeping each file and its `@regression @surface` tags.** Assert only artefacts the real run produces. When the code does something other than what the old row claimed, the assertion follows the code; never weaken it to make it pass.\n\n| Row | Drive | Assert |\n|---|---|---|\n| 02 adwPlan planPhase happy | `executePlanPhase` | stage comments, including the plan-created heading (`adws/forge/workflowCommentsIssue.ts`) |\n| 03 adwPlan planPhase stub failure | `executePlanPhase` with the stub's `error` response | \"phase run failed\", and no plan-created comment |\n| 04 adwBuild buildPhase happy | `executeBuildPhase` (`'build'`) | T1 `build_completed`, plus comments |\n| 05 adwBuild lock | `runWithOrchestratorLifecycle` (+ G5) | lock held while it ran, plus T6 |\n| 31 adwPlan lock acquired | `runWithOrchestratorLifecycle` (+ G5) | lock held while it ran, plus T6 |\n| 32 adwBuild lock re-entry | G-PQ14 holds the lock | lifecycle did not run, and the other holder's lock is still present |\n\nRemove every manifest edit that writes the expected `.adw/state.json`. Add a \"Surface phases and lifecycles\" section to `features/regression/vocabulary.md`, and update the G11, G5 and T6 semantics.\n\n## Acceptance criteria\n\n- [ ] Rows 02–05, 31 and 32 run in-process, pass, and each finishes in under 5 seconds.\n- [ ] No manifest writes a file that a Then step asserts on; the refusal guard is unit-tested.\n- [ ] The stub's per-command routing, error response and value-flag handling are unit-tested.\n- [ ] Scenarios passing on `dev` still pass, including the timing-sensitive `features/regression/pause-queue/` ones.\n\n## Blocked by\n\n#960\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T07:59:08Z","comments":[],"actionableComment":null}`

## Bug Description
ADR-0037 decides a hybrid execution model. Smoke scenarios run real orchestrators against a Claude stub. Surface scenarios import phase functions and run in seconds. Item 3 of its `## Divergence` section records that none of this runs: every `@surface` row reaches W1 `the {string} orchestrator is invoked with adwId {string} and issue {int}`, whose body begins with `return 'pending';` (`features/regression/step_definitions/whenSteps.ts:53-69`). This issue is the first surface-tier slice. It builds the in-process phase harness and moves rows 02, 03, 04, 05, 31 and 32 onto it. The other 28 surface rows and the smoke scenarios stay pending, and Divergence item 3 stays open.

Taking the `pending` marker off would not make the six rows pass. Each fact below was checked against the code:

1. **W1 spawns a real orchestrator.** It needs a launch boundary and credentials, and its `ORCHESTRATOR_FILES` table names `adwReview.tsx`, which does not exist.
2. **The stub cannot be programmed per run.** Agents spawn `claude` with `buildClaudeLaunchEnv()` → `getSafeSubprocessEnv()` (`adws/core/environment.ts:128-177`). Its allowlist drops every `MOCK_*` name, so the `MOCK_MANIFEST_PATH` and `MOCK_FIXTURE_PATH` that G3 and G9 put in `World.harnessEnv` never reach an agent. Only the cwd marker `<cwd>/.adw-stub-manifest.json` does (`test/mocks/claude-cli-stub.ts:123-128`). One manifest then answers every agent alike: the plan agent's `/feature`, the build agent's `/implement` and the commit agent's `/commit` all get the same edits and the same payload.
3. **The stub has no error response.** `isManifestResponse` accepts only `kind: 'rate-limited'` (`test/mocks/manifestInterpreter.ts:75-83`). A manifest that asks for an error fails schema validation, so the stub exits 1 with no `result` line.
4. **The stub misreads the prompt.** `extractPrompt` knows only `--output-format`, `--model` and `--effort` as flags that take a value (`claude-cli-stub.ts:55`). For a target repository with guardrails on, `runClaudeAgentWithCommand` puts `--settings <json>` first (`adws/agents/claudeAgent.ts:145-148`), so the stub reads the guardrails JSON as the prompt. The rate-limit and schema probes pass `--max-turns 1`, so the stub reads `1` as the prompt.
5. **The manifests manufacture the evidence.** `adw-sdlc-happy.json` (the manifest rows 02 and 04 load), `cancel-directive.json`, `rate-limit-pause-resume.json`, `regression-possible-verdict.json` and `safe-verdict.json` write `.adw/state.json` with `workflowStage: awaiting_merge`. That is the stage T1 then reads.
6. **G5 and T6 look at a path nothing writes.** G5 deletes, and T6 checks for, `.adw/locks/issue-N.lock` (`givenSteps.ts:66-74`, `thenSteps.ts:96-110`). The spawn gate writes `agents/spawn_locks/<owner>_<repo>_issue-<N>.json` (`getSpawnLockFilePath`, `adws/triggers/spawnGate.ts:16-19`). T6 therefore passes whether a lock is held or not.
7. **G11 makes an empty repository.** It runs `git init` and `git checkout -b` in an empty temp directory (`givenSteps.ts:246-264`): no commit, no origin, no `.gitignore`. `executePlanPhase` reads `HEAD` first (`capturePlanPhaseBaseline`). The stub's marker and payload files would also be swept into any commit that stages everything.
8. **Row 32 seeds a stage no code writes** (`initialized`).

Expected behaviour: the six rows drive the real `executePlanPhase`, `executeBuildPhase` and `runWithOrchestratorLifecycle` in-process. They run against a mock forge, a fixture git worktree and a Claude stub that answers per command. They assert only what those runs produce, and each finishes in under 5 seconds. No stub manifest may write a file that a Then step reads as the system's output.

## Problem Statement
Build what the six rows need, and nothing more:

- **The stub:** routing per command, an error response, value flags that include `--settings`, and a refusal guard. Each is unit-tested.
- **The mock server:** a synchronous state snapshot, and a synchronous way for in-process forge calls to be recorded exactly as HTTP calls are.
- **G11:** a real fixture worktree, committed on `main`, with an `origin`.
- **The in-process phase harness:** `buildPhaseConfig`, stub delivery, `NonPostingCostTracker`, the exit trap and `mockForgeProviders`.
- **World and hooks:** the World's outcome fields and cleanup list, and the `@regression` After hook that runs the list.
- **Steps:** W-S1, W-S2 and the new Thens. G5 and T6 read the real lock.
- **Fixtures:** the rows' manifests, with every `.adw/state.json` edit removed.
- **Vocabulary:** the registry entries.

Four findings, checked against the code, shape the design:

- **F2. adwPlan names no phase.** `adws/adwPlan.tsx:44` calls `runPhase(config, tracker, executePlanPhase)` without a phase name. Run under that name, the plan phase writes no `plan_*` stage and leaves the top-level state at `starting`. Rows 02 and 03 therefore assert the phase run's outcome and its comments, not T1. `adws/adwBuild.tsx:54` passes `'build'`, so row 04 asserts T1 `build_completed`.
- **F3. The build phase needs a plan.** `executeBuildPhase` reads the plan before it runs the build agent and throws without one (`adws/phases/buildPhase.ts:44-51`). Row 04 needs a committed plan in its worktree.
- **F4. A top-level state left behind skips the phase.** `runPhase` skips a phase whose `phases` entry reads `completed` (`isPhaseAlreadyCompleted`, `adws/core/phaseRunner.ts:71-80`). `writeTopLevelState` merges and never clears `phases`. The rows use fixed adwIds, and `agents/<adwId>/` lives in the checkout. Unless the harness clears it, a second run of row 04 skips the build phase.
- **F8. The phases do not await their comments.** `IssueTracker.commentOnIssue` returns `void`, and `postIssueStageComment` does not await it (`adws/phases/phaseCommentHelpers.ts:35`). A mock forge that posts over HTTP would let the phase resolve before the server records the comment.

## Solution Statement
- **Stub.**
  - `extractPrompt` moves into a pure `test/mocks/stubArgs.ts` that knows every value flag ADW passes: `--output-format`, `--model`, `--effort`, `--settings` and `--max-turns`.
  - The manifest gains `byCommand`. The slash command that opens the prompt is matched exactly, so `/implement-tdd` never matches `/implement`. A matching entry applies alone: its edits, its commits and its response. Otherwise the top-level manifest applies exactly as today.
  - `{ "kind": "error" }` becomes a valid response at the top level and per entry. The stub then streams one `result` line built from the existing `result-message.jsonl` template, with `is_error: true` and `api_error_status` left `null`, and exits 1.
    - Why `null`: `classifyApiSignal` maps 401, 429, 529 and 5xx to auth, rate-limit, overload and server-error signals (`adws/core/claudeStreamParser.ts:151-157, 202-208`). `handleAgentProcess` turns the last three into `rateLimited` (`adws/agents/agentProcessHandler.ts:58-65`). The run would then throw `RateLimitError` and take the pause path's `process.exit`. With `null`, the run is a plain failure.
  - `applyManifest` gets a refusal guard. It runs before anything is written, over the top-level edits and deletes and over every `byCommand` entry's edits, so an entry the prompt does not select is checked too. It refuses `.adw/state.json`, `agents` and everything under it, and any path that resolves outside the worktree, which is how a manifest could reach the checkout's own `agents/`. The error names each refused path.
- **Mock server.** The route table becomes synchronous. Every handler already is.
  - One exported `dispatchMockRequest(method, url, body)` records the request and runs the route. Both the HTTP listener and `mockForgeProviders` call it.
  - `getMockServerState()` returns a deep copy of the state.
  - No new route is needed: the rows use only `POST /repos/:owner/:repo/issues/:issueNumber/comments`.
- **Fixture worktree.** A new `features/regression/support/fixtureWorktree.ts`:
  - copies `test/fixtures/cli-tool/` into a temp directory whose name carries the adwId;
  - writes a `.gitignore` for the stub's files;
  - runs `git init -b main` and commits with the harness identity;
  - bare-clones the repository as `origin`, adds it and fetches it, then checks out the branch.

  Every git call uses `REAL_GIT_PATH` when it is set, else `git`. Under the `@regression` hooks, `PATH` starts with `test/mocks/git-remote-mock.ts`, which turns `clone` and `fetch` into no-ops. Outside the hooks, `REAL_GIT_PATH` is unset (F7).
- **Harness.** `features/regression/support/phaseRun.ts`:
  - `buildPhaseConfig` builds a fully typed `WorkflowConfig` as the issue lists. It also clears `agents/<adwId>/` first (F4) and registers every temp path on the World's cleanup list.
  - Stub delivery points `CLAUDE_CODE_PATH` at the stub and copies the manifest G3 named to `<worktree>/.adw-stub-manifest.json`.
  - `NonPostingCostTracker` records cost records instead of posting them. `CostTracker.commit` calls `postCostRecordsToD1`, which posts to the real Cost API when the host's `.env` sets `COST_API_URL`.
  - The exit trap wraps `runPhase` and `runWithOrchestratorLifecycle`.
  - `features/regression/support/mockForgeProviders.ts` implements `commentOnIssue` through `dispatchMockRequest`, so the comment is recorded before the call returns (F8). It implements `moveToStatus` as a resolved `true`. Every other port method throws `mockForgeProviders: <method> not supported`.
- **World, hooks and steps.**
  - The World gains `phaseOutcome`, `lifecycleOutcome` and `cleanup`. The `@regression` After hook runs `cleanup` last in, first out, each entry guarded, before `teardownMockInfrastructure()`.
  - A new `surfaceSteps.ts` holds W-S1, W-S2, the plan-committed Given (F3) and the new Thens.
  - G5 and T6 use `getSpawnLockFilePath` and `releaseIssueSpawnLock` for `acme/widgets`.
  - G-PQ14 registers `releaseHeldSpawnLocks` on the cleanup list. Only feature-911's and feature-959's hooks release that lock today, so under row 32's tags the `sleep 60` holder and its lock would outlive the scenario (F5).
- **Fixtures and vocabulary.**
  - Five committed manifests lose their `.adw/state.json` edit.
  - Three new manifests serve the plan, plan-error and build rows. They touch nothing under `.adw/` or `.claude/`, because the plan phase's commit guard would fail row 02 (F6).
  - `vocabulary.md` gains a `## Given/When/Then — Surface phases and lifecycles` section. `adws/promotion/vocabularyParser.ts:53` reads tables only under `## Given|When|Then…` headings, hence the prefix. G5, G11 and T6 get their new semantics.
- **Per-issue support.** feature-963's step definitions are written to task 16's specification; the feature itself carries Gherkin only. feature-960's §6 row gets its amended step.

## Steps to Reproduce
Run from the repository root. `ROOT` is that directory.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --name "orchestrator's (plan phase|build phase|lifecycle)" --format summary`. This selects exactly the six rows. On `dev`, with the old row text, all six are reported pending at W1. With the rewritten rows in this branch's working tree, they report undefined steps (W-S1, W-S2 and the new Thens), and Cucumber exits 1.
2. `grep -n "\.adw/locks" features/regression/step_definitions/givenSteps.ts features/regression/step_definitions/thenSteps.ts` finds G5 and T6 at the invented path. `grep -n "spawn_locks" adws/triggers/spawnGate.ts` shows the path the spawn gate really writes.
3. Per-command routing does not exist:
   ```sh
   d=$(mktemp -d)
   printf '[{"type":"text","text":"default"}]' > "$d/top.json"
   printf '[{"type":"text","text":"plan"}]' > "$d/plan.json"
   printf '{"jsonlPath":"%s","edits":[],"byCommand":{"/feature":{"jsonlPath":"%s"}}}' "$d/top.json" "$d/plan.json" > "$d/.adw-stub-manifest.json"
   (cd "$d" && MOCK_STREAM_DELAY_MS=0 bun "$ROOT/test/mocks/claude-cli-stub.ts" --print --output-format stream-json --model m "/feature '7'" | tail -n 1)
   ```
   The last line is a `result` whose `result` is `default`.
4. The `--settings` value is misread. Re-run step 3 with `--settings '{"hooks":{}}'` before `--print`. The stub now takes the JSON as the prompt; `MOCK_INVOCATION_LOG=$d/inv.log` shows it.
5. The error response is rejected. Write `{"jsonlPath":"<d>/top.json","edits":[],"response":{"kind":"error"}}` as the marker and re-run step 3. The stub exits 1, its stderr reads `schema validation failed`, and stdout has no `result` line.
6. `grep -l '"\.adw/state\.json"' test/fixtures/jsonl/manifests/*.json` lists the five manifests that manufacture T1's stage.
7. G11's repository has no commit and no origin. Run any scenario that uses G11 with a breakpoint, or read `givenSteps.ts:246-264`: `git rev-parse HEAD` fails in the worktree it creates.

## Root Cause Analysis
The surface tier was parked in 6ffd1416 because the harness could not mock "the orchestrator's full GitHub App auth + target-repo workspace + end-to-end Claude pipeline". The cutover never built the in-process alternative ADR-0037 decided on. Everything around the parked steps grew without it:

- **The stub was built for one subprocess per scenario, programmed through `MOCK_*` variables.** The production spawn path's env allowlist removes those variables. The marker-file fallback added later kept single-manifest semantics, so one manifest answered every agent.
- **The stub hard-coded its value-flag list** before guardrails injection put `--settings` first.
- **G5 and T6 were written against an imagined lock path**, and G11 against an imagined minimal worktree. No step ever exercised either, because every scenario using them stops at the pending W1.
- **Manifests wrote the state file that T1 reads**, because no real run existed to produce it. Nothing stopped a manifest from doing so.

## Relevant Files
Use these files to fix the bug:

- `README.md`: project overview (read first).
- `.adw/coding_guidelines.md`: guard clauses, no `any`, files under 300 lines, comment discipline.
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: the conditional doc for `test/mocks/**` and `features/regression/**`. It records the hook-compatibility, `os.tmpdir()` scratch and "never two Cucumber processes in one checkout" invariants this change must keep.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: the hybrid execution model and Divergence item 3. Context only; it is not edited.
- `test/mocks/claude-cli-stub.ts`: its prompt extraction moves out, and it gains the error response.
- `test/mocks/manifestInterpreter.ts`: gains `byCommand`, the error response schema and the refusal guard.
- `test/mocks/stubResponse.ts`: gains the `error` response mode and the error-result builder.
- `test/mocks/github-api-server.ts`: gains `getMockServerState()` and the synchronous `dispatchMockRequest`.
- `test/mocks/types.ts`: `MockServerState`, the type of the snapshot.
- `test/mocks/test-harness.ts`: `setupMockInfrastructure` sets `CLAUDE_CODE_PATH`, `REAL_GIT_PATH`, the git-mock on `PATH` and `GH_TOKEN=mock-token`. It is read, not changed.
- `test/mocks/git-remote-mock.ts`: turns `clone` and `fetch` into no-ops, which is why G11 calls `REAL_GIT_PATH`.
- `test/mocks/__tests__/claude-cli-stub.test.ts`, `manifestInterpreter.test.ts`, `manifestInterpreterGit.test.ts`, `fixtures/manifestHarness.ts`: the unit-test conventions the new tests follow (spawn the stub with `MOCK_STREAM_DELAY_MS=0`, temp-dir cleanup, `checkConformance`).
- `test/fixtures/cli-tool/**`: the fixture G11 materialises. Its `.adw/` is tracked and off limits to the planner.
- `test/fixtures/jsonl/envelopes/result-message.jsonl`: the `result/success` template the error result is built from.
- `test/fixtures/jsonl/manifests/adw-sdlc-happy.json`, `cancel-directive.json`, `rate-limit-pause-resume.json`, `regression-possible-verdict.json`, `safe-verdict.json`: each loses its `.adw/state.json` edit.
- `features/regression/step_definitions/world.ts`: gains `phaseOutcome`, `lifecycleOutcome` and `cleanup`.
- `features/regression/support/hooks.ts`: the `@regression` After hook runs the cleanup list.
- `features/regression/step_definitions/givenSteps.ts`: G5 and G11.
- `features/regression/step_definitions/thenSteps.ts`: T6. T1, T2 and T3 are reused unchanged.
- `features/regression/step_definitions/whenSteps.ts`: W1 to W11 stay pending, untouched.
- `features/regression/step_definitions/feature-911.steps.ts`: G-PQ14 and `releaseHeldSpawnLocks`.
- `features/regression/step_definitions/feature-910.steps.ts`: the reference for the config shape and the `process.exit` sentinel.
- `features/per-issue/step_definitions/feature-930-plan-fixture.ts`, `feature-930-fixtures.ts`: an existing in-process `executePlanPhase` fixture with a real `GitContext` (`selfHost: false`, `createLiteralTokenProvider`). Use it as the reference.
- `features/regression/surfaces/row-02-adwPlan-planPhase-happy.feature`, `row-03-adwPlan-planPhase-error-stub-failure.feature`, `row-04-adwBuild-buildPhase-happy.feature`, `row-05-adwBuild-buildPhase-edge-missing-lock.feature`, `row-31-adwPlan-orchestratorLock-acquired-happy.feature`, `row-32-adwBuild-orchestratorLock-re-entry-edge.feature`: the six rows. The scenario phase already rewrote them in place in the working tree.
- `features/regression/vocabulary.md`: the registry. It gains the new section and the new G5, G11 and T6 semantics.
- `features/per-issue/feature-963.feature`: this issue's scenarios. It holds Gherkin only, with no notes for the step definitions; task 16 specifies each of its phrases.
- `features/per-issue/feature-960.feature`, `features/per-issue/step_definitions/feature-960.steps.ts`, `features/per-issue/step_definitions/feature-960-run.ts`: §6 is amended, and the child-run helper moves.
- `features/per-issue/feature-909.feature`, `feature-930.feature`, `feature-959.feature`: rows flagged `@adw-963` that run the stub's rate-limited and default responses, manifests with `.adw/` edits, and G-PQ14. They must stay green.
- `adws/core/phaseRunner.ts`: `runPhase`, `CostTracker` (`commit` posts to D1), and `isPhaseAlreadyCompleted` (F4).
- `adws/phases/orchestratorLock.ts`: `runWithOrchestratorLifecycle`, which acquires the lock, starts the heartbeat, runs `fn` and releases the lock, and returns `false` when refused.
- `adws/triggers/spawnGate.ts`: `getSpawnLockFilePath`, `readSpawnLockRecord`, `releaseIssueSpawnLock`, `acquireIssueSpawnLock`.
- `adws/phases/planPhase.ts`, `adws/phases/buildPhase.ts`: the driven phases. They use `moveToStatus`, `commentOnIssue` and the plan commit guard; the build phase needs a plan.
- `adws/phases/workflowInit.ts`: `WorkflowConfig` and the initial top-level state write (lines 334-347), which `buildPhaseConfig` mirrors.
- `adws/adwPlan.tsx`, `adws/adwBuild.tsx`: the phase names the production orchestrators pass. adwPlan passes none; adwBuild passes `'build'`.
- `adws/agents/claudeAgent.ts`: the agent argument vector, `--settings` injection and `buildClaudeLaunchEnv`.
- `adws/agents/agentProcessHandler.ts`, `adws/core/claudeStreamParser.ts`: how an `is_error` result is classified.
- `adws/core/environment.ts`: `getSafeSubprocessEnv`, `clearClaudeCodePathCache`, `AGENTS_STATE_DIR`.
- `adws/phases/phaseCommentHelpers.ts`, `adws/forge/workflowCommentsIssue.ts`: the stage comments and their headings.
- `adws/phases/planCommitGuard.ts`: the plan phase fails if `.adw/` or `.claude/` changes (F6).
- `adws/phases/workflowRepoIdentity.ts`: `resolveWorkflowRepoId` and `workflowLaunchContext`.
- `adws/core/orchestratorNames.ts`, `adws/core/constants.ts`: `deriveOrchestratorScript` and `OrchestratorId`.
- `adws/promotion/vocabularyParser.ts`: the heading rule the new registry section must follow.
- `adws/checkGitGhGuard.ts`, `adws/guard/constructionRule.ts`: `features/` and `test/` are exempt directories, so `new GitContext(…)` in the harness is allowed.

### New Files
- `test/mocks/stubArgs.ts`: the pure `VALUE_FLAGS` and `extractPrompt(argv)`.
- `test/mocks/__tests__/manifestByCommand.test.ts`: unit tests for per-command routing.
- `test/mocks/__tests__/manifestRefusalGuard.test.ts`: unit tests for the refusal guard, including every committed manifest.
- `test/mocks/__tests__/stubErrorAndFlags.test.ts`: unit tests for the error response and the value flags.
- `test/fixtures/jsonl/manifests/surface-plan-phase.json`: row 02.
- `test/fixtures/jsonl/manifests/surface-plan-phase-error.json`: row 03.
- `test/fixtures/jsonl/manifests/surface-build-phase.json`: row 04.
- `features/regression/support/fixtureWorktree.ts`: the harness git identity, `realGit`, `initialiseFixtureWorktree`, `commitFileOnBranch`.
- `features/regression/support/mockForgeProviders.ts`: the mock `RepoContext` for `acme/widgets`.
- `features/regression/support/phaseRun.ts`: `SURFACE_REPO`, `NonPostingCostTracker`, `buildPhaseConfig`, stub delivery, the exit trap, `runSurfacePhase` and `runSurfaceLifecycle`.
- `features/regression/step_definitions/surfaceSteps.ts`: W-S1, W-S2, G-S1 and the new Thens.
- `features/support/cucumberChildRun.ts`: `feature-960-run.ts`, moved and extended.
- `features/per-issue/step_definitions/feature-963.steps.ts`: plus sibling helpers, if it would pass 300 lines.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Record the baseline
- Before any code change, run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-963-regression.before 2>&1` and `bun run test:unit > /tmp/adw-963-unit.before 2>&1`, and keep both summaries. Validation compares against them.
- Never run two Cucumber processes from the same checkout at once. The pause-queue rows share `agents/paused_queue.json` and `agents/spawn_locks/`.

### 2. Move prompt extraction into a pure module and complete the value flags
- Create `test/mocks/stubArgs.ts` exporting:
  - `VALUE_FLAGS = new Set(['--output-format', '--model', '--effort', '--settings', '--max-turns'])`. The first four are what `runClaudeAgentWithCommand` passes; the probes pass `--max-turns`.
  - `extractPrompt(argv)`, today's algorithm moved unchanged: skip `argv[0..1]`, skip each value flag and its value, skip other flags, return the first non-flag argument.
- `claude-cli-stub.ts` imports it and drops its private copy. The stub runs `main()` on import, so tests cannot import from it.

### 3. Per-command entries, the error response and the refusal guard in `manifestInterpreter.ts`
- **Types.**
  - Today's `ManifestResponse` shape becomes `RateLimitedManifestResponse`. Add `ErrorManifestResponse { kind: 'error' }` and `export type ManifestResponse = RateLimitedManifestResponse | ErrorManifestResponse`.
  - Add `ManifestCommandEntry { jsonlPath: string; edits?: ManifestEdit[]; commits?: ManifestCommit[]; response?: ManifestResponse }`.
  - Add `byCommand?: Record<string, ManifestCommandEntry>` to `Manifest`.
- **Validation.**
  - `isManifestResponse` accepts `{ kind: 'error' }` as well as today's rate-limited shape.
  - Add `isManifestCommandEntry`.
  - `isManifest` validates `byCommand` when present: an object whose keys start with `/` and whose values are entries.
  - The schema error message mentions `byCommand`.
- **Selection.** `promptCommand(prompt)` returns the slash command that opens the prompt (`/^\/\S+/`, exact). The entry is `byCommand?.[command]`.
- **Refusal guard.**
  - Export a pure `findRefusedPaths(manifest, worktreePath): string[]` and `class ManifestRefusalError extends Error { readonly refusedPaths: readonly string[] }`.
  - A declared path is refused when, resolved against the worktree, it lies outside the worktree, equals `.adw/state.json`, or equals `agents` or lies under `agents/`. Normalise to POSIX first, so `./agents/x` and `src/../agents/x` are caught.
  - Check every top-level `edits[].path` and `deletes[]`, and every `byCommand` entry's `edits[].path`.
  - `.adw/commands.md`, `.adw/project.md`, `.claude/**`, `specs/**`, `src/**` and `adws/agents/planAgent.ts` stay allowed. feature-930 and `adw-upgrade-regen-happy.json` rely on `.adw/` edits.
- **`applyManifest` order:**
  1. read, parse and validate, as today;
  2. run the refusal guard over the whole manifest before anything else, including the `onCommitCommand` branch. On a refusal, throw `ManifestRefusalError`. Its message is `manifestInterpreter: refused manifest at <path>: it would write <p1>, <p2> …, which a Then step reads as the system's output`. Nothing is written;
  3. when an entry matches the prompt's command, apply only that entry: the duplicate-path check, its edits, then its `commits` as allow-empty commits like today's top-level `commits`. Return its resolved `jsonlPath` and its `response`. The top-level `deletes`, `stage`, `commitAll` and `onCommitCommand` do not run for that prompt;
  4. otherwise, today's top-level behaviour, unchanged.
- Update the header comment to name `byCommand`, the error response and the guard. Keep it short.

### 4. The error response in `stubResponse.ts` and the stub
- `stubResponse.ts`:
  - Add `ErrorResponseMode { kind: 'error' }` to `ResponseMode`.
  - `resolveResponseMode` maps a manifest `{ kind: 'error' }` to it, with the manifest taking precedence as for rate-limited.
  - Add a pure `buildErrorResultLine(resultTemplate, message): string`. It returns the template with `is_error: true`, `result: message`, `api_error_status: null` and the template's `subtype: "success"` kept. A real API error has that shape (`adws/jsonl/fixtures/result-error.jsonl`), so the line still resolves to the `result/success` schema entry. Add a one-line comment saying why the status stays `null`.
- `claude-cli-stub.ts`: when `mode.kind === 'error'`, stream `buildErrorResultLine` over `envelopes/result-message.jsonl` and `process.exit(1)` before the payload is read. The selected entry's edits are already applied by then, as for the rate-limited mode. Document `byCommand` and the error response in the header.

### 5. Unit tests for routing, the error response, the value flags and the refusal guard (AC2, AC3)
Follow the conventions of `claude-cli-stub.test.ts` and `manifestHarness.ts`: temp dirs under `os.tmpdir()` removed in `afterEach`, and the stub spawned with `bun` and `MOCK_STREAM_DELAY_MS=0`. Each file stays under 300 lines.

- **`manifestByCommand.test.ts`**, through `applyManifest`:
  - a `/feature` prompt writes only the `/feature` entry's edits and returns its `jsonlPath` and `response`;
  - an `/implement-tdd` prompt, with only an `/implement` entry, gets the top-level entry;
  - a prompt with no entry keeps today's top-level edits and `onCommitCommand` behaviour;
  - an entry's `commits` create commits;
  - an entry without `jsonlPath` is a `manifestInterpreter:` schema error;
  - `{ kind: 'error' }` validates at the top level and per entry.
- **`manifestRefusalGuard.test.ts`:**
  - Each of these is refused, with a `ManifestRefusalError` that names it, and none of the manifest's declared paths exists afterwards:
    - `.adw/state.json`;
    - `agents/surface-02/state.json`;
    - `agents/spawn_locks/acme_widgets_issue-1002.json`;
    - `agents/paused_queue.json`;
    - `./agents/x` and `src/../agents/x`;
    - `../outside.txt`, and an absolute path outside the worktree.
  - The refused path may sit in a top-level edit, a top-level delete, or a `/commit` entry asked with a `/feature` prompt.
  - The allowed paths above apply.
  - `findRefusedPaths` returns `[]` for every `*.json` under `test/fixtures/jsonl/manifests/` (AC2).
- **`stubErrorAndFlags.test.ts`:**
  - `extractPrompt` skips the `--settings <json>`, `--model`, `--effort`, `--output-format` and `--max-turns` values. On the exact vector `runClaudeAgentWithCommand` builds with `--settings` unshifted, it returns the prompt.
  - A spawned stub given that vector, with a marker manifest whose `/feature` entry answers "the plan answer", ends with a `result` whose `result` is that answer.
  - `resolveResponseMode({ kind: 'error' }, {})` returns `{ kind: 'error' }`. `buildErrorResultLine` keeps `api_error_status: null`.
  - A spawned stub whose top-level or `/feature` entry answers with the error response exits 1, and its last line is a `result` with `is_error: true`. After `parseJsonlOutput`, `lastResult` is set and `rateLimitDetected`, `authErrorDetected`, `serverErrorDetected` and `overloadedErrorDetected` are all false. `checkConformance` passes on the captured output, as the existing rate-limited test does.
  - A stub whose manifest writes `.adw/state.json` exits 1 with `.adw/state.json` on stderr, and the file does not exist.

### 6. Committed manifests
- Remove the `.adw/state.json` edit from `adw-sdlc-happy.json`, `cancel-directive.json`, `rate-limit-pause-resume.json`, `regression-possible-verdict.json` and `safe-verdict.json`. Change nothing else. Every scenario that loads them is pending at W1.
- Create the row manifests. Each payload is a JSON array with one text block, written as an edit to `.adw-stub-payload.json` at the worktree root, which G11's `.gitignore` covers. Each `jsonlPath` is `.adw-stub-payload.json`. Nothing is written under `.adw/` or `.claude/` (F6).
  - `surface-plan-phase.json` (row 02, issue 1002, adwId `surface-02`): a top-level payload, plus `byCommand["/feature"]`. That entry writes the payload and the plan `specs/issue-1002-adw-surface-02-sdlc_planner-surface-plan-phase.md`, a few lines of markdown. `getPlanFilePath` finds it by the `issue-<N>-adw-…-sdlc_planner-…` pattern.
  - `surface-plan-phase-error.json` (row 03): a top-level payload, plus `byCommand["/feature"]: { "jsonlPath": ".adw-stub-payload.json", "response": { "kind": "error" } }`.
  - `surface-build-phase.json` (row 04): a top-level payload and `"onCommitCommand": "stage-all-and-commit"`, so the build phase's `/commit` agent really stages and commits, as `.claude/commands/commit.md` does. Add `byCommand["/implement"]`, which writes `src/surfaceBuild.ts` and a payload answering that the plan for issue 1004 was implemented. The cli-tool fixture has no `@adw-1004` feature, so the build agent runs `/implement`.

### 7. Mock server: synchronous dispatch and state snapshot
- In `test/mocks/github-api-server.ts`:
  - `RouteHandler` returns `MockResponse`; every handler already is synchronous.
  - Extract and export `dispatchMockRequest(method, url, body, headers = {}): MockResponse`. It records the request unless the path starts with `/_mock/`, as today, then matches and runs the route, or returns the 404 body.
  - The HTTP listener reads the body, calls `dispatchMockRequest` and writes the result.
  - Export `getMockServerState(): MockServerState`, a deep copy (`structuredClone`) of the current state.
  - Add no route.

### 8. Fixture worktree: G11 and the plan-committed Given
- Create `features/regression/support/fixtureWorktree.ts`:
  - `HARNESS_GIT_IDENTITY = { name: 'ADW Regression', email: 'test@adw.local' }`, the identity G11 commits with today.
  - `realGit(cwd, ...args)`: `execFileSync(process.env.REAL_GIT_PATH ?? 'git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' })`.
  - `initialiseFixtureWorktree(adwId, branch)` returns `{ base, worktreePath, originPath }`:
    1. `base = mkdtempSync(join(tmpdir(), `adw-wt-${adwId}-`))`, so the adwId stays in the worktree's path (F7);
    2. `cpSync(<repo root>/test/fixtures/cli-tool, <base>/worktree, { recursive: true })`, with the repo root resolved from the module's own location;
    3. write `<worktree>/.gitignore` listing `.adw-stub-manifest.json`, `.adw-stub-payload.json` and `.adw-stub-invocations`;
    4. `git init -q -b main`, set `user.name` and `user.email` to the harness identity, `git add -A`, `git commit -q -m "Initial fixture commit"`;
    5. `git clone -q --bare <worktree> <base>/origin.git`, `git remote add origin <base>/origin.git`, `git fetch -q origin`, so `refs/remotes/origin/main` exists;
    6. `git checkout -q -b <branch>`, or stay on `main` when the branch is `main`.
  - `commitFileOnBranch(worktreePath, relPath, contents, message)`: writes the file and commits it with `realGit`.
- Rewrite G11 in `givenSteps.ts`. It calls `initialiseFixtureWorktree`, then sets `worktreePaths`, `targetBranch` and `harnessEnv.MOCK_WORKTREE_PATH` as today, and pushes `() => rmSync(base, { recursive: true, force: true })` onto `this.cleanup`.
- G11 must keep working without `REAL_GIT_PATH` and without the `@regression` hooks. feature-960's throwaway T1 row runs it that way and reads the adwId in the worktree path.

### 9. World and hooks
- `world.ts`:
  - `PhaseOutcome { adwId; orchestrator; phase; resolved: boolean; error?: unknown; exitCode?: number }`;
  - `LifecycleOutcome { adwId; orchestrator; issueNumber; returned?: boolean; ran: boolean; lockHolderPid: number | null; error?: unknown; exitCode?: number }`;
  - `type CleanupEntry = () => void | Promise<void>`;
  - fields `phaseOutcome?`, `lifecycleOutcome?` and `cleanup: CleanupEntry[] = []`.
- `hooks.ts`, the `@regression` After hook:
  1. run `this.cleanup` last in, first out, each entry awaited inside its own `try/catch`. A failure is logged as a warning and the rest still run;
  2. `await teardownMockInfrastructure()`;
  3. reset the existing fields, plus `phaseOutcome`, `lifecycleOutcome` and `cleanup = []`.

### 10. `mockForgeProviders`
- `features/regression/support/mockForgeProviders.ts` exports `mockForgeProviders(repoId, worktreePath): RepoContext`:
  - `issueTracker.commentOnIssue(n, body)` calls `dispatchMockRequest('POST', `/repos/${owner}/${repo}/issues/${n}/comments`, JSON.stringify({ body }))`. It records the request and appends the comment before it returns (F8).
  - `issueTracker.moveToStatus` is `async () => true`. Both phases await it; the server has no board route, and no row asserts on it.
  - Every other `IssueTracker` and `CodeHost` method is `notSupported('<method>')`, which throws `mockForgeProviders: <method> not supported`. Write both objects out against the port interfaces, so `tsc` proves the set is complete. Do not use a Proxy.
  - `repoId`, `cwd: worktreePath`, and no `boardManager`.

### 11. The in-process phase harness: `phaseRun.ts`
- Export `SURFACE_REPO: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub }`.
- A table keyed by orchestrator name; an unknown name or phase throws, naming the known ones:
  - `plan`: `OrchestratorId.Plan`, issue type `/feature`, phases `{ plan: { fn: executePlanPhase } }`. There is no phase name, because adwPlan passes none (F2).
  - `build`: `OrchestratorId.Build`, `/feature`, `{ build: { fn: executeBuildPhase, phaseName: 'build' } }`.
- `class NonPostingCostTracker extends CostTracker`. `commit(config, records)` pushes onto `committedRecords` and never calls `postCostRecordsToD1`.
- `buildPhaseConfig(world, adwId, orchestratorName): WorkflowConfig`:
  1. the worktree is `world.worktreePaths.get(adwId)`. Fail naming G11 when it is absent;
  2. the issue is the single entry of `getMockServerState().issues`. G4 replaces the whole map, so after G4 it holds exactly that issue. Fail naming the numbers found when there is not exactly one. Map the REST shape to the port `Issue`: `id`, `number`, `title`, `body`, `state`, `author` from `user.login`, label names, `comments: []`, `createdAt` (`new Date(0).toISOString()` when absent), `url: https://github.com/acme/widgets/issues/<n>`;
  3. `rmSync(join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true })` (F4), and push the same removal onto `world.cleanup`;
  4. `logsDir = mkdtempSync(join(tmpdir(), `adw-logs-${adwId}-`))`, with its removal on the cleanup list;
  5. `orchestratorStatePath = AgentStateManager.initializeState(adwId, orchestratorId)`;
  6. build the `GitContext` with `new GitContext({ owner: 'acme', repo: 'widgets', selfHost: false, tokenProvider: createLiteralTokenProvider('mock-token'), gitIdentity: <harness identity as author and committer>, frameworkRepoRoot: <G11 base>, targetReposDir: <G11 base> })`. Every git call the phases make passes the worktree as cwd, and none touches a remote. Never call `buildLaunchBoundary` and never read `GITHUB_PAT`;
  7. `branchName = gitContext.getCurrentBranch(worktree)`;
  8. write the initial top-level state with `AgentStateManager.writeTopLevelState(adwId, …)`, exactly as `initializeWorkflow` does: `adwId`, `issueNumber`, `workflowStage: 'starting'`, `orchestratorScript: deriveOrchestratorScript(orchestratorId)`, `repoIdentity: { owner: 'acme', repo: 'widgets' }`, `branchName`, `pid: process.pid`, `pidStartedAt: getProcessStartTime(process.pid) ?? undefined`, `lastSeenAt: new Date().toISOString()`;
  9. return a fully typed `WorkflowConfig` (no `as unknown as`): `issueNumber`, `adwId`, `issue`, `issueType`, `worktreePath`, `defaultBranch: 'main'`, `logsDir`, `orchestratorStatePath`, `orchestratorName`, `recoveryState: detectRecoveryState([])`, `ctx: { issueNumber, adwId, issueType }`, `branchName`, `applicationUrl: 'http://localhost:0'`, `repoContext: mockForgeProviders(SURFACE_REPO, worktree)`, `projectConfig: loadProjectConfig(worktree)`, `adwYmlConfig: readAdwYmlConfig(worktree)`, `topLevelStatePath: AgentStateManager.getTopLevelStatePath(adwId)`, `gitContext`.
- Stub delivery, `deliverStubManifest(world, worktree)`:
  - save `process.env.CLAUDE_CODE_PATH`, set it to `<repo root>/test/mocks/claude-cli-stub.ts` and call `clearClaudeCodePathCache()`. Push a cleanup entry that restores the saved value and clears the cache again;
  - when G3 named a manifest (`world.harnessEnv.MOCK_MANIFEST_PATH`), copy it to `<worktree>/.adw-stub-manifest.json`.
- The exit trap, `withExitTrap(run)`: replace `process.exit` with a function that throws a `PhaseExitSentinel(code)`, and restore it in `finally`. Return `{ resolved, value?, error?, exitCode? }`.
- `runSurfacePhase(world, adwId, orchestrator, phase): Promise<PhaseOutcome>`: look up the phase, build the config, deliver the stub, then run `withExitTrap(() => runPhase(config, new NonPostingCostTracker(), fn, phaseName))`.
- `runSurfaceLifecycle(world, adwId, orchestrator): Promise<LifecycleOutcome>`: build the config, then run `withExitTrap(() => runWithOrchestratorLifecycle(config, fn))`. `fn` sets `ran = true` and `lockHolderPid = readSpawnLockRecord(resolveWorkflowRepoId(config), config.issueNumber)?.pid ?? null`.
- Import the phase, agent and harness modules statically, never with `await import`. Their compile time then falls outside the scenario's run time.
- `import type` for `WorkflowConfig`. If the file passes 300 lines, split the config builder into `phaseConfig.ts`.

### 12. Steps: W-S1, W-S2, G-S1, the new Thens, G5 and T6
- Create `features/regression/step_definitions/surfaceSteps.ts`:
  - **W-S1** `the {string} phase of the {string} orchestrator runs for adwId {string}`: `this.phaseOutcome = await runSurfacePhase(this, adwId, orchestrator, phase)`.
  - **W-S2** `the {string} orchestrator's lifecycle runs for adwId {string}`: `this.lifecycleOutcome = await runSurfaceLifecycle(this, adwId, orchestrator)`.
  - **G-S1** `the worktree for adwId {string} has the plan for issue {int} committed on its branch`: `commitFileOnBranch` writes and commits `specs/issue-<N>-adw-<adwId>-sdlc_planner-surface-plan.md`, a short plan, in G11's worktree (F3).
  - `the {string} phase run succeeded`: the outcome exists, names that phase, and `resolved`. The failure message shows the error and the exit code.
  - `the {string} phase run failed`: the outcome exists and names that phase, `resolved` is false, `error` is set and `exitCode` is undefined. A `process.exit` (the pause or timeout path) is not a phase failure.
  - `the spawn-gate lock for issue {int} was held by the orchestrator while its lifecycle ran`: the lifecycle outcome is for that issue, `returned === true`, `ran`, and `lockHolderPid === process.pid`.
  - `the orchestrator's lifecycle for adwId {string} did not run the workflow`: the outcome is for that adwId, `returned === false`, `ran === false`, and there is no error or exit code.
  - `the spawn-gate lock for issue {int} is still held by the other live process`: `readSpawnLockRecord(SURFACE_REPO, N)` exists, its pid is not `process.pid`, and `isProcessLive(pid, pidStartedAt)` holds.
  - `the mock harness recorded zero comment posts on issue {int} containing the text {string}`: zero recorded `POST …/issues/<N>/comments` requests whose JSON `body` contains the text.
  - No step returns `'pending'`.
- **G5** (`givenSteps.ts`): `releaseIssueSpawnLock(SURFACE_REPO, issueNumber)`.
- **T6** (`thenSteps.ts`): assert `!existsSync(getSpawnLockFilePath(SURFACE_REPO, issueNumber))`. The message names the lock path.
  - Declare the callback `function (this: RegressionWorld, issueNumber: number)`. Today its first parameter is a real `_this: RegressionWorld`. Cucumber passes the issue number there and, seeing two parameters for one capture, takes the second for a callback that is never called, so the step times out after 60 s. Rows 05 and 31 and feature-963's G5 scenario need T6 to pass.
- Leave W1 and the other parked When steps as they are.

### 13. Release G-PQ14's lock under the `@regression` hooks
- In `feature-911.steps.ts`, G-PQ14 takes `this: RegressionWorld` and, after acquiring the lock, pushes `releaseHeldSpawnLocks` onto `this.cleanup` (F5).
- feature-911's and feature-959's own After hooks keep calling `releaseHeldSpawnLocks()`. A second call finds an empty map and does nothing.

### 14. The six rows
- The scenario phase already rewrote rows 02, 03, 04, 05, 31 and 32 in place in the working tree. Keep each file, its `@regression @surface` tags and no `@adw-` tag.
- Check that every phrase they use is now defined, and that they load the three new manifests.
- Where a row and the code disagree, the assertion follows the code and is never weakened. For example, adwPlan writes no `plan_*` stage (F2), so rows 02 and 03 assert the outcome and the comments, not T1.

### 15. Vocabulary registry
- In `features/regression/vocabulary.md`:
  - Rewrite the semantics of **G5** ("removes the spawn-gate lock file the spawn gate writes for `acme/widgets#N`, `getSpawnLockFilePath`"), **G11** (the fixture worktree of task 8, its cleanup, and `REAL_GIT_PATH`) and **T6** ("asserts no lock file exists at `getSpawnLockFilePath({owner:'acme',repo:'widgets'}, N)`").
  - Add `## Given/When/Then — Surface phases and lifecycles`. The heading must start with `Given/When/Then` for `vocabularyParser.ts`, and the table keeps five columns. Its intro says:
    - the rows run in-process (phase-import) through `features/regression/support/phaseRun.ts` against `mockForgeProviders`, G11's fixture worktree and the per-command stub, delivered as `<worktree>/.adw-stub-manifest.json` from G3;
    - they assert the phase run's outcome, the top-level state file, recorded mock-API requests and the spawn-lock artefact;
    - no step reads a source file.
  - The section's rows: G-S1, W-S1, W-S2, `the {string} phase run succeeded`, `the {string} phase run failed`, the two lock-held Thens, the lifecycle-did-not-run Then and the zero-comment-posts-containing Then.
  - Note the reused phrases: G3, G4, G5, G11, G-PQ14, T1, T2, T3 and T6.

### 16. Per-issue step definitions (feature-963 and feature-960)
- Move `features/per-issue/step_definitions/feature-960-run.ts` to `features/support/cucumberChildRun.ts` and repoint `feature-960.steps.ts`.
  - That directory is outside the `cucumber.js` import globs and the per-issue sweep. The sweep's sibling rule (`startsWith('feature-N.')`) would delete `feature-960.steps.ts` and leave the helper orphaned.
  - Extend it with what feature-963 needs:
    - each test case's duration, from its `testCaseStarted` and `testCaseFinished` timestamps;
    - the run's own temp directory (`<directory>/tmp`, the child's `TMPDIR`), returned so the caller can walk it. Every run gets a fresh directory.
- Write `features/per-issue/step_definitions/feature-963.steps.ts`, plus sibling helpers if it would pass 300 lines. It implements every phrase of `features/per-issue/feature-963.feature` that is not defined elsewhere. The feature carries no notes for the step definitions, so this list is their specification.
  - **Hooks.** Key them on `@adw-g53ol8-bug-build-the-in-pro`, never `@adw-963`: the flagged rows of features 909, 930, 959 and 960 carry `@adw-963` and must not run them.
    - Before: reset the module state. Remove the `acme/widgets` spawn locks for issues 1005, 1031, 1032, 9631 and 9632, so a lock an earlier run left behind cannot decide an assertion.
    - After: run `this.cleanup` last in, first out, each entry guarded. G11 pushes its removal there, and no `@regression` hook runs in this feature. Then remove the scenario's temp directories, restore `CLAUDE_CODE_PATH` and call `clearClaudeCodePathCache()` if a step changed it, and remove the same five locks.
  - **Child runs**, through `cucumberChildRun.ts` and by feature-960's rules:
    - `the regression suite's surface scenarios are run through Cucumber twice in a row`: two runs of `--tags "@surface"`, one after the other, each in a fresh directory. Running the whole surface tier means the parked rows' G11 cleanup is checked too.
    - `each of these surface rows passes on both runs, in under 5 seconds each time:`: for each row and each run, exactly one scenario has a `uri` ending in `features/regression/surfaces/<row>`. It passes, and its duration is under 5000 ms. The message shows `describeScenario` and the duration.
    - `the checkout holds no spawn lock for issue {int} in the repository {string}`: no file exists at `getSpawnLockFilePath({ owner, repo, platform: Platform.GitHub }, N)`. The message names the path.
    - `neither run left a git repository in its temporary directory`: walk each run's `TMPDIR`. Fail on any directory that holds a `.git` entry, or that is a bare repository (`HEAD` beside `objects/` and `refs/`), and list them.
    - `a throwaway regression scenario with the steps:`: `writeThrowawayFeature(directory, true, steps)`, so the scenario carries its unique tag and `@regression`.
    - `the throwaway regression scenario is run through Cucumber`: as feature-960's `the throwaway feature is run through Cucumber`. Exactly one scenario ran, and it carries the unique tag.
    - `the throwaway regression scenario fails at the step {string}`: the first failed step has that text, and every step before it passed.
    - `the throwaway regression scenario passes`: `verdictHolds(scenario, 'passes')`.
  - **G11's worktree**, checked in-process. This feature carries no `@regression` tag, so G11 runs here without `REAL_GIT_PATH`:
    - `the worktree for adwId {string} and its origin lie under the system's temporary directory`: the `realpathSync` of the registered worktree and of `git remote get-url origin` both lie under `realpathSync(os.tmpdir())`. On macOS, `/var` links to `/private/var`.
    - `the worktree for adwId {string} has the branch {string} checked out`: `git rev-parse --abbrev-ref HEAD`.
    - `in the worktree for adwId {string}, {string}, {string} and {string} name the same commit`: `git rev-parse --verify <ref>^{commit}` gives the same commit for all three refs.
    - `in the worktree for adwId {string}, the branch {string} tracks every file of {string}`: take every path `git ls-files <dir>` lists in the checkout, relative to `<dir>`. Each must appear in `git ls-tree -r --name-only <branch>` in the worktree.
    - `git ignores {string}, {string} and {string} in the worktree for adwId {string}`: `git check-ignore -q <name>` exits 0 for each.
  - **Stub runs.** Spawn the stub the way an agent does: `test/mocks/claude-cli-stub.ts` as the executable, the throwaway worktree as cwd, and `buildClaudeLaunchEnv()` as env. No `MOCK_*` name then reaches the stub; only the marker file programs it.
    - `a throwaway git worktree holding a stub manifest whose top-level entry answers {string} and writes {string}`: a temp git repository under `os.tmpdir()`, made with `git init -b main`, the harness identity, G11's `.gitignore` and one commit.
      - Its marker `<worktree>/.adw-stub-manifest.json` has an absolute `jsonlPath` to a payload that answers the text, and one edit that writes the path.
      - Payloads live outside the worktree, so the worktree only ever gains the declared edits.
    - `the stub manifest also has these per-command entries:`: one `byCommand` entry per row, each with its own payload and one edit.
    - `a throwaway git worktree holding a stub manifest whose (top-level entry|/feature entry) answers with the error response`: the same worktree with a default payload. Either the top level gets `response: { kind: 'error' }`, or a `/feature` entry `{ jsonlPath, response: { kind: 'error' } }` is added.
    - `the stub manifest's (top-level entry|/feature entry|/commit entry) also writes {string}`: adds the edit to that entry, creating the entry with its own payload when it is absent.
    - `/` is the alternation character in Cucumber expressions. Phrases that name `/feature` or `/commit` must be regular expressions, or escape it as `\\/`, as `whenSteps.ts` does for the git/gh guard phrase.
    - `the Claude CLI stub is run in that worktree, as an agent runs it, with a prompt that opens with {string}`: the vector `runClaudeAgentWithCommand` builds. That is `--print --verbose --dangerously-skip-permissions --output-format stream-json --model <model> --effort <effort>`, then the prompt `<command> '7'`.
    - `the Claude CLI stub is run in that worktree with the arguments an agent passes for a target repository whose guardrails are injected, ending in a prompt that opens with {string}`: the same vector, with `--settings <guardrails JSON>` unshifted as `claudeAgent.ts` does.
    - Each run records the exit status, stdout and stderr.
    - The exit steps:
      - `the stub exits 0 with the result {string}`: status 0, and the last stdout line is a `result` carrying that text;
      - `the stub exits 1`: status 1;
      - `the stub exits 1 with an error that names {string}`: status 1, and stderr contains the path;
      - `the stub's output ends with a result whose is_error is true`: the last stdout line is a `result` with `is_error: true`.
    - `the stub wrote {string} into the worktree`, `the stub wrote {string} into the worktree, and none of the files the manifest's other entries write` and `the stub wrote none of the manifest's edits into the worktree` read only the edit paths the manifest declares, at the top level and in every entry.
  - **The in-process agent run**, `an agent runs {string} in that worktree against the Claude CLI stub`:
    - point `CLAUDE_CODE_PATH` at the stub and call `clearClaudeCodePathCache()`;
    - call `runClaudeAgentWithCommand(<command>, '7', …)` with the worktree as cwd and no launch context, so nothing is injected;
    - record the `AgentResult`, or the error it throws.
    - `the agent run reports failure`: nothing was thrown, and `success` is false.
    - `the agent run reports neither a rate limit nor an expired login`: `rateLimited` and `authExpired` are unset, and no `RateLimitError` or `AuthRequiredError` was thrown.
  - **The committed-manifest sweep**, `the stub's manifest interpreter applies every manifest committed under {string}, each in a throwaway git worktree`:
    - for each `*.json` directly in the directory, make a fresh throwaway worktree and call `applyManifest(<manifest>, <worktree>, "/feature '7'")`;
    - record each `ManifestRefusalError` against the manifest's name. Any other error is not a refusal; an example is a `stage` path the throwaway worktree lacks.
    - `the refusal guard refused none of them`: nothing was recorded. The message lists each refused manifest and its error.
- In `feature-960.steps.ts`, add `every smoke and surface scenario is reported pending, except these surface rows, which pass:` beside its sibling.
  - Each listed row has exactly one scenario, and it passes. Every other smoke and surface scenario is reported pending, and the run includes scenarios from both directories.
  - The run itself happens in the existing When step. It is a `spawnSync`, which Cucumber's step timeout does not bound; the helper's `CHILD_TIMEOUT_MS` (120 s) does. Check that the whole `@smoke or @surface` run stays well inside it, now that six rows run for real and every parked row builds G11's fixture worktree.

### 17. Validation
- Run every command in `Validation Commands`. Fix and re-run until all pass.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

Run each command from the repository root. Never run two Cucumber processes from this checkout at once.

- `bun run lint`: zero errors or warnings.
- `bunx tsc --noEmit`: the root type check passes; it covers `features/**` and `test/**`.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional type check passes.
- `bun run build`: passes.
- `bun run test:unit`: the Vitest suite passes, including the three new files under `test/mocks/__tests__/` (AC2, AC3) and the existing stub and manifest tests.
- `bun run jsonl:check`: the envelope templates still conform. No envelope file was added.
- `bun run lint:git-guard`: no violation. `features/` and `test/` are exempt directories.
- `! grep -l '"\.adw/state\.json"' test/fixtures/jsonl/manifests/*.json`: no committed manifest writes `.adw/state.json` (AC2).
- `! grep -rn "\.adw/locks" features/regression/step_definitions`: G5 and T6 no longer read the invented lock path.
- `for i in 1 2; do NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --name "orchestrator's (plan phase|build phase|lifecycle)" --format summary || exit 1; done`: the six rows, twice in a row in the same checkout. Each run reports `6 scenarios (6 passed)` and exits 0. Before the fix they are undefined, and pending on `dev`.
- `test -z "$(ls agents/spawn_locks 2>/dev/null | grep -E '^acme_widgets_issue-(1002|1003|1004|1005|1031|1032)\.json$')" && test -z "$(ls -d agents/surface-0[2-5] agents/surface-3[12] 2>/dev/null)"`: the rows left no spawn lock and no top-level state in the checkout.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-963"`: exits 0. It runs all of `feature-963.feature` and the `@adw-963` rows of features 909, 930, 959 and 960:
  - the six rows pass on two runs in a row, each in under 5 seconds, and leave no lock and no repository behind (AC1);
  - under the `@regression` hooks, T6 fails while another live process holds the real lock and the After hook releases it, and G5 clears that lock so T6 passes;
  - G11's worktree;
  - from outside: per-command routing, the `--settings` vector, the error response (from the stub, and through an agent run) and the refusal guard, including the sweep of every committed manifest;
  - feature-960's amended §6: every other smoke and surface scenario stays pending.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@pause-queue-reset-time or @pause-queue-ownership"`: the timing-sensitive pause-queue features pass and exit 0 (AC4).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-963-regression.after 2>&1; tail -n 3 /tmp/adw-963-regression.after; ! tail -n 3 /tmp/adw-963-regression.after | grep -q failed`: the whole regression suite has no failed scenario.
  - Compared with `/tmp/adw-963-regression.before`, the only change is that the six rows are now passed. Every other scenario keeps its status, and the rest of the smoke and surface tier stays pending, so Cucumber still exits 1 on those, as Divergence item 3 records.
- `git status --porcelain`: shows only the files this plan names, and nothing under `agents/` or `logs/`.

## Notes
- Strictly follow `.adw/coding_guidelines.md`:
  - guard clauses and nesting of at most two levels;
  - no `any`; narrow `unknown`, and no `as unknown as WorkflowConfig`;
  - files under 300 lines, which is why the new steps go into `surfaceSteps.ts` rather than the already-long `thenSteps.ts`;
  - comments only for invariants and non-obvious reasons, such as why the error result keeps `api_error_status: null`, why G11 uses `REAL_GIT_PATH`, and why the harness clears `agents/<adwId>/`. No issue numbers in comments.
- No new library is needed.
- **F1, out of scope.** `runClaudeAgentWithCommand` builds `${contextPreamble}\n\n${command} …` when a caller passes a preamble, such as the plan agent's `config.installContext` after the install phase. These rows run no install phase, so their prompts open with the command, and `byCommand` matches the command that opens the prompt, as the issue specifies. A later slice that runs the install phase first will need the stub to find the command after the preamble.
- **F2. Why rows 02 and 03 do not assert a stage.** adwPlan names no phase, so the in-process plan phase leaves the top-level state at `starting`. Asserting `plan_completed` would assert something the production run never writes.
- The issue lists `loadProjectConfig(worktree)` but not `readAdwYmlConfig`. `WorkflowConfig` requires `adwYmlConfig`, so `buildPhaseConfig` reads it too. The cli-tool fixture has no `.github/adw.yml`, so the result is the default.
- `mockForgeProviders` records comments through `dispatchMockRequest` rather than HTTP. The port's `commentOnIssue` is synchronous and the phases do not await it (F8), so an HTTP post could land after the Then steps had already read the recorded requests. The recorded URL and body are exactly what an HTTP call would record, so T2, T3 and T14 read them unchanged.
- The guardrails probe stays stubbed by the global `Before` in `hooks.ts`. The harness `GitContext` is `selfHost: false`, so agents take the target-repo path. With the probe failing open, no `--settings` is injected in the rows; the stub's value-flag fix covers the case anyway.
- Under the `@regression` hooks, every `git` call from the phases and the stub goes through the git-mock wrapper, which delegates local subcommands to real git. That costs one `bun` start per call and keeps each row well inside 5 seconds. G11 and G-S1 call `REAL_GIT_PATH` directly.
- `features/regression/surfaces/logs/` is ignored hook output (`.gitignore:16`) and unrelated to this change.
- ADR-0037 Divergence item 3 stays open; this is the first surface slice. The document phase refreshes `app_docs/feature-9gjajh-bdd-regression-suite.md`. Its "W1/W10 stay pending" and T6 contracts, the harness, G11 and the stub's `byCommand`, error and refusal behaviour are the parts that change.
