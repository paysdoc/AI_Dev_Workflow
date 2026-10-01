# Feature: Promote the #911 pause-queue ownership scenario — with the step-definition harness it runs on — into the @regression suite

## Metadata
issueNumber: `924`
adwId: `r72d3j-feat-promote-911-sce`
issueJson: `{"number":924,"title":"feat: promote #911 scenario into the @regression suite","body":"Promotes: feature-911\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory\n(input-only, never executed) into the executed `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-911.feature <!-- Consumed by scenario_writer. When set, the @regression sweep step is skipped. -->\nfeatures/regression/<subdir>/feature-911.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-911.steps.ts <!-- Consumed by scenario_writer. When set, the @regression sweep step is skipped. -->\nfeatures/regression/step_definitions/feature-911.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file (keep its existing tags for traceability).\n- Register the scenario's phrases in `<!-- Consumed by generate_step_definitions. When set, step phrases must be registered. -->\nfeatures/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-911.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-911.steps.ts`\n\n## Phrases to register\n\n- `a pause-queue entry recorded for the target repository \"acme/widgets\", with <reset> and <failures> probe failures`\n- `the rate-limit probe classification is <probe>`\n- `the pause-queue decider is consulted at \"2026-09-22T12:51:00Z\" by the cron polling the target repository \"acme/widgets\"`\n- `the pause-queue decider returns \"<action>\"`\n- `a pause-queue entry recorded for the target repository \"acme/widgets\", with <reset> and 2 probe failures`\n- `the pause-queue decider is consulted at \"2026-09-22T12:51:00Z\" by <cron>`\n- `the pause-queue decider returns \"skip_not_owner\"`\n- `a pause-queue entry recorded for no target repository, with <reset> and <failures> probe failures`\n- `the rate-limit probe classification is \"<verdict>\"`\n- `a pause-queue entry recorded for the target repository \"<entry target>\", with no reset time and 0 probe failures`\n- `the rate-limit probe classification is \"clear\"`\n- `the pause-queue decider is consulted at \"2026-09-22T12:51:00Z\" by the self-host cron on a host checked out at \"acme/adw-host\"`\n- `the mock GitHub API is configured to accept issue comments`\n- `a workflow for issue 874 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the paused workflow for issue 874 has already recorded 2 unknown probe failures`\n- `the paused workflow for issue 874 was last probed at \"2026-09-25T08:40:00Z\"`\n- `a workflow for issue 877 is paused in the rate-limit queue for the target repository \"acme/gadgets\"`\n- `the Claude CLI answers the rate-limit probe with exit code 1 and stdout:`\n- `the pause-queue scanner of the cron polling the target repository \"acme/gadgets\" runs 1 probe cycle`\n- `the pause queue entry for issue 877 records 1 probe failure`\n- `the pause queue still holds the workflow for issue 874`\n- `the pause queue entry for issue 874 has not gained a probe failure`\n- `the pause queue entry for issue 874 still records its last probe at \"2026-09-25T08:40:00Z\"`\n- `the mock harness recorded zero comment posts on issue 874`\n- `the pause-queue scanner of the cron polling the target repository \"acme/widgets\" runs 1 probe cycle`\n- `the pause queue no longer holds the workflow for issue 874`\n- `the mock GitHub API recorded a comment on issue 874`\n- `a workflow for issue 875 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `a workflow for issue 876 is paused in the rate-limit queue for the target repository \"acme/gadgets\"`\n- `the Claude CLI answers the rate-limit probe with exit code 0 and stdout:`\n- `the paused workflow for issue 876 is relaunched under its original adwId`\n- `the paused workflow for issue 876 is relaunched with the target repository \"acme/gadgets\"`\n- `the resumed comment is recorded on issue 876 in the target repository \"acme/gadgets\"`\n- `the pause queue still holds the workflow for issue 875`\n- `the paused workflow for issue 875 has not been relaunched`\n- `the mock harness recorded zero comment posts on issue 875`\n- `the paused workflow for issue 875 is relaunched under its original adwId`\n- `the paused workflow for issue 875 is relaunched with the target repository \"acme/widgets\"`\n- `the resumed comment is recorded on issue 875 in the target repository \"acme/widgets\"`\n- `the pause queue no longer holds the workflow for issue 875`\n- `the paused workflow for issue 876 has been relaunched 1 time`\n- `the cron host's clock reads \"2026-09-22T12:51:00Z\"`\n- `a workflow for issue 871 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the paused workflow for issue 871 was queued with a \"five_hour\" limit that resets at \"2026-09-22T12:50:00Z\"`\n- `the paused workflow for issue 871 was last probed at \"2026-09-22T12:45:00Z\"`\n- `a workflow for issue 872 is paused in the rate-limit queue for the target repository \"acme/gadgets\"`\n- `the pause queue entry for issue 872 records the reset time \"2026-09-22T17:50:00Z\"`\n- `the pause queue entry for issue 871 records the reset time \"2026-09-22T12:50:00Z\"`\n- `the pause queue entry for issue 871 still records its last probe at \"2026-09-22T12:45:00Z\"`\n- `the mock harness recorded zero comment posts on issue 871`\n- `the pause queue entry for issue 871 records the reset time \"2026-09-22T17:50:00Z\"`\n- `the pause queue entry for issue 871 has not gained a probe failure`\n- `the cron host's clock reads \"2026-09-25T09:00:00Z\"`\n- `the paused workflow for issue 874 was queued with a \"seven_day\" limit that resets at \"2026-09-28T07:00:00Z\"`\n- `the pause-queue scanner of the cron polling the target repository \"acme/widgets\" runs 3 probe cycles`\n- `the scanner did not run the rate-limit probe`\n- `the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:`\n- `the scanner ran the rate-limit probe once per probe cycle`\n- `the pause queue entry for issue 874 records the reset time \"2026-09-28T07:00:00Z\"`\n- `a workflow for issue 840 is paused in the rate-limit queue for the target repository \"acme/adw-host\"`\n- `the Claude CLI answers the rate-limit probe with exit code 1 and stderr:`\n- `the pause-queue scanner of the cron polling the target repository \"acme/platform\" runs 1 probe cycle`\n- `the pause-queue scanner of the self-host cron on a host checked out at \"acme/adw-host\" runs 1 probe cycle`\n- `the pause queue entry for issue 840 records 1 probe failure`\n- `the pause-queue scanner of the cron polling the target repository \"acme/platform\" runs 3 probe cycles`\n- `the mock harness recorded zero comment posts on issue 840`\n- `the pause-queue scanner of the self-host cron on a host checked out at \"acme/adw-host\" runs 2 probe cycles`\n- `the pause queue no longer holds the workflow for issue 840`\n- `the mock GitHub API recorded a comment on issue 840`\n- `a workflow for issue 878 is paused in the rate-limit queue with no target repository`\n- `the paused workflow for issue 878 was last probed at \"2026-09-25T08:40:00Z\"`\n- `the pause queue still holds the workflow for issue 878`\n- `the pause queue entry for issue 878 has not gained a probe failure`\n- `the pause queue entry for issue 878 still records its last probe at \"2026-09-25T08:40:00Z\"`\n- `the pause queue entry for issue 878 records 1 probe failure`\n- `the pause queue no longer held the workflow for issue 871 when its orchestrator was spawned`\n- `the paused workflow for issue 871 is relaunched under its original adwId`\n- `the paused workflow for issue 871 is relaunched with the target repository \"acme/widgets\"`\n- `the pause queue no longer holds the workflow for issue 871`\n- `the resumed comment is recorded on issue 871 in the target repository \"acme/widgets\"`\n- `a workflow for issue 872 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the pause-queue scanner of the cron polling the target repository \"acme/widgets\" runs two overlapping probe cycles, the second starting while the first cycle's relaunch of issue 872 is still inside its readiness window`\n- `the paused workflow for issue 872 has been relaunched 1 time`\n- `the pause queue no longer holds the workflow for issue 872`\n- `a workflow for issue 873 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the paused workflow for issue 873 was queued with a \"five_hour\" limit that resets at \"2026-09-22T12:50:00Z\"`\n- `the orchestrator of the paused workflow for issue 873 exits as soon as it starts on its first launch`\n- `the pause queue no longer held the workflow for issue 873 when its orchestrator was spawned`\n- `the paused workflow for issue 873 has been relaunched 1 time`\n- `the pause queue still holds the workflow for issue 873`\n- `the pause queue entry for issue 873 records 1 probe failure`\n- `the pause queue entry for issue 873 still records the target repository \"acme/widgets\"`\n- `the pause queue entry for issue 873 records the reset time \"2026-09-22T12:50:00Z\"`\n- `the pause queue entry for issue 873 records the limit type \"five_hour\"`\n- `the mock harness recorded zero comment posts on issue 873`\n- `the paused workflow for issue 873 has been relaunched 2 times`\n- `the pause queue no longer holds the workflow for issue 873`\n- `the resumed comment is recorded on issue 873 in the target repository \"acme/widgets\"`\n- `another live process holds the spawn lock for issue 874 in the repository \"acme/widgets\"`\n- `the paused workflow for issue 874 has not been relaunched`\n- `the process holding the spawn lock for issue 874 in the repository \"acme/widgets\" exits`\n- `the paused workflow for issue 874 is relaunched under its original adwId`\n- `the rate-limit probe reports the limit has cleared`\n- `a cron trigger process launched with --target-repo \"acme/widgets\" completes its first probing poll tick`\n- `the pause queue still holds the workflow for issue 872`\n- `the pause queue entry for issue 872 has not gained a probe failure`\n- `the paused workflow for issue 872 has not been relaunched`\n- `the mock harness recorded zero comment posts on issue 872`\n- `the ADW TypeScript type-check passes`\n- `the git/gh guard is run across the repository`\n- `the git/gh guard reports no violations`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-911.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-09-30T11:22:03Z","comments":[],"actionableComment":null}`

## Feature Description
Relocate `feature-911`, the BDD contract for per-repo pause-queue ownership and remove-before-spawn
resume, out of the input-only `features/per-issue/` tree and into the executed `@regression` suite.
Its outlines expand to 35 scenarios:
- §1: the pure decider's ownership rule.
- §2: each cron acts only on its own entries, including the 2026-09-22 incident replay.
- §3: the entry leaves the queue before the orchestrator is spawned, and a failed spawn re-queues
  it with one more strike.
- §4: a real `trigger_cron.ts --target-repo` process.
- §5: the type-check and git/gh-guard backstops.

The scenario is rot-compliant: every assertion reads a runtime artefact (the decider's returned
action, `agents/paused_queue.json`, fixture launch logs, recorded probe calls, recorded mock-API
comments), never a source file. The promotion sweep scored it for promotion (score 3, #734
precedent).

Unlike the #537 and #729 promotions, this is **not** a two-file move. `feature-911.steps.ts` does
not own most of what its scenarios run on:
- It imports three sibling per-issue modules (`./feature-902-queue.steps.ts`,
  `./feature-910.steps.ts`, `./realCronProcess.ts`).
- Its scenarios resolve 25 of their step patterns, and all of their mock-infrastructure, `gh`
  shadow, queue save/restore and decider-world `Before`/`After` hooks, from `feature-902.steps.ts`,
  `feature-902-queue.steps.ts`, `feature-910.steps.ts` and `feature-908.steps.ts`. All four are
  per-issue files that the 14-day sweep deletes.
- Three of its steps (`the ADW TypeScript type-check passes` (T22) and the git/gh guard pair) have
  had **no definition at all** since the 2026-09-26 sweep deleted `feature-844.steps.ts`.

This plan therefore promotes the scenario **together with the harness it runs on**:
- The feature file and the five step-definition modules it depends on move into the regression
  tree, keeping every relative import byte-identical.
- The one registered phrase still living in a sweepable file (T25) is re-homed into the generic
  regression registry.
- The three orphaned backstop steps are restored there.
- All of the scenario's novel phrases are registered in `features/regression/vocabulary.md`.

No `adws/**` source changes.

## User Story
As an **ADW framework maintainer**
I want **the #911 per-repo pause-queue ownership and remove-before-spawn contract to run on every
`@regression` pass, on step definitions that live in the regression tree**
So that **a regression that lets one cron strike, evict or resume another repository's paused
workflow, or that reintroduces the duplicate relaunch inside the readiness window, is caught
automatically, and neither the scenario nor the harness it depends on can be deleted by the
per-issue sweep.**

## Problem Statement
1. **Never executed, and on the deletion path.** `feature-911.feature` carries no `@regression`
   tag, so the regression gate (`--tags "@regression"`) never selects it. The per-issue sweep will
   delete it 14 days after #911's PR merged (2026-09-27).
2. **A two-file `git mv` does not load.** From `features/regression/step_definitions/`, the step
   file's three `./…` sibling imports would not resolve. Cucumber would then fail to load its
   support code and abort every run, regression and per-issue alike.
3. **Its dependencies are sweepable.** `perIssueScenarioSweep.ts` deletes
   `features/per-issue/step_definitions/feature-N.*` alongside each stale `feature-N.feature`.
   #902, #907, #908, #909, #910 and #912 all merged on 2026-09-25, so any sweep from **2026-10-09**
   onwards deletes `feature-902.steps.ts`, `feature-908.steps.ts` and `feature-910.steps.ts`. That
   would leave a promoted scenario with broken imports and undefined steps. `feature-902-queue.steps.ts`
   is not matched by the sweep (`feature-902-` ≠ `feature-902.`), but it imports
   `./feature-902.steps.ts`, so it would be left with a broken import.
4. **Three steps are already undefined.** T22 (`the ADW TypeScript type-check passes`), `the git/gh
   guard is run across the repository` and `the git/gh guard reports no violations` lived only in
   `feature-844.steps.ts`. The sweep commit `340aefe1` deleted it on 2026-09-26, and the #911 merge
   (`a86d6828`) restored other swept step files but not this one. Measured on this branch:
   - feature-911's two §5 scenarios are undefined.
   - The existing `@regression` suite's `feature-537` §8 is undefined: `53 scenarios (1 undefined,
     42 pending, 10 passed)`.
   - The whole tree has 13 undefined scenarios and 18 undefined steps.
5. **The issue text needs interpretation.**
   - "Do not rewrite the step-def files' relative imports" is boilerplate from `buildPromotionIssue`
     (`adws/core/promotionIssueBody.ts`). It assumes step files that only import the
     depth-invariant `../../../adws/…`.
   - The issue body's destination paths are garbled: the HTML comments in `.adw/scenarios.md` leak
     through the promotion sweep's `scenariosConfig`. The intended destinations are
     `features/regression/<subdir>/feature-911.feature`,
     `features/regression/step_definitions/feature-911.steps.ts` and
     `features/regression/vocabulary.md`.

## Solution Statement
A **direct relocation, widened to the scenario's dependency closure**, done by hand (the #734
shape; no `adws/promotion/` automation):

1. **Move the feature.** `git mv` it to `features/regression/pause-queue/feature-911.feature`.
   `pause-queue` is a new kebab-case subject subdirectory, alongside `hashing/` and `upgrade/`.
   Prepend `@regression` to its feature-level tag line and keep `@adw-911
   @adw-gtxas1-per-repo-ownership-o`: every hook the scenario needs is keyed on `@adw-911`.
2. **Move the step file and everything it imports** into the flat
   `features/regression/step_definitions/` directory, contents untouched:
   - `feature-911.steps.ts`
   - its three siblings: `feature-902-queue.steps.ts`, `feature-910.steps.ts`, `realCronProcess.ts`
   - `feature-902.steps.ts`, which `feature-902-queue.steps.ts` imports

   Both directories are three levels deep and the sibling modules travel together, so every
   relative import in every moved file resolves to the same target. The one cross-tree import,
   `../../regression/step_definitions/world.ts`, resolves to the sibling `world.ts`. The issue's
   "do not rewrite the step-def files' relative imports" therefore holds for every promoted file.
3. **Re-point the three per-issue consumers** of the moved modules. Each gets a one-specifier import
   edit: `feature-907.steps.ts` and `feature-909-tooling.steps.ts` import `feature-902.steps.ts`,
   and `feature-908.steps.ts` imports `feature-902-queue.steps.ts`. These are not promoted files.
   They must follow the modules they import, or the whole cucumber load breaks.
4. **Re-home T25** (`the resumed comment is recorded on issue {int} in the target repository
   {string}`, already registered) from `feature-908.steps.ts` into the generic
   `features/regression/step_definitions/thenSteps.ts`. Move it verbatim; don't copy it, which
   would make it ambiguous.
5. **Restore the three orphaned backstops** in the generic registries, porting the deleted
   implementation (`git show 340aefe1^:features/per-issue/step_definitions/feature-844.steps.ts`):
   - W16 `the git/gh guard is run across the repository` in `whenSteps.ts`
   - T22 and T34 `the git/gh guard reports no violations` in `thenSteps.ts`
   - the guard result stored on the per-scenario `RegressionWorld`
6. **Register the vocabulary.**
   - W16 and T34 go in the generic When/Then tables.
   - A new `@adw-911` domain section holds the 36 novel pause-queue phrase patterns.
   - A reuse note covers the eight already-registered phrases: G1, G18, G20, G22, T2, T14, T22, T25.
7. **Add one README tree line** for `features/regression/pause-queue/`, then prove it all green.

**Verified during planning.** The plan was prototyped in a throwaway `git worktree`, which was then
removed.
- Full-tree dry-run: `265 scenarios (265 skipped)`, meaning 0 undefined and 0 ambiguous. Baseline:
  13 undefined.
- `--tags "@regression"`: `88 scenarios (42 pending, 46 passed)`, with 0 failed, 0 undefined and 0
  ambiguous.
  - The 46 passes include all 35 feature-911 scenarios and all 8 feature-537 scenarios (§8
    included).
  - The 42 pending are the pre-existing, deliberate `return 'pending'` stubs of W1/W9/W10 in
    `whenSteps.ts`, unchanged from baseline.
- `--tags "@adw-902 or @adw-907 or @adw-908 or @adw-909 or @adw-910 or @adw-912"`: `160 scenarios
  (160 passed)`.
- `bunx tsc --noEmit` and ESLint on the touched files were clean, and no test processes leaked.
- Baseline gates on this branch are green: `bun run lint`, `bunx tsc --noEmit -p
  adws/tsconfig.json`, `bun run lint:git-guard`, and `bun run test:unit` (155/155 files).

**Why the `@regression` hooks are safe.** Once tagged `@regression`, feature-911 is wrapped by both
the suite's `@regression` hooks (`features/regression/support/hooks.ts`) and the moved 902-queue
hooks. Both call `setupMockInfrastructure`/`teardownMockInfrastructure` from
`test/mocks/test-harness.ts`, and both functions are idempotent: a second setup returns the live
context and a second teardown is a no-op. The double wrapping is therefore benign, which the green
run confirmed.

## Relevant Files
Use these files to implement the feature:

- `features/per-issue/feature-911.feature`: **source** feature. `git mv` it to
  `features/regression/pause-queue/feature-911.feature`; the only content change is prepending
  `@regression` to line 1.
- `features/per-issue/step_definitions/feature-911.steps.ts`: **source** step file (14 step
  patterns, `@adw-911` hooks, the spawn seam, the real cron). `git mv` it, contents untouched.
- `features/per-issue/step_definitions/feature-902-queue.steps.ts`: the shared pause-queue harness.
  - 14 step patterns feature-911 uses.
  - `BeforeAll`/`AfterAll` for the `gh`/`bunx` shadows.
  - The `(@adw-902 or @adw-907 or @adw-910 or @adw-911) and not @adw-908 and not @adw-812`
    `Before`/`After` that set up mock infrastructure, the `gh` shadow and queue save/restore.
  - The exports feature-911 imports: `seedPausedWorkflow`, `getSeededEntry`, `scanningCronFor`,
    `runOneProbeCycle`, `runTrackedProbeCycles`, `replayGhCommentLog`.

  `git mv` it, contents untouched.
- `features/per-issue/step_definitions/feature-902.steps.ts`: the probe exec stub (`probeStub`,
  imported by 902-queue, 907 and 909-tooling), the probe-state `Before`, and `the Claude CLI answers
  the rate-limit probe with exit code {int} and {word}:`. `git mv` it, contents untouched.
- `features/per-issue/step_definitions/feature-910.steps.ts`: the decider world and its `@adw-910 or
  @adw-911` hooks, 9 step patterns feature-911 uses, and the exported
  `setDeciderEntryForScanningCronTest`/`consultDeciderWithScanningCron`. `git mv` it, contents
  untouched.
- `features/per-issue/step_definitions/realCronProcess.ts`: the real `trigger_cron.ts --target-repo`
  launcher. Its `REPO_ROOT = path.resolve(__dirname, '../../..')` is depth-invariant. `git mv` it,
  contents untouched.
- `features/per-issue/step_definitions/feature-907.steps.ts`: consumer of `./feature-902.steps.ts`;
  one import specifier re-pointed.
- `features/per-issue/step_definitions/feature-909-tooling.steps.ts`: consumer of
  `./feature-902.steps.ts`; one import specifier re-pointed.
- `features/per-issue/step_definitions/feature-908.steps.ts`: consumer of
  `./feature-902-queue.steps.ts`, with one import specifier re-pointed. It also currently defines
  T25, which is **removed** here and re-homed.
- `features/regression/step_definitions/thenSteps.ts`: generic Then registry (T1–T33). Gains T25
  (moved verbatim), T22 and T34.
- `features/regression/step_definitions/whenSteps.ts`: generic When registry (W1–W15). Gains W16.
- `features/regression/step_definitions/world.ts`: `RegressionWorld`. Gains an optional,
  per-scenario git/gh guard result, so T34 can never pass on a previous scenario's run.
- `features/regression/vocabulary.md`: the phrase registry and Rot-Detection Rubric. Register W16,
  T34 and the 36-row pause-queue section.
- `README.md`: the `features/` directory tree (around line 1024) gains a `pause-queue/` entry, as
  `hashing/` (#537) and `upgrade/` (#729) did.
- `cucumber.js`: **read-only**. It loads `features/regression/step_definitions/**/*.ts`, then
  `features/regression/support/**/*.ts`, then `features/step_definitions/**/*.ts`, then
  `features/per-issue/step_definitions/**/*.ts`. The loading is unconditional, so a moved file is
  still loaded exactly once, and registration order decides hook order. No edit needed.
- `features/regression/support/hooks.ts`: **read-only**. The `@regression` `Before`/`After`, which
  now also wrap feature-911.
- `test/mocks/test-harness.ts`: **read-only**. Idempotent `setupMockInfrastructure` and
  `teardownMockInfrastructure`, which is what makes the double hook wrapping safe.
- `adws/triggers/perIssueScenarioSweep.ts`: **read-only**. It matches siblings with
  `startsWith('feature-N.')` (line 96), which is why the harness must leave `features/per-issue/`.
- `adws/core/promotionIssueBody.ts` and `adws/triggers/promotionSweepDefaults.ts`: **read-only**.
  They are the source of the boilerplate import instruction and the garbled destination paths.
- `adws/checkGitGhGuard.ts`: **read-only**. The guard W16 runs as a subprocess.
- `features/step_definitions/ensureCronOnEveryEventSteps.ts`: **read-only**. It defines G18 (`the ADW
  codebase is checked out`, the Background step) in the shared, non-swept tree.
- `features/regression/step_definitions/givenSteps.ts`: **read-only**. It already defines G1, used
  by the scenario.
- `.adw/scenarios.md`, `.adw/commands.md`, `.adw/project.md`: **read-only**. Scenario layout,
  validation commands, and `## Unit Tests: enabled`.
- `test/docker-run.sh` and `.github/workflows/regression.yml`: **read-only**. Context for the
  Docker-leg limitation in Notes.

### Relevant Documentation (matched via `.adw/conditional_docs.md`)
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: matches "manually promoting a
  `features/per-issue/` scenario into `features/regression/`". It sets the regression-suite
  contracts: every phrase used by a regression scenario must be in `vocabulary.md`, promoted
  step-def files sit flat in `step_definitions/`, the Docker leg is read-only, and scratch state
  lives in `os.tmpdir()`.
- `app_docs/feature-9gjajh-bdd-per-issue.md`: owns `features/per-issue/**`, including the sweep's
  removal of feature files and their step-def siblings.
- `app_docs/feature-9gjajh-promotion-system.md`: the #734-shaped promotion issue; why a promotion
  issue authors no `@adw-924` scenario of its own; the advisory rot/reuse PR comment.
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: the decider (`skip_not_owner` evaluated
  first), the scanner's probe gate, and `resumeWorkflow`'s remove-before-spawn. Use it to word the
  vocabulary rows precisely.
- `app_docs/feature-9gjajh-pause-and-auth-queues.md`: the pause queue (`agents/paused_queue.json`)
  the scenario asserts against.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: owns `perIssueScenarioSweep.ts`,
  whose sibling-matching behaviour motivates co-moving the harness.

### New Files
No new *source* files: every added step definition goes into an existing regression registry. The
change creates one directory and six relocated paths (renames that keep history):
- `features/regression/pause-queue/`: **new** subject subdirectory.
- `features/regression/pause-queue/feature-911.feature` (from `features/per-issue/`).
- `features/regression/step_definitions/feature-911.steps.ts`
- `features/regression/step_definitions/feature-902-queue.steps.ts`
- `features/regression/step_definitions/feature-902.steps.ts`
- `features/regression/step_definitions/feature-910.steps.ts`
- `features/regression/step_definitions/realCronProcess.ts`
- `specs/issue-924-adw-r72d3j-feat-promote-911-sce-sdlc_planner-promote-911-pause-queue-regression.md`:
  this plan.

## Implementation Plan
### Phase 1: Foundation
Relocate with history. `git mv` the feature file into the new `pause-queue/` subdirectory, and the
promoted step file plus its four dependency modules into the flat regression `step_definitions/`
directory, without touching their contents. Then re-point the three per-issue consumers so the
cucumber module graph loads again. At the end of this phase a full-tree dry-run must load cleanly,
with 3 undefined steps still expected until Phase 2.

### Phase 2: Core Implementation
- Tag the feature `@regression`.
- Move T25 from `feature-908.steps.ts` into `thenSteps.ts`.
- Restore T22 and the guard pair (W16, T34) in the generic registries, with the guard result on
  `RegressionWorld`.
- Register all of the scenario's novel phrase patterns in `vocabulary.md` with artefact-targeting,
  rubric-compliant descriptions.

### Phase 3: Integration
- Add the README tree entry.
- Prove load integrity and absence of ambiguity (full-tree dry-run).
- Prove the promoted scenario green under `@regression`, in a focused run and in the full suite.
- Prove the per-issue features whose imports or T25 moved are still green, and that no test
  processes leaked.
- Run the standard gates (lint, both type-checks, git/gh guard, unit tests, build).
- Stage only this feature's paths.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Confirm the starting state
- Confirm the six source paths exist:
  - `features/per-issue/feature-911.feature`
  - `features/per-issue/step_definitions/feature-911.steps.ts`
  - `features/per-issue/step_definitions/feature-902-queue.steps.ts`
  - `features/per-issue/step_definitions/feature-902.steps.ts`
  - `features/per-issue/step_definitions/feature-910.steps.ts`
  - `features/per-issue/step_definitions/realCronProcess.ts`
- If `dev` has meanwhile stamped a `@promotion-suggested-<date>` tag on `feature-911.feature`, keep
  the relocation as planned. The tag is inert outside `features/per-issue/`; drop it from the moved
  file's tag line so the line stays canonical.
- Do **not** author `features/per-issue/feature-924.feature`. This is a `regression-promotion`
  issue: scenario authoring is skipped by design (`shouldSkipScenarioAuthoring`), and the
  `@adw-924` review-proof tag is optional.

### Task 2: Relocate the feature file
- `mkdir -p features/regression/pause-queue`
- `git mv features/per-issue/feature-911.feature features/regression/pause-queue/feature-911.feature`

### Task 3: Relocate the step file and its dependency closure (contents untouched)
- `git mv features/per-issue/step_definitions/feature-911.steps.ts features/regression/step_definitions/feature-911.steps.ts`
- `git mv features/per-issue/step_definitions/feature-902-queue.steps.ts features/regression/step_definitions/feature-902-queue.steps.ts`
- `git mv features/per-issue/step_definitions/feature-902.steps.ts features/regression/step_definitions/feature-902.steps.ts`
- `git mv features/per-issue/step_definitions/feature-910.steps.ts features/regression/step_definitions/feature-910.steps.ts`
- `git mv features/per-issue/step_definitions/realCronProcess.ts features/regression/step_definitions/realCronProcess.ts`
- Do **not** edit any import in these five files; they all resolve identically from the new
  directory:
  - the `./…` siblings moved together;
  - `../../../adws/…` and `../../../test/…` keep the same depth;
  - `../../regression/step_definitions/world.ts` resolves to the sibling `world.ts`.
- Leave every hook tag expression unchanged. The per-issue #902, #907, #908, #910 and #912 rows still
  run on these hooks until they are swept.

### Task 4: Re-point the three per-issue consumers of the moved modules
Change only the module specifier on each line:
- In `features/per-issue/step_definitions/feature-907.steps.ts`, change
  `import { probeStub, getLastProbeClassification, getLastAgentRunResult } from './feature-902.steps.ts';`
  to `… from '../../regression/step_definitions/feature-902.steps.ts';`.
- In `features/per-issue/step_definitions/feature-909-tooling.steps.ts`, change
  `import { probeStub, resetFeature902ProbeState } from './feature-902.steps.ts';` to
  `… from '../../regression/step_definitions/feature-902.steps.ts';`.
- In `features/per-issue/step_definitions/feature-908.steps.ts`, change
  `import { scanningCronFor } from './feature-902-queue.steps.ts';` to
  `… from '../../regression/step_definitions/feature-902-queue.steps.ts';`.
- Verify that no per-issue file still reaches a moved module by a sibling path. This command must
  print nothing:
  `grep -rnE "from '\./(feature-902(-queue)?\.steps|feature-910\.steps|feature-911\.steps|realCronProcess)\.ts'" features/per-issue/step_definitions/`

### Task 5: Add the feature-level `@regression` tag
- Line 1 of `features/regression/pause-queue/feature-911.feature` becomes exactly
  `@regression @adw-911 @adw-gtxas1-per-repo-ownership-o`.
- Leave the per-scenario `@adw-911 @adw-gtxas1-per-repo-ownership-o` tag lines and all other
  content untouched, including the description prose. Every hook the scenario needs is keyed on
  `@adw-911`.

### Task 6: Re-home T25 into the generic Then registry (move, not copy)
- Cut the whole `Then('the resumed comment is recorded on issue {int} in the target repository
  {string}', function (this: RegressionWorld, …) { … });` block out of
  `features/per-issue/step_definitions/feature-908.steps.ts`.
- Append it verbatim to `features/regression/step_definitions/thenSteps.ts`. It only needs
  `RegressionWorld` (already imported there as a type) and `assert`.
- Leave `feature-908.steps.ts`'s other steps, including `the mock harness recorded zero comment
  posts on issue {int} in the cron host's own repository {string}`, where they are.

### Task 7: Restore T22 and the git/gh guard pair in the generic registries
- In `features/regression/step_definitions/world.ts`:
  - Add `export interface GitGhGuardResult { exitCode: number; output: string; }` next to
    `GitInvocation`.
  - Add the optional field `gitGhGuardResult?: GitGhGuardResult;` to `RegressionWorld`, next to
    the other optional per-scenario fields.
- In `features/regression/step_definitions/whenSteps.ts`, change the `child_process` import to
  `import { spawnSync, execFileSync } from 'child_process';` and add W16 (the cucumber expression
  must escape `/`, which is otherwise alternation):
  ```ts
  When('the git\\/gh guard is run across the repository', function (this: RegressionWorld) {
    try {
      const stdout = execFileSync('bunx', ['tsx', 'adws/checkGitGhGuard.ts'], { cwd: ROOT, encoding: 'utf-8' });
      this.gitGhGuardResult = { exitCode: 0, output: stdout };
    } catch (err) {
      const e = err as { status?: number | null; stdout?: string; stderr?: string };
      this.gitGhGuardResult = { exitCode: e.status ?? 1, output: (e.stdout ?? '') + (e.stderr ?? '') };
    }
  });
  ```
- In `features/regression/step_definitions/thenSteps.ts`, add `import { execFileSync } from
  'child_process';` and add T22 and T34:
  ```ts
  Then('the ADW TypeScript type-check passes', function () {
    try {
      execFileSync('bunx', ['tsc', '--noEmit'], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, NODE_OPTIONS: '' } });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      assert.fail(`Expected the ADW TypeScript type-check to pass. Output:\n${(e.stdout ?? '') + (e.stderr ?? '')}`);
    }
  });

  Then('the git\\/gh guard reports no violations', function (this: RegressionWorld) {
    assert.ok(this.gitGhGuardResult, 'Expected the git/gh guard to have been run first');
    assert.strictEqual(this.gitGhGuardResult.exitCode, 0, `Expected the guard to exit 0. Output:\n${this.gitGhGuardResult.output}`);
  });
  ```
  - `NODE_OPTIONS` is blanked because cucumber runs with `--import tsx`, which `tsc` doesn't need.
  - The behaviour is the one the deleted `feature-844.steps.ts` had (`git show
    340aefe1^:features/per-issue/step_definitions/feature-844.steps.ts`). The only change is that
    the guard result now lives on the per-scenario World instead of module state.
- Confirm no other definition of these three phrases exists anywhere under `features/`. None exist
  today, so adding them introduces no ambiguity.

### Task 8: Register the vocabulary in `features/regression/vocabulary.md`
- Append to the **When — Orchestrator / Phase Invocation** table, after W15:
  `| W16 | \`the git/gh guard is run across the repository\` | Runs the repository's git/gh guard (\`bunx tsx adws/checkGitGhGuard.ts\`) as a subprocess from the ADW checkout root; records its exit status and combined stdout/stderr on the World | subprocess | exit code + log stream |`
- Append to the **Then — State / Mock / Artefact Assertions** table, after T33:
  `| T34 | \`the git/gh guard reports no violations\` | Asserts the exit status W16 recorded is 0; the guard's captured output is surfaced on failure | subprocess | exit code |`
- Append a new section at the end of the file, after the `@adw-537` section and its closing note,
  following that section's shape:

  ```md
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
  ```
- Do not re-register G1, G18, G20, G22, T2, T14, T22 or T25. Do not register the moved harness's
  per-issue-only phrases, such as `the rate-limit probe runs`, #910's pause-path journey steps, or
  the unqualified `the pause-queue scanner runs {int} probe cycle(s)`. No regression scenario uses
  them.

### Task 9: Add the README tree entry
- In `README.md`'s `features/` tree, insert this line between the `multilang/` and `smoke/` entries:
  `│   ├── pause-queue/    # Regression scenarios covering pause-queue ownership and remove-before-spawn resume (#911)`
- No other README change. In particular, don't sweep unrelated drift into this PR.

### Task 10: Prove load integrity and absence of ambiguity
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`. Expected: no
  undefined and no ambiguous steps anywhere in the tree, `265 scenarios (265 skipped)` at the time
  of planning. Before this change, the result was 13 undefined scenarios.
- If anything is undefined, a moved module or a re-pointed import is wrong. If anything is
  ambiguous, T25 or a backstop step was copied instead of moved. Stop and fix before continuing.

### Task 11: Prove the promoted scenario green, and nothing else regressed
- Focused run: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @adw-911"`.
  Expected: `35 scenarios (35 passed)`, exit 0.
- Full gate: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`.
  - Expected: `88 scenarios (42 pending, 46 passed)`, with 0 failed, 0 undefined and 0 ambiguous.
  - The exit code is 1 **only** because of the 42 pre-existing `return 'pending'` stubs (W1, W9,
    W10 in `whenSteps.ts`), exactly as at baseline (`53 scenarios (1 undefined, 42 pending, 10
    passed)`). Anything other than `pending` is a real failure.
- Per-issue dependents: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902 or @adw-907
  or @adw-908 or @adw-909 or @adw-910 or @adw-911 or @adw-912"`. Expected: every scenario passes.
- Leak check: `pgrep -fl "trigger_cron.ts --target-repo acme|fixture-orchestrator|bunx-stub"` must
  print nothing.
- Never run two cucumber processes at once from the same checkout. The pause-queue scenarios share
  `agents/paused_queue.json` and spawn-lock files under the cwd, and the overlapping-cycle scenario
  relies on real timers.

### Task 12: Confirm the old paths are gone and nothing dangles
- Run
  `for p in features/per-issue/feature-911.feature features/per-issue/step_definitions/{feature-911.steps.ts,feature-902-queue.steps.ts,feature-902.steps.ts,feature-910.steps.ts,realCronProcess.ts}; do test ! -e "$p" || echo "STILL PRESENT: $p"; done`.
  It must print nothing.
- Run
  `grep -rn --include='*.ts' --include='*.js' --include='*.json' --include='*.yml' -E "per-issue/(feature-911|step_definitions/(feature-911|feature-902|feature-910|realCronProcess))" . | grep -v node_modules`.
  It must print nothing. Historical `specs/*.md` and prose mentions are fine.

### Task 13: Keep the commit scoped
- Stage explicit paths only, never `git add -A`:
  - the six renames (already staged by `git mv`)
  - `features/per-issue/step_definitions/feature-907.steps.ts`
  - `features/per-issue/step_definitions/feature-908.steps.ts`
  - `features/per-issue/step_definitions/feature-909-tooling.steps.ts`
  - `features/regression/pause-queue/feature-911.feature` (tag edit)
  - `features/regression/step_definitions/thenSteps.ts`
  - `features/regression/step_definitions/whenSteps.ts`
  - `features/regression/step_definitions/world.ts`
  - `features/regression/vocabulary.md`
  - `README.md`
  - this spec
- `git diff --cached -M --name-status` must show the five step-def moves as pure renames (`R100`)
  and the feature as a high-similarity rename. `agents/` is gitignored, so test runs leave no
  tracked residue.

### Task 14: Run the validation commands
- Execute every command in **Validation Commands** and confirm each expectation.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so this subsection is included. The change adds
no production logic: it is a relocation, a re-homing of three step definitions, and a registry
edit. **No new unit tests are warranted.** The decider, scanner, resume and rate-limit-probe logic
the scenario exercises already have vitest coverage in `adws/triggers/__tests__/`
(`pauseQueueDecider.test.ts`, `pauseQueueScanner.test.ts`, `rateLimitProbe.test.ts`), which must
stay green. Run `bun run test:unit` as the regression guard (155/155 files green at baseline). The
behavioural proof for this change is the BDD run in Task 11.

### Edge Cases
- **Module-load failure.** A single unresolved relative import aborts every cucumber run. This is
  guarded by moving the harness as a closure, re-pointing all three consumers, and the full-tree
  dry-run in Task 10.
- **Ambiguous steps.** These could come from T25 or a backstop being defined twice, or from a file
  being loaded from two globs. They're guarded by moving instead of copying (each file is loaded
  exactly once by `cucumber.js`), and the dry-run reports `0 ambiguous`.
- **Double mock-infrastructure wrapping.** Under `@regression`, both the `@regression` hooks and the
  902-queue hooks call `setupMockInfrastructure`/`teardownMockInfrastructure`. Both are idempotent:
  the second setup returns the live context, and the second teardown is a no-op. The 902-queue hook
  prepends the `gh` shadow to `PATH` after setup, and the first teardown restores the original
  `PATH`. The prototype run confirmed this.
- **Hook order moves with registration order.** The moved hooks now register in the regression
  glob, before `features/regression/support/hooks.ts` and before the per-issue files. So:
  - For feature-911, the `@regression` `After` (teardown) runs **before** feature-911's `After`
    kills the real cron's process group. No assertion runs in that window.
  - For the per-issue #908 row that also carries `@adw-911`, the 910 and 911 hooks now run before
    908's. Both 908 and 911 save and restore `agents/.auth_gate`, and the nesting still nets to the
    original.

  The 160/160 per-issue run and the leak check verify both.
- **Stale guard result.** W16's result lives on the per-scenario `RegressionWorld`, so T34 can't
  pass on a previous scenario's guard run. T34 also fails loudly if W16 never ran.
- **The guard under the git mock.** W16 runs with `test/mocks/git-remote-mock.ts` first on `PATH`,
  which passes every non-network subcommand through to real git.
- **Timing-sensitive rows.** The overlapping-cycle and crash-on-first-launch rows use real timers
  and the real readiness window (about 2 s). Avoid concurrent cucumber runs and heavy parallel load
  while proving.
- **Per-issue rows that also carry `@adw-911`** (in feature-902, feature-908 and feature-910) are
  still selected by `--tags "@adw-911"` but never by `@regression`. Use `"@regression and
  @adw-911"` to select exactly the promoted file.
- **The sweep after merge.** Once #902, #907, #908, #909, #910 and #912 age out, the sweep removes
  only their `.feature` files and the `feature-N.*` files still in `features/per-issue/`. The
  promoted harness now lives outside the sweep's reach. The one remaining sweep hazard is
  `feature-909-tooling.steps.ts`; see Notes.
- **Docker leg.** It is read-only; see Notes. It isn't verifiable on this host.

## Acceptance Criteria
- `features/regression/pause-queue/feature-911.feature` exists. Its first line is exactly
  `@regression @adw-911 @adw-gtxas1-per-repo-ownership-o`, and its scenario-level tags and other
  content are unchanged.
- `feature-911.steps.ts`, `feature-902-queue.steps.ts`, `feature-902.steps.ts`,
  `feature-910.steps.ts` and `realCronProcess.ts` exist under
  `features/regression/step_definitions/` as pure renames (`R100`), with their relative imports
  unchanged.
- `features/per-issue/feature-911.feature` and all five step-def paths no longer exist under
  `features/per-issue/`.
- The per-issue consumers `feature-907`, `feature-908` and `feature-909-tooling` differ only in the
  re-pointed import specifier, plus, for 908, the removal of the T25 block.
- T25, T22, W16 and T34 are each defined exactly once, in `features/regression/step_definitions/`.
- A full-tree dry-run reports 0 undefined and 0 ambiguous steps, and no ambiguous-step error is
  introduced anywhere.
- `--tags "@regression and @adw-911"`: 35 scenarios, all passed, exit 0.
- `--tags "@regression"` executes all 35 moved scenarios, and they pass. The suite has 0 failed,
  0 undefined and 0 ambiguous, and its only non-passing scenarios are the 42 pre-existing `pending`
  stubs (unchanged).
- Every #902, #907, #908, #909, #910, #911 and #912 scenario still passes, and no test process leaks.
- `features/regression/vocabulary.md` registers W16, T34 and the 36 G-PQ, W-PQ and T-PQ patterns
  with artefact-targeting descriptions. It adds no duplicate rows for G1, G18, G20, G22, T2, T14,
  T22 or T25.
- `README.md` lists `features/regression/pause-queue/`.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`,
  `bun run lint:git-guard`, `bun run test:unit` and `bun run build` all pass.
- The commit contains only this feature's paths, and the PR is `hitl`-gated: it merges only after
  human approval.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `head -1 features/regression/pause-queue/feature-911.feature`: must print `@regression @adw-911 @adw-gtxas1-per-repo-ownership-o`.
- `for p in features/per-issue/feature-911.feature features/per-issue/step_definitions/{feature-911.steps.ts,feature-902-queue.steps.ts,feature-902.steps.ts,feature-910.steps.ts,realCronProcess.ts}; do test ! -e "$p" || echo "STILL PRESENT: $p"; done`: must print nothing.
- `for f in feature-911.steps.ts feature-902-queue.steps.ts feature-902.steps.ts feature-910.steps.ts realCronProcess.ts; do test -e "features/regression/step_definitions/$f" || echo "MISSING: $f"; done`: must print nothing.
- `grep -rnE "from '\./(feature-902(-queue)?\.steps|feature-910\.steps|feature-911\.steps|realCronProcess)\.ts'" features/per-issue/step_definitions/`: must print nothing.
- `git diff --cached -M --name-status` (after staging): the five step-def moves show as `R100`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: 0 undefined and 0 ambiguous across the whole tree.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @adw-911"`: `35 scenarios (35 passed)`, exit 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: `88 scenarios (42 pending, 46 passed)`, with 0 failed, 0 undefined and 0 ambiguous. The exit code is 1 solely because of the 42 pre-existing pending stubs, the same as baseline.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902 or @adw-907 or @adw-908 or @adw-909 or @adw-910 or @adw-911 or @adw-912"`: every scenario passes, exit 0.
- `pgrep -fl "trigger_cron.ts --target-repo acme|fixture-orchestrator|bunx-stub"`: must print nothing (no leaked test processes).
- `bun run lint`: ESLint passes.
- `bunx tsc --noEmit`: root type-check passes. It covers `features/**`, including the moved and re-pointed step files.
- `bunx tsc --noEmit -p adws/tsconfig.json`: ADW type-check passes.
- `bun run lint:git-guard`: the git/gh guard passes (W16 runs the same check from inside the suite).
- `bun run test:unit`: the vitest suite is green (155/155 files at baseline).
- `bun run build`: the build (type-check) succeeds.
- `git status --porcelain`: only the paths listed in Task 13 are changed. `agents/` and `logs/` are gitignored.

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md`.
  - The new code is three small step bodies and one interface: an explicit
    `GitGhGuardResult` type, no `any`, guard-clause style.
  - Comments are only for non-obvious reasons, such as the `\\/` escape and blanking
    `NODE_OPTIONS`. No issue-number citations in code.
  - Moved files are not reformatted or refactored.
- **No new libraries.** The install command, if ever needed, is `bun add <package>`, but nothing is
  added.
- **Deviations from the literal issue text, and why.**
  1. Four more modules move alongside `feature-911.steps.ts`. Without them the promoted step file
     cannot load, and with them left in `features/per-issue/` it breaks at the first sweep on or
     after 2026-10-09.
  2. Three *per-issue* files get one-line import edits. The instruction "do not rewrite the step-def
     files' relative imports" is honoured for every *promoted* file.
  3. T25, T22 and the guard pair are (re)defined in the regression registries, which the "No
     ambiguous-step" and "prove `@regression` green" acceptance items require.
- **Garbled issue paths.** The issue body's destination paths contain HTML comments from
  `.adw/scenarios.md`: `loadProjectConfig`'s section values include the `<!-- … -->` lines, and
  `promotionSweepDefaults.ts`'s `scenariosConfig` feeds them into `buildPromotionIssue`. Out of
  scope here. **Follow-up:** strip HTML comments from those section values.
- **Pre-existing pending stubs.** The 42 `pending` smoke/surface scenarios come from deliberate
  `return 'pending'` W1/W9/W10 stubs in `whenSteps.ts`, pending a harness that can drive real
  orchestrators. They keep the `@regression` command's exit code at 1 with or without this change,
  so "green" for this issue means: 0 failed, 0 undefined, 0 ambiguous, and every promoted scenario
  passed.
- **Docker leg: a known limitation, flagged for the HITL reviewer.**
  - `test/docker-run.sh` runs from `regression.yml` on the daily schedule or with `runtime:
    docker`. It mounts the checkout read-only at `/workspace`, and the regression-suite contract
    says scratch state lives in `os.tmpdir()`.
  - feature-911 drives production code that writes `agents/paused_queue.json`, `agents/<adwId>/`,
    `agents/spawn_locks/`, `agents/paused_queue_logs/` and `agents/cron/` relative to
    `process.cwd()` (`PAUSE_QUEUE_PATH`, `AGENTS_STATE_DIR`). §2–§4 are therefore expected to fail
    with EROFS in that leg; §1 and §5 should pass.
  - This is unverified: Docker is not installed on this host. That leg already exits non-zero
    today because of the pending stubs.
  - **Follow-up:** either add a writable anonymous `-v /workspace/agents` volume in
    `test/docker-run.sh`, mirroring the existing `/workspace/node_modules` overlay, or exclude
    these scenarios from the Docker leg by tag. Mention this in the PR description.
- **Sweep hazard (urgent follow-up, outside this issue's scope).**
  - `perIssueScenarioSweep.ts` matches siblings with `startsWith('feature-N.')`. So does the
    promotion sweep's `listStepDefSiblings`, which is why this issue listed only
    `feature-911.steps.ts`.
  - Hyphen-suffixed helpers (`feature-N-*.steps.ts`) therefore survive their feature's sweep while
    importing the deleted `feature-N.steps.ts`.
  - After this PR, the live instance is `feature-909-tooling.steps.ts` → `./feature-909.steps.ts`.
    The first sweep on or after **2026-10-09** will break cucumber's module load for **every** run:
    this promoted scenario, the whole `@regression` suite, and ADW's own scenario phases.
  - The same class of breakage followed the 2026-09-26 sweep: the #911 merge re-added
    `feature-816…823.steps.ts`, and `feature-844.steps.ts` stayed deleted, which is how T22 went
    undefined.
  - **Recommend fixing it before 2026-10-09**: widen both matchers to `feature-N.` or `feature-N-`,
    or make the sweep refuse a removal that leaves a dangling import.
  - This PR already removes the `feature-902-queue.steps.ts` → `feature-902.steps.ts` instance by
    moving both files.
- **Later cleanup (not now).** The moved harness files still carry step definitions only per-issue
  scenarios use: #902's §1/§2 probe steps, #910's pause-path journey, and the unqualified
  `the pause-queue scanner runs {int} probe cycle(s)`. Their hook expressions also name per-issue
  tags. All of this is inert once those features are swept. A later change can then prune them and
  rename the files to subject names. Doing it now would rewrite the promoted step file's imports
  and break per-issue features that still run on them.
- **Feature prose.** The feature description's step-def notes still say T25 is in
  `feature-908.steps.ts` and T22 and the guard pair are in `feature-844.steps.ts`. They are left
  untouched to keep this a pure relocation; the prose is non-executable history.
- **Documentation phase.** `app_docs/feature-9gjajh-bdd-regression-suite.md` should record:
  - the `pause-queue/` subdirectory;
  - that a promoted scenario may bring its harness modules along;
  - W16 in `whenSteps.ts`, and T22/T25/T34 in `thenSteps.ts`;
  - the registry ranges (W1–W16, T1–T34);
  - the Docker-leg caveat.
- **Rot advisory.** Because the issue carries `regression-promotion`, the review phase posts the
  advisory, non-blocking rot/reuse PR comment (`executePromotionRotAdvisory`). The
  `promote-regression-vocabulary` skill can also be run by hand; it writes nothing.
- **HITL.** `hitl` is set, so `adwMerge` defers the merge until a human approves the PR. Nothing
  in this plan bypasses that.
