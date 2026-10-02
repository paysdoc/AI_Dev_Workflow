# Feature: Hermetic subprocess harness for the init, merge, patch and cron surface rows

## Metadata
issueNumber: `966`
adwId: `p5u9xh-bug-build-the-hermet`
issueJson: `{"number":966,"title":"bug: build the hermetic subprocess harness and move the init, merge, patch and cron surface rows onto it","body":"Source: the `## Divergence` section of `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, item 3. Read it before planning.\n\nSplit from #935, which was too large for one run and is closed. The facts below come from #935's planning research. Check them against the code before relying on them.\n\nBuilds the hermetic subprocess harness and moves the surface rows that can only be reached through a process boundary onto it: workflow init, `adwMerge`, a full `adwPatch` run, and the cron probe. The smoke slices reuse this harness. Divergence item 3 stays until the last slice.\n\n## Why the harness is needed\n\n- **GitHub traffic never reaches the mock.** It goes through the `gh` CLI (`@paysdoc/devplatform` → `ghRepoApi` → `GitContext.exec`, GraphQL included), so `GH_HOST`/`MOCK_GITHUB_API_URL` never route it. A synchronous `gh` call that tried to reach the in-process mock server would deadlock it; see the header of `features/regression/step_definitions/feature-902-queue.steps.ts`.\n- **Orchestrators have nowhere safe to run.** Without `--target-repo`, an orchestrator works on the ADW checkout itself. The target-repo path needs three things:\n  - a workspace under `TARGET_REPOS_DIR`, which is read at module load;\n  - `refs/remotes/origin/<default>`;\n  - `origin/<default>:.adw-version` equal to the framework hash. Otherwise the upgrade gate parks the issue and exits 0.\n\n## What to build\n\n**`gh` shadow** (`test/mocks/gh-cli-shadow.ts`, plus `features/regression/support/forgeShadow.ts`). A bun script behind a `/bin/sh` wrapper named `gh`, built like the git wrapper.\n\n- **Reads** are answered from `ADW_GH_STATE`: `auth token`, `api <path>` GET, `issue view/list`, `pr view/list`, `repo view`.\n- **Writes** append to `ADW_GH_LOG` and print what the real CLI prints: comment, label edits, issue create and close, pr create/merge/review, `api -X POST/PATCH/PUT/DELETE`, `label create`, `secret set`.\n- **GraphQL** is logged and answered with an empty data object.\n- **Unknown subcommands** exit 1 with `gh shadow: unsupported: <argv>`.\n- **`forgeShadow.ts`:**\n  - `installGhShadow()` returns a directory to prepend to the child's `PATH` only, never to the Cucumber process's own `PATH`;\n  - `writeForgeState()` seeds the state from `getMockServerState()`;\n  - `replayForgeLog()` sends each logged write to the mock as REST, from the Cucumber process, after the child exits. Replaying after exit is what avoids the deadlock.\n- The existing 902/908 shadows stay untouched.\n\n**Target workspace** (`fixtureTargetRepo.ts`): `materialiseTargetWorkspace('acme', 'widgets')` lays out `test/fixtures/cli-tool/` at `<temp TARGET_REPOS_DIR>/acme/widgets`, on `main`.\n\n- **Origin URL.** Set it to `https://github.com/acme/widgets.git` and pass the same value as `--clone-url`. If the URL does not parse to the workflow's owner/repo, `bindWorkspaceContext` leaves `repoContext` undefined and nothing is ever posted. It is never contacted.\n- **Remote ref.** Create `refs/remotes/origin/main` locally with `REAL_GIT_PATH update-ref`.\n- **Framework hash.** Commit `.adw-version` equal to `computeFrameworkHash(<ADW root>)` before creating the ref.\n\n**Subprocess runner** (`subprocessRun.ts`).\n\n- **Environment.** Start from `process.env` and force:\n  - a fake but syntactically complete `GITHUB_PAT`;\n  - empty strings for `GH_TOKEN`, the GitHub App variables, the cost API, Slack and R2 variables. They must be present, not unset, so dotenv never fills them from the host `.env`;\n  - `CLAUDE_CODE_PATH` set to the stub;\n  - temp `TARGET_REPOS_DIR` and temp `HOME` (`ensureTargetRepoWorkspace` writes `$HOME/.claude.json`);\n  - `ADW_TARGET_GUARDRAILS=off`;\n  - git author and committer identity;\n  - `PATH` set to the `gh` shadow, then the git mock, then the rest.\n- **Spawning.** Use async `spawn` with `detached: true`, never `spawnSync`. Use per-call timeouts (120 s for an orchestrator, 30 s for init), and kill the process group on timeout, failing with the output tail.\n- **Outputs.** Set `World.lastExitCode`, then replay the forge log.\n- **Stub marker lookup.** The stub searches upward from its cwd for `.adw-stub-manifest.json`, stopping at the first hit or the filesystem root. Every marker lives under `os.tmpdir()`. Add a tested case.\n- **Cleanup.** Register `agents/<adwId>/`, `logs/<adwId>/`, the `acme/widgets` spawn lock, the cron registry and log, the temp dirs, and the process groups the harness started.\n\n**Real step bodies:**\n\n- **W1** `the {string} orchestrator is invoked with adwId {string} and issue {int}`.\n  - **Name map:** `sdlc`, `chore`, `plan`, `build`, `test`, `patch`, `merge`, `document`, `pr-review`, `promotion-sweep`. An unknown name fails and lists the known ones; there is no `review` and no `init`.\n  - **Arguments** come from `adws/core/orchestratorCli.ts`. Always pass `--issue-type`. Without it, `initializeWorkflow` runs the classifier agent with the ADW checkout as its cwd.\n- **W9** `the workflow is initialised with config {string}`. Runs the init driver through the runner.\n- **W10** `the cron probe runs once`.\n  - Spawns `trigger_cron.ts --target-repo acme/widgets`, with #961's `bunx` launch recorder intercepting launches.\n  - Waits up to 60 s for the first `POLL:` line, then a short settle, then kills the process group and replays.\n  - Does not set `lastExitCode`.\n  - Seeded issues must be older than the 5-minute grace period and carry an `adw:*` label.\n  - G7 must not wipe the issues G4 seeded.\n\n**Rows:**\n\n| Row | Drive | Assert |\n|---|---|---|\n| 01 adwPlan workflowInit happy | W9 | T1 `starting`; retitle to \"records the starting stage\" (no `initialized` stage exists) |\n| 10 adwMerge already merged | W1 `merge`, over a seeded `awaiting_merge` top-level state (new Given; without it adwMerge exits 0 on `no_state_file`) whose PR is merged | what adwMerge writes, plus T5 |\n| 11 adwMerge PR not merged | the same, with an open PR (check `executeMerge` in `adwMerge.tsx`) | the stage, labels and comments it writes, plus T5 |\n| 16 adwPatch planPhase | W1 `patch` (the patch phase is private to `adwPatch.tsx`) | T1 `completed`, T5 0, and the PR request as produced |\n| 19 adwInit workflowInit edge | W9 on a real edge, e.g. a prior state with another repository's identity, which fails closed (`crossCheckRepoIdentity`) | T5, plus T1 as produced |\n| 29 cron probe empty queue | W10, no eligible issue | new Then `the cron launched no orchestrator` |\n| 30 cron probe dispatch | W10, eligible issue 1030 | new Then `the {string} orchestrator was launched for issue {int}` |\n\nAdd a \"Smoke processes\" section to `features/regression/vocabulary.md`, and update the W1, W9 and W10 semantics.\n\n## Acceptance criteria\n\n- [ ] Rows 01, 10, 11, 16, 19, 29 and 30 run and pass.\n- [ ] No child process reaches the network, the real `gh`, the developer's `$HOME`, or the ADW checkout's own `agents/` beyond the paths the cleanup removes.\n- [ ] An unsupported `gh` call fails the scenario with the `gh shadow: unsupported` message.\n- [ ] Scenarios passing on `dev` still pass.\n\n## Blocked by\n\n#960\n#961\n#963\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T07:59:12Z","comments":[],"actionableComment":null}`

## Feature Description
ADR-0037 decides a hybrid execution model for the regression suite. A few scenarios run real orchestrators against a Claude stub. Surface scenarios run phases in seconds. Item 3 of its `## Divergence` section records that the smoke and surface scenarios are pending. #963 built the in-process phase harness and moved rows 02–05, 31 and 32 onto it. This issue builds the second half: a **hermetic subprocess harness**. It runs real ADW processes (an orchestrator, the workflow-init driver, a cron trigger) as children of the Cucumber process. Each child reaches GitHub only through a `gh` shadow that the mock GitHub API backs. It works on a throwaway target-repository workspace. It reaches Claude only through the stub, and nothing it does touches the developer's credentials, `$HOME` or real workflows.

Seven surface rows move onto the harness: 01 and 19 (workflow init), 10 and 11 (`adwMerge`), 16 (a full `adwPatch` run), and 29 and 30 (the cron probe). They are the rows that can only be reached through a process boundary. The smoke slices will reuse the same harness later, so Divergence item 3 stays open.

The value is that `@regression` gains wiring coverage of real process boundaries. These are the launch boundary, CLI parsing, target-workspace setup, the upgrade gate, the spawn lock, state writes, GitHub writes and cron dispatch. A wiring bug in any of them now fails the suite instead of hiding behind a pending step.

## User Story
As an ADW maintainer
I want the init, merge, patch and cron surface rows to run real ADW processes inside a hermetic harness
So that a wiring bug at a process boundary fails the regression suite, and running the suite can never touch GitHub, my credentials, my `$HOME` or my real workflows

## Problem Statement
Checked against the code on 2026-10-02:

1. **W1, W9 and W10 are pending** (`features/regression/step_definitions/whenSteps.ts`). The commented-out bodies are not usable:
   - W1's `ORCHESTRATOR_FILES` names `adwReview.tsx`, which does not exist. It uses `spawnSync` with a 30 s timeout, passes no `--target-repo` (so the orchestrator would work on the ADW checkout itself), and passes no `--issue-type`.
   - W10 spawns `adwSdlc.tsx --cron`, which is not a CLI that exists.
   - W9 calls `initializeWorkflow` in-process with a fake config.
2. **GitHub traffic never reaches the mock.** Every forge call goes through `GitContext.exec` → `execSync('/bin/sh -c "gh …"')`, synchronously, with cwd set to the framework root (`node_modules/@paysdoc/devplatform/dist/git/gitContext.js`, `providers/github/ghCommandRunner.js`). `GH_HOST`/`MOCK_GITHUB_API_URL` route none of it. A child `gh` that called the in-process mock server synchronously would deadlock it (header of `feature-902-queue.steps.ts`).
3. **No target workspace exists.** `TARGET_REPOS_DIR` is read at module load (`adws/core/environment.ts:125`). `ensureRepoWorkspace` only runs `git fetch origin` plus the default-branch read when the workspace is already cloned. The upgrade gate reads `origin/<default>:.adw-version` (`adws/phases/upgradeGate.ts`) and parks the issue when it differs from `computeFrameworkHash(REPO_ROOT)`. `bindWorkspaceContext` binds a `repoContext` only when the workspace's origin URL parses to the workflow's owner/repo.
4. **A child process is not isolated by default:**
   - `dotenv.config()` fills every unset variable from the checkout's `.env`, which holds the developer's PAT, GitHub App key, Cost API, Slack and R2 credentials.
   - `COST_REPORT_CURRENCIES` falls back to `EUR` when empty, so a completed workflow fetches `https://open.er-api.com` (`adws/cost/exchangeRates.ts`).
   - `ensureTargetRepoWorkspace` writes `$HOME/.claude.json`.
   - `git fetch origin` in a real workspace goes to the network unless the git mock leads `PATH`.
   - A cron child reads the checkout's `agents/.auth_gate`. When it holds a record, the tick never polls and SIGTERMs every live orchestrator it finds (`handleAuthGateTick`, `adws/triggers/trigger_cron.ts`).
5. **The stub only reads a marker in its own cwd** (`resolveManifestPath`, `test/mocks/claude-cli-stub.ts`). A subprocess run creates its worktree under `<TARGET_REPOS_DIR>/acme/widgets/.worktrees/<branch>`, a path the harness cannot know in advance, so it cannot drop a marker there.
6. **The seven rows assert things no run produces:**
   - row 01 asserts an `initialized` stage that no code writes;
   - rows 10 and 11 have no top-level state, so `adwMerge` exits 0 on `no_state_file`;
   - row 19 invokes an `init` orchestrator that does not exist;
   - rows 29 and 30 count API calls and comments the cron does not make;
   - G4 seeds an issue with no `adw:*` label and no age, so the cron filters it out;
   - G7 replaces the issue map and wipes the issue G4 seeded;
   - G10 replaces the PR map and drops any head branch a Given recorded.
7. **`adwPatch.tsx` ignores `--issue-type`** (`supportsIssueType: false`), so its `initializeWorkflow` runs the `/classify_issue` agent with the ADW checkout as cwd, whatever W1 passes.

## Solution Statement
Build the harness from small, pure-where-possible modules. Gate the three When steps on a new `@subprocess` tag, so every other smoke and surface scenario stays pending, exactly as feature-960 §1, §5 and §6 require.

- **The `gh` shadow:**
  - `test/mocks/gh-cli-shadow.ts` is a bun script behind a `/bin/sh` wrapper named `gh`, built like `createGitMockDir`.
  - It answers reads from a gh-shaped forge state file (`ADW_GH_STATE`) and applies its own writes to that file, so a later read in the same run sees them.
  - Each write goes to an NDJSON log (`ADW_GH_LOG`) as the REST request it stands for. GraphQL is logged and answered `{"data":{}}`.
  - Anything else is logged as unsupported, written to stderr as `gh shadow: unsupported: <argv>` and exits 1.
  - Argument parsing and the REST mapping live in pure modules.
- **`forgeShadow.ts`** installs the wrapper in a temp directory that only the child's `PATH` sees. It writes the state from `getMockServerState()`. After the child exits, it replays every logged request through `dispatchMockRequest`. The existing T steps then see the child's writes exactly as HTTP calls would record them. Any unsupported call then fails the step with its message, even when the child exited 0.
- **`fixtureTargetRepo.ts`** materialises the cli-tool fixture as `<temp TARGET_REPOS_DIR>/acme/widgets` on `main`:
  - `.adw-version` holds the framework hash and is committed;
  - the origin URL is `https://github.com/acme/widgets.git`;
  - `refs/remotes/origin/main` is created with `update-ref`.
- **`subprocessHarness.ts`** is the per-scenario harness that the `@regression and @subprocess` Before hook creates. It holds:
  - the temp root, `TARGET_REPOS_DIR`, `HOME`, forge state and log;
  - the `gh` shadow and the launch recorder;
  - the saved auth gate and cron files;
  - the claimed adwIds and issues;
  - the process groups it started.

  Every teardown goes onto `World.cleanup`.
- **`subprocessRun.ts`** builds the hermetic environment and spawns children asynchronously in their own process group. It enforces per-call timeouts by killing the group and failing with the output tail, records the exit code and output, and replays.
  - W1 runs an orchestrator from a name map.
  - W9 runs a new init driver, `features/regression/drivers/workflowInitDriver.ts`, which mirrors `adwPlan.tsx`'s startup and stops after `initializeWorkflow`.
  - W10 runs `trigger_cron.ts --target-repo acme/widgets` until its first `POLL:` line, then settles the launch recorder and kills it.
- **Stub marker lookup:** the stub searches upward from its cwd for `.adw-stub-manifest.json`. The harness puts the row's manifest at the temp `TARGET_REPOS_DIR` root, above every worktree a run creates.
- **The rows** get the `@subprocess` tag. Two new Givens seed an `awaiting_merge` workflow and a prior run under another repository. Five new Thens read only runtime artefacts: a recorded merge, the process output, and the cron's recorded launches. G4, G7 and G10 change as the issue requires. Row 16 gets a committed manifest, `surface-patch-run.json`.
- **`adwPatch.tsx` honours `--issue-type`**, as `adwPlan`, `adwBuild`, `adwChore` and `adwSdlc` already do. "Always pass `--issue-type`" then keeps the classifier out of the patch run.
- **`vocabulary.md`** gains a `Given/When/Then — Smoke processes (@subprocess)` section, and the W1, W9, W10, T5, T7, G4, G7 and G10 semantics are updated.

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview; its project-structure tree lists `test/mocks/` and `features/regression/support/` files and must list the new ones.
- `.adw/coding_guidelines.md` — must be followed: files under 300 lines, at most two levels of nesting, guard clauses, no `any`, and comments only for invariants and non-obvious reasons.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` — the decision and Divergence item 3, which stays open after this slice.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — conditional doc for `test/mocks/**` and `features/regression/**`: the harness contracts, the W1/W10 pending rule, `World.cleanup`, the stub's marker and the mock server's `dispatchMockRequest`/`getMockServerState()`.
- `features/regression/step_definitions/whenSteps.ts` — W1, W9 and W10 get real bodies. Delete the dead `spawnOrchestrator` and `ORCHESTRATOR_FILES`.
- `features/regression/step_definitions/givenSteps.ts` — G4, G7 and G10 change; G3 still sets `MOCK_MANIFEST_PATH`, which the subprocess harness delivers as a marker.
- `features/regression/step_definitions/thenSteps.ts` — T1, T2, T3, T5, T7, T8 and T14 are reused unchanged. It is already 414 lines, so no new step goes here.
- `features/regression/step_definitions/world.ts` — `RegressionWorld` gains the harness fields.
- `features/regression/support/hooks.ts` — the `@regression` hooks; it gains the `@regression and @subprocess` Before, and the After resets the new fields.
- `features/regression/support/cleanup.ts` — `runCleanup`, LIFO and guarded; every harness teardown goes through it.
- `features/regression/support/fixtureWorktree.ts` — `realGit`, `initialiseRepository`, `HARNESS_GIT_IDENTITY` and `STUB_FILES`, reused by the target workspace.
- `features/regression/support/launchRecorder.ts` — #961's `bunx` recorder: `createLaunchRecorder`, `recordedLaunches`, `settleLaunches`, `describeLaunches` and `disposeLaunchRecorder`.
- `features/regression/support/claudeCliStub.ts` — `CLAUDE_CLI_STUB`.
- `features/regression/support/mockForgeProviders.ts` — `SURFACE_REPO` (`acme/widgets`).
- `features/regression/support/phaseConfig.ts` — the `SURFACE_ADW_ID` guard and `seededIssue()` idiom that the subprocess harness mirrors.
- `features/regression/step_definitions/feature-902-queue.steps.ts`, `realCronProcess.ts` — precedent for a `gh` shadow, replay-after-exit and a real cron child killed by process group. Both stay untouched.
- `features/regression/vocabulary.md` — the registry.
- `features/regression/surfaces/row-01-adwPlan-workflowInit-happy.feature`, `row-10-adwMerge-autoMergePhase-happy.feature`, `row-11-adwMerge-autoMergePhase-edge-pr-not-merged.feature`, `row-16-adwPatch-planPhase-happy.feature`, `row-19-adwInit-workflowInit-edge-already-initialised.feature`, `row-29-adwSdlc-cronProbe-edge-empty-queue.feature`, `row-30-adwSdlc-cronProbe-happy-dispatch.feature` — the seven rows.
- `features/support/cucumberChildRun.ts` — the shared child Cucumber runner. It needs a longer child timeout, extra tags on throwaway features and an environment overlay.
- `features/per-issue/feature-966.feature` — this issue's scenarios. `feature-960.feature` §1, §5 and §6, `feature-961.feature`, `feature-963.feature` and `feature-909.feature` carry `@adw-966` rows that must keep passing.
- `features/per-issue/step_definitions/feature-960.steps.ts`, `feature-961.steps.ts`, `feature-963.steps.ts`, `feature-963-stub.steps.ts` — existing per-issue phrases that feature-966 reuses.
- `test/mocks/claude-cli-stub.ts` — marker lookup becomes upward.
- `test/mocks/test-harness.ts` — `createGitMockDir`, the wrapper pattern the `gh` shadow copies, and the `PATH`/`REAL_GIT_PATH` it sets.
- `test/mocks/github-api-server.ts` — `dispatchMockRequest` (replay target) and `getMockServerState()` (forge-state source). Unrouted paths are still recorded.
- `test/mocks/types.ts` — `MockServerState`, `RecordedRequest`.
- `test/mocks/manifestSchema.ts`, `manifestInterpreter.ts`, `manifestRefusalGuard.ts` — the manifest format and refusal guard that `surface-patch-run.json` must satisfy.
- `test/fixtures/cli-tool/**` — the fixture laid out as the target workspace (`.adw/providers.md` names github; `## Unit Tests: disabled`).
- `test/fixtures/jsonl/manifests/surface-build-phase.json` — the `byCommand` + `onCommitCommand` pattern row 16's manifest follows.
- `adws/core/orchestratorCli.ts` — the CLI grammar: `<issue> [adwId] [--issue-type t] [--target-repo o/r] [--clone-url u] [--cwd p]`.
- `adws/adwPatch.tsx` — gains `--issue-type`. Its run is install → patch (`/patch`) → build (`/implement`, `/commit`) → PR (`/pull_request`, `gh pr create`) → `completeWorkflow` (`completed`).
- `adws/adwMerge.tsx` — `executeMerge`:
  - no state → `no_state_file`;
  - stage ≠ `awaiting_merge` → `abandoned`;
  - `findPullRequestByBranch(state.branchName)`;
  - MERGED → `completed` plus "PR #N has been merged.";
  - OPEN → `hitl` label and approval check, then `ensureWorktree`, `mergeWithConflictResolution` and `gh pr merge`, then `completed` plus "PR #N has been merged successfully."
- `adws/triggers/autoMergeHandler.ts` — `mergeWithConflictResolution`'s git sequence (`fetchAndResetToRemote`, a dry-run merge, `pushBranch`, `mergePullRequest`).
- `adws/phases/workflowInit.ts` — `initializeWorkflow`, in order:
  1. workspace;
  2. issue fetch;
  3. classification, unless `issueType` is given;
  4. upgrade gate;
  5. branch-name cascade;
  6. worktree;
  7. `bindWorkspaceContext`;
  8. `crossCheckRepoIdentity`;
  9. the `starting` write;
  10. the `## :rocket: ADW Workflow Started` comment.
- `adws/core/repoIdentityCrossCheck.ts` — `Repo identity mismatch: launch=<o/r> persisted=<o/r>. …`.
- `adws/core/targetRepoManager.ts`, `node_modules/@paysdoc/devplatform/dist/git/repoWorkspace.js` — `ensureTargetRepoWorkspace`: fetch plus the default-branch read when cloned, then `ensureWorkspaceTrusted` writes `$HOME/.claude.json`.
- `adws/core/hashComputer.ts` — `computeFrameworkHash(frameworkRepoRoot)`.
- `adws/phases/upgradeGate.ts` — the hash gate. On a mismatch it would create a `#UPG` issue and `spawnDetached('bunx', … adwUpgrade.tsx)`.
- `adws/core/environment.ts` — `dotenv.config()`, `TARGET_REPOS_DIR`, the cwd-relative `AGENTS_STATE_DIR`/`LOGS_DIR`, `REPO_ROOT`, `assertCwdIsRepoRoot`, and the `getSafeSubprocessEnv` allowlist (no `MOCK_*`).
- `adws/core/config.ts` — `COST_REPORT_CURRENCIES` (empty → `EUR`), `GRACE_PERIOD_MS` (5 min), and the cron cadence variables (`PROBE_`, `JANITOR_`, `HUNG_DETECTOR_`, `PER_ISSUE_SCENARIO_SWEEP_`, `PROMOTION_SWEEP_` and `DOCS_INDEX_SWEEP_INTERVAL_CYCLES`).
- `adws/triggers/trigger_cron.ts` — the startup order:
  1. `provisionAdwLabels`, which runs `gh label create`;
  2. an immediate `runGuardedTick`;
  3. `checkAndTrigger`: the auth-gate tick, `scanAuthQueue` over every `agents/*/state.json`, the cadence-gated passes, `listCronOpenIssues`, `filterEligibleIssues`, the `POLL: …` log line, then the dispatch.
- `adws/triggers/webhookGatekeeper.ts` — `classifyAndSpawnWorkflow` with label routing. For a `/feature` issue it calls `spawnDetached('bunx', ['tsx', '<REPO_ROOT>/adws/adwSdlc.tsx', N, adwId, '--issue-type', '/feature', ...targetRepoArgs])`.
- `adws/triggers/cronIssueFilter.ts` — the grace period on `updatedAt`/last comment, and `adw:*` label eligibility.
- `adws/triggers/scanAuthQueue.ts` — rewrites every `paused_auth` top-level state in the checkout, whatever its repository.
- `adws/triggers/spawnGate.ts`, `adws/triggers/cronProcessGuard.ts`, `adws/core/authGate.ts` — the spawn lock (`agents/spawn_locks/acme_widgets_issue-N.json`), the cron registry (`agents/cron/acme_widgets.json`), the cron log (`logs/agents/cron/acme_widgets.log`) and `AUTH_GATE_PATH` (`agents/.auth_gate`).
- `adws/agents/prAgent.ts` — `/pull_request` output parsing: a JSON object with `title` and `body`.
- `node_modules/@paysdoc/devplatform/dist/providers/github/commands/*.js`, `githubIssueTracker.js`, `githubCodeHost.js`, `ghRepoApi.js` — every `gh` argv shape the shadow must answer (inventory in Notes).

### New Files
- `test/mocks/stubMarker.ts` — pure upward lookup for `.adw-stub-manifest.json`.
- `test/mocks/ghShadowState.ts` — the gh-shaped forge state types, their normalisation from `MockServerState`, and the field projection.
- `test/mocks/ghShadowCommands.ts` — pure: parse a `gh` argv, answer reads from the state, and turn writes into a state change plus the REST request they stand for.
- `test/mocks/gh-cli-shadow.ts` — the shadow's entry: reads env, argv and stdin, then runs the command, persists state, appends to the log, and prints and exits.
- `features/regression/support/forgeShadow.ts` — `installGhShadow`, `writeForgeState`, `replayForgeLog`.
- `features/regression/support/fixtureTargetRepo.ts` — `materialiseTargetWorkspace`, `createRemoteBranch`.
- `features/regression/support/harnessOrchestrators.ts` — the W1 name map and the launch matchers the cron Thens use.
- `features/regression/support/subprocessHarness.ts` — the per-scenario harness: setup, claims and teardown.
- `features/regression/support/subprocessRun.ts` — the hermetic env, the async runner, and the W1/W9/W10 drivers.
- `features/regression/drivers/workflowInitDriver.ts` — the init driver. It lives outside every `cucumber.js` import glob, so Cucumber never loads it.
- `features/regression/step_definitions/subprocessSteps.ts` — the new Givens and Thens of the Smoke processes section.
- `test/fixtures/jsonl/manifests/surface-patch-run.json` — row 16's manifest.
- `features/per-issue/step_definitions/feature-966.steps.ts`, plus siblings (`feature-966-standIns.steps.ts`, `feature-966-isolation.steps.ts`, `feature-966-stub.steps.ts`) as needed to stay under 300 lines.

## Implementation Plan
### Phase 1: Foundation
Make the stub findable from any worktree and build the `gh` shadow:

- the stub's marker lookup becomes upward (`stubMarker.ts`);
- the forge state model and its normalisation from the mock server's state (`ghShadowState.ts`);
- the pure command layer (`ghShadowCommands.ts`);
- the shadow's entry script (`gh-cli-shadow.ts`);
- the Cucumber-side install, state and replay (`forgeShadow.ts`);
- the target workspace (`fixtureTargetRepo.ts`).

Nothing in this phase changes a step's behaviour.

### Phase 2: Core Implementation
Build the per-scenario harness and the runner:

- `subprocessHarness.ts` (setup, claims and LIFO teardown on `World.cleanup`);
- `subprocessRun.ts` (environment, async detached spawn, timeouts, replay);
- `harnessOrchestrators.ts` (name map);
- the init driver;
- `adwPatch.tsx`'s `--issue-type`;
- the World fields and the `@regression and @subprocess` Before hook.

Then give W1, W9 and W10 real bodies, each returning `'pending'` when no harness is set up.

### Phase 3: Integration
- Change G4, G7 and G10.
- Add the new Givens and Thens.
- Commit row 16's manifest and rewrite the seven rows with the `@subprocess` tag.
- Extend `cucumberChildRun.ts`, and write feature-966's per-issue step definitions.
- Register the vocabulary and update the README tree.
- Run the whole suite against the baseline.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Record the baseline
- Before any change:
  - run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-966-regression.before 2>&1`;
  - run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-960 or @adw-961 or @adw-963" > /tmp/adw-966-flagged.before 2>&1`;
  - keep both summaries. Validation compares against them.
- Never run two Cucumber processes from the same checkout at once. The pause-queue, webhook and subprocess rows share `agents/`, `logs/` and spawn locks under the cwd.

### 2. Upward stub-marker lookup (`test/mocks/stubMarker.ts`, `test/mocks/claude-cli-stub.ts`)
- Create `stubMarker.ts`:
  - export `STUB_MANIFEST_MARKER = '.adw-stub-manifest.json'`;
  - export a pure `findStubManifestMarker(startDir: string, exists: (path: string) => boolean = existsSync): string | undefined`. It resolves `startDir`, checks `<dir>/.adw-stub-manifest.json`, and walks to `dirname(dir)` until it finds one or `dirname(dir) === dir` (the filesystem root).
- `claude-cli-stub.ts`:
  - `resolveManifestPath()` keeps `MOCK_MANIFEST_PATH` first, then returns `findStubManifestMarker(process.cwd())`;
  - edits still land in `MOCK_WORKTREE_PATH ?? process.cwd()`, so "the manifest's edit lands in that directory" (the agent's cwd);
  - update the header's "Manifest marker-file fallback" paragraph: the stub searches its cwd and every directory above it, the nearest marker wins, and every harness marker lives under `os.tmpdir()`, so a lookup that starts in the ADW checkout finds none.
- The in-process harness (`phaseRun.ts` `deliverStubManifest`) keeps writing the marker into G11's worktree; the nearest-wins rule keeps it working.

### 3. Forge state model (`test/mocks/ghShadowState.ts`)
- Export the gh-shaped types the shadow serves:
  - `GhIssue`: `number, title, body, state ('OPEN'|'CLOSED'), author {login,name,is_bot}, assignees, labels [{id,name,color,description}], milestone, comments [{id, author{login}, body, createdAt, updatedAt}], createdAt, updatedAt, closedAt, url`.
  - `GhPullRequest`: `number, title, body, state ('OPEN'|'CLOSED'|'MERGED'), headRefName, baseRefName, url, mergedAt, updatedAt, labels, reviewDecision, reviews [{author{login},state,submittedAt}], comments`.
  - `ForgeState`: `{ repository: { owner, repo, defaultBranch }, issues: Record<string, GhIssue>, pullRequests: Record<string, GhPullRequest> }`.
- Export a pure `forgeStateFrom(mock: MockServerState, repository: { owner; repo; defaultBranch })`. Mock records arrive in either REST or gh shape (G4 writes REST; `test/fixtures/github/default-issue.json` is gh-shaped). Normalise:
  - `state` `open`/`closed` → `OPEN`/`CLOSED`;
  - a PR with `merged: true` or state `MERGED` → `MERGED`, and `mergedAt` from `merged_at`;
  - `user.login` → `author.login`;
  - `created_at`/`updated_at` → `createdAt`/`updatedAt`;
  - labels given as strings or objects → `{ name, … }`;
  - head/base from `headRefName`/`baseRefName` or REST `head.ref`/`base.ref`;
  - comments from `mock.comments[N]`, REST or gh shape;
  - a missing `url` → `https://github.com/<owner>/<repo>/issues|pull/<N>`;
  - a missing date → the epoch.
- Export a pure `projectFields(record, fields)`: an object with exactly the requested `--json` fields. A field the record type does not define returns `undefined`, so the caller can treat it as unsupported.

### 4. `gh` command layer (`test/mocks/ghShadowCommands.ts`)
- Export a pure `runGhCommand(argv: readonly string[], stdin: () => string, state: ForgeState): GhOutcome`, where `GhOutcome = { stdout, stderr, exitCode, state?: ForgeState, log?: GhLogEntry }`. `GhLogEntry = { kind: 'write' | 'graphql' | 'unsupported', argv, request?: { method, path, body } }`.
- Parse flags per subcommand. The argv is what `/bin/sh` left after unquoting. A flag the subcommand does not know, or any shape not listed below, is **unsupported**:
  - stderr `gh shadow: unsupported: <argv joined by spaces>`;
  - exit 1;
  - log `{ kind: 'unsupported', argv }`.
- A read naming a repository other than `state.repository` answers as gh does for an unknown repository: exit 1, `GraphQL: Could not resolve to a Repository with the name '<o/r>'. (repository)`.
- **Reads**, answered from `state`, nothing logged:
  - `auth token` → a fixed fake token and a newline.
  - `repo view <o/r> --json defaultBranchRef [--jq .defaultBranchRef.name]` → `{"defaultBranchRef":{"name":"main"}}`, or `main`.
  - `--jq`/`-q`: support property paths (`.a.b`) only; any other expression is unsupported.
  - `issue view N --repo <o/r> --json <fields>` → the projection. An unknown issue → exit 1, `GraphQL: Could not resolve to an issue or pull request with the number of N. (repository.issue)`.
  - `issue list --repo <o/r> [--state open|closed|all] [--label L]… [--search S] [--limit N] --json <fields>`:
    - newest first;
    - `--search` understands `label:<name>` qualifiers and free words matched case-insensitively against title and body;
    - this covers the cron listing, the concurrency guard and `findOpenUpgradeIssue`.
  - `pr view N --repo <o/r> --json <fields>`; this covers `reviewDecision,reviews`.
  - `pr list --repo <o/r> [--state open|closed|merged|all] [--head B] [--limit N] --json <fields>`.
  - `api <path> [--paginate]` GET:
    - `repos/<o/r>/issues/N/comments` → a REST array (`id, body, user{login}, created_at`);
    - `repos/<o/r>/pulls/N/comments` → `[]`;
    - `repos/<o/r>/pulls/N/reviews` → a REST array from the PR's reviews;
    - `user` → `{"login":"adw-harness","type":"User"}`;
    - any other path is unsupported.
- **Writes**:
  - Each changes `state` where a later read would see it, prints what the real CLI prints, and returns a `write` log entry.
  - A body comes from stdin for `--body-file -`, `--body -` and `--input -`.
  - Every REST path starts with `/repos/<o/r>/` using the repository the call names:

| argv | state change | stdout | REST request |
|---|---|---|---|
| `issue comment N --repo o/r --body-file -` | append comment | `https://github.com/o/r/issues/N#issuecomment-<id>` | `POST /repos/o/r/issues/N/comments {body}` |
| `issue close N --repo o/r` | `CLOSED`, `closedAt` | — | `PATCH /repos/o/r/issues/N {state:"closed"}` |
| `issue create --repo o/r --title T --body-file -` | new `OPEN` issue, next free number | `https://github.com/o/r/issues/<n>` | `POST /repos/o/r/issues {title,body}` |
| `issue edit N --repo o/r --body-file -` | body | issue URL | `PATCH /repos/o/r/issues/N {body}` |
| `issue edit N --repo o/r --add-label L` / `--remove-label L` | labels | issue URL | `POST /repos/o/r/issues/N/labels {labels:[L]}` / `DELETE /repos/o/r/issues/N/labels/<L>` |
| `label create NAME --repo o/r --color C --description D [--force]` | — | — | `POST /repos/o/r/labels {name,color,description}` |
| `pr create --repo o/r --title T --head B --body-file - --base X` | new `OPEN` PR, next free number | `https://github.com/o/r/pull/<n>` | `POST /repos/o/r/pulls {title,head,base,body}` |
| `pr merge N --merge\|--squash\|--rebase --repo o/r` | `MERGED`, `mergedAt` | — | `PUT /repos/o/r/pulls/N/merge {merge_method}` |
| `pr review N --approve --repo o/r` | `reviewDecision: APPROVED`, review | — | `POST /repos/o/r/pulls/N/reviews {event:"APPROVE"}` |
| `pr comment N --repo o/r --body-file -` | append comment | comment URL | `POST /repos/o/r/issues/N/comments {body}` |
| `secret set NAME --repo o/r --body -` | — (stdin read and discarded, never logged) | — | `PUT /repos/o/r/actions/secrets/NAME {}` |
| `api -X POST\|PATCH\|PUT\|DELETE <path> [-f k=v] [-F k=v] [--input -]` | — | `{}` | that method and path; body from the fields (`-F` typed) or stdin JSON |

  - **Write failures:**
    - `pr merge` of a PR that is absent or not OPEN, and `pr create` for a head that already has an OPEN PR, exit 1 with gh's message and log nothing.
    - For `issue edit --add-label` on a label the repository lacks, answer stderr containing `not found` only if that path is ever needed. ADW's `applyLabel` then runs `label create` and retries.
- **GraphQL**: `api graphql -f query=… [-F k=v]… [--input -]` → stdout `{"data":{}}`, exit 0, log `{ kind: 'graphql', request: { method: 'POST', path: '/graphql', body: { query, variables } } }`. Every board call degrades gracefully on empty data (`moveToStatus` returns false; `createBoard` throws inside `workflowInit`'s non-blocking catch).
- Keep the file under 300 lines. If needed, split the write table into `ghShadowWrites.ts`, reusing a shared flag parser.

### 5. The shadow's entry (`test/mocks/gh-cli-shadow.ts`)
- Shebang `#!/usr/bin/env bun`. It reads `ADW_GH_STATE` and `ADW_GH_LOG`. If either is unset, it writes `gh shadow: ADW_GH_STATE and ADW_GH_LOG must be set` to stderr and exits 1.
- Reads the state JSON, calls `runGhCommand(process.argv.slice(2), () => readFileSync(0, 'utf-8'), state)`. Stdin is read only when a handler asks for it, because `execSync` gives a no-input call an empty pipe.
- When the outcome carries a new state, write it to `<state>.tmp` and rename it. When it carries a log entry, append one NDJSON line with a single `appendFileSync`.
- Writes stdout and stderr, then exits with the outcome's code.
- It never reads `GH_TOKEN`, `GH_HOST` or the network.
- Nothing imports it, and it lives in `test/mocks/`, outside every `cucumber.js` import glob.

### 6. Install, state and replay (`features/regression/support/forgeShadow.ts`)
- `installGhShadow(rootDir: string): string`:
  - makes `<root>/gh-bin/`;
  - writes the wrapper `gh` (`#!/bin/sh`, then `exec bun "<abs test/mocks/gh-cli-shadow.ts>" "$@"`, mode `0o755`), as `createGitMockDir` does;
  - returns the directory. It never touches `process.env.PATH`.
- `writeForgeState(statePath: string, mock: MockServerState, repository: RepoIdentifier): void` writes `forgeStateFrom(mock, { ...repository, defaultBranch: 'main' })`.
- `replayForgeLog(logPath: string): { replayed: number; unsupported: string[] }`:
  - reads the log;
  - ignores an unterminated final line, because a killed process group can cut one mid-write;
  - for each `write` and `graphql` entry, calls `dispatchMockRequest(method, path, JSON.stringify(body))`. That is the mock's REST surface, recorded synchronously in-process exactly as the HTTP listener records it;
  - collects `unsupported` argv strings;
  - truncates the log afterwards.
- It has no hooks and no import-time side effects. Every file under `features/regression/support/` is loaded by Cucumber.

### 7. Target workspace (`features/regression/support/fixtureTargetRepo.ts`)
- Export `TARGET_CLONE_URL(owner, repo) = https://github.com/<owner>/<repo>.git`.
- `materialiseTargetWorkspace(owner, repo, targetReposDir): string`:
  1. `cpSync(test/fixtures/cli-tool, <targetReposDir>/<owner>/<repo>)`;
  2. write `.adw-version` = `computeFrameworkHash(REPO_ROOT)`;
  3. `initialiseRepository(workspace)`: the `.gitignore` for `STUB_FILES`, `git init -b main`, the harness identity and one commit that includes `.adw-version`;
  4. `realGit(workspace, 'remote', 'add', 'origin', TARGET_CLONE_URL)`;
  5. `realGit(workspace, 'update-ref', 'refs/remotes/origin/main', 'HEAD')`;
  6. `realGit(workspace, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')`;
  7. return the path.

  `realGit` uses `REAL_GIT_PATH`, since the git mock no-ops `fetch`/`clone`. The origin is never contacted: children always run behind the git mock.
- `createRemoteBranch(workspace, branch, relPath, contents)`:
  - checks out a new branch from `main` and commits the file;
  - runs `update-ref refs/remotes/origin/<branch> <branch>`;
  - checks out `main` again, so `ensureWorktree` can add a worktree for the branch.

### 8. Orchestrator name map (`features/regression/support/harnessOrchestrators.ts`)
- `HARNESS_ORCHESTRATORS: Readonly<Record<string, { script: string; issueType?: IssueClassSlashCommand }>>`:

  | name | script | `--issue-type` |
  |---|---|---|
  | `sdlc` | `adws/adwSdlc.tsx` | `/feature` |
  | `chore` | `adws/adwChore.tsx` | `/chore` |
  | `plan` | `adws/adwPlan.tsx` | `/feature` |
  | `build` | `adws/adwBuild.tsx` | `/feature` |
  | `test` | `adws/adwTest.tsx` | `/feature` |
  | `patch` | `adws/adwPatch.tsx` | `/feature` |
  | `merge` | `adws/adwMerge.tsx` | `/feature` |
  | `document` | `adws/adwDocument.tsx` | `/feature` |
  | `pr-review` | `adws/adwPrReview.tsx` | `/pr_review` |
  | `promotion-sweep` | `adws/triggers/promotionSweep.ts` | none; it takes only `--target-repo`/`--clone-url` |

  There is no `review` and no `init`.
- `harnessOrchestrator(name)` uses `assert.ok`, and its message names every known orchestrator: `Unknown orchestrator "<name>". The subprocess harness runs: sdlc, chore, plan, build, test, patch, merge, document, pr-review, promotion-sweep`.
- **Script paths are always absolute and real:** `realpathSync(resolve(REPO_ROOT, script))`, and the same for the init driver and `trigger_cron.ts`. `adwMerge.tsx`, `adwChore.tsx` and `adwUpgrade.tsx` run `main()` only when `import.meta.url === \`file://${process.argv[1]}\``. A relative or symlinked path makes `main()` silently not run, and the process exits 0 having done nothing.
- `orchestratorArgv(name, adwId, issue, repo)` returns:
  - for orchestrators: `[script, String(issue), adwId, '--issue-type', type, '--target-repo', 'acme/widgets', '--clone-url', TARGET_CLONE_URL]`. Orchestrators that ignore `--issue-type` (`adwMerge`) leave it trailing harmlessly; `parseOrchestratorArguments` reads only the leading positionals;
  - for `promotion-sweep`: `[script, '--target-repo', …, '--clone-url', …]`.
- Launch matchers for the cron Thens:
  - `isOrchestratorLaunch(argv)`: some argument, after normalising `\` to `/`, ends with `adws/adw<Name>.tsx` or `adws/triggers/promotionSweep.ts`;
  - `isLaunchOf(argv, name, issue)`: the argument after the named script's path equals `String(issue)`.

  Recorded argv is `['tsx', '<REPO_ROOT>/adws/adwSdlc.tsx', '1030', '<adwId>', '--issue-type', '/feature', '--target-repo', 'acme/widgets', …]`, because `spawnDetached` makes the script path absolute.

### 9. World, per-scenario harness and hook
- `world.ts` adds:
  - `subprocess: SubprocessHarness | null = null`;
  - `lastOutput = ''`: combined stdout and stderr of the last harness process;
  - `seededIssues: Set<number>`: G4's issues;
  - `matchedLaunch: readonly string[] | null`: "that launch".

  The `@regression` After resets each.
- `subprocessHarness.ts`: `createSubprocessHarness(world)` makes:
  - `root = mkdtempSync(join(tmpdir(), 'adw-subprocess-'))`, with `repos/` (the child's `TARGET_REPOS_DIR`), `home/` (the child's `HOME`) and `forge/` (`state.json`, `log.ndjson`);
  - `ghBinDir = installGhShadow(root)`;
  - `recorder = createLaunchRecorder()`;
  - `workspacePath: string | null` (lazy);
  - `processGroups: Set<number>`;
  - `claimedAdwIds`;
  - `claimedIssues`.
- At setup it saves and removes `agents/.auth_gate`, as the `@webhook` hooks do. A cron child would otherwise skip the poll and SIGTERM live orchestrators. It also snapshots `agents/cron/acme_widgets.json` and `logs/agents/cron/acme_widgets.log`, so cleanup can restore them byte for byte or remove them if they were absent. All paths are resolved against `REPO_ROOT`.
- It registers on `world.cleanup` the teardown below. `runCleanup` runs the list last in, first out, so the per-run entries pushed later run first:
  - restore the auth gate and the two cron files;
  - release `acme/widgets` spawn locks for every claimed issue;
  - dispose the recorder;
  - `rmSync(root)`.
- `claimAdwId(world, adwId)`:
  - asserts the adwId was made up for a scenario: `/^(surface|throwaway\d+)-[a-z0-9-]+$/`, since its directories are removed;
  - on the first claim in a scenario, removes `agents/<adwId>/` and `logs/<adwId>/`, so a crashed earlier run cannot decide the outcome, and registers their removal;
  - later claims do nothing, so a Given's seeded state survives W1/W9.
- `claimIssue(world, n)` records `n` for lock release.
- `ensureTargetWorkspace(world)` materialises `acme/widgets` once and returns its path.
- `hooks.ts`:
  - right after the existing `@regression` Before, add `Before({ tags: '@regression and @subprocess' }, function () { this.subprocess = createSubprocessHarness(this); })`. The same file guarantees the order;
  - the After sets `subprocess` back to `null` after `runCleanup`.
  - A scenario without `@subprocess`, or outside the `@regression` hooks, has no harness, so W1, W9 and W10 stay pending there.

### 10. The runner (`features/regression/support/subprocessRun.ts`)
- **The real `bunx`.** Resolve its absolute path once, from the Cucumber process's `PATH`, with `which bunx`, as `findRealGit` does. The child is spawned through that absolute path, so a `bunx` shadow on the child's `PATH` never intercepts the harness's own launch. This also mirrors production's `bunx tsx`, which works in the Docker leg.
- **`harnessEnv(world, harness)`.** Start from `{ ...process.env, ...world.harnessEnv }`, then force:
  - `GITHUB_PAT: 'ghp_adwHarnessFakeTokenNeverSentAnywhere'`;
  - `GH_TOKEN`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_PATH`, `COST_API_URL`, `COST_API_TOKEN`, `SLACK_WEBHOOK_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `CLOUDFLARE_ACCOUNT_ID` all `''`. Present, never deleted, so `dotenv` never fills them;
  - `COST_REPORT_CURRENCIES: ','`, which names no currency once split, so no exchange-rate fetch. An empty string would fall back to `EUR`;
  - `CLAUDE_CODE_PATH: CLAUDE_CLI_STUB`;
  - `TARGET_REPOS_DIR` and `HOME` set to the harness's temp directories;
  - `ADW_TARGET_GUARDRAILS: 'off'`;
  - `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` from `HARNESS_GIT_IDENTITY`;
  - `ADW_GH_STATE` and `ADW_GH_LOG`;
  - `PATH: [ghBinDir, recorder.binDir, process.env.PATH].join(':')`. Under the `@regression` hooks `process.env.PATH` already starts with the git-mock directory, and `REAL_GIT_PATH` is set.
- **The launch recorder on every run.** Every `bunx` call under `adws/` but one is a detached launch (`spawnDetached`/`spawn`): a cron, an upgrade orchestrator, a resumed workflow. Recording instead of running keeps any escaped launch out of a process group the harness could not kill.
  - The exception is the guardrails probe (`adws/core/guardrailsProbe.ts`), a synchronous `spawnSync('bunx', ['tsx', 'scripts/guardrails-probe.ts'])`. The cron warms it up at startup.
  - Under the recorder it exits 0 at once, so the verdict is `ok`. The verdict is moot, because `ADW_TARGET_GUARDRAILS=off` beats it in `resolveGuardrailsDecision`. The probe no longer costs up to 90 s, and it shows up as a launch record, which is why T-SP3 counts only orchestrator launches.
- **`runHarnessProcess(world, spec)`.** `spec = { command, args, timeoutMs, label, stopWhen?, cwd? }`. It returns `{ exitCode: number | null, signal, output, stopped }`:
  - `spawn(command, args, { cwd: spec.cwd ?? REPO_ROOT, env, detached: true, stdio: ['ignore','pipe','pipe'] })`. Never `spawnSync`. The cwd is the checkout, because `assertCwdIsRepoRoot` and the cwd-relative `agents/`/`logs/` require it;
  - add `child.pid` to `harness.processGroups` and push `() => killGroup(pid)` onto `world.cleanup`;
  - collect stdout and stderr into one string;
  - on `stopWhen(output)`, kill the group (`process.kill(-pid, 'SIGKILL')`, `ESRCH` ignored) and mark `stopped`;
  - on timeout, kill the group, wait for `close`, and `assert.fail("<label> did not exit within <s> s; the harness killed its process group. Last output:\n<last 40 lines>")`;
  - resolve on `close`, so the output is complete.
- **`runThroughHarness(world, spec, { recordsExitCode })`.** Exported for W1, W9 and the per-issue stand-in steps:
  1. `writeForgeState(...getMockServerState())`;
  2. truncate the log;
  3. `runHarnessProcess`;
  4. set `world.lastOutput`;
  5. if `recordsExitCode`, set `world.lastExitCode = exitCode ?? -1`;
  6. `replayForgeLog`;
  7. when `unsupported` is non-empty, `assert.fail` with one `gh shadow: unsupported: <argv>` line per call. A run whose process swallowed the failed `gh` call and exited 0 still fails here.
- **`deliverStubMarker(world)`.** When G3 set `MOCK_MANIFEST_PATH`, copy that manifest to `<harness root>/repos/.adw-stub-manifest.json`. That is the temp `TARGET_REPOS_DIR` root, above the workspace and every worktree a run creates, and under `os.tmpdir()`.
- **`runOrchestrator(world, name, adwId, issue)`** (W1):
  1. `harnessOrchestrator(name)`, which fails first, naming the known ones;
  2. `claimAdwId`, `claimIssue`, `ensureTargetWorkspace`, `deliverStubMarker`;
  3. `runThroughHarness` with `command = REAL_BUNX`, `args = ['tsx', ...orchestratorArgv(...)]`, `timeoutMs = 120_000`, `recordsExitCode: true`.
- **`runWorkflowInit(world, configLabel)`** (W9):
  1. parse the label as `<orchestrator script stem>-<adwId>` (`/^(adw[A-Z]\w*)-(.+)$/`). Map the stem to an `OrchestratorId` and issue type. At least `adwPlan` → `OrchestratorId.Plan`, `/feature`. An unknown stem fails, listing the known ones;
  2. the issue is the single issue in `world.seededIssues`. Fail when there is not exactly one;
  3. claim, ensure the workspace, deliver the marker;
  4. run `REAL_BUNX tsx features/regression/drivers/workflowInitDriver.ts <orchestratorId> <issue> <adwId> --issue-type <type> --target-repo acme/widgets --clone-url <url>` with `timeoutMs = 30_000` and `recordsExitCode: true`.
- **`runCronProbe(world)`** (W10):
  1. Refuse to start, failing with their adwIds, when any `agents/*/state.json` in the checkout records `paused_auth`. `scanAuthQueue` would rewrite them whatever their repository.
  2. Write the forge state, truncate the log, and claim every seeded issue for lock release.
  3. Run `REAL_BUNX tsx adws/triggers/trigger_cron.ts --target-repo acme/widgets --clone-url <url>`. The env also pins `PROBE_INTERVAL_CYCLES`, `JANITOR_INTERVAL_CYCLES`, `HUNG_DETECTOR_INTERVAL_CYCLES`, `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`, `PROMOTION_SWEEP_INTERVAL_CYCLES` and `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` to `'1000000'`. Otherwise a host `.env` that lowers them would let the probe's one tick run the hung detector, janitor or a sweep against the checkout's shared state.
  4. Use `stopWhen: output => output.includes('POLL:')` and `timeoutMs = 60_000`. A cron that never polls fails with its output tail.
  5. After `POLL:`, `await settleLaunches(recorder)` (the quiet-window settle), then kill the group, wait for `close` and replay.
  6. Set `world.lastOutput`. **Never** set `lastExitCode`: the harness killed the cron, so "exited 0" after W10 must fail.
- Keep each module under 300 lines. If needed, split the three drivers into `subprocessDrivers.ts`.

### 11. The init driver (`features/regression/drivers/workflowInitDriver.ts`)
- The driver mirrors `adwPlan.tsx`'s startup up to and including `initializeWorkflow`, and stops there:
  - `const [orchestratorId, ...rest] = process.argv.slice(2)`;
  - `parseTargetRepoArgs(rest)`, then `parseOrchestratorArguments(rest, { scriptName: 'workflowInitDriver.ts', usagePattern: '<orchestratorId> <issueNumber> <adw-id> --issue-type <type> --target-repo <o/r> --clone-url <url>', supportsCwd: false })`;
  - `buildRepoIdentifier(targetRepo)`;
  - `await initializeWorkflow(issueNumber, adwId, orchestratorId, { issueType, targetRepo, repoId })`;
  - `process.exit(0)`.
- On an error: `console.error(error instanceof Error ? error.message : String(error))` and `process.exit(1)`. Row 19 asserts that message, `Repo identity mismatch: launch=acme/widgets persisted=acme/gadgets. …`.
- Validate `orchestratorId` against `Object.values(OrchestratorId)`.
- Keep the driver out of `features/regression/support/` and `step_definitions/`, which `cucumber.js` imports. A driver there would run at import inside the Cucumber process. Say so in a one-line comment.

### 12. `adwPatch.tsx` honours `--issue-type`
- In `main()`:
  - set `supportsIssueType: true`;
  - destructure `providedIssueType`;
  - pass `issueType: providedIssueType ?? undefined` to `initializeWorkflow`;
  - update the usage strings (header comment and `usagePattern`) to `<issueNumber> [adw-id] [--issue-type <type>] [--cwd <path>]`.
- This mirrors `adwBuild.tsx`/`adwPlan.tsx`. No caller passes the flag today, so nothing else changes.
- Leave `adwTest.tsx` alone; no row drives it. See Notes.

### 13. W1, W9 and W10 (`features/regression/step_definitions/whenSteps.ts`)
- W1: `When('the {string} orchestrator is invoked with adwId {string} and issue {int}', { timeout: 150_000 }, async function (this: RegressionWorld, name, adwId, issue) { if (!this.subprocess) return 'pending'; await runOrchestrator(this, name, adwId, issue); })`.
- W9: same shape, `{ timeout: 60_000 }`, calling `runWorkflowInit`.
- W10: same shape, `{ timeout: 90_000 }`, calling `runCronProbe`.
- Each pending return gets a one-line comment: it keeps a scenario with no subprocess harness from passing by doing nothing.
- Delete `spawnOrchestrator`, `ORCHESTRATOR_FILES` and the three commented-out bodies; drop the `spawnSync` import. Keep `buildSubprocessEnv` and `buildMockedWorkflowConfig`, which the other pending steps' comments still name. The file must stay under 300 lines.

### 14. Givens and Thens
- `givenSteps.ts`:
  - **G4** seeds the issue with `created_at` and `updated_at` one hour before now, and `labels: [{ name: 'adw:feature' }]`. That is old enough for the cron's grace period, and a label `filterEligibleIssues` admits and `classifyAndSpawnWorkflow` routes to `adwSdlc.tsx`. G4 records the number in `this.seededIssues`.
  - It still replaces the issue map, so `buildPhaseConfig`'s exactly-one rule holds. `toPortIssue` already reads label objects and `created_at`, so rows 02–05 see a labelled, dated issue and nothing else.
  - **G7** replaces the issue map with only the issues in `this.seededIssues`, taken from `getMockServerState().issues`. The mock server's default fixture issues (1 and 42) go; G4's stay.
  - **G10** merges into the existing record: `{ ...current.prs[N], number: N, state: 'closed', merged: true, merged_at }`, so a head branch an earlier Given recorded survives.
- New `features/regression/step_definitions/subprocessSteps.ts`:
  - **G-SP1** `a workflow for adwId {string} is awaiting merge of PR {int} from branch {string}`:
    1. `claimAdwId` and `ensureTargetWorkspace`;
    2. `createRemoteBranch(workspace, branch, 'src/<branch>.ts', …)`;
    3. seed the mock PR `{ number, title: 'Surface PR <N>', body: 'Implements #<issue>', state: 'OPEN', headRefName: branch, baseRefName: 'main', url }` into the existing `prs` map;
    4. write `agents/<adwId>/state.json` through `AgentStateManager.writeTopLevelState` as `{ adwId, workflowStage: 'awaiting_merge', branchName: branch, orchestratorScript: 'adws/adwSdlc.tsx', repoIdentity: { owner: 'acme', repo: 'widgets' } }`, with `issueNumber` when the scenario seeded exactly one issue.
  - **G-SP2** `a prior run for adwId {string} recorded workflowStage {string} for the repository {string}`: `claimAdwId`, then write `{ adwId, workflowStage, repoIdentity: { owner, repo } }`, plus `issueNumber` as above.
  - **T-SP1** `the mock GitHub API recorded a merge of PR {int}`: a recorded `PUT` whose path ends in `/pulls/<N>/merge`. The message lists the recorded requests.
  - **T-SP2** `the orchestrator subprocess's output contains {string}`: `World.lastOutput` contains the text. On failure, show the output's last 40 lines.
  - **T-SP3** `the cron launched no orchestrator`: the recorder holds no `isOrchestratorLaunch` record. Show `describeLaunches` on failure.
  - **T-SP4** `the {string} orchestrator was launched for issue {int}`: `harnessOrchestrator(name)` must exist, and exactly one record satisfies `isLaunchOf`. Store it in `this.matchedLaunch`.
  - **T-SP5** `that launch named the target repository {string}`: `this.matchedLaunch` is set, and the argument after `--target-repo` equals the repository.
  - No step reads a source file. Each reads the recorded requests, the process output, the launch records, or the state file (T1).

### 15. Row 16's manifest (`test/fixtures/jsonl/manifests/surface-patch-run.json`)
- Follow `surface-build-phase.json`:
  - every payload is an edit to `.adw-stub-payload.json` (ignored by the workspace's `.gitignore`) with `jsonlPath: ".adw-stub-payload.json"`;
  - `onCommitCommand: "stage-all-and-commit"`;
  - the top level answers `Surface patch-run stub: the prompt opened with no command this manifest answers.`;
  - `byCommand` entries:
    - `/patch`: a short patch plan for issue 1016;
    - `/implement`: writes `src/surfacePatch.ts`;
    - `/pull_request`: answers exactly `{"title":"fix: surface patch run for issue #1016","body":"Implements #1016\n\nThe surface patch run's pull request."}`, under the stub's 500-character result cap.
- Nothing is written under `.adw/`, `.claude/` or `agents/`, and no path leaves the worktree, so the refusal guard and feature-963's sweep of committed manifests both pass.
- The install agent's answer gives no file context, which is fine: `installContext` feeds only the plan, scenario, step-def and pr-review agents. No row asserts the branch name, so the branch-name cascade may use the stub's answer or its deterministic `feature-issue-1016` fallback.

### 16. The seven rows
Each row's feature line carries `@regression @surface @subprocess`.

| Row | Steps |
|---|---|
| 01 | G4 1001 → W9 `adwPlan-surface-01` → T5 0, T1 `starting`, T2 1001, T3 `## :rocket: ADW Workflow Started`. Title says it records the starting stage. |
| 10 | G4 1010 → G-SP1 `surface-10`/1010/`surface-10` → G10 1010 → W1 `merge` → T5 0, T1 `completed`, T2 1010, T3 `PR #1010 has been merged.`, T7. |
| 11 | G4 1011 → G-SP1 → W1 `merge` → T5 0, T1 `completed`, T-SP1 1011, T2 1011, T3 `PR #1011 has been merged successfully.` On this path `adwMerge` only reads the `hitl` label and applies none, so the stage, the merge and the comment are everything it writes. |
| 16 | G4 1016 → G3 `surface-patch-run.json` → W1 `patch` → T5 0, T1 `completed`, T8 1016. The scenario title says the run plans in adwPatch's own patch phase, which only a full run reaches. Like the other surface rows, the feature has no description line. |
| 19 | G4 1019 → G-SP2 `surface-19`/`build_completed`/`acme/gadgets` → W9 `adwPlan-surface-19` → T5 1, T-SP2 `Repo identity mismatch: launch=acme/widgets persisted=acme/gadgets`, T1 `build_completed`, T14 1019. The feature title names adwPlan's init, since no adwInit orchestrator exists. |
| 29 | G7 → W10 → T-SP3. |
| 30 | G4 1030 → G7 → W10 → T-SP4 `sdlc`/1030 → T-SP5 `acme/widgets`. |

The scenario writer's edits in the working tree already have this shape. Keep them, and make each phrase resolve to exactly one definition.

### 17. Child Cucumber runs (`features/support/cucumberChildRun.ts`)
- Raise `CHILD_TIMEOUT_MS` from 120 s to 600 s, with a one-line reason. The `@surface` and `@smoke or @surface` child runs (feature-960 §6, feature-963, feature-966) now include seven rows that run real processes; each orchestrator run is bounded at 120 s.
- `writeThrowawayFeature(directory, insideRegressionHooks, steps, extraTags: readonly string[] = [])`: the feature line gains the extra tags, so a throwaway `@subprocess` regression scenario is possible. Existing callers are unchanged.
- `CucumberRunOptions` gains an optional `env` overlay, applied after `childEnvironment()`'s blanking (for the throwaway `HOME` and the recording `gh`).

### 18. Per-issue step definitions (`features/per-issue/step_definitions/feature-966*.ts`)
- Hooks are keyed on `@adw-p5u9xh-bug-build-the-hermet`, never `@adw-966`. The flagged rows of features 909, 960, 961 and 963 carry `@adw-966` and must not run them.
  - Before: reset the module state, record the checkout's `git branch --list` and `git worktree list --porcelain` output, and save `agents/.auth_gate`.
  - After: remove every temp directory the scenario made, restore every `process.env` name a step set, and restore `PATH`.
  - After also restores `agents/.auth_gate` as the Before found it. 961's Given writes a record there, and the `@webhook or @adw-961` hooks that restore it do not run for this feature.
  - Neither the `@regression` hooks nor the 960 and 963 hooks run for this feature, yet it reuses their phrases. So the After runs `runCleanup(this)` for the removals the 963 helpers push onto `World.cleanup`. Add `or @adw-p5u9xh-bug-build-the-hermet` to 960's hook tag, since only its own After can remove its scratch directory and reset its module state.
- Reuse, never redefine:
  - the 963 phrases: the surface runs twice, no spawn lock, no git repository left, throwaway regression scenario run, fails at the step, passes, the throwaway stub worktree, `the stub exits 0 with the result {string}`, and `the ADW TypeScript type-check passes`;
  - the 960 phrases: a throwaway feature inside/outside the hooks, run through Cucumber, reported pending, and `every smoke and surface scenario is reported pending, except these surface rows, which pass:`;
  - the 961 phrases: the auth gate holds a record, `Cucumber runs the scenarios tagged {string} in a child process`, that run held at least one scenario and every one passed, and the auth gate, cron registry and cron logs unchanged.
- New phrases, each through `cucumberChildRun.ts` or a direct check of a runtime artefact:
  - **Surface runs:**
    - `each of these surface rows passes on both runs:`: one scenario per row and run, each passed;
    - `the checkout holds no state and no logs for any of these adwIds:`: no `agents/<id>` and no `logs/<id>` under `REPO_ROOT`;
    - `no cron trigger for the repository {string} is still running`: no `agents/cron/<o>_<r>.json`, or it names a dead pid; and no live process's command line names `trigger_cron.ts --target-repo <o/r>`;
    - `neither run added a branch or a worktree to the checkout for any of these workflows:`: compare the checkout's `git branch --list` and `git worktree list --porcelain` output as the Before hook recorded it with its output now. Fail on any added name that contains the adwId or `issue-<N>`. The When step is 963's, reused unchanged, so it cannot take the snapshot.
  - **Isolation:**
    - `the developer's HOME is a throwaway directory holding a ".claude.json" file`: a temp HOME with a known `.claude.json`, passed through the run's `env` overlay;
    - `the developer's gh, first on the PATH, records every call it receives`: a temp `gh` that appends its argv to a log, prepended to the child Cucumber's `PATH` through the overlay;
    - `the developer's gh received no call`: that log is empty;
    - `the developer's ".claude.json" file is as it was before that run`: byte-equal;
    - `the developer's HOME holds no ".adw" directory`;
    - `When Cucumber runs the scenarios tagged {string} in a child process` must pass the overlay. Extend 961's step to read an overlay from module state if one is set.
    - That step bounds its child at 285 s (`SPAWN_TIMEOUT_MS`, 15 s under its 5-minute `STEP_TIMEOUT_MS`). The isolation scenario's child run holds the seven subprocess rows, so raise `STEP_TIMEOUT_MS` to 10 minutes, for the same reason step 17 raises `CHILD_TIMEOUT_MS`.
  - **Stand-ins**, inside a throwaway `@regression @subprocess` scenario:
    - `a throwaway @subprocess regression scenario with the steps:` → `writeThrowawayFeature(dir, true, steps, ['@subprocess'])`;
    - `the process running the scenario has {string} set to {string}`: set `process.env` in the child Cucumber, restored through `World.cleanup`, which the child's `@regression` After runs. The throwaway scenario carries no per-issue tag, so no feature-966 hook runs in the child;
    - `a stand-in process that records its environment is run through the subprocess harness`: `runThroughHarness` with `/bin/sh -c 'env > <file>'`;
    - `the stand-in process saw {string} set to an empty string`: the recorded env has the name with value `''`, which is not the same as absent;
    - `the stand-in process saw {string} set to the Claude CLI stub`: the recorded value equals `CLAUDE_CLI_STUB` (`features/regression/support/claudeCliStub.ts`);
    - `the stand-in process saw {string} set to a token other than {string}`: the recorded value is not empty and differs from the named token. It has the shape of a classic personal access token, `ghp_` and 36 letters or digits, as the issue's "fake but syntactically complete `GITHUB_PAT`" requires;
    - `the stand-in process saw a COST_REPORT_CURRENCIES that gives ADW no currency to convert costs into`: apply ADW's own rule from `adws/core/config.ts`, `(value || 'EUR').split(',').map(trim).filter(Boolean)`, and expect an empty list. An empty or absent value fails, because ADW falls back to `EUR`;
    - `a stand-in process that runs the command {string} and then exits 0 is run through the subprocess harness`: `/bin/sh -c '<cmd>; exit 0'` through `runThroughHarness`, timeout 30 s;
    - `a stand-in process that runs the command {string} is run through the subprocess harness with a timeout of {int} seconds`: `/bin/sh -c '<cmd>'` through `runThroughHarness` with that timeout. The phrase has no "and then exits 0", as the timeout scenario writes it;
    - `the error message of that failed step contains {string}`;
    - `the error message of that failed step names each of these orchestrators:`;
    - `no process running the command {string} is left`: no `ps -eo pid=,command=` line contains it.
  - **Stub lookup:**
    - `the directory {string} below that worktree holds a stub manifest whose top-level entry answers {string} and writes {string}`;
    - `the Claude CLI stub is run in the directory {string} below that worktree, as an agent runs it, with a prompt that opens with {string}`: the 963 vector, cwd set to that directory, which is made if absent;
    - `the stub wrote {string} into the directory {string} below that worktree, and no other file in that worktree`;
    - `a throwaway directory under the system's temporary directory, with no stub manifest in it or in any directory above it`: assert no marker exists from it up to `/`;
    - `the Claude CLI stub is run in that directory, as an agent runs it, with a prompt that opens with {string}`;
    - `the stub exits 0 with the answer it gives when no manifest programs it`: exit 0, and the result equals the text of the payload the stub picks for a `/feature` prompt when no manifest programs it. That is `test/fixtures/jsonl/payloads/plan-agent.json`'s text blocks, joined and cut at 500 characters, or `Task completed.` when they hold no text, as `claude-cli-stub.ts` builds it. 963 defines only `the stub exits 0 with the result {string}`, `the stub exits 1` and `the stub exits 1 with an error that names {string}`;
    - `the stub wrote no file into that directory`.
  - **Cucumber expressions:** `/` is alternation. A phrase with a literal `/` outside a `{string}` parameter must escape it as `\\/` or be a regular expression, as `whenSteps.ts` does for `git\\/gh`.
- feature-960's §6 step already exists (963). Its table now lists the seven rows; the scenario writer updated it.

### 19. Vocabulary registry (`features/regression/vocabulary.md`)
- Update the semantics:
  - **W1:** runs the named orchestrator (name map; unknown names fail listing them) as a child process through the hermetic subprocess harness, against `acme/widgets`'s temp workspace, with `--issue-type`, `--target-repo` and `--clone-url`. Records the exit code and output, then replays its GitHub writes. Pending without the harness. Pattern subprocess; target: exit code, state file, recorded requests.
  - **W9:** runs the init driver (`initializeWorkflow` for the orchestrator the label names, for the one seeded issue) the same way. Pending without the harness.
  - **W10:** runs `trigger_cron.ts --target-repo acme/widgets` until its first `POLL:` line, settles the launch recorder, kills it, and replays. Records no exit code. Pending without the harness. Target: launch records and recorded requests.
  - **T5:** "(W1, W9)".
  - **T7:** a recorded `PUT /repos/.../pulls/:n/merge`. This fixes the description to match the code.
  - **G4:** an open issue created and last updated an hour ago, labelled `adw:feature`.
  - **G7:** keeps only the issues the scenario seeded.
  - **G10:** marks PR N merged in place, keeping its other fields.
  - **"Three Permitted Execution Patterns":** the subprocess bullet now says async detached spawn through the hermetic harness, not `spawnSync`.
- Add `## Given/When/Then — Smoke processes (@subprocess)`. The heading must start with `Given/When/Then` for `vocabularyParser.ts`, and the table keeps five columns.
  - Its intro says:
    - what the `@regression and @subprocess` hook sets up: the temp root, workspace, `HOME`, the `gh` shadow, the launch recorder, the auth-gate save, and cleanup;
    - the forced environment and `PATH` order;
    - the `gh` shadow's reads, writes, GraphQL and unsupported calls, and that the replay happens after exit;
    - the upward marker lookup and where a row's manifest is put;
    - the timeouts;
    - the rule that every assertion reads a runtime artefact.
  - Its rows: G-SP1, G-SP2, T-SP1 to T-SP5.
  - Note the reused phrases: G3, G4, G7, G10, W1, W9, W10, T1, T2, T3, T5, T7, T8 and T14.

### 20. README
- In the project-structure tree:
  - list `stubMarker.ts`, `ghShadowState.ts`, `ghShadowCommands.ts` and `gh-cli-shadow.ts` under `test/mocks/`;
  - extend the `features/regression/support/` comment with the subprocess harness (`subprocessHarness`, `subprocessRun`, `forgeShadow`, `fixtureTargetRepo`, `harnessOrchestrators`);
  - add `features/regression/drivers/` (the init driver, outside the import globs).
- In "Running BDD scenarios on the host", add one line: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface and @subprocess"` runs the subprocess rows.
- Do not touch the README's unrelated working-tree changes.

### 21. Validation
- Run every command in `Validation Commands`. Fix and re-run until all pass.

## Testing Strategy
### Edge Cases
- A scenario that uses W1, W9 or W10 without `@subprocess`, inside or outside the `@regression` hooks, is reported pending. This covers feature-960 §1 and §5, every smoke scenario, and the parked surface rows. The `review` and `init` rows stay pending, not failed.
- W1 with `review` or `init` under the harness fails, naming the ten orchestrators.
- An unsupported `gh` call (`codespace list`, `issue transfer …`) fails the step with `gh shadow: unsupported: <argv>`, even though the process exits 0.
- A `gh` read for another repository answers "Could not resolve to a Repository" and exits 1. A write is replayed with the repository it names, so assertions keyed on `acme/widgets` do not match it.
- A comment or merge made through the shadow is visible to T2, T3, T7 and T-SP1 only after replay, which happens after the child exits. A read after a write in the same run sees the write: an OPEN PR becomes MERGED, and a new PR is found by `pr list --head`.
- A child that outlives its timeout fails the step with its output tail. Its whole process group, including backgrounded grandchildren, is killed.
- W10 against a cron that never prints `POLL:` within 60 s fails with the output tail. After W10, T5 "exited 0" fails, because no exit code was recorded.
- A host variable such as `GH_TOKEN`, a GitHub App variable, a Cost API, Slack or R2 variable, or `CLOUDFLARE_ACCOUNT_ID` set in the Cucumber process or the checkout's `.env` reaches the child as `''`. `COST_REPORT_CURRENCIES=EUR,GBP` reaches it as `,`.
- `agents/.auth_gate` holding a record: the rows still pass, and the gate is restored afterwards. A checkout with a `paused_auth` workflow makes W10 refuse to start rather than rewrite it.
- The stub run in a directory below a worktree uses the nearest marker at or above it, and writes into that directory. Run where no marker exists up to `/`, it exits 0 with the answer it gives when no manifest programs it, having written nothing.
- Two runs in a row in the same checkout pass. Neither leaves:
  - `agents/<adwId>/` or `logs/<adwId>/`;
  - an `acme/widgets` spawn lock;
  - a cron registry entry, a cron log or a live cron;
  - a branch or worktree in the checkout;
  - a git repository in the run's `TMPDIR`.
- Row 19 fails closed before posting anything, and the prior state's stage stays `build_completed`.
- Row 11's PR is OPEN with no `hitl` label and no approval. The merge happens through `gh pr merge` and is recorded as `PUT …/pulls/1011/merge`.
- The in-process rows 02–05, 31 and 32 still pass with G4's labelled, dated issue.

## Acceptance Criteria
- Rows 01, 10, 11, 16, 19, 29 and 30 run real processes through the harness and pass, twice in a row in the same checkout, each assertion reading only a runtime artefact.
- No child process:
  - reaches the network;
  - reaches the real `gh`: the shadow leads the child's `PATH`, and a recording `gh` placed first on the Cucumber process's `PATH` receives no call;
  - reads or writes the developer's `$HOME`;
  - leaves anything in the checkout's `agents/` or `logs/` beyond the paths the cleanup removes.

  The auth gate, the cron registry and the cron logs are as they were before the run.
- An unsupported `gh` call fails the scenario with `gh shadow: unsupported: <argv>`.
- Every scenario passing on `dev` still passes. Feature-960's §1, §5 and §6, feature-961's own-process run, feature-963's in-process rows and feature-909's flagged stub rows pass. The rest of the smoke and surface tier stays pending.
- `features/regression/vocabulary.md` has the Smoke processes section, and W1, W9 and W10 describe what they now do.
- The stub's upward marker lookup is covered by feature-966's scenarios.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

Run each command from the repository root. Never run two Cucumber processes from this checkout at once.

- `bun run lint`: zero errors or warnings.
- `bunx tsc --noEmit`: the root type check passes. It covers `features/**` and `test/**`.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional type check passes. It covers `adwPatch.tsx`.
- `bun run build`: passes.
- `bun run test:unit`: the existing Vitest suite still passes, including the stub and manifest tests under `test/mocks/__tests__/`, with the marker lookup now upward. This plan adds no unit tests.
- `bun run lint:git-guard`: no violation. `features/` and `test/` are exempt, so the `gh` wrapper and shadow are allowed there.
- `bun run jsonl:check`: the stub's envelope templates still conform.
- `for i in 1 2; do NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface and @subprocess" || exit 1; done`: both runs report `7 scenarios (7 passed)` and exit 0. On `dev` they are pending.
- `test -z "$(ls -d agents/surface-01 agents/surface-10 agents/surface-11 agents/surface-16 agents/surface-19 logs/surface-01 logs/surface-10 logs/surface-11 logs/surface-16 logs/surface-19 2>/dev/null)" && test -z "$(ls agents/spawn_locks 2>/dev/null | grep -E '^acme_widgets_issue-(1001|1010|1011|1016|1019|1030)\.json$')" && test ! -e agents/cron/acme_widgets.json`: the rows left no state, logs, spawn lock or cron registry entry in the checkout.
- `test -z "$(git branch --list '*surface-*' '*issue-10[0-3][0-9]*')" && ! git worktree list | grep -qE 'surface-|issue-10[0-3][0-9]'`: the checkout gained no branch or worktree for these workflows.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-966"`: exits 0. It runs all of `feature-966.feature` and the `@adw-966` rows of features 909, 960, 961 and 963:
  - the seven rows twice;
  - the process-of-its-own isolation run;
  - the forced-empty variables and currencies;
  - the unsupported `gh` calls;
  - the comment and merge replay;
  - the timeout kill;
  - W10's missing exit code;
  - the unknown orchestrator names;
  - W9 pending without the harness;
  - the upward marker lookup;
  - feature-960's §1, §5 and §6, feature-961's own-process run, and feature-963's rows.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-960 or @adw-961 or @adw-963"`: exits 0. Compare with `/tmp/adw-966-flagged.before`; no scenario that passed before fails now.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@pause-queue-reset-time or @pause-queue-ownership or @webhook"`: the timing-sensitive and `PATH`-shadowing features pass and exit 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-966-regression.after 2>&1; tail -n 3 /tmp/adw-966-regression.after; ! tail -n 3 /tmp/adw-966-regression.after | grep -q failed`: the whole regression suite has no failed scenario. Compared with `/tmp/adw-966-regression.before`, the only change is that the seven rows are now passed. Every other scenario keeps its status, and the remaining smoke and surface scenarios stay pending, so Cucumber still exits 1 on those, as Divergence item 3 records.
- `git status --porcelain`: shows only the files this plan names, plus the working-tree changes that predate it. Nothing appears under `agents/` or `logs/`.

## Notes
- **Coding guidelines.** Strictly follow `.adw/coding_guidelines.md`:
  - files under 300 lines; `thenSteps.ts` is already 414, so new steps go into `subprocessSteps.ts`;
  - guard clauses and at most two levels of nesting;
  - no `any`; narrow `unknown` from JSON;
  - pure modules for argv parsing, normalisation, projection and the REST mapping, with side effects only in `gh-cli-shadow.ts`, `forgeShadow.ts` and the runner;
  - comments only for invariants and non-obvious reasons, such as:
    - why replay happens after exit;
    - why the variables are `''` and not unset;
    - why `COST_REPORT_CURRENCIES` is `,`;
    - why the cron's cadence variables are pinned;
    - why the auth gate is cleared;
    - why the driver lives outside the import globs;
    - why the harness spawns through the absolute `bunx`.

    No issue numbers in comments.
- **No new library** is needed.
- **Precedent:** `feature-902-queue.steps.ts`'s `gh` shadow and replay-after-exit, `realCronProcess.ts`'s detached cron killed by process group, `createGitMockDir`'s `/bin/sh` wrapper, `webhookCronSteps.ts`'s save and restore of the auth gate and cron files, and `phaseConfig.ts`'s made-up-adwId guard. The 902/908 shadows stay untouched.
- **Replay target.** `replayForgeLog` dispatches through `dispatchMockRequest` rather than HTTP. It records in-process and synchronously, exactly as the listener does, and no request waits on the event loop. Unrouted paths (`/graphql`, label deletes, secrets, reviews, issue creation) are still recorded; their 404 answers are ignored.
- **`gh` inventory** (from `node_modules/@paysdoc/devplatform/dist/providers/github/`):
  - every call is `execSync('/bin/sh -c "gh …"')` with cwd set to the framework root and `{ ...process.env, GH_TOKEN, GIT_* }`;
  - stdout is trimmed; any non-zero exit throws;
  - the one live `--jq` is `.defaultBranchRef.name`;
  - `gh auth token` runs only when neither an App nor `GITHUB_PAT` is configured, so with the fake PAT it is not called at all; the shadow still answers it;
  - `pr create`'s stdout must match `/\/pull\/(\d+)$/`, and `issue create`'s must match `/\/issues\/(\d+)$/`;
  - GitHub App tokens would be fetched with curl, which the shadow cannot intercept, so the App variables must stay blank.
- **Why `@subprocess`.** W1 is used by about twenty other smoke and surface scenarios, including `review` and `init` names that no longer exist. Making it real everywhere would turn them from pending to failed and break feature-960 §6. The tag lets later slices opt each row in.
- **Cross-repository hazard, out of scope.** `scanAuthQueue` rewrites every `paused_auth` workflow in a cron's checkout, whatever its repository. W10 refuses to run instead. A production fix belongs in its own issue.
- **`adwDocument.tsx` ignores `--target-repo`.** It has its own parser and calls `buildLaunchBoundary(null)`, so W1 `document` would run self-host against the ADW checkout. No row in this slice drives it. A later slice must make it honour `--target-repo` before driving it.
- **Workspace trust.** With the child's empty temp `HOME`, `ensureWorkspaceTrusted` finds no `.claude.json`, logs a warning and writes nothing. The developer's file is never read.
- **Out of scope:**
  - `adwTest.tsx` also ignores `--issue-type`; a later slice that drives `test` should change it the same way;
  - the smoke scenarios, which reuse this harness in later slices;
  - every other parked surface row.
- **Docs.** ADR-0037 Divergence item 3 stays open; this is the second surface slice. The document phase refreshes `app_docs/feature-9gjajh-bdd-regression-suite.md`. The parts that change:
  - the "W1/W10 stay pending" contract (now pending without `@subprocess`);
  - the stub's marker lookup;
  - the new harness modules, the `gh` shadow, the init driver and the Smoke processes vocabulary;
  - the `CHILD_TIMEOUT_MS` change.
- **Working tree.** At planning time the working tree already held the scenario writer's edits to the seven rows and to features 909, 960, 961 and 963, plus unrelated changes under `.claude/` and in `README.md`. Leave the unrelated ones alone. The plan commit guard forbids touching `.claude/` and `.adw/`.
