# Feature: Promote #937's review-comment screenshots scenario into the @regression suite

## Metadata
issueNumber: `1005`
adwId: `1hmls9-feat-promote-937-sce`
issueJson: `{"number":1005,"title":"feat: promote #937 scenario into the @regression suite","body":"Promotes: feature-937\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-937` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-937.feature features/regression/<subdir>/feature-937.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-937.steps.ts features/regression/step_definitions/feature-937.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-937.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-937.steps.ts`\n\n## Phrases to register\n\n- `a review workflow for issue 9371 under adwId \"shots937-pass\" whose issue tracker records every comment`\n- `the scenario run for that workflow leaves these screenshots in its proof directory:`\n- `the stand-in review agent passes the review`\n- `the scenario tests run and the review phase judges their proof`\n- `the review phase returned a passing verdict`\n- `issue 9371 received a comment headed \"Review Passed\"`\n- `the \"Review Passed\" comment on issue 9371 shows exactly these screenshots, each embedded as an image from a URL its upload returned:`\n- `a review workflow for issue 9372 under adwId \"shots937-fail\" whose issue tracker records every comment`\n- `the stand-in review agent fails the review with the blocker \"The login form accepts an empty password\"`\n- `the review phase returned a failing verdict`\n- `issue 9372 received a comment headed \"Review Failed\"`\n- `the \"Review Failed\" comment on issue 9372 shows exactly these screenshots, each embedded as an image from a URL its upload returned:`\n- `the \"Review Failed\" comment on issue 9372 still lists the blocker \"The login form accepts an empty password\"`\n- `a review workflow for issue 9373 under adwId \"only937-images\" whose issue tracker records every comment`\n- `the scenario run for that workflow also leaves the file \"login/browser-console.log\" in its proof directory`\n- `the stand-in review agent's verdict lists the scenario proof file as its proof artifact`\n- `the screenshot store received uploads of these screenshots and of nothing else:`\n- `the \"Review Passed\" comment on issue 9373 shows exactly these screenshots, each embedded as an image from a URL its upload returned:`\n- `a review workflow for issue 9374 under adwId \"retest937-shots\" whose issue tracker records every comment`\n- `the stand-in review agent fails the review with the blocker \"The login button does nothing\"`\n- `the next scenario run for that workflow leaves only the screenshot \"login/step-3.png\" in its proof directory`\n- `the scenario tests run again and the review phase judges their new proof`\n- `the \"Review Failed\" comment on issue 9374 shows exactly these screenshots, each embedded as an image from a URL its upload returned:`\n- `the \"Review Passed\" comment on issue 9374 shows exactly these screenshots, each embedded as an image from a URL its upload returned:`\n- `a review workflow for issue 9375 under adwId \"refused937-upload\" whose issue tracker records every comment`\n- `the screenshot store refuses the upload of \"checkout/cart.jpg\"`\n- `the \"Review Passed\" comment on issue 9375 shows exactly these screenshots, each embedded as an image from a URL its upload returned:`\n- `a review workflow for issue 9376 under adwId \"noshots937\" whose issue tracker records every comment`\n- `the scenario run for that workflow leaves no screenshots in its proof directory`\n- `issue 9376 received a comment headed \"Review Passed\"`\n- `the \"Review Passed\" comment on issue 9376 embeds no image`\n- `the screenshot store received no upload`\n- `a review workflow for issue 9377 under adwId \"noscen937\" whose issue tracker records every comment`\n- `the repository of that workflow has no scenarios configured`\n- `issue 9377 received a comment headed \"Review Passed\"`\n- `the \"Review Passed\" comment on issue 9377 embeds no image`\n- `the ADW TypeScript type-check passes`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-937.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-04T15:36:25Z","comments":[],"actionableComment":null}`

## Feature Description
`features/per-issue/feature-937.feature` (`@adw-937 @adw-axbb2a-bug-review-checks-st
@promotion-suggested-2026-10-04`) specifies what the review phase's comment on the issue shows. The
fix it guarded (#937) is merged. It holds 8 scenarios and 72 steps, Background included:

| § | Scenarios | Behaviour guarded |
|---|---|---|
| §1 | 2 | A passing and a failing review whose proof run left screenshots show every one of them in the "Review Passed" / "Review Failed" comment on the issue, each embedded from a URL its upload returned. The screenshots sit in scenario folders and at the top level, as PNG and JPEG. The failing comment still lists its blocker. |
| §2 | 2 | Only the images of the proof run the review judged are uploaded and shown. The scenario proof file the review agent lists as its proof artifact is not, and neither is a non-image file in the proof directory. After a failed review, the re-test's run replaces the screenshots, and the next comment shows only the new run's. |
| §3 | 3 | A screenshot never decides or blocks the review. An upload the store refuses is left out and the verdict stands. A run with no screenshots, and a repository with no scenarios configured, get today's comment, with no image and no upload. |
| §4 | 1 | Backstop: the TypeScript type-check (T22). |

The scenarios run the real `executeScenarioTestPhase` and then the real `executeReviewPhase`. Only
two boundaries are replaced:
- R2, by a recording stand-in screenshot store installed through `setProofUploaderForTesting`;
- the review agent, by the Claude CLI stub answering a scripted verdict through its manifest marker.

Every assertion reads a runtime artefact:
- the comments a recording issue tracker received;
- the bytes the stand-in store received, and the URL it returned for each;
- what the review phase returned or threw.

No step reads a source file.

This feature moves the scenario into the standing `@regression` suite as
`features/regression/review/feature-937.feature`, tagged `@regression @review-comment-screenshots`.
It is the direct relocation the issue describes (the #734 shape). Four points go beyond the issue's
text.

1. **The step definitions are a five-file closure, not one file.** The issue names only
   `feature-937.steps.ts`, which holds the hooks, Givens and Whens. That is a known under-listing:
   the promotion issue builder matches only `feature-N.`-prefixed basenames
   (`app_docs/feature-9gjajh-bdd-regression-suite.md`, line 115). Four hyphen-named siblings complete
   the closure. All of them are reached through `./feature-937-*.ts` imports:
   - `feature-937-then.steps.ts`: every Then step;
   - `feature-937-world.ts`: the module-scoped world, the recording issue tracker and the stand-in store;
   - `feature-937-workflow.ts`: the `WorkflowConfig` builder and the scenario-then-review run;
   - `feature-937-agent.ts`: the stand-in review agent (`CLAUDE_CODE_PATH` and the stub manifest).

   No other file in the repository imports any of the five, so no importer needs repointing.
2. **The hooks are re-keyed.** `Before`/`After` in `feature-937.steps.ts` are scoped to
   `@adw-937`, a tag the promoted feature can no longer carry. They are re-keyed to
   `@review-comment-screenshots`, the descriptive tag only this feature carries.
3. **The `CLAUDE_CODE_PATH` restore becomes order-independent.** Under `@regression`, the suite's
   `setupMockInfrastructure()` also manages `CLAUDE_CODE_PATH`. Step files in
   `features/regression/step_definitions/` register before `features/regression/support/hooks.ts`, so
   the `@regression` teardown's `After` runs before this feature's `After`. The documented rule
   (line 117 of the same app doc, the #930 precedent) is that such a step file writes the saved value
   back only while the variable still names its own stand-in. `deactivateStandInAgent()` gets that
   three-line guard.
4. **The Background phrase is registered too.** The issue's phrase list is extracted by
   `adws/promotion/scenarioParser.ts`, which reads only `Scenario` children, never the `Background`.
   So it omits `the screenshot store records every upload and answers each with a public URL of its
   own`, which every scenario runs.

The issue's 37 listed phrases are concrete instances of 19 cucumber expressions plus the
already-registered T22. With the Background phrase that makes 20 new rows: G-RS1–G-RS10, W-RS1–W-RS3
and T-RS1–T-RS7. They go in a new rubric-compliant `(@review-comment-screenshots)` section of
`features/regression/vocabulary.md`. G18 and T22 are reused. The README's `features/` tree gains the
`review/` line.

Today these invariants run only when someone runs `@adw-937`. After the move they run on every
`@regression` invocation:
- every ADW workflow's scenario test phase;
- the daily `Regression Scenarios` workflow, host and Docker;
- local runs.

The invariants are:
- review comments show the screenshots of the proof the review judged;
- they use the URLs the uploads returned;
- they show none of an earlier attempt's screenshots;
- a screenshot never blocks or changes a review.

## User Story
As an ADW maintainer
I want #937's review-comment screenshot scenarios to run in the standing `@regression` suite
So that a later change to the scenario test phase, the proof uploader, the review phase or the review comment formatters is caught by every regression run. That covers a change that drops the screenshots from the issue's review comment, embeds the wrong images, carries an earlier attempt's images forward, or lets a failed upload fail the review.

## Problem Statement
- **Not in the regression run.** `features/per-issue/feature-937.feature` carries no `@regression`
  tag. Only #937's own workflow ran it, by `@adw-937`, and that workflow is finished. Nothing fails
  today when a later change breaks any of these:
  - `uploadReviewedProofScreenshots` (`adws/phases/reviewPhase.ts`);
  - the `uploadProofArtifacts`/`setProofUploaderForTesting` seam (`adws/proof/proofUploader.ts`);
  - the screenshot section of `formatReviewProofComment` (`adws/forge/proofCommentFormatter.ts`).
- **The one-file move the issue describes cannot work.**
  - Moving only `feature-937.steps.ts` leaves its imports of `./feature-937-agent.ts`,
    `./feature-937-workflow.ts` and `./feature-937-world.ts` dangling. A dangling import crashes the
    whole Cucumber load, not just this feature.
  - The siblings left behind would split the Then steps from the Givens across the two suites.
  - The per-issue TTL sweep's sibling rule (`feature-937.`) would never delete the hyphenated
    siblings, so they would be orphaned in `features/per-issue/step_definitions/` for good.
  - Rewriting the specifiers to `../../per-issue/step_definitions/…` would break the issue's "do not
    rewrite the relative imports". It would also leave a regression feature depending on per-issue
    files, which the documented promotion rule forbids (app doc, line 108).
- **Hooks keyed on a per-issue tag.** Both hooks are keyed on `@adw-937`, and a regression feature
  carries no `@adw-` tag. Un-keyed hooks would stop running without any error:
  - The `Before` would no longer call `resetWorld()`. The module-scoped store, verdict, recorded
    comments and outcome would then bleed from one scenario into the next.
  - The `After` would no longer remove the stand-in uploader or restore `CLAUDE_CODE_PATH`, both of
    which matter when a run fails part-way.
  - It would also stop removing `agents/<adwId>` and the throwaway worktree, log and proof-run
    directories.
  - The scenarios might still pass, or might pass one at a time and corrupt later rows.
- **A new hook-order hazard.** Once the feature runs under `@regression`, the suite's
  `setupMockInfrastructure()` sets `CLAUDE_CODE_PATH` to the same stub, and
  `teardownMockInfrastructure()` restores the original.
  - The moved step file registers before `support/hooks.ts`, so that teardown runs before this
    feature's `After`.
  - If a When step times out, `world.claudeCodePath` is still set when the `After` runs. The
    unconditional write-back in `deactivateStandInAgent()` would then reinstate the stub path the
    teardown had just undone, and leak it into every later scenario in the process.
- **Stale description.** Three parts of the feature's notes would contradict the code after the move:
  - the HOOKS bullet says to scope every hook to `@adw-937`;
  - the REUSED bullet places G18 in `features/step_definitions/` (it is defined in
    `features/regression/step_definitions/givenSteps.ts`);
  - the vocabulary note says the registry "has no phrase" for the novel phrasing.
- **Unregistered phrases.** The vocabulary registry has no entry for any of the 20 novel phrases, and
  the issue's list omits the Background one.

## Solution Statement
A direct relocation that follows the conventions in
`app_docs/feature-9gjajh-bdd-regression-suite.md` (lines 58, 107–108 and 114–117) and the last six
promotions (#909, #912, #930, #932, #936 and #959):

1. **Move the feature** to `features/regression/review/feature-937.feature` with `git mv`.
   - `review` names the scenario's subject, the review phase's comment on the issue. It is short and
     matches the existing subject names (`cost/`, `labels/`, `takeover/`).
   - It leaves room for later review-phase promotions, as `pause-queue/` holds two features.
   - It sits alphabetically between `rate-limit/` and `smoke/`.
2. **Re-tag it.**
   - Line 1 becomes `@regression @review-comment-screenshots`. That drops `@adw-937`,
     `@adw-axbb2a-bug-review-checks-st` and `@promotion-suggested-2026-10-04`. Only the per-issue
     sweeps read the promotion marker (app doc, line 114).
   - Delete all eight scenario-level tag lines (`@adw-937 @adw-axbb2a-bug-review-checks-st`).
   - `@review-comment-screenshots` is not used anywhere in the repo, and it does not start with `@adw-`.
3. **Move the five-file step-definition closure** flat into `features/regression/step_definitions/`
   with `git mv`. No import specifier changes:
   - the co-located `./feature-937-*.ts` imports sit in the same directory again;
   - every `../../../adws/…` specifier, and `feature-937-agent.ts`'s
     `path.resolve(…, '../../..')` repo root, resolve identically from another directory three levels
     deep.
4. **Re-key the hooks.** `Before({ tags: '@adw-937' })` and `After({ tags: '@adw-937' })` in the moved
   `feature-937.steps.ts` become `{ tags: '@review-comment-screenshots' }`. The hook tag must equal the
   feature's tag exactly; otherwise cleanup silently stops while the scenarios still pass.
5. **Make the `CLAUDE_CODE_PATH` restore order-independent.** In the moved `feature-937-agent.ts`,
   `deactivateStandInAgent()` writes `previous` back only while `CLAUDE_CODE_PATH` still equals
   `CLAUDE_CLI_STUB_PATH`. It still nulls `world.claudeCodePath` and clears the CLI path cache. On the
   normal path, the call in the When step's `finally` while the mock infrastructure is up, behaviour
   is unchanged.
6. **Keep the prose truthful.** In the moved feature's description, edit only three things:
   - the HOOKS bullet, to name the new tag;
   - the REUSED bullet, to correct where G18 is defined;
   - the vocabulary note's closing sentence, to the past tense plus a pointer to the new registry
     section.
7. **Register the phrases.** Add a new
   `## Given/When/Then — Review Comment Screenshots (@review-comment-screenshots)` section to the end of
   `features/regression/vocabulary.md` with 20 five-column rows: G-RS1–G-RS10, W-RS1–W-RS3 and
   T-RS1–T-RS7.
   - The `RS` prefix is unused.
   - G18 and T22 are reused.
   - The parser (`adws/promotion/vocabularyParser.ts`) reads every `## Given|When|Then…` section's rows.
8. **README.** Add the `review/` line to the `features/regression/` tree.

No production code changes, no new library, and no step definition is added, copied or redefined.
`cucumber.js` imports both step-definition directories whatever the tags, so Cucumber loads the same
set of step definitions before and after. No ambiguous or undefined step can be introduced.

## Relevant Files
Use these files to implement the feature:

- `README.md`: project overview. Its `features/` tree (lines ~1203–1228) lists each
  `features/regression/` subdirectory with a one-line description. The new `review/` line goes between
  `rate-limit/` and `smoke/`, with the name padded to the same column as its neighbours.
- `.adw/coding_guidelines.md`: the coding guidelines. The **Comments** rule governs the one comment
  added in `feature-937-agent.ts`: state the ordering constraint and cite no issue number.
- `.adw/scenarios.md` / `.adw/commands.md`: the regression scenario directory, the vocabulary registry
  path, and the validation commands.
- `cucumber.js`: `paths` covers `features/regression/**/*.feature`, so the new `review/` subdirectory is
  picked up. The `import` order (`features/regression/step_definitions/**` before
  `features/regression/support/**`) is what puts the `@regression` teardown's `After` first.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` (conditional doc: "When manually promoting a
  `features/per-issue/` scenario into `features/regression/`"). These are the promotion rules this plan
  follows:
  - line 58: move the closure with imports unchanged;
  - lines 107–108: the hand-promotion recipe, and promoting the whole dependency closure;
  - line 114: drop every `@adw-` tag and `@promotion-suggested-*`, and re-key hooks to a descriptive
    tag equal to the feature's;
  - line 115: under-listed step-def sources;
  - line 117: the order-independent `CLAUDE_CODE_PATH` restore under the `@regression` teardown;
  - line 120: the git mock is transparent to local git.
- `app_docs/feature-9gjajh-bdd-per-issue.md` (conditional doc: per-issue scenario files and step
  definitions in `features/per-issue/`): context for the source directory the files leave.
- `app_docs/feature-9gjajh-promotion-system.md` (conditional doc: promotion tag state, the promotion
  issue body, the rot/reuse advisory): the `@promotion-suggested-<date>` marker that is dropped. It also
  explains why the issue's list under-lists the step files and the Background phrase (`promotionIssueBody.ts`,
  `adws/promotion/scenarioParser.ts`).
- `app_docs/feature-9gjajh-proof-and-scenario-proof.md` (conditional doc: "R2 proof upload
  (`uploadProofArtifacts`, `setProofUploaderForTesting`) … screenshots in review comments"): the
  behaviour §1–§3 guard. Use it to write accurate vocabulary semantics.
- `app_docs/feature-9gjajh-review-and-diff-phases.md` (conditional doc: the review phase): what
  `executeReviewPhase` does with the proof path and the screenshot URLs.
- `features/per-issue/feature-937.feature`: the source feature, moved and re-tagged.
  - Edited tag lines: line 1, and the scenario-level lines 221, 241, 260, 280, 302, 319, 330 and 343.
  - Edited prose: the HOOKS bullet (lines 189–191), the REUSED bullet (lines 192–193) and the
    vocabulary note's closing sentence (lines 209–213).
- `features/per-issue/step_definitions/feature-937.steps.ts`: the hooks (lines 23 and 27, keyed on
  `@adw-937`), all ten Givens and the three Whens. Moved; only the two hook tag strings change.
- `features/per-issue/step_definitions/feature-937-then.steps.ts`: the seven Then steps. Moved with no
  content change.
- `features/per-issue/step_definitions/feature-937-world.ts`: the module-scoped `world`, `resetWorld`,
  `createScreenshotStore`, `recordingIssueTracker`, `recordingCodeHost` and `removeScenarioArtefacts`.
  Moved with no content change.
- `features/per-issue/step_definitions/feature-937-workflow.ts`: `createReviewWorkflow`,
  `setProofRun`, `removeScenarios` and `runScenarioTestsThenReview`, which installs and removes the
  stand-ins around the run. Moved with no content change.
- `features/per-issue/step_definitions/feature-937-agent.ts`: `scriptStandInVerdict`,
  `activateStandInAgent` and `deactivateStandInAgent` (lines 63–70). Moved; only
  `deactivateStandInAgent` changes.
- `features/regression/vocabulary.md`: the registry. It ends with the
  `(@dead-orchestrator-takeover)` section at line ~890, and the new section is appended after it. For
  structure and tone, model the new section on:
  - the `(@envelope-conformance)` section, line ~699;
  - the `(@rate-limit-in-process-wait)` section, line ~314;
  - the `(@dead-orchestrator-takeover)` section.

  G18 is at line ~67 and T22 at line ~122.
- `features/regression/support/hooks.ts`: the `@regression` `Before` (`setupMockInfrastructure`) and
  `After` (`runCleanup`, `teardownMockInfrastructure`) the moved feature now runs under.
- `test/mocks/test-harness.ts`: `setupMockInfrastructure` saves `CLAUDE_CODE_PATH` and sets it to
  `test/mocks/claude-cli-stub.ts`, which is the same path as `feature-937-agent.ts`'s
  `CLAUDE_CLI_STUB_PATH`. `teardownMockInfrastructure` restores the saved value. This is the reason for
  the order-independent restore.
- `features/regression/step_definitions/feature-930-plan-fixture.ts`: `restoreClaudeCli()` (lines
  ~101–110) is the precedent for the guard and its comment.
- `features/regression/step_definitions/givenSteps.ts` (line 277, G18) and
  `features/regression/step_definitions/thenSteps.ts` (line 371, T22): the reused phrases. They are not
  redefined.
- `adws/promotion/vocabularyParser.ts`: the registry parser. Rows need at least five `|`-separated
  columns, the phrase in column 2 inside backticks, and no `|` inside a cell.
- `adws/phases/reviewPhase.ts` (`uploadReviewedProofScreenshots`, `executeReviewPhase`),
  `adws/proof/proofUploader.ts` (`setProofUploaderForTesting`, `uploadProofArtifacts`),
  `adws/phases/scenarioTestPhase.ts` and `adws/phases/scenarioProof.ts` (`ADW_PROOF_DIR`,
  `ADW_JUNIT_REPORT_PATH`): the production seams the scenarios drive. Read them only, to describe the
  vocabulary rows accurately. They do not change.

### New Files
No file is written from scratch. `git mv` creates these paths, and the content travels from the
per-issue originals:
- `features/regression/review/feature-937.feature`. The new `features/regression/review/`
  subdirectory comes with it.
- `features/regression/step_definitions/feature-937.steps.ts`
- `features/regression/step_definitions/feature-937-then.steps.ts`
- `features/regression/step_definitions/feature-937-world.ts`
- `features/regression/step_definitions/feature-937-workflow.ts`
- `features/regression/step_definitions/feature-937-agent.ts`

## Implementation Plan
### Phase 1: Foundation
Confirm the ground the move stands on:
- the six source files exist and the destination paths are free;
- no file outside the closure imports a `feature-937*` module;
- the new tag and the `RS` registry prefix are unused;
- the closure's only tag-scoped hooks are the two `@adw-937` hooks in `feature-937.steps.ts`.

### Phase 2: Core Implementation
1. Move the feature and the five step-definition files with `git mv`.
2. Re-tag the feature and delete its scenario-level tag lines.
3. Re-key the two hooks.
4. Make `deactivateStandInAgent()` restore `CLAUDE_CODE_PATH` order-independently.
5. Refresh the three stale passages of the feature's description.

### Phase 3: Integration
1. Register the 20 novel phrases in a new `(@review-comment-screenshots)` registry section, reusing G18
   and T22.
2. Add the `review/` line to the README tree.
3. Prove the result:
   - the moved scenarios pass under the `@regression` hooks;
   - the whole regression suite is green, with no undefined or ambiguous step;
   - the static checks and the unit suite stay green.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Verify preconditions
- Read `app_docs/feature-9gjajh-bdd-regression-suite.md` lines 58, 107–108 and 114–120 for the
  promotion conventions.
- `ls features/per-issue/feature-937.feature features/per-issue/step_definitions/feature-937*.ts`: the
  feature and five step files exist.
- `test ! -e features/regression/review && echo FREE`, and
  `ls features/regression/step_definitions/feature-937* 2>/dev/null` prints nothing.
- `grep -rln "feature-937" features --include='*.ts' | grep -v 'step_definitions/feature-937'` prints
  nothing. No file outside the closure imports it, so nothing needs repointing.
- `grep -rn "review-comment-screenshots" features README.md` prints nothing.
- `grep -nE '^\| [GWT]-RS[0-9]' features/regression/vocabulary.md` prints nothing.
- `grep -n "tags:" features/per-issue/step_definitions/feature-937*.ts` lists exactly the two
  `@adw-937` hooks in `feature-937.steps.ts`.

### 2. Move the feature file
- `mkdir -p features/regression/review`
- `git mv features/per-issue/feature-937.feature features/regression/review/feature-937.feature`

### 3. Move the step-definition closure
- `for f in features/per-issue/step_definitions/feature-937*.ts; do git mv "$f" features/regression/step_definitions/; done`.
  That moves five files:
  - `feature-937.steps.ts`
  - `feature-937-then.steps.ts`
  - `feature-937-world.ts`
  - `feature-937-workflow.ts`
  - `feature-937-agent.ts`
- Do not edit any import specifier in these five files. They all resolve unchanged:
  - the co-located `./feature-937-*.ts` imports;
  - `../../../adws/…`;
  - the package imports (`@cucumber/cucumber`, `@paysdoc/devplatform`).
- Leave `FRAMEWORK_REPO_ROOT` (`path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')`)
  in `feature-937-agent.ts` as it is. It still resolves to the repo root, so `CLAUDE_CLI_STUB_PATH`
  still names `test/mocks/claude-cli-stub.ts`.
- Leave the `makeTempDir('adw-937-…')` prefixes in `feature-937-workflow.ts` as they are. They are
  temp-directory names, not tags.

### 4. Re-tag the moved feature
In `features/regression/review/feature-937.feature`:
- Line 1 becomes exactly `@regression @review-comment-screenshots`.
- Delete all eight scenario-level tag lines, each `  @adw-937 @adw-axbb2a-bug-review-checks-st`,
  above the eight `Scenario:` lines.
- Leave the `Feature:` line, the Background, the `# ──` section comments, the scenarios and their data
  tables unchanged.
- `grep -nE '^\s*@' features/regression/review/feature-937.feature` must print exactly
  `1:@regression @review-comment-screenshots`.

### 5. Keep the moved feature's description truthful
Rewrite only the three passages below in `features/regression/review/feature-937.feature`. Keep the
surrounding style: four-space indent for the bullets under "Notes for the step definitions:", `•`
bullets, about 100 columns. A description line must never start with `@`, or Gherkin reads it as a tag.
- **The HOOKS bullet** (lines ~189–191). It currently reads "• HOOKS. Scope every hook to `@adw-937`.
  `After`: remove the stand-in store if a step left it installed, restore `CLAUDE_CODE_PATH` and clear
  the CLI path cache, and remove `agents/<adwId>` for every adwId used, and the throwaway worktrees."
  Reword it to say:
  - Every hook is scoped to `@review-comment-screenshots`, the tag only this feature carries.
  - `After` removes the stand-in store if a step left it installed.
  - `After` restores `CLAUDE_CODE_PATH` unless the `@regression` teardown already has, and clears the
    CLI path cache.
  - `After` removes `agents/<adwId>` for every adwId used, and the throwaway worktrees.
- **The REUSED bullet** (lines ~192–193). Replace "G18 is defined in `features/step_definitions/`,
  and T22 in the regression suite's `thenSteps.ts`." with "G18 is defined in the regression suite's
  `givenSteps.ts`, and T22 in its `thenSteps.ts`." Keep "Redefining either is an
  AmbiguousStepDefinition."
- **The vocabulary note's closing sentence** (lines ~209–213). Change "The registry has no phrase for
  the following, so novel phrasing is introduced for them:" to the past tense ("had … was
  introduced"), and keep its list. End the paragraph with: "They are registered in
  `features/regression/vocabulary.md` under `@review-comment-screenshots` (G-RS1–G-RS10, W-RS1–W-RS3,
  T-RS1–T-RS7)."
- Change nothing else in the description. In particular, keep the issue narrative, §1–§4, the "Each
  row is written to fail" bullets, the "Not pinned here" list and the other step-definition notes. The
  "default application type, `cli`" wording became historical with #991, and is left as it is (see
  Notes).
- Afterwards, `grep -n "@adw-937" features/regression/review/feature-937.feature` must print nothing.

### 6. Re-key the hooks to the descriptive tag
- In `features/regression/step_definitions/feature-937.steps.ts`, change `Before({ tags: '@adw-937' }, …)`
  (line 23) and `After({ tags: '@adw-937' }, …)` (line 27) to `{ tags: '@review-comment-screenshots' }`.
- Leave the hook bodies, the header comment and every step definition unchanged.
- The hook tag must equal the feature's tag exactly. Otherwise cleanup silently stops while the
  scenarios still pass.
- `grep -rn "@adw-937" features/regression/step_definitions` must print nothing.
- `grep -c "tags: '@review-comment-screenshots'" features/regression/step_definitions/feature-937.steps.ts`
  must print `2`.

### 7. Make the `CLAUDE_CODE_PATH` restore order-independent
In `features/regression/step_definitions/feature-937-agent.ts`, change only `deactivateStandInAgent()`
so it writes the saved value back only while the variable still names the stand-in:
```ts
export function deactivateStandInAgent(): void {
  if (!world.claudeCodePath) return;
  const { previous } = world.claudeCodePath;
  // After hooks run in reverse registration order and the @regression teardown registers after this file, so it may already have restored the variable; writing back the value saved at activation would clobber that.
  if (process.env['CLAUDE_CODE_PATH'] === CLAUDE_CLI_STUB_PATH) {
    if (previous === undefined) delete process.env['CLAUDE_CODE_PATH'];
    else process.env['CLAUDE_CODE_PATH'] = previous;
  }
  world.claudeCodePath = null;
  clearClaudeCodePathCache();
}
```
- On the normal path, the call in `runScenarioTestsThenReview`'s `finally` while the mock
  infrastructure is still up, the variable equals the stub path, so behaviour is unchanged.
- Leave `activateStandInAgent`, `scriptStandInVerdict` and `buildVerdict` unchanged.
- Per `.adw/coding_guidelines.md` **Comments**, the one comment states the ordering constraint and
  cites no issue number. It mirrors `restoreClaudeCli()` in `feature-930-plan-fixture.ts`.

### 8. Register the phrases in `features/regression/vocabulary.md`
At the end of the file, after the `(@dead-orchestrator-takeover)` section's closing reuse paragraph,
add the elements below, as the other sections are separated:
- a blank line;
- `---`;
- a blank line;
- the new section.

Rules for the rows:
- Every row has exactly five columns (`| # | Phrase | Semantics | Pattern | Assertion target |`).
- Each phrase is in backticks, written exactly as its step definition's cucumber expression.
- No cell may contain a `|`.
- No row names a source file as its assertion target.
- Pattern is `phase-import` throughout: every row runs in this process.
- Do not claim an application type in any row. `getDefaultProjectConfig()` returns
  `applicationType: null`.

**Heading:** `## Given/When/Then — Review Comment Screenshots (@review-comment-screenshots)`

**Intro paragraph**, in the style of the `(@envelope-conformance)` and `(@dead-orchestrator-takeover)`
intros. It states the following:
- **What the phrases drive.** The review phase's comment on the issue, and the screenshots of the
  proof run it judged.
- **The run (phase-import).** The real `executeScenarioTestPhase`, then the real `executeReviewPhase`,
  over a `WorkflowConfig` built on a throwaway worktree under `os.tmpdir()`. Its recording `repoContext`
  for the fictional `acme/widgets` records every comment. Its hermetic scenario command copies a
  scripted proof run into `$ADW_PROOF_DIR` instead of starting a test suite.
- **The replaced boundaries.** Two are replaced, and only for the When step's run:
  - R2, by a stand-in screenshot store installed through `setProofUploaderForTesting`
    (`adws/proof/proofUploader.ts`);
  - the review agent, by the Claude CLI stub (`test/mocks/claude-cli-stub.ts`) answering a scripted
    verdict through `<worktree>/.adw-stub-manifest.json`.

  No real agent runs, and nothing reaches R2 or GitHub.
- **Fixtures.** Each fixture file's bytes are unique to its relative path, so an upload is traced back
  to the file it carried. Nothing decodes an image.
- **Asserted artefacts.**
  - the comments the recording issue tracker received: a comment's heading is its first `## ` line,
    and its images are its Markdown image sources;
  - the uploads the stand-in store received, and the URL it answered each with;
  - what the review phase returned or threw.

  No step reads, greps or parses a source file, satisfying the Rot-Detection Rubric.
- **Where the definitions live.** `feature-937.steps.ts` holds the hooks, Givens and Whens, and
  `feature-937-then.steps.ts` the Thens. Their helpers are in `feature-937-world.ts`,
  `feature-937-workflow.ts` and `feature-937-agent.ts`.
- **Hooks.** They are keyed on `@review-comment-screenshots`.
  - `Before` resets the module-scoped world.
  - `After` removes the stand-in store, restores `CLAUDE_CODE_PATH` unless the `@regression` teardown
    already has, and clears the cached CLI path.
  - `After` also removes `agents/<adwId>` for every adwId used, and the throwaway directories.

  A scenario that uses these phrases must carry that tag and run G-RS1 in its Background.

**Rows** (adjust wording only if the code disagrees; the semantics below were checked against the
step definitions):

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-RS1 | `the screenshot store records every upload and answers each with a public URL of its own` | Prepares the stand-in screenshot store, an `UploaderFn` that records the key and bytes of every upload and answers the n-th with `https://screenshots.example.test/<n>/<key>`; an upload it refuses is recorded with no URL and throws. It is only prepared: W-RS1 and W-RS3 install it through `setProofUploaderForTesting` for their run and remove it afterwards, so the real `uploadToR2` never runs and the store counts as configured without R2 credentials. The Background of every scenario using these phrases | phase-import | stand-in screenshot store (SUT boundary) |
| G-RS2 | `a review workflow for issue {int} under adwId {string} whose issue tracker records every comment` | Removes any `agents/<adwId>` a crashed earlier run left, then builds a `WorkflowConfig` over a fresh throwaway worktree under `os.tmpdir()`: a recording `repoContext` for the fictional `acme/widgets` whose issue tracker records every `commentOnIssue` and answers `fetchLabels` with `[]` and whose code host records every call; no `ctx.prUrl`, since in `adwSdlc` the review runs before the pull request exists; no `gitContext`; the default project config with `startDevServer` `N/A`, a non-empty `scenariosMd`, one step-definition file in the worktree so the scenario test phase runs, and a hermetic `runScenariosByTag` that, whatever the tag, copies the scripted proof run into `$ADW_PROOF_DIR`, writes a passing JUnit report to `$ADW_JUNIT_REPORT_PATH` and prints `1 scenarios (1 passed)` | phase-import | workflow config + recording issue tracker (SUT input) |
| G-RS3 | `the scenario run for that workflow leaves these screenshots in its proof directory:` | Replaces the workflow's proof run with the relative paths in the table's `screenshot` column, each written as a fixture file whose bytes are unique to its path (`fixture bytes of <path>`), keeping any other file G-RS5 named; on every run the scenario command copies them into `$ADW_PROOF_DIR` at their relative paths. Nothing decodes an image: the extension is the one named. Fails unless G-RS2 ran | phase-import | proof-run fixture (SUT input, not source) |
| G-RS4 | `the scenario run for that workflow leaves no screenshots in its proof directory` | As G-RS3 with no screenshot: the proof run holds only the other files G-RS5 named, if any | phase-import | proof-run fixture (SUT input, not source) |
| G-RS5 | `the scenario run for that workflow also leaves the file {string} in its proof directory` | Adds a file that is not an image at the relative path, its bytes unique to that path, to the proof run, keeping the screenshots already scripted | phase-import | proof-run fixture (SUT input, not source) |
| G-RS6 | `the repository of that workflow has no scenarios configured` | Empties the workflow's `scenariosMd`, so the real scenario test phase skips and returns no scenario proof, and the review is judged over an empty proof path | phase-import | workflow config (SUT input) |
| G-RS7 | `the stand-in review agent passes the review` | Scripts the verdict the Claude CLI stub answers the next review with: `success: true`, no review issues, and an empty `screenshots` list unless G-RS9 ran. W-RS1 writes it into the stub's manifest marker; it satisfies the review agent's output parser at once, so no validation retry starts another agent. Also used after a When step, to script the next review | phase-import | stub behaviour (scripted review verdict) |
| G-RS8 | `the stand-in review agent fails the review with the blocker {string}` | As G-RS7, with `success: false` and one review issue of severity `blocker` whose description is the text | phase-import | stub behaviour (scripted review verdict) |
| G-RS9 | `the stand-in review agent's verdict lists the scenario proof file as its proof artifact` | Makes the scripted verdict's `screenshots` hold the absolute path of the `scenario_proof.md` the scenario test phase reported, as the review prompt's Strategy A tells the reviewer to; nothing is listed when the phase reported no proof | phase-import | stub behaviour (scripted review verdict) |
| G-RS10 | `the screenshot store refuses the upload of {string}` | Makes the stand-in store throw for an upload carrying that screenshot's fixture bytes, recording it with no URL. Fails unless G-RS1 ran | phase-import | stand-in screenshot store (SUT boundary) |
| W-RS1 | `the scenario tests run and the review phase judges their proof` | Installs the stand-in store through `setProofUploaderForTesting` and points `CLAUDE_CODE_PATH` at the Claude CLI stub, clearing the cached CLI path. Runs the real `executeScenarioTestPhase(config)`, writes the stub's manifest marker `<worktree>/.adw-stub-manifest.json` with the scripted verdict, then runs the real `executeReviewPhase(config, proofPath)`, `proofPath` being the `resultsFilePath` of the proof the scenario phase returned or `''` when it returned none, as `runScenarioTestFixLoop` hands the review. Records whether the review phase returned, with its `reviewPassed`, or threw, and removes the store and restores `CLAUDE_CODE_PATH` before it ends. Fails unless G-RS1, G-RS2 and G-RS7 or G-RS8 ran. 60 s timeout | phase-import | returned review verdict + recorded comments + recorded uploads |
| W-RS2 | `the next scenario run for that workflow leaves only the screenshot {string} in its proof directory` | Replaces the proof run, from the next run on, with that one screenshot fixture and no other file. A When because it scripts the run between two reviews | phase-import | proof-run fixture (SUT input, not source) |
| W-RS3 | `the scenario tests run again and the review phase judges their new proof` | W-RS1 again on the same workflow. The patch the orchestrators run between review attempts changes no screenshot and is left out | phase-import | returned review verdict + recorded comments + recorded uploads |
| T-RS1 | `the review phase returned a {word} verdict` | Asserts the last run's review phase returned rather than threw (its error is shown otherwise) and that its `reviewPassed` is `true` for `passing` and `false` for `failing`; any other word fails the step | phase-import | returned review verdict |
| T-RS2 | `issue {int} received a comment headed {string}` | Asserts the recording issue tracker received a comment on issue N whose heading, its first `## ` line, contains the text (the review comments put an emoji shortcode before the title); fails listing the headings of the issue's comments | phase-import | recorded issue comments |
| T-RS3 | `the {string} comment on issue {int} shows exactly these screenshots, each embedded as an image from a URL its upload returned:` | Takes the last comment on issue N headed by the text and collects its Markdown image sources (`![…](source)`). Asserts that every screenshot in the table's `screenshot` column is embedded from a URL the stand-in store returned for an upload of its bytes, and that every image source is a URL returned for an upload of a listed screenshot | phase-import | recorded issue comments + recorded uploads |
| T-RS4 | `the {string} comment on issue {int} still lists the blocker {string}` | Asserts the body of the last comment on issue N headed by the text contains the blocker's description | phase-import | recorded issue comments |
| T-RS5 | `the {string} comment on issue {int} embeds no image` | Asserts the last comment on issue N headed by the text carries no Markdown image | phase-import | recorded issue comments |
| T-RS6 | `the screenshot store received uploads of these screenshots and of nothing else:` | Asserts the bytes of every listed screenshot reached the stand-in store at least once, and that every upload it recorded, refused ones included, carries the bytes of a listed screenshot | phase-import | recorded uploads |
| T-RS7 | `the screenshot store received no upload` | Asserts the stand-in store recorded no upload, refused or answered | phase-import | recorded uploads |

**Closing reuse paragraph:** "This section also reuses already-registered phrases, so they need no new
rows: `the ADW codebase is checked out` (G18, Background) and `the ADW TypeScript type-check passes`
(T22)."

Then check the result:
- `grep -cE '^\| [GWT]-RS[0-9]+ \|' features/regression/vocabulary.md` prints `20`.
- `grep -E '^\| [GWT]-RS' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u` prints
  only `7`.

### 9. Add the `review/` line to the README tree
- In `README.md`'s `features/` tree, insert one line between the `│   ├── rate-limit/` line and the
  `│   ├── smoke/` line. Pad the name to the same column as its neighbours (`review/` plus nine spaces).
  The line reads:
  `│   ├── review/         # Regression scenarios covering the review comment on the issue: it shows the screenshots of the proof run the review judged, each embedded from the URL its upload returned, on a passing and a failing review, and a screenshot never decides or blocks the review (#937)`
- Change nothing else in the README.

### 10. Re-run the existing unit coverage
- `bunx vitest run adws/promotion/__tests__/vocabularyParser.test.ts adws/proof/__tests__/proofUploader.test.ts`
  covers the registry format the new rows follow, and the uploader seam the scenarios install their
  stand-in through.
- `bun run test:unit` runs the full Vitest suite, for zero regressions.
- No new unit test is written (see Testing Strategy).

### 11. Run the Validation Commands
- Run every command under `Validation Commands`, in order. Each must succeed and print the stated
  result.
- If the moved scenarios fail under `@regression` but pass in isolation, compare the run order of
  their hooks with the `@regression` hooks (see Edge Cases). Fix the step definitions, never the
  `.feature` file's steps.

## Testing Strategy
### Unit Tests
- **No new unit tests.** The change relocates BDD scenarios, edits two hook tag strings and one
  test-harness function, adds registry Markdown and adds one README line. No production module, pure
  function or branch changes, so Vitest has no new logic to cover (`.adw/coding_guidelines.md`
  **Testing**: unit tests cover pure logic; the scenarios are the behavioural proof).
- The one TypeScript logic change, the guard in `deactivateStandInAgent`, is Cucumber step-definition
  harness code under `features/`. `vitest.config.ts` includes only `adws/**/__tests__/**/*.test.ts` and
  `test/mocks/__tests__/**/*.test.ts`. The scenarios exercise the guard's normal path on every run.
- Existing coverage re-run in Task 10:
  - `adws/promotion/__tests__/vocabularyParser.test.ts`: the registry row format;
  - `adws/proof/__tests__/proofUploader.test.ts`: the `setProofUploaderForTesting`/`uploadProofArtifacts`
    seam;
  - `bun run test:unit`: the full suite.

### Edge Cases
- **The hook tag drifts from the feature tag.** If the hooks were keyed on anything other than
  `@review-comment-screenshots`, two things would stop without failing:
  - the `Before` would stop resetting the module-scoped world, so the store, verdict, comments and
    outcome would leak across scenarios;
  - the `After` would stop cleaning `agents/<adwId>`, the temp directories and the uploader seam.

  The scenarios might still pass. Task 6's greps and the `--tags "@review-comment-screenshots"` run pin
  the tag.
- **Hook order under `@regression`.** The moved step file now loads before
  `features/regression/support/hooks.ts`.
  - `Before`: `resetWorld()` runs first. It touches no environment. `setupMockInfrastructure()` then
    sets `CLAUDE_CODE_PATH` to the stub and prepends the git mock to `PATH`.
  - `After`, in reverse registration order: the `@regression` teardown runs first and restores
    `CLAUDE_CODE_PATH` and `PATH`. This feature's `After` then runs.
  - On the normal path, the When step's `finally` has already called `deactivateStandInAgent()` and
    `setProofUploaderForTesting(null)`, so the `After` finds nothing to restore.
  - If a When step times out (60 s), `world.claudeCodePath` is still set. Task 7's guard then sees a
    variable that no longer names the stub, and skips the write-back. The teardown's restore stands,
    and the stub path never leaks into later scenarios.
- **Same stub path twice.** `setupMockInfrastructure()` and `activateStandInAgent()` both point
  `CLAUDE_CODE_PATH` at `test/mocks/claude-cli-stub.ts`. `previous` is therefore the stub path during a
  `@regression` run. Restoring it inside the step is a no-op, which is correct.
- **The git mock and `GH_*` variables.** The `@regression` `Before` prepends a `git` wrapper to `PATH`
  and sets `GH_TOKEN`/`GH_HOST`. The scenario command uses only `mkdir`, `cp`, `printf` and `echo`. The
  review path runs no git network subcommand and no `gh`: `gitContext` is `undefined`, the code host is
  a recording proxy, and there is no `ctx.prUrl`, so there is no approval. The git mock delegates local
  subcommands to real git anyway (app doc, line 120).
- **Nested scenario run inside ADW's own test phase.** When an ADW workflow's scenario test phase runs
  `--tags "@regression"`, it sets `ADW_PROOF_DIR`/`ADW_JUNIT_REPORT_PATH` for the outer Cucumber run.
  The inner `executeScenarioTestPhase` overrides both explicitly for its own command
  (`adws/phases/scenarioProof.ts`, lines 219–220). The inner command therefore never writes into the
  outer run's report or proof directory.
- **No new ambiguity.** Pure moves leave the loaded step set unchanged, and no phrase is copied.
  G18 and T22 stay single definitions in `givenSteps.ts` and `thenSteps.ts`. The `@regression` dry-run
  proves it.
- **`@adw-937` after the move.** `--tags "@adw-937"` selects nothing any more. That is intended,
  because the scenarios now run by `@regression` and `@review-comment-screenshots`.
- **The promotion marker.** Dropping `@promotion-suggested-2026-10-04` is safe. Only the per-issue
  sweeps read it, and the promotion sweep reconciles through the issue's `Promotes: feature-937`
  back-link. It reaches `done` once the PR merges.
- **The per-issue TTL sweep.** Nothing of the closure stays under `features/per-issue/`, so no swept
  sibling can break the promoted scenario later.
- **The Background phrase.** G-RS1 is not in the issue's list, because `scenarioParser.ts` skips
  `Background` children. It is a novel phrase every scenario runs, so it gets a row. The registration
  check in Validation Commands includes it.
- **`{word}` in T-RS1.** The promotion scorer's matcher treats only `{string}` and `{int}` as
  wildcards. The registry still records the expression exactly as defined, as T-EC13 already does with
  `{word}`. Cucumber's own matching is what binds the step.
- **Runtime budget.** Seven scenarios each run the scenario test phase and the review phase once (the
  re-test row twice) against the stub, and one runs T22's `tsc`. That adds well under the daily
  workflow's 30-minute host and Docker job limits.
- **Docker leg.** The rows write only under `agents/` and `os.tmpdir()`, and spawn only the stub and
  `sh`, as other regression rows already do. No path the container mounts read-only is touched.

## Acceptance Criteria
- `features/regression/review/feature-937.feature` exists, moved with `git mv`. Its only tag line is
  line 1, `@regression @review-comment-screenshots`. No `@adw-` or `@promotion-suggested-` tag remains
  at feature or scenario level.
- `features/per-issue/feature-937.feature` and every `features/per-issue/step_definitions/feature-937*`
  file no longer exist.
- The five-file closure lives flat in `features/regression/step_definitions/`, moved with `git mv`.
  - Its import specifiers are unchanged.
  - The only content edits are the two hook tag strings in `feature-937.steps.ts` and the
    order-independent restore in `feature-937-agent.ts`'s `deactivateStandInAgent`.
- Both `Before`/`After` hooks are keyed on `@review-comment-screenshots`.
  `grep -rn "@adw-937" features/regression` prints nothing.
- The moved feature's description edits are limited to three:
  - the HOOKS bullet names the new tag;
  - the REUSED bullet places G18 in `givenSteps.ts`;
  - the vocabulary note points to the `@review-comment-screenshots` registry section.
- `features/regression/vocabulary.md` has a
  `## Given/When/Then — Review Comment Screenshots (@review-comment-screenshots)` section.
  - It has 20 rows: G-RS1–G-RS10, W-RS1–W-RS3 and T-RS1–T-RS7.
  - Each row has five columns, a backticked cucumber expression identical to its step definition's,
    the `phase-import` pattern, and a runtime artefact as its assertion target.
  - Every phrase in the issue's list, and the Background phrase, maps to a new row or to the reused
    G18/T22.
- `README.md`'s `features/` tree lists `review/` between `rate-limit/` and `smoke/`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-comment-screenshots"` runs 8 scenarios
  (72 steps), and all pass under the `@regression` hooks.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` is green, includes the moved
  scenarios, and reports no ambiguous or undefined step.
- `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build`,
  `bun run test:unit` and `bun run lint:docs-index` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `test -z "$(find features/per-issue -name 'feature-937*')" && echo MOVED-OK`: prints `MOVED-OK`,
  because the old per-issue paths no longer exist.
- `ls features/regression/review/feature-937.feature features/regression/step_definitions/feature-937*.ts | wc -l`:
  prints `6`.
- `grep -nE '^\s*@' features/regression/review/feature-937.feature`: prints exactly
  `1:@regression @review-comment-screenshots`.
- `! grep -rnE "@adw-(937|axbb2a)" features/regression`: no per-issue tag remains in the moved feature
  or its step definitions.
- `grep -c "tags: '@review-comment-screenshots'" features/regression/step_definitions/feature-937.steps.ts`:
  prints `2`.
- `grep -n "=== CLAUDE_CLI_STUB_PATH" features/regression/step_definitions/feature-937-agent.ts`: prints
  the guard line in `deactivateStandInAgent`.
- `grep -cE '^\| [GWT]-RS[0-9]+ \|' features/regression/vocabulary.md`: prints `20`.
- `grep -E '^\| [GWT]-RS' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u`: prints
  only `7`, so every new row has exactly five columns.
- Every phrase the moved feature uses is registered in backticks. The command prints `VOCAB-OK`, or
  lists each `UNREGISTERED:` phrase and exits non-zero. It does not depend on indentation, so it can
  be copied from this list as it stands:
  ```sh
  missing=$(printf '%s\n' \
    'the ADW codebase is checked out' \
    'the screenshot store records every upload and answers each with a public URL of its own' \
    'a review workflow for issue {int} under adwId {string} whose issue tracker records every comment' \
    'the scenario run for that workflow leaves these screenshots in its proof directory:' \
    'the scenario run for that workflow leaves no screenshots in its proof directory' \
    'the scenario run for that workflow also leaves the file {string} in its proof directory' \
    'the repository of that workflow has no scenarios configured' \
    'the stand-in review agent passes the review' \
    'the stand-in review agent fails the review with the blocker {string}' \
    "the stand-in review agent's verdict lists the scenario proof file as its proof artifact" \
    'the screenshot store refuses the upload of {string}' \
    'the scenario tests run and the review phase judges their proof' \
    'the next scenario run for that workflow leaves only the screenshot {string} in its proof directory' \
    'the scenario tests run again and the review phase judges their new proof' \
    'the review phase returned a {word} verdict' \
    'issue {int} received a comment headed {string}' \
    'the {string} comment on issue {int} shows exactly these screenshots, each embedded as an image from a URL its upload returned:' \
    'the {string} comment on issue {int} still lists the blocker {string}' \
    'the {string} comment on issue {int} embeds no image' \
    'the screenshot store received uploads of these screenshots and of nothing else:' \
    'the screenshot store received no upload' \
    'the ADW TypeScript type-check passes' \
    | while read -r phrase; do grep -qF -- "\`$phrase\`" features/regression/vocabulary.md || echo "UNREGISTERED: $phrase"; done); [ -z "$missing" ] && echo VOCAB-OK || { printf '%s\n' "$missing"; false; }
  ```
- `bunx tsc --noEmit`: the root type-check passes. Its `include` is `**/*.ts`, so it covers
  `features/**` and proves every moved import resolves.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run lint`: the linter passes.
- `bun run build`: the build succeeds.
- `bunx vitest run adws/promotion/__tests__/vocabularyParser.test.ts adws/proof/__tests__/proofUploader.test.ts`:
  the registry-format and uploader-seam unit tests pass.
- `bun run test:unit`: the unit suite passes with zero regressions.
- `bun run lint:docs-index`: the living-docs index stays clean. `features/per-issue/**` and
  `features/regression/**` both remain owned.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-comment-screenshots" --dry-run`: 8
  scenarios, with no undefined and no ambiguous step.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run`: the whole regression
  suite binds every step, with no undefined and no ambiguous step.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-comment-screenshots"`: 8 scenarios
  (8 passed), 72 steps (72 passed), under the `@regression` hooks.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the full regression suite is
  green and includes the moved feature. This is the primary acceptance command.

## Notes
- **Coding guidelines.** Adhere strictly to `.adw/coding_guidelines.md`. Apart from Markdown and file
  moves, the TypeScript diff is:
  - two hook tag strings;
  - the guard and its one comment in `deactivateStandInAgent`.

  Per **Comments**, that comment states only the ordering constraint and cites no issue number. Touch no
  other logic in any moved file, and keep every file under 300 lines (the largest is 180).
- **No new library.** Nothing is installed. If one were ever needed, `.adw/commands.md` names
  `bun add <package>`.
- **`hitl` is set.** The resulting PR must be human-approved before merge, so do not auto-merge it.
  Its `regression-promotion` label triggers the non-blocking rot/reuse advisory comment
  (`executePromotionRotAdvisory`). That comment never gates the merge.
- **Documentation follows in the document phase.** In the earlier promotions (#1000–#1006), the build
  changed only the README tree. The document agent then updated two files:
  - `app_docs/feature-9gjajh-bdd-regression-suite.md`: the `review/` maintain-bullet, and adding
    `@review-comment-screenshots` (`feature-937`) to the line-114 list of promoted hook tags;
  - `.adw/conditional_docs.md`: a condition for the promoted review-screenshots scenario.

  Leave both to the document phase unless the reviewer asks otherwise.
- **Historical prose left on purpose.** Some of the feature's description is historical and stays
  verbatim, as earlier promotions left theirs:
  - "Issue #937 resolves…";
  - "every row with screenshots is RED today";
  - "the default application type, `cli`". Since #991, `getDefaultProjectConfig()` returns
    `applicationType: null`, and the step definitions read no application type, so behaviour is
    unchanged.

  Only the passages that would contradict the code after the move are edited (Task 5).
- **Why `review/` and `@review-comment-screenshots`.** The directory names the subject broadly, so a
  later review-phase promotion can share it. The tag names exactly what this feature asserts, and hooks
  key on it. A future feature in `review/` must bring its own tag and must not reuse this one.
- **Phrase reuse for future authors.** The G-RS/W-RS/T-RS phrases are bound to feature-937's
  module-scoped world. A scenario reusing them must carry `@review-comment-screenshots` and run G-RS1.
  Otherwise `requireStore()`/`requireWorkflow()` fail loudly, by design.
- **Per-issue scenarios for this issue.** If the scenario phase writes a
  `features/per-issue/feature-1005.feature`, it must not redefine any moved phrase. A second
  definition is an AmbiguousStepDefinition that would fail the whole `@regression` run.
