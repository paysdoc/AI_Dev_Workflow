# Feature: Promote the #936 cost-records and Worker-deploy scenarios into the @regression suite

## Metadata
issueNumber: `1004`
adwId: `kxhrqo-feat-promote-936-sce`
issueJson: `{"number":1004,"title":"feat: promote #936 scenario into the @regression suite","body":"Promotes: feature-936\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-936` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-936.feature features/regression/<subdir>/feature-936.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-936.feature`\n- Step definitions:\n- (no step-def siblings found)\n\n## Phrases to register\n\n- `cost comments are enabled`\n- `an agent run of the \"plan\" phase whose Claude CLI result message reports:`\n- `the \"plan\" phase builds its cost records from its agent run`\n- `the \"plan\" cost record for model \"claude-sonnet-4-5-20250929\" holds a reported cost of $0.1200`\n- `the \"plan\" cost record for model \"claude-sonnet-4-5-20250929\" holds a computed cost of $0.0900`\n- `the divergence check fires for the \"plan\" cost record for model \"claude-sonnet-4-5-20250929\"`\n- `the completion comment's cost section warns that \"plan\" on \"claude-sonnet-4-5-20250929\" computed $0.0900 against a reported $0.1200, a 25.0% difference`\n- `the \"plan\" cost record for model \"claude-sonnet-4-5-20250929\" holds a reported cost of $0.0920`\n- `the divergence check does not fire for the \"plan\" cost record for model \"claude-sonnet-4-5-20250929\"`\n- `the completion comment's cost section carries no cost divergence warning`\n- `an agent run of the \"build\" phase whose Claude CLI result message reports:`\n- `that result message reports a total cost of $0.0960`\n- `the \"build\" phase builds its cost records from its agent run`\n- `the \"build\" cost record for model \"claude-opus-4-6\" holds a reported cost of $0.0900`\n- `the \"build\" cost record for model \"claude-haiku-4-5-20251001\" holds a reported cost of $0.0060`\n- `the divergence check fires for no \"build\" cost record`\n- `a first agent run of the \"review\" phase whose Claude CLI result message reports:`\n- `a second agent run of the \"review\" phase whose Claude CLI result message reports:`\n- `the \"review\" phase builds its cost records from its agent runs`\n- `the \"review\" cost record for model \"claude-sonnet-4-5-20250929\" holds a reported cost of $0.1380`\n- `the \"review\" cost record for model \"claude-sonnet-4-5-20250929\" holds a computed cost of $0.1350`\n- `the \"review\" cost record for model \"claude-sonnet-4-5-20250929\" carries actual tokens:`\n- `an agent run of the \"build\" phase that streams these assistant turns for model \"claude-sonnet-4-5-20250929\" and is stopped before the Claude CLI writes its result message:`\n- `the \"build\" cost record for model \"claude-sonnet-4-5-20250929\" holds no reported cost`\n- `the \"build\" cost record for model \"claude-sonnet-4-5-20250929\" holds a computed cost of $0.0570`\n- `the divergence check does not fire for the \"build\" cost record for model \"claude-sonnet-4-5-20250929\"`\n- `a cost API that records the cost records posted to it`\n- `the phase runner posts the \"plan\" phase's cost records to the cost API`\n- `the cost API received a \"plan\" record for model \"claude-sonnet-4-5-20250929\" with reported_cost_usd 0.12 and computed_cost_usd 0.09`\n- `the cost API stores for project \"acme-widgets\" a \"plan\" record of issue 936 for model \"claude-sonnet-4-5-20250929\" with computed_cost_usd 0.09 and reported_cost_usd 0.12`\n- `the cost breakdown and the per-issue costs of project \"acme-widgets\" are requested from the cost API`\n- `the cost API's cost breakdown gives model \"claude-sonnet-4-5-20250929\" a cost of $0.0900`\n- `the cost API's per-issue costs give the \"plan\" phase of issue 936 a cost of $0.0900`\n- `an agent run of the \"plan\" phase that streams these assistant turns for model \"claude-sonnet-4-5-20250929\":`\n- `the agent run ends with a Claude CLI result message that reports:`\n- `the \"plan\" cost record for model \"claude-sonnet-4-5-20250929\" carries estimated tokens:`\n- `the \"plan\" cost record for model \"claude-sonnet-4-5-20250929\" carries actual tokens:`\n- `the completion comment's cost section reports estimated against actual tokens for \"plan\" on \"claude-sonnet-4-5-20250929\":`\n- `the \"build\" cost record for model \"claude-sonnet-4-5-20250929\" carries estimated tokens:`\n- `the \"build\" cost record for model \"claude-sonnet-4-5-20250929\" carries no actual tokens`\n- `the completion comment's cost section reports no estimated against actual tokens for \"build\" on \"claude-sonnet-4-5-20250929\"`\n- `a throwaway repository whose default branch is \"dev\" and whose \"main\" holds the previous release`\n- `a commit on \"dev\" that is not yet on \"main\" changes \"workers/cost-api/wrangler.toml\"`\n- `a commit on \"dev\" that is not yet on \"main\" changes \"workers/screenshot-router/wrangler.toml\"`\n- `\"dev\" is merged into \"main\" with a merge commit, the way releases are merged`\n- `the change-detection step of the deploy workflow runs for the push of that merge to \"main\"`\n- `a comparison of \"main\" with the default branch \"dev\" finds no changed file`\n- `the change detection marks the \"cost-api\" Worker for deployment`\n- `the change detection marks the \"screenshot-router\" Worker for deployment`\n- `a commit on \"dev\" that is not yet on \"main\" changes \"<changed file>\"`\n- `the change detection marks the \"<deployed>\" Worker for deployment`\n- `the change detection leaves the \"<not deployed>\" Worker out of the deployment`\n- `a commit on \"dev\" that is not yet on \"main\" changes \"README.md\"`\n- `the change detection leaves the \"cost-api\" Worker out of the deployment`\n- `the change detection leaves the \"screenshot-router\" Worker out of the deployment`\n- `a pull request that changes \"workers/screenshot-router/src/index.ts\" has been merged into \"dev\" with a merge commit`\n- `a later pull request that changes \"README.md\" has been merged into \"dev\" with a merge commit`\n- `a commit on \"dev\" that is not yet on \"main\" changes \".github/workflows/deploy-workers.yml\"`\n- `the change-detection step of the deploy workflow runs for the push of that merge to \"main\" in a checkout that holds only the pushed commit`\n- `the change detection either fails or marks the \"cost-api\" Worker for deployment`\n- `the ADW codebase is checked out`\n- `the ADW TypeScript type-check passes`\n- `the git/gh guard is run across the repository`\n- `the git/gh guard reports no violations`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-936.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-04T15:36:19Z","comments":[],"actionableComment":null}`

## Feature Description
Relocate `features/per-issue/feature-936.feature` into the standing `@regression` suite as
`features/regression/cost/feature-936.feature`. It is the behavioural contract of #936 (PR #947, merged
2026-10-01): 18 test cases (16 scenarios, plus a Scenario Outline with 2 examples) and 101 executed steps.
They cover four areas:

- **Cost records.** Each phase's cost record holds the Claude CLI's own per-model figure as its
  *reported* cost, next to the locally *computed* cost. The divergence check fires only when the two
  differ by more than 5%. A run stopped before the CLI's result message holds no reported cost. Several
  runs of one phase sum their figures, computed costs and actual tokens.
- **Token estimates.** A cost record carries the streamed token *estimate* and the CLI's *actual*
  counts. The completion comment's cost section reports one against the other, and never passes an
  estimate off as an actual count.
- **The cost API.** It receives the CLI's figure as `reported_cost_usd` and the local computation as
  `computed_cost_usd`, and totals a project's costs from the computed cost only.
- **Worker deployment.** A release merge from `dev` into `main` that touches a Worker, or the deploy
  workflow itself, marks that Worker for deployment. This holds even though `main` then holds the same
  files as `dev`, for changes brought by an earlier pull request of the release, and in a shallow
  checkout. Two backstops are included: the TypeScript type-check and the git/gh guard.

The relocation moves the scenario's **whole step-definition dependency closure** with it. That is nine
`feature-936-*` modules in `features/per-issue/step_definitions/` and two child-process drivers in
`features/per-issue/support/`. The feature is retagged `@regression @cost-records`. Every `@adw-` tag is
dropped, and so is the now-meaningless `@promotion-suggested-2026-10-04` marker. The three hooks keyed
on `@adw-936` are re-keyed to `@cost-records`, and the scenario's phrases are registered in
`features/regression/vocabulary.md`.

Value: once #936's workflow finished, nothing runs these scenarios. Promoting them means every ADW
workflow's test phase and the daily regression run will catch any of these regressions:

- a cost record that reports the computed cost as the CLI's figure;
- a lost token estimate;
- a cost API that totals from the wrong column;
- a deploy workflow that silently skips a Worker changed by a release.

## User Story
As an ADW maintainer
I want the #936 cost-record, cost-API and Worker-deploy scenarios to run in the standing `@regression` suite
So that a regression in cost reporting or in the Worker deploy workflow's change detection is caught on every workflow's test phase and by the daily regression run, not only by #936's own, already finished, workflow

## Problem Statement
- `features/per-issue/feature-936.feature` runs only under its own `@adw-936` tag. #936's workflow is
  done, so nothing executes the scenario any more.
- **The issue's "Step definitions: (no step-def siblings found)" is wrong.** Both
  `promotionSweepDefaults.ts:146` and `perIssueScenarioSweep.ts:96` list siblings with
  `startsWith('feature-936.')`. The scenario's step definitions are hyphen-named, so none matched:
  `feature-936-costRecords.steps.ts`, `feature-936-costApi.steps.ts`, `feature-936-deploy.steps.ts` and
  six helper modules. Its two child-process drivers live in `features/per-issue/support/`, which no
  lister looks at. Following the issue literally would leave a regression feature depending on
  per-issue files. `app_docs/feature-9gjajh-bdd-regression-suite.md` forbids that: "promote the whole
  dependency closure", "nothing depends on swept per-issue files". It would also break the issue's own
  acceptance line, "the old per-issue paths … and its step-def siblings no longer exist".
- Three hooks are keyed on `@adw-936`:
  - `Before` in `feature-936-costRecords.steps.ts:37` resets the module-scoped run/record/section state.
  - `After` in `feature-936-costApi.steps.ts:46` stops the recording HTTP server and resets the Worker
    API state.
  - `After` in `feature-936-deploy.steps.ts:35` removes the throwaway repositories and checkouts.

  Once `@adw-936` is removed they would never run. Runs would then accumulate across scenarios and
  give wrong costs, the cached cost section would leak into the next scenario, an HTTP server would
  keep listening, and temp repositories would leak.
- Two step files spawn their drivers by hard-coded, cwd-relative paths under
  `features/per-issue/support/`: `DRIVER_PATH` in `feature-936-costRecords.steps.ts:23` and
  `COMMIT_DRIVER_PATH` in `feature-936-costApi.steps.ts:19`.
- The drivers cannot move into `features/regression/support/`. `cucumber.js` imports that directory, so
  their top-level `await readStdin()` would run inside the Cucumber process at load time.
- None of the scenario's 38 Cucumber expressions is in the vocabulary registry yet.

## Solution Statement
A pure relocation that follows the established manual-promotion shape (#729 → `upgrade/`, #537 →
`hashing/`, #910/#911 → `pause-queue/`). Production code (`adws/**`, `workers/**`) is not touched.

1. `git mv` the feature to `features/regression/cost/feature-936.feature`. The new `cost/` subdirectory
   is named for the feature's dominant subject: 12 of its 17 scenario blocks are about cost records and
   the cost API, and the deploy rows exist to ship the cost-api Worker's configuration.
2. Replace the feature-level tag line with exactly `@regression @cost-records`. Delete the 17
   scenario-level `@adw-936 @adw-i9m7zh-bug-cost-records-hol` lines. Leave every other byte of the file
   unchanged.
3. `git mv` the nine `feature-936-*` modules into `features/regression/step_definitions/`. Both
   directories are three levels deep, so every import specifier (`../../../adws/…`, `./feature-936-*.ts`)
   resolves unchanged. **Do not edit any import.**
4. `git mv` the two drivers into `features/regression/drivers/`, next to `workflowInitDriver.ts`. That
   directory is outside every `cucumber.js` import glob and is also three levels deep, so the drivers'
   `../../../adws/…` imports resolve unchanged.
5. Re-key the three hooks from `@adw-936` to `@cost-records`. Repoint the two driver path constants:
   they are runtime spawn paths, not import specifiers. Update the comments that name the old
   locations.
6. Add one vocabulary section, `## Given/When/Then — Cost Records, the Cost API and Worker Deploy
   Detection (@cost-records)`, with 38 rubric-compliant rows (G-CR1–G-CR12, W-CR1–W-CR6, T-CR1–T-CR20).
   Note the four phrases the registry already holds (G18, T22, W16, T34).
7. Update the README's `features/` tree.

No step definition is added, copied or deleted: cucumber still loads exactly the same definitions, so
no undefined or ambiguous step can appear.

## Relevant Files
Use these files to implement the feature:

- `README.md`: the `features/` tree (≈ lines 1171–1188). It needs a new `cost/` line, an updated
  `drivers/` line, and the feature-936 driver examples dropped from the `per-issue/support/` line. The
  worktree already carries an unrelated, correct README hunk that refreshes the `adws/core/__tests__`
  listing. Keep it; do not revert it.
- `features/per-issue/feature-936.feature`: the scenario to move. Its feature-level tags are
  `@adw-936 @adw-i9m7zh-bug-cost-records-hol @promotion-suggested-2026-10-04`, and it has 17
  scenario-level tag lines.
- `features/per-issue/step_definitions/feature-936-costRecords.steps.ts`: the cost-record Givens, Whens
  and Thens. It holds the `Before({ tags: '@adw-936' })` state reset and `DRIVER_PATH` (line 23), and
  exports `builtRecords` for the cost-API steps.
- `features/per-issue/step_definitions/feature-936-costApi.steps.ts`: the cost-API steps. It holds the
  `After({ tags: '@adw-936' })` recorder shutdown and `COMMIT_DRIVER_PATH` (line 19).
- `features/per-issue/step_definitions/feature-936-deploy.steps.ts`: the deploy-detection steps, with
  the `After({ tags: '@adw-936' })` temp-directory cleanup.
- `features/per-issue/step_definitions/feature-936-costRun.ts`: the fake Claude CLI child that drives
  the real `handleAgentProcess`, and `buildPhaseCostRecords`.
- `features/per-issue/step_definitions/feature-936-costApiWorker.ts`: the cost-api Worker's real
  handlers over an in-memory `node:sqlite` database with the Worker's real migrations.
- `features/per-issue/step_definitions/feature-936-usd.ts`: `assertUsd`, which compares costs at four
  decimals.
- `features/per-issue/step_definitions/feature-936-throwawayRepo.ts`: throwaway git repositories.
  `GIT_ENV` is a module-load-time snapshot of `process.env`, PATH included. That is why the
  `@regression` git-mock never intercepts its `clone`/`fetch` (see Edge Cases), so it must not be
  refactored.
- `features/per-issue/step_definitions/feature-936-pathsFilter.ts`: the port of `dorny/paths-filter`'s
  push-event path.
- `features/per-issue/step_definitions/feature-936-workflowConfig.ts`: the block-YAML reader for the
  deploy workflow.
- `features/per-issue/support/feature-936-cost-section-driver.ts`: child process that prints
  `formatCostCommentSection` output, because `SHOW_COST_IN_COMMENTS` is bound at import.
- `features/per-issue/support/feature-936-commit-driver.ts`: child process that commits records through
  `CostTracker.commit`, because `COST_API_URL` is bound at import.
- `features/regression/vocabulary.md`: the phrase registry, which gets a new section (appended at the
  end, after a `---` separator, below "Smoke processes"). Format: 5-column rows
  `| # | Phrase | Semantics | Pattern | Assertion target |`, with Pattern one of `subprocess` /
  `phase-import` / `mock-query`. G18 (line 74), W16 (line 92), T22 (line 122) and T34 (line 134) are
  already registered.
- `cucumber.js`: `paths` covers `features/regression/**/*.feature` and
  `features/per-issue/**/*.feature`. `import` covers `features/regression/step_definitions/**`,
  `features/regression/support/**` and `features/per-issue/step_definitions/**`, but not `drivers/` or
  `per-issue/support/`. Moving the files keeps the set of loaded definitions identical.
- `features/regression/support/hooks.ts`: the `@regression` `Before`/`After` hooks, which handle mock
  infrastructure setup and teardown, World reset and runCleanup. It also holds the untagged
  guardrails-gate stub and the global `setDefaultTimeout(60_000)`. The moved scenarios will now run
  these hooks.
- `test/mocks/test-harness.ts` and `test/mocks/git-remote-mock.ts`: `setupMockInfrastructure()`
  prepends a `git` wrapper to `process.env.PATH`, and that wrapper turns `push`/`fetch`/`clone`/`pull`/
  `ls-remote` into no-ops. Reference only.
- `features/regression/step_definitions/givenSteps.ts` (G18, line 277),
  `features/regression/step_definitions/whenSteps.ts` (W16, line 40) and
  `features/regression/step_definitions/thenSteps.ts` (T22, line 371; T34, line 386): the four reused
  backstop steps are already defined here once. Do not duplicate them.
- `features/regression/drivers/workflowInitDriver.ts`: the precedent for a child-process driver living
  outside cucumber's import globs, including its header comment.
- `features/regression/pause-queue/feature-910.feature` and
  `features/regression/hashing/feature-537.feature`: the precedent for a regression header (exactly
  `@regression @<descriptive-tag>`) and for scenarios carrying no `@adw-` tag line.
- `adws/core/promotionIssueBody.ts`, `adws/triggers/promotionSweepDefaults.ts:146` and
  `adws/triggers/perIssueScenarioSweep.ts:96`: these explain why the issue lists no step-def siblings
  (the `startsWith('feature-N.')` rule). Reference only; not changed here.
- `adws/core/promotionTagState.ts`: the marker state machine is `none → suggested → declined`, with no
  "approved" state. Only the per-issue and promotion sweeps over `features/per-issue/` read it, so the
  marker is dropped on promotion.
- `.github/workflows/deploy-workers.yml`: the workflow the deploy scenarios copy into their throwaway
  repository and execute (push trigger plus `dorny/paths-filter` inputs and filters). It must stay in
  the checkout. Not edited.
- `workers/cost-api/src/ingest.ts`, `workers/cost-api/src/queries.ts` and
  `workers/cost-api/src/migrations/`: loaded at runtime by `feature-936-costApiWorker.ts`. Not edited.
- `adws/cost/computation.ts` (`checkDivergence`, 5% threshold, never divergent without a reported
  cost) and `adws/cost/types.ts` (`reportedCostUsd`, `estimatedTokens`, `actualTokens`): the
  system-under-test semantics the vocabulary rows describe. Not edited.
- `.adw/scenarios.md` and `.adw/commands.md`: the cucumber run-by-tag and regression commands, and the
  lint/type-check/build/unit commands used in validation.

### Relevant Documentation (matched via `.adw/conditional_docs.md`)
- `app_docs/feature-9gjajh-bdd-regression-suite.md`. Condition: *"When manually promoting a
  `features/per-issue/` scenario into `features/regression/` (direct relocation: `git mv` feature +
  step-def, add `@regression` tag, register vocabulary phrases)"*. Gotchas lines 51, 100–101 and
  106–107 define:
  - the dependency-closure rule;
  - "contents untouched, moved together";
  - re-keying hooks to a descriptive tag;
  - the git-mock being transparent only to local git subcommands.
- `app_docs/feature-9gjajh-cost-tracking.md`. Condition: *"When working on `reportedCostUsd`,
  `estimatedTokens`/`actualTokens` on phase cost records, the cost divergence check…"*. This is the
  semantics source for the G-CR/W-CR/T-CR cost-record rows.
- `app_docs/feature-9gjajh-cost-api-worker.md`. Condition: *"When working on the Cloudflare Worker that
  exposes cost data via API, its routes, D1 queries…"*. This is the semantics source for the cost-API
  rows (G-CR9, W-CR3, T-CR15, T-CR16).

### New Files
No file is authored from scratch. Every new path is produced by `git mv`, so each one shows as a
rename:
- `features/regression/cost/feature-936.feature` (new `cost/` subdirectory)
- `features/regression/step_definitions/feature-936-costRecords.steps.ts`
- `features/regression/step_definitions/feature-936-costApi.steps.ts`
- `features/regression/step_definitions/feature-936-deploy.steps.ts`
- `features/regression/step_definitions/feature-936-costRun.ts`
- `features/regression/step_definitions/feature-936-costApiWorker.ts`
- `features/regression/step_definitions/feature-936-usd.ts`
- `features/regression/step_definitions/feature-936-throwawayRepo.ts`
- `features/regression/step_definitions/feature-936-pathsFilter.ts`
- `features/regression/step_definitions/feature-936-workflowConfig.ts`
- `features/regression/drivers/feature-936-cost-section-driver.ts`
- `features/regression/drivers/feature-936-commit-driver.ts`

## Implementation Plan
### Phase 1: Foundation
Record the pre-change baselines: dry-run totals, and the `@adw-936` run proving the 18 cases green
*before* anything moves. A failure there is pre-existing and must be reported, not "fixed" by editing
the scenarios. Then relocate all twelve files with `git mv` and rewrite the feature's tag header. At
this point the suite must already be load-neutral: same totals, 0 undefined, 0 ambiguous.

### Phase 2: Core Implementation
Re-key the three hooks to `@cost-records`. Repoint the two driver spawn paths and the comments that
name old locations. Register the 38 expressions in a new, rubric-compliant vocabulary section.

### Phase 3: Integration
Update the README tree. Prove the 18 promoted cases green under
`--tags "@regression and @cost-records"`, which runs them with the `@regression` mock-infrastructure
hooks active. Then prove the full `@regression` suite green, confirm the old paths are gone and no
`@adw-936` reference remains, and run every static check and the unit suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Record the pre-change baselines
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary` and note the scenario
  and step totals. Expect 0 undefined and 0 ambiguous.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-936" --format summary`. Expect
  `18 scenarios (18 passed)` and `101 steps (101 passed)`. If anything fails here, stop and report it
  as pre-existing. Do not edit the scenarios: the Gherkin freeze will later reject `.feature` edits in
  the fix loop.
- Never run two cucumber processes from this checkout at once. The pause-queue rows share
  `agents/paused_queue.json` and spawn-lock files under the cwd.

### 2. Relocate the feature file into a new `cost/` subdirectory
- `mkdir -p features/regression/cost`
- `git mv features/per-issue/feature-936.feature features/regression/cost/feature-936.feature`

### 3. Rewrite the feature's tags
- Replace line 1
  (`@adw-936 @adw-i9m7zh-bug-cost-records-hol @promotion-suggested-2026-10-04`) with exactly:
  `@regression @cost-records`
- Delete each of the 17 scenario-level lines `  @adw-936 @adw-i9m7zh-bug-cost-records-hol` entirely.
  Precedent: promoted features carry no scenario tag line. Scenario names, steps, data tables, the
  `Examples:` table and the description are untouched.
- Drop `@promotion-suggested-2026-10-04` because the marker only means something under
  `features/per-issue/`: no sweep reads `features/regression/`, and every regression feature carries
  just `@regression @<descriptive>`.
- Check: `grep -c '^[[:space:]]*@' features/regression/cost/feature-936.feature` prints `1`.

### 4. Relocate the step-definition dependency closure, contents untouched
Run each `git mv` and **do not edit any import specifier**:
- `git mv features/per-issue/step_definitions/feature-936-costRecords.steps.ts features/regression/step_definitions/feature-936-costRecords.steps.ts`
- `git mv features/per-issue/step_definitions/feature-936-costApi.steps.ts features/regression/step_definitions/feature-936-costApi.steps.ts`
- `git mv features/per-issue/step_definitions/feature-936-deploy.steps.ts features/regression/step_definitions/feature-936-deploy.steps.ts`
- `git mv features/per-issue/step_definitions/feature-936-costRun.ts features/regression/step_definitions/feature-936-costRun.ts`
- `git mv features/per-issue/step_definitions/feature-936-costApiWorker.ts features/regression/step_definitions/feature-936-costApiWorker.ts`
- `git mv features/per-issue/step_definitions/feature-936-usd.ts features/regression/step_definitions/feature-936-usd.ts`
- `git mv features/per-issue/step_definitions/feature-936-throwawayRepo.ts features/regression/step_definitions/feature-936-throwawayRepo.ts`
- `git mv features/per-issue/step_definitions/feature-936-pathsFilter.ts features/regression/step_definitions/feature-936-pathsFilter.ts`
- `git mv features/per-issue/step_definitions/feature-936-workflowConfig.ts features/regression/step_definitions/feature-936-workflowConfig.ts`

No per-issue file imports any of these modules, so there are no importers to repoint. Planning grepped
for `feature-936` across `features/`; the only other hit is prose in `feature-939.feature`.

### 5. Relocate the two drivers into `features/regression/drivers/`
- `git mv features/per-issue/support/feature-936-cost-section-driver.ts features/regression/drivers/feature-936-cost-section-driver.ts`
- `git mv features/per-issue/support/feature-936-commit-driver.ts features/regression/drivers/feature-936-commit-driver.ts`
- Do **not** put them in `features/regression/support/` or `step_definitions/`. `cucumber.js` imports
  both, and the drivers' top-level `await readStdin()` would then run inside the Cucumber process.
- Their `../../../adws/…` imports resolve unchanged, because `drivers/` is also three levels deep.

### 6. Re-key the three hooks to `@cost-records`
- In `features/regression/step_definitions/feature-936-costRecords.steps.ts`, change
  `Before({ tags: '@adw-936' }, function () {` to `Before({ tags: '@cost-records' }, function () {`.
- In `features/regression/step_definitions/feature-936-costApi.steps.ts`, change
  `After({ tags: '@adw-936' }, async function () {` to
  `After({ tags: '@cost-records' }, async function () {`.
- In `features/regression/step_definitions/feature-936-deploy.steps.ts`, change
  `After({ tags: '@adw-936' }, function () {` to `After({ tags: '@cost-records' }, function () {`.
- Key them on `@cost-records` alone. No per-issue feature carries `@adw-936` any more, so no `or @adw-936`
  alternative is needed. That differs from the pause-queue hooks, whose per-issue rows still exist.

### 7. Repoint the driver spawn paths and the comments that name old locations
These are runtime paths and prose, not import specifiers.
- `feature-936-costRecords.steps.ts`:
  - Change `const DRIVER_PATH = 'features/per-issue/support/feature-936-cost-section-driver.ts';` to
    `'features/regression/drivers/feature-936-cost-section-driver.ts'`.
  - In the header comment, change `features/per-issue/support/feature-936-cost-section-driver.ts` to
    `features/regression/drivers/feature-936-cost-section-driver.ts`.
- `feature-936-costApi.steps.ts`:
  - Change `const COMMIT_DRIVER_PATH = 'features/per-issue/support/feature-936-commit-driver.ts';` to
    `'features/regression/drivers/feature-936-commit-driver.ts'`.
  - In the header comment, change `features/per-issue/support/feature-936-commit-driver.ts` to
    `features/regression/drivers/feature-936-commit-driver.ts`.
- `features/regression/drivers/feature-936-cost-section-driver.ts` and
  `features/regression/drivers/feature-936-commit-driver.ts`: in each header comment, replace
  "It lives under `features/per-issue/support/`" with "It lives under `features/regression/drivers/`".
  The rest of the sentence stays: "outside every `cucumber.js` `import` glob, so it is never
  auto-loaded as a step definition module".
- Leave every other line of these files byte-identical, including the "…scenarios of feature-936"
  wording and the fixture values (`adw-936`, issue `936`, `s-936`).

### 8. Prove the relocation is load-neutral
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: expect the same scenario
  and step totals as the Task 1 baseline, with 0 undefined and 0 ambiguous.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-936" --format summary`: expect
  `0 scenarios`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@regression and @cost-records" --format summary`:
  expect `18 scenarios (18 skipped)` and `101 steps (101 skipped)`.

### 9. Register the phrases in the vocabulary registry
Append to the end of `features/regression/vocabulary.md` a `---` separator, then the section below.
The issue's 64 concrete phrases collapse onto these 38 Cucumber expressions plus 4 already-registered
phrases. Examples of the collapse:
- `a first …` / `a second …` → G-CR3
- `… agent run` / `… agent runs` → W-CR1
- `a pull request …` / `a later pull request …` → G-CR12
- the outline's `<changed file>`, `<deployed>` and `<not deployed>` → G-CR11, T-CR18 and T-CR19
- every concrete `$`/`{float}` value → its expression

Register the step definitions' expressions verbatim, including `(s)`, `( later)`, `first/second` and
`${float}`. That follows the registry's existing practice (`probe cycle(s)`, `{word}`).

**Never put a `|` inside a cell.** `vocabularyParser.ts` splits rows on every `|`, and backticks or
`\|` do not protect it, so a malformed row is silently dropped.

Section to append, reproduced faithfully:

```markdown
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
```

- Check: `grep -cE "^\| (G|W|T)-CR[0-9]+ \|" features/regression/vocabulary.md` prints `38`.
- Check: `grep -nE "^\| (G-CR|W-CR|T-CR)[0-9]+ \|" features/regression/vocabulary.md | awk -F'|' 'NF != 7'`
  prints nothing, so every new row has exactly 5 cells.

### 10. Update the README `features/` tree
In `README.md`, in the `features/` tree, keep the pre-existing unrelated hunk:
- Change the `per-issue/support/` line to
  `│   └── support/        # Per-issue Cucumber support drivers (e.g. feature-846-ensure-driver.ts)`.
- Insert directly above the `drivers/` line (alphabetical order):
  `│   ├── cost/           # Regression scenarios covering cost records (the CLI's reported cost, token estimates, the cost API) and the Worker deploy workflow's change detection (#936)`
- Change the `drivers/` line to
  `│   ├── drivers/        # Scripts run as child processes, outside the support and step-definition directories, which Cucumber imports: the workflow-init driver the subprocess harness runs, and the cost-section and cost-commit drivers of the cost scenarios`

### 11. Prove the promoted scenarios and the whole suite green
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @cost-records" --format summary`:
  expect `18 scenarios (18 passed)` and `101 steps (101 passed)`, exit 0. This runs them under the
  `@regression` hooks (mock infrastructure, git-mock on `PATH`), which they never ran under before.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`: the full
  regression gate. Expect exit 0, with 0 failed, 0 undefined, 0 ambiguous and 0 pending (the suite has
  no pending steps), and with the 18 `@cost-records` cases included.
- If a deploy row fails because a `clone`/`fetch` became a no-op, the git-mock is intercepting it.
  Confirm that `GIT_ENV` in `feature-936-throwawayRepo.ts` is still the import-time snapshot and that
  nothing reorders it to read `process.env` at call time. Do not change the scenarios.

### 12. Confirm the old paths are gone and nothing dangles
- `find features/per-issue -name 'feature-936*'` prints nothing.
- `find features/regression -name 'feature-936*' | sort` prints exactly the 12 paths in "New Files".
- `! grep -rn "@adw-936" features/ && echo "NO @adw-936 TAG OR HOOK"`
- `grep -n "tags: '@cost-records'" features/regression/step_definitions/feature-936-*.ts` prints 3
  lines.
- `! grep -rn "per-issue/support/feature-936\|per-issue/step_definitions/feature-936" features/ README.md && echo "NO STALE PATHS"`
- `git diff -M --cached --stat` (or `git status --porcelain` after staging) shows the 12 relocations as
  renames (`R`). The only content diffs should be:
  - the feature's tag lines;
  - the three hook tags;
  - the two path constants and four comment lines;
  - `vocabulary.md`;
  - `README.md`.

### 13. Unit tests
- No new unit tests (see Testing Strategy).
- Run `bun run test:unit` and confirm it is green. Vitest collects only
  `adws/**/__tests__/**/*.test.ts` and `test/mocks/__tests__/**/*.test.ts`, so moving files under
  `features/` cannot affect it.

### 14. Keep the change scoped
- Do not touch `adws/**`, `workers/**`, `.github/**` or `cucumber.js`.
- Do not "fix" the sibling-lister rule in `promotionSweepDefaults.ts` / `perIssueScenarioSweep.ts`
  here; see Notes.
- Do not rename the moved files. Do not edit any import specifier.

### 15. Run the Validation Commands
Run every command in `Validation Commands`, sequentially (never two cucumber processes at once), and
confirm each expectation.

## Testing Strategy
### Unit Tests
`.github/adw.yml` leaves `unitTests` commented out, so unit tests are enabled and this subsection is
included. **No new unit tests are warranted or created.**
- This change relocates BDD test files, re-keys three hook tags, repoints two spawn paths and edits two
  Markdown files. It adds or changes no production logic (`adws/**`, `workers/**`) to unit-test.
  Prior promotions (#910, #911, #961) added none either.
- Per the coding guidelines, BDD scenarios are ADW's behavioural proof. Here that proof is the 18
  promoted cases passing under `--tags "@regression and @cost-records"` and within the full
  `@regression` run (Task 11).
- `bun run test:unit` must stay green as a regression guard (Task 13).

### Edge Cases
- **The git-mock under the `@regression` hooks.** `setupMockInfrastructure()` prepends a `git` wrapper
  to `process.env.PATH` that no-ops `clone`/`fetch`/`push`/`pull`/`ls-remote`. The deploy rows depend
  on real `git clone` and `git fetch --depth/--deepen` in `openCheckout` and the paths-filter port. They
  stay real only because `feature-936-throwawayRepo.ts` passes `env: GIT_ENV` to `spawnSync`. `GIT_ENV`
  spreads `process.env`, PATH included, when the module loads, before any `Before` hook runs, and
  Node resolves the command from `options.env.PATH`. Do not refactor `GIT_ENV` to be computed per
  call. Task 11's `@regression and @cost-records` run is the proof.
- **Mock environment leaking into the drivers.** Both drivers inherit `process.env` at step time:
  `PATH` with the git wrapper, `GH_TOKEN=mock-token`, `GH_HOST`, `CLAUDE_CODE_PATH` set to the stub.
  Neither driver runs git, gh or claude. `CostTracker.commit` derives the project from
  `config.targetRepo.repo`, and the steps set `COST_API_URL`, `COST_API_TOKEN`, `SHOW_COST_IN_COMMENTS`
  and `COST_REPORT_CURRENCIES` explicitly, so the mock values are inert.
- **Drivers inside a cucumber import glob.** In `support/` or `step_definitions/`, a driver's
  top-level `await readStdin()` would block the Cucumber load. They must live in `drivers/`.
- **A missed hook re-key.** Without the `Before` reset, runs from earlier scenarios fold into later
  ones, giving wrong reported/computed costs, and the cached `state.section` leaks across scenarios.
  Without the `After` hooks, the recording server keeps the process alive and temp repositories leak.
  The Task 12 grep (3 `@cost-records` hooks, no `@adw-936`) guards this.
- **Ambiguity and undefined steps.** Files are moved, not copied. ESM caching evaluates
  `feature-936-costRecords.steps.ts` once even though `feature-936-costApi.steps.ts` imports it. G18,
  T22, W16 and T34 keep their single regression definitions. The Task 8 dry-run must show
  0 undefined / 0 ambiguous and unchanged totals.
- **Hook order.** The moved modules now load in the regression glob, before `support/hooks.ts`
  (previously after it). Their hooks touch only their own module state and temp resources, disjoint
  from the `@regression` hooks' mock infrastructure and World, so order does not matter.
- **The Gherkin freeze.** `.feature` edits are rejected in the scenario-fix loop, and promotion issues
  skip scenario authoring, so the `@regression` run is the only proof. Get the tag rewrite right in the
  build: exactly one tag line, nothing else changed.
- **Vocabulary table integrity.** The registry parser splits on every `|` and silently drops a row with
  fewer than 5 cells, which is why T-CR12 describes the expected row instead of quoting it. The
  promotion scorer's wildcarding covers only `{string}`/`{int}`, so `${float}`, `(s)`, `( later)` and
  `first/second` are recorded verbatim. This matches existing practice and has no runtime effect.
- **`node:sqlite`.** Only the "cost API totals a project's costs" row needs it, and it requires
  Node ≥ 22.13 (unflagged). The host running ADW's test phase has Node 26. See Notes for the CI/Docker
  runtime risk.
- **Concurrency.** The regression suite shares `agents/paused_queue.json` and spawn-lock files under
  the cwd. Never run two cucumber processes from one checkout at once.
- **Run time.** The promotion adds a `bunx tsc` type-check row and seven driver child processes to the
  suite. That is well inside the daily job's 30-minute timeout, and the existing T22 rows already pay
  the same type-check cost.
- **The promotion marker arriving from `dev`.** If `dev` gains another commit on
  `features/per-issue/feature-936.feature` before this PR merges, git's rename detection may carry it
  into the moved file. Resolve it so the header stays exactly `@regression @cost-records`.

## Acceptance Criteria
- `features/regression/cost/feature-936.feature` exists. Its first line is exactly
  `@regression @cost-records` and it is the file's only tag line. Its title, description, scenarios,
  steps, data tables and examples are byte-identical to the per-issue original.
- `features/per-issue/feature-936.feature`, every `features/per-issue/step_definitions/feature-936-*`
  and every `features/per-issue/support/feature-936-*` no longer exist.
- The nine `feature-936-*` modules are in `features/regression/step_definitions/` and the two drivers
  in `features/regression/drivers/`. Every import specifier is unchanged, and each file shows as a git
  rename.
- No `@adw-936` (or `@adw-i9m7zh-…`) tag or hook expression remains under `features/`. The three
  hooks are keyed on `@cost-records`. Both driver spawn paths point into
  `features/regression/drivers/`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @cost-records"` reports
  `18 scenarios (18 passed)` and `101 steps (101 passed)`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` exits 0, with 0 failed,
  undefined, ambiguous or pending steps, and includes the 18 cases.
- A whole-suite `--dry-run` reports 0 undefined and 0 ambiguous, with totals equal to the pre-change
  baseline. `--tags "@adw-936"` selects 0 scenarios.
- `features/regression/vocabulary.md` has a new `(@cost-records)` section with 38 five-cell rows,
  G-CR1–G-CR12, W-CR1–W-CR6 and T-CR1–T-CR20, each with Pattern `subprocess`, `phase-import` or
  `mock-query`. Every description asserts a runtime artefact and never a source-file property. A
  closing note names G18, T22, W16 and T34 as reused. Every step of the moved feature matches one
  registered expression.
- The README's `features/` tree lists `regression/cost/`, describes the cost drivers under `drivers/`,
  and no longer lists them under `per-issue/support/`.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build`,
  `bun run test:unit`, `bun run lint:git-guard` and `bun run lint:docs-index` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `find features/per-issue -name 'feature-936*'`: the old per-issue paths are gone. Expect no output.
- `find features/regression -name 'feature-936*' | sort`: expect exactly 12 paths:
  `features/regression/cost/feature-936.feature`, the two `features/regression/drivers/feature-936-*`
  drivers, and the nine `features/regression/step_definitions/feature-936-*` modules.
- `head -1 features/regression/cost/feature-936.feature`: expect exactly `@regression @cost-records`.
- `grep -c '^[[:space:]]*@' features/regression/cost/feature-936.feature`: expect `1`.
- `! grep -rn "@adw-936" features/ && echo "NO @adw-936 TAG OR HOOK"`: expect the echo line.
- `grep -n "tags: '@cost-records'" features/regression/step_definitions/feature-936-*.ts`: expect 3
  lines, one each in `costRecords`, `costApi` and `deploy`.
- `! grep -rn "per-issue/support/feature-936\|per-issue/step_definitions/feature-936" features/ README.md && echo "NO STALE PATHS"`:
  expect the echo line.
- `grep -cE "^\| (G|W|T)-CR[0-9]+ \|" features/regression/vocabulary.md`: expect `38`.
- `grep -nE "^\| (G-CR|W-CR|T-CR)[0-9]+ \|" features/regression/vocabulary.md | awk -F'|' 'NF != 7'`:
  expect no output (every new row has 5 cells).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: expect 0 undefined and 0
  ambiguous, with totals identical to the Task 1 baseline.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-936" --format summary`: expect
  `0 scenarios`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @cost-records" --format summary`:
  expect `18 scenarios (18 passed)` and `101 steps (101 passed)`, exit 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`: the full
  regression gate. Expect exit 0, with 0 failed, 0 undefined, 0 ambiguous and 0 pending.
- `bun run lint`: ESLint passes over the moved and edited files.
- `bunx tsc --noEmit`: the root type-check passes. It includes `features/**`, so it re-checks every
  moved module and driver at its new path.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run build`: the build succeeds.
- `bun run test:unit`: the unit suite is green, zero regressions.
- `bun run lint:git-guard`: the git/gh guard is green. `features/` is exempt, and W16/T34 drive the same
  check.
- `bun run lint:docs-index`: the living-docs index stays clean. A dead `Owns:` glob would only warn,
  and none references the moved paths.
- `git status --porcelain`: only the 12 renames, `features/regression/vocabulary.md` and `README.md`
  are changed (plus the plan spec). No other paths.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) are respected: no production code changes; moved
  files keep their contents, apart from the hook tags, two path constants and the comments that name
  old paths; comments state only what the code cannot. README tree entries cite issue numbers, as the
  README's own convention does; code comments do not.
- **No new library.** If one were ever needed, the install command is `bun add <package>`
  (`.adw/commands.md`).
- **Naming choices.**
  - Subdirectory `cost/`: short, and named for the feature's dominant subject, as `hashing/` and
    `upgrade/` are.
  - Descriptive tag `@cost-records`: unused anywhere today, and taken from the feature title.
  - Vocabulary prefix `CR`: unused today.
- **Follow-up, out of scope for this `hitl` relocation PR.** `listStepDefSiblings` in
  `adws/triggers/promotionSweepDefaults.ts:146` and `defaultListStepDefSiblings` in
  `adws/triggers/perIssueScenarioSweep.ts:96` match `feature-N.` only. They miss the hyphenated
  `feature-N-*.ts` naming that recent features use (936, 937, 939, 959…). Effects:
  - Promotion issues say "(no step-def siblings found)" when siblings exist.
  - The TTL sweep never deletes those files.

  Suggest a separate issue to match `feature-N.` and `feature-N-`, and to include
  `features/per-issue/support/feature-N-*` drivers. Feature-937 and feature-959, also
  promotion-suggested, will hit the same gap.
- **Runtime risk outside this host: `node:sqlite`.** feature-936 is the first regression feature to
  load `node:sqlite` (`feature-936-costApiWorker.ts`). That needs Node ≥ 22.13 without a flag.
  - ADW's test phase runs on a host with Node 26, which is fine.
  - The daily `regression.yml` host job uses the `ubuntu-latest` system Node, with no
    `actions/setup-node`.
  - The Docker leg (`oven/bun`, no Node) runs cucumber under Bun.

  If the cost-API totals row goes red in either leg, the follow-up is to pin Node ≥ 22.13 in the host
  job, or to provide Node or sqlite support in `test/Dockerfile`. This is deliberately not changed
  here.
- **Documentation phase.** The document phase should update `app_docs/feature-9gjajh-bdd-regression-suite.md`:
  - add a `features/regression/cost/` responsibility bullet;
  - list the relocated `feature-936-*` modules and `drivers/feature-936-*` drivers;
  - add `@cost-records` to the descriptive-tag list in its Gotchas;
  - note the `GIT_ENV` import-time-PATH reason the deploy rows survive the git-mock.

  It should also update the matching condition in `.adw/conditional_docs.md`. The build does not need
  to.
- **The pre-existing `README.md` modification** in the worktree is an unrelated, correct refresh of
  the `adws/core/__tests__` listing; those test files exist. Leave it in place.
- **`hitl` is set**: the resulting PR must be human-approved before merge. The non-blocking rot/reuse
  advisory comment (`promotionRotAdvisory.ts`) will run on it.
