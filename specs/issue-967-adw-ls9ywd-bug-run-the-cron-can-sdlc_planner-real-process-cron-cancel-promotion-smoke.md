# Bug: run the cron, cancel and promotion smoke scenarios as real processes

## Metadata
issueNumber: `967`
adwId: `ls9ywd-bug-run-the-cron-can`
issueJson: `{"number":967,"title":"bug: run the cron, cancel and promotion smoke scenarios as real processes","body":"Source: the `## Divergence` section of `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, item 3. Read it before planning.\n\nSplit from #935, which was too large for one run and is closed. The facts below come from #935's planning research. Check them against the code before relying on them.\n\nMoves the four smoke scenarios that need no full agent pipeline onto real processes: the cron spawn, the cancel directive, and the promotion sweep (young and mature). It uses the subprocess harness from #966 and the webhook harness from #961. Divergence item 3 stays until the last slice.\n\n## What to build\n\nRewrite in place, keeping `@regression @smoke`.\n\n- **`cron_trigger_spawn`.** W10, with eligible issue 300. Give it an `adw:*` label and an age past the grace period.\n  - Then: `the \"sdlc\" orchestrator was launched for issue 300`, read from the launch recorder.\n  - Drop T5: the cron is killed, not exited.\n- **`cancel_directive`.** Rewrite it to the real trigger-side reset (ADR-0032). Cancel is not an orchestrator stage.\n  - Seed a workflow for issue 500 under adwId `cancel-smoke-500`: a top-level state, plus an ADW workflow comment carrying the adwId on the mocked issue.\n  - Deliver a `## Cancel` `issue_comment` through the real `dispatchWebhookEvent`, with #961's handling: auth gate saved and cleared, signature, launch recorder.\n  - Assert what the cancel handler actually does: state, worktree removal, comments. Read `adws/triggers/cancelHandler.ts`.\n- **`promotion_threshold_auto_ramp`, young and mature.** W1 `promotion-sweep` over the target workspace. The Claude stub is never invoked by the sweep, so the old `commits` manifests had no effect. Seed the workspace with:\n  - a committed `features/per-issue/feature-9300.feature` holding a scenario the real `score()` rates 4 against the workspace's vocabulary;\n  - `.adw/scenarios.md` declaring the vocabulary;\n  - git history: none for young (bootstrap N = 3); for mature, enough `regression-promotion` commits and per-issue additions in 90 days that `computeThreshold` returns 5.\n\n  Write the seeding as Givens. Then T18 for young (the named scenario is tagged today) and T19 for mature (no tag), reading the workspace registered under the adwId, plus T5 0.\n\nRewrite or replace the manifests these scenarios use, and remove every `.adw/state.json` edit. Register new phrases in `features/regression/vocabulary.md`.\n\n## Acceptance criteria\n\n- [ ] The four scenarios run real processes or the real dispatcher, and pass.\n- [ ] `cancel_directive` asserts only what `cancelHandler.ts` does.\n- [ ] After the run, the auth gate, the pause queue and the cron registry are as they were before it.\n- [ ] Scenarios passing on `dev` still pass.\n\n## Blocked by\n\n#961\n#966\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T07:59:13Z","comments":[],"actionableComment":null}`

## Bug Description
ADR-0037 decides a hybrid regression suite: a few smoke scenarios run real ADW processes, and surface scenarios run phases in-process. Item 3 of its `## Divergence` section records that the smoke and surface scenarios are pending. #963/#965 built the in-process phase harness, #961 the in-process webhook harness (`webhookCronSteps.ts`, the `bunx` launch recorder) and #966 the hermetic subprocess harness (`@subprocess`, the `gh` shadow, W1/W9/W10 made real). Every smoke scenario under `features/regression/smoke/` is still pending.

This slice moves the four smoke scenarios that need no full agent pipeline onto real processes or the real dispatcher:

- `cron_trigger_spawn.feature`: one scenario. Today it is untagged `@subprocess`, so W10 returns `pending`. It also asserts T5 (`the orchestrator subprocess exited 0`), which always fails after W10 because the harness kills the cron, and T2 (a comment on issue 300), which the cron never writes. G11 (a worktree for `cron-smoke-300`) plays no part in a cron tick.
- `cancel_directive.feature`: one scenario. It runs the `sdlc` orchestrator with a stub manifest and asserts `workflowStage "cancelled"`. No code under `adws/` writes a `cancelled` stage, as ADR-0032's Confirmation records, and `## Cancel` is not an orchestrator stage. It is the trigger-side reset `handleCancelDirective` (`adws/triggers/cancelHandler.ts`), which the webhook reaches from `dispatchWebhookEvent`'s `issue_comment` branch. The scenario never posts a `## Cancel` comment, so the cancel handler is never exercised.
- `promotion_threshold_auto_ramp.feature`: two scenarios, young and mature. They run W1 `promotion-sweep`, but they are untagged `@subprocess`, so W1 is pending. Their manifests (`promotion-threshold-young-repo.json`, `promotion-threshold-mature-repo.json`) write `features/per-issue/feature-9300.feature` and list `commits`. The sweep never invokes the Claude stub, so none of this ever reaches the sweep. Their Thens also assert things the sweep does not do: T2 (a comment on issue 512), and T7 for the mature case only.

Expected: the four scenarios run the real cron trigger, the real webhook dispatcher and the real promotion sweep, assert only artefacts those processes produce, and pass. Every scenario that passes on `dev` keeps passing. The auth gate, the pause queue and the cron registry are left as they were.

## Problem Statement
Rewrite the four scenarios in place (`@regression @smoke` kept) so that:

1. `cron_trigger_spawn` runs W10 over an eligible issue 300 and asserts the launch recorder caught the `sdlc` orchestrator for issue 300 (T-SP4), with no T5.
2. `cancel_directive` seeds a workflow for issue 500 under `cancel-smoke-500` (top-level state, an ADW workflow comment carrying the adwId, and a worktree for the issue in a target workspace). It then delivers a signed `## Cancel` `issue_comment` through the real `dispatchWebhookEvent` with #961's handling, and asserts what `handleCancelDirective` does: the adwId's state is gone, the issue's worktree is removed, and every comment on the issue was deleted.
3. `promotion_threshold_auto_ramp` seeds the target workspace through Givens (vocabulary declaration, a score-4 `feature-9300.feature` and, for mature, ramp history and merged promotions). It then runs the real `promotionSweep.ts` and asserts the outcome the threshold decides, through artefacts that exist after the run.

Several of the issue's facts are wrong for the current code (see Root Cause Analysis): the threshold numerator, and T18/T19 as the young/mature assertions. The plan corrects them rather than writing scenarios that cannot pass or that pass vacuously.

## Solution Statement
Reuse the two harnesses; add only the seams the four scenarios need:

- **Cron.** Tag `@subprocess`. G4 already seeds an `adw:feature`, hour-old issue (past the 5-minute grace period). Keep `Given an issue 300 exists…`, `When the cron probe runs once`, `Then the "sdlc" orchestrator was launched for issue 300`.
- **Cancel.** Tag `@webhook`, so #961's Before/After hooks apply: secret and Slack variables neutralised, GitHub App variables blanked, auth gate saved, cleared and restored, launch recorder created and disposed, and the cron registry and log restored. `deliverPayload` in `webhookCronSteps.ts` gains an injectable `mintEventBoundary` and is exported. A new support module builds a throwaway target workspace (`materialiseTargetWorkspace` under a temp `TARGET_REPOS_DIR`) holding a real worktree for the issue. It also mints a `LaunchBoundary` with a real `GitContext` bound to that workspace, so `removeWorktreesForIssue` runs real git, and the recording `mockForgeProviders`. `mockForgeProviders` gains the three tracker methods the cancel path calls, `fetchComments`, `getIssueTitle` and `deleteComment`, dispatched in-process to the mock. New Given/When/Thens seed the workflow, deliver the comment, and assert state removal, worktree removal and comment deletion.
- **Promotion.** Tag `@subprocess`. New Givens commit fixtures on the workspace's `main` and move `refs/remotes/origin/main` with each commit, because the sweep builds its worktree off `origin/<default>`. The fixtures are `.adw/scenarios.md` declaring the vocabulary registry, the registry itself, and a `feature-9300.feature` whose one scenario the real `score()` rates 4. A Given generates per-issue scenario history, and a Given seeds closed `regression-promotion` issues whose linked pull requests merged in the window. The Thens read what survives the run: T5 0; T-SP2 on the sweep's own report line, which states N; a new Then for the promotion issue the sweep files only after its marker pull request merged (young); T7 zero merges and a new Then for no promotion issue (mature).
- **Shared.** Accept `<name>-smoke-<N>` adwIds in the subprocess harness's made-up-adwId guard, so W1 can claim `promotion-threshold-smoke-512` and the cancel Given can guard `cancel-smoke-500`. Delete the three obsolete manifests. Register every new phrase in `features/regression/vocabulary.md`. Update feature-960 §6, which asserts every smoke scenario stays pending, so the three now-passing smoke files are allowed to pass.

## Steps to Reproduce
1. `NODE_OPTIONS="--import tsx" bunx cucumber-js features/regression/smoke/cron_trigger_spawn.feature features/regression/smoke/cancel_directive.feature features/regression/smoke/promotion_threshold_auto_ramp.feature` reports `4 scenarios (4 pending)`. None carries `@subprocess`, so W1 and W10 return `'pending'`.
2. Add `@subprocess` to `cron_trigger_spawn.feature` and rerun it. W10 runs, then T2 and T5 fail: the cron posts no comment, and T5 reads `-1` because W10 records no exit code.
3. Add `@subprocess` to `promotion_threshold_auto_ramp.feature` and rerun it. W1 fails in `claimAdwId` with `Only an adwId made up for a scenario (surface-… or throwaway<N>-…) may be run…; got "promotion-threshold-smoke-512"`. With that bypassed, the sweep scores nothing: the cli-tool workspace holds no `features/per-issue/` file, since the stub manifests that would write one are never read.
4. `grep -rn "'cancelled'" adws/` finds no writer of a `cancelled` stage. `cancel_directive.feature` contains no `## Cancel` comment, so `handleCancelDirective` never runs.
5. Revert the experiments (`git checkout -- features/regression/smoke/`).

## Root Cause Analysis
The four scenarios predate both harnesses and were never rewritten to them (ADR-0037 Divergence item 3). Checking the issue's facts against the code gives:

1. **Cron.** W10 (`runCronProbe`, `subprocessDrivers.ts`) and T-SP4 (`subprocessSteps.ts`) already exist. Surface row 30 is the same scenario for issue 1030, and it passes. G4 already gives the issue `adw:feature` and `created_at`/`updated_at` an hour ago, so no new Given is needed. The cron's first tick is `cycleCount = 1`, and W10 pins every cadence variable to 1,000,000, so the tick runs no pause-queue scan (`scanPauseQueue` returns unless `cycleCount % PROBE_INTERVAL_CYCLES === 0`), no janitor, no hung detector and no sweep.
2. **Cancel.** `dispatchWebhookEvent`'s `issue_comment` branch answers `auth_gate_set` while `agents/.auth_gate` exists. It calls `ensureCronProcess` for every named repository, which launches `bunx tsx adws/triggers/trigger_cron.ts` and opens `logs/agents/cron/<owner>_<repo>.log`. On `## Cancel` (`/^## Cancel$/mi`) it fetches the issue's comments through `commentBoundary.providers.issueTracker.fetchComments`, then calls `handleCancelDirective(issueNumber, comments, boundary, cancelCwd)`. `cancelCwd` is unused by the handler. The handler:
   - extracts adwIds from the comments (`extractAdwIdFromComment`, ``**ADW ID:** `<id>` ``);
   - for each adwId, SIGTERMs (then SIGKILLs) the `pid` of the adwId's orchestrator sub-state, if `findOrchestratorStatePath` finds an `*-orchestrator` sub-state with a live pid;
   - calls `boundary.gitContext.removeWorktreesForIssue(issueNumber)`. In the library this removes every worktree under `<basePath>/.worktrees` whose basename contains `-issue-<N>-`, deletes its local branch (`git branch -D`) and prunes;
   - deletes `agents/<adwId>/` for each adwId;
   - calls `clearIssueComments(issueNumber, issueTracker)`, which runs `fetchComments`, `getIssueTitle`, then `deleteComment(id)` for every comment;
   - on the webhook path, has no `processedSets`, so nothing is re-queued.

   #961's `deliver` hardwires `fakeEventBoundary`, whose providers throw, and `mockForgeProviders` refuses `fetchComments`, `getIssueTitle` and `deleteComment`. Neither can carry the cancel path today. The mock server already serves `GET /repos/:o/:r/issues/:n`, `GET …/issues/:n/comments` and `DELETE /repos/:o/:r/issues/comments/:id`. The DELETE is recorded but does not remove the comment from state.
3. **Promotion: the sweep's flow** (`promotionSweep.ts`, `promotionSweepDefaults.ts`, `perIssueSweepPersist.ts`). `prepareSweepBase` creates a worktree on a new branch `chore/promotion-sweep` off `origin/<default>` (`createWorktreeForNewBranch` runs `git worktree add -b … origin/main`). The sweep lists, reads, configures and scores from that worktree only. `.adw/scenarios.md` gives the registry path, with `features/regression/vocabulary.md` as the fallback. On `originate` it commits the marker in that worktree, pushes the branch (a no-op under the git mock), opens a pull request and merges it (`gh` shadow records). Only after the merge does it file the promotion issue (`gh issue create` plus `--add-label` for `adw:feature`, `regression-promotion` and `hitl`). Finally `cleanupSweepBase` removes the worktree and deletes the local branch (`git branch -D`). So a Given that commits only on `main` without moving `refs/remotes/origin/main` is invisible to the sweep.
4. **Promotion: T18/T19 cannot be used (fact correction).**
   - The marker never reaches the target workspace. It lives only on `chore/promotion-sweep`, which the sweep deletes, and the hermetic forge has no git behind its merge. T18 reading the workspace would always fail, and T19 would pass whatever the sweep did.
   - The marker is feature-level: `serializePromotionTagState` rewrites the tag block above `Feature:`. T18/T19 read the tag block above a named `Scenario:` line, so they would miss it even if it landed. They are left over from per-scenario tagging (ADR-0040, superseded by ADR-0049).

   What does survive the run is forge-recorded: the promotion issue, which is filed only after the marker PR merged, and the merge itself. The sweep's report line `promotionSweep: threshold <N>, originated <k>, …` also survives, on stdout.
5. **Promotion: the numerator is not commits (fact correction).** `loadPromotionStats` takes `promotedCount90d` from `promotionMergeDates`: closed issues labelled `regression-promotion` whose linked merged pull request (`Closes|Implements [owner/repo]#N`) has `mergedAt` within 90 days. They are read through `gh issue list --state all --search 'label:"regression-promotion"'` and `gh pr list --state merged`, which the `gh` shadow serves from the mock server's state. `totalPerIssueCount90d` counts `+Scenario:` lines in `.feature` files under `features/per-issue` in `git log -p --since=<90 days ago> --no-merges` of the sweep worktree. The seeded `feature-9300.feature` commit counts 1 itself. So:
   - young: 0 promotions over 1 addition, a ratio of 0, gives N = 3, the bootstrap value;
   - mature: 1 promotion over 4 additions (feature-9300 plus 3 more), a ratio of 0.25, gives N = 3 + round(4 × 0.25 ÷ 0.5) = 5.
6. **Promotion: scoring.** A score of 4 against a workspace registry needs three things. One step must match no registry phrase, so the surface weight is 0. A `When` must match a `subprocess` phrase, for 3. And one more `When`/`And` must follow it, for an extra-phase weight of 1. Score 4 is at least 3, so young originates. 4 is below 5, so mature leaves.
7. **adwId guard.** `claimAdwId` (`subprocessHarness.ts`) accepts only `^(surface|throwaway\d+)-[a-z0-9-]+$`. The smoke files name their adwIds `<name>-smoke-<N>` (`cancel-smoke-500`, `promotion-threshold-smoke-512`, `rate-limit-smoke-400`, …).
8. **feature-960 §6** (`features/per-issue/feature-960.feature`, tagged `@adw-960 … @adw-966`) runs `@smoke or @surface` in a child Cucumber. It asserts every smoke and surface scenario is pending except a table of surface rows, matched only under `features/regression/surfaces/`, exactly one scenario per row. Passing smoke scenarios break it, so it must learn about smoke files, including a file with two scenarios.
9. **Manifests.** None of the three manifests contains a `.adw/state.json` edit, and `test/mocks/manifestRefusalGuard.ts` now refuses one. Rewriting the scenarios leaves the three manifests unused.

## Relevant Files
Use these files to fix the bug:

- `README.md`: project overview, the `## Cancel` and promotion sweep summaries.
- `.adw/coding_guidelines.md`: files under 300 lines, guard clauses, comments only for invariants and non-obvious rationale, no issue numbers in comments.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: Divergence item 3 (stays; not edited) and the rot rubric.
- `specs/adr/0032-explicit-cancel-and-retry-directives.md`: what `## Cancel` does (state, worktree, comments; trigger-side, not a stage).
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: conditional doc for the regression suite, the subprocess harness, the launch recorder and the mock layer.
- `app_docs/feature-9gjajh-webhook-triggers.md`: conditional doc for `dispatchWebhookEvent` and its injectable `mintEventBoundary`.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: conditional doc owning `adws/triggers/cancelHandler.ts`.
- `app_docs/feature-9gjajh-promotion-system.md`: conditional doc for the promotion sweep, scorer and threshold.
- `app_docs/feature-9gjajh-cron-triggers.md`: conditional doc for the cron tick and its cadence.
- `app_docs/feature-9gjajh-bdd-per-issue.md`: conditional doc for `features/per-issue/**` (feature-960 §6).
- `adws/triggers/cancelHandler.ts`: the behaviour `cancel_directive` must assert (read-only).
- `adws/triggers/trigger_webhook.ts`: `dispatchWebhookEvent`'s `issue_comment` branch (read-only).
- `adws/triggers/webhookRepoResolver.ts`: `resolveWebhookRepo` reads `repository.full_name` and `clone_url` (read-only).
- `adws/triggers/webhookGatekeeper.ts`: `ensureCronProcess` (read-only).
- `adws/adwClearComments.tsx`: `clearIssueComments`, the `fetchComments`/`getIssueTitle`/`deleteComment` surface (read-only).
- `adws/core/workflowCommentParsing.ts`: `CANCEL_COMMENT_PATTERN` and `extractAdwIdFromComment` (read-only).
- `adws/forge/workflowCommentsIssue.ts`: `formatWorkflowComment('starting', …)`, the ADW comment that carries the adwId (read-only; used by the new Given).
- `adws/core/agentState.ts`: `AgentStateManager.writeTopLevelState` and `getTopLevelStatePath` (read-only).
- `adws/core/stateHelpers.ts`: `findOrchestratorStatePath` (read-only). A top-level state without an orchestrator sub-state means nothing is signalled.
- `adws/triggers/promotionSweep.ts`, `adws/triggers/promotionSweepDefaults.ts`, `adws/triggers/perIssueSweepPersist.ts`: the sweep's worktree, stats, marker landing and issue filing (read-only).
- `adws/promotion/promotionScorer.ts`, `promotionThreshold.ts`, `promotionStatsLoader.ts`, `vocabularyParser.ts`, `scenarioParser.ts`: score, N and parsing (read-only).
- `adws/core/promotionTagState.ts`: the marker is feature-level (read-only).
- `adws/core/promotionReconcileLink.ts`: `parsePromotesMarker` (read-only; reused by the new Thens).
- `adws/core/promotionIssueBody.ts`: the issue's `Promotes: feature-N` first line and labels (read-only).
- `adws/forge/issueLinkMarker.ts`: `bodyLinksIssue` (`Closes|Implements [repo]#N`) (read-only).
- `adws/core/adwLabels.ts`: `ADW_REGRESSION_PROMOTION_LABEL` (read-only).
- `adws/core/pauseQueue.ts`, `adws/triggers/pauseQueueScanner.ts`: `PAUSE_QUEUE_PATH` and the cadence gate that keeps the cron tick off the queue (read-only).
- `features/regression/smoke/cron_trigger_spawn.feature`: rewrite.
- `features/regression/smoke/cancel_directive.feature`: rewrite.
- `features/regression/smoke/promotion_threshold_auto_ramp.feature`: rewrite.
- `features/regression/support/subprocessHarness.ts`: the made-up-adwId guard.
- `features/regression/support/fixtureTargetRepo.ts`: the target workspace. Add a default-branch commit that moves `origin/main`.
- `features/regression/support/fixtureWorktree.ts`: `realGit`, `commitFileOnBranch`, `HARNESS_GIT_IDENTITY` (reused).
- `features/regression/support/mockForgeProviders.ts`: add `fetchComments`, `getIssueTitle`, `deleteComment`.
- `features/regression/support/subprocessDrivers.ts`, `subprocessRun.ts`, `harnessOrchestrators.ts`, `launchRecorder.ts`, `forgeShadow.ts`: W1/W10, the env, the launch recorder and the forge replay (reused; unchanged).
- `features/regression/step_definitions/webhookCronSteps.ts`: #961's hooks and delivery. Make the boundary minter injectable and export `deliverPayload`.
- `features/regression/step_definitions/subprocessSteps.ts`: T-SP2/T-SP4 (reused; unchanged).
- `features/regression/step_definitions/givenSteps.ts`, `thenSteps.ts`: G4, T5, T7 (reused; unchanged).
- `features/regression/step_definitions/world.ts`, `features/regression/support/hooks.ts`: a World field for the webhook target workspace.
- `features/regression/vocabulary.md`: register the new phrases and update the section prose.
- `features/per-issue/feature-960.feature`, `features/per-issue/step_definitions/feature-960.steps.ts`: §6 must allow the passing smoke files.
- `test/mocks/github-api-server.ts`: routes the new mock-forge methods hit (read-only).
- `test/mocks/ghShadowReads.ts`, `ghShadowWrites.ts`, `ghShadowState.ts`: the `gh` calls the sweep makes are all supported (read-only).
- `test/mocks/__tests__/manifestRefusalGuard.test.ts`: iterates the committed manifests, so deleting three is safe (read-only).
- `test/fixtures/jsonl/manifests/cancel-directive.json`, `promotion-threshold-young-repo.json`, `promotion-threshold-mature-repo.json`: delete.

### New Files
- `features/regression/support/webhookTarget.ts`: the throwaway target workspace an in-process webhook dispatch acts on, its issue worktree, and the boundary minter. No hooks, no import-time side effects.
- `features/regression/step_definitions/cancelDirectiveSteps.ts`: the cancel directive's Given, When and Thens.
- `features/regression/step_definitions/promotionSweepSteps.ts`: the promotion sweep's seeding Givens and its promotion-issue Thens.
- `test/fixtures/scenarios/promotion/scenarios.md`: the workspace's `.adw/scenarios.md`, declaring the vocabulary registry.
- `test/fixtures/scenarios/promotion/vocabulary.md`: the workspace's vocabulary registry.
- `test/fixtures/scenarios/promotion/feature-9300.feature`: the score-4 per-issue candidate.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Record the baseline
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-967-regression.before 2>&1; tail -n 3 /tmp/adw-967-regression.before` and keep the summary. The four target scenarios are pending, and no scenario has failed.
- Record the shared state: `shasum agents/.auth_gate agents/paused_queue.json agents/cron/acme_widgets.json logs/agents/cron/acme_widgets.log > /tmp/adw-967-state.before 2>&1 || true`.

### 2. Accept smoke adwIds in the subprocess harness's guard (`features/regression/support/subprocessHarness.ts`)
- Change `MADE_UP_ADW_ID` to `/^((surface|throwaway\d+)-[a-z0-9-]+|[a-z]+(-[a-z]+)*-smoke-\d+)$/`. Smoke files name their adwIds `<name>-smoke-<issue>`, and a real adwId starts with a random six-character id.
- Extract the assertion into `export function assertMadeUpAdwId(adwId: string): void`. Its message names all three shapes: `surface-…`, `throwaway<N>-…` or `<name>-smoke-<N>`. Call it from `claimAdwId`; it is reused by the cancel Given.

### 3. Commit on the target workspace's default branch (`features/regression/support/fixtureTargetRepo.ts`)
- Add `export function commitOnDefaultBranch(workspace: string, relPath: string, contents: string, message: string): void`. It calls `commitFileOnBranch(workspace, relPath, contents, message)` (the workspace is on `main`), then `realGit(workspace, 'update-ref', 'refs/remotes/origin/main', 'main')`.
- One-line comment giving the reason: the promotion sweep builds its worktree off `origin/<default>`, so a commit that does not move `origin/main` is invisible to it.

### 4. Give the mock forge the cancel path's tracker methods (`features/regression/support/mockForgeProviders.ts`)
- `fetchComments(issueNumber)`: dispatch `GET /repos/<owner>/<repo>/issues/<n>/comments` through `dispatchOrThrow`. Map each REST record to the port's `IssueComment`: `id: String(id)`, `body`, `author: user.login`, `createdAt: created_at`, using the existing defensive record readers or an `isRecord` helper like the one in `seededRecords.ts`.
- `getIssueTitle(issueNumber)`: dispatch `GET /repos/<owner>/<repo>/issues/<n>` with `dispatchMockRequest`. Return the record's `title`, or `'(unknown)'` on a status of 400 or more or an unreadable body, failing open as the port documents.
- `deleteComment(commentId)`: dispatch `DELETE /repos/<owner>/<repo>/issues/comments/<id>` through `dispatchOrThrow`.
- Update the header comment's list of implemented methods: add the three tracker methods the cancel directive's handler calls. The file stays well under 300 lines.

### 5. Make #961's delivery reusable (`features/regression/step_definitions/webhookCronSteps.ts`)
- Add `export type EventBoundaryMinter = (targetRepo: TargetRepoInfo | null) => LaunchBoundary | undefined;`.
- `deliver(event, rawBody, signature?, mintEventBoundary: EventBoundaryMinter = fakeEventBoundary)` passes the minter to `dispatchWebhookEvent`.
- Export `deliverPayload(event, payload, repoFullName?, signingSecret?, mintEventBoundary?)` and thread the minter through. Existing callers are unchanged: the throwing fake stays the default for W-WH1 to W-WH5.
- Keep the hooks (`HOOK_TAGS = '@webhook or @adw-961'`) as they are. The cancel feature opts in by carrying `@webhook`. The file must stay at 300 lines or fewer.

### 6. Add the webhook target to the World
- `features/regression/step_definitions/world.ts`: add `webhookTarget: WebhookTarget | null = null;` (type-only import from `../support/webhookTarget.ts`), with a short doc comment saying it is the throwaway target workspace an in-process webhook dispatch acts on.
- `features/regression/support/hooks.ts`: reset `this.webhookTarget = null;` in the `@regression` After hook, alongside the other resets.

### 7. Create `features/regression/support/webhookTarget.ts`
- `export interface WebhookTarget { readonly repository: RepoIdentifier; readonly targetReposDir: string; readonly workspacePath: string }`.
- `export function createWebhookTarget(world: Pick<RegressionWorld, 'cleanup'>, repoFullName: string): WebhookTarget`:
  - split `owner/repo` (assert both parts);
  - `mkdtempSync(join(tmpdir(), 'adw-webhook-target-'))`, with removal pushed on `world.cleanup`;
  - `materialiseTargetWorkspace(owner, repo, targetReposDir)`;
  - return the target with `repository = { owner, repo, platform: Platform.GitHub }`.
- `export function addIssueWorktree(target: WebhookTarget, issueNumber: number, slug: string): string`: the branch is `feature-issue-<N>-<slug>`, ADW's `{type}-issue-{N}-{slug}` shape that `removeWorktreesForIssue` matches. Run `realGit(workspacePath, 'worktree', 'add', '-q', '-b', branch, join(workspacePath, '.worktrees', branch), 'main')` and return the branch.
- `export function worktreesForIssue(target: WebhookTarget, issueNumber: number): string[]`: parse `realGit(workspacePath, 'worktree', 'list', '--porcelain')` `worktree <path>` lines. Keep the paths whose basename contains `-issue-<N>-`.
- `export function webhookTargetBoundary(target: WebhookTarget): EventBoundaryMinter`:
  - it returns `undefined` for a `targetRepo` that is null or names another repository; the dispatcher then answers `boundary_unavailable` and the Thens fail loudly;
  - otherwise it returns `{ gitContext, repoId: target.repository, providers: mockForgeProviders(target.repository, target.workspacePath) }`;
  - `gitContext` is `new GitContext({ owner, repo, selfHost: false, tokenProvider: createLiteralTokenProvider('mock-token'), gitIdentity: <HARNESS_GIT_IDENTITY as author and committer>, frameworkRepoRoot: REPO_ROOT, targetReposDir: target.targetReposDir })`, so its `basePath` is the workspace and `removeWorktreesForIssue` runs real git there.
- No Cucumber hooks, no import-time side effects. The `git-gh` guard exempts `features/`, as it does for `phaseConfig.ts`'s `new GitContext`.

### 8. Create `features/regression/step_definitions/cancelDirectiveSteps.ts`
- **G-CD1** `a workflow for issue {int} is running under adwId {string} in a worktree of the target repository {string}`:
  - `assert.ok(this.mockContext)` and `assertMadeUpAdwId(adwId)`;
  - remove `agents/<adwId>/` (`join(AGENTS_STATE_DIR, adwId)`) and push its removal on `this.cleanup`, so a handler that fails leaves nothing behind;
  - `this.webhookTarget = createWebhookTarget(this, repo)`, then `const branch = addIssueWorktree(target, issueNumber, adwId)`;
  - `AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber, workflowStage: 'build_running', branchName: branch, orchestratorScript: 'adws/adwSdlc.tsx', repoIdentity: { owner, repo } })`. Write no `pid` and no orchestrator sub-state, so the handler finds nothing to signal and can never SIGTERM the Cucumber process. One-line comment saying exactly that;
  - append to the mock issue's comments (`getMockServerState().comments`, then `setState({ comments: { …, [N]: [...existing, comment] } })`) the comment ADW posts when it starts: `formatWorkflowComment('starting', { issueNumber, adwId })`. Give it a numeric id unused on the issue, a `user.login` such as `adw-bot`, and `created_at`/`updated_at` now. Put the append in a small `appendIssueComment(world, issueNumber, body, login)` helper.
- **W-CD1** `the webhook receives the comment {string} on issue {int} from the repository {string}, signed with the secret {string}`:
  - assert `this.webhookTarget`;
  - append the comment to the mock issue's comments with `appendIssueComment`. GitHub stores the comment before it delivers the event, so the handler sees it among the issue's comments;
  - build `{ action: 'created', issue: { number, body: '' }, comment: { body }, repository: { full_name: repo, clone_url: targetCloneUrl(owner, repo) } }`;
  - `await deliverPayload('issue_comment', payload, repo, secret, webhookTargetBoundary(this.webhookTarget))`. Passing the repository makes #961's cron snapshot cover the `ensureCronProcess` launch and log.
- **T-CD1** `no state remains for adwId {string}`: assert `!existsSync(join(AGENTS_STATE_DIR, adwId))`. The message names the path.
- **T-CD2** `the target repository {string} has no worktree for issue {int}`: assert the World's target names that repository, and that `worktreesForIssue(target, N)` is empty. The message lists any left.
- **T-CD3** `the mock GitHub API recorded the deletion of every comment on issue {int}`:
  - read the comment ids the mock holds for the issue (`getMockServerState().comments[String(N)]`; the mock's DELETE route keeps them) and assert there is at least one;
  - assert each id has a recorded `DELETE` whose URL ends in `/issues/comments/<id>`;
  - the message lists the recorded DELETE URLs.
- Do not assert the webhook's response or the cron launch: those are the dispatcher's, and the scenario asserts only what `cancelHandler.ts` does.
- Keep the file well under 300 lines.

### 9. Add the promotion fixtures (`test/fixtures/scenarios/promotion/`)
- `scenarios.md`: the cli-tool fixture's `.adw/scenarios.md` sections (`## Scenario Directory` `features/`, and both `echo` run commands), plus:
  - `## Per-Issue Scenario Directory`: `features/per-issue/`;
  - `## Regression Scenario Directory`: `features/regression/`;
  - `## Vocabulary Registry`: `features/regression/vocabulary.md`.
- `vocabulary.md`: a registry the scorer parses:

  ~~~
  # Widgets Regression Vocabulary

  ## Observability Surfaces (Examples)

  - Exit codes of the widgets CLI

  ## When — CLI invocation

  | # | Phrase | Semantics | Pattern | Assertion target |
  |---|--------|-----------|---------|------------------|
  | W1 | `the widgets CLI is run with {string}` | Runs the CLI as a child process with the argument | subprocess | exit code |

  ## Then — CLI outcome

  | # | Phrase | Semantics | Pattern | Assertion target |
  |---|--------|-----------|---------|------------------|
  | T1 | `the widgets CLI exits {int}` | Asserts the CLI's exit code | subprocess | exit code |
  ~~~

- `feature-9300.feature`:

  ~~~
  @adw-9300
  Feature: The widgets CLI reports its version

    Scenario: The CLI reports its version on two runs in a row
      Given the widgets CLI is installed from a fresh checkout
      When the widgets CLI is run with "--version"
      And the widgets CLI is run with "--version"
      Then the widgets CLI exits 0
  ~~~

  The scenario scores 4 (`score()` against the registry above):
  - surface 0, because the `Given` matches no phrase;
  - execution 3, because the `When` matches a `subprocess` phrase;
  - phase count 1, because the `When` plus its `And` make two when-steps.

  None of these files sits under a `cucumber.js` path or `features/per-issue/`, so nothing in this repository runs or sweeps them.

### 10. Create `features/regression/step_definitions/promotionSweepSteps.ts`
- **G-SP3** `the target repository's default branch holds {string} from fixture {string}`: `commitOnDefaultBranch(ensureTargetWorkspace(this), relPath, readFileSync(resolve(REPO_ROOT, fixture), 'utf-8'), \`Add ${relPath}\`)`. The step needs the subprocess harness (`@subprocess`).
- **G-SP4** `the target repository's default branch gained {int} more per-issue scenarios in the last 90 days`:
  - generate a feature with N scenarios whose steps no registry phrase names (`Given an earlier precondition <i>` / `When an earlier action <i>` / `Then an earlier outcome <i>`, each scoring 0, so the sweep leaves the file);
  - commit it as `features/per-issue/feature-9301.feature` with `commitOnDefaultBranch`. Committed now, it is inside the 90-day window.
- **G-SP5** `the target repository has {int} promotion issue(s) closed by a pull request merged {int} days ago`:
  - for i in 0..N-1, add to the mock state, keeping what is there, a closed issue `9200 + i`: REST shape, `state: 'closed'`, `closed_at`, `labels: [{ name: ADW_REGRESSION_PROMOTION_LABEL }]`, body starting `Promotes: feature-<9200 + i>` (a feature no file names, so it reconciles with no candidate);
  - also add a merged pull request `9250 + i` with `merged: true`, `merged_at` D days ago, body `Implements #<9200 + i>`, `headRefName`, and `baseRefName: 'main'`;
  - `forgeStateFrom` maps these to `CLOSED` and `MERGED` records the `gh` shadow serves.
- **T-SP6** `the mock GitHub API recorded a promotion issue for {string}`: among recorded `POST`s whose URL path is `/repos/<owner>/<repo>/issues` exactly, assert one whose JSON `body` gives `parsePromotesMarker(body) === feature`. The message lists the recorded issue-creation titles.
- **T-SP7** `the mock harness recorded zero promotion issues for {string}`: the inverse, with zero such requests.
- No hooks. Keep the file under 300 lines.

### 11. Rewrite `features/regression/smoke/cron_trigger_spawn.feature`
~~~
@regression @smoke @subprocess
Feature: SDLC Cron Probe — Trigger Spawn on Eligible Issue

  Scenario: cron probe launches the sdlc orchestrator for an eligible issue
    Given an issue 300 exists in the mock issue tracker
    When the cron probe runs once
    Then the "sdlc" orchestrator was launched for issue 300
~~~

### 12. Rewrite `features/regression/smoke/cancel_directive.feature`
~~~
@regression @smoke @webhook
Feature: Cancel Directive — a ## Cancel comment resets the issue's workflow on the trigger side

  Scenario: a ## Cancel comment delivered to the webhook removes the workflow's state, its worktree and the issue's comments
    Given an issue 500 exists in the mock issue tracker
    And a workflow for issue 500 is running under adwId "cancel-smoke-500" in a worktree of the target repository "acme/widgets"
    And the webhook secret is set to "adw-regression-webhook-secret"
    When the webhook receives the comment "## Cancel" on issue 500 from the repository "acme/widgets", signed with the secret "adw-regression-webhook-secret"
    Then no state remains for adwId "cancel-smoke-500"
    And the target repository "acme/widgets" has no worktree for issue 500
    And the mock GitHub API recorded the deletion of every comment on issue 500
~~~

### 13. Rewrite `features/regression/smoke/promotion_threshold_auto_ramp.feature`
~~~
@regression @smoke @subprocess
Feature: Promotion Threshold — Auto-Ramp N from 90-day Activity Ratio

  Background:
    Given the target repository's default branch holds ".adw/scenarios.md" from fixture "test/fixtures/scenarios/promotion/scenarios.md"
    And the target repository's default branch holds "features/regression/vocabulary.md" from fixture "test/fixtures/scenarios/promotion/vocabulary.md"
    And the target repository's default branch holds "features/per-issue/feature-9300.feature" from fixture "test/fixtures/scenarios/promotion/feature-9300.feature"

  Scenario: young repo — a scenario scoring 4 is suggested for promotion, because no promotion has merged and N = 3
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-threshold-smoke-512" and issue 512
    Then the orchestrator subprocess exited 0
    And the orchestrator subprocess's output contains "promotionSweep: threshold 3,"
    And the mock GitHub API recorded a promotion issue for "feature-9300"

  Scenario: mature repo — the same scenario is not suggested, because 1 merged promotion over 4 added scenarios raises N to 5
    Given the target repository's default branch gained 3 more per-issue scenarios in the last 90 days
    And the target repository has 1 promotion issue closed by a pull request merged 10 days ago
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-threshold-smoke-512" and issue 512
    Then the orchestrator subprocess exited 0
    And the orchestrator subprocess's output contains "promotionSweep: threshold 5,"
    And the mock harness recorded zero PR-merge calls
    And the mock harness recorded zero promotion issues for "feature-9300"
~~~

### 14. Delete the obsolete manifests
- `git rm test/fixtures/jsonl/manifests/cancel-directive.json test/fixtures/jsonl/manifests/promotion-threshold-young-repo.json test/fixtures/jsonl/manifests/promotion-threshold-mature-repo.json`. Confirm with `grep -rn` that nothing else references them.

### 15. Register the phrases (`features/regression/vocabulary.md`)
- **Smoke processes (@subprocess).** Add the rows below with the columns `# | Phrase | Semantics | Pattern | Assertion target`:
  - G-SP3, G-SP4 and G-SP5 (`subprocess` / `mock-query` for G-SP5, mock server state). Say that G-SP3 and G-SP4 move `refs/remotes/origin/main`, because the sweep's worktree starts there.
  - T-SP6 and T-SP7 (`mock-query`, recorded requests). Say that the sweep files the issue only after its marker pull request merged.

  Update the prose:
  - the claimed-adwId shapes (`surface-…`, `throwaway<N>-…` or `<name>-smoke-<N>`);
  - the definitions now live in `subprocessSteps.ts` and `promotionSweepSteps.ts`;
  - the reused-phrase list (T-SP2 reads the sweep's report line, plus T7);
  - the sweep commits its marker on a `chore/promotion-sweep` worktree it removes, and the marker is a feature-level tag, so T15–T19 cannot observe it in the target workspace.
- **New section `## Given/When/Then — Cancel Directive (@webhook)`.** Its heading starts with `Given/When/Then` so `vocabularyParser.ts` reads it. The prose says:
  - the scenario drives the real `dispatchWebhookEvent` in-process under #961's `@webhook` hooks, with a signed `issue_comment`;
  - the boundary is minted over a throwaway target workspace, with a real `GitContext` and the recording mock forge;
  - assertions read the `agents/<adwId>/` state artefact, `git worktree list` (a git artefact) and the recorded DELETE requests;
  - the dispatcher's response and cron launch are deliberately not asserted.

  Rows G-CD1, W-CD1, T-CD1, T-CD2 and T-CD3 (`phase-import` / `mock-query`). Note the reused phrases G4 and G-WH3.
- **Webhook Cron On Every Event section.** Qualify the sentence about the fake boundary: W-WH1 to W-WH5 mint it, and the Cancel Directive rows mint one over a throwaway target workspace.
- Leave T15–T21 and G13–G17 in place. No feature uses them now, and removing them is outside this slice.

### 16. Let feature-960 §6 allow the passing smoke files
- `features/per-issue/step_definitions/feature-960.steps.ts`:
  - rename the step to `every smoke and surface scenario is reported pending, except these surface rows and smoke files, which pass:`;
  - add `isScenarioOfRow(scenario, row)`, matching a row against `SURFACE_DIRECTORY` or `SMOKE_DIRECTORY`;
  - `assertRowPasses` requires at least one scenario from the file and every one of them to pass;
  - `parked` uses the same matcher.
- `features/per-issue/feature-960.feature` §6:
  - add `@adw-967` to its tags;
  - retitle it to "…except the surface rows and smoke files that run in-process, as subprocesses or through the webhook dispatcher, which pass";
  - use the renamed step;
  - add the rows `cancel_directive.feature`, `cron_trigger_spawn.feature` and `promotion_threshold_auto_ramp.feature`.
- If the scenario writer has already made this change, align with it rather than duplicate it.

### 17. Run the validation commands
- Run every command in `Validation Commands`.
- Compare `/tmp/adw-967-regression.after` with `/tmp/adw-967-regression.before`. The only change is that the four smoke scenarios moved from pending to passed; no scenario failed.
- Compare `/tmp/adw-967-state.after` with `/tmp/adw-967-state.before`. They match: the auth gate, the pause queue and the `acme/widgets` cron registry and log are as they were.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun install`: dependencies present.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js features/regression/smoke/cron_trigger_spawn.feature features/regression/smoke/cancel_directive.feature features/regression/smoke/promotion_threshold_auto_ramp.feature > /tmp/adw-967-smoke4.before 2>&1; tail -n 3 /tmp/adw-967-smoke4.before`: the reproduction. Run it before the change; it reports `4 scenarios (4 pending)`.
- `bun run lint`
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run build`
- `bun run test:unit`: includes `manifestRefusalGuard.test.ts` over the remaining manifests.
- `shasum agents/.auth_gate agents/paused_queue.json agents/cron/acme_widgets.json logs/agents/cron/acme_widgets.log > /tmp/adw-967-state.before 2>&1 || true`
- `NODE_OPTIONS="--import tsx" bunx cucumber-js features/regression/smoke/cron_trigger_spawn.feature features/regression/smoke/cancel_directive.feature features/regression/smoke/promotion_threshold_auto_ramp.feature`: after the fix it reports `4 scenarios (4 passed)` and exits 0.
- `shasum agents/.auth_gate agents/paused_queue.json agents/cron/acme_widgets.json logs/agents/cron/acme_widgets.log > /tmp/adw-967-state.after 2>&1 || true; diff /tmp/adw-967-state.before /tmp/adw-967-state.after`: no difference. The auth gate, the pause queue and the cron registry are as they were.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@smoke" > /tmp/adw-967-smoke.after 2>&1; tail -n 3 /tmp/adw-967-smoke.after; ! tail -n 3 /tmp/adw-967-smoke.after | grep -q failed`: the four pass, and the other smoke scenarios stay pending, not failed.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@webhook"`: #961's regression feature and the cancel scenario pass after the delivery change. Exits 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @subprocess"`: surface rows 01, 10, 11, 16, 19, 29 and 30 and the cron and promotion smoke scenarios pass. Exits 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" > /tmp/adw-967-surface.after 2>&1; tail -n 3 /tmp/adw-967-surface.after; ! tail -n 3 /tmp/adw-967-surface.after | grep -q failed`: the in-process rows that use `mockForgeProviders` still pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-960 or @adw-961 or @adw-963 or @adw-965 or @adw-966 or @adw-967" > /tmp/adw-967-perissue.after 2>&1; tail -n 3 /tmp/adw-967-perissue.after; ! tail -n 3 /tmp/adw-967-perissue.after | grep -q failed`: the per-issue scenarios sharing the changed harness pass, feature-960 §6 included.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-967-regression.after 2>&1; tail -n 3 /tmp/adw-967-regression.after; ! tail -n 3 /tmp/adw-967-regression.after | grep -q failed`: the whole regression suite has no failed scenario. Compared with `/tmp/adw-967-regression.before`, only the four smoke scenarios changed, from pending to passed. Cucumber still exits 1 on the remaining pending scenarios, as Divergence item 3 records.

## Notes
- **Coding guidelines.** `.adw/coding_guidelines.md` applies:
  - every touched or new file stays under 300 lines (`webhookCronSteps.ts` is at 289 and must stay at 300 or fewer);
  - guard clauses, nesting depth of 2 at most, named helpers for loop bodies;
  - comments only for invariants and non-obvious reasons; no issue numbers in comments;
  - no `any`; no decorators.
- **No new library.** If one were needed, the install command is `bun add <package>`.
- **The ADR stays as it is.** Do not edit `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: Divergence item 3 stays until the last slice.
- **Fact corrections against the issue.**
  - **The numerator.** The ramp's numerator is closed `regression-promotion` issues whose linked pull request merged in the 90-day window, read from the forge. It is not `regression-promotion:` commits, which nothing writes any more (`loadPromotionStats`, `promotionMergeDates`).
  - **The denominator.** It includes the `feature-9300.feature` seed commit itself. So the young N of 3 comes from a ratio of 0, which equals the bootstrap value. The mature scenario needs 1 promotion over 4 additions.
  - **T18/T19.** They are replaced by forge-recorded artefacts:
    - the sweep commits its marker on a `chore/promotion-sweep` worktree off `origin/<default>` and deletes worktree and branch on exit, so nothing reaches the target workspace;
    - in the hermetic harness, the push is a git-mock no-op and the merge is a `gh` shadow record;
    - the marker is a feature-level tag, so even a landed marker is invisible to T18/T19's scenario-level read;
    - the young case's evidence is the promotion issue, which is filed only once the marker pull request merged; the mature case asserts no merge and no issue;
    - T-SP2 on the sweep's report line pins N itself, the subject of the feature.
- **What `cancel_directive` deliberately leaves out.**
  - It asserts only what `cancelHandler.ts` does (state, worktree, comments).
  - It does not assert the dispatcher's `{ status: 'cancelled' }` response, nor the `ensureCronProcess` launch.
  - It does not assert the kill step: the seeded state carries no pid and no orchestrator sub-state, so the handler signals nothing. A seeded pid could only be the Cucumber process or a throwaway child, and the issue scopes the assertions to state, worktree and comments.
- **The pause queue.** It is not snapshotted. No step writes it:
  - the cron's first tick is cycle 1 with `PROBE_INTERVAL_CYCLES` pinned to 1,000,000;
  - neither the sweep nor the cancel handler touches it.

  A byte-for-byte restore would also race a real cron on the same checkout. The auth gate and the cron registry are restored by the existing hooks: the subprocess harness, and #961's `@webhook` hooks through `deliverPayload(…, repoFullName)`'s cron snapshot.
- **The manifests.** No committed manifest contains a `.adw/state.json` edit; `manifestRefusalGuard.ts` refuses one. Deleting the three manifests completes "rewrite or replace the manifests".
- **Documentation.** The document phase should update `app_docs/feature-9gjajh-bdd-regression-suite.md`:
  - which smoke scenarios now run, and how;
  - the cancel directive's webhook target;
  - the promotion fixtures and new phrases;
  - its smoke list still names the deleted `promotion_commenter`/`promotion_mover`.
- **Later slices.** The remaining smoke scenarios (`adw_sdlc_happy_path`, `pause_resume_rate_limit`, `adw_chore_diff_verdicts`) stay pending; they need the full agent pipeline. The `<name>-smoke-<N>` adwId shape accepted in step 2 already covers their adwIds.
