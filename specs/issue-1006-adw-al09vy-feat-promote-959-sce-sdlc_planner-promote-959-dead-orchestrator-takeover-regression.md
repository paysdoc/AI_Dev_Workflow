# Feature: Promote #959's dead-orchestrator takeover scenario into the @regression suite

## Metadata
issueNumber: `1006`
adwId: `al09vy-feat-promote-959-sce`
issueJson: `{"number":1006,"title":"feat: promote #959 scenario into the @regression suite","body":"Promotes: feature-959\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-959` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-959.feature features/regression/<subdir>/feature-959.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-959.steps.ts features/regression/step_definitions/feature-959.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-959.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-959.steps.ts`\n\n## Phrases to register\n\n- `a launch boundary for the repository \"adw-fixture/void-959\" whose providers record every call`\n- `issue <issue> has an ADW workflow under adwId \"<adwId>\" that runs \"<script>\", whose last run stopped at \"phase_timeout\" half an hour ago`\n- `a relaunched orchestrator for workflow \"<adwId>\" recorded \"starting\" and died before its first phase`\n- `the cron polls from that boundary, with its hung-orchestrator sweep due`\n- `the cron has launched 1 orchestrator for issue <issue>`\n- `every orchestrator the cron launched for issue <issue> runs \"<script>\" under adwId \"<adwId>\"`\n- `issue <issue> has an ADW workflow under adwId \"<adwId>\" that runs \"adws/adwSdlc.tsx\", whose last run stopped at \"phase_timeout\" half an hour ago`\n- `the orchestrator of workflow \"<adwId>\" died at workflowStage \"<stage>\" ten minutes ago, leaving the issue's spawn lock behind`\n- `every orchestrator the cron launched for issue <issue> runs \"adws/adwSdlc.tsx\" under adwId \"<adwId>\"`\n- `issue 9596 has an ADW workflow under adwId \"live959-9596\" that runs \"adws/adwSdlc.tsx\", whose last run stopped at \"phase_timeout\" half an hour ago`\n- `a relaunched orchestrator for workflow \"live959-9596\" is alive and still starting up, past recording \"starting\" but before its first phase`\n- `the cron launched no orchestrator for issue 9596`\n- `the orchestrator process of workflow \"live959-9596\" is still alive`\n- `the worktree of workflow \"live959-9596\" was not reset`\n- `nothing but the orchestrator of workflow \"live959-9596\" holds the issue's spawn lock`\n- `the state file for adwId \"live959-9596\" records workflowStage \"starting\"`\n- `issue 9597 has an ADW workflow under adwId \"race959-9597\" that runs \"adws/adwSdlc.tsx\", whose last run stopped at \"phase_timeout\" half an hour ago`\n- `a relaunched orchestrator for workflow \"race959-9597\" is alive and records \"starting\" between the cron's filtering of the issue and its takeover decision`\n- `the cron launched no orchestrator for issue 9597`\n- `the orchestrator process of workflow \"race959-9597\" is still alive`\n- `the worktree of workflow \"race959-9597\" was not reset`\n- `nothing but the orchestrator of workflow \"race959-9597\" holds the issue's spawn lock`\n- `the state file for adwId \"race959-9597\" records workflowStage \"starting\"`\n- `the orchestrator of workflow \"<adwId>\" is alive at workflowStage \"<stage>\", holding the issue's spawn lock and heartbeating`\n- `the cron launched no orchestrator for issue <issue>`\n- `the orchestrator process of workflow \"<adwId>\" is still alive`\n- `the worktree of workflow \"<adwId>\" was not reset`\n- `nothing but the orchestrator of workflow \"<adwId>\" holds the issue's spawn lock`\n- `the state file for adwId \"<adwId>\" records workflowStage \"<stage>\"`\n- `issue 9600 has an ADW workflow under adwId \"prr959-9600\" that runs \"adws/adwSdlc.tsx\", whose last run stopped at \"awaiting_merge\" half an hour ago`\n- `the SDLC run of workflow \"prr959-9600\" has exited, leaving its pid in the state`\n- `a PR review of workflow \"prr959-9600\" has started up on the issue's pull request and has stood at workflowStage \"pr_review_build_running\" for ten minutes`\n- `the cron launched no orchestrator for issue 9600`\n- `the worktree of workflow \"prr959-9600\" was not reset`\n- `the state file for adwId \"prr959-9600\" records workflowStage \"pr_review_build_running\"`\n- `issue 9580 has an ADW workflow under adwId \"held959-9580\" that runs \"adws/adwSdlc.tsx\", whose last run stopped at \"phase_timeout\" half an hour ago`\n- `a relaunched orchestrator for workflow \"held959-9580\" recorded \"starting\" and died before its first phase`\n- `another live process holds the spawn lock for issue 9580 in the repository \"adw-fixture/void-959\"`\n- `the cron launched no orchestrator for issue 9580`\n- `issue 9581 in the recording tracker carries the labels \"adw:bug\" and \"adw:none\"`\n- `issue 9581 has an ADW workflow under adwId \"none959-9581\" that runs \"adws/adwSdlc.tsx\", whose last run stopped at \"phase_timeout\" half an hour ago`\n- `a relaunched orchestrator for workflow \"none959-9581\" recorded \"starting\" and died before its first phase`\n- `issue 9582 in the recording tracker carries the label \"adw:bug\"`\n- `issue 9582 has an ADW workflow under adwId \"none959-9582\" that runs \"adws/adwSdlc.tsx\", whose last run stopped at \"phase_timeout\" half an hour ago`\n- `a relaunched orchestrator for workflow \"none959-9582\" recorded \"starting\" and died before its first phase`\n- `the cron launched no orchestrator for issue 9581`\n- `the cron has launched 1 orchestrator for issue 9582`\n- `every orchestrator the cron launched for issue 9582 runs \"adws/adwSdlc.tsx\" under adwId \"none959-9582\"`\n- `issue <issue> has an ADW workflow under adwId \"<adwId>\" that runs \"adws/adwChore.tsx\", whose last run stopped at \"<stage>\" half an hour ago`\n- `the cron's own process holds the spawn lock for issue <issue> in the repository \"adw-fixture/void-959\"`\n- `every orchestrator the cron launched for issue <issue> runs \"adws/adwChore.tsx\" under adwId \"<adwId>\"`\n- `issue 9585 has an ADW workflow under adwId \"self959-9585\" that runs \"adws/adwSdlc.tsx\", whose last run stopped at \"phase_timeout\" half an hour ago`\n- `a relaunched orchestrator for workflow \"self959-9585\" recorded \"starting\" and died before its first phase`\n- `the cron's own process holds the spawn lock for issue 9585 in the repository \"adw-fixture/void-959\"`\n- `the cron has launched 1 orchestrator for issue 9585`\n- `every orchestrator the cron launched for issue 9585 runs \"adws/adwSdlc.tsx\" under adwId \"self959-9585\"`\n- `issue 9535 has an ADW workflow under adwId \"replay959-9535\" that runs \"adws/adwSdlc.tsx\", whose last run stopped at \"phase_timeout\" half an hour ago`\n- `the cron has launched 1 orchestrator for issue 9535`\n- `the orchestrator the cron relaunched for workflow \"replay959-9535\" records \"starting\" exactly as #935's relaunched orchestrator did, and dies before its first phase`\n- `the cron's own process holds the spawn lock for issue 9535 in the repository \"adw-fixture/void-959\"`\n- `the same cron polls again from that boundary, with its hung-orchestrator sweep due`\n- `the cron has launched 2 orchestrators for issue 9535`\n- `every orchestrator the cron launched for issue 9535 runs \"adws/adwSdlc.tsx\" under adwId \"replay959-9535\"`\n- `the Claude CLI that ADW is configured to run exists but is not executable`\n- `the orchestrator \"<script>\" is launched as the cron launches it, for issue <issue> under adwId \"<adwId>\" and the target repository \"acme/widgets\", with its output discarded`\n- `the orchestrator subprocess exited 1`\n- `the execution log of the \"<orchestrator>\" for adwId \"<adwId>\" records the error that stopped its startup`\n- `the execution log of the \"sdlc-orchestrator\" for adwId \"silent959-9575\" already ends with the line \"Allocated port 57665 for dev server\"`\n- `the orchestrator \"adws/adwSdlc.tsx\" is launched as the cron launches it, for issue 9575 under adwId \"silent959-9575\" and the target repository \"acme/widgets\", with its output discarded`\n- `the execution log of the \"sdlc-orchestrator\" for adwId \"silent959-9575\" still holds the line \"Allocated port 57665 for dev server\"`\n- `the execution log of the \"sdlc-orchestrator\" for adwId \"silent959-9575\" records the error that stopped its startup, after the line \"Allocated port 57665 for dev server\"`\n- `the ADW TypeScript type-check passes`\n- `the git/gh guard is run across the repository`\n- `the git/gh guard reports no violations`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-959.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-04T15:36:31Z","comments":[],"actionableComment":null}`

## Feature Description
`features/per-issue/feature-959.feature` (`@adw-959 @adw-r5ifl5-bug-an-orchestrator
@promotion-suggested-2026-10-04`) specifies how ADW recovers a workflow whose orchestrator died.
The fix it guarded (#959, PR #969) is merged. It holds 15 scenarios, 23 test cases with the outline
examples expanded:

| § | Test cases | Behaviour guarded |
|---|---|---|
| §1 | 5 | A workflow whose relaunched orchestrator recorded `starting` and died, or died in `starting`, `build_running` or `stepDef_running` holding its spawn lock, is taken over by one cron poll. The poll relaunches the script the state records, under the same adwId. |
| §2 | 7 | A live orchestrator is left alone: not killed, not reset, not doubled, and not left facing a lock the cron kept. This covers one that is still starting up, one that records `starting` mid-poll, and one that heartbeats at `starting` or `build_running`. It also covers a PR review on the issue's adwId, a foreign lock holder, and an `adw:none` issue next to a neighbour that is taken over. |
| §3 | 3 | A spawn lock the cron's own process left behind never holds an `abandoned`, a `phase_timeout` or a dead `starting` workflow hostage. |
| §4 | 1 | The #935 replay: the same cron, never restarted, relaunches the workflow again under its adwId. |
| §5 | 5 | An orchestrator launched as the cron launches it, with its output discarded, that throws during startup writes the error into its own `execution.log`, keeping earlier lines, and exits 1. |
| §6 | 2 | Backstops: the type-check and the git/gh guard. |

Every assertion reads a runtime artefact:
- the launches the cron made, recorded by a `bunx` shadow;
- `agents/<adwId>/state.json`;
- the spawn-lock records under `agents/spawn_locks/`;
- stand-in process liveness;
- the worktree resets recorded at the boundary's git context;
- `agents/<adwId>/<orchestrator>/execution.log`;
- the launched orchestrator's exit code.

No step reads a source file.

This feature relocates the scenario into the standing `@regression` suite as
`features/regression/takeover/feature-959.feature`, tagged `@regression @dead-orchestrator-takeover`.
It is the direct relocation the issue describes (the #734 shape). Four points go beyond the
issue's two-file list.

1. **The step definitions are a closure, not one file.** The issue names only `feature-959.steps.ts`,
   a known under-listing (`app_docs/feature-9gjajh-bdd-regression-suite.md`: the promotion issue builder
   matches only `feature-N.`-prefixed basenames). That file holds only the hooks. The steps and helpers
   live in eight hyphen-named siblings, all imported via `./feature-959-*.ts`:
   - `feature-959-world.ts`
   - `feature-959-boundary.ts`
   - `feature-959-cron.steps.ts`
   - `feature-959-workflow.steps.ts`
   - `feature-959-orchestrator.ts`
   - `feature-959-processes.ts`
   - `feature-959-pr-review.steps.ts`
   - `feature-959-startup.steps.ts`
2. **The closure reaches into three other per-issue files.**
   - Five of the nine files import `./feature-796.steps.ts` or `./feature-932-world.ts`.
   - The feature uses one phrase defined in `feature-796.steps.ts`: the recording launch boundary.
   - It uses two phrases defined in `feature-820.steps.ts`: the one-label and two-label Givens.

   Neither `feature-796.feature` nor `feature-820.feature` exists any more. Their step files survive
   only because other per-issue features import them. The documented promotion rule is to move the
   whole dependency closure into `features/regression/step_definitions/` with contents untouched,
   and to repoint the per-issue importers left behind. So `feature-796.steps.ts`,
   `feature-820.steps.ts` and `feature-932-world.ts` move too.

   Both step-definition directories are three levels deep, so no moved file's relative import
   changes. That satisfies the issue's "Do not rewrite the step-def files' relative imports".
3. **Ten per-issue files are repointed.** They import the moved shared harness: 13 import specifiers
   in features 848, 929, 932, 933 and 988.
4. **Hooks are re-keyed.** The hooks are scoped by `OWN_ROWS = '@adw-959 and not @adw-908 and not
   @adw-912'`. They are re-keyed to the descriptive `@dead-orchestrator-takeover`, the tag only this
   feature carries.

The scenario's phrases are registered in `features/regression/vocabulary.md` in a new rubric-compliant
`(@dead-orchestrator-takeover)` section. The README's `features/` tree gains the `takeover/` line.

The value is that the recovery invariants that stranded #935 for six hours become standing
regression proof. They then run on every `@regression` invocation:
- every ADW workflow's scenario test phase;
- the daily `Regression Scenarios` workflow, host and Docker;
- local runs.

Today they run only when someone runs `@adw-959`.

## User Story
As an ADW maintainer
I want #959's dead-orchestrator takeover and startup-failure-logging scenarios to run in the standing `@regression` suite
So that a later change to the cron filter, the takeover handler, the spawn gate, the hung-orchestrator sweep or orchestrator startup that re-strands a dead workflow, kills or doubles a live one, or lets an orchestrator die silently is caught by every regression run

## Problem Statement
- **Not in the regression run.** `features/per-issue/feature-959.feature` carries no `@regression`
  tag. Only #959's own workflow ran it, by `@adw-959`, and that workflow is finished. The coordination
  kernel it guards is the most production-hardened part of ADW: `cronIssueFilter`, `takeoverHandler`,
  `spawnGate`, `hungOrchestratorDetector`, `initializeWorkflow`'s liveness records and the
  orchestrators' startup-failure log. Nothing currently fails when one of them regresses.
- **The two-file move the issue describes cannot work.**
  - Moving only `feature-959.steps.ts` leaves its eight `./feature-959-*.ts` imports dangling. A
    dangling import crashes the whole Cucumber load, not just this feature.
  - Moving the nine `feature-959*` files without `feature-796.steps.ts` and `feature-932-world.ts`
    leaves `./feature-796.steps.ts` and `./feature-932-world.ts` dangling in five of them.
  - Rewriting those specifiers to `../../per-issue/step_definitions/…` would break the issue's "do
    not rewrite the relative imports". It would also leave a regression feature depending on
    per-issue files, which the documented promotion rule forbids.
- **Phrases defined elsewhere.** The feature relies on three phrases defined in the per-issue
  `feature-796.steps.ts` and `feature-820.steps.ts`.
- **Importers left behind.** Moving those three shared files strands 13 `./…` specifiers in 10
  per-issue files, belonging to features 848, 929, 932, 933 and 988.
- **Hooks keyed on per-issue tags.** The hooks are keyed on `@adw-959`. A regression feature carries
  no `@adw-` tag, so un-keyed hooks would silently stop running. The rows would then lose
  `mockContext` (T1 and T5 need it). They would also stop saving and restoring
  `agents/paused_queue.json` and `agents/.auth_gate`, and stop killing stand-in processes. Spawn
  locks would be left under the test process's pid, which spoils later rows.
- **Stale description.** The feature's description names the old hook expression, says four rows
  "now also carry `@adw-959`", and calls the reused phrases "per-issue". After the move it would
  contradict the code. Promoted feature-912's rows no longer carry `@adw-959`.
- **Unregistered phrases.** The vocabulary registry has no entry for the scenario's novel phrases.

## Solution Statement
A direct relocation that follows the conventions recorded in
`app_docs/feature-9gjajh-bdd-regression-suite.md` and the last five promotions (#909, #910/#911, #912,
#930, #936):

1. **Move the feature** to `features/regression/takeover/feature-959.feature` with `git mv`.
   `takeover` names the scenario's subject, the cron taking over a dead orchestrator's workflow. It
   matches `takeoverHandler.ts` and sits alphabetically among the existing short subject names.
2. **Re-tag it.**
   - Line 1 becomes `@regression @dead-orchestrator-takeover`. That drops `@adw-959`,
     `@adw-r5ifl5-bug-an-orchestrator` and `@promotion-suggested-2026-10-04`. Only the per-issue
     sweeps read the promotion marker.
   - Delete all 15 scenario-level tag lines, including the foreign-lock row's extra `@adw-963`.
   - `@dead-orchestrator-takeover` is unused anywhere in the repo, and it does not start with `@adw-`.
3. **Move the step-definition closure** into `features/regression/step_definitions/` with `git mv`.
   That is the nine `feature-959*` files plus `feature-796.steps.ts`, `feature-820.steps.ts` and
   `feature-932-world.ts`.
   - No moved file's import specifier changes.
   - `feature-796.steps.ts` and `feature-820.steps.ts` both compute `FRAMEWORK_REPO_ROOT` as
     `'../../..'` from their own directory, which resolves identically at the new location.
4. **Repoint** the 13 stranded specifiers in the 10 per-issue files to
   `../../regression/step_definitions/<file>`. That is the module Cucumber's glob loads, so every
   importer shares one module instance and one `world796()`.
5. **Re-key the hooks.** `OWN_ROWS` in the moved `feature-959-world.ts` becomes
   `'@dead-orchestrator-takeover'`. The `Before`/`After` call sites use the constant and need no change.
   - The flagged feature-908 row (per-issue, still carrying `@adw-959`) and the promoted feature-912
     rows (`@rate-limit-in-process-wait`) do not carry the new tag. They keep running under their
     own harness.
   - The `@adw-796`/`@adw-820` hooks in the two moved harness files stay as they are. No feature
     carries those tags, and they are not keyed on a tag this promotion removes.
6. **Keep prose truthful.**
   - In the moved feature's description, correct the paragraphs that name the old hook expression,
     the four `@adw-959` rows and the "per-issue" reused phrases. Point to the new registry section.
   - Update feature-908's cross-reference to the new path.
7. **Register the phrases.** Add a new
   `## Given/When/Then — Dead-Orchestrator Takeover and Startup-Failure Logging (@dead-orchestrator-takeover)`
   section to `features/regression/vocabulary.md` with 27 five-column rows:
   - G-DT1–G-DT14 (G-DT1–G-DT3 are the reused 796/820 phrases);
   - W-DT1–W-DT4;
   - T-DT1–T-DT9.

   G18, G-PQ14, T1, T5, T22, W16 and T34 are reused. The parser
   (`adws/promotion/vocabularyParser.ts`) reads every `## Given|When|Then…` section's rows.
8. **README.** Add the `takeover/` line to the `features/regression/` tree.

No production code changes, no new library, and no step definition is added, copied or redefined. The
set of step definitions Cucumber loads is identical before and after: `cucumber.js` imports both step
directories regardless of tags. So no ambiguous or undefined step can be introduced.

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview. Its `features/` tree (lines ~1184–1201) lists each
  `features/regression/` subdirectory, and the new `takeover/` line goes between `surfaces/` and
  `upgrade/`.
- `.adw/coding_guidelines.md` — the coding guidelines. The **Comments** rule applies to the two edited
  header comments.
- `.adw/scenarios.md` / `.adw/commands.md` — the scenario directory, the regression directory, the
  vocabulary registry path, and the validation commands.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` (conditional doc: "When manually promoting a
  `features/per-issue/` scenario into `features/regression/`") — the promotion rules this plan
  follows. Line 55 covers moving the closure with imports untouched and repointing the importers
  left behind. Line 105 says to promote the whole dependency closure. Line 111 covers re-keying hooks
  to a descriptive tag that equals the feature's exactly, and dropping `@promotion-suggested-*`.
  Line 112 covers under-listed sources. Line 113 covers hooks keeping per-issue alternatives.
- `app_docs/feature-9gjajh-bdd-per-issue.md` (conditional doc: per-issue step definitions in
  `features/per-issue/`) — context for the per-issue files whose imports are repointed.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` (conditional doc: "When a `starting`
  orchestrator is deferred, taken over, or reset, when a spawn lock held by the cron's own pid blocks
  an orchestrator") — the behaviour §1–§4 guard, for writing accurate vocabulary semantics.
- `app_docs/feature-9gjajh-coordination-kernel.md` (conditional doc: `isRecordedOwnerLive`, the
  `pid`/`pidStartedAt`/`lastSeenAt` recorded at `starting`, the hung sweep's reach) — the liveness
  records the G-DT rows mirror.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` (conditional doc: "When an orchestrator dies
  during startup … and the reason must appear in its `execution.log`") — the §5 behaviour.
- `app_docs/feature-9gjajh-promotion-system.md` (conditional doc: promotion tag state) — the
  `@promotion-suggested-<date>` marker that is dropped.
- `features/per-issue/feature-959.feature` — the source feature, moved and re-tagged. These parts of
  its description are edited:
  - the FLAGGED paragraph, lines ~157–168;
  - the HOOKS bullet, lines ~284–289;
  - the vocabulary note, lines ~291–320.
- `features/per-issue/step_definitions/feature-959.steps.ts` — the `Before`/`After` hooks, keyed on
  `OWN_ROWS`. It imports `./feature-796.steps.ts`, `./feature-932-world.ts` and feature-911's
  `releaseHeldSpawnLocks`. Moved, and only its header comment is edited.
- `features/per-issue/step_definitions/feature-959-world.ts` — defines `OWN_ROWS` and the module
  state `s`. Moved, and `OWN_ROWS` and its JSDoc are re-keyed.
- `features/per-issue/step_definitions/feature-959-boundary.ts`, `feature-959-cron.steps.ts`,
  `feature-959-workflow.steps.ts`, `feature-959-orchestrator.ts`, `feature-959-processes.ts`,
  `feature-959-pr-review.steps.ts`, `feature-959-startup.steps.ts` — the rest of the closure, which
  defines every novel phrase. Moved, with no content change.
- `features/per-issue/step_definitions/feature-796.steps.ts` — defines G-DT1, the recording boundary
  (`buildRecordingBoundary`, `world796`, `resetWorld`, `splitRepo`), and dead `@adw-796` hooks. It
  imports only `adws/` and packages. Moved, with no content change.
- `features/per-issue/step_definitions/feature-820.steps.ts` — defines G-DT2 and G-DT3 (lines
  ~590–603) and dead `@adw-820` hooks. It imports `./feature-796.steps.ts`. Moved, with no content
  change.
- `features/per-issue/step_definitions/feature-932-world.ts` — holds the `bunx` launch recorder and
  the shared helpers the cron rows use (`installBunxShadow`, `launchesFor`, `requireBoundary`,
  `requireFixture`, `staleTimestamp`, `restoreFile`, …). It imports `./feature-796.steps.ts` and
  `../../regression/step_definitions/realCronProcess.ts`. Moved, with no content change.
- The per-issue importers to repoint, with their stranded lines:
  - `features/per-issue/step_definitions/feature-848.steps.ts` imports `./feature-796.steps.ts` and
    `./feature-820.steps.ts`.
  - `features/per-issue/step_definitions/feature-929-workflow.ts` imports `./feature-796.steps.ts`.
  - `features/per-issue/step_definitions/feature-929.steps.ts` imports `./feature-796.steps.ts`.
  - `features/per-issue/step_definitions/feature-932.steps.ts` imports `./feature-796.steps.ts` and
    `./feature-932-world.ts` (a multi-line import closing on `} from './feature-932-world.ts';`).
  - `features/per-issue/step_definitions/feature-932-drive.steps.ts` imports `./feature-796.steps.ts`
    and `./feature-932-world.ts`.
  - `features/per-issue/step_definitions/feature-932-observe.steps.ts` imports
    `./feature-932-world.ts` (multi-line).
  - `features/per-issue/step_definitions/feature-933-boundary.steps.ts` imports
    `./feature-796.steps.ts`.
  - `features/per-issue/step_definitions/feature-933-remote.steps.ts` imports
    `./feature-796.steps.ts`.
  - `features/per-issue/step_definitions/feature-933-workflow.ts` imports `./feature-796.steps.ts`.
  - `features/per-issue/step_definitions/feature-988-world.ts` imports `./feature-796.steps.ts`.
- `features/per-issue/feature-908.feature` — line ~106 names `features/per-issue/feature-959.feature`
  as where "the rest of #959's behaviour is specified". It is updated to the new path. Its row's
  `@adw-959` tag is left alone, because it is another feature's per-issue row.
- `features/regression/step_definitions/feature-911.steps.ts` — defines G-PQ14 and exports
  `releaseHeldSpawnLocks`, which the moved hooks call. Its `@adw-911 or @pause-queue-ownership` hooks
  need no change. Read only.
- `features/regression/support/hooks.ts` — the `@regression` `Before` (idempotent
  `setupMockInfrastructure`) and `After` (`runCleanup`, `teardownMockInfrastructure`, World reset).
  After the move these also fire for the 959 rows, and they load after the moved step files, which
  flips hook order (see Edge Cases). Read only.
- `cucumber.js` — `paths` and `import` globs. Both step directories and both feature directories load
  on every run. It also pins `TARGET_REPOS_DIR` to an empty directory at import, so the cron's janitor
  tick never reaches real worktrees. Read only.
- `adws/triggers/perIssueScenarioSweep.ts` — the per-issue sibling rule (`startsWith('feature-N.')`),
  the reason no promoted closure may stay under `features/per-issue/`. Read only.
- `adws/promotion/vocabularyParser.ts` — the registry format: `## Given|When|Then…` sections, rows
  `| # | Phrase | Semantics | Pattern | Assertion target |`, and pattern `subprocess` / `phase-import`
  / `mock-query`. Read only.
- `features/regression/vocabulary.md` — the phrase registry. A new section is appended after the
  `(@cost-records)` section.

### New Files
These are relocations made with `git mv`, so history is preserved. Every file except the feature keeps
its content, apart from the two hook-related edits in Task 7.
- `features/regression/takeover/feature-959.feature` (new subdirectory `features/regression/takeover/`)
- `features/regression/step_definitions/feature-959.steps.ts`
- `features/regression/step_definitions/feature-959-world.ts`
- `features/regression/step_definitions/feature-959-boundary.ts`
- `features/regression/step_definitions/feature-959-cron.steps.ts`
- `features/regression/step_definitions/feature-959-workflow.steps.ts`
- `features/regression/step_definitions/feature-959-orchestrator.ts`
- `features/regression/step_definitions/feature-959-processes.ts`
- `features/regression/step_definitions/feature-959-pr-review.steps.ts`
- `features/regression/step_definitions/feature-959-startup.steps.ts`
- `features/regression/step_definitions/feature-796.steps.ts`
- `features/regression/step_definitions/feature-820.steps.ts`
- `features/regression/step_definitions/feature-932-world.ts`

## Implementation Plan
### Phase 1: Foundation
Confirm the preconditions before moving anything:
- The sources exist.
- The destinations are free: no `features/regression/takeover/`, and no file of the same name in
  `features/regression/step_definitions/`.
- The descriptive tag and the `DT` ID prefix are unused.
- The importer list still matches the 13 specifiers in 10 files. Re-grep it at build time, because
  per-issue features land continuously. Repoint every importer the grep lists, not just the ones named
  here.
- Check whether the concurrent #932 promotion (#1003, branch `feature-issue-1003`) has already moved
  the shared harness into this branch's base (see Notes).

### Phase 2: Core Implementation
1. `git mv` the feature and the 12-file closure.
2. Repoint the per-issue importers left behind.
3. Re-tag the feature.
4. Re-key `OWN_ROWS`.
5. Correct the moved feature's description and feature-908's cross-reference.

Every TypeScript change is either an import specifier, the one tag string, or a header comment or
JSDoc. Logic is untouched.

### Phase 3: Integration
1. Register the phrases in `features/regression/vocabulary.md`.
2. Add the README tree line.
3. Prove the promotion:
   - The root type-check covers `features/**` (`tsconfig.json` includes `**/*.ts`), so it catches any
     dangling specifier in a moved or repointed file.
   - A dry-run over `@regression` and over the repointed per-issue features proves every step still
     binds once, with no undefined and no ambiguous step.
   - The targeted `@dead-orchestrator-takeover` run proves the 23 test cases pass under the
     `@regression` hooks.
   - The full `@regression` run proves the suite is green.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Verify preconditions
- Read `app_docs/feature-9gjajh-bdd-regression-suite.md` lines 55, 104–113 and 142 for the promotion
  conventions.
- `ls features/per-issue/feature-959.feature features/per-issue/step_definitions/feature-959*.ts`: the
  feature and nine step files exist.
- `test ! -e features/regression/takeover && echo FREE`. Also confirm that none of
  `feature-959*`, `feature-796.steps.ts`, `feature-820.steps.ts` or `feature-932-world.ts` exists
  under `features/regression/step_definitions/`.
  - If `feature-796.steps.ts`, `feature-820.steps.ts` and `feature-932-world.ts` already exist there,
    #1003 has landed in this branch's base. Then skip moving those three in Task 3.
  - In that case the `feature-959*` files will already import them as
    `../../regression/step_definitions/…`. That specifier still resolves after the move, so leave it
    unchanged.
  - Task 4 then has nothing left to repoint for those three files.
  - In Task 9, do not add G-DT1–G-DT3. Reuse the rows #1003 registered instead, and name them in the
    reuse paragraph.
- `grep -rn "dead-orchestrator-takeover" features/ README.md` prints nothing.
- `grep -nE '^\| [GWT]-DT[0-9]' features/regression/vocabulary.md` prints nothing.
- `grep -rnE "from '\./feature-(796\.steps|820\.steps|932-world)\.ts'" features/per-issue/step_definitions | grep -v '/feature-959' | grep -v '/feature-820.steps.ts:' | grep -v '/feature-932-world.ts:'`
  lists the 13 stay-behind specifiers in the 10 files named under Relevant Files. Repoint whatever it
  lists.

### 2. Move the feature file
- `mkdir -p features/regression/takeover`
- `git mv features/per-issue/feature-959.feature features/regression/takeover/feature-959.feature`

### 3. Move the step-definition closure
- `for f in features/per-issue/step_definitions/feature-959*.ts; do git mv "$f" features/regression/step_definitions/; done`.
  That moves nine files:
  - `feature-959.steps.ts`
  - `feature-959-world.ts`
  - `feature-959-boundary.ts`
  - `feature-959-cron.steps.ts`
  - `feature-959-workflow.steps.ts`
  - `feature-959-orchestrator.ts`
  - `feature-959-processes.ts`
  - `feature-959-pr-review.steps.ts`
  - `feature-959-startup.steps.ts`
- `git mv features/per-issue/step_definitions/feature-796.steps.ts features/regression/step_definitions/feature-796.steps.ts`
- `git mv features/per-issue/step_definitions/feature-820.steps.ts features/regression/step_definitions/feature-820.steps.ts`
- `git mv features/per-issue/step_definitions/feature-932-world.ts features/regression/step_definitions/feature-932-world.ts`
- Do not edit any import specifier in these 12 files. Two kinds of specifier occur, and both resolve
  unchanged:
  - The co-located ones (`./feature-796.steps.ts`, `./feature-932-world.ts`, `./feature-959-*.ts`)
    sit in the same directory again.
  - The rest (`../../regression/step_definitions/…`, `../../../adws/…`,
    `../../../test/mocks/test-harness.ts`, and the dynamic `import('../../../adws/triggers/trigger_cron.ts')`)
    resolve identically from another directory three levels deep.
- Leave the `@adw-796` hooks in `feature-796.steps.ts` and the `@adw-820` hooks in
  `feature-820.steps.ts` as they are. They are not keyed on a tag this promotion removes.

### 4. Repoint the per-issue importers left behind
In each file below, change only the module specifier string to
`'../../regression/step_definitions/<same file name>'`. Leave the imported names, `import type`
forms and line layout unchanged.
- `features/per-issue/step_definitions/feature-848.steps.ts`: `./feature-796.steps.ts` and
  `./feature-820.steps.ts`.
- `features/per-issue/step_definitions/feature-929-workflow.ts`: `./feature-796.steps.ts`.
- `features/per-issue/step_definitions/feature-929.steps.ts`: `./feature-796.steps.ts`.
- `features/per-issue/step_definitions/feature-932.steps.ts`: `./feature-796.steps.ts` and the
  multi-line import's closing `} from './feature-932-world.ts';`.
- `features/per-issue/step_definitions/feature-932-drive.steps.ts`: `./feature-796.steps.ts` and
  `./feature-932-world.ts`.
- `features/per-issue/step_definitions/feature-932-observe.steps.ts`: the closing
  `} from './feature-932-world.ts';`.
- `features/per-issue/step_definitions/feature-933-boundary.steps.ts`: `./feature-796.steps.ts`.
- `features/per-issue/step_definitions/feature-933-remote.steps.ts`: `./feature-796.steps.ts`.
- `features/per-issue/step_definitions/feature-933-workflow.ts`: `./feature-796.steps.ts`.
- `features/per-issue/step_definitions/feature-988-world.ts`: `./feature-796.steps.ts`.

Check the result with two greps:
- `grep -rnE "['\"]\./feature-(796\.steps|820\.steps|932-world)\.ts['\"]" features/per-issue` prints
  nothing.
- `grep -rnE "'\.\./\.\./regression/step_definitions/feature-(796\.steps|820\.steps|932-world)\.ts'" features/per-issue | wc -l`
  prints `13`.

### 5. Re-tag the moved feature
In `features/regression/takeover/feature-959.feature`:
- Line 1 becomes exactly `@regression @dead-orchestrator-takeover`.
- Delete all 15 scenario-level tag lines. Fourteen are `  @adw-959 @adw-r5ifl5-bug-an-orchestrator`
  and one is `  @adw-959 @adw-r5ifl5-bug-an-orchestrator @adw-963`, above the foreign-lock scenario.
- Leave the scenarios, the Background, the `# ──` section comments and the Examples tables unchanged.
- `grep -nE '^\s*@' features/regression/takeover/feature-959.feature` must print exactly
  `1:@regression @dead-orchestrator-takeover`.

### 6. Keep the moved feature's description truthful
Rewrite only the three passages below in `features/regression/takeover/feature-959.feature`, keeping
the surrounding style: two-space indent, `•` bullets, about 100 columns. A description line must
never start with `@`.

- **The FLAGGED paragraph** (lines ~157–158) currently opens "FLAGGED BY THIS ISSUE. Four existing
  rows now also carry `@adw-959`. Each guards behaviour next to the code this issue changes, and none
  of the rows changes:".
  - Reword it to say that four existing rows guard behaviour next to the code this issue changed, and
    that none of them changed.
  - Add that they run under their own harness, never this file's hooks. The feature-908 row runs
    under feature-908's per-issue harness. The three feature-912 rows run under
    `@rate-limit-in-process-wait` in `features/regression/rate-limit/feature-912.feature`.
  - Keep its four bullets unchanged.
- **The HOOKS bullet** (lines ~284–289). Keep the first sentence, about initialising `mockContext`
  because T1 and T5 need it.
  - Replace "Scope every hook to `@adw-959 and not @adw-908 and not @adw-912`, because the flagged
    rows run under their own harness." with a sentence saying that every hook is scoped to
    `@dead-orchestrator-takeover`, the tag only this feature carries, so the flagged rows run under
    their own harness alone.
  - Replace the G-PQ14 sentence ("… cleaned up only by feature-911's `@adw-911 or
    @pause-queue-ownership` `After` hook: widen that hook to `@adw-959`, or export its cleanup.").
    The new sentence says that G-PQ14's holder process and lock are released by feature-911's exported
    `releaseHeldSpawnLocks`, which this feature's `After` hook calls.
- **The vocabulary note**, in two places.
  - Lines ~299–303 introduce feature-796's and feature-820's phrases as "per-issue phrases …
    reused because their world is exported for sharing". Keep the reuse explanation and the three
    phrases. Add that their step files moved into `features/regression/step_definitions/` together
    with this feature and with `feature-932-world.ts`, so no row depends on a swept per-issue file.
  - In the closing sentence (lines ~315–320), change "The registry has no phrase for the following,
    so novel phrasing is introduced for them:" to the past tense ("had … was introduced"). End the
    paragraph with: "They are registered in `features/regression/vocabulary.md` under
    `@dead-orchestrator-takeover` (G-DT1–G-DT14, W-DT1–W-DT4, T-DT1–T-DT9), G-DT1–G-DT3 being the
    reused feature-796 and feature-820 phrases."
- Change nothing else in the description. In particular, keep the incident narrative, §1–§6, the
  "Each row is written to fail" bullets and the step-definition notes.
- After editing, `grep -n "adw-959 and not" features/regression/takeover/feature-959.feature` must
  print nothing.

### 7. Re-key the hooks to the descriptive tag
- In `features/regression/step_definitions/feature-959-world.ts`, replace lines 8–9 with:
  ```ts
  /** Only feature-959 carries this tag; the flagged feature-908 and feature-912 rows run under their own harness. */
  export const OWN_ROWS = '@dead-orchestrator-takeover';
  ```
- In `features/regression/step_definitions/feature-959.steps.ts`, change the header comment's opening
  (lines 2–3) from "Hooks for feature-959. Every row is scoped to OWN_ROWS because the flagged
  feature-908 and feature-912 rows run under their own harness." to "Hooks for feature-959, scoped to
  OWN_ROWS, the tag only that feature carries: the flagged feature-908 and feature-912 rows run under
  their own harness."
  - Keep the rest of the comment.
  - Add no issue-number citation, per `.adw/coding_guidelines.md` **Comments**.
- Leave the `Before({ tags: OWN_ROWS }, …)` / `After({ tags: OWN_ROWS }, …)` call sites and the hook
  bodies unchanged. The hook tag must equal the feature's tag exactly. Otherwise cleanup silently
  stops while the scenarios still pass.
- `grep -rn "@adw-959" features/regression/step_definitions` must print nothing.

### 8. Update feature-908's cross-reference
- In `features/per-issue/feature-908.feature`, line ~106: change "specified in
  `features/per-issue/feature-959.feature`." to "specified in
  `features/regression/takeover/feature-959.feature`."
- Change nothing else in feature-908. Its outline keeps `@adw-959`, because it is another feature's
  per-issue row and its tags are out of this issue's scope.
- Do not edit `features/per-issue/feature-932.feature`. Its prose path to `feature-796.steps.ts` is
  corrected by #1003, which relocates that file (see Notes).

### 9. Register the phrases in `features/regression/vocabulary.md`
Append a new section after the `(@cost-records)` section, separated by `---` as the other sections
are. Every row has exactly five columns (`| # | Phrase | Semantics | Pattern | Assertion target |`).
- A phrase is written in backticks exactly as its cucumber expression is defined.
- No cell may contain a `|`.
- No row may name a source file as its assertion target.

**Section intro paragraph**, in the style of the `(@rate-limit-in-process-wait)` intro. It states the
following:

- **Execution patterns.**
  - The cron rows are phase-import. One poll is the real `runHungDetectorSweep` over the scenario's
    own adwIds, then one real `checkAndTrigger(boundary)` from feature-796's recording launch
    boundary.
  - The boundary's tracker and code host answer from an in-memory fixture and record every call. Its
    git context records every worktree reset and answers every other git call benignly.
  - `bunx` is shadowed on `PATH` by a recorder that logs each launch's argv and exits, so no
    orchestrator ever starts from a cron row.
  - The stand-ins for orchestrators are real throwaway children whose pid and start token are captured
    while they live.
  - The startup rows are subprocess. They launch the real orchestrator script the way the cron does,
    with a Claude CLI that exists but is not executable.
- **Asserted artefacts.**
  - recorded launches;
  - `agents/<adwId>/state.json`;
  - spawn-lock records under `agents/spawn_locks/`;
  - stand-in liveness;
  - recorded worktree resets;
  - `agents/<adwId>/<orchestrator>/execution.log`;
  - the launched orchestrator's exit code.

  No step reads, greps or parses a source file, satisfying the Rot-Detection Rubric.
- **Where the definitions live.**
  - `feature-959-workflow.steps.ts`, `feature-959-cron.steps.ts`, `feature-959-pr-review.steps.ts` and
    `feature-959-startup.steps.ts`;
  - their helpers `feature-959-world.ts`, `feature-959-boundary.ts`, `feature-959-orchestrator.ts`
    and `feature-959-processes.ts`;
  - G-DT1 in `feature-796.steps.ts`, and G-DT2 and G-DT3 in `feature-820.steps.ts`.

  The cron rows share `feature-932-world.ts`'s recorder.
- **Hooks.** The hooks in `feature-959.steps.ts` are keyed on `@dead-orchestrator-takeover`.
  - They set up the mock infrastructure.
  - They save, clear and restore `agents/paused_queue.json` and `agents/.auth_gate`.
  - They kill the stand-ins and end the in-process PR review.
  - They release the issues' spawn locks under both the boundary's and the checkout's repository.
  - They remove each adwId's state and log directories.
- **Rules for authors.**
  - A scenario using these phrases must carry that tag.
  - Issue numbers must be distinct across the run, because launches, locks and the cron's
    `processedSpawns` are keyed by issue.
  - adwIds use only lowercase letters, digits and hyphens.
  - The named repository must not exist (`adw-fixture/void-959`). The startup rows' target is the
    fictional `acme/widgets`.

**Rows.** Pattern / assertion target in brackets. Write the Semantics cell from the step
definition's actual behaviour. The summaries below are the required content.

- **G-DT1** `a launch boundary for the repository {string} whose providers record every call` —
  builds the recording launch boundary through the real `buildLaunchBoundary`. Its issue tracker and
  code host answer from an in-memory fixture (issues, labels, comments, states, created/updated
  times, pull requests) and record every call, and no call reaches a forge. Defined in
  `feature-796.steps.ts`. [phase-import / recording providers (SUT input)]
- **G-DT2** `issue {int} in the recording tracker carries the label {string}` — sets the issue's
  labels in the recording tracker's fixture to that one label. Fails unless G-DT1 ran first. Defined
  in `feature-820.steps.ts`. [phase-import / recording tracker fixture (SUT input)]
- **G-DT3** `issue {int} in the recording tracker carries the labels {string} and {string}` — as
  G-DT2, with both labels. Defined in `feature-820.steps.ts`. [phase-import / recording tracker
  fixture (SUT input)]
- **G-DT4** `issue {int} has an ADW workflow under adwId {string} that runs {string}, whose last run stopped at {string} half an hour ago`
  — seeds the issue in the recording tracker. It is created and updated long before the cron's grace
  period, carries an `**ADW ID:**` comment naming the adwId, and keeps any labels another step gave
  it. The step then writes the top-level state a run leaves, through
  `AgentStateManager.writeTopLevelState`:
  - the adwId and the issue;
  - the stage;
  - the script as `orchestratorScript`;
  - the boundary's repository;
  - a branch name;
  - a `lastSeenAt` half an hour old;
  - a completed plan phase older still;
  - no `pid` and no `resumeAttempts`.

  It wraps the boundary's git context so that a worktree reset is recorded and does nothing.
  [phase-import / state file artefact + recording tracker fixture]
- **G-DT5** `a relaunched orchestrator for workflow {string} recorded "starting" and died before its first phase`
  — starts a throwaway child and captures its pid and start token. It writes what
  `initializeWorkflow` has written once it records `starting`:
  - in the top-level state: stage `starting`, the script, repository and branch, the child's `pid`
    and `pidStartedAt`, and a fresh `lastSeenAt`;
  - the orchestrator sub-state `agents/<adwId>/<orchestrator>/state.json` with the child's pid;
  - the execution log's startup lines, ending `Allocated port 57665 for dev server`.

  It then kills the child and waits until it has exited. [phase-import / state file + orchestrator
  sub-state + execution log artefacts]
- **G-DT6** `the orchestrator of workflow {string} died at workflowStage {string} ten minutes ago, leaving the issue's spawn lock behind`
  — does what G-DT5 does, then writes:
  - the stage, and for `<phase>_running` also a running phase entry started more than ten minutes ago;
  - a `lastSeenAt` ten minutes old;
  - the real spawn lock for the issue under the boundary's repository, with the child's pid and start
    token.

  Then it kills the child. [phase-import / state file + spawn-lock artefacts]
- **G-DT7** `a relaunched orchestrator for workflow {string} is alive and still starting up, past recording "starting" but before its first phase`
  — as G-DT5, but the child stays alive until the `After` hook kills it. [phase-import / state file +
  orchestrator sub-state + execution log artefacts]
- **G-DT8** `a relaunched orchestrator for workflow {string} is alive and records "starting" between the cron's filtering of the issue and its takeover decision`
  — starts a live child and arms a one-shot trigger on the recording tracker's issue listing.
  - The trigger fires on the first unlabelled listing after the cron's labelled one: the concurrency
    check's listing, which falls after the poll's filter and before the takeover handler reads the
    state.
  - When it fires, it writes G-DT7's artefacts.
  - The poll fails unless the trigger fired.

  [phase-import / state file artefacts written mid-poll]
- **G-DT9** `the orchestrator of workflow {string} is alive at workflowStage {string}, holding the issue's spawn lock and heartbeating`
  — as G-DT6 with a live child: the stage, a `lastSeenAt` of now, and the spawn lock under the child's
  pid. The child stays alive. [phase-import / state file + spawn-lock artefacts]
- **G-DT10** `the cron's own process holds the spawn lock for issue {int} in the repository {string}`
  — takes the real spawn lock for `<repo>#<issue>` under this process's pid, because the cron runs
  in-process. It does nothing when this pid already holds the lock, as it does after a poll took the
  workflow over. [phase-import / spawn-lock artefact]
- **G-DT11** `the SDLC run of workflow {string} has exited, leaving its pid in the state` — starts and
  kills a throwaway child, then writes its pid and start token into the top-level state as `pid` and
  `pidStartedAt`. [phase-import / state file artefact]
- **G-DT12** `a PR review of workflow {string} has started up on the issue's pull request and has stood at workflowStage {string} for ten minutes`
  — does the following in order:
  1. Seeds an open pull request for the workflow's branch in the recording code host, linked to the
     issue.
  2. Declares application type `cli` in the PR worktree's `.adw/project.md`, under a directory the
     scenario removes.
  3. Runs the real `initializePRReviewWorkflow` against the boundary under the issue's adwId, and
     records `adws/adwPrReview.tsx` as the script.
  4. Holds the real `runWithOrchestratorLifecycle` (spawn lock and heartbeat) in this process until
     the `After` hook ends it.
  5. Writes the stage with a `lastSeenAt` of now and a running phase entry started more than ten
     minutes ago.

  [phase-import / state file + spawn-lock artefacts]
- **G-DT13** `the Claude CLI that ADW is configured to run exists but is not executable` — writes a
  shell script without the execute bit into a temporary directory. W-DT4 hands its absolute path to
  the launched orchestrator as `CLAUDE_CODE_PATH`. [subprocess / launched orchestrator environment
  (SUT input)]
- **G-DT14** `the execution log of the {string} for adwId {string} already ends with the line {string}`
  — appends the line to `agents/<adwId>/<orchestrator>/execution.log` through
  `AgentStateManager.appendLog`, as an earlier run would have. [phase-import / execution log artefact]
- **W-DT1** `the cron polls from that boundary, with its hung-orchestrator sweep due` — runs the real
  `runHungDetectorSweep` over this scenario's adwIds only, with production state reads and liveness.
  It then runs one real `checkAndTrigger` from the boundary, with `bunx` shadowed on `PATH` by the
  launch recorder. It fails if an armed G-DT8 trigger did not fire. The cron module's state
  (`processedSpawns`, the tick counter) lives on across polls in the same process. [phase-import /
  recorded launches + state file + spawn-lock + recorded resets]
- **W-DT2** `the same cron polls again from that boundary, with its hung-orchestrator sweep due` —
  W-DT1 again in the same process, so the cron is never restarted between the polls. [phase-import /
  recorded launches + state file + spawn-lock + recorded resets]
- **W-DT3** `the orchestrator the cron relaunched for workflow {string} records "starting" exactly as #935's relaunched orchestrator did, and dies before its first phase`
  — writes what `initializeWorkflow` wrote before the fix, then kills a throwaway child:
  - in the top-level state: stage `starting`, with the script, repository and branch merged over the
    previous state (its `lastSeenAt` kept), and no `pid` or `pidStartedAt`;
  - the orchestrator sub-state with the child's pid;
  - the execution log's startup lines, ending `Allocated port 57665 for dev server`.

  It takes no spawn lock. [phase-import / state file + orchestrator sub-state + execution log
  artefacts]
- **W-DT4** `the orchestrator {string} is launched as the cron launches it, for issue {int} under adwId {string} and the target repository {string}, with its output discarded`
  — spawns the real orchestrator script from the ADW checkout as
  `bunx tsx <script> <issue> <adwId> --target-repo <repo>`.
  - The child is detached, with its stdio ignored, G-DT13's CLI as `CLAUDE_CODE_PATH` and the GitHub
    App variables blanked.
  - It removes `agents/<adwId>` first, unless G-DT14 seeded its log.
  - It waits, bounded, for the child to exit and records the exit code in `World.lastExitCode`, which
    T5 reads.

  [subprocess / exit code + execution log artefact]
- **T-DT1** `the cron has launched {int} orchestrator(s) for issue {int}` — waits, bounded, until the
  recorder holds N launches whose first argument after the script is the issue. It then waits a quiet
  second and asserts exactly N. [phase-import / recorded launches]
- **T-DT2** `the cron launched no orchestrator for issue {int}` — waits a quiet second, then asserts
  no recorded launch for the issue. [phase-import / recorded launches]
- **T-DT3** `every orchestrator the cron launched for issue {int} runs {string} under adwId {string}`
  — asserts at least one launch for the issue, and that every one runs the script (compared
  repo-relative) under the adwId. [phase-import / recorded launches]
- **T-DT4** `the orchestrator process of workflow {string} is still alive` — asserts the workflow's
  stand-in process is alive by pid and start token (`isProcessLive`). [phase-import / process table]
- **T-DT5** `the worktree of workflow {string} was not reset` — asserts the boundary's git context
  recorded no worktree reset of the workflow's branch or worktree path. [mock-query / recorded
  worktree resets]
- **T-DT6** `nothing but the orchestrator of workflow {string} holds the issue's spawn lock` — checks
  two repositories: the boundary's, and the checkout's own (the cron module's release identity). For
  each, it asserts the issue's spawn-lock record is absent or records the workflow's stand-in pid.
  [phase-import / spawn-lock artefact]
- **T-DT7** `the execution log of the {string} for adwId {string} records the error that stopped its startup`
  — reads `agents/<adwId>/<orchestrator>/execution.log` and asserts a line timestamped at or after
  the launch that names G-DT13's non-executable path, the path the pre-flight check rejected.
  [subprocess / execution log artefact]
- **T-DT8** `the execution log of the {string} for adwId {string} still holds the line {string}` —
  asserts the log still holds the line. [subprocess / execution log artefact]
- **T-DT9** `the execution log of the {string} for adwId {string} records the error that stopped its startup, after the line {string}`
  — as T-DT7, with the startup error's line coming after the given line. [subprocess / execution log
  artefact]

**Closing paragraph:** "This section also reuses already-registered phrases, so they need no new
rows." List them:
- G18 (Background);
- G-PQ14, whose holder is released by feature-911's exported `releaseHeldSpawnLocks`, which these
  hooks call;
- T1, read from `agents/<adwId>/state.json`;
- T5, the exit code W-DT4 records;
- T22;
- the git/gh guard pair W16/T34.

**Coverage of the issue's list.** Every phrase in the issue's "Phrases to register" list is an
instance of exactly one row:

| Registry row | Issue-listed phrases it covers |
|---|---|
| G-DT1 | `a launch boundary for the repository "adw-fixture/void-959" whose providers record every call` |
| G-DT2 / G-DT3 | `issue 9582 … carries the label "adw:bug"` / `issue 9581 … carries the labels "adw:bug" and "adw:none"` |
| G-DT4 | every `issue … has an ADW workflow under adwId … that runs …, whose last run stopped at … half an hour ago` (`<script>`, `adws/adwSdlc.tsx`, `adws/adwChore.tsx` and `<stage>`, `phase_timeout` / `awaiting_merge`, issues 9535, 9580–9582, 9585, 9596, 9597, 9600) |
| G-DT5 | every `a relaunched orchestrator for workflow … recorded "starting" and died before its first phase` |
| G-DT6, G-DT7, G-DT8, G-DT9 | the died-holding-the-lock, still-starting-up, records-mid-poll and alive-heartbeating Givens |
| G-DT10 | every `the cron's own process holds the spawn lock for issue … in the repository "adw-fixture/void-959"` |
| G-DT11, G-DT12 | the exited SDLC run and the started-up PR review of `prr959-9600` |
| G-DT13, G-DT14 | the non-executable Claude CLI; the log that already ends with `Allocated port 57665 for dev server` |
| W-DT1, W-DT2, W-DT3, W-DT4 | the poll, the second poll, #935's shape, the cron-style launch |
| T-DT1 | `the cron has launched 1 orchestrator …` and `… 2 orchestrators for issue 9535` |
| T-DT2 … T-DT6 | the no-launch, every-launch, still-alive, not-reset and only-holder assertions |
| T-DT7, T-DT8, T-DT9 | the three execution-log assertions |
| G-PQ14 (reused) | `another live process holds the spawn lock for issue 9580 in the repository "adw-fixture/void-959"` |
| T1, T5, T22, W16, T34 (reused) | `the state file for adwId … records workflowStage …`, `the orchestrator subprocess exited 1`, the type-check, the git/gh guard pair |

### 10. Add the README tree line
In `README.md`'s `features/` tree, insert the following line after the `surfaces/` line and before
the `upgrade/` line:
```
│   ├── takeover/       # Regression scenarios covering the cron taking over a workflow whose orchestrator died in starting or in a running stage under its adwId, a live orchestrator never killed, reset or doubled, a spawn lock the cron itself left behind, and an orchestrator logging the error that stopped its startup (#959)
```
`takeover/` plus seven spaces aligns the `#` with its siblings.

### 11. Unit tests: no new test, existing coverage re-run
- `.github/adw.yml` leaves `unitTests` commented out, so unit tests are enabled.
- This promotion changes no production code and no pure logic. Its TypeScript diff consists of:
  - import specifier strings;
  - one hook-tag string;
  - one JSDoc and one header comment.

  There is nothing for a new Vitest test to pin. A test that greps `vocabulary.md` or a `.feature`
  file for the new rows would be the source-file assertion the Rot-Detection Rubric forbids.
- Re-run the owning unit coverage instead:
  - `bunx vitest run adws/promotion/__tests__/vocabularyParser.test.ts` covers the registry format the
    new section must satisfy.
  - `bun run test:unit` runs the whole suite.

### 12. Run the Validation Commands
- Run every command under `Validation Commands`, in order.
- Fix any failure at its cause, never by editing a scenario's assertions.
- The primary acceptance is `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`:
  green, including the 23 moved test cases, with no ambiguous and no undefined step.

## Testing Strategy
### Unit Tests
- No new unit tests. The change is a relocation of BDD scenarios plus test-harness tag, import and
  comment edits, and registry Markdown. No production module, pure function or branch changes, so
  there is no new logic for Vitest to cover (`.adw/coding_guidelines.md` **Testing**: unit tests cover
  pure logic). The behavioural proof is the scenarios themselves, now running under `@regression`.
- Existing coverage re-run:
  - `adws/promotion/__tests__/vocabularyParser.test.ts`: the registry format the new rows follow.
  - `bun run test:unit`: the full suite, to prove zero regressions.

### Edge Cases
- **The hook tag drifts from the feature tag.** If `OWN_ROWS` were not exactly
  `@dead-orchestrator-takeover`, several things would silently stop:
  - the `Before` would stop initialising `mockContext`, saving and clearing the pause queue and auth
    gate, and installing the `bunx` shadow;
  - the `After` would stop killing stand-ins, releasing spawn locks and removing `agents/<adwId>`.

  The rows might still pass alone but corrupt later rows. The `--tags "@dead-orchestrator-takeover"`
  dry-run and real run, plus the grep in Task 7, pin it.
- **Hook order flips.** The moved hooks now load before `features/regression/support/hooks.ts`
  (`cucumber.js` imports `features/regression/step_definitions/**` before `support/**`).
  - `Before`: 959's `setupMockInfrastructure()` runs first. The `@regression` `Before` call that
    follows is idempotent: it returns the existing context.
  - `After` (reverse definition order): the `@regression` teardown now runs first. It calls
    `runCleanup` (which also releases G-PQ14's holder, queued on `World.cleanup`),
    `teardownMockInfrastructure` and the World reset.
  - 959's `After` then kills stand-ins, ends the PR review lifecycle, releases locks
    (`releaseHeldSpawnLocks` is idempotent), restores the two files and calls
    `teardownMockInfrastructure` again, which is harmless. None of it needs the mock server. This is
    the same order #912's and #930's promoted hooks run in.
- **Module identity.** Per-issue importers now reach `feature-796.steps.ts`, `feature-820.steps.ts` and
  `feature-932-world.ts` by `../../regression/step_definitions/…`. That is the same absolute module
  Cucumber's glob loads, so there is one `world796()` and one `s`, and no step is registered twice. A
  wrong specifier fails the root `tsc` (TS2307) and the Cucumber load, never silently.
- **No new ambiguity.** Pure moves leave the loaded step set unchanged. Ambiguity would need a copy,
  and Task 1's precondition and the closure list rule copies out. The `@regression` dry-run proves it.
- **`@adw-959` after the move.** `--tags "@adw-959"` now selects only feature-908's flagged per-issue
  outline, and none of this feature's rows. That is harmless, and those rows run under feature-908's
  harness.
- **`@adw-963` dropped from the foreign-lock row.** feature-963's hooks are keyed on its own feature
  tag, never `@adw-963`, so no harness loses a row.
- **The per-issue TTL sweep.** Nothing of the closure stays under `features/per-issue/`. A later sweep
  of feature-932 deletes only `feature-932.steps.ts` (sibling rule `feature-932.`), never the moved
  `feature-932-world.ts`.
- **The process-wide cron tick counter.** In a `@regression` run, this feature is the only in-process
  `checkAndTrigger` caller (feature-911's cron is a real subprocess). Its roughly 16 polls cross ticks
  5, 10 and 15:
  - Ticks 5, 10 and 15 run the hung sweep over the working directory's `agents/`.
  - Tick 15 runs the janitor against the `TARGET_REPOS_DIR` that `cucumber.js` pins to an empty
    directory, and runs a probe cycle over the emptied pause queue.

  The per-issue, promotion and docs-index sweeps (cadence 4320) are never reached. This is the same as
  under `@adw-959` today. Run the suite from a worktree, as ADW's test phase does.
- **Runtime budget.**
  - §5 launches five real orchestrators, each bounded at 45 s, though they normally exit within
    seconds of the pre-flight check.
  - Every cron Then waits a 1 s quiet period.
  - The daily workflow's host and Docker jobs have 30-minute timeouts. Confirm the `@regression` run
    stays well inside them.
- **Docker leg.** The suite runs in a writable `cp -R` copy of the checkout. The rows write only under
  `agents/` and `os.tmpdir()` and spawn `bunx tsx` as other regression rows already do, so no
  read-only path is touched.

## Acceptance Criteria
- `features/regression/takeover/feature-959.feature` exists. Its only tag line is line 1,
  `@regression @dead-orchestrator-takeover`. No `@adw-` or `@promotion-suggested-` tag remains at
  feature or scenario level.
- `features/per-issue/feature-959.feature` and every `features/per-issue/step_definitions/feature-959*`
  file no longer exist. Neither do `features/per-issue/step_definitions/feature-796.steps.ts`,
  `feature-820.steps.ts` and `feature-932-world.ts`.
- The 12-file closure lives flat in `features/regression/step_definitions/`, moved with `git mv`.
  - Their import specifiers are unchanged.
  - The only content edits are `OWN_ROWS`, its JSDoc, and the `feature-959.steps.ts` header comment.
- Every 959 `Before`/`After` hook is keyed on `@dead-orchestrator-takeover`.
  `grep -rn "@adw-959" features/regression/step_definitions` prints nothing.
- No per-issue file imports `./feature-796.steps.ts`, `./feature-820.steps.ts` or
  `./feature-932-world.ts`. The 13 stay-behind specifiers point at
  `../../regression/step_definitions/…`.
- The moved feature's description no longer names the old hook expression or calls the reused phrases
  per-issue. It points to the `@dead-orchestrator-takeover` registry section. feature-908 points to the
  new path.
- `features/regression/vocabulary.md` has a
  `## Given/When/Then — Dead-Orchestrator Takeover and Startup-Failure Logging (@dead-orchestrator-takeover)`
  section.
  - It has 27 rows: G-DT1–14, W-DT1–4 and T-DT1–9.
  - Each row has five columns, a backticked cucumber expression, a valid pattern, and a runtime
    artefact as its assertion target.
  - Every phrase in the issue's list maps to a new or reused row.
- `README.md`'s `features/` tree lists `takeover/`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@dead-orchestrator-takeover"` runs 23 scenarios,
  and all 23 pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` is green, includes the moved
  scenarios, and reports no ambiguous or undefined step.
- `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build` and
  `bun run test:unit` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `test -z "$(find features/per-issue \( -name 'feature-959*' -o -name 'feature-796.steps.ts' -o -name 'feature-820.steps.ts' -o -name 'feature-932-world.ts' \))" && echo MOVED-OK`:
  prints `MOVED-OK`, because the old per-issue paths no longer exist.
- `ls features/regression/takeover/feature-959.feature features/regression/step_definitions/feature-959*.ts features/regression/step_definitions/feature-796.steps.ts features/regression/step_definitions/feature-820.steps.ts features/regression/step_definitions/feature-932-world.ts | wc -l`:
  prints `13`.
- `grep -nE '^\s*@' features/regression/takeover/feature-959.feature`: prints exactly
  `1:@regression @dead-orchestrator-takeover`.
- `grep -n "OWN_ROWS = " features/regression/step_definitions/feature-959-world.ts`: prints the line
  holding `'@dead-orchestrator-takeover'`.
- `! grep -rn "@adw-959" features/regression/step_definitions`: no hook in the moved files is keyed on
  a per-issue tag.
- `! grep -rnE "['\"]\./feature-(796\.steps|820\.steps|932-world)\.ts['\"]" features/per-issue`: no
  stranded specifier.
- `grep -rnE "'\.\./\.\./regression/step_definitions/feature-(796\.steps|820\.steps|932-world)\.ts'" features/per-issue | wc -l`:
  prints `13`.
- `grep -cE '^\| [GWT]-DT[0-9]+ \|' features/regression/vocabulary.md`: prints `27`.
- `grep -E '^\| [GWT]-DT' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u`:
  prints only `7`, so every new row has exactly five columns.
- `bunx tsc --noEmit`: the root type-check passes. It covers `features/**`, so it proves every moved
  and repointed import resolves.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run lint`: the linter passes.
- `bun run build`: the build succeeds.
- `bunx vitest run adws/promotion/__tests__/vocabularyParser.test.ts`: the registry-format unit tests
  pass.
- `bun run test:unit`: the unit suite passes with zero regressions.
- `bun run lint:docs-index`: the living-docs index stays clean, since the moved files remain under
  `features/regression/**`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@dead-orchestrator-takeover" --dry-run`: 23
  scenarios, no undefined and no ambiguous step.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-848 or @adw-929 or @adw-932 or @adw-933 or @adw-988" --dry-run`:
  the per-issue features whose step files were repointed still bind every step, with no undefined and
  no ambiguous step.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run`: the whole regression
  suite binds every step, with no undefined and no ambiguous step.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@dead-orchestrator-takeover"`: 23 scenarios, 23
  passed, under the `@regression` hooks.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the full regression suite is
  green and includes the moved feature. This is the primary acceptance command.

## Notes
- **Coding guidelines.** Adhere to `.adw/coding_guidelines.md`. Apart from Markdown and file moves, the
  TypeScript diff is:
  - 13 import specifier strings;
  - one tag string;
  - one JSDoc;
  - one header comment.

  Per **Comments**, the edited comments state only the non-obvious reason (the flagged rows run under
  their own harness) and cite no issue number. Do not touch logic in any moved file.
- **`hitl` is set.** The resulting PR must be human-approved before merge, so do not auto-merge it.
  Its `regression-promotion` label triggers the non-blocking rot/reuse advisory comment
  (`adws/phases/promotionRotAdvisory.ts`).
- **The issue under-lists its sources.** It names only `feature-959.steps.ts`. Moving that file alone,
  or rewriting the moved files' imports toward `features/per-issue/`, would contradict both the issue
  ("Do not rewrite the step-def files' relative imports") and the documented rule that nothing in the
  regression suite depends on per-issue files. That is why the closure (feature-959's nine files plus
  the shared 796/820/932-world harness) moves together.
- **Overlap with the concurrent #932 promotion (#1003).** Branch `feature-issue-1003` plans to move the
  same three shared files (`feature-796.steps.ts`, `feature-820.steps.ts`, `feature-932-world.ts`) to
  the same destination, with no content change apart from a `claudeShadowPath()` addition.
  - Identical renames merge cleanly.
  - If #1003 lands first:
    - Its repointing of the `feature-959*` files' imports carries over to the moved files and still
      resolves.
    - Task 1's branch skips the shared moves.
    - The importer repoints overlap. Equal edits merge cleanly, and adjacent hunks in
      `feature-932*.steps.ts` may need the resolve-conflict step.
  - #1003 also registers the 796/820 phrases in its `(@label-routing)` section. Whichever PR lands
    second must keep one row per phrase. The parser keys rows by phrase, so a duplicate does not
    break parsing, but it is untidy.
  - This plan deliberately leaves `features/per-issue/feature-932.feature`'s prose alone, because
    #1003 rewrites it.
- **Out of scope.**
  - The `@adw-959` tag on feature-908's flagged outline, which belongs to another per-issue feature.
  - The dormant `@adw-796`/`@adw-820` hooks.
  - The `app_docs/` and `.adw/conditional_docs.md` entries for the promoted scenario. The document
    phase updates `app_docs/feature-9gjajh-bdd-regression-suite.md` ("Maintain
    `features/regression/takeover/` …") and its conditional-docs line, as it did for #912, #930 and
    #936.
- **No new library** is needed, so `bun add` is not used.
