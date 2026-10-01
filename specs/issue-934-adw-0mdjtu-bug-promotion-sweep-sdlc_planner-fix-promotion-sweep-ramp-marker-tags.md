# Bug: Promotion sweep — the threshold never ramps, the marker never reaches the default branch, the issue body is polluted, and promoted features keep their `@adw-` tags

## Metadata
issueNumber: `934`
adwId: `0mdjtu-bug-promotion-sweep`
issueJson: `{"number":934,"title":"bug: promotion sweep: working threshold ramp, marker through a pull request, clean issue body, tags stripped","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision records\n\nADR-0049 (items 1 and 2, and the defect noted under More Information), ADR-0037 (item 5).\n\n## What to build\n\n- **Threshold ramp (ADR-0049, item 1).** The ramp counts commits whose subject starts with `regression-promotion:`. Nothing has written such a commit since the automatic mover was deleted, so the threshold never leaves 3. Count promotions from something that still exists, for example closed promotion issues whose pull request merged.\n- **Marker delivery (ADR-0049, item 2).** The `@promotion-suggested` tag is committed and pushed straight to the default branch, which the repository ruleset forbids. Deliver it through a dedicated branch and an immediately merged pull request, as the per-issue deletion sweep does. The tag stays: it exempts a candidate from the 14-day deletion sweep and records a declined promotion.\n- **Issue body.** The body of #923 has an HTML comment from the configuration file spliced into its `git mv` command. The regression directory value is read with its trailing comment attached. Strip it. The body also still says per-issue scenarios are \"input-only, never executed\"; that wording is wrong (ADR-0037, item 1).\n- **Tags on promoted scenarios (ADR-0037, item 5).** A promoted scenario drops its `@adw-` tags. Say so in the promotion issue's instructions, and fix the two regression features that still carry them (`feature-537`, `feature-729`).\n\n## Acceptance criteria\n\n- [ ] With promotions in the last 90 days, the computed threshold rises above 3; a unit test shows it.\n- [ ] A sweep that suggests a promotion lands the tag on the default branch through a pull request, and files the issue.\n- [ ] A generated issue body contains no HTML comment and no \"never executed\" wording.\n- [ ] No file under `features/regression/` carries an `@adw-` tag.\n- [ ] The Divergence section of ADR-0049 and item 5 of ADR-0037 are removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:20:05Z","comments":[],"actionableComment":null}`

## Bug Description
The promotion sweep (`adws/triggers/promotionSweep.ts`, ADR-0049) scores every `features/per-issue/feature-N.feature`. For a qualifying candidate it stamps `@promotion-suggested-<date>` on the file and files one issue labelled `adw:feature`, `regression-promotion` and `hitl`. ADR-0049's `## Divergence` section, the defect under its `## More Information`, and ADR-0037 Divergence item 5 record four defects. Planning found a second cause behind the first and a wider scope behind the fourth.

1. **The threshold never leaves 3.** `computeThreshold` (`adws/promotion/promotionThreshold.ts`) ramps N from 3 to 7 with the share of per-issue scenarios promoted in the last 90 days. It returns the bootstrap 3 whenever the denominator is 0. Both inputs are always 0:
   - The numerator counts commits whose subject starts with `regression-promotion:`. Only the deleted `promotionMover` wrote that prefix. No code writes it now, and `git log --all --grep='^regression-promotion:'` finds nothing.
   - The denominator (found during planning) passes the pathspec `features/per-issue/**/*.feature`. `@paysdoc/devplatform`'s `logSince` puts it unquoted into `git log --since=… --no-merges -p -- <pathspec>` and runs that through `/bin/sh`. The shell finds no `features/per-issue/*/*.feature` and passes the pattern on literally. Git's pathspec then requires a `/` after `features/per-issue/`, so it matches no top-level per-issue file.

   On 2026-10-02, three promotions had merged in the last 90 days: #760 (PR #761, 2026-07-13), and #923 (PR #926) and #924 (PR #925), both on 2026-09-30. The same 90 days added 656 per-issue `Scenario:` lines. The loader still reports `{ promotedCount90d: 0, totalPerIssueCount90d: 0 }`.
   *Expected:* promotions are counted from closed promotion issues whose pull request merged. The denominator counts the scenarios actually added. With promotions in the window, the threshold rises above 3.

2. **The marker never reaches the default branch.** `tagAndCommit` (`adws/triggers/promotionSweepDefaults.ts`) writes into the cron host's own checkout (`ctx.basePath`), commits there, and pushes the default branch directly. The repository ruleset forbids that push because the branch requires a pull request (ADR-0019).

   When the checkout is on another branch, `tagAndCommit` logs a warning and returns normally, and `attemptOriginate` files the issue anyway. The self-host triggers run from the runner clone, which has `main` checked out while the default branch is `dev` (ADR-0019). That is how the sweep filed #923 and #924 on 2026-09-30 with no marker anywhere: `git log origin/dev` has no `chore: mark feature-N promotion-suggested` commit.

   Without the marker, a candidate whose issue is still open is not exempt from the 14-day deletion sweep, and a declined promotion is never recorded on the file. On a checkout that is on the default branch, the sweep would instead leave a local commit on the shared checkout and fail the push on every run. The sweep also lists and reads candidates from that same checkout, which can be stale: the runner clone holds `main`.
   *Expected:* every marker change (suggest, decline, withdraw) reaches the default branch through a dedicated branch and an immediately merged pull request, as the per-issue deletion sweep does. The issue is filed only once the marker has landed, and the cron host's checkout is never touched.

3. **The issue body carries an HTML comment and wrong wording.** `parseScenariosMd` (`adws/core/projectConfig.ts`) keeps HTML comments inside section values. With this repo's `.adw/scenarios.md`, the regression directory parses as `"<!-- Consumed by scenario_writer. When set, the @regression sweep step is skipped. -->\nfeatures/regression/"`. #923's two `git mv` commands and its vocabulary path both carry that comment.

   The same pollution reaches the vocabulary path the sweep reads, so production scoring has used an empty registry: `loadVocabulary` returns `''` for a path that does not exist. Every score has therefore been the scenario's phase count alone.

   The body also calls per-issue scenarios "input-only, never executed", which ADR-0037 item 1 rules wrong. It also tells the agent to "keep its existing tags for traceability".
   *Expected:* the body contains no HTML comment, no "input-only" and no "never executed", and it tells the agent to remove the `@adw-` tags.

4. **Regression features carry `@adw-` tags.** ADR-0037 rules that a promotion strips the `@adw-` tags. The issue names `features/regression/hashing/feature-537.feature` and `features/regression/upgrade/feature-729.feature`. `features/regression/pause-queue/feature-910.feature` and `feature-911.feature` also carry them: #923 and #924 promoted those two on 2026-09-30 by following the "keep its existing tags" instruction. That makes 48 tag lines in 4 files, covering 79 regression scenarios.

   The regression step definitions scope their `Before`/`After` hooks to exactly those tags, so deleting the tags alone would silently switch the hooks off.
   *Expected:* no regression scenario carries an `@adw-` tag, and every one still carries `@regression`. Each hook still runs for exactly the scenarios it runs for today.

## Problem Statement
- `loadPromotionStats` must count promotions from forge data that still exists: closed `regression-promotion` issues whose linked pull request merged in the last 90 days. Its denominator query must match per-issue `.feature` files despite the unquoted shell interpolation.
- The promotion sweep must list, read, write, commit and push only in a dedicated worktree synced to fresh `origin/<default>`. It must land marker changes through a dedicated branch and an immediately merged pull request, and file an originated candidate's issue only after that pull request merged. It must never push the default branch and never touch the cron host's checkout.
- Scenario configuration values must be free of HTML comments wherever the comment sits.
- The promotion issue body must describe per-issue scenarios correctly and instruct removal of `@adw-` tags.
- The four regression features must lose every `@adw-` tag, while their hooks keep running for the same scenarios.
- ADR-0049's `## Divergence` section and ADR-0037 Divergence item 5 must be removed in the same pull request.

## Solution Statement
- **Numerator.** `loadPromotionStats` takes a new dep, `listPromotionMergeDates: () => readonly Date[]`, in place of the commit-subject grep. It counts the dates on or after `now − 90 days`. The production default pairs each **closed** `regression-promotion` issue with the newest merged pull request whose body links it. It reuses the all-state listing the sweep already makes, `codeHost.listMergedPullRequests(200)`, and `bodyLinksIssue`, the matcher the per-issue sweep already uses.
- **Denominator.** The pathspec becomes the plain directory `features/per-issue`. A directory pathspec contains no shell metacharacters, so the unquoted interpolation cannot alter it, and the history of swept files still counts. Only `+Scenario:` lines inside `.feature` sections of the patch are counted. Step-definition fixtures that embed Gherkin, such as `feature-853.steps.ts`, are excluded. The query runs in the sweep worktree, which is the default branch's history. `computeThreshold`, its constants and the 90-day window are unchanged.
- **Marker delivery**, mirroring `runDocsIndexSweep`:
  - The sweep lazily creates one `SweepBase` with `prepareSweepBase(boundary, PROMOTION_SWEEP_SPEC)`, on branch `chore/promotion-sweep`, and tears it down in `finally`. Every default lists, reads, configures and scores from that worktree.
  - The shell runs in three phases: plan, land, settle.
    - **Plan** is pure: each candidate's action plus, for originate, decline and withdraw, a `MarkerWrite`.
    - **Land** commits all marker writes in the worktree, one scoped commit per file, then pushes once, opens one pull request and merges it immediately through `persistCommitViaPr`. That helper now resolves `true` only when the pull request merged.
    - **Settle** files an originated candidate's issue only if the markers landed. Decline and withdraw are reported only if they landed. A redrive files its issue regardless, because its marker is already on the default branch.
  - A landing that fails files nothing and reports nothing; the next sweep retries it. There is no direct-push fallback.
  - `PromotionSweepReport` gains `threshold`, so operators and scenarios can see the threshold the sweep scored against.
- **HTML comments.** `parseScenariosMd` strips `<!-- … -->` from each section value before trimming: above the value, inline, below it, or across several lines. A section that holds only a comment counts as absent.
- **Issue body.** The opening is rewritten: per-issue scenarios run only in their own workflow's test phase, by their `@adw-N` tag. "Keep its existing tags" is replaced by an instruction to remove the `@adw-` tags at feature and scenario level, plus a line telling the agent to re-scope any hook keyed on those tags.
- **Tags.** The four features' `@adw-` tags are mapped onto descriptive tags, following the `@python-e2e` precedent and named after their `vocabulary.md` sections. The hook expressions add the new tags and keep their per-issue `@adw-` alternatives, so every hook selects the same scenario set as before. Dry-run counts prove this.

  | Old tags (feature / scenario level) | New tag |
  |---|---|
  | `@adw-537 @adw-zapagn-hashcomputer-deep-mo` | `@framework-hash` |
  | `@adw-729 @adw-5o6zmy-bug-adwupgrade-regen` | `@upgrade-regen` |
  | `@adw-910 @adw-6a1674-pause-queue-waits-fo` (+ `@adw-912` on four rows, dropped) | `@pause-queue-reset-time` |
  | `@adw-911 @adw-gtxas1-per-repo-ownership-o`, and `@adw-911` on five feature-910 rows | `@pause-queue-ownership` |
- **ADRs.** Delete ADR-0049's `## Divergence` section and ADR-0037 Divergence item 5. Do not renumber item 6, because open issue #935 cites it by number.

## Steps to Reproduce
Run everything from the worktree root.

1. **Comment-polluted config:** `bunx tsx -e "import { loadProjectConfig } from './adws/core/projectConfig.ts'; const s = loadProjectConfig('.').scenarios; console.log(JSON.stringify([s.perIssueScenarioDirectory, s.regressionScenarioDirectory, s.vocabularyRegistry]))"` prints three values, each prefixed by `<!-- Consumed by … -->\n`.
2. **Polluted issue body, end to end:** `bunx tsx -e "import { loadProjectConfig } from './adws/core/projectConfig.ts'; import { buildPromotionIssue } from './adws/core/promotionIssueBody.ts'; const s = loadProjectConfig('.').scenarios; const { body } = buildPromotionIssue({ featureNumber: 612, sourceFeaturePath: 'features/per-issue/feature-612.feature', sourceStepDefPaths: ['features/per-issue/step_definitions/feature-612.steps.ts'], destinationRegressionDir: s.regressionScenarioDirectory ?? 'features/regression/', vocabularyRegistryPath: s.vocabularyRegistry ?? 'features/regression/vocabulary.md', phrases: [] }); console.log(JSON.stringify({ htmlComment: body.includes('<!--'), neverExecuted: body.includes('never executed'), inputOnly: body.includes('input-only'), keepsExistingTags: body.includes('keep its existing tags'), removesAdwTags: /Remove the .@adw-. tags/.test(body) }))"` prints `{"htmlComment":true,"neverExecuted":true,"inputOnly":true,"keepsExistingTags":true,"removesAdwTags":false}`. #923's live body shows the same spliced comment: `gh issue view 923 --json body`.
3. **Dead numerator:** `git log --all --grep='^regression-promotion:' --oneline | wc -l` prints `0`, while `gh issue list --label regression-promotion --state all` lists three closed issues whose PRs (#761, #925, #926) merged within 90 days.
4. **Dead denominator, run the way the library runs it:** `sh -c 'git log --since="2026-07-04" --no-merges -p -- features/per-issue/**/*.feature' | grep -cE '^\+\s*Scenario:'` prints `0`. With `-- features/per-issue` it prints 661, of which 656 lines are in `.feature` files and 5 are in `feature-853.steps.ts` fixtures.
5. **Marker never landed:** `git log origin/dev --oneline --grep='promotion-suggested'` prints nothing, although #923 and #924 were filed by the sweep on 2026-09-30. Reading `tagAndCommit` shows the off-branch `return` that precedes the issue filing, and ADR-0019 records that the runner clone holds `main`.
6. **Tagged regression features:** `grep -rlE '^\s*@.*@adw-' features/regression --include='*.feature' | wc -l` prints `4` (48 tag lines). `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@regression and (@adw-537 or @adw-729 or @adw-910 or @adw-911 or @adw-912)" --format summary` reports `79 scenarios`.

## Root Cause Analysis
- **Ramp numerator.** `promotionStatsLoader.countPromotionCommits` keyed on a commit-subject convention that only the deleted `promotionMover` produced (ADR-0040, superseded by ADR-0049). Under ADR-0049 a promotion is an ordinary `adw:feature` pull request whose commits are prefixed by the pipeline's agents (`build-agent:` …). The signal that survives is the closed `regression-promotion` issue linked by a merged pull request.
- **Ramp denominator.** `logSince` (library, `gitReadOps.js`) builds `… -- ${opts.pathspec}` without quoting and runs it in a shell. A glob pathspec is therefore shell-expanded relative to the cwd: `**` acts as `*` in `sh`, so it finds nothing and git receives the literal pattern, which needs a sub-directory. A quoted glob would work today, but it would break the moment the library starts quoting. A shell-expanded `*.feature` would only list files that exist now and drop swept files' history.
- **Marker delivery.** The PRD specified a direct commit and push on the default branch. When the ruleset made pull requests mandatory, the sibling per-issue sweep moved to `perIssueSweepPersist.ts`, but the promotion sweep did not. Its off-branch guard is a silent no-op that returns normally, so origination continues to file the issue without the marker. And because the sweep reads candidates and configuration from the host checkout, it can act on stale content.
- **HTML comment.** `parseMarkdownSections` returns a section's raw trimmed body, and `parseScenariosMd` stores it verbatim. `.adw/scenarios.md` documents each optional section with a `<!-- … -->` line directly above the value, and its `## Run Regression Scenarios` body ends with a multi-line comment block. Nothing strips the comments.
- **Wording and tags.** `promotionIssueBody.ts` reproduced #734's hand-written body, including the PRD's "input-only, never executed" wording and "keep its existing tags for traceability". The two automated promotions that followed (#923 → feature-910, #924 → feature-911) did exactly what it said. Their step-definition hooks, like those of 537 and 729, are scoped to the per-issue tags (`app_docs/feature-9gjajh-bdd-regression-suite.md` even documents that as the rule), so the tags became load-bearing.

## Relevant Files
Use these files to fix the bug:

- `README.md` — two passages describe the sweep's marker commit and the human-executed relocation (line 33 "Scenario promotion sweep" bullet; line 338 under "Scenario Promotion"). Update them. The worktree already carries unrelated uncommitted edits to `README.md` and `.claude/commands/*.md` from before planning; leave those as they are.
- `.adw/coding_guidelines.md` — guidelines to follow: purity, declarative style, ≤ 2 nesting levels, the comments rule (no issue numbers in code comments), and files under 300 lines.
- `.adw/scenarios.md` — the real configuration whose `<!-- … -->` lines sit above each value; read it to understand the failure, but do not edit it.
- `adws/promotion/promotionStatsLoader.ts` — numerator and denominator queries (the threshold-ramp bug).
- `adws/promotion/promotionThreshold.ts` — the unchanged ramp formula (bootstrap guard at total = 0); reference only.
- `adws/promotion/index.ts` — re-exports `loadPromotionStats` / `PromotionStatsLoaderDeps`; it changes only if a re-exported name changes.
- `adws/promotion/__tests__/promotionStatsLoader.test.ts`, `adws/promotion/__tests__/promotionThreshold.test.ts` — unit tests; the first is rewritten for the new numerator and denominator.
- `adws/triggers/promotionSweepDefaults.ts` — production defaults: `tagAndCommit` (direct push, off-branch no-op), reads from `ctx.basePath`, and `loadStats` wiring with the broken pathspec.
- `adws/triggers/promotionSweep.ts` — the sweep shell: `attemptOriginate` files the issue after a tag write that may have done nothing.
- `adws/triggers/perIssueSweepPersist.ts` — `prepareSweepBase` / `persistCommitViaPr` / `cleanupSweepBase`, the dedicated-worktree + branch + immediately-merged-PR machinery to reuse; `persistCommitViaPr` must report whether the PR merged.
- `adws/triggers/docsIndexSweep.ts`, `adws/triggers/docsIndexSweepDefaults.ts` — the template to mirror (lazy `getBase`, defaults closed over it, cleanup in `finally`). `persistIndex` must `await` `persistCommitViaPr` once that helper returns a boolean.
- `adws/triggers/perIssueScenarioSweep.ts` — reference for worktree-synced listing and for `defaultGetMergedAt` (`listMergedPullRequests(200)` + `bodyLinksIssue`); unchanged.
- `adws/forge/issueLinkMarker.ts` — `bodyLinksIssue`, the canonical PR-body → issue matcher; unchanged.
- `adws/core/projectConfig.ts` — `parseScenariosMd` (HTML comments). The file is already 426 lines, so add only a small helper and do not refactor.
- `adws/core/__tests__/projectConfig.test.ts` — extend the `parseScenariosMd — per-issue / regression / vocabulary fields` block.
- `adws/core/promotionIssueBody.ts` — the issue body wording and tag instruction.
- `adws/core/promotionReconcileLink.ts` (`PromotionIssueRef`), `adws/core/promotionTagState.ts` (`serializePromotionTagState`), `adws/core/promotionSweepDecider.ts` — consumed as-is.
- `adws/triggers/trigger_cron.ts` — `runPromotionSweepTick` / `boundPromotionSweep`; unchanged (the sweep's signature is unchanged).
- `adws/triggers/__tests__/promotionSweepDefaults.test.ts`, `adws/triggers/__tests__/perIssueSweepPersist.test.ts` — updated unit tests. `docsIndexSweep*.test.ts`, `perIssueScenarioSweep.test.ts` and `trigger_cron.test.ts` must stay green.
- `features/per-issue/feature-934.feature` — this issue's BDD scenarios (threshold outline, marker-PR flow incl. decline/withdraw/merge-refused/foreign-branch host, HTML-comment outline, wording, the regression dry-run listing, type-check). The production seams below are shaped for them.
- `features/regression/hashing/feature-537.feature`, `features/regression/upgrade/feature-729.feature`, `features/regression/pause-queue/feature-910.feature`, `features/regression/pause-queue/feature-911.feature` — strip the `@adw-` tags.
- `features/regression/step_definitions/feature-537.steps.ts`, `feature-729.steps.ts`, `feature-910.steps.ts`, `feature-911.steps.ts`, `feature-902.steps.ts`, `feature-902-queue.steps.ts` — tag-scoped hooks to re-key, and two header docblocks that quote the expressions.
- `features/regression/vocabulary.md` — three section headings name `(@adw-537)`, `(@adw-910)`, `(@adw-911)`.
- `features/per-issue/feature-902.feature`, `feature-907.feature`, `feature-908.feature`, `features/per-issue/step_definitions/feature-912.steps.ts` — reference only. These per-issue rows keep their `@adw-910` / `@adw-911` cross-tags, so the regression hooks keep those alternatives. `@adw-912 and not @adw-910` stays correct.
- `cucumber.js` — reference: both `features/regression/**` and `features/per-issue/**` are loaded.
- `specs/adr/0049-promotion-sweep-files-human-gated-issue.md` — remove `## Divergence`.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` — remove Divergence item 5.
- `specs/adr/0019-dev-and-main-branches-with-runner-clone.md` — reference: the runner clone holds `main`, and the ruleset requires a PR with zero approvals, so an immediate merge works.
- `.claude/skills/write-an-adr/SKILL.md` — reference: an accepted ADR may change only `status`, `superseded-by`, `## Divergence` and the supersession note.
- `app_docs/feature-9gjajh-promotion-system.md` — module doc (conditional-docs match: threshold ramping, stats loading, sweep, issue body); update it.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — owns `perIssueSweepPersist.ts` (conditional-docs match: sweep persist orchestration); note the boolean result and the third consumer.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — owns `features/regression/**` (conditional-docs match: manual promotion into the regression suite); it states the old "keep pre-promotion tags" rule.
- `app_docs/feature-9gjajh-state-and-config.md` — owns `adws/core/projectConfig.ts`; note the comment stripping.
- `app_docs/feature-9gjajh-bdd-per-issue.md` — owns `features/per-issue/**` (conditional-docs match for `feature-934.feature`); read for context, no change needed.

### New Files
- `adws/triggers/__tests__/promotionSweep.test.ts` — unit tests for `runPromotionSweep` with every collaborator injected: plan → land → settle ordering, no issue without a landed marker, batching, decline / withdraw / redrive, and `report.threshold`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom. Within each step, write or adjust the unit tests first and watch them fail, then change the code.

### 1. Strip HTML comments from `.adw/scenarios.md` values (`adws/core/projectConfig.ts`)
- Add a module-private pure helper, e.g. `stripHtmlComments(value: string): string`, returning `value.replace(/<!--[\s\S]*?-->/g, '').trim()`.
- In `parseScenariosMd`, for every heading in `SCENARIOS_HEADING_TO_KEY`, compute the stripped value first and assign it only when non-empty. A section that holds only a comment must leave the default or `undefined` in place. This covers all eight scenario keys, including `runRegression`, whose body in this repo ends with the multi-line comment block.
- Do not change `parseMarkdownSections`. It is shared with the commands/providers/project/review-proof parsers, which are out of scope.
- Tests, in `adws/core/__tests__/projectConfig.test.ts` inside the existing `parseScenariosMd — per-issue / regression / vocabulary fields` describe block:
  - A comment on the line above the value (this repo's layout), a comment after the value on the same line, and a comment on the line below each yield exactly `features/regression/`, `features/per-issue/` and `features/regression/vocabulary.md`.
  - A multi-line comment is removed.
  - A section holding only a comment leaves the field `undefined`.
  - `runRegression` followed by a trailing multi-line comment block yields only the command.

### 2. Count promotions from merged promotion PRs and make the denominator see per-issue files (`adws/promotion/promotionStatsLoader.ts`)
- `PromotionStatsLoaderDeps`:
  - Add `listPromotionMergeDates: () => readonly Date[]`: the merge time of each promotion whose pull request merged, one entry per promotion issue.
  - Rename `perIssueGlob` to `perIssueDir`; it holds a plain directory pathspec such as `features/per-issue`.
  - Keep `gitLogSince`, `now` and `log`.
- Compute the window start once: a `Date` 90 days before `now()`, using the existing `setDate` arithmetic. Derive the git `--since` ISO date string from it.
- Numerator: count the merge dates on or after the window start. A throw from `listPromotionMergeDates` logs a `warn` and counts 0. Delete `countPromotionCommits` and every use of the `grep` / `oneline` options.
- Denominator: call `gitLogSince({ since, patch: true, pathspec: deps.perIssueDir })` and count `^\+\s*Scenario:` lines only inside `.feature` sections. Split the patch at `^diff --git ` and keep sections whose `diff --git a/… b/<path>` header ends in `.feature`. Write it declaratively (split → filter → reduce), not as a stateful loop.
- Add one comment on `perIssueDir` giving the non-obvious reason: the library puts the pathspec unquoted into a shell command, so a glob would be shell-expanded and must not be used.
- Leave `computeThreshold` and its constants unchanged.
- Tests, in `adws/promotion/__tests__/promotionStatsLoader.test.ts`:
  - Replace (a) and (e). Merge dates 10 days before `FIXED_NOW` count; dates 120 days before do not. `gitLogSince` is called exactly once, with `{ since: EXPECTED_SINCE, patch: true, pathspec: 'features/per-issue' }` and no `grep`.
  - Give the diffs in (b), (f) and (g) `diff --git a/features/per-issue/feature-1.feature b/features/per-issue/feature-1.feature` headers so their expected counts hold.
  - A `features/per-issue/step_definitions/feature-1.steps.ts` section containing `+  Scenario:` lines is not counted.
  - `listPromotionMergeDates` throwing gives a numerator of 0 with a `warn`, and the denominator is still computed.
  - **Acceptance test.** With 8 scenario additions, `computeThreshold(loadPromotionStats(deps))` is 3 for 0 promotions merged 10 days ago, 4 for 1, 5 for 2 and 7 for 4. The value is above `BOOTSTRAP_THRESHOLD` whenever promotions are in the window. This mirrors the threshold outline in `feature-934.feature`.

### 3. Make `persistCommitViaPr` report whether the sweep PR merged (`adws/triggers/perIssueSweepPersist.ts`, `adws/triggers/docsIndexSweepDefaults.ts`)
- Change the return type to `Promise<boolean>`:
  - Return `true` only after `mergePr` reports success.
  - Return `false` for: an already-open sweep PR, `commit(base)` returning `false`, an unresolved PR number, a failed merge, and the caught push/PR error.
  - Leave `commit(base)` outside the `try`, as it is today.
  - Add one sentence to its docblock stating what the resolved value means.
- `persistRemovalViaPr` keeps `Promise<void>`: `await persistCommitViaPr(…)` instead of returning it. TypeScript rejects `Promise<boolean>` where `Promise<void>` is declared (checked with `tsc` during planning).
- In `docsIndexSweepDefaults.ts`, make `persistIndex` an `async` arrow that `return`s when there is no base and `await`s `persistCommitViaPr(…)`, for the same reason. Behaviour is unchanged.
- Tests, in `adws/triggers/__tests__/perIssueSweepPersist.test.ts` (`describe('persistCommitViaPr')`), assert the resolved value:
  - the happy path gives `true`;
  - a merge failure gives `false`;
  - an existing open PR gives `false`, and `commit` is never called;
  - nothing committed gives `false`;
  - `pushBranch` throwing gives `false`.

  The existing `persistRemovalViaPr … resolves.toBeUndefined()` test must stay green.

### 4. Run the promotion defaults through a dedicated sweep worktree (`adws/triggers/promotionSweepDefaults.ts`)
- Export `PROMOTION_SWEEP_SPEC: SweepPersistSpec`:
  - `branch: 'chore/promotion-sweep'`, distinct from `chore/scenario-sweep` and `chore/docs-index-sweep`;
  - `prTitle: 'chore: promotion sweep — update promotion markers'`;
  - a `prBody` saying it adds, declines or withdraws `@promotion-suggested-<date>` / `@promotion-declined` on per-issue scenario files, with one commit per file.
- Export `interface MarkerWrite { filePath: string; content: string; message: string }`.
- Change the signature to `makeDefaultDeps(boundary: LaunchBoundary, getBase: () => SweepBase | null)`, mirroring `makeDocsIndexSweepDefaults`. Every git or file default goes through the base and never through `ctx.basePath`:
  - `listPerIssueFeatures` and `listStepDefSiblings` → `base.ctx.lsFiles(base.worktreePath, …)`.
  - `readFeatureContent` and `loadVocabulary` → read under `base.worktreePath`.
  - `scenariosConfig` → `loadProjectConfig(base.worktreePath)`.
  - With no base, each returns today's fallback: `[]`, `null`, the hard-coded paths, or `''`.
  - `loadStats` → `loadPromotionStats({ gitLogSince: (opts) => ctx.logSince(opts, getBase()?.worktreePath), listPromotionMergeDates: () => promotionMergeDates(listPromotionIssues(), codeHost.listMergedPullRequests(MERGED_PR_SCAN_LIMIT)), now: () => new Date(), perIssueDir: PER_ISSUE_DIR, log })`, still wrapped in its zero-stats `try/catch`. Define `listPromotionIssues` once as a local const so the returned deps and `loadStats` share it.
  - Add a module-private pure helper `promotionMergeDates(issues: readonly PromotionIssueRef[], mergedPrs: readonly MergedPullRequestRecord[]): Date[]`:
    - Keep only issues whose `state` uppercases to `CLOSED`; an absent state counts as open.
    - Take the first, which is the newest, merged PR with a `mergedAt` whose body `bodyLinksIssue(pr.body, issue.number)`.
    - Parse `mergedAt` and drop invalid dates.
    - Import `bodyLinksIssue` from `../forge/issueLinkMarker` and the type `MergedPullRequestRecord` from `@paysdoc/devplatform`.
    - Set `MERGED_PR_SCAN_LIMIT = 200`, the per-issue sweep's limit. This repo merged 116 PRs in the last 90 days.
  - Replace `tagAndCommit` with `persistMarkers: (writes: readonly MarkerWrite[]) => Promise<boolean>`:
    - With no base, resolve `false`.
    - Otherwise return `persistCommitViaPr((b) => commitMarkerWrites(b, writes), base, 'promotionSweep')`.
    - The module-private `commitMarkerWrites` writes each `content` to `path.join(b.worktreePath, filePath)`, then calls `b.ctx.addAndCommitPaths([filePath], message, b.worktreePath)`. That makes one scoped commit per file, never `git add -A`. It returns whether any commit was made.
    - Nothing writes to `ctx.basePath`, and nothing pushes the default branch.
  - `fileIssue` and `FEATURE_FILENAME_RE` are unchanged.
- Rewrite the header docblock: drop the `tagAndCommit` sentence and say every default reads from the sweep worktree. Remove imports that are now unused; lint fails on them.
- Tests, in `adws/triggers/__tests__/promotionSweepDefaults.test.ts`:
  - **Fixture.** Add a `makeFakeBase()` with worktree path `/sweep-worktree`, `ctx` set to the fake GitContext, `sweepBranch: 'chore/promotion-sweep'`, `defaultBranch: 'dev'`, and `findOpenSweepPr` / `openPr` / `mergePr` fakes. Pass `() => base`, or `() => null`, as `getBase`.
  - **Listing and reading.** Listing, reading, sibling listing, `scenariosConfig` (`loadProjectConfig('/sweep-worktree')`) and vocabulary all use `/sweep-worktree`. A null base gives today's fallbacks.
  - **`loadStats` (the issue's acceptance-criterion test).** Set up these issues and PRs:
    - CLOSED #900, linked by `Closes test-owner/test-repo#900`, merged 10 days ago;
    - CLOSED #901, linked by `Closes #901`, merged 10 days ago;
    - CLOSED #902 with no merged PR;
    - OPEN #903;
    - CLOSED #904, merged 120 days ago;
    - an unrelated merged PR;
    - `logSince` returning 8 `+  Scenario:` lines in per-issue `.feature` sections.

    Expect `{ promotedCount90d: 2, totalPerIssueCount90d: 8 }` and `computeThreshold(stats)` equal to 5, which is above 3. Assert `logSince` was called with `({ since: expect.any(String), patch: true, pathspec: 'features/per-issue' }, '/sweep-worktree')` and never with `grep`. Use `vi.setSystemTime` or relative dates for the 10-day and 120-day values.
  - **`listMergedPullRequests` throwing.** The numerator is 0 and the denominator is still counted.
  - **`persistMarkers`.**
    - Two writes produce two `writeFileSync` calls under `/sweep-worktree` and two `addAndCommitPaths` calls, each with its own path, message and `/sweep-worktree`.
    - It pushes `chore/promotion-sweep`, never `dev`, then opens and merges the PR and resolves `true`.
    - A failed merge resolves `false`.
    - A null base resolves `false` and writes nothing.
  - Delete the three `tagAndCommit` tests.

### 5. Plan, land, then settle in the sweep shell (`adws/triggers/promotionSweep.ts`)
- `PromotionSweepDeps`: replace `tagAndCommit` with `persistMarkers?: (writes: readonly MarkerWrite[]) => Promise<boolean>`. `PromotionSweepReport`: add `threshold: number`.
- `runPromotionSweep`:
  - Hold a lazily memoised `SweepBase` (`prepareSweepBase(deps.boundary, PROMOTION_SWEEP_SPEC)`) and pass its getter to `makeDefaultDeps(deps.boundary, getBase)`.
  - Put all default resolution and work inside `try { … } finally { if (cachedBase) cleanupSweepBase(cachedBase); }`, exactly the `runDocsIndexSweep` shape.
  - A fully injected caller never creates a base.
- Replace `processCandidate`, `attemptOriginate`, `attemptRedrive` and `attemptTagWrite` with three phases.
  1. **Plan.** `planCandidate(filePath, readFeatureContent, ctx): CandidatePlan` keeps today's guards, logs, scoring, reconcile and decision.
     - For `originate`, `decline` and `withdraw`, it returns a `MarkerWrite`:
       - `content` is `serializePromotionTagState(content, 'suggested', { date })`, `'declined'` or `'none'` respectively.
       - `message` is today's text: `chore: mark feature-N promotion-suggested`, `chore: mark feature-N promotion-declined` or `chore: withdraw feature-N promotion suggestion`.
     - `redrive` carries the feature number and scenarios. `leave` and `done` map to `left`.
  2. **Land.** `landMarkers(plans)` collects every plan's write.
     - With no writes it returns `false` without calling `persistMarkers`.
     - Otherwise it awaits `persistMarkers(writes)` exactly once. A throw is logged as a `warn` and treated as `false`.
  3. **Settle.** `settleCandidate(plan, landed, ctx): CandidateOutcome`:
     - An `originate` files its issue only when `landed`, built by `buildPromotionIssue` as today. Otherwise it logs that the marker did not reach the default branch and returns `action-failed`.
     - `decline` and `withdraw` report only when `landed`.
     - `redrive` files its issue regardless, because its marker is already on the default branch.
     - Issue-filing failures stay non-fatal: log a `warn` and return `action-failed`.
     - Share one `attemptFileIssue` between originate and redrive.
- Build the report declaratively from the outcomes (`flatMap` per kind), including `threshold`.
- Add `threshold` to the CLI summary log line.
- Add one comment at the settle gate for the ordering invariant: an originated issue must never exist without its marker on the default branch.
- Rewrite the header docblock for the new flow:
  - the worktree is synced to `origin/<default>`;
  - there is one sweep branch and one pull request per run, merged immediately;
  - the issue is filed after the merge;
  - there is no direct push, and the host checkout is untouched.

  Keep the file under 300 lines; trim the docblock rather than split the module.
- New `adws/triggers/__tests__/promotionSweep.test.ts`. Inject every collaborator:
  - `listPerIssueFeatures`, `readFeatureContent`, `listStepDefSiblings`, `loadVocabulary`, `loadStats`, `listPromotionIssues`, `scenariosConfig`, `persistMarkers`, `fileIssue`, `log`, `now`;
  - a fake `boundary` such as `{ gitContext: {}, providers: { issueTracker: {}, codeHost: {} } }`;
  - a vocabulary string with one `| W1 | \`…\` | … | subprocess | … |` row under `## When`. A scenario whose single When step matches it scores 3; each extra When / And-after-When step adds 1.

  Cases:
  - **Originate lands.** `persistMarkers` is called once with one write whose content carries `@promotion-suggested-<today>`, with message `chore: mark feature-612 promotion-suggested`. `fileIssue` runs after `persistMarkers` resolves; assert the order with a shared call log. The body starts with `Promotes: feature-612`, and `report.originated` is `[612]`.
  - **Originate not landed.** `persistMarkers` resolves `false`, or rejects. Then `fileIssue` is never called, `report.originated` is `[]`, and `runPromotionSweep` still resolves.
  - **Two candidates.** One `persistMarkers` call carries two writes, and two issues are filed after it.
  - **Decline.** The file is suggested and the tracker is CLOSED. The write carries `@promotion-declined` and no suggested token. `report.declined` holds the path only when landed.
  - **Withdraw.** The file is suggested, below threshold, with no tracker. The write carries no marker. `report.withdrawn` holds the path only when landed.
  - **Redrive.** The file is suggested, qualifying, with no tracker. `persistMarkers` is not called, one issue is filed, and `report.redriven` is `[612]`.
  - **Threshold.** `loadStats` returns `{ promotedCount90d: 2, totalPerIssueCount90d: 8 }`. `report.threshold` is 5, and a score-4 candidate is reported `left` with no write and no issue.

### 6. Fix the promotion issue body (`adws/core/promotionIssueBody.ts`)
- Replace the two-line opening with wording that describes per-issue scenarios correctly (ADR-0037 item 1) and avoids "input-only" and "never executed". For example: ``Direct relocation (matches #734${scoreSuffix}): move this scenario from the per-issue directory, where only its own workflow's test phase runs it (by its `@adw-${input.featureNumber}` tag), into the `@regression` suite.``
- Replace ``- Add a feature-level `@regression` tag to the moved feature file (keep its existing tags for traceability).`` with three lines:
  - ``- Add a feature-level `@regression` tag to the moved feature file.``
  - ``- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.``
  - ``- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.``
- Change nothing else in the body or the labels. It stays BDD-covered, as its docblock records, and `feature-934.feature` asserts the wording.

### 7. Strip the `@adw-` tags from the regression suite and re-key the hooks (`features/regression/`)
- **Feature-level tag lines**, line 1 of each file:
  - `hashing/feature-537.feature` → `@regression @framework-hash`
  - `upgrade/feature-729.feature` → `@regression @upgrade-regen`
  - `pause-queue/feature-910.feature` → `@regression @pause-queue-reset-time`
  - `pause-queue/feature-911.feature` → `@regression @pause-queue-ownership`
- **Scenario-level tag lines:**
  - Delete every line consisting only of `@adw-` tags: 537 lines 95–174 (8 lines), 729 lines 138 and 147, 911 lines 248–547 (17 lines), and 910 lines 231, 240, 248, 322, 347, 376, 397, 450, 477, 500, 530 and 535.
  - Replace feature-910's tag lines 258, 272, 295, 307 and 419 (the four §2 decider outlines and the §3 end-to-end journey) with `  @pause-queue-ownership`. They carry `@adw-911` today so that #911's hooks run for them.
  - Drop `@adw-912` outright; #912 is closed and no regression hook keys on it.
- **Hook expressions.** Keep every per-issue `@adw-` alternative: per-issue rows in `feature-902/907/908.feature` still carry `@adw-910` / `@adw-911` and still need these hooks.
  - `feature-537.steps.ts` Before/After: `@adw-537` → `@framework-hash`
  - `feature-729.steps.ts` Before/After: `@adw-729` → `@upgrade-regen`
  - `feature-910.steps.ts` Before/After: `@adw-910 or @adw-911` → `@adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership`
  - `feature-911.steps.ts` Before/After: `@adw-911` → `@adw-911 or @pause-queue-ownership`
  - `feature-902.steps.ts` Before, and `feature-902-queue.steps.ts` Before/After: `(@adw-902 or @adw-907 or @adw-910 or @adw-911) and not @adw-908 and not @adw-812` → `(@adw-902 or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership) and not @adw-908 and not @adw-812`
- **Docblocks that quote those expressions:** the headers of `feature-910.steps.ts` (lines 1–8) and `feature-911.steps.ts` (lines 1–11). Update the quoted expressions to match.
- **`vocabulary.md` headings:** `(@adw-537)` → `(@framework-hash)`, `(@adw-910)` → `(@pause-queue-reset-time)`, `(@adw-911)` → `(@pause-queue-ownership)`. The parser keys on `^##\s+(Given|When|Then)\b`, so the change is parse-safe.
- **Description prose in feature-910 and feature-911.** Where a sentence states which tags this file's own scenarios carry, or quotes a hook's tag expression, rewrite it to the new tags and expressions. Leave statements about per-issue files' tags as they are, because those files keep their tags.
  - feature-910: line 98 ("These also carry `@adw-911`"); lines 112–114 (the `@adw-912` guard passage, which now runs under `@regression` with this file's harness alone); lines 132–135 (the hook-widening note).
  - feature-911: line 100; lines 134–139 (quoted 902/910 hook expressions and the "separate `@adw-911` hook" note); line 192 and line 208 (the "`@adw-911` `After` hook" references).
  - Do not change any step text.
- **Equivalence checks.** The dry runs in Validation Commands must reproduce the planning baseline counts exactly. If they do not, a hook has changed scope.

### 8. Remove the resolved divergences from the ADRs
- `specs/adr/0049-promotion-sweep-files-human-gated-issue.md`: delete the whole `## Divergence` section (heading and items 1 and 2), as the #927 fix did for ADR-0048. Leave `### Confirmation` and `## More Information` untouched; `.claude/skills/write-an-adr/SKILL.md` allows an accepted ADR to change only `status`, `superseded-by`, `## Divergence` and the supersession note.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: delete Divergence item 5 ("**Two regression features keep their per-issue tags.** …") and nothing else. Keep item 6 numbered `6.`, because open issue #935 cites "items 3, 4 and 6" by number.

### 9. Bring README and module docs in line
- `README.md`, edit only these sentences:
  - **Line 33**: the "On `originate` it stamps … for a human to carry out as a direct relocation" sentence. The marker now lands through a dedicated `chore/promotion-sweep` branch and an immediately merged pull request (one scoped commit per file, never a direct push). The issue is filed only after that PR merges. The SDLC pipeline carries the issue out (`adw:feature`), and a human approves the PR (`hitl`), per ADR-0049's More Information. The ramp counts closed promotion issues whose PR merged in the last 90 days.
  - **Line 338**: the same correction for "On `originate`, the sweep stamps … not an automated mover PR". The closing clause about persistence through a dedicated worktree, branch and immediately merged PR is now true; extend it to say the promotion sweep also lists and reads candidates from that worktree.
- `app_docs/feature-9gjajh-promotion-system.md`:
  - **Line 15:** stats sources, i.e. merged promotion PRs and `.feature`-only `Scenario:` additions under the `features/per-issue` directory pathspec.
  - **Lines 26, 29, 30:** the plan → land → settle executors, the body instructions, and `makeDefaultDeps(boundary, getBase)` with `persistMarkers` instead of `tagAndCommit`.
  - **Line 65:** `serializePromotionTagState` is written via `persistMarkers`.
  - **Lines 86–89:** the scoped commits now run in the sweep worktree. Replace the off-branch `tagAndCommit` rule with: the issue is filed only after the marker PR merged; there is no direct push; the host checkout is untouched.
  - **Line 93:** coverage now includes `promotionSweep.test.ts` and `@adw-934`.
  - **Lines 107, 109, 110:** the loader deps, the `PromotionSweepDeps` fields, and the scenarios config read from the worktree with comments stripped.
  - **Line 119:** the shell is now unit-tested with injected deps, still not against real git/gh.
  - **New gotcha:** why the denominator pathspec is a plain directory.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`, line 25: `persistCommitViaPr` resolves `true` only when the sweep PR merged, and `SweepPersistSpec` now has a third consumer (the promotion sweep, `chore/promotion-sweep`).
- `app_docs/feature-9gjajh-bdd-regression-suite.md`:
  - **Line 22:** the hook-tag example `{ tags: '@adw-729' }` becomes `{ tags: '@upgrade-regen' }`.
  - **Line 68:** the manual-promotion gotcha becomes "replace the feature-level `@adw-` tags with `@regression` and remove every scenario-level `@adw-` tag".
  - **Line 70:** `@adw-911` becomes `@pause-queue-ownership`.
  - **Line 73:** the rule becomes: a promoted scenario drops every `@adw-` tag; hooks scoped to them are re-keyed to a descriptive tag on the moved feature (the four promoted features use `@framework-hash`, `@upgrade-regen`, `@pause-queue-reset-time`, `@pause-queue-ownership`); and the pause-queue hooks keep their per-issue `@adw-` alternatives for the rows still under `features/per-issue/`.
- `app_docs/feature-9gjajh-state-and-config.md`: add one line. `parseScenariosMd` strips HTML comments from every section value, whether above the value, inline, below it or across several lines. A comment-only section counts as absent. `parseMarkdownSections` itself keeps comments.

### 10. Run the validation commands
- Run every command in `Validation Commands`, compare against the planning baselines quoted there, and fix any difference before finishing.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Run all of them from the worktree root.

- **Config comments, before and after:** `bunx tsx -e "import { loadProjectConfig } from './adws/core/projectConfig.ts'; const s = loadProjectConfig('.').scenarios; console.log(JSON.stringify([s.perIssueScenarioDirectory, s.regressionScenarioDirectory, s.vocabularyRegistry]))"`. Before, each value starts with `<!-- Consumed by …`. After, it prints `["features/per-issue/","features/regression/","features/regression/vocabulary.md"]`.
- **Issue body, before and after:** the step 2 command of `Steps to Reproduce`. Before, it prints `{"htmlComment":true,"neverExecuted":true,"inputOnly":true,"keepsExistingTags":true,"removesAdwTags":false}`. After, it prints `{"htmlComment":false,"neverExecuted":false,"inputOnly":false,"keepsExistingTags":false,"removesAdwTags":true}`.
- **Regression tags, before and after:** `grep -rlE '^\s*@.*@adw-' features/regression --include='*.feature' | wc -l` prints `4` before and `0` after.
- **Regression tag dry run:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@regression and (@adw-537 or @adw-729 or @adw-910 or @adw-911 or @adw-912)" --format summary` reports `79 scenarios` before and `0 scenarios` after.
- **Hook-scope equivalence:** the planning baselines, taken with the old tags, are 122, 8, 2, 34, 57, 120, 75 and 60. Each command uses `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary --tags …`:
  - `"@regression"` → `122 scenarios`
  - `"@regression and @framework-hash"` → `8`
  - `"@regression and @upgrade-regen"` → `2`
  - `"@regression and @pause-queue-reset-time"` → `34`
  - `"@regression and @pause-queue-ownership"` → `57`
  - the new 902 hook expression `"(@adw-902 or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership) and not @adw-908 and not @adw-812"` → `120`
  - the new 910 hook expression `"@adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership"` → `75`
  - the new 911 hook expression `"@adw-911 or @pause-queue-ownership"` → `60`
- **Re-tagged regression features execute:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and (@framework-hash or @upgrade-regen or @pause-queue-reset-time or @pause-queue-ownership)" --format summary` reports `79 scenarios (79 passed)`. Before the change, the same 79 scenarios selected by the old tags passed in about 33 s.
- **Targeted unit tests:** `bunx vitest run adws/promotion adws/triggers/__tests__/promotionSweep.test.ts adws/triggers/__tests__/promotionSweepDefaults.test.ts adws/triggers/__tests__/perIssueSweepPersist.test.ts adws/triggers/__tests__/perIssueScenarioSweep.test.ts adws/triggers/__tests__/docsIndexSweep.test.ts adws/triggers/__tests__/docsIndexSweepDefaults.test.ts adws/triggers/__tests__/trigger_cron.test.ts adws/core/__tests__/projectConfig.test.ts`. Everything passes, including the threshold-above-3 acceptance tests from steps 2 and 4.
- **Lint:** `bun run lint`
- **Type checks:** `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`
- **Build:** `bun run build`
- **Full unit suite:** `bun run test:unit`. The planning baseline was 172 files and 2,794 tests passing; it must stay green, plus the new tests.
- **Guards:** `bun run lint:git-guard` (no new direct git/gh shell-outs: everything goes through `GitContext`/`CodeHost`) and `bun run lint:docs-index`.
- **ADR checks:**
  - `grep -c '^## Divergence' specs/adr/0049-promotion-sweep-files-human-gated-issue.md` prints `0`.
  - `grep -c 'Two regression features keep their per-issue tags' specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` prints `0`.
  - `grep -c '^6\. \*\*One feature file is never run' specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` prints `1`.
- **This issue's BDD scenarios:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-934"`. All scenarios pass.
- **Regression suite:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`.
  - The planning baseline was `122 scenarios (42 pending, 80 passed)` with Cucumber exit code 1, caused solely by the 42 pending smoke/surface scenarios (ADR-0037 Divergence item 3, owned by #935).
  - After the fix the summary must be the same: 0 failed, 0 undefined, still 80 passed. The non-zero exit from the pending scenarios is pre-existing and not caused by this change.

## Notes
- Follow `.adw/coding_guidelines.md` strictly:
  - pure helpers (`stripHtmlComments`, `promotionMergeDates`, the patch-section counter, `planCandidate`);
  - side effects only in the defaults and the shell;
  - declarative `map`/`filter`/`flatMap`/`reduce`;
  - guard clauses and ≤ 2 nesting levels;
  - no `any` and no `!` assertions;
  - files under 300 lines (`projectConfig.ts` is already 426, so do not grow it beyond the small helper);
  - comments only for invariants and non-obvious reasons, and never an issue number in a code comment.
- No new library is needed; nothing to install.
- **Why the regression hook expressions still mention `@adw-` tags.** Per-issue `feature-902/907/908.feature` rows still carry `@adw-910` / `@adw-911`, and the per-issue features use the regression harness's hooks. The acceptance criterion is about tags carried by regression scenarios; Cucumber's dry-run listing and the tag-line grep above check exactly that. Prose and tag expressions are not tags.
- **Effect on real data.** With this repo's current history (3 merged promotions against 656 per-issue `Scenario:` additions in 90 days, a ratio of 0.5%), the repaired ramp still computes 3 today. It first rises to 4 when the ratio reaches 6.25%. The ramp now works, and its calibration (`RATIO_CAP`, the window, counting added `Scenario:` lines) is unchanged by design.
- **Expect more candidates on the first sweep after deploy.** Because the vocabulary path is no longer polluted, production scores will include surface-match and execution-pattern weight, not just phase count. More candidates may cross the threshold on the first sweep after deploy.
- **Hints for the BDD step definitions** (`feature-934.feature`):
  - The denominator counts every `+Scenario:` line added to a per-issue `.feature` file on the default branch in the last 90 days, including the fixture candidate's own scenarios. Fixtures that pin a threshold must account for that, for example by keeping `feature-612` to one scenario or committing it with an older date.
  - `Scenario Outline:` lines are not counted.
  - The sweep's worktree lives under the GitContext's worktrees directory and is removed in `finally`.
  - `report.threshold` exposes the computed threshold.
- The pending regression smoke scenario `features/regression/smoke/promotion_threshold_auto_ramp.feature` seeds `regression-promotion:` commits (`test/fixtures/jsonl/manifests/promotion-threshold-mature-repo.json`) and drives the deleted `promotion-sweep` orchestrator. It is pending (ADR-0037 item 3) and belongs to #935. Its premise no longer matches the ramp, but it is left untouched here; #935 should seed merged promotion PRs instead.
- `persistCommitViaPr` returns early when a sweep PR for its branch is already open. `cleanupSweepBase` deletes the sweep branch after every run, which closes a PR whose merge failed, so the next sweep starts clean. This is the same recovery as the per-issue and docs-index sweeps.
- A planning-time scratch file exists outside the repository, at `/tmp/tscheck934/x.ts`. It was used to confirm the `Promise<boolean>` → `Promise<void>` type error, and the session's hook blocked removing it. It is not part of the change.
