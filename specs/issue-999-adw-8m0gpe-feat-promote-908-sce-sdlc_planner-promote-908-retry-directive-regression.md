# Feature: Promote the #908 `## Retry` directive scenario into the `@regression` suite

## Metadata
issueNumber: `999`
adwId: `8m0gpe-feat-promote-908-sce`
issueJson: `{"number":999,"title":"feat: promote #908 scenario into the @regression suite","body":"Promotes: feature-908\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-908` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-908.feature features/regression/<subdir>/feature-908.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-908.steps.ts features/regression/step_definitions/feature-908.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-908.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-908.steps.ts`\n\n## Phrases to register\n\n- `the latest ADW workflow comment on issue 840 names adwId \"retry908-840\"`\n- `the top-level state for adwId \"retry908-840\" records issue 840 at workflowStage \"paused\" with orchestrator script \"adws/adwChore.tsx\"`\n- `the rate-limit pause queue holds no entry for adwId \"retry908-840\"`\n- `the cron handles the ## Retry directive on issue 840`\n- `exactly one orchestrator was launched for issue 840`\n- `the orchestrator launched for issue 840 runs \"adws/adwChore.tsx\" under adwId \"retry908-840\"`\n- `the orchestrator launched for issue 840 targets the repository \"acme/widgets\"`\n- `no entry for adwId \"retry908-840\" was added to the rate-limit pause queue`\n- `the resumed comment is recorded on issue 840 in the target repository \"acme/widgets\"`\n- `the mock harness recorded zero comment posts on issue 840 in the cron host's own repository \"paysdoc/AI_Dev_Workflow\"`\n- `the latest ADW workflow comment on issue 871 names adwId \"retry908-871\"`\n- `the top-level state for adwId \"retry908-871\" records issue 871 at workflowStage \"paused\" with orchestrator script \"adws/adwChore.tsx\"`\n- `the rate-limit pause queue holds an entry for adwId \"retry908-871\" on issue 871`\n- `the cron handles the ## Retry directive on issue 871`\n- `the rate-limit pause queue no longer holds an entry for adwId \"retry908-871\"`\n- `exactly one orchestrator was launched for issue 871`\n- `the orchestrator launched for issue 871 runs \"adws/adwChore.tsx\" under adwId \"retry908-871\"`\n- `the orchestrator launched for issue 871 targets the repository \"acme/widgets\"`\n- `the resumed comment is recorded on issue 871 in the target repository \"acme/widgets\"`\n- `the pause-queue scanner then runs a probe cycle in which the rate limit has cleared`\n- `the pause-queue scanner relaunched nothing for issue 871`\n- `the latest ADW workflow comment on issue 874 names adwId \"retry908-874\"`\n- `the top-level state for adwId \"retry908-874\" records issue 874 at workflowStage \"paused\" with orchestrator script \"<script>\"`\n- `the rate-limit pause queue holds no entry for adwId \"retry908-874\"`\n- `the cron handles the ## Retry directive on issue 874`\n- `exactly one orchestrator was launched for issue 874`\n- `the orchestrator launched for issue 874 runs \"<script>\" under adwId \"retry908-874\"`\n- `the orchestrator launched for issue 874 targets the repository \"acme/widgets\"`\n- `the latest ADW workflow comment on issue 879 names adwId \"retry908-879\"`\n- `the top-level state for adwId \"retry908-879\" records issue 879 at workflowStage \"paused\" with no orchestrator script`\n- `the rate-limit pause queue holds no entry for adwId \"retry908-879\"`\n- `the cron handles the ## Retry directive on issue 879`\n- `exactly one orchestrator was launched for issue 879`\n- `the orchestrator launched for issue 879 runs \"adws/adwSdlc.tsx\" under adwId \"retry908-879\"`\n- `the orchestrator launched for issue 879 targets the repository \"acme/widgets\"`\n- `the top-level state for adwId \"retry908-872\" records issue 872 at workflowStage \"paused\" with orchestrator script \"adws/adwChore.tsx\"`\n- `the rate-limit pause queue holds an entry for adwId \"retry908-872\" on issue 872`\n- `the rate-limit pause queue still holds the entry for adwId \"retry908-872\"`\n- `no orchestrator was launched for issue 872`\n- `the latest ADW workflow comment on issue 873 names adwId \"retry908-873\"`\n- `the top-level state for adwId \"retry908-873\" records issue 873 at workflowStage \"paused_auth\" with orchestrator script \"adws/adwChore.tsx\"`\n- `the cron handles the ## Retry directive on issue 873`\n- `no orchestrator was launched for issue 873`\n- `the state file for adwId \"retry908-873\" records workflowStage \"paused_auth\"`\n- `the mock harness recorded zero comment posts on issue 873`\n- `the Retry handling logged that issue 873 is paused_auth and left to the auth queue`\n- `the latest ADW workflow comment on issue 876 names adwId \"retry908-876\"`\n- `the top-level state for adwId \"retry908-876\" records issue 876 at workflowStage \"<stage>\" with orchestrator script \"adws/adwChore.tsx\"`\n- `the cron handles the ## Retry directive on issue 876`\n- `no orchestrator was launched for issue 876`\n- `the state file for adwId \"retry908-876\" records workflowStage \"<stage>\"`\n- `the mock harness recorded zero comment posts on issue 876`\n- `the latest ADW workflow comment on issue 877 names adwId \"retry908-877\"`\n- `the top-level state for adwId \"retry908-877\" records issue 877 at workflowStage \"<stage>\" with orchestrator script \"adws/adwChore.tsx\"`\n- `the cron handles the ## Retry directive on issue 877`\n- `no orchestrator was launched for issue 877`\n- `the state file for adwId \"retry908-877\" records workflowStage \"<stage>\"`\n- `the mock harness recorded zero comment posts on issue 877`\n- `the latest ADW workflow comment on issue 881 names adwId \"retry908-881\"`\n- `the top-level state for adwId \"retry908-881\" records issue 881 at workflowStage \"merge_blocked\" with a merge retry count of 2`\n- `the cron handles the ## Retry directive on issue 881`\n- `the state file for adwId \"retry908-881\" records workflowStage \"awaiting_merge\"`\n- `the top-level state for adwId \"retry908-881\" records a merge retry count of 0`\n- `no orchestrator was launched for issue 881`\n- `the mock harness recorded zero comment posts on issue 881`\n- `the latest ADW workflow comment on issue 882 names adwId \"retry908-882\"`\n- `the top-level state for adwId \"retry908-882\" records issue 882 at workflowStage \"<stage>\" with a resume attempt count of 3`\n- `the cron handles the ## Retry directive on issue 882`\n- `the state file for adwId \"retry908-882\" records workflowStage \"phase_timeout\"`\n- `the top-level state for adwId \"retry908-882\" records a resume attempt count of 0`\n- `no orchestrator was launched for issue 882`\n- `the mock harness recorded zero comment posts on issue 882`\n- `the latest ADW workflow comment on issue 875 names adwId \"retry908-875\"`\n- `the top-level state for adwId \"retry908-875\" records issue 875 at workflowStage \"paused\" with a recording fixture as its orchestrator script`\n- `the webhook receives a \"## Retry\" comment on issue 875 from the repository \"acme/widgets\"`\n- `no orchestrator was launched for issue 875 without the target repository \"acme/widgets\"`\n- `the ADW TypeScript type-check passes`\n- `the git/gh guard is run across the repository`\n- `the git/gh guard reports no violations`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-908.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-04T15:35:52Z","comments":[],"actionableComment":null}`

## Feature Description
`features/per-issue/feature-908.feature` specifies the `## Retry` directive. It has 26 scenarios once the outline examples are expanded. Right now only #908's own workflow test phase runs them, selected by `@adw-908`. The per-issue sweep will delete the file 14 days after the issue's PR merges. The only thing holding that deletion off is the `@promotion-suggested-2026-10-04` marker.

The scenarios cover these behaviours:
- **§1, the paused branch.** `## Retry` on a workflow stranded in `workflowStage: paused` does three things:
  - it removes only that workflow's pause-queue entry;
  - it respawns, exactly once, the orchestrator that `resolveResumeSpawn` resolves from top-level state, with the handling cron's own `--target-repo`;
  - it posts the `resumed` stage comment on the target repository.
- **§2, stages left alone.** `paused_auth`, every running stage (including `starting` and `stepDef_running`) and the finished stages stay no-ops.
- **§3, human-gated branches.** `merge_blocked`, `human_gated` and `review_failed` re-arm exactly as before and launch nothing.
- **§4, the webhook caller.** A `## Retry` delivered by the webhook never launches an orchestrator without the webhook's target repository.
- **§5, backstops.** The type-check and the git/gh guard.

Every assertion reads a runtime artefact, so the file already meets the Rot-Detection Rubric.

This feature relocates the scenario and its single step-definition file into the standing `@regression` suite, which every ADW workflow's test phase and the daily regression workflow run. The work is:
- retag the feature `@regression` plus a descriptive `@retry-directive`;
- re-key the step file's two scenario hooks to `@retry-directive`;
- register the scenario's 23 novel phrases in `features/regression/vocabulary.md`.

The behaviour that has already stranded real workflows (#840, #871, #872, #874–#877) is then guarded on every run, not just until the sweep deletes the file.

## User Story
As an ADW maintainer
I want the `## Retry` directive's paused-workflow revival and its no-op/human-gated invariants to be part of the standing `@regression` suite
So that a future change to `retryHandler.ts`, the stage classifier, the pause queue or the webhook dispatcher cannot quietly break `## Retry` again, or let it start a second orchestrator, after the per-issue file has been swept

## Problem Statement
- **The coverage is about to disappear.** `feature-908.feature` lives under `features/per-issue/`. Only its own workflow's `@adw-908` test phase runs it, and the 14-day per-issue sweep will delete it and its sibling `feature-908.steps.ts`.
- **Nothing else covers the behaviour end to end.** No other scenario exercises the `paused` branch of `handleRetryDirective`, its refusal to act on running stages, or the `--target-repo` the webhook and the cron must pass.
- **It does not meet the regression contract yet.** ADR-0037 and the regression-suite doc set three rules:
  - a regression feature carries `@regression` and no per-issue `@adw-` tag ("a file carries one tag or the other");
  - a hook keyed on a dropped `@adw-` tag must be re-keyed to a descriptive tag, or it silently stops running;
  - every phrase must be registered in `features/regression/vocabulary.md`.

  Today the file carries `@adw-908`, `@adw-2fgeai-retry-resumes-a-work`, `@adw-911`, `@adw-959`, `@adw-960` and the per-issue lifecycle marker `@promotion-suggested-2026-10-04`. Its `Before`/`After` hooks are keyed on `@adw-908`, and 23 of its phrases are unregistered.

## Solution Statement
Do a direct relocation, following the #734/#760/#923/#924 promotions and the tag clean-up in commit 517f823d. There is no production-code change.

1. **Move the files.** `git mv` the feature into a new subject subdirectory, `features/regression/retry-directive/`. `git mv` its only step-definition sibling into `features/regression/step_definitions/`. Both step directories are three levels deep, so every relative import resolves unchanged:
   - `../../regression/step_definitions/world.ts`
   - `../../regression/step_definitions/feature-902-queue.steps.ts`
   - `../../../test/mocks/test-harness.ts`
   - `../../../adws/…`

   No other file imports `feature-908.steps.ts`, so nothing needs repointing. `cucumber.js` already loads both step directories and both feature trees, so the move adds or removes no step definition. It cannot introduce an ambiguous step.
2. **Retag the feature.**
   - The feature-level tag line becomes exactly `@regression @retry-directive`. The `@promotion-suggested-` marker goes too: its only readers are the per-issue and promotion sweeps, which list `features/per-issue/` alone. A relocated file is structurally "done".
   - Delete all 13 scenario-level tag lines. Each holds only `@adw-` tags.
   - Amend the five description sentences that name a dropped tag or a moved path, as 517f823d did for feature-910/911.
3. **Re-key the hooks.** In the moved step file, re-key `Before`/`After` from `@adw-908` to `@retry-directive`. Change nothing else. The hooks still own what they owned before:
   - the `gh` shadow and the blanked GitHub App variables, which keep posts away from the real #840/#871;
   - the saved and restored `agents/paused_queue.json` and `agents/.auth_gate`;
   - cleanup of fixtures, state, spawn locks and the cron registry entry.

   The suite's own `@regression` hooks also run. That is safe: `setupMockInfrastructure()` returns the live context on a second call, and `teardownMockInfrastructure()` is a no-op the second time. The pause-queue promotions already rely on this.
4. **Register the vocabulary.** Add a `## Given/When/Then — Retry Directive (@retry-directive)` section to the registry with 23 rows (G-RD1–8, W-RD1–3, T-RD1–12). Correct G19, whose registered semantics do not match its definition, and note where G19 and T27 are now defined. Reuse G1, G18, G19, T1, T14, T22, T25, T27, W16 and T34 as they are.
5. **Update the README.** Add one `retry-directive/` line to the `features/` tree.

## Relevant Files
Use these files to implement the feature:

**Moved (`git mv`):**
- `features/per-issue/feature-908.feature` → `features/regression/retry-directive/feature-908.feature`. The scenario file (381 lines, 26 scenarios after outline expansion). Edits:
  - line 1;
  - the 13 scenario-level tag lines (originally lines 222, 235, 250, 265, 275, 289, 299, 319, 338, 348, 365, 374 and 378);
  - five description sentences (originally lines 94, 99, 103, 154 and 182).
- `features/per-issue/step_definitions/feature-908.steps.ts` → `features/regression/step_definitions/feature-908.steps.ts`. The scenario's whole step-definition closure (549 lines):
  - 23 novel phrases, plus G19 and T27;
  - the unscoped `BeforeAll`/`AfterAll` for the `gh` shadow directory;
  - the `Before`/`After` keyed on `@adw-908` (lines 154 and 186), which are the only lines to change.

  It imports no per-issue sibling, and nothing imports it.

**Edited:**
- `features/regression/vocabulary.md`:
  - correct the G19 row (line 69) and annotate the T27 row (line 126);
  - insert the new `@retry-directive` section between the end of the Pause-Queue Ownership section (line 310) and `## Given/When/Then — Surface phases and lifecycles` (line 312).
- `README.md`: add one line for `features/regression/retry-directive/` to the `features/` tree, between the `pause-queue/` and `smoke/` lines (around lines 1175–1176).

**Read-only references:**
- `.adw/coding_guidelines.md`: guidelines. Comments explain only non-obvious reasons; files stay focused. Nothing here adds code.
- `.adw/scenarios.md`: the regression contract (Per-Issue/Regression Scenario Directory, Vocabulary Registry `features/regression/vocabulary.md`).
- `cucumber.js`:
  - `paths` covers `features/regression/**/*.feature` and `features/per-issue/**/*.feature`;
  - `import` loads `features/regression/step_definitions/**/*.ts` first, then `features/regression/support/**/*.ts`, `features/step_definitions/**/*.ts` and `features/per-issue/step_definitions/**/*.ts`.

  No edit. After the move, the 908 hooks register before `support/hooks.ts`. Its `Before` therefore runs before the `@regression` `Before`, and its `After` runs after the `@regression` `After`.
- `features/regression/support/hooks.ts`: the `@regression` `Before`/`After` (mock infrastructure setup, `runCleanup`, teardown, World reset) and `setDefaultTimeout(60_000)`. Do not tag the moved feature `@subprocess` or `@webhook`: that would add the subprocess harness.
- `test/mocks/test-harness.ts`:
  - `setupMockInfrastructure` is idempotent ("calling setup twice without teardown returns the existing context");
  - `teardownMockInfrastructure` is safe to call more than once, and restores `PATH`, `GH_TOKEN`, `GH_HOST` and the rest.

  This is the basis of the hook-compatibility argument.
- `features/regression/step_definitions/world.ts`: `RegressionWorld.mockContext` and `getRecordedRequests()`, imported by the moved file.
- `features/regression/step_definitions/feature-902-queue.steps.ts`:
  - `scanningCronFor`, which the moved file imports;
  - its hooks keyed on `(@adw-902 or … or @pause-queue-ownership) and not @adw-908 and not @adw-812`. No moved row carries any of those tags after the retag, so they never ran for it and still don't. Leave the now-inert `not @adw-908` clause as it is.
- `features/regression/step_definitions/feature-902.steps.ts`: has the same inert clause. Leave it.
- `features/regression/step_definitions/feature-910.steps.ts` and `feature-911.steps.ts`:
  - their hooks keyed on `@adw-911` currently also run for the still-queued row, because it carries `@adw-911`. After the retag they don't. That row needs nothing from them: its own hooks save and restore the auth gate and the queue, it pins no clock and it shadows no `bunx`;
  - they are also the precedent for descriptive-tag hooks.
- `features/per-issue/step_definitions/feature-959-world.ts`: `OWN_ROWS = '@adw-959 and not @adw-908 and not @adw-912'`, already inert for the moved rows. Leave it.
- `features/per-issue/step_definitions/feature-960.steps.ts`: its hooks are keyed on `@adw-f2mx98-…`/`@adw-p5u9xh-…`, not `@adw-960`, so the moved rows never depended on them.
- `features/regression/step_definitions/givenSteps.ts` (G1, G18), `whenSteps.ts` (W16) and `thenSteps.ts` (T1, T14, T22, T25 at line 356, T34): reused definitions. Never redefine them, or the steps become ambiguous.
- `features/regression/pause-queue/feature-910.feature`, `feature-911.feature`, `hashing/feature-537.feature`, `upgrade/feature-729.feature`: the end-state precedent. Each has a single feature-level tag line `@regression @<descriptive>` and no scenario-level `@adw-` lines.
- `adws/promotion/vocabularyParser.ts`: the registry format.
  - A section heading must match `^##\s+(Given|When|Then)\b`; `## Given/When/Then — …` does.
  - Rows need at least 5 pipe-separated cells, and no cell may contain a literal `|`.
  - Backticks are stripped from the phrase cell.
  - Pattern is `subprocess`, `phase-import` or `mock-query`.
  - Entries are keyed by phrase text, so IDs need not be unique.
- `adws/promotion/scenarioParser.ts` and `adws/promotion/promotionScorer.ts` (`matchPhrase`: `{string}` → `.*`, `{int}` → `\d+`, anchored): the matching semantics the registry-coverage validation command reproduces.
- `adws/core/promotionIssueBody.ts`: generates this issue's generic instructions. It is silent on the marker, which is why Notes records that decision.
- `adws/core/promotionTagState.ts`, `adws/triggers/perIssueScenarioSweep.ts` and `adws/triggers/promotionSweep.ts`: the only readers of `@promotion-suggested-`. All of them scan `features/per-issue/` only.
- The system under test, **not modified**:
  - `adws/triggers/retryHandler.ts` (`handleRetryDirective`, `buildRetryHandlerDeps`, the `paused_auth` log line at :111);
  - `adws/triggers/trigger_webhook.ts` (`dispatchWebhookEvent`);
  - `adws/triggers/pauseQueueScanner.ts`;
  - `adws/core/pauseQueue.ts`;
  - `adws/core/agentState.ts`.
- `adws/triggers/__tests__/retryHandler.test.ts`, `trigger_webhook.test.ts`, `pauseQueueScanner.test.ts`: existing unit coverage of the system under test. They must stay green.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: "A file carries one tag or the other."
- `specs/issue-923-adw-8d7505-feat-promote-910-sce-sdlc_planner-promote-910-pause-queue-regression.md` and `specs/issue-924-adw-r72d3j-feat-promote-911-sce-sdlc_planner-promote-911-pause-queue-regression.md`: the closest precedent plans.

### Relevant Documentation (matched via `.adw/conditional_docs.md`)
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: owns `features/regression/**`. It holds:
  - the manual direct-relocation recipe;
  - the rule that a promoted scenario drops every `@adw-` tag and re-keys its hooks to a descriptive tag (Gotchas);
  - the hook-compatibility note.
- `app_docs/feature-9gjajh-bdd-per-issue.md`: owns `features/per-issue/**`, which the two files leave.
- `app_docs/feature-9gjajh-promotion-system.md`:
  - the #734-shaped issue body;
  - "a merged promotion (file already `git mv`-ed out of `features/per-issue/`) is structurally `done`";
  - the non-blocking rot/reuse advisory comment that ADW posts on this PR.
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: the `## Retry` directive handler and the stage classifier (system under test).
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: owns `adws/triggers/retryHandler.ts` and covers the 14-day per-issue sweep.
- `app_docs/feature-9gjajh-pause-and-auth-queues.md`: `pauseQueue.ts` and the auth gate, the state files the scenarios assert on and restore.
- `app_docs/feature-9gjajh-webhook-triggers.md`: `dispatchWebhookEvent`, which the §4 row drives.
- `app_docs/feature-9gjajh-root-config.md`: owns `README.md`.

### New Files
- `features/regression/retry-directive/`: a new subject subdirectory, named in kebab-case like `pause-queue/`, for the `## Retry` directive. It holds the relocated `feature-908.feature`. Relocated content only; there are no new source files.
- `features/regression/step_definitions/feature-908.steps.ts`: a relocated path, not new content.

## Implementation Plan
### Phase 1: Foundation
Record baselines:
- `@adw-908` green before the move;
- the dry-run totals for the whole suite and for `@regression`.

Then relocate both files with `git mv` and touch nothing else. Prove the move is load-neutral before any edit: the same dry-run totals, 0 ambiguous, and no module-resolution error.

### Phase 2: Core Implementation
1. Rewrite the feature's tag lines to the regression shape and amend the five description sentences that name a dropped tag or a moved path.
2. Re-key the two hooks from `@adw-908` to `@retry-directive`.
3. Register the 23 novel phrases in a new registry section. Correct G19 and annotate G19/T27 with their new home.

### Phase 3: Integration
1. Add the README tree line.
2. Prove the 26 promoted scenarios green under `@retry-directive` and inside the full `@regression` run. The resumed-comment rows are the positive control that the re-keyed `Before` hook ran.
3. Prove that no scenario still selects on `@adw-908` and that every scenario step matches a registered phrase.
4. Run the full validation gate.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Record the pre-change baselines
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-908"`
  - Expect `26 scenarios (26 passed)`.
  - If any row fails before the move, stop and report it. A promotion must not import a red scenario.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run 2>&1 | tail -n 4`
  - Record the whole-suite scenario and step totals, and any `undefined` count.
  - Expect no `ambiguous`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@regression" 2>&1 | tail -n 4`
  - Record the `@regression` scenario count, called N below.

### 2. Relocate the feature file into `features/regression/retry-directive/`
- `mkdir -p features/regression/retry-directive`
- `git mv features/per-issue/feature-908.feature features/regression/retry-directive/feature-908.feature`
- Keep the file name `feature-908.feature`, as `pause-queue/feature-910.feature` does.

### 3. Relocate the step definitions
- `git mv features/per-issue/step_definitions/feature-908.steps.ts features/regression/step_definitions/feature-908.steps.ts`
- Do **not** rename the file, and do **not** edit any import. Every specifier resolves unchanged from the new location:
  - `../../regression/step_definitions/world.ts` and `../../regression/step_definitions/feature-902-queue.steps.ts` still resolve to `features/regression/step_definitions/`;
  - `../../../test/mocks/test-harness.ts` and `../../../adws/…` resolve at the same depth.
- The file builds no path from its own location at runtime:
  - its `__dirname` is declared but unused;
  - every artefact path is cwd-relative (`PAUSE_QUEUE_PATH`, `agents/.auth_gate`, `agents/<adwId>`) or under `os.tmpdir()`.
- `grep -rn "feature-908.steps" features adws test --include='*.ts'` must print nothing. Nothing imports the file, so nothing needs repointing.

### 4. Prove the relocation is load-neutral
- Re-run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run 2>&1 | tail -n 4`. Expect exactly the Task 1 whole-suite totals:
  - no `ambiguous`;
  - no `ERR_MODULE_NOT_FOUND` or other load error.
- Run `bunx tsc --noEmit -p tsconfig.json --incremental false`. It must pass. The root tsconfig includes `**/*.ts`, so it type-checks the moved file exactly as before.

### 5. Rewrite the moved feature's tags
In `features/regression/retry-directive/feature-908.feature`:
- Replace line 1, `@adw-908 @adw-2fgeai-retry-resumes-a-work @promotion-suggested-2026-10-04`, with exactly:
  `@regression @retry-directive`
- Delete each of the 13 scenario-level tag lines entirely. Every one holds only `@adw-` tags, so no tag survives on them. The lines are:
  - `  @adw-908 @adw-2fgeai-retry-resumes-a-work`: seven lines, above the §1 #840 replay, the §1 resolution outline, the §1 predates-scripts row, the §1 own-entry row, the §4 webhook row, and the two §5 backstops;
  - `  @adw-908 @adw-2fgeai-retry-resumes-a-work @adw-911`: one line, above the §1 still-queued scenario;
  - `  @adw-908 @adw-2fgeai-retry-resumes-a-work @adw-960`: four lines, above the §2 paused_auth row, the §2 finished-stage outline, the §3 merge_blocked row and the §3 human_gated/review_failed outline;
  - `  @adw-908 @adw-2fgeai-retry-resumes-a-work @adw-959 @adw-960`: one line, above the §2 running-stage outline.

  That makes 7 + 1 + 4 + 1 = 13 lines.
- Do **not** add `@regression` or any other tag at scenario level. Feature-level tags are inherited by every scenario and every `Examples` row.
- Do **not** add `@webhook`, `@subprocess`, `@smoke` or `@surface`. Each of those keys extra harness hooks.
- Leave the `# ── §N …` banners and every step line untouched.

### 6. Amend the description sentences that name a dropped tag or a moved path
Make exactly these five in-place replacements in the moved feature file. Line widths stay within a character or two, so nothing else needs re-wrapping:
- In the FLAGGED BY #911 paragraph:
  - `  §1's still-queued scenario also carries `@adw-911`. Its follow-up step, "the pause-queue scanner`
  - → `  §1's still-queued scenario is the row #911 flagged. Its follow-up step, "the pause-queue scanner`
- Same paragraph, last line:
  - `  `features/per-issue/feature-911.feature`.`
  - → `  `features/regression/pause-queue/feature-911.feature`.`

  #911 has since been promoted to that path.
- In the FLAGGED BY #959 paragraph:
  - `  `## Retry`. §2's running-stage outline also carries `@adw-959`: `## Retry` stays a no-op on every`
  - → `  `## Retry`. §2's running-stage outline is the row #959 flagged: `## Retry` stays a no-op on every`
- In the COMMENTS MUST REACH THE MOCK GITHUB API note:
  - `      an `@adw-908` `Before` hook. The Background's "accept issue comments" Given fails fast`
  - → `      a `@retry-directive` `Before` hook. The Background's "accept issue comments" Given fails fast`
- Last bullet of the Notes for the step definitions:
  - `    • Scope every hook to `@adw-908`.`
  - → `    • Scope every hook to `@retry-directive`.`

Leave the rest of the description verbatim. It is #908's historical specification, and a comment clean-up would be a separate chore. That includes:
- the REGISTERED BUT UNIMPLEMENTED note;
- the REUSED, NOT REDEFINED note, which mentions `feature-844.steps.ts`;
- the "#959 … `features/per-issue/feature-959.feature`" reference, which is still accurate today.

Afterwards:
- `grep -nE "@adw-|@promotion-" features/regression/retry-directive/feature-908.feature` must print nothing.
- `grep -cE '^[[:space:]]*@' features/regression/retry-directive/feature-908.feature` must print `1`.

### 7. Re-key the moved step file's scenario hooks
In `features/regression/step_definitions/feature-908.steps.ts`, change exactly two lines:
- `Before({ tags: '@adw-908' }, async function (this: RegressionWorld) {` → `Before({ tags: '@retry-directive' }, async function (this: RegressionWorld) {`
- `After({ tags: '@adw-908' }, async function (this: RegressionWorld) {` → `After({ tags: '@retry-directive' }, async function (this: RegressionWorld) {`

Rules:
- Do **not** add an `@adw-908 or …` alternative. No feature carries `@adw-908` after Task 5.
- Leave `BeforeAll`/`AfterAll` unscoped, as they are.
- Change no other line: no step text, no import, no helper, and not the unused `__dirname`.

Afterwards, `grep -n "@adw-" features/regression/step_definitions/feature-908.steps.ts` must print nothing.

Leave every other hook in the repository unchanged:
- the `and not @adw-908` clauses in `feature-902.steps.ts` and `feature-902-queue.steps.ts`;
- `OWN_ROWS` in `feature-959-world.ts`.

They are inert once no feature carries `@adw-908`, and `feature-911.feature`'s description quotes the 902 expression verbatim.

### 8. Register the scenario's phrases in `features/regression/vocabulary.md`
- **G19 (line 69).** Replace the whole row. Its semantics describe a two-repo World that the definition never builds:
  ```md
  | G19 | `the cron is polling the target repository {string} from a host checked out at {string}` | Builds the handling cron's own launch inputs for the named target repository: its `--target-repo` args (`buildCronTargetRepoArgs`) and a launch boundary for it (`buildLaunchBoundary`), which W-RD1 hands to the Retry handler. The host is the ADW checkout the scenario runs in, so its repository needs no setup. Defined in `features/regression/step_definitions/feature-908.steps.ts` | phase-import | handler input (SUT input) |
  ```
- **T27 (line 126).** Replace the whole row:
  ```md
  | T27 | `the mock harness recorded zero comment posts on issue {int} in the cron host's own repository {string}` | Queries recorded requests; asserts no POST to `/repos/<owner>/<repo>/issues/N/comments` was captured for the cron host's own repository. Defined in `features/regression/step_definitions/feature-908.steps.ts` | mock-query | recorded requests |
  ```
- **New section.** Insert it after the Pause-Queue Ownership section's closing paragraph, which ends `… T22, T25, and the generic W16/T34 above.`, and before `## Given/When/Then — Surface phases and lifecycles`. Leave one blank line on each side, with no `---`, matching its pause-queue neighbours. Insert this text verbatim:

```md
## Given/When/Then — Retry Directive (@retry-directive)

These phrases drive the `## Retry` directive handler in-process (phase-import pattern). The cron
path calls the real `handleRetryDirective` with the issue's seeded comments plus a trailing
`## Retry` comment and `buildRetryHandlerDeps` over the launch boundary and `--target-repo` args
G19 builds, with only its `spawnDetached` seam replaced by a recorder. The webhook path dispatches a
real `issue_comment` through `dispatchWebhookEvent`, whose launch is the real one, so the state it
resumes names a throwaway recording fixture orchestrator; every pause-queue entry seeded here names
such a fixture too, so anything that resumes from an entry launches only the fixture. `gh` is
shadowed on `PATH` and its `gh issue comment` posts are replayed against the mock GitHub API, and the
GitHub App variables and `GITHUB_WEBHOOK_SECRET` are blanked, so no post reaches a real repository.
The real `agents/paused_queue.json` and `agents/.auth_gate` are saved before each scenario and
restored after it. Every assertion targets a runtime artefact: the launches recorded at the spawn
seam, the fixture orchestrators' invocation logs, the pause-queue state file
(`agents/paused_queue.json`), the top-level state file (`agents/<adwId>/state.json`), the requests
the mock GitHub API recorded, or the logger output captured while the directive is handled. No step
reads, greps or parses a source file, satisfying the Rot-Detection Rubric. The definitions, G19 and
T27 among them, live in `feature-908.steps.ts`, whose `@retry-directive` hooks set up and restore
all of the above.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-RD1 | `the latest ADW workflow comment on issue {int} names adwId {string}` | Adds a comment carrying the `**ADW ID:**` marker and the adwId in backticks, the form the handler extracts an adwId from, to the issue's comment list that W-RD1 and W-RD3 hand the handler. Uses only lowercase letters, digits and hyphens in an adwId, or the handler extracts none and a no-op row passes vacuously | phase-import | handler input (SUT input) |
| G-RD2 | `the top-level state for adwId {string} records issue {int} at workflowStage {string} with orchestrator script {string}` | Writes `agents/<adwId>/state.json` through `AgentStateManager.writeTopLevelState` with the adwId, the issue number, the stage, the `orchestratorScript` and `repoIdentity` `acme/widgets`; the After hook removes `agents/<adwId>/` | phase-import | state file artefact (SUT input) |
| G-RD3 | `the top-level state for adwId {string} records issue {int} at workflowStage {string} with no orchestrator script` | As G-RD2 with no `orchestratorScript`, the shape of a state written before orchestrator scripts were recorded | phase-import | state file artefact (SUT input) |
| G-RD4 | `the top-level state for adwId {string} records issue {int} at workflowStage {string} with a merge retry count of {int}` | As G-RD2 with `mergeRetryCount` set and no `orchestratorScript` | phase-import | state file artefact (SUT input) |
| G-RD5 | `the top-level state for adwId {string} records issue {int} at workflowStage {string} with a resume attempt count of {int}` | As G-RD2 with `resumeAttempts` set and no `orchestratorScript` | phase-import | state file artefact (SUT input) |
| G-RD6 | `the top-level state for adwId {string} records issue {int} at workflowStage {string} with a recording fixture as its orchestrator script` | Writes a throwaway fixture orchestrator under `os.tmpdir()` that appends its argv to an invocation log and stays alive, then writes the state as G-RD2 does with the fixture's absolute path as `orchestratorScript`, so a real launch from that state runs only the fixture; the After hook kills it and removes its directory | phase-import | state file artefact + fixture orchestrator (SUT input) |
| G-RD7 | `the rate-limit pause queue holds no entry for adwId {string}` | Removes any entry for the adwId from the real pause-queue state file `agents/paused_queue.json`, which the Before hook saved and cleared and the After hook restores | phase-import | pause-queue state artefact |
| G-RD8 | `the rate-limit pause queue holds an entry for adwId {string} on issue {int}` | Appends a `rate_limited` entry for the adwId and issue to the real pause-queue state file, with a temporary worktree, `--target-repo acme/widgets` and a throwaway recording fixture as `orchestratorScript`, so anything that resumes from the entry (the scanner, or a handler that delegates to it) launches only the fixture | phase-import | pause-queue state artefact |
| W-RD1 | `the cron handles the ## Retry directive on issue {int}` | Calls the real `handleRetryDirective` in-process as `trigger_cron.ts` does: the issue's seeded comments plus a trailing `## Retry` comment, and `buildRetryHandlerDeps` over G19's launch boundary and `--target-repo` args with only `spawnDetached` replaced by a recorder of each launch's command and argv. Captures the logger's output during the call, then replays the shadowed `gh issue comment` posts against the mock GitHub API | phase-import | recorded launches + state file + queue state + recorded requests + log stream |
| W-RD2 | `the pause-queue scanner then runs a probe cycle in which the rate limit has cleared` | Runs the real `scanPauseQueue` once, at `PROBE_INTERVAL_CYCLES`, as the cron polling `acme/widgets` (the owner of every entry G-RD8 seeds) with a probe that answers `clear`, then replays the shadowed comment posts | phase-import | queue state + fixture launches + recorded requests |
| W-RD3 | `the webhook receives a {string} comment on issue {int} from the repository {string}` | Registers this process as the repository's running cron (`writeCronPid`) so no cron is spawned, then dispatches an unsigned `issue_comment` `created` payload carrying the comment through the real `dispatchWebhookEvent`, with an event-boundary minter whose tracker serves the issue's seeded comments. Its launch is the real one, so only G-RD6's fixture can run | phase-import | fixture launches |
| T-RD1 | `exactly one orchestrator was launched for issue {int}` | Counts the launches W-RD1 recorded for the issue plus the launches the issue's G-RD8 fixture recorded, and asserts the count is 1 | phase-import | recorded launches + fixture invocation log |
| T-RD2 | `no orchestrator was launched for issue {int}` | Waits briefly for an asynchronous fixture launch, then asserts the count T-RD1 takes is 0 | phase-import | recorded launches + fixture invocation log |
| T-RD3 | `the orchestrator launched for issue {int} runs {string} under adwId {string}` | Asserts the launch W-RD1 recorded for the issue runs the given script, as the handler resolved it, under the given adwId | phase-import | recorded launch argv |
| T-RD4 | `the orchestrator launched for issue {int} targets the repository {string}` | Asserts the launch W-RD1 recorded for the issue carries `--target-repo <repository>` in its argv | phase-import | recorded launch argv |
| T-RD5 | `no entry for adwId {string} was added to the rate-limit pause queue` | Reads the pause-queue state file; asserts no entry carries the adwId | phase-import | pause-queue state artefact |
| T-RD6 | `the rate-limit pause queue no longer holds an entry for adwId {string}` | Reads the pause-queue state file; asserts the entry G-RD8 seeded for the adwId is gone | phase-import | pause-queue state artefact |
| T-RD7 | `the rate-limit pause queue still holds the entry for adwId {string}` | Reads the pause-queue state file; asserts an entry still carries the adwId | phase-import | pause-queue state artefact |
| T-RD8 | `the pause-queue scanner relaunched nothing for issue {int}` | Asserts the invocation log of the issue's G-RD8 fixture orchestrator holds no launch | phase-import | fixture invocation log |
| T-RD9 | `the Retry handling logged that issue {int} is paused_auth and left to the auth queue` | Asserts a line of the logger output W-RD1 captured names `#<issue>`, `paused_auth` and the auth queue (`auth queue`, `auth-queue` or `authQueue`, any case) | phase-import | log stream |
| T-RD10 | `the top-level state for adwId {string} records a merge retry count of {int}` | Reads `agents/<adwId>/state.json`; asserts its `mergeRetryCount` | phase-import | state file artefact |
| T-RD11 | `the top-level state for adwId {string} records a resume attempt count of {int}` | Reads `agents/<adwId>/state.json`; asserts its `resumeAttempts` | phase-import | state file artefact |
| T-RD12 | `no orchestrator was launched for issue {int} without the target repository {string}` | Waits briefly, then asserts every launch G-RD6's fixture recorded for the issue carries `--target-repo <repository>`; holds when nothing was launched, since leaving a paused workflow to the cron is legitimate | phase-import | fixture invocation log |

This scenario also reuses already-registered phrases, so they need no new rows: `the ADW codebase
is checked out` (G18, Background), G19 (Background) and T27, both defined in `feature-908.steps.ts`,
G1, T1, T14, T22, T25, and the git/gh guard pair W16/T34.
```

- Check that no added cell contains a literal `|`. The parser splits cells on it.

### 9. Add the README tree line
In `README.md`'s `features/` tree, insert this line between `│   ├── pause-queue/ …` and `│   ├── smoke/ …`, keeping the tree alphabetical:
```
│   ├── retry-directive/  # Regression scenarios covering the ## Retry directive: reviving a workflow stranded in the paused stage, while paused_auth, running, finished and human-gated stages behave as before (#908)
```
Change nothing else in `README.md`. It already carries unrelated uncommitted tree-sync edits in this worktree (renamed `adws/core/__tests__` files). Leave them as they are; do not revert them.

### 10. Run the promoted scenarios and the regression suite
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@retry-directive"`: expect `26 scenarios (26 skipped)` with no `undefined` and no `ambiguous`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@retry-directive"`: expect `26 scenarios (26 passed)`.
  - The #840 and still-queued rows assert T25, the resumed comment recorded through the `gh` shadow replay. They are the positive control that the re-keyed `Before` ran.
  - The zero-comment rows are the vacuity guard.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-908"`: expect `0 scenarios`. No feature selects on the per-issue tag any longer.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@regression" 2>&1 | tail -n 4`: expect N + 26 scenarios, where N is the Task 1 count.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: expect every scenario passed, the 26 promoted ones included.
  - If a scenario outside `features/regression/retry-directive/` fails, re-run that feature alone by its descriptive tag.
  - A failure that reproduces without the moved feature is pre-existing. Report it in the PR rather than fix it here.
  - A failure that appears only alongside the moved feature is a cross-scenario leak in the moved hooks. Fix it before proceeding.

### 11. Run the validation commands
Run every command in `Validation Commands` below and confirm each one passes as described.

## Testing Strategy
### Unit Tests
`.github/adw.yml` leaves `unitTests` commented out, so unit tests are enabled and this subsection is included. **No new unit tests are warranted or created.**
- The change relocates two BDD files, changes two hook tag strings, edits feature prose and tags, and edits Markdown in the registry and README. It adds no `adws/**` logic to unit-test.
- Vitest collects only `adws/**/__tests__/**/*.test.ts` and `test/mocks/__tests__/**/*.test.ts` (`vitest.config.ts`), so moving files under `features/` cannot affect it.
- The system under test already has vitest coverage, which must stay green:
  - `adws/triggers/__tests__/retryHandler.test.ts`
  - `trigger_webhook.test.ts`
  - `pauseQueueScanner.test.ts`
  - `pauseQueueDecider.test.ts`
- Run `bun run test:unit` as the regression guard.
- The coding guidelines name BDD scenarios as ADW's independent validation. The behavioural proof for this change is the `@retry-directive` and `@regression` runs.
- This is a `regression-promotion` issue, so ADW authors no `@adw-999` scenario. The Validation Commands are the proof.

### Edge Cases
- **Outline examples inherit feature-level tags.** All 26 executions get the `@retry-directive` hooks: the 8 running-stage, 5 finished-stage, 2 script and 2 human-gated/review-failed examples, plus the 9 plain scenarios.
- **Both mock-infrastructure hooks run.** The `@retry-directive` `Before` registers before `support/hooks.ts` and calls `setupMockInfrastructure()` first. The `@regression` `Before` then reuses the live context.
- **After-hook order.** The `@regression` `After` tears down first, restoring `PATH` and removing the `gh` shadow. The `@retry-directive` `After` then kills fixtures, restores the queue, auth gate and env, and calls teardown again as a no-op.
- **The still-queued row no longer carries `@adw-911`.** The feature-902/902-queue/910/911 hooks stop running for it. It needs none of them:
  - its own hooks save and restore the queue and auth gate;
  - its scan uses the pure `scanningCronFor('acme/widgets')`, no pinned clock and no `bunx` shadow.
- **The running-stage outline no longer carries `@adw-959`.** `OWN_ROWS` already excluded it, so nothing changes.
- **The `@adw-960` rows.** feature-960's hooks are keyed on other tags, so those rows depend on nothing that disappears.
- **No feature keeps an `@adw-908` tag.** The `not @adw-908` clauses elsewhere become inert. Verified by the `--tags "@adw-908"` dry-run reporting `0 scenarios`.
- **The §4 row must not be tagged `@webhook`.** That would add the subprocess harness and the `webhookCronSteps.ts` hooks, which manage the same auth gate and env.
- **Safety stays scope-bound.** The handler runs in-process in the real checkout, where #840 and #871 are real issues. If the hook tag and the feature tag ever diverged, the rows would run without the `gh` shadow or the blanked GitHub App variables. The T25 positive-control rows fail loudly in that case, because no resumed comment reaches the mock.
- **Operator state is preserved.** A pre-existing `agents/paused_queue.json` or `agents/.auth_gate` on the running host is saved and restored around every row, as before.
- **Negative-launch rows** (T-RD2, T-RD12) wait for a possible asynchronous fixture launch before concluding.
- **The marker is gone from the moved file.** The per-issue and promotion sweeps never list files outside `features/per-issue/`, so nothing reads it any longer.
- **Type-check scope is unchanged.** The root `tsconfig.json` includes `**/*.ts`. ESLint scope is unchanged too: `eslint.config.js` ignores only `node_modules/`, `dist/`, `.claude/`, `.worktrees/` and Markdown.

## Acceptance Criteria
- `features/per-issue/feature-908.feature` and `features/per-issue/step_definitions/feature-908.steps.ts` no longer exist.
- `features/regression/retry-directive/feature-908.feature` and `features/regression/step_definitions/feature-908.steps.ts` exist as `git mv` renames, so history follows.
- The moved feature has exactly one tag line, `@regression @retry-directive`. No line in it carries `@adw-` or `@promotion-`, and its scenario steps are byte-identical to the originals.
- The moved step file differs from the original only in its two hook tag strings, now `@retry-directive`. Its imports are unchanged.
- `--tags "@retry-directive"` runs 26 scenarios, all passed.
- `--tags "@regression"` is green and includes those 26 scenarios.
- `--dry-run --tags "@adw-908"` selects 0 scenarios.
- The whole-suite dry-run totals equal the Task 1 baseline, with no `ambiguous` step.
- Every step of every scenario in the moved feature matches a phrase registered in `features/regression/vocabulary.md`:
  - 23 new `G-RD`/`W-RD`/`T-RD` rows in a `## Given/When/Then — Retry Directive (@retry-directive)` section;
  - G19 corrected, and G19/T27 annotated with their definition file;
  - each new description asserts a runtime artefact, never a source-file property.
- `README.md`'s `features/` tree lists `retry-directive/`.
- `bun run lint`, both type-checks, `bun run test:unit` and `bun run build` pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `test ! -e features/per-issue/feature-908.feature && test ! -e features/per-issue/step_definitions/feature-908.steps.ts && test -f features/regression/retry-directive/feature-908.feature && test -f features/regression/step_definitions/feature-908.steps.ts`: the old paths are gone and the new ones exist.
- `git diff -M --stat "$(git merge-base HEAD origin/dev)" -- features/per-issue/step_definitions/feature-908.steps.ts features/regression/step_definitions/feature-908.steps.ts`: shows one rename, `features/{per-issue => regression}/step_definitions/feature-908.steps.ts`, with 2 insertions and 2 deletions.
- `test "$(head -n 1 features/regression/retry-directive/feature-908.feature)" = "@regression @retry-directive" && test "$(grep -cE '^[[:space:]]*@' features/regression/retry-directive/feature-908.feature)" = "1"`: a single feature-level tag line, in the regression shape.
- `! grep -nE "@adw-|@promotion-" features/regression/retry-directive/feature-908.feature && ! grep -n "@adw-" features/regression/step_definitions/feature-908.steps.ts && test "$(grep -c "tags: '@retry-directive'" features/regression/step_definitions/feature-908.steps.ts)" = "2"`: no per-issue tag remains anywhere in the moved files, and both hooks are re-keyed.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@retry-directive"`: 26 scenarios, no undefined, no ambiguous.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-908"`: 0 scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run 2>&1 | tail -n 4`: whole-suite totals equal the Task 1 baseline, with no `ambiguous`.
- Registry coverage. Every scenario step of the moved feature matches a registered phrase, using the promotion scorer's matching rules. The Background phrases are the registered G1, G18 and G19. Run:
  ```sh
  bun -e '
  (async () => {
    const { readFileSync } = await import("fs");
    const { parse: parseVocabulary } = await import(process.cwd() + "/adws/promotion/vocabularyParser.ts");
    const { parse: parseScenarios } = await import(process.cwd() + "/adws/promotion/scenarioParser.ts");
    const toRegExp = (phrase) => new RegExp("^" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{string\\\}/g, ".*").replace(/\\\{int\\\}/g, "\\d+") + "$");
    const matchers = [...parseVocabulary(readFileSync("features/regression/vocabulary.md", "utf-8")).entries.keys()].map(toRegExp);
    const steps = parseScenarios(readFileSync("features/regression/retry-directive/feature-908.feature", "utf-8")).flatMap((s) => s.steps.map((step) => step.text));
    const unregistered = [...new Set(steps.filter((text) => !matchers.some((m) => m.test(text))))];
    if (unregistered.length > 0) { console.error("Unregistered step phrases:\n" + unregistered.join("\n")); process.exit(1); }
    console.log(`All ${steps.length} scenario steps match a registered phrase`);
  })().catch((err) => { console.error(err); process.exit(1); });
  '
  ```
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@retry-directive"`: the 26 promoted scenarios, all passed.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the regression suite, from `.adw/commands.md`'s "Run Regression Scenarios". It is green with the 26 promoted scenarios included.
- `bun run lint`: linter.
- `bunx tsc --noEmit`: root type-check, which includes `features/**`.
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional type-check.
- `bun run lint:git-guard`: the git/gh guard, which also exempts `features/`.
- `bun run test:unit`: the vitest suite, unchanged and green.
- `bun run build`: build.

## Notes
- Strictly follow `.adw/coding_guidelines.md`. This change adds no code. It touches two hook tag strings, feature tags and prose, and Markdown. Do not refactor the moved step file:
  - no import rewrites;
  - no removal of the unused `__dirname`;
  - no rename.

  The relocation stays a pure, reviewable `git mv` plus the minimum edits.
- **The promotion marker is dropped deliberately.** The issue body comes from the generic `buildPromotionIssue` template and does not mention `@promotion-suggested-2026-10-04`. The plan drops it anyway, for three reasons:
  - it is the per-issue lifecycle marker; its only readers, `promotionTagState` through the per-issue and promotion sweeps, scan `features/per-issue/` alone;
  - a relocated file is structurally `done` (`app_docs/feature-9gjajh-promotion-system.md`);
  - every promoted feature (537, 729, 910, 911) ends with exactly `@regression @<descriptive>`, in line with ADR-0037's "a file carries one tag or the other".
- **Descriptive tag and subdirectory.** `@retry-directive` and `retry-directive/` name the scenario's subject: the `## Retry` directive handler across every stage, not just the pause queue. Neither name is used anywhere else in the repository.
- **Clauses left inert.** After this change, `and not @adw-908` in `feature-902.steps.ts` and `feature-902-queue.steps.ts`, and in `OWN_ROWS` in `feature-959-world.ts`, match nothing. They are left as they are to keep the diff to the promotion. `feature-911.feature`'s description quotes the 902 expression verbatim, and the 959 files will be swept or promoted on their own. A later chore may tidy them.
- **Docs for the document phase.** `app_docs/feature-9gjajh-bdd-regression-suite.md` still lists `feature-908` among "the rows still under `features/per-issue/`" that carry `@adw-910`/`@adw-911`, and does not yet list `features/regression/retry-directive/` or the `@retry-directive` tag. Updating it and `.adw/conditional_docs.md` belongs to the document phase, not the build.
- **Runtime cost.** The `@regression` suite gains 26 scenarios. The marginal cost is dominated by one more T22 `tsc --noEmit` run, about the cost of the existing 537/910/911 backstops. The rest is the git/gh guard subprocess and the short negative-launch waits.
- **HITL.** The PR is labelled `hitl` and must be approved by a human before merge. ADW also posts a non-blocking rot/reuse advisory comment on this `regression-promotion` PR (`executePromotionRotAdvisory`).
- **No new library.** If one were needed, the install command is `bun add <package>`.
