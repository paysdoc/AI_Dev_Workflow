# Feature: Promote the #912 in-process rate-limit wait scenario into the @regression suite

## Metadata
issueNumber: `1001`
adwId: `stecnx-feat-promote-912-sce`
issueJson: `{"number":1001,"title":"feat: promote #912 scenario into the @regression suite","body":"Promotes: feature-912\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-912` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-912.feature features/regression/<subdir>/feature-912.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-912.steps.ts features/regression/step_definitions/feature-912.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-912.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-912.steps.ts`\n\n## Phrases to register\n\n- `rate-limit facts with a \"five_hour\" limit that resets at \"<resets at>\"`\n- `the rate-limit wait policy decides at \"<now>\"`\n- `the wait policy decides to wait in-process until \"<resets at>\"`\n- `rate-limit facts with <facts>`\n- `the rate-limit wait policy decides at \"2026-09-22T11:57:00Z\"`\n- `the wait policy decides to enqueue <carrying>`\n- `the orchestrator's clock reads \"2026-09-22T11:57:00Z\"`\n- `an orchestrator for issue 840 in the target repository \"acme/widgets\" is running under adwId \"wait912-840\"`\n- `the \"build\" phase meets these outcomes, attempt by attempt:`\n- `the phase runner runs the \"build\" phase`\n- `the \"build\" phase ran 4 times`\n- `the orchestrator waited in-process until each of these times, in order:`\n- `no re-run of the \"build\" phase started before the reset time it waited for`\n- `the orchestrator never exited`\n- `the state file for adwId \"wait912-840\" records workflowStage \"build_completed\"`\n- `the pause queue does not hold adwId \"wait912-840\"`\n- `exactly 3 wait comments were posted on issue 840`\n- `the wait comments on issue 840 name these attempts and wait-until times in UTC, in order:`\n- `each wait comment on issue 840 was posted before the wait it announces began`\n- `every wait comment on issue 840 says the workflow is waiting for a rate limit to reset`\n- `every wait comment on issue 840 is recognised by ADW as its own comment`\n- `an orchestrator for issue 877 in the target repository \"acme/widgets\" is running under adwId \"wait912-877\"`\n- `the \"build\" phase is rejected by <limits> five-hour limits in a row, the first resetting at \"2026-09-22T12:50:00Z\" and each later one five hours after the one before, and then succeeds`\n- `the \"build\" phase ran <runs> times`\n- `the orchestrator waited in-process <limits> times, each until the reset time reported by the rejection before it`\n- `the wait comments on issue 877 carry the attempt numbers 1 to <limits>, in order`\n- `the state file for adwId \"wait912-877\" records workflowStage \"build_completed\"`\n- `the pause queue does not hold adwId \"wait912-877\"`\n- `an orchestrator for issue 871 in the target repository \"acme/widgets\" is running under adwId \"wait912-871\"`\n- `the \"<phase>\" phase meets these outcomes, attempt by attempt:`\n- `the phase runner runs the \"<phase>\" phase`\n- `the state file for adwId \"wait912-871\" recorded workflowStage \"<phase>_running\" throughout every wait`\n- `the heartbeat advanced lastSeenAt in the state file for adwId \"wait912-871\" during every wait`\n- `the hung-orchestrator detector did not report adwId \"wait912-871\" at the end of any wait`\n- `the state file for adwId \"wait912-871\" records workflowStage \"<phase>_completed\"`\n- `an orchestrator for issue 872 in the target repository \"acme/widgets\" is running under adwId \"wait912-872\"`\n- `the state file for adwId \"wait912-872\" records workflowStage \"starting\"`\n- `the \"plan\" phase meets these outcomes, attempt by attempt:`\n- `the phase runner runs the \"plan\" phase anonymously`\n- `the \"plan\" phase ran 2 times`\n- `the state file for adwId \"wait912-872\" recorded workflowStage \"starting\" throughout every wait`\n- `the heartbeat advanced lastSeenAt in the state file for adwId \"wait912-872\" during every wait`\n- `the pause queue does not hold adwId \"wait912-872\"`\n- `an orchestrator for issue 874 in the target repository \"acme/widgets\" is running under adwId \"wait912-874\"`\n- `a candidate arrives at issue 874 during every wait`\n- `every candidate that arrived at issue 874 during a wait was deferred to the waiting orchestrator`\n- `the \"build\" phase ran 3 times`\n- `the state file for adwId \"wait912-874\" records workflowStage \"build_completed\"`\n- `an orchestrator for issue 876 in the target repository \"acme/widgets\" is running under adwId \"wait912-876\"`\n- `the orchestrator process dies during its first wait`\n- `the state file for adwId \"wait912-876\" records workflowStage \"build_running\"`\n- `the pause queue does not hold adwId \"wait912-876\"`\n- `the next candidate arrives at issue 876`\n- `the candidate takes the workflow over under adwId \"wait912-876\"`\n- `the orchestrator's clock reads \"2026-09-25T09:00:00Z\"`\n- `an orchestrator for issue 875 in the target repository \"acme/widgets\" is running under adwId \"wait912-875\"`\n- `the \"build\" phase ran 1 time`\n- `the orchestrator did not wait in-process`\n- `no wait comment was posted on issue 875`\n- `the orchestrator exited with code 0`\n- `the state file for adwId \"wait912-875\" records workflowStage \"paused\"`\n- `the pause queue holds adwId \"wait912-875\" <queued facts>`\n- `an orchestrator for issue 873 in the target repository \"acme/widgets\" is running under adwId \"wait912-873\"`\n- `the \"build\" phase ran 2 times`\n- `exactly 1 wait comment was posted on issue 873`\n- `the state file for adwId \"wait912-873\" records workflowStage \"paused\"`\n- `the pause queue holds adwId \"wait912-873\" <queued facts>`\n- `the ADW TypeScript type-check passes`\n- `the git/gh guard is run across the repository`\n- `the git/gh guard reports no violations`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-912.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-04T15:36:03Z","comments":[],"actionableComment":null}`

## Feature Description
Issue #912 is the "Wait policy" slice of `specs/prd/rate-limit-indefinite-retry.md`. It taught ADW to ride
out a five-hour session limit with a known reset time in-process instead of exiting to the pause queue:

- The pure `decideRateLimitWait` (`adws/core/rateLimitWaitPolicy.ts`) returns `wait_in_process` until the
  reported reset time, or `enqueue` for every other rejection.
- `runPhase` (`adws/core/phaseRunner.ts`) posts a wait comment, sleeps through an injected clock until
  the reset time and re-runs the phase without a retry budget. Throughout, the workflow keeps its
  running stage, its heartbeat and its spawn lock.
- Every other rejection still exits 0 through the pause path.

The behavioural proof is `features/per-issue/feature-912.feature`: 13 scenario and outline blocks that
expand to **28 scenarios** across §1–§5. Its 40 step definitions are in
`features/per-issue/step_definitions/feature-912.steps.ts`.

Only #912's own workflow ran these scenarios, selected by `@adw-912`. #912 has merged, so the file is on
the per-issue sweep's 14-day path. Only its `@promotion-suggested-2026-10-04` marker keeps it there. The
promotion sweep scored the file over its threshold and filed this issue (`adw:feature`,
`regression-promotion`, `hitl`).

This feature performs the direct relocation the issue prescribes:

- the feature moves to a new `features/regression/rate-limit/` lane, tagged
  `@regression @rate-limit-in-process-wait`;
- the step file moves to the flat `features/regression/step_definitions/`;
- every `@adw-` tag is dropped;
- the two hooks are re-keyed from `@adw-912 and not @adw-910` to the new descriptive tag;
- the 40 novel phrases are registered in the vocabulary registry in their own domain section.

The value: the behaviour that stops a five-hour limit from stranding an issue (the #840 incident of
2026-09-22) joins the always-run safety net. Every workflow's scenario test phase and the daily Regression
Scenarios workflow will run it, and the sweep can no longer delete its harness.

## User Story
As an ADW maintainer
I want the #912 in-process rate-limit wait scenarios executed on every `@regression` run
So that a change to the wait policy, the phase runner's wait loop, the heartbeat, the spawn lock, the takeover handler or the pause path that would strand a rate-limited workflow is caught by the standing suite, rather than lost when the per-issue sweep deletes the scenarios

## Problem Statement
The #912 scenarios live in `features/per-issue/`, which the `@regression` run never selects. They are the
only executable proof of four behaviours:

- a five-hour limit with a known reset time is waited out in-process until exactly that time, with no
  retry cap;
- each wait is announced on the issue, in UTC, with its attempt number, before it begins;
- the waiting workflow keeps its running stage, its heartbeat (`lastSeenAt`) and its spawn lock, so the
  hung-orchestrator detector stays quiet, competing candidates defer, and a death mid-wait is taken over
  under the same adwId;
- every other rejection still exits 0 through the pause path with the CLI's limit facts.

No later workflow and no daily run executes these rows. Once the marker is resolved, the 14-day sweep
deletes the feature and its step file. A future regression in any of these modules would then go
undetected by BDD:

- `rateLimitWaitPolicy.ts`;
- `runPhase`'s wait loop;
- `heartbeat.ts`;
- `spawnGate.ts`;
- `takeoverHandler.ts`;
- `hungOrchestratorDetector.ts`;
- `handleRateLimitPause`.

The relocation also has three side requirements:

- the hooks are keyed on per-issue tags that a regression feature may not carry;
- the phrases are not in the registry;
- the feature's description and one cross-reference in the promoted feature-910 name tags, hook scopes and
  paths that the move makes false.

## Solution Statement
A **direct relocation**, following the #734 / #923 / #924 precedent (see
`specs/issue-734-adw-ikwe55-feat-promote-729-adw-sdlc_planner-promote-729-regression-scenario.md` and
`specs/issue-923-adw-8d7505-feat-promote-910-sce-sdlc_planner-promote-910-pause-queue-regression.md`) and
the tag shape of the later repair commit `517f823d` (`@regression @<descriptive-tag>`, no `@adw-` tag
anywhere, hooks re-keyed):

1. `git mv features/per-issue/feature-912.feature features/regression/rate-limit/feature-912.feature`. This
   creates a new subject lane, `rate-limit/`, beside `pause-queue/`, `hashing/`, `upgrade/` and `webhook/`.
   The filename stays `feature-912.feature`: the rot advisory (`.claude/commands/promote_regression_vocabulary.md`)
   looks the promoted feature up as `feature-912` under `features/regression/`.
2. `git mv features/per-issue/step_definitions/feature-912.steps.ts features/regression/step_definitions/feature-912.steps.ts`.
   **No import is rewritten.** Both directories are three levels deep, so every specifier still resolves:
   - `../../regression/step_definitions/world.ts` now resolves to the sibling `world.ts`;
   - `../../../test/mocks/test-harness.ts` and `../../../adws/…` still resolve from the repo root.
3. Replace the feature-level tag line `@adw-912 @adw-kdrab9-in-process-wait-and @promotion-suggested-2026-10-04`
   with `@regression @rate-limit-in-process-wait`, and delete all 13 scenario-level tag lines. Those lines
   carry `@adw-912 @adw-kdrab9-in-process-wait-and`, plus `@adw-959` and/or `@adw-960` on some rows.
   - The promotion marker is dropped as well. It only has meaning under `features/per-issue/`: its sole
     readers, `promotionTagState.ts` via `perIssueScenarioSweep.ts` and `promotionSweep.ts`, scan only
     that directory.
   - No regression feature carries a marker.
4. Re-key both hooks from `{ tags: '@adw-912 and not @adw-910' }` to `{ tags: '@rate-limit-in-process-wait' }`.
   The `not @adw-910` exclusion is no longer needed:
   - it existed so these hooks skipped the feature-910 rows that once also carried `@adw-912`;
   - the promoted feature-910 carries no `@adw-` tag and will never carry the new tag.
5. Close one global leak that promotion would otherwise spread across the shared suite. The death row
   (`the orchestrator process dies during its first wait`) abandons a `runPhase` promise that never
   settles, so the `.finally` that restores `process.exit` never runs. The death branch must restore
   `process.exit` itself:
   - In the per-issue run, only #912's own later rows inherited the trap.
   - In the `@regression` run, every later feature would inherit it: `smoke/`, `surfaces/`, `upgrade/`
     and `webhook/` all run after `rate-limit/`.
6. Keep prose truthful. Update the sentences in the moved feature's description, the step file's header
   comment and promoted feature-910's description that name the old tags, hook scope or per-issue path.
   No step line, data table, Examples table, scenario title or Background changes.
7. Register the 40 novel phrases in a new `## Given/When/Then — Rate-Limit In-Process Wait (@rate-limit-in-process-wait)`
   section of `features/regression/vocabulary.md` (G-RW1–10, W-RW1–4, T-RW1–26). Every row asserts a
   runtime artefact. The section reuses, and does not re-register, G18, T1, T22 and W16/T34.
8. Add one README tree line for `features/regression/rate-limit/`, then prove the result: the 28
   scenarios run and pass under `@rate-limit-in-process-wait` and inside the full `@regression` run,
   `@adw-912` selects nothing, and every static check stays green.

**Why this is safe (verified during planning, read-only):**

- **Closed dependency set.** A static cross-check expanded every Scenario Outline row: the feature has 94
  concrete steps. Each one matches exactly one definition. The definitions are the 40 in
  `feature-912.steps.ts`, all of them used, plus five regression-owned ones:
  - G18 in `features/regression/step_definitions/givenSteps.ts`;
  - T1, T22 and T34 in `thenSteps.ts`;
  - W16 in `whenSteps.ts`.

  No per-issue step file contributes a step. Nothing imports `feature-912.steps.ts`. The step file
  imports no per-issue module. So once moved, nothing the sweep deletes can break the promoted feature.
- **No new ambiguity.** `cucumber.js` imports both `features/regression/step_definitions/**/*.ts` and
  `features/per-issue/step_definitions/**/*.ts`, so the moved module is still evaluated exactly once.
  The suite-wide static check covered 1,157 definitions in 195 loaded step files and found no second
  match for any 912 step.
- **Hook compatibility.** Once the feature carries `@regression`, the only hooks that newly apply are
  `features/regression/support/hooks.ts`'s `@regression` `Before`/`After`. The 912 `Before` and the
  `@regression` `Before` both call `setupMockInfrastructure()`, and so do both `After`s for
  `teardownMockInfrastructure()`. That is safe in either order:
  - `setupMockInfrastructure()` is idempotent: it returns the running context when `isSetUp && gitLog`;
  - `teardownMockInfrastructure()` is null-guarded and idempotent;
  - the 912 `After` cleanup (heartbeat, `agents/<adwId>/`, spawn locks, worktree, pause-queue restore)
    needs no mock.

  This is the same double-hook arrangement the promoted pause-queue features already run under through
  `feature-902-queue.steps.ts`.
- **The pause path is unaffected by the mock environment.** `handleRateLimitPause`
  (`adws/phases/workflowCompletion.ts`) runs with no `repoContext`. It writes the stage, appends the queue
  entry and calls the trapped `process.exit`, and it makes no git or `gh` call. So the git mock on `PATH`
  and `GH_TOKEN` change nothing.
- **Cross-tags are inert.** #959 (PR #969) and #960 (PR #971) are merged, and no hook is keyed on
  `@adw-959` or `@adw-960` for these rows:
  - feature-959's hooks are `@adw-959 and not @adw-908 and not @adw-912`, which excludes these rows today;
  - feature-960's hooks are keyed on `@adw-f2mx98-bug-regression-then or @adw-p5u9xh-bug-build-the-hermet`.

  Dropping the tags therefore changes which hooks run for no row.
- **Checks still cover the moved code.**
  - `adws/checkGitGhGuard.ts` exempts `features/`.
  - `tsconfig.json` includes `**/*.ts`.
  - `eslint.config.js` has no per-directory rules.

## Relevant Files
Use these files to implement the feature:

**Moved (`git mv`; edited only as listed in the tasks):**
- `features/per-issue/feature-912.feature` → `features/regression/rate-limit/feature-912.feature`. The
  scenario file:
  - feature tag line at line 1;
  - 13 scenario-level tag lines at 302, 314, 332, 354, 375, 395, 416, 433, 448, 465, 488, 515 and 519;
  - a long description whose lines 107–111, 113–115, 262–264, 270–273, 279, 288 and 291–295 name tags,
    hook scopes and definition locations;
  - Background G18.
- `features/per-issue/step_definitions/feature-912.steps.ts` →
  `features/regression/step_definitions/feature-912.steps.ts`. It holds:
  - the 40 novel definitions;
  - the module-scoped `world` and `policyWorld`;
  - `Before`/`After` at lines 159 and 166, tagged `@adw-912 and not @adw-910`;
  - a header comment, lines 1–12, describing that scope;
  - `driveOrchestratedPhase` (lines 444–477), whose death branch (467–473) never restores `process.exit`;
  - `setDefaultTimeout(60_000)`.

**Edited:**
- `features/regression/vocabulary.md`: gains the new domain section, between the `@pause-queue-ownership`
  section and `## Given/When/Then — Surface phases and lifecycles`.
- `features/regression/pause-queue/feature-910.feature`: lines 113–116 of its "AMENDED BY #912" paragraph
  name #912's old hook scope and per-issue path. Prose only.
- `README.md`: one new line in the `features/regression/` tree, between `pause-queue/` and `smoke/`.

**Read-only references:**
- `cucumber.js`: `paths` and `import` already cover `features/regression/**`. No edit needed.
- `features/regression/support/hooks.ts`: the `@regression` mock lifecycle that will now also wrap the
  feature. Its `setDefaultTimeout(60_000)` already owns the suite's default.
- `test/mocks/test-harness.ts` and `test/mocks/github-api-server.ts`: idempotent
  `setupMockInfrastructure`, `teardownMockInfrastructure` and `stopMockServer`. These are the basis of
  the hook-compatibility argument.
- `features/regression/step_definitions/givenSteps.ts` (G18), `thenSteps.ts` (T1, T22, T34),
  `whenSteps.ts` (W16) and `world.ts` (`RegressionWorld`, `mockContext`): the reused definitions. None is
  redefined.
- `features/regression/step_definitions/feature-902-queue.steps.ts` and `feature-902.steps.ts`: the
  pause-queue harness hooks. Their expression must not match the new tag, and it does not.
- The system under test. None of it is edited:
  - `adws/core/rateLimitWaitPolicy.ts`;
  - `adws/core/phaseRunner.ts`;
  - `adws/phases/workflowCompletion.ts` (`handleRateLimitPause`);
  - `adws/triggers/takeoverHandler.ts`;
  - `adws/core/hungOrchestratorDetector.ts`;
  - `adws/triggers/spawnGate.ts`;
  - `adws/core/heartbeat.ts`;
  - `adws/core/pauseQueue.ts`;
  - `adws/core/workflowCommentParsing.ts` (`isAdwComment`).
- `adws/promotion/vocabularyParser.ts`: the registry contract. Only `## Given|When|Then…` sections are
  parsed. A row needs five `|` columns. The phrase is column 2 with backticks stripped. The pattern
  (column 4) must be exactly `subprocess`, `phase-import` or `mock-query`, or it falls back to
  `mock-query`.
- `adws/promotion/promotionScorer.ts`: matches registry phrases with `{string}` → `.*` and `{int}` → `\d+`
  only (see Notes).
- `adws/core/promotionIssueBody.ts`, `adws/core/promotionTagState.ts`,
  `adws/triggers/perIssueScenarioSweep.ts` and `adws/triggers/promotionSweep.ts`: the issue-body contract
  and the only consumers of `@promotion-suggested-*`, all scoped to `features/per-issue/`.
- `.claude/commands/promote_regression_vocabulary.md`: the rot advisory expects the promoted
  `feature-912` under `features/regression/`.
- `features/per-issue/step_definitions/feature-959-world.ts`: its `OWN_ROWS = '@adw-959 and not @adw-908 and not @adw-912'`.
  After the move, the `not @adw-912` clause is inert. Not edited, as it is a per-issue file outside this
  promotion.
- `.adw/scenarios.md` and `.adw/commands.md`: the scenario directories, the registry path and the
  validation commands.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` (conditional doc). Matches "manually promoting a
  `features/per-issue/` scenario into `features/regression/`", the vocabulary registry and its rubric, and
  the promoted pause-queue features and codebase backstop steps.
- `app_docs/feature-9gjajh-bdd-per-issue.md` (conditional doc). Matches "working on BDD per-issue
  scenario files or step definitions in `features/per-issue/`".
- `app_docs/feature-9gjajh-claude-stream-parser.md` (conditional doc). Matches the phase runner loop, the
  in-process rate-limit wait policy, and "how a five-hour rate limit is ridden out in-process". It covers
  the system the promoted scenarios guard.
- `app_docs/feature-9gjajh-promotion-system.md` (conditional doc). Matches the #734-shaped promotion issue
  body and promotion tag-state tracking. It is the basis for dropping the marker.

### New Files
- `features/regression/rate-limit/feature-912.feature`: the relocated feature, created by `git mv`, in
  the new `features/regression/rate-limit/` directory.
- `features/regression/step_definitions/feature-912.steps.ts`: the relocated step file, created by
  `git mv` in the existing directory.

## Implementation Plan
### Phase 1: Foundation
Confirm the promotion is safe before anything moves:

- the system under test is merged, with `decideRateLimitWait` and `runPhase` and its `PhaseRunnerDeps`;
- the five reused definitions live in regression-owned files;
- nothing imports the step file;
- the new tag and directory are unused.

Every task is verify-then-act, so a partially applied worktree (renames already staged) is reconciled
rather than re-run.

### Phase 2: Core Implementation
1. Relocate the two files.
2. Re-tag the feature and re-key the hooks.
3. Restore `process.exit` in the death branch.
4. Refresh the prose that names the old tags, scope and path.
5. Register the 40 phrases in the vocabulary registry.
6. Add the README tree line.

### Phase 3: Integration
Prove the following:

- the 28 scenarios are discovered with no undefined or ambiguous step;
- they pass under their own tag and inside the full `@regression` run, alongside the pause-queue features
  that share the pause path, the queue file and the double-hook arrangement;
- `@adw-912` now selects nothing;
- lint, both type-checks, the build and the unit suite stay green.

## Step by Step Tasks
Execute every step in order, top to bottom. Each task is idempotent: check the current state first and
skip an action that is already applied.

### 1. Verify preconditions
- Check that the system under test is merged:
  - `grep -n "export function decideRateLimitWait" adws/core/rateLimitWaitPolicy.ts` matches;
  - `grep -n "export async function runPhase" adws/core/phaseRunner.ts` matches;
  - `grep -n "export interface PhaseRunnerDeps" adws/core/phaseRunner.ts` matches.
- Check that the reused definitions are regression-owned:
  - `the ADW codebase is checked out` in `features/regression/step_definitions/givenSteps.ts`;
  - `the state file for adwId {string} records workflowStage {string}`, `the ADW TypeScript type-check passes`
    and `the git\\/gh guard reports no violations` in `thenSteps.ts`;
  - `the git\\/gh guard is run across the repository` in `whenSteps.ts`.

  Do not add or redefine any of them.
- `grep -rn "feature-912.steps" features adws test` returns nothing, so no importer needs repointing.
- `grep -rn "rate-limit-in-process-wait" features` returns nothing, and `features/regression/rate-limit/`
  does not exist yet. If both already exist, a previous run applied part of this plan: reconcile, do not
  redo.

### 2. Move the feature file
- If `features/per-issue/feature-912.feature` still exists, run
  `mkdir -p features/regression/rate-limit && git mv features/per-issue/feature-912.feature features/regression/rate-limit/feature-912.feature`.
  `git mv` does not create the destination directory.
- If it was already moved, confirm `git status --porcelain` shows the rename and take no action.

### 3. Re-tag the moved feature
- Replace line 1, `@adw-912 @adw-kdrab9-in-process-wait-and @promotion-suggested-2026-10-04`, with exactly
  `@regression @rate-limit-in-process-wait`.
- Delete each of the 13 scenario-level tag lines. Each is `@adw-912 @adw-kdrab9-in-process-wait-and`,
  some followed by `@adw-959` and/or `@adw-960`, directly above a `Scenario:` or `Scenario Outline:`
  line. In the original file they are lines 302, 314, 332, 354, 375, 395, 416, 433, 448, 465, 488, 515
  and 519.
  - Delete each whole line, as was done for feature-537 and feature-729.
  - Keep the blank line and section comment above each scenario.
  - Do not add `@regression` at scenario level: the feature-level tag is inherited.
- Check: `grep -nE '^\s*@' features/regression/rate-limit/feature-912.feature` prints exactly one line,
  `1:@regression @rate-limit-in-process-wait`.
- Touch no step line, data table, Examples table, scenario title or the Background.

### 4. Keep the moved feature's description truthful
These are prose-only edits inside the Feature description. Keep the indentation. Never start a
description line with `@`, `|`, `#` or a step keyword.

- (a) Lines 109–111. Replace
  "The four rows are unchanged, and now also carry `@adw-912` as the guard that the enqueue branch still
  records the limit facts."
  with
  "The four rows are unchanged. They are the guard that the enqueue branch still records the limit facts,
  and they run under feature-910's own harness, never this file's hooks."
  Keep "feature-910's description records the amendment."
- (b) Lines 113–115. Replace
  "FLAGGED BY #959 (an orchestrator that dies in `starting` strands its issue). Three §3 rows also carry
  `@adw-959`. #959 changes the takeover handler, the spawn lock and possibly the hung-orchestrator
  detector, and these rows guard what must not move:"
  with
  "FLAGGED BY #959 (an orchestrator that dies in `starting` strands its issue). #959 changes the takeover
  handler, the spawn lock and possibly the hung-orchestrator detector, and three §3 rows guard what must
  not move:"
  Keep the three bullets and the rest of the paragraph.
- (c) Lines 262–264, the HOOKS note. Replace it with:
  "• HOOKS. Scope every hook to `@rate-limit-in-process-wait`, the tag only this feature carries. The four
  feature-910 rows that guard the enqueue branch run under the pause-queue harness, never these hooks."
  Keep its two sub-bullets (`Before`, `After`).
- (d) Lines 270–273, the REUSED note. Replace "T1 is defined in the regression suite's thenSteps.ts. T22
  and the git/gh guard pair are defined in feature-844.steps.ts." with "T1, T22 and the guard's Then (T34)
  are defined in the regression suite's thenSteps.ts, and the guard's When (W16) in its whenSteps.ts."
  `feature-844.steps.ts` no longer exists.
- (e) Two more sentences:
  - Line 279: replace "The git/gh guard pair from feature-844 is reused as it is written, as #908 and #910
    do." with "The git/gh guard pair is reused as registered, W16 and T34."
  - Line 288: replace "Apart from the guard pair, no unregistered phrase from another per-issue feature is
    reused." with "No unregistered phrase from another per-issue feature is reused."
- (f) Lines 291–295. Change "The registry has no phrase for the following, so novel phrasing is introduced
  for them:" to "The registry had no phrase for the following, so novel phrasing was introduced for
  them:". After "… and every policy step." add the sentence "They are registered in
  `features/regression/vocabulary.md` under `@rate-limit-in-process-wait` (G-RW1–G-RW10, W-RW1–W-RW4,
  T-RW1–T-RW26)."
- Leave the rest of the description unchanged, including its historical rationale.

### 5. Move the step-definition file
- If `features/per-issue/step_definitions/feature-912.steps.ts` still exists, run
  `git mv features/per-issue/step_definitions/feature-912.steps.ts features/regression/step_definitions/feature-912.steps.ts`.
  If it was already moved, confirm the rename and take no action.
- Do **not** rewrite any relative import. `../../regression/step_definitions/world.ts`,
  `../../../test/mocks/test-harness.ts` and `../../../adws/…` resolve identically from the destination.

### 6. Re-key the hooks to the descriptive tag
- Line 159: `Before({ tags: '@adw-912 and not @adw-910' }, …)` becomes
  `Before({ tags: '@rate-limit-in-process-wait' }, …)`.
- Line 166: `After({ tags: '@adw-912 and not @adw-910' }, …)` becomes
  `After({ tags: '@rate-limit-in-process-wait' }, …)`.
- Keep both hook bodies as they are. That includes the `setupMockInfrastructure()` and
  `teardownMockInfrastructure()` calls, which are idempotent beside the `@regression` hooks. Also keep
  `setDefaultTimeout(60_000)`.
- Header comment, lines 2–5. Replace the stale scope sentence with:
  "Novel step definitions for feature-912.feature. Every hook is scoped to `@rate-limit-in-process-wait`,
  which only that feature carries, so the feature-910 pause-path rows that guard the enqueue branch run
  under the pause-queue harness (feature-902-queue.steps.ts), never this one."
  Leave the second paragraph (§1–§4) as it is.
- Check: `grep -n "tags:" features/regression/step_definitions/feature-912.steps.ts` shows only
  `@rate-limit-in-process-wait`, twice.

### 7. Restore `process.exit` when the death row abandons the run
- In `driveOrchestratedPhase`, inside `if (world.diedDuringFirstWait) {`, directly after
  `await world.firstWaitBegun;`, add `process.exit = originalExit;`. Precede it with one comment line
  giving the non-obvious reason: the abandoned run never settles, so its `finally` would never restore
  the real exit.
- This is safe because the abandoned `runPhase` is suspended in a sleep that never resolves, so it can
  never call `process.exit` again.
- Without the fix, the trap would outlive the scenario and every later feature in the `@regression` run
  would inherit it.
- Change nothing else in the function.

### 8. Update promoted feature-910's cross-reference
- In `features/regression/pause-queue/feature-910.feature`, lines 114–116 of the "AMENDED BY #912"
  paragraph currently read:
  "#912's hooks are scoped to `@adw-912 and not @adw-910`, so they never run for these rows, which run
  under `@regression` with this file's harness alone. The rest of #912's behaviour is specified in
  `features/per-issue/feature-912.feature`."
- Replace them with:
  "#912's hooks are scoped to `@rate-limit-in-process-wait`, which these rows do not carry, so they never
  run for them; these rows run under `@regression` with this file's harness alone. The rest of #912's
  behaviour is specified in `features/regression/rate-limit/feature-912.feature`."
- Prose only. Re-wrap to the paragraph's width and keep the indentation.

### 9. Register the phrases in `features/regression/vocabulary.md`
Insert a new domain section directly after the `@pause-queue-ownership` section, after its closing
paragraph "This scenario also reuses already-registered phrases, … and the generic W16/T34 above.", and
before `## Given/When/Then — Surface phases and lifecycles`. Separate it from both neighbours with a
`---` line.

Format rules:

- Use the established five-column schema.
- The Pattern column is exactly `phase-import` for every row, so `vocabularyParser.ts` classifies it.
- Write each phrase exactly as its cucumber expression appears in the step file, with the escaping
  removed. For example, `the orchestrator's clock reads {string}`.
- No phrase contains `|`.
- Do not register G18, T1, T22, W16 or T34 again.

Paste this section:

```md
## Given/When/Then — Rate-Limit In-Process Wait (@rate-limit-in-process-wait)

These phrases drive the in-process wait for a five-hour rate limit (phase-import): the real pure wait
policy (`decideRateLimitWait`, `adws/core/rateLimitWaitPolicy.ts`), the real phase runner (`runPhase`)
over a scripted fake phase function, and the real takeover handler (`evaluateCandidate`) and
hung-orchestrator detector (`findHungOrchestrators`). The phase runner is given an injected orchestrator
clock, whose every wait advances the pinned instant to the wait's end while keeping the runner
suspended for a short real delay, and a comment seam that records every comment it posts; `process.exit`
is trapped for the When step. The orchestrator a scenario sets up holds the real spawn lock and runs the
real heartbeat on a 20 ms tick — timers are never faked. Every assertion targets a runtime artefact: the
decision the policy returns; the attempts, waits and comments recorded at those seams, in one ordered
event log; the trapped exit code; the top-level state file `agents/<adwId>/state.json`, sampled when
every wait begins and ends; the pause-queue state file `agents/paused_queue.json`; and the decisions the
takeover handler and the detector reach. No step reads a source file, satisfying the Rot-Detection
Rubric. The definitions live in `feature-912.steps.ts`. Its hooks are keyed on
`@rate-limit-in-process-wait`: they reset its module-scoped world, save, clear and restore the pause
queue, and stop the heartbeat and remove the state directories, the `acme/widgets` spawn locks and the
throwaway worktree. A scenario that uses these phrases must carry that tag and name `acme/widgets`.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-RW1 | `rate-limit facts with a {string} limit that resets at {string}` | Builds the wait policy's input facts as `RateLimitError` carries them: `rateLimitType` as given and `resetsAt` as the epoch seconds of the given ISO 8601 instant | phase-import | wait-policy input (SUT input) |
| G-RW2 | `rate-limit facts with a {string} limit and no reset time` | As G-RW1, with no `resetsAt` key | phase-import | wait-policy input (SUT input) |
| G-RW3 | `rate-limit facts with no limit type and a reset time of {string}` | As G-RW1, with no `rateLimitType` key | phase-import | wait-policy input (SUT input) |
| G-RW4 | `rate-limit facts with no limit type and no reset time` | Empty facts, as an overload or server error carries | phase-import | wait-policy input (SUT input) |
| G-RW5 | `the orchestrator's clock reads {string}` | Pins the phase runner's injected clock (`WaitClock.now`) to the instant; each wait advances it to the wait's end. Not the scanner's clock (`the cron host's clock reads {string}`) | phase-import | phase-runner clock seam (SUT input) |
| G-RW6 | `an orchestrator for issue {int} in the target repository {string} is running under adwId {string}` | Mirrors `runWithOrchestratorLifecycle`: writes the top-level state `agents/<adwId>/state.json` (stage `starting`, this process's `pid` and `pidStartedAt`, a `lastSeenAt`), takes the real spawn lock for `<repo>#<issue>` under this process, starts the real heartbeat on a 20 ms tick, and builds a `WorkflowConfig` over a throwaway worktree with no repo context. Use `acme/widgets`: the `After` hook releases that repository's spawn locks | phase-import | state file + spawn-lock artefacts |
| G-RW7 | `the {string} phase meets these outcomes, attempt by attempt:` | Scripts the fake phase function from the table (`attempt`, `outcome`, `limit type`, `resets at`): `rate-limited` throws `RateLimitError(<phase>, facts)` with `resetsAt` in epoch seconds and an empty cell left out of the facts; `succeeds` returns a zero-cost `PhaseResult`. Each attempt records the orchestrator clock reading at its start | phase-import | phase function (SUT input) |
| G-RW8 | `the {string} phase is rejected by {int} five-hour limits in a row, the first resetting at {string} and each later one five hours after the one before, and then succeeds` | Scripts N `five_hour` rejections resetting at X, X + 5 h, X + 10 h, …, then one success | phase-import | phase function (SUT input) |
| G-RW9 | `a candidate arrives at issue {int} during every wait` | Makes every wait run the real `evaluateCandidate` for the issue (real spawn-gate functions, inert stubs for the rest) and record the decision | phase-import | takeover decisions (artefact) |
| G-RW10 | `the orchestrator process dies during its first wait` | Makes the first wait never resolve; the phase-runner When then returns once that wait has begun, stops the heartbeat, and points the top-level state's and the spawn lock's `pid`/`pidStartedAt` at a child process that has really exited | phase-import | state file + spawn-lock artefacts |
| W-RW1 | `the rate-limit wait policy decides at {string}` | Calls the real pure `decideRateLimitWait` with the facts and the given instant; records the returned decision | phase-import | returned decision (artefact) |
| W-RW2 | `the phase runner runs the {string} phase` | Runs the real `runPhase` under the phase name over the scripted phase function, with the orchestrator clock and the recording comment seam injected and `process.exit` replaced, for the call, by a recorder that throws a sentinel the step catches. Every wait records its end, samples the top-level state when it begins and ends, runs the hung-orchestrator detector at its end, and stays suspended in real time for longer than the detector's threshold. Stops the heartbeat when the run ends | phase-import | attempt log + wait log + recorded comments + trapped exit + state file |
| W-RW3 | `the phase runner runs the {string} phase anonymously` | As W-RW2 with no phase name, as the orchestrators run most of their phases | phase-import | attempt log + wait log + recorded comments + trapped exit + state file |
| W-RW4 | `the next candidate arrives at issue {int}` | Runs the real `evaluateCandidate` for the issue with the real spawn-gate functions, the real top-level state and real process liveness, resolving the adwId with `extractLatestAdwId` over the workflow's starting comment followed by the recorded comments; records the decision | phase-import | takeover decision (artefact) |
| T-RW1 | `the wait policy decides to wait in-process until {string}` | Asserts the decision's kind is `wait_in_process` and its `until` is the given instant | phase-import | returned decision (artefact) |
| T-RW2 | `the wait policy decides to enqueue with the reset time {string}` | Asserts kind `enqueue` and a `resetsAt` (epoch seconds) that is the given instant | phase-import | returned decision (artefact) |
| T-RW3 | `the wait policy decides to enqueue with no reset time` | Asserts kind `enqueue` and no `resetsAt`; `null` or a defaulted value fails | phase-import | returned decision (artefact) |
| T-RW4 | `the {string} phase ran {int} time(s)` | Asserts the number of attempts recorded at the scripted phase function | phase-import | recorded attempts (artefact) |
| T-RW5 | `the orchestrator waited in-process until each of these times, in order:` | Asserts the recorded wait ends equal the `waits until` column, in order | phase-import | recorded waits at the clock seam |
| T-RW6 | `the orchestrator waited in-process {int} times, each until the reset time reported by the rejection before it` | Asserts N recorded waits, wait k ending at the reset time scripted attempt k's rejection reported | phase-import | recorded waits at the clock seam |
| T-RW7 | `the orchestrator did not wait in-process` | Asserts no wait was recorded | phase-import | recorded waits at the clock seam |
| T-RW8 | `no re-run of the {string} phase started before the reset time it waited for` | Asserts an attempt follows every wait and that attempt k + 1 started at an orchestrator clock reading no earlier than wait k's end | phase-import | recorded attempts + waits |
| T-RW9 | `the orchestrator never exited` | Asserts the trapped `process.exit` recorded no call | phase-import | trapped exit (artefact) |
| T-RW10 | `the orchestrator exited with code {int}` | Asserts the trapped `process.exit` was called with the code | phase-import | trapped exit code (artefact) |
| T-RW11 | `the state file for adwId {string} recorded workflowStage {string} throughout every wait` | Asserts at least one wait happened and that the top-level state sampled when every wait began and ended records the stage | phase-import | state file artefact (sampled in each wait) |
| T-RW12 | `the heartbeat advanced lastSeenAt in the state file for adwId {string} during every wait` | Asserts at least one wait happened and that in every wait the end sample's `lastSeenAt` is a strictly later instant than the begin sample's | phase-import | state file artefact (sampled in each wait) |
| T-RW13 | `the hung-orchestrator detector did not report adwId {string} at the end of any wait` | Asserts at least one wait happened and that the real `findHungOrchestrators`, run at the end of each wait over the real top-level state and real process liveness with a threshold of six test heartbeat ticks, did not report the adwId | phase-import | detector report (artefact) |
| T-RW14 | `every candidate that arrived at issue {int} during a wait was deferred to the waiting orchestrator` | Asserts at least one candidate decision was recorded and that every one is `defer_live_holder` naming this process's pid | phase-import | takeover decisions (artefact) |
| T-RW15 | `the candidate takes the workflow over under adwId {string}` | Asserts the decision W-RW4 recorded is `take_over_adwId` for the adwId | phase-import | takeover decision (artefact) |
| T-RW16 | `exactly {int} wait comment(s) was/were posted on issue {int}` | Asserts the number of comments the phase runner posted for the issue at the injected comment seam | phase-import | recorded comments |
| T-RW17 | `no wait comment was posted on issue {int}` | Asserts the phase runner posted no comment for the issue at the injected comment seam | phase-import | recorded comments |
| T-RW18 | `the wait comments on issue {int} name these attempts and wait-until times in UTC, in order:` | Asserts as many comments as table rows, comment k carrying `**Attempt:** <attempt>`, the `waits until` instant in ISO 8601 (`toISOString()`) and `(UTC)` | phase-import | recorded comment bodies |
| T-RW19 | `each wait comment on issue {int} was posted before the wait it announces began` | Asserts one comment per wait, comment k recorded before wait k in the event log the comment and clock seams share | phase-import | recorded event order |
| T-RW20 | `every wait comment on issue {int} says the workflow is waiting for a rate limit to reset` | Asserts at least one comment and that every body names a rate limit, case-insensitively: "rate limit" (space, underscore or hyphen optional), "five hour", "5 hour", "session limit" or "usage limit" | phase-import | recorded comment bodies |
| T-RW21 | `every wait comment on issue {int} is recognised by ADW as its own comment` | Asserts at least one comment and that `isAdwComment(body)` holds for every one | phase-import | recorded comment bodies |
| T-RW22 | `the wait comments on issue {int} carry the attempt numbers 1 to {int}, in order` | Asserts exactly N comments, comment k carrying `**Attempt:** k` | phase-import | recorded comment bodies |
| T-RW23 | `the pause queue does not hold adwId {string}` | Reads `agents/paused_queue.json` (saved, cleared and restored around the scenario); asserts no entry for the adwId | phase-import | pause-queue state artefact |
| T-RW24 | `the pause queue holds adwId {string} with a {string} limit that resets at {string}` | Asserts the adwId's entry carries the `rateLimitType` verbatim and a `resetsAt` that is the given instant | phase-import | pause-queue state artefact |
| T-RW25 | `the pause queue holds adwId {string} with a {string} limit and no reset time` | Asserts the adwId's entry carries the `rateLimitType` verbatim and no `resetsAt` key | phase-import | pause-queue state artefact |
| T-RW26 | `the pause queue holds adwId {string} with no limit type and no reset time` | Asserts the adwId's entry has neither `rateLimitType` nor `resetsAt` | phase-import | pause-queue state artefact |

This section also reuses already-registered phrases, so they need no new rows: `the ADW codebase is
checked out` (G18, Background), T1 (read from `agents/<adwId>/state.json`; one scenario also uses it as
a Given, to confirm the stage the orchestrator was seeded with), T22, and the generic W16/T34 git/gh
guard pair.
```

No cell in the block contains a `|`. That matters because `vocabularyParser.ts` splits cells on every
`|`, escaped or not, so a bar inside a cell would shift that row's Pattern and Assertion target columns.
T-RW20 therefore describes its regex in words. To confirm every new row has exactly six `|` characters,
run `grep -E '^\| [GWT]-RW' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u`, which
should print only `7`.

### 10. Add the README tree line
- In `README.md`'s `features/` tree, insert this line between the `│   ├── pause-queue/ …` line and the
  `│   ├── smoke/ …` line:
  `│   ├── rate-limit/     # Regression scenarios covering the in-process wait for a five-hour rate limit: the wait policy, the announced waits, liveness while waiting, and the pause-path fallback (#912)`
- Change nothing else in `README.md`. The worktree already carries unrelated, uncommitted README edits to
  the `adws/` test-file tree. Leave them exactly as they are and do not revert them.

### 11. Unit tests: no new test, existing coverage re-run
- No unit test is added. The reasons are under Testing Strategy → Unit Tests.
- Run the unit tests that own the behaviour the promoted scenarios prove, plus the parser that reads the
  edited registry:
  `bunx vitest run adws/core/__tests__/rateLimitWaitPolicy.test.ts adws/core/__tests__/phaseRunner.test.ts adws/promotion/__tests__/vocabularyParser.test.ts`
- Then run the full unit suite with `bun run test:unit`.

### 12. Run the Validation Commands
- Execute every command in `Validation Commands`, in order. Expected results:
  - the moved feature is discovered with 28 scenarios and no undefined or ambiguous step;
  - `@adw-912` selects 0 scenarios;
  - all 28 pass under `@rate-limit-in-process-wait`;
  - the full `@regression` run is green, with those 28 scenarios among the passed ones;
  - lint, both type-checks, the build and the unit suite pass.

## Testing Strategy
### Unit Tests
Unit tests are enabled: `.github/adw.yml` leaves `unitTests` commented out. **No new unit test is
needed**, because this feature adds no production code path. It moves BDD assets, re-keys two Cucumber
hooks, restores a test-harness global and edits Markdown.

The behaviour the promoted scenarios prove is already unit-tested where it lives:

- `adws/core/__tests__/rateLimitWaitPolicy.test.ts` covers the decision table. That includes the edges
  the feature deliberately leaves to the unit tests: the floor for a reset time at or behind the clock,
  and no ceiling.
- `adws/core/__tests__/phaseRunner.test.ts` (`in-process rate-limit wait`) covers:
  - three consecutive waits;
  - stage and heartbeat across waits;
  - enqueue after a wait;
  - the stale-reset floor;
  - the default comment poster;
  - the parallel-group wait;
  - the per-phase attempt counter.

The edited registry is read by `adws/promotion/vocabularyParser.ts`, whose row contract is covered by
`adws/promotion/__tests__/vocabularyParser.test.ts`. The new rows follow that contract (five columns, a
known `phase-import` pattern), so no parser change or test is needed.

Task 11 re-runs these three files and then the whole suite (`bun run test:unit`) to confirm zero
regressions.

### Edge Cases
- **Double mock lifecycle.** The 912 hooks and the `@regression` hooks both set up and tear down the
  mock infrastructure. Both functions are idempotent, so there is one mock server per scenario
  whichever hook registers first. The full `@regression` run re-proves this.
- **Hook order changes.** The moved file now loads before `features/regression/support/hooks.ts`, while
  in `features/per-issue/` it loaded after. Only the order of idempotent calls changes, and the 912
  `After` cleanup needs no mock.
- **The death row leaks no global.** It abandons a promise that never settles. After task 7,
  `process.exit` is restored when the step returns. No timer stays live: the abandoned sleep holds none
  and the heartbeat is stopped, so the run can still exit cleanly.
- **Shared real artefacts.** The scenarios write the following, and their `After` hook removes or
  restores each:
  - `agents/wait912-*/`;
  - spawn locks for `acme/widgets#840` and `#871–#877`;
  - a throwaway worktree;
  - the operator's `agents/paused_queue.json` (saved, cleared and restored, never clobbered).

  The pause-queue features use the same issue numbers in their own fixtures, but Cucumber runs
  scenarios serially and every scenario cleans up after itself.
- **Timing.** Each wait suspends 200 ms of real time, longer than the 120 ms detector threshold, over 34
  waits in total. That is about 7 s, plus one type-check (T22) and one guard run (W16). Every step stays
  well inside the 60 s default, and the daily `regression.yml` 30-minute jobs keep their headroom.
- **Docker leg.** The death row spawns and kills a real child process and reads its start-time token;
  the promoted pause-queue rows already depend on the same liveness tooling. T22 already passes
  `--incremental false` for the read-only mount.
- **Old tag selects nothing.** `--tags "@adw-912"` now matches 0 scenarios, and `@adw-959`/`@adw-960` no
  longer select these rows. Both issues are merged, and the rows run in every `@regression` pass instead.
- **The marker is gone on purpose.** The relocated file carries no `@promotion-suggested-*` tag. The
  per-issue sweep and the promotion sweep never list `features/regression/`, so nothing reads it.
- **Registry consumers.**
  - Future per-issue scenarios may now reuse these phrases, but must carry `@rate-limit-in-process-wait`
    to get the hooks. The new section says so.
  - The promotion scorer's matcher does not expand cucumber optional text or alternation (`time(s)`,
    `was/were`). It shares that limitation with existing rows such as T-PQ10.

## Acceptance Criteria
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` passes, and its run includes the
  28 scenarios of `features/regression/rate-limit/feature-912.feature`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-in-process-wait"` runs 28 scenarios
  and all 28 pass.
- `features/per-issue/feature-912.feature` and `features/per-issue/step_definitions/feature-912.steps.ts`
  no longer exist (moved, not copied), and `features/per-issue/step_definitions/` holds no other
  `feature-912.*` file.
- `features/regression/rate-limit/feature-912.feature` has exactly one tag line,
  `@regression @rate-limit-in-process-wait`. It contains no `@adw-` or `@promotion-suggested-*` tag at
  feature or scenario level. Its steps, tables, Examples and titles are byte-identical to the source.
- `features/regression/step_definitions/feature-912.steps.ts` keys both hooks on
  `@rate-limit-in-process-wait`. Its relative imports are unchanged, and the death branch restores
  `process.exit`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-912" --dry-run` selects 0 scenarios.
- `features/regression/vocabulary.md` has the `@rate-limit-in-process-wait` section:
  - G-RW1–G-RW10, W-RW1–W-RW4 and T-RW1–T-RW26, 40 rows;
  - each row has five columns, the Pattern `phase-import`, and an artefact assertion target;
  - G18, T1, T22, W16 and T34 are not re-registered.
- No undefined or ambiguous step is reported for the moved feature or anywhere in the `@regression` run.
- Prose matches the change:
  - the moved feature's description, the step file's header and feature-910's "AMENDED BY #912"
    paragraph name the new tag and path;
  - the README tree lists `rate-limit/`.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build` and
  `bun run test:unit` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `test ! -e features/per-issue/feature-912.feature && test ! -e features/per-issue/step_definitions/feature-912.steps.ts && ! ls features/per-issue/step_definitions/feature-912.* 2>/dev/null && echo MOVED-OK`:
  the sources are gone, and the command prints `MOVED-OK`.
- `test -f features/regression/rate-limit/feature-912.feature && test -f features/regression/step_definitions/feature-912.steps.ts && echo DEST-OK`:
  the files landed, and the command prints `DEST-OK`.
- `grep -nE '^\s*@' features/regression/rate-limit/feature-912.feature`: prints exactly
  `1:@regression @rate-limit-in-process-wait`.
- `grep -n "tags:" features/regression/step_definitions/feature-912.steps.ts`: two lines, both
  `@rate-limit-in-process-wait`, with no `@adw-`.
- `grep -cE '^\| [GWT]-RW[0-9]+ \|' features/regression/vocabulary.md`: prints `40`.
- `grep -E '^\| [GWT]-RW' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u`: prints
  only `7`. Every new row has exactly five columns.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-in-process-wait" --dry-run`: 28
  scenarios discovered, no undefined and no ambiguous steps.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-912" --dry-run`: 0 scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-in-process-wait"`: 28 scenarios, 28
  passed.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the full regression suite is
  green and includes the moved feature. This is the primary acceptance command, and it must report no
  ambiguous step.
- `bun run lint`: the linter passes.
- `bunx tsc --noEmit`: the root type-check passes, covering the moved step file.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run build`: the build succeeds.
- `bunx vitest run adws/core/__tests__/rateLimitWaitPolicy.test.ts adws/core/__tests__/phaseRunner.test.ts adws/promotion/__tests__/vocabularyParser.test.ts`:
  the owning unit tests pass.
- `bun run test:unit`: the unit suite passes with zero regressions.

## Notes
- **Coding guidelines.** Adhere to `.adw/coding_guidelines.md`. This change is mostly file moves and
  Markdown, and the TypeScript edits are four lines:
  - two hook tag strings;
  - one `process.exit` restore;
  - its one-line comment.

  Per the **Comments** guideline, the new comment states only the non-obvious reason. The edited header
  comment must not add issue-number citations.
- **`hitl` is set.** The resulting PR must be human-approved before merge. The `regression-promotion`
  label also makes the review phase post the non-blocking rot/reuse advisory comment
  (`executePromotionRotAdvisory`). That comment needs the promoted file to stay named
  `feature-912.feature` under `features/regression/`.
- **No new library** is required. The repository's install command, per `.adw/commands.md`, is
  `bun add <package>`.
- **Deliberately not changed:**
  - the 912 hooks' own `setupMockInfrastructure()`/`teardownMockInfrastructure()` calls, which are
    redundant beside the `@regression` hooks but idempotent;
  - the duplicate `setDefaultTimeout(60_000)`, which is the same value `hooks.ts` sets;
  - `features/per-issue/step_definitions/feature-959-world.ts`'s `not @adw-912` clause, which is inert
    after the move. feature-959 carries its own promotion marker and will be re-keyed if it is promoted;
  - the description's historical rationale, such as its notes on G5/T6, beyond the tag, scope, path and
    registry sentences in task 4.
- **Docs.** The document phase should reflect the promotion in the following places. The precedent
  promotions updated these in their document-agent commit, not the build commit.
  - `app_docs/feature-9gjajh-bdd-regression-suite.md`:
    - the "Maintain `features/regression/…`" list gains `rate-limit/`;
    - the promoted-features tag list gains `@rate-limit-in-process-wait` (`feature-912`);
    - the new vocabulary section gets a mention.
  - `.adw/conditional_docs.md` needs a condition for the promoted rate-limit wait scenario.
- **Worktree state at planning time.** `README.md` already showed an unrelated, uncommitted modification
  (`git status`: ` M README.md`), which re-lists split `adws/` unit-test files. This plan does not touch
  it beyond the single `rate-limit/` line. Whether those edits belong in this PR is for the human
  reviewer to decide.
- **Scorer limitation (out of scope).** `promotionScorer.matchPhrase` turns only `{string}` and `{int}`
  into wildcards and escapes everything else. Registered phrases that use cucumber optional text or
  alternation therefore never match a concrete step for scoring. Those are T-RW4 `time(s)`, T-RW16
  `comment(s) was/were`, and existing rows such as T-PQ10. This is a pre-existing limitation for a
  separate issue.
