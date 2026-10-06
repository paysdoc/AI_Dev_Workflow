# Feature: Promote the #932 ADW-label scenario (adw:none on every spawn path, label provisioning, routing by label) into the @regression suite

## Metadata
issueNumber: `1003`
adwId: `2st5ai-feat-promote-932-sce`
issueJson: `{"number":1003,"title":"feat: promote #932 scenario into the @regression suite","body":"Promotes: feature-932\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-932` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-932.feature features/regression/<subdir>/feature-932.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-932.steps.ts features/regression/step_definitions/feature-932.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-932.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-932.steps.ts`\n\n## Phrases to register\n\n- `a launch boundary for the repository \"adw-fixture/void-932\" whose providers record every call`\n- `issue 9301 in the recording tracker carries the label \"adw:none\"`\n- `the webhook dispatches the opening of issue 9301 from that boundary`\n- `no ADW run was started for issue 9301`\n- `the boundary's issue tracker recorded no comment`\n- `the boundary's providers recorded no label applied to issue 9301`\n- `issue 9302 in the recording tracker carries the labels \"adw:none\", \"adw:bug\" and \"adw:feature\"`\n- `the webhook dispatches the opening of issue 9302 from that boundary`\n- `no ADW run was started for issue 9302`\n- `issue 9328 in the recording tracker carries the label \"adw:none\"`\n- `the webhook dispatches the opening of issue 9328 from that boundary with no labels in the event`\n- `no ADW run was started for issue 9328`\n- `the issue classifier was not consulted for issue 9328`\n- `the boundary's providers recorded no label applied to issue 9328`\n- `issue 9303 in the recording tracker carries the label \"adw:chore\"`\n- `the webhook dispatches the opening of issue 9303 from that boundary`\n- `exactly one ADW run was started for issue 9303`\n- `the ADW run started for issue 9303 runs the orchestrator \"adws/adwChore.tsx\"`\n- `issue 9304 in the recording tracker carries the label \"adw:none\"`\n- `the webhook dispatches a \"## Continue\" comment on issue 9304 from that boundary`\n- `no ADW run was started for issue 9304`\n- `the issue classifier was not consulted for issue 9304`\n- `issue 9305 in the recording tracker carries the labels \"adw:bug\" and \"adw:none\"`\n- `the webhook dispatches a \"## Continue\" comment on issue 9305 from that boundary`\n- `no ADW run was started for issue 9305`\n- `issue 9306 in the recording tracker carries the label \"adw:bug\"`\n- `the webhook dispatches a \"## Continue\" comment on issue 9306 from that boundary`\n- `exactly one ADW run was started for issue 9306`\n- `the ADW run started for issue 9306 runs the orchestrator \"adws/adwSdlc.tsx\"`\n- `issue 9307 in the recording tracker carries the labels \"adw:chore\" and \"adw:none\"`\n- `issue 9307 has an earlier ADW workflow under adw id \"none932-9307\" recorded at workflowStage \"abandoned\" running \"adws/adwChore.tsx\"`\n- `issue 9308 in the recording tracker carries the label \"adw:chore\"`\n- `issue 9308 has an earlier ADW workflow under adw id \"none932-9308\" recorded at workflowStage \"abandoned\" running \"adws/adwChore.tsx\"`\n- `the webhook dispatches a \"## Continue\" comment on issue 9307 from that boundary`\n- `the webhook dispatches a \"## Continue\" comment on issue 9308 from that boundary`\n- `no ADW run was started for issue 9307`\n- `exactly one ADW run was started for issue 9308`\n- `the ADW run started for issue 9308 runs the orchestrator \"adws/adwChore.tsx\"`\n- `issue 9309 in the recording tracker is in state \"CLOSED\"`\n- `the body of issue 9310 in the recording tracker reads:`\n- `issue 9310 in the recording tracker carries the label \"adw:none\"`\n- `the body of issue 9311 in the recording tracker reads:`\n- `issue 9311 in the recording tracker carries the label \"adw:chore\"`\n- `the webhook dispatches the closing of issue 9309 from that boundary`\n- `no ADW run was started for issue 9310`\n- `the issue classifier was not consulted for issue 9310`\n- `exactly one ADW run was started for issue 9311`\n- `the ADW run started for issue 9311 runs the orchestrator \"adws/adwChore.tsx\"`\n- `issue 9312 in the recording tracker carries the label \"adw:none\"`\n- `issue 9313 in the recording tracker carries the label \"adw:feature\"`\n- `the cron tick runs once from that boundary`\n- `no ADW run was started for issue 9312`\n- `exactly one ADW run was started for issue 9313`\n- `the ADW run started for issue 9313 runs the orchestrator \"adws/adwSdlc.tsx\"`\n- `issue <optedOut> in the recording tracker carries the labels \"adw:chore\" and \"adw:none\"`\n- `issue <optedOut> has an earlier ADW workflow under adw id \"none932-<optedOut>\" recorded at workflowStage \"<stage>\" running \"adws/adwChore.tsx\"`\n- `issue <control> in the recording tracker carries the label \"adw:chore\"`\n- `issue <control> has an earlier ADW workflow under adw id \"none932-<control>\" recorded at workflowStage \"<stage>\" running \"adws/adwChore.tsx\"`\n- `no ADW run was started for issue <optedOut>`\n- `exactly one ADW run was started for issue <control>`\n- `the ADW run started for issue <control> runs the orchestrator \"adws/adwChore.tsx\"`\n- `issue 9318 in the recording tracker carries the labels \"adw:bug\" and \"adw:none\"`\n- `issue 9318 has an earlier ADW workflow under adw id \"none932-9318\" recorded at workflowStage \"awaiting_merge\" running \"adws/adwSdlc.tsx\"`\n- `issue 9319 in the recording tracker carries the label \"adw:bug\"`\n- `issue 9319 has an earlier ADW workflow under adw id \"none932-9319\" recorded at workflowStage \"awaiting_merge\" running \"adws/adwSdlc.tsx\"`\n- `no ADW run was started for issue 9318`\n- `exactly one ADW run was started for issue 9319`\n- `the ADW run started for issue 9319 runs the orchestrator \"adws/adwMerge.tsx\"`\n- `issue 9320 in the recording tracker carries the labels \"adw:bug\" and \"adw:feature\"`\n- `the webhook dispatches the opening of issue 9320 from that boundary`\n- `no ADW run was started for issue 9320`\n- `the boundary's issue tracker recorded a comment on issue 9320`\n- `the recorded comment on issue 9320 contains \"conflicting\"`\n- `issue 9321 in the recording tracker carries the labels \"adw:bug\" and \"adw:feature\"`\n- `the webhook dispatches a \"## Continue\" comment on issue 9321 from that boundary`\n- `exactly one ADW run was started for issue 9321`\n- `the issue classifier was consulted for issue 9321`\n- `issue 9322 in the recording tracker is in state \"CLOSED\"`\n- `the body of issue 9323 in the recording tracker reads:`\n- `issue 9323 in the recording tracker carries the labels \"adw:bug\" and \"adw:feature\"`\n- `the webhook dispatches the closing of issue 9322 from that boundary`\n- `exactly one ADW run was started for issue 9323`\n- `the issue classifier was consulted for issue 9323`\n- `issue 9324 in the recording tracker carries the labels \"adw:bug\" and \"adw:feature\"`\n- `issue 9325 in the recording tracker carries the label \"adw:chore\"`\n- `no ADW run was started for issue 9324`\n- `exactly one ADW run was started for issue 9325`\n- `the ADW run started for issue 9325 runs the orchestrator \"adws/adwChore.tsx\"`\n- `a cron trigger process is launched with --target-repo \"adw-fixture/labels-932\"`\n- `the repository \"adw-fixture/labels-932\" has each of these labels:`\n- `the forge refuses to create labels`\n- `a cron trigger process is launched with --target-repo \"adw-fixture/labels-refused-932\"`\n- `the forge was asked to create each of these labels on the repository \"adw-fixture/labels-refused-932\":`\n- `the cron trigger process launched with --target-repo \"adw-fixture/labels-refused-932\" completes its first poll tick`\n- `issue 9327 in the recording tracker is titled \"depaudit: major upgrade — left-pad 1.3.0 → ^2.0.0 (resolves GHSA-0000-0932-0001)\"`\n- `the body of issue 9327 in the recording tracker reads:`\n- `issue 9327 in the recording tracker carries the label \"adw:bug\"`\n- `the webhook dispatches the opening of issue 9327 from that boundary`\n- `exactly one ADW run was started for issue 9327`\n- `the ADW run started for issue 9327 runs the orchestrator \"adws/adwSdlc.tsx\"`\n- `the issue classifier was not consulted for issue 9327`\n- `the boundary's providers recorded no label applied to issue 9327`\n- `issue 9329 in the recording tracker is titled \"depaudit: major upgrade — minimist 0.0.8 → ^1.2.6 (resolves GHSA-0000-0932-0002)\"`\n- `the body of issue 9329 in the recording tracker reads:`\n- `issue 9329 in the recording tracker carries the label \"adw:chore\"`\n- `the webhook dispatches the opening of issue 9329 from that boundary`\n- `exactly one ADW run was started for issue 9329`\n- `the ADW run started for issue 9329 runs the orchestrator \"adws/adwChore.tsx\"`\n- `the issue classifier was not consulted for issue 9329`\n- `the ADW TypeScript type-check passes`\n- `the git/gh guard is run across the repository`\n- `the git/gh guard reports no violations`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-932.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-04T15:36:14Z","comments":[],"actionableComment":null}`

## Feature Description
Move `features/per-issue/feature-932.feature` into the `@regression` suite as
`features/regression/labels/feature-932.feature`, tagged `@regression @label-routing`. The feature is
the behavioural contract of #932's ADW-label rulings. It holds **23 scenarios**: 22 headers, one of
them an outline with two examples. Its 165 executed steps include the Background.

| Group | Scenarios | What it pins |
|-------|-----------|--------------|
| §1 | 13 | `adw:none` starts no run on any spawn path. The paths are `issues.opened` (including a label that lands just after the event), a `## Continue` comment (fresh and takeover), a dependency closing, and the cron's fresh sweep, takeover (outline: `abandoned`, `phase_timeout`) and merge hoist. Each sits beside a positive control that does start a run |
| §2 | 4 | Conflicting classification labels: refused with a cleanup comment on `issues.opened` and passed over by the cron; classified and started on the comment and dependency-closure paths |
| §3 | 2 | A real cron process launched for a repository asks the forge for all eight ADW labels, and keeps polling when the forge refuses every one |
| §4 | 2 | A major-upgrade issue is routed by its `adw:*` label with no classification call, never by a `/adw_sdlc` left in its body |
| §5 | 2 | Backstops: the type-check (T22) and the git/gh guard (W16/T34) |

Every assertion reads a runtime artefact:
- the argv a `bunx` recorder captured for each orchestrator launch;
- the Claude CLI invocations a recording wrapper captured;
- the recording providers' call log;
- the `gh label create` invocations a `gh` shadow captured;
- a real cron process's output;
- a subprocess exit code.

No step reads a source file. The promotion sweep scored the feature 3 (the #734 precedent).

Like the #910 and #911 promotions, `feature-932` is **not self-contained**:

1. **Four step files, not one.** The 19 phrases it introduces live in four sibling files:
   - `feature-932.steps.ts`: the hooks and 4 Givens;
   - `feature-932-drive.steps.ts`: 5 Whens;
   - `feature-932-observe.steps.ts`: 1 Given, 1 When and 8 Thens;
   - `feature-932-world.ts`: the recorders, waits and shared state.

   The issue lists only the first, because its sibling rule is `startsWith('feature-932.')`.
2. **An import into another feature's harness.** All four import `./feature-796.steps.ts` for the
   recording launch boundary, `world796()`, `resetWorld`, `seededIssueNumbers` and the `Fixture` type.
3. **Eight phrases defined elsewhere.** Five live in `feature-796.steps.ts`: the boundary Given and
   four call-log Thens. Three live in `feature-820.steps.ts`: the one-label, two-label and title
   Givens. Both files are leftovers. The sweep deleted `feature-796.feature` (`24ae0a98`) and
   `feature-820.feature` (`340aefe1`), and their step files survive only because other features
   import them.
4. **The `@regression` hooks bypass the Claude recorder.** Once the step files load from
   `features/regression/step_definitions/`, the shared mock harness's `Before` runs **after**
   #932's own `Before`. It points `CLAUDE_CODE_PATH` at the plain Claude stub, past the recording
   wrapper. The two "classifier was consulted" rows would then fail, and the five "was not
   consulted" assertions would pass vacuously.

So this promotion moves the scenario **together with its step-definition dependency closure** (six
step files) and rewrites none of their import specifiers. It repoints the per-issue importers left
behind, re-keys the hooks to a descriptive tag, keeps the Claude recorder effective under the
`@regression` hooks, and registers 27 phrase patterns. No `adws/**` production code changes.

## User Story
As an **ADW maintainer**
I want **#932's label contract to run on every `@regression` pass: `adw:none` wins on every spawn path, conflicting labels are handled as before on each path, a repository's cron defines the ADW labels, and a major-upgrade issue is routed by its label**
So that **a change that lets an opted-out issue start a run, or stops a cron from provisioning the labels, is caught automatically, and neither the scenario nor the harness it runs on can vanish with `features/per-issue/`.**

## Problem Statement
- **Not in the regression run.** `feature-932.feature` carries no `@regression` tag; only its own
  workflow's test phase runs it, by `@adw-932`. Its `@promotion-suggested-2026-10-04` marker is the
  only thing keeping the 14-day per-issue sweep from deleting it.
- **The issue's two-file recipe cannot work on its own.** The issue also says "Do not rewrite the
  step-def files' relative imports".
  - Moving only `feature-932.steps.ts` leaves its `./feature-932-world.ts` import dangling. One
    unresolvable import stops Cucumber loading **all** support code, which aborts every run,
    per-issue runs included.
  - Moving the four `feature-932*` files without `feature-796.steps.ts` leaves `./feature-796.steps.ts`
    dangling in all four. Pointing those imports back into `features/per-issue/` is the rewrite the
    issue forbids, and it would leave a regression scenario depending on per-issue files.
  - Leaving `feature-820.steps.ts` behind leaves three of the scenario's phrases defined only under
    `features/per-issue/`. `app_docs/feature-9gjajh-bdd-regression-suite.md` says to promote the
    whole closure when a step file "relies on steps/hooks defined in other per-issue files".
- **Importers left behind.** Moving the closure strands 16 `./…` import specifiers in 12 per-issue
  files, belonging to features 848, 929, 933, 959 and 988 (listed in Task 4).
- **Hook scope.** `feature-932.steps.ts`'s `Before`/`After` are keyed on `@adw-932`, which the
  promotion removes. The `Before` resets the world, installs the recorders and saves env and files;
  the `After` kills the real cron and removes cron registrations, spawn locks, `agents/<adwId>/`
  state and temp dirs, then restores env and files. Left keyed on `@adw-932`, neither runs: the rows
  fail, and leak state into later scenarios.
- **The Claude recorder is bypassed under `@regression`.** `cucumber.js` imports
  `features/regression/step_definitions/**` before `features/regression/support/**`, so once moved:
  1. #932's `Before` runs first and sets `CLAUDE_CODE_PATH` to its recording wrapper.
  2. `hooks.ts`'s `@regression` `Before` calls `setupMockInfrastructure()`, which overwrites the
     variable with `test/mocks/claude-cli-stub.ts` (`test/mocks/test-harness.ts:144`).
  3. `claudeAgent.ts:117` resolves the path at spawn time through `resolveClaudeCodePath()`, keyed on
     the live env var. Classification therefore runs the bare stub and nothing is recorded:
     - `the issue classifier was consulted for issue 9321` and `… 9323` time out;
     - the five "not consulted" assertions (9304, 9310, 9327, 9328, 9329) pass for the wrong
       reason.
- **Unregistered phrases.** Apart from G18, T22, W16 and T34, none of the scenario's 27 phrase
  patterns is registered in `features/regression/vocabulary.md`.

## Solution Statement
1. **Move the feature** into a new subject directory, `features/regression/labels/feature-932.feature`.
   - Line 1 becomes `@regression @label-routing`. That drops `@adw-932` and
     `@adw-xs9x3g-bug-adw-none-wins-on`. It also drops the `@promotion-suggested-2026-10-04` marker,
     which only means something under `features/per-issue/` (the #923 plan's precedent).
   - Delete the 22 scenario-level `@adw-` tag lines.
   - Correct the five description phrases that name the old hook tag or the old `feature-796` path.
   - `labels/` names the subject: the opt-out label, conflicting labels, the label catalogue and
     routing by label. The descriptive tag must not start with `@adw-`, so `@adw-none` and
     `@adw-labels` are out. `@label-routing` matches the "label-routing path" wording the README
     already uses for this area.
2. **Move the step-definition closure** into `features/regression/step_definitions/` with `git mv`:
   the four `feature-932*` files plus `feature-796.steps.ts` and `feature-820.steps.ts`. Both
   directories are three levels deep, so every specifier in the six files resolves unchanged:
   - `../../../adws/…`;
   - `../../regression/step_definitions/realCronProcess.ts`;
   - the siblings `./feature-796.steps.ts` and `./feature-932-world.ts`, which move together.

   No moved import specifier is rewritten.
3. **Repoint** the 16 stranded specifiers in the 12 per-issue files to
   `../../regression/step_definitions/…`. Per-issue files already reach `world.ts`,
   `realCronProcess.ts` and `feature-902*.steps.ts` this way.
4. **Re-key #932's hooks** from `@adw-932` to `@label-routing`.
   - No `@adw-` alternative needs keeping. No other feature carries `@adw-932`, and feature-959
     only imports #932's world helpers, under its own hooks.
   - The `@adw-796` and `@adw-820` hooks in the two moved harness files stay as they are. No feature
     carries those tags (only prose in `feature-848.feature` and `feature-932.feature` mentions
     them), and they are not keyed on the tags this promotion removes.
5. **Keep the Claude recorder effective under `@regression`.** Put the recording wrapper on
   `CLAUDE_CODE_PATH` at dispatch time, in the two When paths that can classify (the webhook dispatch
   and the cron tick). This is what `shadowBunx()` already does for `PATH`. `Before` stops setting
   the variable. Every save and restore still balances (trace in Task 9).
6. **Register 27 phrase patterns** in a new
   `## Given/When/Then — ADW Labels: Opt-Out, Routing and Provisioning (@label-routing)` section of
   `vocabulary.md` (G-LR1–9, W-LR1–6, T-LR1–12), and reuse G18, T22, W16 and T34.
7. **Add one README tree line** for `features/regression/labels/`.
8. **Prove the result:**
   - the whole-suite dry-run is identical before and after the moves (0 ambiguous);
   - the 23 promoted scenarios pass under `@regression`, twice, with real timers and processes;
   - the full `@regression` gate gains 23 passing scenarios and no new non-pass;
   - the per-issue features that share the harness (848, 929, 933, 959, 988) match their baseline.

**Why this is safe (verified during planning):**
- **No new ambiguity, no change in load.** `cucumber.js` imports both step-definition trees. Each
  moved module is still evaluated once (the ESM cache is keyed on the resolved URL), and a move adds
  or duplicates no definition.
- **Other features see the same hooks.**
  - #932's re-keyed hooks match only `@label-routing`.
  - The 796 and 820 hooks match nothing, before or after.
  - Feature-959's hooks (`OWN_ROWS = '@adw-959 and not @adw-908 and not @adw-912'`) and those of
    848, 929, 933 and 988 do not move.
  - The new hook order (#932's hooks before `hooks.ts`) affects only the promoted rows, and Task 9
    handles its one consequence.
- **The rest of the `@regression` mock is harmless to these rows.** `setupMockInfrastructure` also
  sets `GH_TOKEN`, `GH_HOST` (the localhost mock), `MOCK_*` and `REAL_GIT_PATH`, and prepends the git
  mock to `PATH`.
  - The in-process rows reach the forge only through the recording providers.
  - `shadowBunx()` rebuilds `PATH` from the pre-mock value `Before` saved, exactly as in today's
    per-issue run.
  - `spawnRealCron` pins `GH_TOKEN`, the App variables and `CLAUDE_CODE_PATH` itself.
  - `gh label create` always carries `--repo owner/repo`, whatever `GH_HOST` says
    (`@paysdoc/devplatform`'s `labelCommands.js`), so the `gh` shadow's matcher is unaffected.
  - `feature-911`'s W-PQ5 already runs a real `trigger_cron.ts --target-repo` under these hooks.
- **No `@webhook` or `@subprocess` tag.** `createSubprocessHarness` and `webhookCronSteps.ts`'s hooks
  (`@webhook or @adw-961`) never attach to these rows.
- **Fixtures stay unique in a combined run.** Issue numbers 9301–9329 and the `adw-fixture/*-932`
  repositories appear nowhere else in `features/regression/`; 9300 only names a promotion-smoke
  fixture file. So the webhook's 60 s duplicate window, the cron's `processedSpawns` and the per-issue
  spawn locks cannot make a row vacuous. The five in-process cron ticks keep the process-wide tick
  counter well under the dev-server janitor's fifteen, and `cucumber.js` already points
  `TARGET_REPOS_DIR` at an empty directory.
- **The usual checks still cover the moved code.**
  - `tsconfig.json` includes `**/*.ts`, and ESLint lints `features/`.
  - `adws/checkGitGhGuard.ts` exempts `features/`.
  - Vitest collects only `adws/**` and `test/mocks/**`.
  - `features/regression/**` and `features/per-issue/**` stay owned in `.adw/conditional_docs.md`.
- **The sweep no longer reaches anything moved.** `perIssueScenarioSweep.ts` walks only
  `features/per-issue/feature-N.feature` files and deletes their `startsWith('feature-N.')`
  siblings. None of the closure stays there.

## Relevant Files
Use these files to implement the feature:

**Moved with `git mv`.** Contents change only where Tasks 6–9 say.
- `features/per-issue/feature-932.feature` → `features/regression/labels/feature-932.feature`. The
  scenario file. Task 6 sets its tags; Task 7 makes five prose corrections.
- `features/per-issue/step_definitions/feature-932.steps.ts` →
  `features/regression/step_definitions/feature-932.steps.ts`.
  - It holds the `@adw-932` `Before`/`After` (re-keyed in Task 8; Task 9 changes one `Before` line)
    and four Givens.
  - It imports `./feature-796.steps.ts`, `./feature-932-world.ts`,
    `../../regression/step_definitions/realCronProcess.ts` and `../../../adws/…`.
- `features/per-issue/step_definitions/feature-932-world.ts` → `…/regression/step_definitions/`.
  The `bunx`, Claude and `gh` shadows, the argv-record readers, `settle`/`waitFor` and the
  module-level state `s`. Task 9 adds `claudeShadowPath()`. Feature-959 imports many of its exports;
  their behaviour must not change.
- `features/per-issue/step_definitions/feature-932-drive.steps.ts` → `…/regression/step_definitions/`.
  The five Whens: four webhook dispatches through the real `dispatchWebhookEvent`, and the in-process
  `checkAndTrigger` tick. Task 9 adds `shadowClaude()`.
- `features/per-issue/step_definitions/feature-932-observe.steps.ts` → `…/regression/step_definitions/`.
  The launch and classifier Thens, the refusing-forge Given, the real-cron When and the label and
  poll-tick Thens. No content change.
- `features/per-issue/step_definitions/feature-796.steps.ts` → `…/regression/step_definitions/`. No
  content change. It holds:
  - the recording launch boundary (`buildRecordingBoundary`, `makeRecordingProviders`, `world796`,
    `resetWorld`, `seededIssueNumbers`, `Fixture`);
  - the five phrases G-LR1 and T-LR6–T-LR9;
  - dead `@adw-796` hooks.
- `features/per-issue/step_definitions/feature-820.steps.ts` → `…/regression/step_definitions/`. No
  content change. It holds the three phrases G-LR2, G-LR3 and G-LR5 and dead `@adw-820` hooks, and
  imports `./feature-796.steps.ts`.

**Edited (per-issue importers; the specifier only):**
- `features/per-issue/step_definitions/feature-848.steps.ts` (lines 13, 14)
- `features/per-issue/step_definitions/feature-929.steps.ts` (line 24)
- `features/per-issue/step_definitions/feature-929-workflow.ts` (line 19)
- `features/per-issue/step_definitions/feature-933-boundary.steps.ts` (line 13)
- `features/per-issue/step_definitions/feature-933-remote.steps.ts` (line 17)
- `features/per-issue/step_definitions/feature-933-workflow.ts` (line 24)
- `features/per-issue/step_definitions/feature-959.steps.ts` (lines 22, 23)
- `features/per-issue/step_definitions/feature-959-boundary.ts` (lines 13, 14)
- `features/per-issue/step_definitions/feature-959-cron.steps.ts` (line 21, the closing line of a
  multi-line import)
- `features/per-issue/step_definitions/feature-959-pr-review.steps.ts` (line 18)
- `features/per-issue/step_definitions/feature-959-workflow.steps.ts` (lines 15, 18)
- `features/per-issue/step_definitions/feature-988-world.ts` (line 16)

**Edited (registry and docs):**
- `features/regression/vocabulary.md`: one new `(@label-routing)` section of 27 rows, inserted
  between the "Cancel Directive (@webhook)" section and the "Smoke processes (@subprocess)" section.
- `README.md`: one `labels/` line in the `features/regression/` tree, between `hashing/` and
  `multilang/` (around line 1177).

**Read-only references:**
- `.adw/coding_guidelines.md`: guidelines for the TypeScript touched in Task 9. Files stay under 300
  lines, no `any`. Comments state only ordering constraints and invariants, never issue numbers.
- `cucumber.js`: `paths` already covers `features/regression/**/*.feature`. The `import` order
  (`regression/step_definitions` → `regression/support` → `features/step_definitions` →
  `per-issue/step_definitions`) fixes the hook order. Its `TARGET_REPOS_DIR` pin keeps the janitor
  harmless. No edit.
- `features/regression/support/hooks.ts`:
  - the `@regression` `Before` (`setupMockInfrastructure`) and `After` (`runCleanup`,
    `teardownMockInfrastructure`);
  - the untagged guardrails stub;
  - `setDefaultTimeout(60_000)`;
  - the `@regression and (@subprocess or @webhook)` harness hook, which these rows must not trigger.
- `test/mocks/test-harness.ts`: `setupMockInfrastructure` saves, then overwrites, `CLAUDE_CODE_PATH`,
  `PATH`, `GH_TOKEN`, `GH_HOST`, `REAL_GIT_PATH` and `MOCK_*` (lines 120–167); it is idempotent.
  `teardownMockInfrastructure` restores what it saved. This is the basis of Task 9.
- `adws/core/environment.ts`: `resolveClaudeCodePath()` is keyed on the live `CLAUDE_CODE_PATH`;
  `clearClaudeCodePathCache()`. `adws/agents/claudeAgent.ts:117` resolves at spawn time.
- `features/regression/step_definitions/realCronProcess.ts`: `spawnRealCron` pins `GITHUB_PAT`, the
  App variables, `GH_TOKEN` and `CLAUDE_CODE_PATH`, then applies `extraEnv`. Also
  `killRealCronWorld`, `cronPidFilePath` and `waitForRealCron`.
- `features/regression/step_definitions/givenSteps.ts` (G18), `thenSteps.ts` (T22, T34) and
  `whenSteps.ts` (W16): the reused registered steps.
- `features/regression/step_definitions/webhookCronSteps.ts`: its `@webhook or @adw-961` hooks are
  the reason the descriptive tag must not be `@webhook`.
- `adws/triggers/perIssueScenarioSweep.ts`: walks feature files only, with the `startsWith('feature-N.')`
  sibling rule.
- `adws/promotion/vocabularyParser.ts` and `promotionScorer.ts`: the registry format. Headings match
  `^##\s+(Given|When|Then)\b`; rows have 5 pipe-separated columns with no literal `|` in a cell;
  Pattern is one of `subprocess`, `phase-import` or `mock-query`; `{string}` and `{int}` are the
  scorer's wildcards.
- `adws/core/promotionIssueBody.ts`: the template this issue's body came from, including the "do not
  rewrite relative imports" and "re-scope hooks" rules.
- The system under test, **not modified**: `adws/triggers/trigger_webhook.ts`
  (`dispatchWebhookEvent`), `adws/triggers/webhookHandlers.ts`, `adws/triggers/issueOpenedRouter.ts`,
  `adws/triggers/issueClosedUnblockRouter.ts`, `adws/triggers/trigger_cron.ts` (`checkAndTrigger`,
  label provisioning at cron start), `adws/triggers/cronIssueFilter.ts`,
  `adws/triggers/cronLabelEligibility.ts` and `adws/forge/adwLabelProvisioning.ts`.
- Precedent plans:
  - `specs/issue-923-adw-8d7505-feat-promote-910-sce-sdlc_planner-promote-910-pause-queue-regression.md`
    (closure relocation, repointing, baseline-delta proof);
  - `specs/issue-934-adw-0mdjtu-bug-promotion-sweep-sdlc_planner-fix-promotion-sweep-ramp-marker-tags.md`
    (`@adw-` tag removal and hook re-keying);
  - `specs/issue-961-adw-lgska4-bug-promote-the-orph-sdlc_planner-promote-webhook-cron-regression-feature.md`
    (in-process webhook dispatch under `@regression`).
- `specs/issue-932-adw-xs9x3g-bug-adw-none-wins-on-sdlc_planner-adw-none-gate-label-provisioning.md`:
  the original plan for the behaviour these scenarios pin.
- `.github/workflows/regression.yml`: the daily `--tags "@regression"` job, with `host` and `docker`
  legs at 30 minutes each.
- `.adw/commands.md` (validation commands) and `.github/adw.yml` (`unitTests` commented out, so unit
  tests are enabled).

### Relevant Documentation (matched via `.adw/conditional_docs.md`)
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: the manual promotion recipe. Closure moves with
  imports untouched, importers left behind are repointed, `@adw-` tags are dropped and hooks re-keyed
  to a descriptive tag. Also the `@regression` hooks.
- `app_docs/feature-9gjajh-bdd-per-issue.md`: owns `features/per-issue/**`, covering the 12 repointed
  files and the seven paths moved out.
- `app_docs/feature-9gjajh-promotion-system.md`: the promotion issue body and the meaning of the
  `@promotion-suggested-<date>` marker.
- `app_docs/feature-9gjajh-webhook-triggers.md`: the opt-out gate on the comment, dependency-closure
  and opened paths that §1 pins.
- `app_docs/feature-9gjajh-cron-triggers.md`: `adw:none` in the cron filter, takeover and merge hoist,
  and `provisionAdwLabels` at cron start (§1, §3).
- `app_docs/feature-9gjajh-github-api.md`: `provisionAdwLabels` / `ensureAdwLabelsExist` (§3).
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: the 14-day per-issue sweep and its
  sibling rule.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md`: the scenario-authoring skip gate. A
  `regression-promotion` issue gets no `feature-1003` scenario, so **this plan's Validation Commands
  are the proof**.
- `app_docs/feature-9gjajh-root-config.md`: owns `README.md`.

### New Files
- `features/regression/labels/`: a new subject subdirectory, kebab-case per the guidelines.
- Relocated paths, not new content:
  - `features/regression/labels/feature-932.feature`;
  - in `features/regression/step_definitions/`: `feature-932.steps.ts`, `feature-932-world.ts`,
    `feature-932-drive.steps.ts`, `feature-932-observe.steps.ts`, `feature-796.steps.ts` and
    `feature-820.steps.ts`.
- No new source module. The two small helpers of Task 9 go into the moved `feature-932-world.ts` and
  `feature-932-drive.steps.ts`.

## Implementation Plan
### Phase 1: Foundation
1. Record the baselines (whole-suite dry-run, `@regression`, `@adw-932`, and the per-issue features
   that share the harness), so every later number is judged as a delta.
2. `git mv` the feature and the six-file step-definition closure, touching no content.
3. Repoint the 16 stranded per-issue import specifiers.
4. Prove the moves are load-neutral before anything else changes: an identical dry-run, no module
   resolution error, and a clean `tsc`.

### Phase 2: Core Implementation
1. Retag the feature (`@regression @label-routing`, no `@adw-` tags, no promotion marker).
2. Correct the five stale description phrases.
3. Re-key #932's hooks to `@label-routing`.
4. Make the Claude recorder survive the `@regression` mock: put it on the path at dispatch time.
5. Register the 27 phrase patterns in the vocabulary registry.

### Phase 3: Integration
1. Add the README tree line.
2. Prove the 23 promoted scenarios green under `@regression` (twice).
3. Prove the full `@regression` gate gains them with no new non-pass, and the sharing per-issue
   features are unchanged.
4. Run the full validation gate and keep the commit scoped.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Record the pre-change baselines
- **Whole-suite dry-run:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`.
  Record the scenario and step totals and the undefined and ambiguous counts. Expect 0 ambiguous.
- **`@regression`:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`.
  Record both summary lines and the names of any scenario that does not pass. Those are
  pre-existing, and this change must not add to them.
- **#932's own rows:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-932" --format summary`.
  - Expect `23 scenarios (23 passed)` and `165 steps (165 passed)`.
  - If any row is red at baseline, **stop and report**. Promoting a red scenario would turn
    `@regression` red, and fixing #932's behaviour is out of scope here.
- **Per-issue features that share the harness:**
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-848 or @adw-929 or @adw-933 or @adw-959 or @adw-988" --format summary`.
  - Record the result per scenario. Some rows start real processes; allow several minutes.
  - This baseline, not a fixed number, is the bar Task 12 must match.
- **If `dev` has moved:** if a sibling promotion has landed since `401edfd7` and already moved part
  of this closure, see Notes and adjust Tasks 3–4 to what is still under `features/per-issue/`.

### 2. Move the feature file into `features/regression/labels/`
- `mkdir -p features/regression/labels`
- `git mv features/per-issue/feature-932.feature features/regression/labels/feature-932.feature`
- Change nothing in the file yet. Task 5 proves the moves alone are load-neutral, and the file still
  loads from its new path.

### 3. Move the step-definition closure
- Run:
  - `git mv features/per-issue/step_definitions/feature-932.steps.ts features/regression/step_definitions/feature-932.steps.ts`
  - `git mv features/per-issue/step_definitions/feature-932-world.ts features/regression/step_definitions/feature-932-world.ts`
  - `git mv features/per-issue/step_definitions/feature-932-drive.steps.ts features/regression/step_definitions/feature-932-drive.steps.ts`
  - `git mv features/per-issue/step_definitions/feature-932-observe.steps.ts features/regression/step_definitions/feature-932-observe.steps.ts`
  - `git mv features/per-issue/step_definitions/feature-796.steps.ts features/regression/step_definitions/feature-796.steps.ts`
  - `git mv features/per-issue/step_definitions/feature-820.steps.ts features/regression/step_definitions/feature-820.steps.ts`
- Edit no line of these six files in this task. Every specifier resolves unchanged from the new
  directory:
  - `./feature-796.steps.ts` and `./feature-932-world.ts` (they move together);
  - `../../regression/step_definitions/realCronProcess.ts`;
  - `../../../adws/…`.

  `fileURLToPath(import.meta.url)` plus `'../../..'` still lands on the checkout root.
- Keep the file names. Renaming would force rewriting the moved files' relative imports, which the
  issue forbids. The names follow the `feature-537`/`729`/`902`/`910`/`911` precedent in the same
  directory, and `git log --follow` history stays intact.
- Move nothing else. The `feature-848`, `929*`, `933*`, `959*` and `988*` files belong to features
  that are not being promoted.

### 4. Repoint the per-issue step files that import a moved module
- Change exactly these 16 specifiers and nothing else: no named binding, comment or prose.

  | File (`features/per-issue/step_definitions/`) | Line | From | To |
  |---|---|---|---|
  | `feature-848.steps.ts` | 13 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |
  | `feature-848.steps.ts` | 14 | `./feature-820.steps.ts` | `../../regression/step_definitions/feature-820.steps.ts` |
  | `feature-929.steps.ts` | 24 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |
  | `feature-929-workflow.ts` | 19 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |
  | `feature-933-boundary.steps.ts` | 13 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |
  | `feature-933-remote.steps.ts` | 17 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |
  | `feature-933-workflow.ts` | 24 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |
  | `feature-959.steps.ts` | 22 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |
  | `feature-959.steps.ts` | 23 | `./feature-932-world.ts` | `../../regression/step_definitions/feature-932-world.ts` |
  | `feature-959-boundary.ts` | 13 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |
  | `feature-959-boundary.ts` | 14 | `./feature-932-world.ts` | `../../regression/step_definitions/feature-932-world.ts` |
  | `feature-959-cron.steps.ts` | 21 | `./feature-932-world.ts` | `../../regression/step_definitions/feature-932-world.ts` |
  | `feature-959-pr-review.steps.ts` | 18 | `./feature-932-world.ts` | `../../regression/step_definitions/feature-932-world.ts` |
  | `feature-959-workflow.steps.ts` | 15 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |
  | `feature-959-workflow.steps.ts` | 18 | `./feature-932-world.ts` | `../../regression/step_definitions/feature-932-world.ts` |
  | `feature-988-world.ts` | 16 | `./feature-796.steps.ts` | `../../regression/step_definitions/feature-796.steps.ts` |

- Verify that `grep -rnE "['\"]\./feature-(796|820|932)" features/per-issue features/step_definitions features/support`
  prints nothing. That covers static and dynamic imports.
- Leave prose that mentions these files by name as it is: the `feature-848.steps.ts` header and the
  `feature-848.feature` and `feature-959.feature` descriptions. The names did not change, and those
  files are swept with their features.

### 5. Prove the relocation is load-neutral before changing any content
- Re-run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`. The totals and the
  undefined count must equal Task 1's, with 0 ambiguous and no `ERR_MODULE_NOT_FOUND` or other load
  error.
- Run `bunx tsc --noEmit --incremental false`. It must pass; the root `tsconfig.json` includes
  `features/**`, so this checks every moved and repointed import.
- If either fails, a specifier from Task 4 was missed. Fix it before going on.

### 6. Retag the moved feature
- In `features/regression/labels/feature-932.feature`, change line 1:
  - from `@adw-932 @adw-xs9x3g-bug-adw-none-wins-on @promotion-suggested-2026-10-04`
  - to `@regression @label-routing`
- Delete each of the 22 lines that consist only of `  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on`, one
  above every `Scenario:` and `Scenario Outline:` header (original lines 275, 284, 292, 301, 309, 317,
  324, 332, 345, 365, 375, 392, 406, 415, 423, 436, 448, 462, 480, 497, 515 and 519).
- Do **not** add `@regression` or `@label-routing` at scenario level; the feature-level tags are
  inherited.
- Keep the `# ── §N` banners and the `Background:`. This is a relocation: the regression copies of
  910 and 911 still carry their banners, and banner removal is a separate chore (as `8cde1592` was).
- Verify:
  - `grep -nE '^\s*@' features/regression/labels/feature-932.feature` prints only `1:@regression @label-routing`;
  - `grep -nE '^\s*@.*@adw-' features/regression/labels/feature-932.feature` prints nothing.

### 7. Correct the description where it names the old hook tag or the old harness path
Make exactly these five edits; the line numbers are the original's and lie above the deleted tag
lines. Change nothing else in the description, and rewrap only the touched sentence if it overruns
its neighbours.
- Line 152: `features/per-issue/step_definitions/feature-796.steps.ts` →
  `features/regression/step_definitions/feature-796.steps.ts`.
- Lines 173–174: "For every `@adw-932` row" → "For every `@label-routing` row".
- Line 230: "in an `@adw-932` `After` hook" → "in a `@label-routing` `After` hook".
- Line 234: "Scope every hook to `@adw-932`." → "Scope every hook to `@label-routing`."
- Lines 257–258: "Its world and its cleanup hook belong to `@adw-911`, so an `@adw-932` row would
  leave its cron running" → "Its world and its cleanup hook belong to `@pause-queue-ownership`, so a
  `@label-routing` row would leave its cron running". W-PQ5's hooks have been keyed on
  `@adw-911 or @pause-queue-ownership` since the #934 re-keying.
- Then `grep -n '@adw-932' features/regression/labels/feature-932.feature` prints nothing. Prose
  mentions of other features' tags, such as "`@adw-796` and `@adw-820` hooks do not fire for these
  rows", are still true and are not tags.

### 8. Re-key the hooks in the moved `feature-932.steps.ts`
- `Before({ tags: '@adw-932' }, …)` → `Before({ tags: '@label-routing' }, …)`
- `After({ tags: '@adw-932' }, …)` → `After({ tags: '@label-routing' }, …)`
- Verify that `grep -rn "@adw-932" features/regression/step_definitions/` prints nothing.
- Leave the `@adw-796` hooks in `feature-796.steps.ts` and the `@adw-820` hooks in `feature-820.steps.ts`
  untouched. They are keyed on tags no feature carries (neither feature exists any more), not on the
  tags this promotion removes. Pruning them is a separate cleanup.

### 9. Keep the Claude CLI recorder effective under the `@regression` hooks
- **`feature-932-world.ts`:**
  - Add `export function claudeShadowPath(): string { return path.join(s.dir, 'claude'); }` next to
    `bunxBinDir()` and `ghBinDir()`.
  - Make `installClaudeShadow()` write to `claudeShadowPath()`. It keeps returning the path.
  - Change no other export's behaviour. Feature-959 imports `installBunxShadow`, `resetLocalState`,
    `readIfExists`, `restoreFile`, `restoreEnv`, `requireBoundary`, `requireFixture`,
    `staleTimestamp`, `launchesFor`, `describeLaunches`, `waitFor`, `bunxBinDir`, `LAUNCH_WAIT_MS`
    and `s`.
- **`feature-932.steps.ts` `Before`:** replace
  ```ts
  process.env['CLAUDE_CODE_PATH'] = installClaudeShadow();
  clearClaudeCodePathCache();
  ```
  with `installClaudeShadow();`. Keep `s.savedClaudeCodePath = process.env['CLAUDE_CODE_PATH'];`
  just above it. Keep the `After`'s restore and its `clearClaudeCodePathCache()`, which keeps that
  import used.
- **`feature-932-drive.steps.ts`:**
  - Add `claudeShadowPath` to the existing `./feature-932-world.ts` import.
  - Add `import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';`, the
    specifier `feature-932.steps.ts` already uses.
  - Next to `shadowBunx()`, add:
    ```ts
    /** The `@regression` Before runs after this feature's and points CLAUDE_CODE_PATH at the plain stub, so the recorder goes on only at dispatch. */
    function shadowClaude(): void {
      process.env['CLAUDE_CODE_PATH'] = claudeShadowPath();
      clearClaudeCodePathCache();
    }
    ```
  - Call `shadowClaude()` right after `shadowBunx()` in `dispatchWebhook()` and in the
    `the cron tick runs once from that boundary` step. These are the only in-process paths that can
    classify. §3's cron processes get the stub from `spawnRealCron`, and §5 never classifies.
- **No specifier is rewritten.** Every existing import specifier stays byte-identical; one import
  gains a named binding and one import line is added.
- **The save/restore trace balances.** P0 and C0 are the pre-scenario `PATH` and `CLAUDE_CODE_PATH`.
  1. #932's `Before` saves P0 and C0 and writes the shadow files.
  2. The `@regression` `Before` saves {P0, C0} and sets the stub and the git-mock `PATH`.
  3. The When step sets `PATH = bunx:P0` and `CLAUDE_CODE_PATH = wrapper`.
  4. The `@regression` `After` runs first of the two (After hooks run in reverse definition order)
     and restores P0 and C0.
  5. #932's `After` restores P0 and C0 again and kills the real cron after the mock server has
     stopped. That is harmless, as with W-PQ5.
- **The positive control.** The two T-LR4 rows (9321, 9323) can pass only when the recorder is on
  the path. Their passing in Task 12 proves the five T-LR5 assertions are no longer vacuous.

### 10. Register the phrases in `features/regression/vocabulary.md`
- Insert the section below between the end of the "Cancel Directive (@webhook)" section (after its
  reuse paragraph and `---`) and `## Given/When/Then — Smoke processes (@subprocess)`, followed by its
  own `---` separator. Inserting there keeps it beside the other webhook and cron rows, and away from
  the end of the file, where concurrent promotions are likely to append.
- Rules:
  - every phrase is byte-identical to its step definition's cucumber expression, unescaped
    (`boundary's`, not `boundary\'s`);
  - no cell contains a literal `|`;
  - the Pattern value is one of `subprocess`, `phase-import` or `mock-query`;
  - G18, T22, W16 and T34 are not duplicated;
  - no other section is touched.
- Section text:

```markdown
## Given/When/Then — ADW Labels: Opt-Out, Routing and Provisioning (@label-routing)

These phrases drive the trigger paths in-process (phase-import pattern) against a recording launch
boundary. It is a real `LaunchBoundary` built by `buildLaunchBoundary` over throwaway directories.
Its issue tracker, code host and board manager are recording fakes that answer from the issues a
scenario seeds and log every call. The webhook rows call the real exported `dispatchWebhookEvent`
with that boundary as the minted event boundary; the cron rows call the real exported
`checkAndTrigger(boundary)`. Nothing they launch runs. A `bunx` shadow put first on `PATH` records
each orchestrator launch's argv and exits at once. A recording wrapper around
`test/mocks/claude-cli-stub.ts` goes on `CLAUDE_CODE_PATH` at dispatch time, after the `@regression`
hooks have pointed it at the plain stub. Two rows start one real
`adws/triggers/trigger_cron.ts --target-repo` process with a recording `gh` shadow first on its
`PATH`. The fixture repositories (`adw-fixture/…-932`) do not exist, so a call that escapes the
harness fails fast.

Every assertion targets a runtime artefact: the launches the `bunx` shadow recorded, the Claude CLI
invocations the wrapper recorded, the recording providers' call log, the `gh label create`
invocations the `gh` shadow recorded, or the cron process's output. No step reads, greps or parses a
source file, satisfying the Rot-Detection Rubric.

The definitions live in `feature-932.steps.ts` (hooks and Givens), `feature-932-drive.steps.ts` (the
dispatches and the tick), `feature-932-observe.steps.ts` (the Thens and the real cron) and
`feature-932-world.ts` (recorders and shared state). They build on the recording boundary of
`feature-796.steps.ts` (G-LR1, T-LR6 to T-LR9) and the tracker Givens of `feature-820.steps.ts`
(G-LR2, G-LR3, G-LR5). Around every scenario the `@label-routing` hooks reset the shared world and
save, clear and restore `GITHUB_WEBHOOK_SECRET`, `agents/.auth_gate` and `agents/paused_queue.json`.
Afterwards they kill the real cron and remove the cron registrations, spawn locks and
`agents/<adwId>/` state the scenario created.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-LR1 | `a launch boundary for the repository {string} whose providers record every call` | Builds a real launch boundary (`buildLaunchBoundary`) for the named repository over throwaway framework and target-repos directories. Its issue tracker, code host and board manager are recording fakes that answer from what the scenario seeds and log every call they receive | phase-import | recording providers' call log |
| G-LR2 | `issue {int} in the recording tracker carries the label {string}` | Seeds issue N with exactly that label. The recording tracker serves it to `fetchIssue`, `fetchLabels` and `listIssues`, and the W-LR webhook payloads carry it | mock-query | recording tracker state |
| G-LR3 | `issue {int} in the recording tracker carries the labels {string} and {string}` | As G-LR2, with exactly those two labels | mock-query | recording tracker state |
| G-LR4 | `issue {int} in the recording tracker carries the labels {string}, {string} and {string}` | As G-LR2, with exactly those three labels | mock-query | recording tracker state |
| G-LR5 | `issue {int} in the recording tracker is titled {string}` | Seeds issue N's title, served by `fetchIssue` and `listIssues` and carried by the webhook payloads | mock-query | recording tracker state |
| G-LR6 | `the body of issue {int} in the recording tracker reads:` | Seeds issue N's body from the doc string, served by `fetchIssue` and `listIssues` and carried by the webhook payloads. A `Blocked by #M` line makes N a dependent of M | mock-query | recording tracker state |
| G-LR7 | `issue {int} in the recording tracker is in state {string}` | Seeds issue N's state, served by `getIssueState` and `fetchIssue`. `listIssues`, an open-issue listing, leaves out an issue in state `CLOSED` | mock-query | recording tracker state |
| G-LR8 | `issue {int} has an earlier ADW workflow under adw id {string} recorded at workflowStage {string} running {string}` | Adds to issue N a comment that names the adwId as ADW's workflow comments do (`**ADW ID:**` and the adwId in backticks), with no stage heading. `fetchComments`, `fetchIssue` and `listIssues` all serve it. Also writes the adwId's top-level state file `agents/<adwId>/state.json`: the issue, the stage, the orchestrator script and the boundary's repository, with no phases, pid or branch name. The adwId is lowercase letters, digits and hyphens; its state and log directories are removed after the scenario | phase-import | recording tracker state + top-level state file artefact |
| G-LR9 | `the forge refuses to create labels` | Makes the `gh` shadow that W-LR6 installs record every `gh label create` and exit 1 with an HTTP 403 message, as a forge that refuses label creation does | subprocess | `gh` shadow behaviour |
| W-LR1 | `the webhook dispatches the opening of issue {int} from that boundary` | Dispatches an unsigned `issues` `opened` event through the real `dispatchWebhookEvent`, with the boundary as the minted event boundary. The event names the boundary's repository and carries the issue's seeded title, body and labels. The test process is first registered as the repository's running cron, so the webhook launches none, and the `bunx` and Claude CLI recorders go on `PATH` and `CLAUDE_CODE_PATH`. Fails unless the webhook answers `processing`. Then waits (bounded, 20 s) until the call log and the recorders have been quiet for 750 ms with no classification running | phase-import | launch records + recorded Claude CLI invocations + recording providers' call log |
| W-LR2 | `the webhook dispatches the opening of issue {int} from that boundary with no labels in the event` | As W-LR1, but the event's label list is empty while the tracker still holds the seeded labels: a label applied just after the issue was opened | phase-import | launch records + recorded Claude CLI invocations + recording providers' call log |
| W-LR3 | `the webhook dispatches a {string} comment on issue {int} from that boundary` | As W-LR1 for an `issue_comment` `created` event whose comment body is the given text | phase-import | launch records + recorded Claude CLI invocations + recording providers' call log |
| W-LR4 | `the webhook dispatches the closing of issue {int} from that boundary` | As W-LR1 for an `issues` `closed` event, which re-evaluates the seeded issues whose body names the closed issue as a blocker | phase-import | launch records + recorded Claude CLI invocations + recording providers' call log |
| W-LR5 | `the cron tick runs once from that boundary` | Dates every seeded issue's creation and last update a day back, past the cron's grace period. Puts the recorders in place, runs the real exported `checkAndTrigger(boundary)` once, and waits for the handling to settle as W-LR1 does. The tick's pause-queue scan sees an empty queue, which is saved and restored around the scenario | phase-import | launch records + recorded Claude CLI invocations + recording providers' call log |
| W-LR6 | `a cron trigger process is launched with --target-repo {string}` | Starts a real `bunx tsx adws/triggers/trigger_cron.ts --target-repo <repo>` process (`spawnRealCron`) with a throwaway `TARGET_REPOS_DIR` and a recording `gh` shadow first on its `PATH`. The shadow answers `gh auth token` with a fake token, records every `gh label create`, and exits 0 for everything else. Fails if the `bunx` recorder is on `PATH`, since it would swallow the launch. The process group is killed after the scenario | subprocess | recorded `gh` invocations + process output |
| T-LR1 | `no ADW run was started for issue {int}` | Asserts the `bunx` recorder holds no launch whose argument after the orchestrator script is N. Read after a W-LR dispatch or tick has settled | mock-query | launch records |
| T-LR2 | `exactly one ADW run was started for issue {int}` | Waits (bounded, 10 s) for a launch of issue N, then asserts the recorder holds exactly one | mock-query | launch records |
| T-LR3 | `the ADW run started for issue {int} runs the orchestrator {string}` | Asserts issue N's recorded launch runs the named script, compared relative to the checkout root | mock-query | launch records |
| T-LR4 | `the issue classifier was consulted for issue {int}` | Waits (bounded, 10 s) until the Claude CLI recorder holds an invocation whose prompt, its last argument, names `/classify_issue` and `#N:` | mock-query | recorded Claude CLI invocations |
| T-LR5 | `the issue classifier was not consulted for issue {int}` | Asserts the Claude CLI recorder holds no such invocation | mock-query | recorded Claude CLI invocations |
| T-LR6 | `the boundary's issue tracker recorded no comment` | Asserts the call log holds no `commentOnIssue` call | mock-query | recording providers' call log |
| T-LR7 | `the boundary's issue tracker recorded a comment on issue {int}` | Asserts the call log holds a `commentOnIssue` call for issue N | mock-query | recording providers' call log |
| T-LR8 | `the recorded comment on issue {int} contains {string}` | Asserts the body of issue N's recorded `commentOnIssue` call contains the text | mock-query | recording providers' call log |
| T-LR9 | `the boundary's providers recorded no label applied to issue {int}` | Asserts the call log holds no `applyLabel` or `addLabel` call for issue N | mock-query | recording providers' call log |
| T-LR10 | `the repository {string} has each of these labels:` | Waits (bounded, 20 s) until the `gh` shadow has recorded `gh label create '<label>' --repo <repo> … --force` for every row of the one-column `label` table | subprocess | recorded `gh` invocations |
| T-LR11 | `the forge was asked to create each of these labels on the repository {string}:` | The same wait and record as T-LR10, whether or not the shadow refused the creations (G-LR9) | subprocess | recorded `gh` invocations |
| T-LR12 | `the cron trigger process launched with --target-repo {string} completes its first poll tick` | Asserts the cron W-LR6 launched is the one for that repository. Waits (bounded) for its startup line `CRON trigger (backlog sweeper) started`, then for its first `POLL:` or `checkAndTrigger: tick failed` line | subprocess | log stream (process stdout) |

This scenario also reuses already-registered phrases, so they need no new rows: `the ADW codebase is
checked out` (G18, Background), T22, and the generic W16/T34.
```

- Verify:
  - `grep -cE "^\| (G-LR|W-LR|T-LR)[0-9]+ \|" features/regression/vocabulary.md` prints `27`;
  - `grep -cE "^## Given/When/Then — " features/regression/vocabulary.md` is one more than before.

### 11. Add the new subdirectory to the README tree
- In `README.md`'s `features/regression/` tree, insert one line between the `hashing/` and
  `multilang/` entries. Align its `#` with the neighbours (`labels/` plus nine spaces):
  `│   ├── labels/         # Regression scenarios covering ADW labels (#932): adw:none starting no run on any spawn path, conflicting classification labels, the label catalogue a repository's cron provisions at start, and routing a major-upgrade issue by its label`
- Make no other README edit (see Notes on the README diff that was already in the worktree).

### 12. Prove the promoted scenarios green, the suite unambiguous, and the sharing features unchanged
- **Whole-suite dry-run:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`.
  The totals and undefined count equal Task 1's, with 0 ambiguous. Moving and retagging change no
  count.
- **Promoted scenarios:**
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @label-routing" --format summary`.
  - Expect `23 scenarios (23 passed)` and `165 steps (165 passed)`.
  - Run it **twice**. The rows use real timers, a settle window and two real cron processes, and a
    flake must surface here rather than in CI.
  - The T-LR4 rows (9321, 9323) passing proves the Claude recorder is effective (Task 9).
- **Old tag selects nothing:**
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-932" --format summary` reports
  `0 scenarios`.
- **Full `@regression` gate:**
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`.
  - Expect Task 1's `@regression` totals plus `23 scenarios` and `165 steps`, all 23 new ones
    passed, and no scenario failing, pending or undefined that was not already so in Task 1.
  - If Task 1 was all green, the run must exit 0. Otherwise judge it by the summary delta and name
    the pre-existing non-passes in the PR.
- **If a §3 row fails only under `@regression`:** the `waitForRealCron` error prints the cron's
  stdout and stderr. The likely suspects are the mock's `GH_HOST` and the git mock on the cron's
  `PATH`. Fix it inside the moved #932 step files, for example by blanking the offending variable in
  the `extraEnv` passed to `spawnRealCron`. Never fix it in `hooks.ts` or `test/mocks/test-harness.ts`,
  which every regression scenario shares.
- **Per-issue features that share the harness:**
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-848 or @adw-929 or @adw-933 or @adw-959 or @adw-988" --format summary`.
  - Every scenario must have the same result as in Task 1.
  - A newly failing scenario means a repointed import, or a change to a `feature-932-world.ts`
    export that feature-959 relies on. Stop and diagnose before going on.
- **No residue:** afterwards, `git status --porcelain` shows no new untracked artefact, and none of
  these prints anything:
  - `ls agents/cron 2>/dev/null | grep -- '-932'`;
  - `ls agents 2>/dev/null | grep '^none932-'`;
  - `ls agents/spawn_locks 2>/dev/null | grep -E '93(0[1-9]|1[0-9]|2[0-9])'`.

  `agents/.auth_gate` and `agents/paused_queue.json` are as they were before the run.

### 13. Confirm the old paths are gone and nothing dangles
- Old paths are gone. This loop prints nothing:
  `for p in features/per-issue/feature-932.feature features/per-issue/step_definitions/feature-932.steps.ts features/per-issue/step_definitions/feature-932-world.ts features/per-issue/step_definitions/feature-932-drive.steps.ts features/per-issue/step_definitions/feature-932-observe.steps.ts features/per-issue/step_definitions/feature-796.steps.ts features/per-issue/step_definitions/feature-820.steps.ts; do test ! -e "$p" || echo "STILL PRESENT: $p"; done`
- `ls features/per-issue/step_definitions | grep -E '^feature-(932|796|820)'` prints nothing.
- No regression feature carries an `@adw-` tag:
  `grep -rlE '^\s*@.*@adw-' features/regression --include='*.feature'` prints nothing (the #934 check).
- After staging, `git diff --cached -M --name-status` lists:
  - `feature-796.steps.ts`, `feature-820.steps.ts` and `feature-932-observe.steps.ts` as pure renames
    (`R100`);
  - `feature-932.steps.ts`, `feature-932-world.ts`, `feature-932-drive.steps.ts` and the feature
    file as renames with small edits (`R0xx`);
  - the 12 per-issue importers as modified.

### 14. Unit-test gate
- No unit test is created; see Testing Strategy. Run `bun run test:unit` and confirm it is green.
  Vitest collects only `adws/**/__tests__/**/*.test.ts` and `test/mocks/__tests__/**/*.test.ts`, so
  nothing moved under `features/` can affect it.

### 15. Keep the commit scoped
- Do not `git add -A`. The seven `git mv` renames are already staged. Stage only:
  - the edited moved files: `features/regression/labels/feature-932.feature`, and in
    `features/regression/step_definitions/` the files `feature-932.steps.ts`,
    `feature-932-world.ts` and `feature-932-drive.steps.ts`;
  - the 12 repointed per-issue files from Task 4;
  - `features/regression/vocabulary.md`;
  - `README.md`;
  - this spec.
- `tsconfig.tsbuildinfo`, `agents/` and `logs/` are gitignored. Confirm `git status --porcelain`
  shows nothing unintended.

### 16. Run the Validation Commands
- Execute every command in **Validation Commands** and confirm each meets its stated expectation,
  with zero regressions.

## Testing Strategy
### Unit Tests
`.github/adw.yml` leaves `unitTests` commented out, so unit tests are enabled and this subsection
applies. **No new unit test is warranted.**
- The change moves BDD files, repoints 16 import specifiers, re-keys two hooks, adds two small
  step-definition helpers and edits a Markdown registry. It adds no `adws/**` production logic, and
  no pure logic that a Vitest unit test could pin.
- The coding guidelines make BDD scenarios ADW's behavioural proof. Here that proof is the 23
  promoted scenarios passing under `@regression` (Task 12). The T-LR4 rows also serve as the
  positive control for the Task 9 helper.
- `bun run test:unit` must stay green as a regression guard (Task 14).

### Edge Cases
- **A dangling sibling import aborts every run.** One missed `./feature-796|820|932…` specifier stops
  Cucumber loading all support code, per-issue runs included. Three checks guard it: Task 4's grep,
  Task 5's load-neutral dry-run, and `tsc` over `features/**`.
- **The Claude recorder is bypassed and negatives turn vacuous.** Without Task 9, the
  `@regression` mock's `CLAUDE_CODE_PATH` wins. "Consulted" rows fail and "not consulted" rows pass
  for the wrong reason. The T-LR4 rows are the positive control.
- **Hook order.** #932's hooks now run before the `@regression` `Before`, and after the
  `@regression` `After`.
  - Env saves and restores balance (Task 9's trace).
  - #932's `After` kills the real cron after the mock server has stopped. That is harmless; W-PQ5
    behaves the same.
  - No hook a per-issue feature sees changes.
- **The `@regression` environment for the real cron (§3).** `GH_HOST` points at the mock and the git
  mock is on the cron's `PATH`. W-PQ5 is the precedent that this works. The diagnosis path is in
  Task 12.
- **Collisions in a combined run.**
  - Issue numbers 9301–9329 and the `adw-fixture/*-932` repositories are unique in the regression
    suite.
  - The webhook's 60 s duplicate window and the cron's `processedSpawns` are process-wide, and they
    stay harmless only while that holds.
  - The five in-process ticks stay well under the janitor's fifteenth tick.
- **Feature-959 depends on the moved world.** Its five step files import `feature-932-world.ts` and
  `feature-796.steps.ts`. Task 9 adds an export and changes no existing one, and Task 12's per-issue
  run proves it.
- **Dead harness hooks.** The moved `@adw-796` and `@adw-820` hooks match no scenario before or
  after; they are left alone.
- **The promotion marker.** `@promotion-suggested-2026-10-04` is dropped. It only exempts a
  per-issue file from the sweep, and the promotion sweep lists only `features/per-issue/`. If the
  sweep re-stamps the per-issue file on `dev` before this merges, git's rename detection can carry
  the stamp into the regression copy; drop it there too.
- **Prose that is not a tag.** Description text that mentions `@adw-796`, `@adw-820` or other
  features' tags is not a tag line. The `^\s*@.*@adw-` check reads only lines that start with `@`.
- **Cucumber expressions.** The `--target-repo` phrases are literal text before `{string}`, exactly
  as defined. A registered phrase that contains `/` would need escaping only in a step definition,
  not in the vocabulary.
- **Build info.** Use `--incremental false` for ad-hoc `tsc` runs. T22 already passes it, and the
  Docker leg's checkout is a writable copy.
- **Runtime.** The promoted rows add roughly two to three minutes to the daily regression job: two
  real crons of up to 20 s each, the T22 and guard backstops, and the settle windows. Each leg has a
  30-minute timeout. Record the measured duration from Task 12 in the PR.

## Acceptance Criteria
- **Feature file.**
  - `features/regression/labels/feature-932.feature` exists, and its only tag line is line 1,
    exactly `@regression @label-routing`.
  - It carries no `@adw-` tag and no `@promotion-suggested-` marker.
  - Its scenarios, steps, Background and banners are unchanged; only the five Task 7 phrases
    differ in the description.
- **Step files.**
  - These six files exist under `features/regression/step_definitions/`: `feature-932.steps.ts`,
    `feature-932-world.ts`, `feature-932-drive.steps.ts`, `feature-932-observe.steps.ts`,
    `feature-796.steps.ts` and `feature-820.steps.ts`.
  - Every pre-existing import specifier in them is byte-identical.
  - `feature-932.steps.ts`'s hooks are keyed on `@label-routing`.
- **Old paths.** `features/per-issue/feature-932.feature` and every `feature-932*`, `feature-796*` and
  `feature-820*` file under `features/per-issue/step_definitions/` no longer exist.
- **Importers.** No file under `features/` imports a moved module through a `./` sibling specifier.
- **`@regression` run.**
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` runs the 23 moved scenarios,
    and all pass (`--tags "@regression and @label-routing"` reports `23 scenarios (23 passed)` and
    `165 steps (165 passed)`, twice).
  - The full gate adds no failing, pending, undefined or ambiguous scenario to the Task 1 baseline.
- **No ambiguity or undefined steps introduced.** The whole-suite dry-run totals and undefined count
  equal the baseline, with 0 ambiguous.
- **Sharing per-issue features unchanged.** `@adw-848 or @adw-929 or @adw-933 or @adw-959 or @adw-988`
  gives every scenario the same result as at baseline.
- **Classifier evidence is real.** The two "consulted" rows pass, so the five "not consulted"
  assertions are not vacuous.
- **Vocabulary.** `features/regression/vocabulary.md` has one new `(@label-routing)` section with 27
  rubric-compliant rows (G-LR1–G-LR9, W-LR1–W-LR6, T-LR1–T-LR12). G18, T22, W16 and T34 are reused,
  not duplicated.
- **README.** The `features/regression/` tree gains exactly one `labels/` line.
- **Gates.** These all pass: `bun run lint`, `bunx tsc --noEmit`,
  `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `bun run build`,
  `bun run lint:git-guard` and `bun run lint:docs-index`.
- **Governance.** The PR waits for human approval (`hitl`). Its description explains why the change
  goes beyond the issue's two-file recipe: the closure move, the 16 repoints and the Claude-recorder
  fix.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `for p in features/per-issue/feature-932.feature features/per-issue/step_definitions/feature-932.steps.ts features/per-issue/step_definitions/feature-932-world.ts features/per-issue/step_definitions/feature-932-drive.steps.ts features/per-issue/step_definitions/feature-932-observe.steps.ts features/per-issue/step_definitions/feature-796.steps.ts features/per-issue/step_definitions/feature-820.steps.ts; do test ! -e "$p" || echo "STILL PRESENT: $p"; done`:
  the old paths are gone. Expect no output.
- `test -e features/regression/labels/feature-932.feature && for f in feature-932.steps.ts feature-932-world.ts feature-932-drive.steps.ts feature-932-observe.steps.ts feature-796.steps.ts feature-820.steps.ts; do test -e "features/regression/step_definitions/$f" || echo "MISSING: $f"; done`:
  the relocation landed. Expect no output.
- `grep -nE '^\s*@' features/regression/labels/feature-932.feature`: expect exactly
  `1:@regression @label-routing`.
- `grep -rlE '^\s*@.*@adw-' features/regression --include='*.feature'`: no regression feature carries
  an `@adw-` tag. Expect no output.
- `grep -rn "@adw-932" features/regression`: neither the feature nor the step definitions still key
  on the old tag. Expect no output.
- `grep -rnE "['\"]\./feature-(796|820|932)" features/per-issue features/step_definitions features/support`:
  no stale sibling import. Expect no output.
- `grep -cE "^\| (G-LR|W-LR|T-LR)[0-9]+ \|" features/regression/vocabulary.md`: expect `27`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: the same totals and
  undefined count as the Task 1 baseline, 0 ambiguous, exit status as at baseline.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-932" --format summary`: expect
  `0 scenarios`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @label-routing" --format summary`:
  the promoted scenarios. Expect `23 scenarios (23 passed)` and `165 steps (165 passed)`, exit 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the issue's acceptance gate
  (`.adw/commands.md`'s Run Regression Scenarios). Expect the Task 1 totals plus 23 scenarios and 165
  steps, all new ones passed, and no new failed, pending, undefined or ambiguous scenario.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-848 or @adw-929 or @adw-933 or @adw-959 or @adw-988" --format summary`:
  the per-issue features sharing the relocated harness. Every scenario has the same result as at
  baseline.
- `bun run lint`: ESLint passes over the edited step files and the repointed importers.
- `bunx tsc --noEmit`: the root type-check passes. It includes `features/**`, so it covers every
  moved and repointed import.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run test:unit`: the unit suite is green, with zero regressions.
- `bun run build`: the build succeeds.
- `bun run lint:git-guard`: the git/gh guard is green; it exempts `features/`.
- `bun run lint:docs-index`: the living-docs index stays clean. The `features/regression/**` and
  `features/per-issue/**` ownership globs cover the moved files.
- `git status --porcelain`: only the intended paths are staged or modified (apart from the README
  note below).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) apply to the TypeScript changed in Task 9:
  strict types and no `any`; small named helpers that mirror the existing `bunxBinDir`/`shadowBunx`
  pair; and one comment, on `shadowClaude`, that states the ordering constraint and cites no issue
  number. The moved `feature-796.steps.ts` (1051 lines) and `feature-820.steps.ts` (905 lines) exceed
  the 300-line guideline. They move as they are, since the issue forbids rewriting them. Splitting or
  pruning them is a separate chore.
- **No new library** is needed, so `bun add` is not run.
- **Why this goes beyond the issue's two-file recipe** (for the PR description and the human
  approver):
  - The issue's step-def list comes from the sweep's `startsWith('feature-932.')` sibling rule. That
    rule misses `feature-932-world.ts`, `-drive.steps.ts` and `-observe.steps.ts`, and knows nothing
    of the harness the scenario borrows from `feature-796.steps.ts` and `feature-820.steps.ts`.
  - Moving the closure is the only way to keep "do not rewrite relative imports" and also not leave
    a regression scenario depending on `features/per-issue/`. It is the rule in
    `app_docs/feature-9gjajh-bdd-regression-suite.md` and the #923 precedent.
  - The Claude-recorder change is what makes the classifier assertions meaningful under the
    `@regression` hooks.
- **Sibling promotions in flight.** Worktrees for #999–#1002 and #1004 started from the same base
  (`401edfd7`). The sweep marked 908, 909, 912, 930, 932, 936, 937 and 959 on 2026-10-04.
  - None of the in-flight ones imports a file this closure moves.
  - A later feature-959 promotion will find `feature-932-world.ts` and `feature-796.steps.ts`
    already under `features/regression/step_definitions/`.
  - If a sibling lands first and has already moved part of this closure (for example
    `feature-796.steps.ts`), skip that file's `git mv` and repoint against where it now lives.
  - The vocabulary section goes before "Smoke processes" and the README line between `hashing/` and
    `multilang/`, so that edits other promotions append at the end of the file are less likely to
    conflict with them.
- **README.md already differed at the start of this workflow.** It carried an unrelated, uncommitted
  tree-listing change (new `adws/core/__tests__` entries) that is present in every sibling worktree.
  Do not revert or extend it. Add only the `labels/` line, and if the unrelated hunk ends up in the
  commit, say so in the PR description.
- **Documentation follow-up.** ADW's document phase should update
  `app_docs/feature-9gjajh-bdd-regression-suite.md` with:
  - the `labels/` subdirectory and the `@label-routing` feature;
  - the recording-boundary harness (`feature-796/820/932*`) now owned by the regression suite;
  - the rule that a recorder installed in a scenario's `Before` must be re-asserted after the
    `@regression` `Before`, which runs later and overwrites `CLAUDE_CODE_PATH`, `PATH`, `GH_TOKEN`
    and `GH_HOST`.

  `app_docs/feature-9gjajh-bdd-per-issue.md` loses `feature-932` and the 796 and 820 step files.
  This plan does not edit `app_docs/` or `.adw/conditional_docs.md`.
- **Out of scope:**
  - rewriting the long #932 description, beyond the five stale phrases;
  - stripping its `# ──` banners;
  - pruning the dead `@adw-796` and `@adw-820` hooks and the phrases of the moved harness files that
    no live feature uses;
  - promoting features 848, 929, 933, 959 or 988.
