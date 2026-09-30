# Feature: Promote the #910 pause-queue reset-time scenario into the @regression suite

## Metadata
issueNumber: `923`
adwId: `8d7505-feat-promote-910-sce`
issueJson: `{"number":923,"title":"feat: promote #910 scenario into the @regression suite","body":"Promotes: feature-910\n\nDirect relocation (matches #734 (score: 5)): move this scenario from the per-issue directory\n(input-only, never executed) into the executed `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-910.feature <!-- Consumed by scenario_writer. When set, the @regression sweep step is skipped. -->\nfeatures/regression/<subdir>/feature-910.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-910.steps.ts <!-- Consumed by scenario_writer. When set, the @regression sweep step is skipped. -->\nfeatures/regression/step_definitions/feature-910.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file (keep its existing tags for traceability).\n- Register the scenario's phrases in `<!-- Consumed by generate_step_definitions. When set, step phrases must be registered. -->\nfeatures/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-910.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-910.steps.ts`\n\n## Phrases to register\n\n- `a workflow for issue 910 is running its \"build\" phase for the target repository \"acme/widgets\"`\n- `the \"build\" phase is stopped by a rate-limit error carrying a \"seven_day\" limit that resets at \"2026-09-28T07:00:00Z\"`\n- `the workflow for issue 910 is recorded at workflow stage \"paused\"`\n- `the pause queue entry for issue 910 records the limit type \"seven_day\"`\n- `the pause queue entry for issue 910 records the reset time \"2026-09-28T07:00:00Z\"`\n- `the pause queue entry for issue 910 stores its reset time as an ISO 8601 timestamp`\n- `the \"build\" phase is stopped by a rate-limit error carrying a \"five_hour\" limit with no reset time`\n- `the pause queue entry for issue 910 records the limit type \"five_hour\"`\n- `the pause queue entry for issue 910 records no reset time`\n- `the \"build\" phase is stopped by a rate-limit error carrying no limit type and no reset time`\n- `the pause queue entry for issue 910 records no limit type`\n- `a pause-queue entry with a reset time of \"2026-09-22T12:50:00Z\" and 2 probe failures`\n- `the rate-limit probe classification is \"<verdict>\"`\n- `the pause-queue decider is consulted at \"2026-09-22T12:06:00Z\"`\n- `the pause-queue decider returns \"skip_before_reset\"`\n- `a pause-queue entry with <entry> and <failures> probe failures`\n- `the pause-queue decider is consulted at \"2026-09-22T12:51:00Z\"`\n- `the pause-queue decider returns \"<action>\"`\n- `a pause-queue entry with <entry> and 2 probe failures`\n- `the rate-limit probe classification is \"limited\" with a \"five_hour\" limit that resets at \"2026-09-22T17:50:00Z\"`\n- `the pause-queue decider returns \"refresh_reset\" with the reset time \"2026-09-22T17:50:00Z\"`\n- `the rate-limit probe classification is \"limited\"`\n- `the pause-queue decider neither resumes, strikes nor evicts the entry`\n- `the pause-queue decider sets no new reset time on the entry`\n- `the mock GitHub API is configured to accept issue comments`\n- `the cron host's clock reads \"2026-09-25T09:00:00Z\"`\n- `a workflow for issue 874 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the paused workflow for issue 874 was queued with a \"five_hour\" limit that resets at \"2026-09-25T12:50:00Z\"`\n- `a workflow for issue 875 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the paused workflow for issue 875 was queued with a \"seven_day\" limit that resets at \"2026-09-28T07:00:00Z\"`\n- `the Claude CLI answers the rate-limit probe with exit code 1 and stdout:`\n- `the pause-queue scanner runs 3 probe cycles`\n- `the scanner did not run the rate-limit probe`\n- `the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:`\n- `the pause queue entry for issue 874 records the reset time \"2026-09-25T12:50:00Z\"`\n- `the pause queue entry for issue 875 records the reset time \"2026-09-28T07:00:00Z\"`\n- `the mock harness recorded zero comment posts on issue 874`\n- `the mock harness recorded zero comment posts on issue 875`\n- `the cron host's clock reads \"2026-09-22T11:57:00Z\"`\n- `a workflow for issue 840 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the paused workflow for issue 840 was queued with a \"five_hour\" limit that resets at \"2026-09-22T12:50:00Z\"`\n- `the Claude CLI answers the rate-limit probe with exit code 1 and stderr:`\n- `the cron host's clock reads \"2026-09-22T12:06:00Z\"`\n- `the pause queue still holds the workflow for issue 840`\n- `the pause queue entry for issue 840 has not gained a probe failure`\n- `the mock harness recorded zero comment posts on issue 840`\n- `the cron host's clock reads \"2026-09-22T12:51:00Z\"`\n- `the Claude CLI answers the rate-limit probe with exit code 0 and stdout:`\n- `the pause-queue scanner runs 1 probe cycle`\n- `the scanner ran the rate-limit probe once per probe cycle`\n- `the paused workflow for issue 840 is relaunched under its original adwId`\n- `the pause queue no longer holds the workflow for issue 840`\n- `the mock GitHub API recorded a comment on issue 840`\n- `the paused workflow for issue 874 was queued with a \"seven_day\" limit that resets at \"2026-09-28T07:00:00Z\"`\n- `a workflow for issue 876 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the paused workflow for issue 876 is relaunched under its original adwId`\n- `the pause queue no longer holds the workflow for issue 876`\n- `the pause queue still holds the workflow for issue 874`\n- `the pause queue entry for issue 874 records the reset time \"2026-09-28T07:00:00Z\"`\n- `the cron host's clock reads \"2026-09-28T06:00:00Z\"`\n- `the paused workflow for issue 874 has already recorded 2 unknown probe failures`\n- `a workflow for issue 877 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the pause queue no longer holds the workflow for issue 877`\n- `the mock GitHub API recorded a comment on issue 877`\n- `the pause queue entry for issue 874 has not gained a probe failure`\n- `the pause queue still holds the workflow for issue 910`\n- `the pause queue entry for issue 910 has not gained a probe failure`\n- `the cron host's clock reads \"2026-09-28T07:01:00Z\"`\n- `the paused workflow for issue 910 is relaunched under its original adwId`\n- `the pause queue no longer holds the workflow for issue 910`\n- `the mock GitHub API recorded a comment on issue 910`\n- `the paused workflow for issue 875 was queued with a \"five_hour\" limit that resets at \"2026-09-22T12:50:00Z\"`\n- `the paused workflow for issue 875 has already recorded 2 unknown probe failures`\n- `the pause queue still holds the workflow for issue 875`\n- `the pause queue entry for issue 875 has not gained a probe failure`\n- `the pause queue entry for issue 875 records the reset time \"2026-09-22T17:50:00Z\"`\n- `the pause queue entry for issue 875 stores its reset time as an ISO 8601 timestamp`\n- `the cron host's clock reads \"2026-09-22T15:00:00Z\"`\n- `the cron host's clock reads \"2026-09-28T07:05:00Z\"`\n- `the paused workflow for issue 877 was queued with a \"seven_day\" limit that resets at \"2026-09-28T07:00:00Z\"`\n- `the pause-queue scanner runs 2 probe cycles`\n- `the pause queue entry for issue 877 records 2 probe failures`\n- `the mock harness recorded zero comment posts on issue 877`\n- `the workflow for issue 877 is recorded at workflow stage \"paused\"`\n- `the mock GitHub API recorded a comment containing the text \"## Retry\"`\n- `a workflow for issue 872 was paused in the rate-limit queue for the target repository \"acme/widgets\" by a release that recorded no reset time or limit type`\n- `the pause queue still holds the workflow for issue 872`\n- `the pause queue entry for issue 872 has not gained a probe failure`\n- `the pause queue entry for issue 872 records no reset time`\n- `the pause queue entry for issue 872 records no limit type`\n- `the mock harness recorded zero comment posts on issue 872`\n- `the paused workflow for issue 872 is relaunched under its original adwId`\n- `the pause queue no longer holds the workflow for issue 872`\n- `the mock GitHub API recorded a comment on issue 872`\n- `the ADW codebase is checked out`\n- `the ADW TypeScript type-check passes`\n- `the git/gh guard is run across the repository`\n- `the git/gh guard reports no violations`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-910.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-09-30T11:21:55Z","comments":[],"actionableComment":null}`

## Feature Description
Relocate the #910 BDD scenario out of the **input-only** `features/per-issue/` directory and into the
**executed** `@regression` suite. `feature-910.feature` is the behavioural contract of the pause
queue's reset-time wait:

- the real pause path records the rate limit's type and reset time (ISO 8601) on the queue entry,
  and invents neither when the error doesn't carry them;
- a pure decider gates every entry on its reset time;
- the scanner runs no probe while every entry is still before its reset time;
- only a confirmed non-rate-limit failure counts a strike;
- eviction leaves the workflow `paused` and names `## Retry` as the recovery.

It replays the 2026-09-22 #840 incident, in which a workflow was evicted 44 minutes before its
reported reset. It also drives the whole pause → wait → resume path end to end.

The file holds **34 scenarios**:

| Group | Scenarios |
|-------|-----------|
| §1 pause-path rows | 3 |
| §2 decider decision-table examples | 21 |
| §3 scanner rows (incl. the #840 replay and the end-to-end journey) | 5 |
| §4 limited-refresh row | 1 |
| §5 eviction row | 1 |
| §6 legacy-entry row | 1 |
| §7 backstops | 2 |

Every assertion targets a runtime artefact, and no scenario reads a source file. The promotion sweep
flagged it with score 5 (#734 precedent).

Unlike the two earlier promotions (#734/#729, #760/#537), `feature-910` is **not self-contained**:

1. Its step definitions import five helpers and one type from the sibling
   `./feature-902-queue.steps.ts`.
2. 10 of its 42 distinct step patterns, plus **all** of its mock-infrastructure `Before`/`After`
   hooks, live in the #902 pause-queue harness (`feature-902.steps.ts`, `feature-902-queue.steps.ts`).
   That covers the probe stub, the queue-file save/restore, the `gh` shadow, the `bunx` relaunch
   shadow, the seeded-entry map and the scanner step.
3. The per-issue `feature-911.steps.ts` imports two helpers from `./feature-910.steps.ts`.
4. Three of its phrases are **undefined today**: `the ADW TypeScript type-check passes` (T22) and the
   git/gh guard pair. Their only definitions were in `feature-504.steps.ts` and
   `feature-844.steps.ts`, which the 14-day per-issue sweep deleted (844 in commit `340aefe1`). The
   same T22 gap already leaves `features/regression/hashing/feature-537.feature` §8 undefined in
   today's `@regression` run.

So this promotion relocates the scenario **together with its step-definition dependency closure**,
without rewriting any moved file's imports. It also restores the three swept definitions once, in
the regression registry. No `adws/**` production code changes.

## User Story
As an **ADW maintainer**
I want **the #910 pause-queue reset-time contract to run on every `@regression` pass**
So that **a regression that re-introduces the #840 early eviction is caught automatically, and neither
the scenario nor the harness it runs on is silently deleted by the 14-day per-issue sweep.**

## Problem Statement
- `feature-910.feature` has no `@regression` tag, so `--tags "@regression"` never selects it. Its
  issue's PR #916 merged 2026-09-25, so the per-issue sweep deletes it (and `feature-910.steps.ts`)
  on or shortly after 2026-10-09.
- **The issue's literal recipe cannot work on its own.** Moving only `feature-910.steps.ts` leaves
  its `./feature-902-queue.steps.ts` import dangling. Cucumber then fails to load **all** support
  code and the entire run aborts. Rewriting that import to point back into `features/per-issue/`
  contradicts the issue ("do not rewrite the step-def files' relative imports") and leaves the
  promoted scenario depending on files the sweep will delete:
  - The sweep removes `feature-902.steps.ts` together with `feature-902.feature`.
  - Its sibling rule `startsWith('feature-902.')` does **not** match `feature-902-queue.steps.ts`.
    That file would be orphaned with its own dangling `./feature-902.steps.ts` import, crashing the
    whole run.
- `features/per-issue/step_definitions/feature-911.steps.ts` imports `./feature-910.steps.ts`, which
  breaks on the move.
- §7's two backstop scenarios contain three undefined steps. Until they are defined, `@regression`
  cannot be green. Current baseline: `53 scenarios (1 undefined, 42 pending, 10 passed)`. The 42
  pending are the pre-existing `ISSUE-3-CUTOVER` smoke/surface rows.

## Solution Statement
A **direct relocation of the scenario and its step-definition dependency closure**, following the
#734/#760 shape:

1. `git mv` the feature into a new subject subdirectory,
   `features/regression/pause-queue/feature-910.feature`. Prepend `@regression` to its feature-level
   tag line; nothing else in the file changes.
2. `git mv` `feature-910.steps.ts` **and** the harness it imports (`feature-902.steps.ts`,
   `feature-902-queue.steps.ts`) into the flat `features/regression/step_definitions/`. Both
   directories are three levels deep, so every import in the three moved files resolves unchanged
   and **no moved file's import is rewritten**:
   - `../../../adws/…` and `../../../test/mocks/…`
   - `../../regression/step_definitions/world.ts`
   - the sibling `./feature-902*.steps.ts` imports, which move together
3. Repoint the five sibling imports in the four per-issue step files that stay (907, 908,
   909-tooling, 911) to `../../regression/step_definitions/…`. Per-issue files already import
   `../../regression/step_definitions/world.ts` this way.
4. Restore the three swept definitions **once**, in the regression registry: a new
   `features/regression/step_definitions/codebaseBackstopSteps.ts` for T22 and the git/gh guard pair
   (new W16/T34), with the guard result held on `RegressionWorld`. This also fixes feature-537 §8's
   undefined T22. It fixes 14 more currently-undefined backstop steps across six per-issue features
   (`feature-902`, `907` ×1 each; `908`, `909`, `911`, `912` ×3 each). Together with feature-910's 3,
   that covers all 18 undefined steps in the suite.
5. Have the regression support own the suite's 60 s default step timeout. Today that default comes
   only from the per-issue `feature-912.steps.ts`, which the sweep deletes around 2026-10-09.
6. Register the phrases in `features/regression/vocabulary.md`:
   - 33 pause-queue phrase patterns in a new domain subsection;
   - W16/T34 in the main tables;
   - an amended T22 row.
7. Add one README tree line, then prove the result: 0 undefined / 0 ambiguous across the suite, the
   34 scenarios green under `@regression`, and no regression in the per-issue scenarios that share
   the harness.

**Why this is safe (verified during planning):**
- **Load-neutral, no new ambiguity.** `cucumber.js` imports both
  `features/regression/step_definitions/**` and `features/per-issue/step_definitions/**`. Each moved
  module is still evaluated exactly once, because per-issue importers resolve to the same module URL
  (the ESM cache). Today `feature-911` imports `./feature-910.steps.ts` the same way with 0
  ambiguous steps.
- **Hook compatibility.** `setupMockInfrastructure()` is idempotent and `teardownMockInfrastructure()`
  is unconditional and idempotent.
  - The moved harness now loads before `features/regression/support/hooks.ts`, so its `Before` runs
    first and the `@regression` `Before` reuses the running mock.
  - The `@regression` `After` runs first. It restores `PATH`, which also drops the `gh` shadow, and
    stops the mock server.
  - The harness's own `After` then does file/process cleanup that needs neither.
- **Hook-order change is benign.** `feature-910`'s hooks now register before `feature-907`'s and
  `feature-908`'s. This matters only for per-issue rows carrying several of those tags, and those
  hooks touch disjoint state:
  - 910: pinned clock, `bunx` intercept, decider world;
  - 907: console capture, `CLAUDE_CODE_PATH`;
  - 908: its own mock infra and queue save/restore.
  Task 11 re-proves this.
- **Checks still cover the moved code.** `adws/checkGitGhGuard.ts` exempts the whole `features/`
  tree, so moving step files cannot change guard results. The root `tsconfig.json` includes
  `**/*.ts`, so `bunx tsc --noEmit` type-checks every moved and repointed file.
- **Timing headroom.** The slowest promoted step, `the pause-queue scanner runs N probe cycle(s)`,
  measured 2.6 s max locally because it waits out the resume path's 2 s readiness window.

## Relevant Files
Use these files to implement the feature:

**Moved (`git mv`, content untouched except the one feature tag line):**
- `features/per-issue/feature-910.feature` → `features/regression/pause-queue/feature-910.feature`. The
  scenario file. Line 1 `@adw-910 @adw-6a1674-pause-queue-waits-fo` gains `@regression`. Its
  scenario-level `@adw-910`/`@adw-911`/`@adw-912` co-tags scope the harness hooks and must stay.
- `features/per-issue/step_definitions/feature-910.steps.ts` →
  `features/regression/step_definitions/feature-910.steps.ts`. 24 novel step patterns plus the
  `@adw-910 or @adw-911` `Before`/`After`. Imports `./feature-902-queue.steps.ts` and
  `../../../adws/…`.
- `features/per-issue/step_definitions/feature-902-queue.steps.ts` →
  `features/regression/step_definitions/feature-902-queue.steps.ts`. The queue harness:
  - G20 and 8 more pause-queue step patterns used by feature-910;
  - `BeforeAll`/`AfterAll` for the `gh` and `bunx` shadows;
  - `Before`/`After` tagged `(@adw-902 or @adw-907 or @adw-910 or @adw-911) and not @adw-908 and not @adw-812`
    (mock infra, queue save/restore, cleanup).

  It imports `./feature-902.steps.ts`, `../../regression/step_definitions/world.ts`,
  `../../../test/mocks/test-harness.ts` and `../../../adws/…`.
- `features/per-issue/step_definitions/feature-902.steps.ts` →
  `features/regression/step_definitions/feature-902.steps.ts`. The injected `probeStub` and
  `the Claude CLI answers the rate-limit probe with exit code {int} and {word}:`.

**Edited:**
- `features/per-issue/step_definitions/feature-907.steps.ts`: line 19 imports `./feature-902.steps.ts`;
  repoint it.
- `features/per-issue/step_definitions/feature-908.steps.ts`: line 35 imports
  `./feature-902-queue.steps.ts`; repoint it.
- `features/per-issue/step_definitions/feature-909-tooling.steps.ts`: line 26 imports
  `./feature-902.steps.ts`; repoint it. Line 25's `./feature-909.steps.ts` stays.
- `features/per-issue/step_definitions/feature-911.steps.ts`: lines 28 and 32 import
  `./feature-902-queue.steps.ts` and `./feature-910.steps.ts`; repoint them. `./realCronProcess.ts`
  stays.
- `features/regression/step_definitions/world.ts`: add a per-scenario `gitGhGuardRun` field to
  `RegressionWorld`.
- `features/regression/support/hooks.ts`: add `setDefaultTimeout(60_000)`.
- `features/regression/vocabulary.md`:
  - amend T22;
  - add W16 and T34;
  - add a new `## Given/When/Then — Pause Queue Reset-Time Wait (@adw-910)` subsection (33 rows).
- `README.md`: add one `features/regression/pause-queue/` line to the tree listing
  (lines ~1024–1033). Change nothing else.

**Read-only references:**
- `cucumber.js`: `paths` covers `features/regression/**/*.feature`; `import` covers the regression
  step defs and support, `features/step_definitions/**`, and the per-issue step defs. No edit needed.
- `adws/triggers/perIssueScenarioSweep.ts`: `RETENTION_DAYS = 14` and `defaultListStepDefSiblings`
  (`startsWith('feature-N.')`). This is why the harness must leave `features/per-issue/`.
- `test/mocks/test-harness.ts`: idempotent `setupMockInfrastructure` and unconditional, idempotent
  `teardownMockInfrastructure` (env and `PATH` restore). The basis of the hook-compatibility argument.
- `features/regression/support/hooks.ts`: the `@regression` mock lifecycle that now also wraps
  feature-910.
- `features/regression/step_definitions/thenSteps.ts`: T2, T3 and T14 are reused. The file is
  already 399 lines, over the 300-line guideline, which is why the restored steps get their own
  module.
- `features/regression/step_definitions/givenSteps.ts` (G1) and
  `features/step_definitions/ensureCronOnEveryEventSteps.ts` (G18): reused definitions.
- `adws/checkGitGhGuard.ts`: the guard the restored W16/T34 run. It exits 0/1 and exempts
  `features/` and `test/`.
- `tsconfig.json`: `"incremental": true`, so a plain `tsc --noEmit` writes a ~300 KB
  `tsconfig.tsbuildinfo` into the checkout. Verified during planning; the file is gitignored.
- `adws/core/pauseQueue.ts` (`PAUSE_QUEUE_PATH = 'agents/paused_queue.json'`, cwd-relative) and
  `adws/core/environment.ts` (`AGENTS_STATE_DIR = path.join(process.cwd(), 'agents')`): where the
  scenarios' runtime artefacts land. Relevant to the Docker-leg note.
- The system under test, **not modified**: `adws/triggers/pauseQueueDecider.ts`,
  `adws/triggers/pauseQueueScanner.ts`, `adws/triggers/pauseQueueResume.ts`,
  `adws/triggers/rateLimitProbe.ts`, `adws/core/phaseRunner.ts`.
- `features/regression/hashing/feature-537.feature`: its §8 uses T22 and is undefined today.
- `.github/workflows/regression.yml`, `test/docker-run.sh`, `test/Dockerfile`: the host leg (always
  `exit 0`) and the schedule/dispatch-only Docker leg (repo mounted `/workspace:ro`).
- `specs/issue-734-adw-ikwe55-feat-promote-729-adw-sdlc_planner-promote-729-regression-scenario.md`
  and
  `specs/issue-760-adw-6uaoda-feat-promote-537-sce-sdlc_planner-promote-537-hashcomputer-regression.md`:
  the direct-relocation precedent this plan extends.
- `.adw/commands.md` and `.adw/project.md`: validation commands and `## Unit Tests: enabled`.

### Relevant Documentation (matched via `.adw/conditional_docs.md`)
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: the manual direct-relocation recipe, the
  `@regression` hooks, the "scratch state under `os.tmpdir()`" and read-only Docker-leg contracts,
  and the "promoted scenario keeps its pre-promotion tags" gotcha.
- `app_docs/feature-9gjajh-bdd-per-issue.md`: owns `features/per-issue/**`, which covers the four
  repointed step files and the three files moved out.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: the 14-day per-issue scenario sweep and
  its sibling rule.
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: the system under test (pause-queue decider,
  scanner, resume's remove-before-spawn, rate-limit probe).
- `app_docs/feature-9gjajh-pause-and-auth-queues.md`: `pauseQueue.ts`, the state file the scenarios
  assert on.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md`: the scenario-authoring skip gate. A
  `regression-promotion` issue authors no `feature-923` scenario, so ADW's scenario-proof returns
  `undefined`. **This plan's Validation Commands are the proof.**
- `app_docs/feature-9gjajh-promotion-system.md`: the #734-shaped issue body (`promotionIssueBody.ts`)
  and the non-blocking rot/reuse advisory comment ADW posts on this PR.
- `app_docs/feature-9gjajh-root-config.md`: owns `README.md`.

### New Files
- `features/regression/pause-queue/`: a new subject subdirectory. The name is kebab-case per the
  coding guidelines, names the scenario's subject, and matches the branch name.
- `features/regression/step_definitions/codebaseBackstopSteps.ts`: restored definitions for
  `the ADW TypeScript type-check passes` (T22), `the git/gh guard is run across the repository` (W16)
  and `the git/gh guard reports no violations` (T34).
- Relocated paths (not new content): `features/regression/pause-queue/feature-910.feature` and
  `features/regression/step_definitions/feature-910.steps.ts`, `feature-902.steps.ts` and
  `feature-902-queue.steps.ts`.

## Implementation Plan
### Phase 1: Foundation
1. Record the pre-change baselines. The exact numbers are below, so the post-change delta can be
   judged precisely.
2. Relocate the feature file and the step-definition dependency closure with `git mv` (history
   preserved, imports untouched), then repoint the per-issue importers.
3. Prove the move is **load-neutral** before anything new is added: a whole-suite dry-run shows the
   same scenario/step counts, the same 18 undefined steps, 0 ambiguous, and no module-resolution
   error, and `tsc` passes.

### Phase 2: Core Implementation
Add the feature-level `@regression` tag. Restore the three swept step definitions in a focused
regression module, with guard state on the World. Make the regression support own the 60 s default
step timeout. Register the phrases in the vocabulary registry, reusing the seven already-registered
rows.

### Phase 3: Integration
1. Add the README tree line.
2. Prove the promoted scenarios green under `@regression`, the whole suite free of undefined and
   ambiguous steps, and the per-issue scenarios that share the relocated harness regression-free.
3. Run the full validation gate.
4. Commit only this feature's paths.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Record the pre-change baselines
- Run the whole-suite dry-run:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`
  - Expect `265 scenarios (13 undefined, 252 skipped)` and `1881 steps (18 undefined, 1863 skipped)`.
  - The 18 undefined steps are exactly T22 ×8, `the git/gh guard is run across the repository` ×5
    and `the git/gh guard reports no violations` ×5. Expect 0 ambiguous.
- Run `@regression`:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`
  - Expect `53 scenarios (1 undefined, 42 pending, 10 passed)` and
    `357 steps (1 undefined, 42 pending, 86 skipped, 228 passed)`.
- Run feature-910's own scenarios. Its workflow tag appears only in that file:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-6a1674-pause-queue-waits-fo" --format summary`
  - Expect `34 scenarios (2 undefined, 32 passed)` and `262 steps (3 undefined, 259 passed)`.
- Run the per-issue scenarios that share the harness:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902 or @adw-907 or @adw-908 or @adw-909 or @adw-911 or @adw-912" --format summary`
  - Expect `186 scenarios (10 undefined, 176 passed)` and `1282 steps (14 undefined, 1268 passed)`.
  - Takes ~50 s.
- If `dev` has moved and a baseline differs, re-derive the expected post-change numbers from the new
  baseline. The invariant is the delta:
  - +34 promoted scenarios in `@regression`, all passing;
  - every previously undefined backstop step now defined and passing;
  - nothing newly failed, undefined or ambiguous.

### 2. Relocate the feature file into a new `pause-queue/` subdirectory
- `mkdir -p features/regression/pause-queue`
- `git mv features/per-issue/feature-910.feature features/regression/pause-queue/feature-910.feature`
- Ignore the stray `<!-- Consumed by … -->` fragments inside the issue body's paths. The issue-body
  builder copied `.adw/scenarios.md` section bodies verbatim, HTML comments included. The real
  destinations are `features/regression/<subdir>/` and `features/regression/step_definitions/`.

### 3. Add the feature-level `@regression` tag
- In `features/regression/pause-queue/feature-910.feature`, change line 1:
  - from `@adw-910 @adw-6a1674-pause-queue-waits-fo`
  - to `@regression @adw-910 @adw-6a1674-pause-queue-waits-fo`
- Change nothing else in the file:
  - Keep every scenario-level tag line. `@adw-910`/`@adw-911` scope the harness hooks, and the
    `@adw-912` co-tags rely on `feature-912.steps.ts`'s `@adw-912 and not @adw-910` exclusion.
  - Keep the description and the `# ── §N` banners. This is a pure relocation; comment alignment is
    a separate chore, as `8cde1592` did for feature-537.
- Do **not** add `@regression` at scenario level; the feature-level tag is inherited.

### 4. Relocate the step definitions together with the pause-queue harness they import
- Run:
  - `git mv features/per-issue/step_definitions/feature-910.steps.ts features/regression/step_definitions/feature-910.steps.ts`
  - `git mv features/per-issue/step_definitions/feature-902-queue.steps.ts features/regression/step_definitions/feature-902-queue.steps.ts`
  - `git mv features/per-issue/step_definitions/feature-902.steps.ts features/regression/step_definitions/feature-902.steps.ts`
- Do **not** edit any line of these three files, imports included. All of their specifiers resolve
  unchanged from the new location:
  - `./feature-902-queue.steps.ts` and `./feature-902.steps.ts` (the siblings moved together);
  - `../../regression/step_definitions/world.ts` (still `features/regression/step_definitions/world.ts`);
  - `../../../test/mocks/test-harness.ts` and `../../../adws/…` (same depth).

  They use no file-relative paths at runtime. `feature-902-queue.steps.ts`'s `__dirname` is unused,
  and every artefact path comes from `process.cwd()` or `REPO_ROOT`.
- Keep the file names:
  - Renaming would force rewriting `feature-910.steps.ts`'s and `feature-902-queue.steps.ts`'s
    relative imports, which the issue forbids.
  - The names mirror the `feature-537.steps.ts`/`feature-729.steps.ts` precedent in the same
    directory.
  - `git log --follow` history stays intact.
- Move nothing else. `feature-907/908/909/909-tooling/911/912.steps.ts` and `realCronProcess.ts`
  belong to scenarios that are not being promoted.

### 5. Repoint the per-issue step files that import a relocated module
Change exactly these five import specifiers and nothing else:
- `features/per-issue/step_definitions/feature-907.steps.ts:19`:
  `'./feature-902.steps.ts'` → `'../../regression/step_definitions/feature-902.steps.ts'`
- `features/per-issue/step_definitions/feature-908.steps.ts:35`:
  `'./feature-902-queue.steps.ts'` → `'../../regression/step_definitions/feature-902-queue.steps.ts'`
- `features/per-issue/step_definitions/feature-909-tooling.steps.ts:26`:
  `'./feature-902.steps.ts'` → `'../../regression/step_definitions/feature-902.steps.ts'`.
  Leave line 25's `./feature-909.steps.ts` alone.
- `features/per-issue/step_definitions/feature-911.steps.ts:28`:
  `'./feature-902-queue.steps.ts'` → `'../../regression/step_definitions/feature-902-queue.steps.ts'`
- `features/per-issue/step_definitions/feature-911.steps.ts:32`:
  `'./feature-910.steps.ts'` → `'../../regression/step_definitions/feature-910.steps.ts'`.
  Leave `./realCronProcess.ts` alone.

Then:
- Verify that
  `grep -rnE "from '\./feature-(902|902-queue|910)\.steps\.ts'" features/per-issue/step_definitions/`
  prints nothing.
- Leave prose references to the moved file names as they are. That covers JSDoc in the per-issue
  step files, the per-issue `.feature` descriptions and the comment at
  `adws/agents/__tests__/agentProcessHandler.test.ts:38`. The names are unchanged, so the
  references are still accurate, and the per-issue files are swept soon anyway.

### 6. Prove the relocation is load-neutral before adding anything
- Re-run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`.
- Expect exactly the Task 1 dry-run numbers: 18 undefined steps, 0 ambiguous, no
  `ERR_MODULE_NOT_FOUND` or other load error.
- Run `bunx tsc --noEmit -p tsconfig.json --incremental false`. It must pass; the root tsconfig
  includes `features/**`.

### 7. Restore the three swept step definitions in the regression registry
- In `features/regression/step_definitions/world.ts`, add to `RegressionWorld`:
  `gitGhGuardRun?: { exitCode: number; output: string };`
  - It is per-scenario World state, so no reset hook is needed.
  - Add no JSDoc; the name says what it is.
- Create `features/regression/step_definitions/codebaseBackstopSteps.ts`, one small, focused module.
- Why a new module:
  - `thenSteps.ts` is already 399 lines;
  - the guard `When`/`Then` pair shares state and belongs together;
  - these are generic codebase backstops (T22 is used by 8 executed features, the guard pair by 5), so they
    belong in the regression registry, not in a per-issue file the sweep deletes.
- Shape:
  ```ts
  import { When, Then } from '@cucumber/cucumber';
  import { execFileSync } from 'child_process';
  import { dirname, resolve } from 'path';
  import { fileURLToPath } from 'url';
  import assert from 'assert';
  import type { RegressionWorld } from './world.ts';

  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

  interface ExecFailure { status?: number | null; stdout?: string; stderr?: string }

  function runAtRepoRoot(command: string, args: readonly string[]): { exitCode: number; output: string } {
    try {
      const stdout = execFileSync(command, args, {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 180_000,
        // The cucumber process runs under `--import tsx`; the child tools need none of it.
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      return { exitCode: 0, output: stdout };
    } catch (err) {
      const failure = err as ExecFailure;
      return { exitCode: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  }

  Then('the ADW TypeScript type-check passes', function () {
    // tsconfig.json sets `incremental`, which would write tsconfig.tsbuildinfo into the checkout — read-only in the Docker leg.
    const { exitCode, output } = runAtRepoRoot('bunx', ['tsc', '--noEmit', '--incremental', 'false']);
    assert.strictEqual(exitCode, 0, `Expected the ADW TypeScript type-check to pass. Output:\n${output}`);
  });

  // `/` is the Cucumber Expression alternation operator; the escape keeps "git/gh" literal.
  When('the git\\/gh guard is run across the repository', function (this: RegressionWorld) {
    this.gitGhGuardRun = runAtRepoRoot('bunx', ['tsx', 'adws/checkGitGhGuard.ts']);
  });

  Then('the git\\/gh guard reports no violations', function (this: RegressionWorld) {
    assert.ok(this.gitGhGuardRun, 'Expected the git/gh guard to have been run in this scenario');
    assert.strictEqual(this.gitGhGuardRun.exitCode, 0, `Expected the git/gh guard to report no violations. Output:\n${this.gitGhGuardRun.output}`);
  });
  ```
- **The `\\/` escape is mandatory.** An unescaped `git/gh` means "git" **or** "gh", so it would never
  match the literal Gherkin text. That is why Cucumber's own snippet for the undefined step is
  `'the git\\/gh guard …'`.
- **`--incremental false` is mandatory.** Verified during planning: a plain `bunx tsc --noEmit` writes
  `tsconfig.tsbuildinfo` into the repo root. That breaks the suite's "scratch state under
  `os.tmpdir()`" contract and fails on the Docker leg's read-only mount.
- Resolve `ROOT` from `import.meta.url` as `thenSteps.ts` does; never use `process.cwd()`.
- Comment only the two non-obvious points above, and cite no issue numbers (coding guidelines).
- Before creating the file, confirm that no loaded definition exists yet:
  `grep -rnE "type-check passes|gh guard" features --include='*.ts'` should find none. It matched
  nothing at planning time, and after this task it should match only `codebaseBackstopSteps.ts`.
  Task 1's dry-run already shows these phrases as undefined, never ambiguous.

### 8. Make the regression support own the suite's default step timeout
- In `features/regression/support/hooks.ts`, add `setDefaultTimeout` to the `@cucumber/cucumber`
  import and call `setDefaultTimeout(60_000);` at module scope.
- Add a one-line comment on why: pause-queue scenarios wait out the resume path's readiness window
  and poll up to 10 s for a relaunch, which is too long for the 5 s Cucumber default.
- Rationale:
  - The suite's effective 60 s default is set today only by the per-issue
    `feature-912.steps.ts` (`setDefaultTimeout(60_000)`), which the sweep deletes around 2026-10-09.
  - The value is the same, so nothing changes today (last call wins, both calls are 60 s).
  - Without it, the promoted scanner step (2.6 s max measured locally) and the relaunch assertion
    (polls up to 10 s) would run against a 5 s ceiling on slower CI runners.

### 9. Register the phrases in the vocabulary registry
Edit `features/regression/vocabulary.md`. Every row must assert a runtime artefact, never a
source-file property. Phrase text must match the step definition exactly, including `{int}`,
`{string}`, `{word}`, `probe cycle(s)` and `probe failure(s)`. The issue's ~100 "Phrases to
register" are literal instances of 42 patterns: 35 new ones below plus 7 already registered. Add one
row per pattern, never one row per literal.

- **Amend T22** in the Then table, keeping its number and phrase. The Semantics become: "Runs
  `bunx tsc --noEmit --incremental false` at the ADW repo root and asserts exit 0. Build info is
  disabled so the check writes nothing into the checkout, which is read-only in the Docker leg."
  Pattern stays `subprocess`; target stays `exit code`.
- **Append to the When table** (after W15; W12 is a deliberate gap):
  - `| W16 | \`the git/gh guard is run across the repository\` | Spawns \`bunx tsx adws/checkGitGhGuard.ts\` at the repo root and records its exit status and combined output on the World (the step definition escapes the slash, \`git\\/gh\`, because \`/\` is the Cucumber Expression alternation operator) | subprocess | exit code |`
- **Append to the Then table** (after T33):
  - `| T34 | \`the git/gh guard reports no violations\` | Asserts the exit status the guard run recorded is 0; the guard's output is the failure message | subprocess | exit code |`
- **Append a new subsection** at the end of the file, after the `@adw-537` subsection and a `---`
  separator, titled `## Given/When/Then — Pause Queue Reset-Time Wait (@adw-910)`. It mirrors the
  `@adw-537` subsection's layout.
  - **Intro paragraph.**
    - These phrases drive three things in-process (phase-import pattern): the real pause path
      (`runPhase` rejecting with a `RateLimitError`), the pure pause-queue decider
      (`decidePauseQueueAction`) and the real pause-queue scanner (`scanPauseQueue`).
    - The Claude CLI is replaced by an injected probe exec seam, and `gh` is shadowed on `PATH` with
      its comment posts replayed against the mock GitHub API. Relaunches are caught by a fixture
      orchestrator or a `bunx` shadow.
    - Every assertion targets a runtime artefact: the pause-queue state file
      (`agents/paused_queue.json`), the workflow's top-level state file (`agents/<adwId>/state.json`),
      the action the decider returns, the probe invocations recorded at the exec seam, the argv a
      relaunch records, or the requests the mock GitHub API recorded.
    - No step reads, greps or parses a source file.
    - The definitions live in `feature-910.steps.ts` and the pause-queue harness it builds on,
      `feature-902.steps.ts` and `feature-902-queue.steps.ts`.
  - **Table** (`| # | Phrase | Semantics | Pattern | Assertion target |`):

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
  - **Closing note.** This scenario also reuses seven already-registered phrases, so they get no new
    rows:
    - G1, G18 and G20. G20's definition now lives in the relocated `feature-902-queue.steps.ts`.
    - T2, T3, T14 and T22.

    The git/gh guard pair it uses is registered as W16/T34.
- Do **not** re-register G1, G18, G20, T2, T3, T14 or T22.
- Optionally run the advisory `/promote_regression_vocabulary` or the `promote-regression-vocabulary`
  skill over `features/regression/pause-queue/feature-910.feature` to cross-check reuse and rot
  verdicts. It writes nothing, and ADW also posts its rot/reuse advisory on the PR automatically.

### 10. Add the new subdirectory to the README tree listing
- In `README.md`'s `features/regression/` tree, insert one line between the `multilang/` and `smoke/`
  entries, matching the column alignment of its neighbours:
  `│   ├── pause-queue/    # Regression scenarios covering the pause queue's reset-time wait, decider, and eviction (#910)`
- Make no other README edits.

### 11. Prove the promoted scenarios green, the suite unambiguous, and the shared harness regression-free
- **Whole-suite dry-run:**
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`
  - Expect `265 scenarios (265 skipped)` and `1881 steps (1881 skipped)`: 0 undefined, 0 ambiguous,
    exit 0.
- **Promoted scenarios:**
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @adw-910" --format summary`
  - Expect `34 scenarios (34 passed)` and `262 steps (262 passed)`, exit 0.
  - Run it twice. The scanner rows use real timers and spawned fixture processes, and a flake must
    surface here rather than in CI.
- **Full `@regression` gate:**
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`
  - Expect `87 scenarios (42 pending, 45 passed)` and
    `619 steps (42 pending, 86 skipped, 491 passed)`: 0 failed, 0 undefined, 0 ambiguous.
  - feature-537 §8 now passes.
  - The run exits non-zero **only** because of the 42 pre-existing pending `ISSUE-3-CUTOVER` rows.
    Judge by the summary line, not the exit code.
- **Per-issue scenarios sharing the harness:**
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902 or @adw-907 or @adw-908 or @adw-909 or @adw-911 or @adw-912" --format summary`
  - Expect `186 scenarios (186 passed)` and `1282 steps (1282 passed)`.
  - The only change from Task 1 is that the 10 scenarios / 14 steps previously undefined now pass.
  - Any newly failed scenario means a repointed import or the hook order regressed. Stop and
    diagnose before continuing.
- Afterwards, `git status --porcelain` must show no new untracked artefacts; `agents/` is gitignored
  and the harness cleans it.

### 12. Confirm the old paths are gone and nothing dangles
- Old paths must be gone:
  `for p in features/per-issue/feature-910.feature features/per-issue/step_definitions/feature-910.steps.ts features/per-issue/step_definitions/feature-902.steps.ts features/per-issue/step_definitions/feature-902-queue.steps.ts; do test ! -e "$p" || echo "STILL PRESENT: $p"; done`
  prints nothing.
- New paths must exist:
  `test -e features/regression/pause-queue/feature-910.feature && test -e features/regression/step_definitions/feature-910.steps.ts && test -e features/regression/step_definitions/feature-902.steps.ts && test -e features/regression/step_definitions/feature-902-queue.steps.ts && test -e features/regression/step_definitions/codebaseBackstopSteps.ts && echo "NEW PATHS PRESENT"`
- The tag line must be correct:
  `head -1 features/regression/pause-queue/feature-910.feature | grep -qx '@regression @adw-910 @adw-6a1674-pause-queue-waits-fo' && echo "REGRESSION TAG PRESENT"`
- `git diff --cached -M --name-status` (after staging) must list the three step-def files as pure
  renames (`R100`) and the feature file as a rename (`R09x`, one changed line).

### 13. Keep the commit scoped
- Do **not** `git add -A`. The four `git mv` renames are already staged. Stage only these edited and
  new paths:
  - `features/per-issue/step_definitions/feature-907.steps.ts`,
    `features/per-issue/step_definitions/feature-908.steps.ts`,
    `features/per-issue/step_definitions/feature-909-tooling.steps.ts`,
    `features/per-issue/step_definitions/feature-911.steps.ts`
  - `features/regression/pause-queue/feature-910.feature` (the tag edit)
  - `features/regression/step_definitions/codebaseBackstopSteps.ts`,
    `features/regression/step_definitions/world.ts`
  - `features/regression/support/hooks.ts`, `features/regression/vocabulary.md`
  - `README.md` and this spec
- Confirm `git status --porcelain` shows nothing unintended. `tsconfig.tsbuildinfo`, `agents/` and
  `logs/` are gitignored.

### 14. Run the Validation Commands
- Execute every command in **Validation Commands** below and confirm each meets its stated
  expectation with zero regressions.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so this subsection is included. **No new unit
tests are warranted or created.**
- This change is a relocation of BDD test files, five import-specifier repoints, three restored BDD
  step definitions and a Markdown registry edit. It adds no production (`adws/**`) logic to
  unit-test.
- The coding guidelines name BDD scenarios as ADW's validation mechanism. The behavioural proof here
  is the `@regression` run (Task 11), which also exercises the restored steps through feature-537 §8,
  feature-910 §7, and the per-issue backstop rows.
- `bun run test:unit` must stay green as a regression guard. Vitest only collects
  `adws/**/__tests__/**/*.test.ts` and `test/mocks/__tests__/**/*.test.ts`, so moving files under
  `features/` cannot affect it.

### Edge Cases
- **Dangling sibling import aborts the whole run.** Any missed `./feature-90x.steps.ts` specifier makes
  Cucumber fail to load all support code. Guarded by the Task 5 grep, the Task 6 load-neutral
  dry-run, and `tsc` over `features/**`.
- **Double mock-infrastructure setup.** `@regression` plus `@adw-910` means two `Before` hooks call
  `setupMockInfrastructure()`. It is idempotent: the second call returns the running context.
  Teardown is also idempotent, and the `@regression` `After` running first is safe because the
  harness `After` only cleans up files and processes.
- **Hook registration order.** The harness modules now load in the regression glob, before
  `hooks.ts` and before `feature-907`/`908`/`911`. Rows carrying several of these tags see a changed
  but disjoint-state hook order. Task 11's per-issue run is the proof.
- **Ambiguity.** Moved modules are evaluated once (ESM cache), and the restored phrases have no
  other definition (Task 7 grep, Task 1 dry-run). Expect 0 ambiguous across all 265 scenarios.
- **Cucumber Expression alternation.** `/` in `git/gh` must be escaped (`git\\/gh`), or the step stays
  undefined.
- **Build-info write.** `tsc --noEmit` without `--incremental false` writes `tsconfig.tsbuildinfo`
  into the checkout. That is harmless on the host (gitignored) but fails on the read-only Docker
  mount.
- **Real timers.** The scanner rows wait out the resume path's 2 s readiness window (2.6 s max
  measured). The regression-owned 60 s default keeps this safe after `feature-912.steps.ts` is swept.
- **The five other `@adw-910` rows** (4 in `feature-902.feature`, 1 in `feature-907.feature`) stay
  per-issue and are **not** promoted. They keep running under the relocated harness and are covered
  by Task 11's per-issue run.
- **Legacy-shaped entry.** The §6 Given writes raw pre-#910 JSON, bypassing `appendToPauseQueue`.
  The relocation leaves this unchanged, so a write-path default still cannot mask a load regression.
- **Env restore quirk (pre-existing, not fixed here).** The harness `After` restores
  `GITHUB_APP_ID`/`SLUG`/`PRIVATE_KEY_PATH` by assignment. When a variable was originally unset, Node
  stores the string `"undefined"`. `@regression` scenarios that run after `pause-queue/` (smoke,
  surfaces, upgrade) don't read these variables: the smoke and surface rows stop at their pending
  When steps, and feature-729 only commits to a temp repo. Task 11 confirms this.
- **A `@promotion-suggested-<date>` stamp arriving from `dev`.** If the promotion sweep's stamp commit
  on `features/per-issue/feature-910.feature` lands on `dev` before this PR merges, git's rename
  detection carries it into the regression copy. Drop it there: that metadata only means something
  under `features/per-issue/`. Planning found no such stamp on `origin/dev` (`090a846d`).

## Acceptance Criteria
- **Feature file.** `features/regression/pause-queue/feature-910.feature` exists, its line 1 is
  exactly `@regression @adw-910 @adw-6a1674-pause-queue-waits-fo`, and the rest of the file is
  unchanged.
- **Step files.**
  - `features/regression/step_definitions/feature-910.steps.ts`, `feature-902.steps.ts` and
    `feature-902-queue.steps.ts` exist as pure renames (`R100`), with every import byte-identical.
  - No file under `features/per-issue/step_definitions/` imports them through a `./` sibling
    specifier.
- **Old paths.** `features/per-issue/feature-910.feature` and its step-def sibling
  `features/per-issue/step_definitions/feature-910.steps.ts` no longer exist, and neither do
  `features/per-issue/step_definitions/feature-902.steps.ts` and `feature-902-queue.steps.ts`.
- **`@regression` run.**
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` executes the 34 moved
    scenarios and all of them pass.
  - The suite reports `87 scenarios (42 pending, 45 passed)`, with 0 failed, 0 undefined and
    0 ambiguous. Only the 42 pre-existing `ISSUE-3-CUTOVER` pending rows remain, and feature-537 §8
    now passes.
- **No new ambiguity or undefined steps.** A whole-suite dry-run reports 0 undefined and 0 ambiguous
  steps across all 265 scenarios.
- **Per-issue scenarios on the harness.** `@adw-902 or @adw-907 or @adw-908 or @adw-909 or @adw-911 or @adw-912`
  reports `186 scenarios (186 passed)` with no newly failing scenario.
- **Vocabulary.** `features/regression/vocabulary.md` registers:
  - the 33 `G-PQ`/`W-PQ`/`T-PQ` patterns;
  - W16 and T34;
  - the amended T22.

  Every row has rubric-compliant, artefact-asserting semantics, and G1, G18, G20, T2, T3, T14 and T22
  are not duplicated.
- **README.** It gains exactly one `pause-queue/` tree line.
- **Gates.** `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`,
  `bun run test:unit`, `bun run build`, `bun run lint:git-guard` and `bun run lint:docs-index` all
  pass.
- **Governance.** The PR carries the `hitl` gate and merges only after human approval. Its
  description calls out that the closure relocation, the restored steps, and the timeout go beyond
  the issue's two-file recipe, and why.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `for p in features/per-issue/feature-910.feature features/per-issue/step_definitions/feature-910.steps.ts features/per-issue/step_definitions/feature-902.steps.ts features/per-issue/step_definitions/feature-902-queue.steps.ts; do test ! -e "$p" || echo "STILL PRESENT: $p"; done`:
  the old per-issue paths are gone. Expect no output.
- `test -e features/regression/pause-queue/feature-910.feature && test -e features/regression/step_definitions/feature-910.steps.ts && test -e features/regression/step_definitions/feature-902.steps.ts && test -e features/regression/step_definitions/feature-902-queue.steps.ts && test -e features/regression/step_definitions/codebaseBackstopSteps.ts && echo "NEW PATHS PRESENT"`:
  the relocation landed.
- `head -1 features/regression/pause-queue/feature-910.feature | grep -qx '@regression @adw-910 @adw-6a1674-pause-queue-waits-fo' && echo "REGRESSION TAG PRESENT"`:
  the feature-level tag is correct.
- `! grep -rnE "from '\./feature-(902|902-queue|910)\.steps\.ts'" features/per-issue/step_definitions/ && echo "NO DANGLING SIBLING IMPORTS"`:
  every per-issue importer is repointed.
- `grep -cE "^\| (G-PQ|W-PQ|T-PQ)[0-9]+ \|" features/regression/vocabulary.md`: the pause-queue
  rows are registered. Expect `33`.
- `grep -nE "^\| (W16|T34|T22) \|" features/regression/vocabulary.md`: the guard pair is registered
  and T22 amended. Expect 3 lines.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: expect
  `265 scenarios (265 skipped)` and `1881 steps (1881 skipped)` (0 undefined, 0 ambiguous), exit 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @adw-910" --format summary`:
  the promoted scenarios. Expect `34 scenarios (34 passed)` and `262 steps (262 passed)`, exit 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`: the full
  regression gate. Expect `87 scenarios (42 pending, 45 passed)` and
  `619 steps (42 pending, 86 skipped, 491 passed)`, with 0 failed, 0 undefined and 0 ambiguous.
  The exit code is non-zero only because of the 42 pre-existing pending rows.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902 or @adw-907 or @adw-908 or @adw-909 or @adw-911 or @adw-912" --format summary`:
  the per-issue scenarios sharing the relocated harness. Expect `186 scenarios (186 passed)` and
  `1282 steps (1282 passed)`.
- `bun run lint`: ESLint passes, covering the new `codebaseBackstopSteps.ts` and the repointed files.
- `bunx tsc --noEmit`: the root type-check passes (it includes `features/**`, so it covers every
  moved and repointed import).
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run test:unit`: the unit suite is green, zero regressions.
- `bun run build`: the build succeeds.
- `bun run lint:git-guard`: the git/gh guard is green. This is the same check the restored W16/T34
  steps drive.
- `bun run lint:docs-index`: the living-docs index stays clean. `features/per-issue/**` and
  `features/regression/**` ownership globs cover the moved files.
- `git status --porcelain`: only the intended paths are staged or modified.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) apply to the new and edited TypeScript:
  - files under 300 lines (the reason for the new `codebaseBackstopSteps.ts` rather than growing the
    399-line `thenSteps.ts`);
  - strict typing with no `any` (`ExecFailure` narrows the caught error);
  - comments only for the non-obvious (the `\\/` escape, `--incremental false`, the timeout), with no
    issue numbers and no section banners.

  The moved files are **not** reformatted, even though their JSDoc cites issue numbers: this is a
  relocation. A later comment-sweep chore can align them, as `8cde1592` did for feature-537.
- **No new libraries.** Were one needed, `.adw/commands.md`'s install command is `bun add <package>`.
- **This plan deliberately goes beyond the issue's two-file recipe, and the PR description must say
  so for the HITL reviewer.** The auto-generated issue (`adws/core/promotionIssueBody.ts`) assumes a
  self-contained feature + step-def pair, like #729 and #537. For feature-910 that assumption fails:
  - Its step file imports a per-issue sibling harness, which carries 10 of its step patterns and all
    of its hooks.
  - Another per-issue file imports it.
  - Three of its phrases have lost their definitions to the sweep.

  Relocating the closure is the only way to honour "do not rewrite the step-def files' relative
  imports" and still get a scenario that loads today and survives the sweep.
- **Docker leg (known limitation, not fixed here).**
  - 11 of the 34 promoted scenarios write the cwd-relative `agents/paused_queue.json` and
    `agents/<adwId>/state.json`, through the production constants `PAUSE_QUEUE_PATH` and
    `AGENTS_STATE_DIR`: §1 ×3, §3 ×5, §4, §5 and §6.
  - The Docker leg mounts the repo at `/workspace:ro`, so these are expected to fail there with
    EROFS. This could not be verified on the planning host, which has no Docker.
  - The other 23 pass there: the §2 decider rows are pure, and the §7 backstops write nothing thanks
    to `--incremental false`.
  - The Docker leg runs only on the daily schedule or `workflow_dispatch` and gates no PR. It is
    already red from the 42 pending rows (plus feature-537's undefined T22 until this lands).
  - Follow-up options:
    - make the agent-state root configurable, a production change;
    - or add a writable anonymous-volume overlay for `/workspace/agents` in `test/docker-run.sh`,
      mirroring the `node_modules` overlay. This amends the documented "node_modules is the only
      writable path under `/workspace`" contract and needs a Docker-capable host to verify.
- **Pre-existing sweep hazard to address separately, before ~2026-10-09.** The per-issue sweep only
  removes `features/per-issue/step_definitions/feature-N.*`, so helper files named `feature-N-*` are
  orphaned.
  - `feature-909-tooling.steps.ts` imports `./feature-909.steps.ts`. When #909 (merged 2026-09-25)
    is swept, that import dangles and **the entire Cucumber load fails, `@regression` included.**
  - This plan defuses the #902 instance of the same hazard by relocating `feature-902-queue.steps.ts`
    with its sibling, but not the #909 one.
  - Recommend a follow-up issue: widen `defaultListStepDefSiblings` in
    `adws/triggers/perIssueScenarioSweep.ts` to `feature-N-*`, or have the sweep refuse a removal
    that leaves a dangling import.
  - Also consider teaching the promotion issue builder to list a candidate's sibling-import closure.
    The same builder copies `.adw/scenarios.md` section bodies verbatim, which is how the
    `<!-- Consumed by … -->` fragments got into this issue's paths.
- **Run the pause-queue scenarios from a worktree or CI checkout, never from the main checkout that
  hosts the live cron.** This is pre-existing harness behaviour, but promotion puts it into routine
  `@regression` runs.
  - For each scenario the harness swaps out `<cwd>/agents/paused_queue.json` and restores it
    afterwards.
  - The end-to-end row's cleanup `pkill -f`s `<REPO_ROOT>/adws/<orchestrator script>`. In the main
    checkout that pattern also matches orchestrators the live pause-queue resume path spawned with
    the same absolute path.
  - ADW's own agents run in worktrees, and CI uses a fresh checkout, so neither is affected.
  - A follow-up could narrow that kill pattern to the scenario's adwId.
- **The document phase** should record in `app_docs/feature-9gjajh-bdd-regression-suite.md`:
  - the `pause-queue/` subdirectory;
  - that a promoted scenario's step-definition dependency closure is relocated with it;
  - `codebaseBackstopSteps.ts`;
  - that the regression support owns the default step timeout;
  - the Docker-leg limitation above.
- **Scale.** The `@regression` run grows from ~3 s to ~16 s locally (feature-910 took ~13 s), well
  inside the CI job's 15-minute timeout.
- **HITL gate.** The `hitl` label routes the PR through human approval. Nothing here bypasses that.
