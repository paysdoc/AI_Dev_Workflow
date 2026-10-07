# Feature: Promote #992's web-repository Playwright-project scenarios into the @regression suite

## Metadata
issueNumber: `1032`
adwId: `ljufnl-feat-promote-992-sce`
issueJson: `{"number":1032,"title":"feat: promote #992 scenario into the @regression suite","body":"Promotes: feature-992\n\nDirect relocation (matches #734 (score: 4)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-992` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-992.feature features/regression/<subdir>/feature-992.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-992.feature`\n- Step definitions:\n- (no step-def siblings found)\n\n## Phrases to register\n\n- `a target repository never initialised by ADW whose only manifest is \"<manifest>\"`\n- `the \"/adw_init\" agent writes a complete ADW configuration whose \".adw/project.md\" declares the application type \"web\"`\n- `the framework upgrade regenerates the target repository's ADW configuration`\n- `the upgrade commits the regenerated configuration`\n- `the regen commit's \"features/playwright.config.ts\" is byte-identical to ADW's Playwright configuration template`\n- `the regen commit's \"features/package.json\" depends on \"@playwright/test\" and \"playwright-bdd\"`\n- `the upgrade installed the packages \"features/package.json\" names, and the Playwright browser, in \"features/\"`\n- `the regen commit holds nothing under \"features/node_modules/\"`\n- `the regen commit leaves \"<manifest>\" as the default branch has it`\n- `a target repository initialised by an older framework version`\n- `the target repository's default branch has these files of its own:`\n- `the regen commit leaves each of those files as the default branch has it`\n- `the target repository's default branch has this \"features/playwright.config.ts\":`\n- `a fixture framework copied from the ADW framework under test`\n- `the framework content hash is computed for the fixture framework`\n- `ADW's Playwright configuration template in the fixture framework is modified by a single byte`\n- `the recorded hashes are all different`\n- `a target repository never initialised by ADW`\n- `the \"/adw_init\" agent writes a complete ADW configuration whose \".adw/project.md\" <declaration>`\n- `the regen commit holds no \"features/playwright.config.ts\"`\n- `the regen commit holds no \"features/package.json\"`\n- `the upgrade installed nothing in \"features/\"`\n- `the \"/adw_init\" agent writes an ADW configuration with no \".adw/review_proof.md\", whose \".adw/project.md\" declares the application type \"<type>\"`\n- `the regen commit holds no \".adw/review_proof.md\"`\n- `a workflow for issue 9921 whose worktree's \".adw/project.md\" declares the application type \"web\"`\n- `the worktree's \".adw/commands.md\" starts a dev server that answers on its health check path`\n- `the worktree holds a feature tagged \"@adw-9921\" in \"features/per-issue/\" and steps for it in \"features/steps/\"`\n- `\"npx\" is a stand-in that records each run and writes a JUnit report in which every scenario passes`\n- `the workflow's scenario test phase runs`\n- `\"npx bddgen\" ran in \"features/\" before \"npx playwright test --grep\" ran there for the tag \"@adw-9921\"`\n- `the run of \"npx playwright test --grep\" for the tag \"@adw-9921\" was given \"ADW_APPLICATION_URL\" holding the address of the dev server ADW started`\n- `the run of \"npx playwright test --grep\" for the tag \"@adw-9921\" was given \"ADW_JUNIT_REPORT_PATH\" holding the scenario proof's report path for that tag, and \"ADW_PROOF_DIR\" holding a directory of that tag's own inside the scenario proof's artifacts directory`\n- `the dev server ADW started answered throughout the run of \"npx playwright test --grep\" for the tag \"@adw-9921\", and was stopped by the end of the phase`\n- `the scenario proof records no blocker failures`\n- `a workflow for issue 9922 whose worktree's \".adw/project.md\" declares the application type \"web\"`\n- `the worktree holds a feature tagged \"@adw-9922\" in \"features/per-issue/\" and steps for it in \"features/steps/\"`\n- `\"npx\" is a stand-in that records each run, exits 0, and writes a JUnit report in which one scenario fails`\n- `the scenario proof records a blocker failure for the tag \"@adw-9922\"`\n- `a workflow for issue 9923 whose worktree's \".adw/project.md\" declares the application type \"web\"`\n- `the worktree's \".adw/\" runs scenarios by tag with \"npx cucumber-js --tags @{tag}\"`\n- `the worktree's \".adw/scenarios.md\" names the BDD framework \"cucumber-js\" and the step definition directory \"features/step_definitions\"`\n- `the worktree holds a feature tagged \"@adw-9923\" in \"features/per-issue/\" and steps for it in \"features/steps/\"`\n- `\"npx bddgen\" ran in \"features/\" before \"npx playwright test --grep\" ran there for the tag \"@adw-9923\"`\n- `\"npx cucumber-js\" was not run`\n- `a workflow for issue 9924 whose worktree's \".adw/project.md\" declares the application type \"cli\"`\n- `the worktree's \".adw/\" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes`\n- `the worktree holds a feature tagged \"@adw-9924\" and steps for it in the step definition directory \".adw/scenarios.md\" names`\n- `\"npx\" is a stand-in that records each run`\n- `the scenario command \".adw/\" configures ran in the worktree's root for the tag \"@adw-9924\"`\n- `\"npx bddgen\" was not run`\n- `\"npx playwright test --grep\" was not run`\n- `a workflow for issue 9926 whose worktree's \".adw/project.md\" declares the application type \"web\"`\n- `the workflow's step-definition phase runs`\n- `the step-definition generator was started once, for issue 9926`\n- `the step-definition generator was started in the mode for ADW's Playwright project`\n- `a workflow for issue 9927 whose worktree's \".adw/project.md\" declares the application type \"cli\"`\n- `the step-definition generator was started once, for issue 9927`\n- `the step-definition generator was started in the mode for the scenario runner that \".adw/scenarios.md\" describes`\n- `a web application repository never initialised by ADW, whose dev server serves a page titled \"Widgets\" at \"/\" and answers \"/health\" with status 200`\n- `the \"/adw_init\" agent writes a complete ADW configuration whose \".adw/project.md\" declares the application type \"web\" and whose \".adw/commands.md\" starts that dev server`\n- `the framework upgrade has regenerated the repository's ADW configuration`\n- `a workflow for issue 9925 has a worktree checked out fresh from the regen commit`\n- `the worktree holds a feature tagged \"@adw-9925\" in \"features/per-issue/\" with these scenarios, and steps for them in \"features/steps/\" written with \"createBdd()\" from \"playwright-bdd\":`\n- `the scenario proof records the tag \"@adw-9925\" as passed`\n- `the JUnit report of the run for the tag \"@adw-9925\" is at the path ADW gave it, and records these scenarios as passed:`\n- `the JUnit report attaches exactly one image to \"The home page shows its title\", and that image is in the scenario proof's artifacts directory`\n- `the JUnit report attaches no image to \"The health endpoint answers\"`\n- `the dev server ADW started served \"/\" during the run`\n- `the ADW TypeScript type-check passes`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-992.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-07T21:01:47Z","comments":[],"actionableComment":null}`

## Feature Description
`features/per-issue/feature-992.feature` specifies that a `web` repository runs its Gherkin on a Playwright
project ADW owns (`features/package.json` and `features/playwright.config.ts`, written from
`templates/playwright/`). Its tags are `@adw-992 @adw-2u517h-feat-web-repositorie @promotion-suggested-2026-10-07`,
and #992 is merged (PR #1022). The file has 14 scenarios. Its outlines expand to 17 test cases, and it has
131 steps, Background included:

| Rows | Test cases | Behaviour guarded |
|---|---|---|
| Upgrade installs the project | 2 (outline: Node `package.json`, Python `pyproject.toml`) | The framework upgrade of a never-initialised repository whose `/adw_init` agent declares `web` commits `features/playwright.config.ts` byte-identical to the template, a `features/package.json` naming `@playwright/test` and `playwright-bdd`, and nothing under `features/node_modules/`. It installs the packages and the Playwright browser in `features/`, and leaves the repository's own manifest as it was |
| Own e2e setup | 1 | The upgrade adds the project beside the repository's own Playwright config, e2e spec and cucumber-js steps, and leaves each of those files as it was |
| Hand-edited config | 1 | A hand-edited `features/playwright.config.ts` is overwritten with the template |
| Content hash | 1 | A one-byte change to the Playwright configuration template changes the framework content hash |
| Not web | 2 (outline: `cli`, no `## Application Type`) | The upgrade commits no Playwright project and installs nothing in `features/` |
| No `review_proof.md` | 2 (outline: `cli`, `web`) | The upgrade completes when the agent writes no `.adw/review_proof.md`, and commits none |
| Scenario test phase, `web` | 3 (issues 9921, 9922, 9923) | The phase starts the dev server, then runs `npx bddgen` and `npx playwright test --grep` for the tag in `features/`. It passes `ADW_APPLICATION_URL`, `ADW_JUNIT_REPORT_PATH` and a per-tag `ADW_PROOF_DIR`, and stops the server afterwards. A failing JUnit case is a blocker even when the exit code is 0, and a stale cucumber-js `.adw/` is ignored |
| Scenario test phase, `cli` | 1 (issue 9924) | The phase runs the scenario command `.adw/` configures from the worktree root, and runs neither `bddgen` nor `playwright` |
| Step-definition phase | 2 (issues 9926, 9927) | The generator starts in `adw_playwright` mode for `web` and in `descriptor` mode for `cli` |
| Fresh repository, end to end | 1 (issue 9925) | Uses the real `npm`/`npx`, the npm registry and a real Chromium. The JUnit report is at ADW's path, the scenario that opens a page has exactly one image in the proof artifacts directory, the other has none, and the dev server served `/` |
| Backstop | 1 | T22, the TypeScript type-check |

The scenarios drive the real `executeUpgrade`, `syncDeclaredScenarioProject`, `executeScenarioTestPhase` and
`executeStepDefPhase`. The forge, the `/adw_init` agent, `npm`/`npx`, the dev server and the Claude CLI are
stand-ins, except in the fresh-repository row. Every assertion reads one of these artefacts:
- the regen commit;
- the stand-ins' call log;
- the returned scenario proof;
- a JUnit report;
- the dev server's request log;
- the throwaway CLI's run log.

This feature moves the scenario into the standing suite as
`features/regression/playwright/feature-992.feature`, tagged `@regression @web-playwright-project`. It is the
direct relocation the issue describes (the #734 shape). Six points go beyond the issue's text, each with
precedent in `app_docs/feature-9gjajh-bdd-regression-suite.md` or in the #932/#937/#910 promotions:

1. **The step definitions are a 19-file closure, not zero files.** The issue says "no step-def siblings
   found" because its sibling rule is `startsWith('feature-992.')`, and every #992 file is hyphen-named
   (app doc, line 120). The closure has two parts:
   - the 12 `feature-992-*.ts` files;
   - 7 per-issue modules they import, or whose phrases the feature uses: `feature-929-compacting-cli.ts`,
     `feature-929-workflow.ts`, `feature-931.steps.ts`, `feature-988-commands.ts`, `feature-988-world.ts`,
     `feature-991-project-md.ts` and `feature-991-upgrade.steps.ts`.

   All 19 move together, so none of their import specifiers changes. `feature-931.steps.ts` is the urgent
   one:
   - it matches the per-issue sweep's sibling rule for #931, which merged on 2026-10-02;
   - left behind, it would be deleted around 2026-10-16;
   - one dangling import aborts the whole Cucumber load.
2. **42 import specifiers in 23 per-issue files are repointed** to `../../regression/step_definitions/…`.
   These are the per-issue features that share the harness (929, 988, 989, 990, 991, 993, 994 and 995).
3. **Two hooks are re-keyed.** `feature-992-world.ts`'s `OWN_SCENARIOS` becomes `@web-playwright-project`.
   In `feature-931.steps.ts`, `UPGRADE_SCENARIOS` swaps `@adw-992` for `@web-playwright-project` and keeps
   its per-issue `@adw-931`/`@adw-991` alternatives.
4. **The throwaway Claude CLI's restore becomes order-independent.**
   - Under `@regression`, the suite's teardown (`features/regression/support/hooks.ts`) restores
     `CLAUDE_CODE_PATH`.
   - That teardown's `After` runs before the moved files' `After`.
   - `installCompactingCli().restore()` would then write the stub path back, leaking it.
   - The fix is the three-line guard #930 and #937 already use.
5. **The fresh-repository clone runs on the real git.** The `@regression` git mock (`test/mocks/git-remote-mock.ts`)
   no-ops `clone`, even of a local path. The fresh-repository Given would therefore find an empty checkout
   and fail. It switches to the existing `realGit` helper (`features/regression/support/fixtureWorktree.ts`).
6. **The fresh-repository scenario is tagged `@host-only`, and the Docker leg leaves it out.** It needs the
   npm registry, the real `npm`/`npx` and a real Chromium. The runner image is "Bun + Git" only
   (`test/Dockerfile`). `test/docker-run.sh` appends `and not @host-only` to every container run. A new unit
   test pins this, and the README's Docker section says so. The host job still runs the scenario.

The issue's concrete phrases map onto 57 cucumber expressions:
- 51 are new and are registered in a new `(@web-playwright-project)` section of `features/regression/vocabulary.md`:
  G-WP1–G-WP24, W-WP1–W-WP4 and T-WP1–T-WP23;
- 6 are already registered and reused: G18 (Background), W-HC1, T-HC3, T-PY3, T-S12 and T22.

The README's `features/` tree gains the `playwright/` line.

## User Story
As an ADW maintainer
I want #992's web-repository scenarios to run in the standing `@regression` suite
So that a later change to the Playwright templates, `syncDeclaredScenarioProject`, the upgrade's install step,
`ADW_PLAYWRIGHT_RUN_BY_TAG`, the scenario test phase's env passing and dev-server lifecycle, or the step-definition
phase's runner mode is caught by every regression run. That covers, for example, a template change that breaks
`bddgen`, an upgrade that commits `node_modules`, or a `web` run that stops passing `ADW_PROOF_DIR`.

## Problem Statement
- **Not in the regression run.** `feature-992.feature` carries no `@regression` tag; only #992's own workflow ran
  it, by `@adw-992`, and that workflow is finished. Its `@promotion-suggested-2026-10-07` marker is all that keeps
  the 14-day per-issue sweep from deleting it.
- **The issue's one-file recipe cannot work.**
  - The feature's steps live in 12 hyphen-named `feature-992-*.ts` files that the issue does not list.
  - Those files import 5 per-issue modules of other features through `./…` specifiers. They also rely on phrases
    defined in two more (`feature-931.steps.ts`, `feature-991-upgrade.steps.ts`).
  - Moving only some of them leaves dangling imports, and one dangling import aborts every Cucumber run.
  - Pointing the moved files back into `features/per-issue/` is the rewrite the issue forbids. It would also leave
    a regression feature depending on per-issue files, which the app doc forbids (lines 63 and 113).
- **A sweep time bomb.** `feature-931.steps.ts` matches #931's sibling rule. The sweep deletes it around
  2026-10-16, and that breaks every importer, including the moved #992 files.
- **Importers left behind.** Moving the closure strands 42 `./…` specifiers in 23 per-issue files (Task 4).
- **Hooks keyed on a per-issue tag.**
  - `feature-992-world.ts` keys its `Before`/`After` on `'@adw-992 and not @adw-988 and not @adw-989 and not @adw-991'`.
  - `feature-931.steps.ts` keys the upgrade harness's `Before`/`After` on `'@adw-931 or @adw-991 or @adw-992'`.
  - With `@adw-992` gone, the world reset, the stand-in disposal, the CLI restore and the temp-dir and
    `agents/<adwId>` cleanup would all stop silently.
- **Two `@regression`-only failures.**
  1. *The clone.* `setupMockInfrastructure()` puts `test/mocks/git-remote-mock.ts` first on `PATH`, and it no-ops
     `clone`. "a workflow for issue 9925 has a worktree checked out fresh from the regen commit" then asserts on an
     empty checkout and fails.
  2. *The CLI restore.* `cucumber.js` imports `features/regression/step_definitions/**` before
     `features/regression/support/**`. The suite's teardown `After` therefore runs before the moved files' `After`.
     `endScenario()` then calls `installCompactingCli().restore()`, which writes back the stub path it saved at
     install time. That undoes the teardown and leaks the stub path into every later scenario in the process.
- **The Docker leg cannot run the fresh-repository scenario.**
  - That scenario runs the real `npm install`, `npx playwright install chromium`, `npm ci`, `npx bddgen` and
    `npx playwright test` against the npm registry and a real Chromium.
  - The runner image holds only Bun and Git (`test/Dockerfile`).
  - Promoted as is, it would turn the daily `docker` job red.
- **Unregistered phrases.** No `vocabulary.md` row covers 51 of the 57 expressions the feature uses. The issue's
  list also omits the Background phrase, because `scenarioParser.ts` skips `Background`; that phrase is G18,
  already registered.

## Solution Statement
1. **Move the feature** to `features/regression/playwright/feature-992.feature` with `git mv`.
   - `playwright/` names the subject: ADW's Playwright project for `web` repositories. It is short and matches
     existing subject names (`labels/`, `review/`, `upgrade/`).
2. **Re-tag it.**
   - Line 1 becomes `@regression @web-playwright-project`. That drops `@adw-992`,
     `@adw-2u517h-feat-web-repositorie` and `@promotion-suggested-2026-10-07` (app doc, line 119).
   - Delete the 13 scenario-level tag lines, including the `@adw-995` and `@adw-993` extras.
   - Replace the fresh-repository scenario's tag line with `  @host-only`.
   - Add one description sentence saying why that scenario is host-only.
   - Neither tag is used anywhere in the repo, and neither starts with `@adw-`.
3. **Move the 19-file closure** flat into `features/regression/step_definitions/` with `git mv`. No import
   specifier changes:
   - both directories are three levels deep, so `./…`, `../../../adws/…` and `../../regression/step_definitions/…`
     resolve identically;
   - `feature-931.steps.ts`'s `FRAMEWORK_REPO_ROOT` (`'../../..'`) still names the repo root.
4. **Repoint the 42 stranded specifiers** in the 23 per-issue files to `../../regression/step_definitions/<file>.ts`.
   Per-issue files already reach `feature-796.steps.ts`, `feature-937-world.ts` and `world.ts` this way.
5. **Re-key the hooks.**
   - `feature-992-world.ts`: `OWN_SCENARIOS = '@web-playwright-project'`. The `not @adw-988/989/991` clauses go:
     no row of those features will carry the new tag.
   - `feature-931.steps.ts`: `UPGRADE_SCENARIOS = '@adw-931 or @adw-991 or @web-playwright-project'`. The per-issue
     alternatives stay for the 931/991 rows still under `features/per-issue/` (the #910 precedent, app doc line 121).
6. **Make the throwaway CLI's restore order-independent.** `installCompactingCli().restore()` writes the saved value
   back only while `CLAUDE_CODE_PATH` still names its own script. It still clears the CLI path cache. On every
   per-issue path the variable still names the script at restore time, so behaviour there is unchanged.
7. **Clone with the real git.** In `feature-992-fresh.steps.ts`, the clone uses
   `realGit` from `../support/fixtureWorktree.ts`. The unused `git` binding leaves the existing
   `./feature-931.steps.ts` import line; the specifier is untouched.
8. **Keep `@host-only` out of the Docker leg.**
   - `test/docker-run.sh` hands the container `(<tags>) and not @host-only`, whatever `--tags` it was given.
   - `.github/workflows/regression.yml` and its pinned `DOCKER_COMMAND` stay as they are.
   - A new unit test in `adws/__tests__/regressionWorkflow.test.ts` runs the script against a fake `docker` and
     asserts the tag expression the container receives.
9. **Register 51 phrases** in a new `## Given/When/Then — Web Repositories on ADW's Playwright Project (@web-playwright-project)`
   section of `vocabulary.md`: G-WP1–G-WP24, W-WP1–W-WP4 and T-WP1–T-WP23. G18, W-HC1, T-HC3, T-PY3, T-S12 and
   T22 are reused.
10. **README.** Add the `playwright/` line to the `features/` tree, and add a sentence in the Docker section about
    `@host-only`.

No production code under `adws/` changes, and no library is added. Cucumber loads exactly the same step
definitions before and after: files are moved, never copied, and the only new import (`realGit`) is not a step
definition. So no ambiguous or undefined step can appear.

## Relevant Files
Use these files to implement the feature:

- `README.md`: project overview.
  - Its `features/` tree (around line 1240–1268) lists each `features/regression/` subdirectory. The new
    `playwright/` line goes between `plan-commit/` and `rate-limit/`.
  - Its Docker section (lines ~369–398) gains the `@host-only` sentence.
  - **It already carries an unrelated uncommitted change** from before planning: two tree lines for
    `reviewPromptArgs.ts` and `reviewPromptContext.ts`, both of which exist. Leave those lines as they are.
- `.adw/coding_guidelines.md`: the coding guidelines. Its **Comments** rule governs the three comments added
  here: state the constraint, never an issue number. Every touched file stays under 300 lines;
  `feature-931.steps.ts` is 296 and its line count must not grow.
- `.adw/scenarios.md` and `.adw/commands.md`: the regression directory, the vocabulary registry path and the
  validation commands.
- `cucumber.js`. Its `paths` cover `features/regression/**/*.feature`. Its `import` order is
  `features/regression/step_definitions/**` before `features/regression/support/**`, which puts the `@regression`
  teardown's `After` first.
- `app_docs/feature-9gjajh-bdd-regression-suite.md`. Conditional doc for "When manually promoting a
  `features/per-issue/` scenario into `features/regression/`" and "When a promotion issue lists fewer step-def
  sources than the feature needs". The rules this plan follows:
  - line 63: the closure moves with its imports unchanged, and importers left behind are repointed;
  - lines 112–113: the hand-promotion recipe, promoting the whole closure, and the sweep deleting `feature-N.*`
    siblings;
  - line 119: drop every `@adw-` tag and `@promotion-suggested-*`, and re-key hooks to a descriptive tag that is
    exactly the feature's;
  - line 120: under-listed step-def sources;
  - line 121: per-issue hook alternatives, and `CLAUDE_CODE_PATH` under the `@regression` mock;
  - line 125: the git mock delegates local subcommands but intercepts `clone`/`fetch`/`push`/`pull`/`ls-remote`.
- `app_docs/feature-2u517h-adw-playwright-project.md` (conditional doc: ADW's Playwright project,
  `syncDeclaredScenarioProject`, `ADW_PLAYWRIGHT_RUN_BY_TAG`). The behaviour the scenarios guard; use it for the
  vocabulary semantics.
- `app_docs/feature-gfv9kt-application-type-mapping.md` (conditional doc: application type → runner mode). The
  `web` → `adw_playwright` and `cli` → `descriptor` mapping the phase rows assert.
- `app_docs/feature-9gjajh-proof-and-scenario-proof.md` (conditional doc: scenario proof, `ADW_PROOF_DIR`,
  `ADW_JUNIT_REPORT_PATH`). Background for T-WP12, T-WP19 and T-WP20–T-WP22.
- `app_docs/feature-9gjajh-promotion-system.md` (conditional doc: promotion tag state and issue body). It explains
  the dropped `@promotion-suggested-2026-10-07`, and why the issue under-lists step files (`promotionIssueBody.ts`,
  `promotionSweepDefaults.ts` `listStepDefSiblings`) and omits the Background phrase (`adws/promotion/scenarioParser.ts`).
- `app_docs/feature-9gjajh-bdd-per-issue.md` (conditional doc: per-issue scenarios). Context for the directory the
  files leave, and for the 23 per-issue importers.
- `features/per-issue/feature-992.feature`: the source feature, moved and re-tagged.
  - Tag lines: 1, 9, 26, 42, 61, 69, 84 (also `@adw-995`), 97 (also `@adw-993`), 110, 119, 131, 143, 150, 157
    (the fresh-repository scenario) and 177.
  - The description is line 4.
- The 19-file closure in `features/per-issue/step_definitions/`, moved to `features/regression/step_definitions/`:
  - `feature-992-world.ts`: shared state and the `OWN_SCENARIOS` hooks (lines 56–67). Re-keyed, with its header
    comment updated.
  - `feature-992-upgrade.steps.ts`: the upgrade Givens and Thens and the fixture-framework rows. Imports
    `adoptFixtureFramework` from the regression `feature-537.steps.ts`. Moved unchanged.
  - `feature-992-phase.steps.ts`: the scenario-test-phase and step-definition-phase rows. Moved unchanged.
  - `feature-992-fresh.steps.ts`: the fresh-repository rows. The clone at line 75 and its import line change.
  - `feature-992-adw-files.ts`, `feature-992-bdd-source.ts`, `feature-992-calls.ts`, `feature-992-junit.ts`,
    `feature-992-own-files.ts`, `feature-992-standin-source.ts`, `feature-992-standins.ts` and
    `feature-992-worktree.ts`: helpers, moved unchanged.
  - `feature-931.steps.ts`: the upgrade harness (the real `executeUpgrade` over a throwaway repo) and
    `UPGRADE_SCENARIOS` (line 38). Only that string changes.
  - `feature-991-upgrade.steps.ts`: the two "agent writes a complete ADW configuration whose …" Givens. Moved
    unchanged.
  - `feature-991-project-md.ts`: `projectMd`, `assertProjectMdFile`. Moved unchanged.
  - `feature-929-workflow.ts`: `createWorkflow`, `commentsOn`, `Workflow929`. Moved unchanged.
  - `feature-929-compacting-cli.ts`: `installCompactingCli` (restore at lines ~175–179), `readRuns`. The restore
    and its JSDoc change.
  - `feature-988-world.ts`: shared workflow state, `beginScenario`/`endScenario` and its own `@adw-988` hooks.
    Moved unchanged.
  - `feature-988-commands.ts`: the commands-file model. Moved unchanged.
- The 23 per-issue importers in `features/per-issue/step_definitions/` whose specifiers are repointed (table in
  Task 4): `feature-929-agents.ts`, `feature-929.steps.ts`, `feature-988-phase.steps.ts`, `feature-988.steps.ts`,
  `feature-989-comments.ts`, `feature-989-fix-agent.ts`, `feature-989-git.ts`, `feature-989-phase.steps.ts`,
  `feature-990-run.ts`, `feature-990-target.ts`, `feature-990-web.ts`, `feature-990-world.ts`,
  `feature-990.steps.ts`, `feature-991-git.ts`, `feature-991-mapping.steps.ts`, `feature-991-start.ts`,
  `feature-991-workflow.steps.ts`, `feature-991-world.ts`, `feature-993-given.steps.ts`, `feature-993-read.ts`,
  `feature-993-then.steps.ts`, `feature-994-workflow.ts` and `feature-995-config.steps.ts`.
- `features/per-issue/step_definitions/feature-990-world.ts` (line 135) and `feature-995-world.ts` (line 46): their
  hook expressions hold `not @adw-992` clauses that become inert. Leave them; only their imports change.
- `features/per-issue/feature-989.feature` (line 32) and `features/per-issue/feature-991.feature` (line 132): per-issue
  rows that also carry `@adw-992`. They run their own features' hooks and are not edited.
- `features/regression/support/fixtureWorktree.ts`: exports `realGit(cwd, ...args)`, the real git via
  `REAL_GIT_PATH`. Its header documents that the mock no-ops `clone`.
- `features/regression/support/hooks.ts` and `test/mocks/test-harness.ts`. `setupMockInfrastructure()` sets
  `CLAUDE_CODE_PATH`, `PATH` (git mock first), `REAL_GIT_PATH` and `GH_*`; `teardownMockInfrastructure()` restores
  them. This is why Tasks 7–8 exist.
- `test/mocks/git-remote-mock.ts`: `REMOTE_COMMANDS` (`push`, `fetch`, `clone`, `pull`, `ls-remote`) are no-ops.
- `features/regression/step_definitions/feature-930-plan-fixture.ts`: `restoreClaudeCli()` (lines ~101–110), the
  precedent for the guard and its comment.
- `features/regression/step_definitions/feature-537.steps.ts` (W-HC1, T-HC3, `adoptFixtureFramework`),
  `pythonFixtureE2ESteps.ts` (T-PY3), `surfaceSteps.ts` (T-S12), `givenSteps.ts` (G18) and `thenSteps.ts` (T22):
  the reused phrases. Do not redefine them.
- `features/regression/vocabulary.md`: the registry. It ends with the `(@review-comment-screenshots)` section
  (line ~1082); the new section is appended after it. Model it on that section and on `(@framework-hash)`
  (line ~152). The `WP` prefix is unused.
- `adws/promotion/vocabularyParser.ts`: the registry row format. Five `|`-separated columns, the phrase in
  backticks in column 2, and no `|` inside a cell.
- `test/docker-run.sh`: the Docker runner. It gains the `@host-only` exclusion.
- `test/Dockerfile`: the image, "Bun + Git" only. Read-only context; unchanged.
- `.github/workflows/regression.yml`: the `host` and `docker` jobs. Unchanged; the docker job keeps
  `bash test/docker-run.sh --tags "@regression"`.
- `adws/__tests__/regressionWorkflow.test.ts`: the contract test for the daily run and the Docker leg. It gains
  the `@host-only` test.
- Read-only, for accurate vocabulary semantics; none of these change:
  - `adws/adwUpgrade.tsx` (`executeUpgrade`);
  - `adws/phases/scenarioProjectSetup.ts`;
  - `adws/core/adwPlaywrightProject.ts` (`ADW_PLAYWRIGHT_SETUP_COMMAND`, `ADW_PLAYWRIGHT_RUN_BY_TAG`);
  - `adws/phases/scenarioTestPhase.ts`;
  - `adws/phases/scenarioProof.ts`;
  - `adws/phases/stepDefPhase.ts`;
  - `adws/core/applicationType.ts` (`RunnerMode`).

### New Files
No file is written from scratch. `git mv` creates these paths, and their content travels from the per-issue
originals:
- `features/regression/playwright/feature-992.feature`, with the new `features/regression/playwright/` directory.
- `features/regression/step_definitions/` gains the 19 closure files listed above. The 12 `feature-992-*.ts` files
  are joined by `feature-929-compacting-cli.ts`, `feature-929-workflow.ts`, `feature-931.steps.ts`,
  `feature-988-commands.ts`, `feature-988-world.ts`, `feature-991-project-md.ts` and `feature-991-upgrade.steps.ts`.

## Implementation Plan
### Phase 1: Foundation
Confirm the ground the move stands on:
- the 20 source files exist and the destinations are free;
- the closure has no importer outside `features/per-issue/step_definitions/`;
- `@web-playwright-project`, `@host-only`, the `playwright/` directory and the `WP` prefix are unused;
- the only hooks keyed on `@adw-992` are the two named above.

### Phase 2: Core Implementation
1. `git mv` the feature and the 19-file closure.
2. Repoint the 42 stranded specifiers in the 23 per-issue files.
3. Re-tag the feature and add the host-only sentence.
4. Re-key the two hooks.
5. Guard the CLI restore.
6. Clone with `realGit`.
7. Exclude `@host-only` from container runs, with its unit test.

### Phase 3: Integration
1. Register the 51 phrases.
2. Update the README tree and Docker note.
3. Prove the result:
   - the moved scenarios pass under the `@regression` hooks;
   - the per-issue features that share the harness still bind every step;
   - the whole `@regression` suite is green with no undefined or ambiguous step;
   - type-check, lint, build, the docs index and the unit suite are green.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Verify preconditions
- Read `app_docs/feature-9gjajh-bdd-regression-suite.md` lines 63, 112–125 and 152 for the promotion conventions.
- `ls features/per-issue/feature-992.feature features/per-issue/step_definitions/feature-992-*.ts | wc -l` prints `13`.
- `ls features/per-issue/step_definitions/{feature-929-compacting-cli,feature-929-workflow,feature-931.steps,feature-988-commands,feature-988-world,feature-991-project-md,feature-991-upgrade.steps}.ts`
  lists 7 files.
- `test ! -e features/regression/playwright && echo FREE` prints `FREE`.
- `ls features/regression/step_definitions | grep -E '^feature-(992-|929-|931\.|988-|991-)'` prints nothing.
- `grep -rn -e "web-playwright-project" -e "host-only" features test adws .github README.md cucumber.js` prints
  nothing.
- `grep -nE '^\| [GWT]-WP[0-9]' features/regression/vocabulary.md` prints nothing.
- `grep -rnE "feature-(992-|929-compacting-cli|929-workflow|931\.steps|988-commands|988-world|991-project-md|991-upgrade\.steps)" features/regression features/step_definitions features/support adws test scripts`
  prints nothing, so no importer outside `features/per-issue/` needs repointing.
- `grep -rn "adw-992'" features --include='*.ts'` shows two hook constants:
  - `UPGRADE_SCENARIOS` in `feature-931.steps.ts`;
  - `OWN_SCENARIOS` in `feature-992-world.ts`.

  The `not @adw-992` clauses in `feature-990-world.ts` and `feature-995-world.ts` are left as they are.

### 2. Move the feature file
- `mkdir -p features/regression/playwright`
- `git mv features/per-issue/feature-992.feature features/regression/playwright/feature-992.feature`

### 3. Move the step-definition closure
- `for f in features/per-issue/step_definitions/feature-992-*.ts; do git mv "$f" features/regression/step_definitions/; done`
  moves 12 files.
- Move the 7 shared modules:
  ```sh
  for f in feature-929-compacting-cli feature-929-workflow feature-931.steps feature-988-commands feature-988-world feature-991-project-md feature-991-upgrade.steps; do
    git mv "features/per-issue/step_definitions/$f.ts" features/regression/step_definitions/
  done
  ```
- Do not edit any import specifier in the 19 files. They all resolve unchanged from the new directory:
  - the co-located `./feature-…` imports, now siblings again;
  - `../../../adws/…`;
  - `../../regression/step_definitions/world.ts`, `…/feature-537.steps.ts` and `…/feature-796.steps.ts`;
  - the packages.
- Leave the `'adw-992-…'`, `'adw-929-…'` and `'adw-931-…'` `mkdtemp` prefixes and the fixture names (`void-992`,
  `adw-931-target`) as they are. They are names, not tags.

### 4. Repoint the per-issue importers left behind
Each specifier below becomes `'../../regression/step_definitions/<same file name>'`. Only the path string changes;
the imported bindings stay the same.

| Per-issue file | Specifiers to repoint |
|---|---|
| `feature-929-agents.ts` | `./feature-929-workflow.ts` |
| `feature-929.steps.ts` | `./feature-929-compacting-cli.ts`, `./feature-929-workflow.ts` |
| `feature-988-phase.steps.ts` | `./feature-929-compacting-cli.ts`, `./feature-929-workflow.ts`, `./feature-988-world.ts` |
| `feature-988.steps.ts` | `./feature-988-commands.ts`, `./feature-988-world.ts` |
| `feature-989-comments.ts` | `./feature-929-workflow.ts` |
| `feature-989-fix-agent.ts` | `./feature-929-compacting-cli.ts`, `./feature-929-workflow.ts`, `./feature-988-commands.ts`, `./feature-988-world.ts` |
| `feature-989-git.ts` | `./feature-929-workflow.ts`, `./feature-988-world.ts` |
| `feature-989-phase.steps.ts` | `./feature-929-compacting-cli.ts`, `./feature-929-workflow.ts`, `./feature-988-world.ts` |
| `feature-990-run.ts` | `./feature-929-workflow.ts`, `./feature-988-world.ts` |
| `feature-990-target.ts` | `./feature-988-commands.ts`, `./feature-991-project-md.ts`, `./feature-992-worktree.ts` |
| `feature-990-web.ts` | `./feature-992-standins.ts` |
| `feature-990-world.ts` | `./feature-988-commands.ts`, `./feature-988-world.ts` |
| `feature-990.steps.ts` | `./feature-988-commands.ts` |
| `feature-991-git.ts` | `./feature-929-workflow.ts`, `./feature-988-world.ts` |
| `feature-991-mapping.steps.ts` | `./feature-988-world.ts`, `./feature-991-project-md.ts` |
| `feature-991-start.ts` | `./feature-929-workflow.ts` |
| `feature-991-workflow.steps.ts` | `./feature-929-workflow.ts`, `./feature-988-world.ts`, `./feature-991-project-md.ts` |
| `feature-991-world.ts` | `./feature-988-world.ts` |
| `feature-993-given.steps.ts` | `./feature-991-project-md.ts` |
| `feature-993-read.ts` | `./feature-992-standins.ts` |
| `feature-993-then.steps.ts` | `./feature-929-workflow.ts`, `./feature-992-standins.ts` |
| `feature-994-workflow.ts` | `./feature-992-adw-files.ts` |
| `feature-995-config.steps.ts` | `./feature-992-adw-files.ts` |

That is 42 specifiers in 23 files. A portable way to do it (GNU or BSD `sed`):
```sh
for b in feature-929-compacting-cli feature-929-workflow feature-931.steps feature-988-commands feature-988-world feature-991-project-md feature-991-upgrade.steps feature-992-adw-files feature-992-bdd-source feature-992-calls feature-992-fresh.steps feature-992-junit feature-992-own-files feature-992-phase.steps feature-992-standin-source feature-992-standins feature-992-upgrade.steps feature-992-worktree feature-992-world; do
  grep -rlF "from './$b.ts'" features/per-issue/step_definitions | while read -r f; do
    sed -i.bak "s#from '\./$b\.ts'#from '../../regression/step_definitions/$b.ts'#g" "$f" && rm "$f.bak"
  done
done
```
- `grep -rnE "from '\./feature-(929-compacting-cli|929-workflow|931\.steps|988-commands|988-world|991-project-md|991-upgrade\.steps|992-[a-z-]+(\.steps)?)\.ts'" features/per-issue`
  must print nothing.
- `git diff --stat -- features/per-issue/step_definitions` lists exactly the 23 files in the table.
- Do not touch the hook expressions in `feature-990-world.ts` or `feature-995-world.ts`.

### 5. Re-tag the moved feature
In `features/regression/playwright/feature-992.feature`:
- Line 1 becomes exactly `@regression @web-playwright-project`.
- Delete the 13 scenario-level tag lines that read `  @adw-992 @adw-2u517h-feat-web-repositorie`, including the
  two with `@adw-995` and `@adw-993` appended. These are original lines 9, 26, 42, 61, 69, 84, 97, 110, 119, 131,
  143, 150 and 177.
- Replace the fresh-repository scenario's tag line (original line 157, above
  `Scenario: In a fresh "web" repository the framework upgrade initialised, …`) with exactly `  @host-only`.
- Add two description lines after line 4 (`  ADW's Playwright project is …`), with the same two-space indent. No
  description line may start with `@`:
  ```
    The fresh-repository scenario installs that project from the npm registry with the real "npm" and "npx" and runs it
    in a real Chromium, so it needs network access; it is tagged host-only, and the Docker leg, whose image has neither, leaves it out.
  ```
- Leave the `Feature:` line, the Background, every scenario title, step, Examples table, data table and doc string
  as they are. Strings such as `"@adw-9921"` inside steps are step arguments, not tags.
- `grep -nE '^\s*@' features/regression/playwright/feature-992.feature` prints exactly two lines:
  `1:@regression @web-playwright-project` and the `  @host-only` line.

### 6. Re-key the hooks to the descriptive tag
- In `features/regression/step_definitions/feature-992-world.ts`:
  - Change `const OWN_SCENARIOS = '@adw-992 and not @adw-988 and not @adw-989 and not @adw-991';` to
    `const OWN_SCENARIOS = '@web-playwright-project';`.
  - Update the header comment so it stays true. It currently explains the `not` clauses. Reword it to say the hooks
    are keyed on the tag only the promoted feature carries. The per-issue rows of other features that still carry
    `@adw-992` (feature-989's protected-path outline, feature-991's upgrade outline) run their own feature's hooks
    and none of these, which would reset the world those scenarios were built in. Cite no issue number.
  - Leave the hook bodies unchanged.
- In `features/regression/step_definitions/feature-931.steps.ts`:
  - Change `const UPGRADE_SCENARIOS = '@adw-931 or @adw-991 or @adw-992';` to
    `const UPGRADE_SCENARIOS = '@adw-931 or @adw-991 or @web-playwright-project';`.
  - Nothing else changes, and the file stays at 296 lines.
- The hook tag must equal the feature's tag exactly, or cleanup stops silently while the scenarios still pass.
- `grep -rnE "@adw-992([^0-9]|$)" features/regression` must print nothing.

### 7. Make the throwaway Claude CLI's restore order-independent
In `features/regression/step_definitions/feature-929-compacting-cli.ts`, change only `restore` in
`installCompactingCli`'s returned object:
```ts
    restore: () => {
      // After hooks run in reverse registration order and the @regression teardown registers after this file, so it may already have restored the variable; writing back the value saved at install would clobber that.
      if (process.env['CLAUDE_CODE_PATH'] === scriptPath) {
        if (savedPath === undefined) delete process.env['CLAUDE_CODE_PATH'];
        else process.env['CLAUDE_CODE_PATH'] = savedPath;
      }
      clearClaudeCodePathCache();
    },
```
- Update the function's JSDoc sentence "`restore()` puts the previous value back and clears the cached CLI path, as
  the `@adw-929` After hook needs to do even when a scenario fails." to say that `restore()` puts the previous value
  back unless something has replaced the script since, clears the cached CLI path, and is what the After hooks call
  even when a scenario fails.
- Per-issue behaviour is unchanged. For `feature-929.steps.ts`, the CLIs are restored newest first, and each one
  still names its own script when restored. For `endScenario`, nothing else has touched the variable outside
  `@regression`.
- This mirrors `restoreClaudeCli()` in `feature-930-plan-fixture.ts` and `deactivateStandInAgent()` in
  `feature-937-agent.ts`.

### 8. Clone the fresh worktree with the real git
In `features/regression/step_definitions/feature-992-fresh.steps.ts`:
- Change line 75, `git(checkout, 'clone', '-q', repositoryDirectory(), '.');`, to
  `realGit(checkout, 'clone', '-q', repositoryDirectory(), '.');`, with this comment above it:
  `// The @regression git mock turns clone into a no-op, even of a local path.`
- Add `import { realGit } from '../support/fixtureWorktree.ts';` beside the other relative imports. Regression step
  files already import it this way (`promotionSweepSteps.ts`).
- Remove the now-unused `git` binding from the existing line
  `import { commitAll, configureAdwInitAgent, createTargetRepo, git, runFrameworkUpgrade, upgradeWorld } from './feature-931.steps.ts';`.
  The specifier `./feature-931.steps.ts` stays. ESLint lints `features/**`, and an unused import fails `bun run lint`.
- In the header comment, after "It needs network access.", add: "It is tagged `@host-only`: the Docker image has
  neither npm nor a browser, so the container run leaves it out."
- No other line changes. `realGit` uses `REAL_GIT_PATH`, which `setupMockInfrastructure()` sets under
  `@regression`. Elsewhere it falls back to plain `git`.

### 9. Keep `@host-only` scenarios out of the Docker leg
- In `test/docker-run.sh`:
  - Right after the argument-parsing loop, add:
    ```bash
    # The image holds only Bun and Git, so a scenario that needs the real npm, the npm registry or a browser cannot run in it.
    CONTAINER_TAGS="(${BDD_TAGS}) and not @host-only"
    ```
  - In both `docker run` invocations (the `--shell` one and the run one), pass `-e "BDD_TAGS=${CONTAINER_TAGS}"`
    instead of `-e "BDD_TAGS=${BDD_TAGS}"`.
  - The `Running BDD scenarios tagged '…'` echo prints `${CONTAINER_TAGS}`.
  - The header's `--tags` usage line reads
    `Cucumber tag filter (default: @regression); scenarios tagged @host-only are always left out`.
  - Change nothing else. The read-only mount and the node_modules volume, each passed twice, are pinned by the
    existing test.
- In `adws/__tests__/regressionWorkflow.test.ts`, inside `describe('the Docker leg', …)`, add a behavioural test
  that runs the script through its public interface against a fake `docker`. `fakeBinDir` is the file's existing
  temp bin dir:
  ```ts
  it.each(['@regression', '@web-playwright-project'])('hands the container %s less the @host-only scenarios', tags => {
    const argsFile = path.join(fakeBinDir, 'docker-run-args');
    fs.writeFileSync(path.join(fakeBinDir, 'docker'), `#!/bin/sh\nif [ "$1" = run ]; then printf '%s\\n' "$@" > "${argsFile}"; fi\nexit 0\n`, { mode: 0o755 });
    const run = spawnSync('bash', [path.join(REPO_ROOT, 'test/docker-run.sh'), '--tags', tags], {
      env: { PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}` },
      encoding: 'utf-8',
    });
    expect(run.status, run.stderr).toBe(0);
    expect(fs.readFileSync(argsFile, 'utf-8').split('\n')).toContain(`BDD_TAGS=(${tags}) and not @host-only`);
  });
  ```
  The fake `docker` answers `image inspect` with 0, so the script takes the cached-image path, and records the
  `docker run` arguments one per line.
- Extend the file's header comment with one clause: the Docker leg leaves the `@host-only` scenarios out of every
  container run. Leave `DOCKER_COMMAND`, `HOST_COMMAND` and every existing test unchanged; `regression.yml` does not
  change.

### 10. Register the phrases in `features/regression/vocabulary.md`
At the end of the file, after the `(@review-comment-screenshots)` section's closing reuse paragraph, add a blank
line, `---`, a blank line and the new section.

Rules for the rows:
- Each row has exactly five columns: `| # | Phrase | Semantics | Pattern | Assertion target |`.
- Each phrase is in backticks, written exactly as its step definition's cucumber expression.
- No cell contains a `|`. In particular, do not quote the JUnit attachment marker.
- Pattern is `phase-import` throughout.
- No row names a source file as its assertion target. The Playwright template, the fixture framework copy and the
  `.adw/` files a row writes are inputs to the system under test.

**Heading:** `## Given/When/Then — Web Repositories on ADW's Playwright Project (@web-playwright-project)`

**Intro paragraphs**, in the style of the `(@review-comment-screenshots)` and `(@framework-hash)` intros. They state
the following:
- **The three real code paths**, each over throwaway fixtures under `os.tmpdir()`:
  1. `executeUpgrade` over a throwaway target repository. The `/adw_init` agent is stubbed to write the `.adw/`
     files a row scripts, and every forge, push and pull-request dependency is a recorder. The real
     `syncDeclaredScenarioProject` syncs and installs ADW's Playwright project with stand-in `npm`/`npx` leading
     `PATH`.
  2. `executeScenarioTestPhase` over a throwaway workflow worktree whose `.adw/` the rows describe. Stand-in `npm`,
     `npx`, scenario command and dev server record every run: argv, working directory, `ADW_` variables, the
     packages the adjacent `package.json` names, and the dev server's answers before and after a run.
  3. `executeStepDefPhase` with a throwaway Claude CLI that records each run's prompt.
- **The hash rows** hash a throwaway copy of the framework's `.claude/commands/` and `templates/`.
- **The `@host-only` scenario.** Only the fresh-repository scenario uses the real `npm`/`npx`, the npm registry and a
  real Chromium. It needs network access, and the Docker leg leaves it out.
- **The asserted artefacts:**
  - the regen commit's tree and blobs;
  - the upgrade's result;
  - the stand-ins' call log;
  - the scenario proof the phase returned;
  - the JUnit report a run wrote;
  - the dev server's request log;
  - the throwaway CLI's run log.

  No step asserts on a source file, satisfying the Rot-Detection Rubric.
- **Where the definitions live:**
  - `feature-931.steps.ts`: the upgrade harness (G-WP1, G-WP3, G-WP5, W-WP1, T-WP1);
  - `feature-991-upgrade.steps.ts`: G-WP6 and G-WP7;
  - `feature-992-upgrade.steps.ts`, `feature-992-phase.steps.ts` and `feature-992-fresh.steps.ts`: the rest;
  - helpers: the other `feature-992-*` files, and `feature-929-workflow.ts`, `feature-929-compacting-cli.ts`,
    `feature-988-world.ts`, `feature-988-commands.ts` and `feature-991-project-md.ts`.
- **The hooks** are keyed on `@web-playwright-project`. A scenario using these phrases must carry that tag.
  - `Before` resets the upgrade world, the shared workflow world and this feature's state.
  - `After` restores `CLAUDE_CODE_PATH` unless the `@regression` teardown already has. It disposes of the stand-ins
    and removes the throwaway directories and `agents/<adwId>`.

**Rows.** The semantics below were checked against the step definitions; adjust the wording only where the code
disagrees.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-WP1 | `a target repository never initialised by ADW` | Creates a throwaway git repository on `main` holding a `package.json` and a README in one commit, with no `.adw/` and no `.adw-version` | phase-import | target repository fixture (SUT input) |
| G-WP2 | `a target repository never initialised by ADW whose only manifest is {string}` | As G-WP1 with the named manifest (`package.json` or `pyproject.toml`) as its only manifest; any other name fails the step | phase-import | target repository fixture (SUT input) |
| G-WP3 | `a target repository initialised by an older framework version` | As G-WP1, plus every required `.adw/` file with older-version content and an `.adw-version` holding an older framework hash, committed | phase-import | target repository fixture (SUT input) |
| G-WP4 | `the target repository's default branch has these files of its own:` | Writes each path in the table's `file` column with content of the repository's own (its own `package.json`, Playwright configuration, e2e spec, cucumber-js feature and steps), commits them on the default branch and remembers them for T-WP7 | phase-import | target repository fixture (SUT input) |
| G-WP5 | `the target repository's default branch has this {string}:` | Writes the doc string at the path and commits it on the default branch | phase-import | target repository fixture (SUT input) |
| G-WP6 | `the {string} agent writes a complete ADW configuration whose {string} declares the application type {string}` | Scripts the stubbed `/adw_init` agent the upgrade runs: it writes every required `.adw/` file and the vocabulary registry, its `.adw/project.md` declaring the type under `## Application Type`. The file named must be `.adw/project.md` | phase-import | stub behaviour (scripted init agent) |
| G-WP7 | `the {string} agent writes a complete ADW configuration whose {string} has no {string} section` | As G-WP6 with no `## Application Type` section; the section named must be that one | phase-import | stub behaviour (scripted init agent) |
| G-WP8 | `the {string} agent writes an ADW configuration with no {string}, whose {string} declares the application type {string}` | As G-WP6; fails if the absent file is one the stubbed agent writes, so the scripted output provably omits it | phase-import | stub behaviour (scripted init agent) |
| G-WP9 | `a fixture framework copied from the ADW framework under test` | Copies the framework's `.claude/commands/` and `templates/` into a throwaway directory and makes it the fixture framework W-HC1 hashes, with an empty list of recorded hashes | phase-import | fixture input (SUT input, not source) |
| G-WP10 | `a workflow for issue {int} whose worktree's {string} declares the application type {string}` | Builds a throwaway workflow for the issue: a `WorkflowConfig` over a fresh temp git worktree whose recording launch boundary stands for the fictional `adw-fixture/void-992`. It models the `.adw/` `adw_init` writes for the type, written just before the phase runs. For a type whose runner mode is ADW's Playwright project it also writes that project's files and a lockfile with no `node_modules`, as a checkout of a regen commit holds them. The file named must be `.adw/project.md` | phase-import | workflow config + worktree fixture (SUT input) |
| G-WP11 | `the worktree's {string} starts a dev server that answers on its health check path` | Sets `.adw/commands.md`'s `## Start Dev Server` to the stand-in dev server, a Node program on `{PORT}` that logs `listening <port>`, each `GET <path>` and `stopped`, and sets its `## Health Check Path` | phase-import | workflow config (SUT input) |
| G-WP12 | `the worktree's {string} runs scenarios by tag with {string}` | Sets `## Run Scenarios by Tag` to the command in both `.adw/commands.md` and `.adw/scenarios.md`, as `adw_init` writes it to both | phase-import | workflow config (SUT input) |
| G-WP13 | `the worktree's {string} runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes` | As G-WP12 with the stand-in scenario command, which records its run (tag, working directory, `ADW_` variables) and writes a passing JUnit report to `$ADW_JUNIT_REPORT_PATH` | phase-import | workflow config (SUT input) |
| G-WP14 | `the worktree's {string} names the BDD framework {string} and the step definition directory {string}` | Sets `.adw/scenarios.md`'s `## BDD Framework` and `## Step Def Directory` | phase-import | workflow config (SUT input) |
| G-WP15 | `the worktree holds a feature tagged {string} in {string} and steps for it in {string}` | Writes a one-scenario feature carrying the tag in the feature directory and a step file for it in the step directory, so the phase finds scenarios and step definitions for the tag | phase-import | worktree fixture (SUT input) |
| G-WP16 | `the worktree holds a feature tagged {string} and steps for it in the step definition directory {string} names` | As G-WP15, with the feature in `features/` and the steps in the step-definition directory `.adw/scenarios.md` names | phase-import | worktree fixture (SUT input) |
| G-WP17 | `{string} is a stand-in that records each run and writes a JUnit report in which every scenario passes` | Scripts the stand-in `npx` (only `npx` is accepted). Each run records argv, working directory, `ADW_` variables and the packages named beside it. As `npx playwright test --grep` it asks the dev server for its health path before and after it holds, writes a JUnit report at `$ADW_JUNIT_REPORT_PATH` in which every scenario passes, and exits 0. The stand-ins lead `PATH` only while the phase runs | phase-import | stub behaviour (stand-in toolchain) |
| G-WP18 | `{string} is a stand-in that records each run, exits 0, and writes a JUnit report in which one scenario fails` | As G-WP17, except that the report for the workflow's issue tag carries one failing scenario while the process still exits 0 | phase-import | stub behaviour (stand-in toolchain) |
| G-WP19 | `{string} is a stand-in that records each run` | As G-WP17 with its default behaviour; used where the rows assert the stand-in stays unrun | phase-import | stub behaviour (stand-in toolchain) |
| G-WP20 | `a web application repository never initialised by ADW, whose dev server serves a page titled {string} at {string} and answers {string} with status {int}` | Creates a throwaway repository whose `package.json` and dev-server program, a small Node HTTP server serving an HTML page with the title at `/` and the status at the health path, are committed. Switches the scenario to the real `npm` and `npx`, which needs network access (`@host-only`) | phase-import | target repository fixture (SUT input) |
| G-WP21 | `the {string} agent writes a complete ADW configuration whose {string} declares the application type {string} and whose {string} starts that dev server` | As G-WP6, the agent also writing `.adw/commands.md` and `.adw/scenarios.md` as `adw_init` would for the type, with `## Start Dev Server` running G-WP20's dev server on `{PORT}` | phase-import | stub behaviour (scripted init agent) |
| G-WP22 | `the framework upgrade has regenerated the repository's ADW configuration` | W-WP1 as a precondition with the real toolchain. The upgrade runs the real `npm install` and `npx playwright install chromium` in `features/`, and the step fails unless the upgrade completed. 600 s timeout | phase-import | upgrade result |
| G-WP23 | `a workflow for issue {int} has a worktree checked out fresh from the regen commit` | Builds the throwaway workflow and points it at a fresh clone of the repository at the regen commit. The clone uses the real git, since the `@regression` git mock no-ops `clone`. Fails unless the clone holds `features/package-lock.json` and no `features/node_modules` | phase-import | workflow config + git artefact (clone) |
| G-WP24 | `the worktree holds a feature tagged {string} in {string} with these scenarios, and steps for them in {string} written with {string} from {string}:` | Writes a feature with one scenario per table row, and a step file whose steps use the registration function (`createBdd()`) from the library (`playwright-bdd`): the `page` fixture opens a path and expects a title, or the `request` fixture requests a path and expects a status | phase-import | worktree fixture (SUT input) |
| W-WP1 | `the framework upgrade regenerates the target repository's ADW configuration` | Records HEAD, then runs the real `executeUpgrade` over the target repository. The `/adw_init` agent is stubbed and the forge, push and pull-request dependencies are recorders. ADW's Playwright project is synced and installed by `syncDeclaredScenarioProject` under the stand-in `npm` and `npx`. Records the result and the comments posted. 60 s timeout | phase-import | upgrade result + regen commit (git artefact) |
| W-WP2 | `ADW's Playwright configuration template in the fixture framework is modified by a single byte` | Flips the first byte of the fixture framework's copy of `templates/playwright/playwright.config.ts.template` | phase-import | fixture input (SUT input, not source) |
| W-WP3 | `the workflow's scenario test phase runs` | Writes the worktree's `.adw/` files. Loads the project config and the application profile the declared type maps to, as `initializeWorkflow` does, and allocates a port for `applicationUrl`. Runs the real `executeScenarioTestPhase(config)` with the stand-ins leading `PATH` (the real toolchain for the `@host-only` row) and `NODE_OPTIONS` cleared. Records the scenario proof it returned. 300 s timeout | phase-import | returned scenario proof + stand-in call log |
| W-WP4 | `the workflow's step-definition phase runs` | Prepares the config as W-WP3, points `CLAUDE_CODE_PATH` at a throwaway Claude CLI that records each run's prompt, then runs the real `executeStepDefPhase(config)`. 300 s timeout | phase-import | throwaway CLI run log |
| T-WP1 | `the upgrade commits the regenerated configuration` | Asserts the upgrade's result is `completed`, showing its outcome, reason and posted comments otherwise, and that HEAD moved past the commit recorded before the run | phase-import | upgrade result + git artefact (HEAD) |
| T-WP2 | `the regen commit's {string} is byte-identical to ADW's Playwright configuration template` | Asserts the path is the file ADW writes from its Playwright configuration template, and that the regen commit's blob at that path has exactly the template's bytes, the template being the upgrade's input | phase-import | git artefact (regen commit blob) |
| T-WP3 | `the regen commit's {string} depends on {string} and {string}` | Parses the regen commit's blob of the manifest and asserts its `dependencies`/`devDependencies` name both packages | phase-import | git artefact (regen commit blob) |
| T-WP4 | `the upgrade installed the packages {string} names, and the Playwright browser, in {string}` | From the stand-ins' call log: asserts `npm install` ran in the directory and found exactly the packages the regen commit's manifest names, and that `npx playwright install` ran there after it | phase-import | recorded stand-in calls + git artefact |
| T-WP5 | `the regen commit holds nothing under {string}` | Asserts no path in the regen commit's tree starts with the directory | phase-import | git artefact (commit tree) |
| T-WP6 | `the regen commit leaves {string} as the default branch has it` | Asserts the file's blob at HEAD equals its blob at the commit recorded before the upgrade | phase-import | git artefact (blobs) |
| T-WP7 | `the regen commit leaves each of those files as the default branch has it` | T-WP6 for every file G-WP4 added, also asserting the default branch held the repository's own content | phase-import | git artefact (blobs) |
| T-WP8 | `the regen commit holds no {string}` | Asserts the path is not in the regen commit's tree | phase-import | git artefact (commit tree) |
| T-WP9 | `the upgrade installed nothing in {string}` | Asserts the stand-ins recorded no run in the directory and that it holds no `node_modules` | phase-import | recorded stand-in calls + install artefact |
| T-WP10 | `{string} ran in {string} before {string} ran there for the tag {string}` | From the call log: asserts the second command ran in the worktree directory for the tag, and that the first ran there before it | phase-import | recorded stand-in calls |
| T-WP11 | `the run of {string} for the tag {string} was given {string} holding the address of the dev server ADW started` | Asserts the dev server listened on the port the workflow was given (its log's last `listening` line), and that the command's run for the tag received the variable holding `http://localhost:<port>` | phase-import | recorded stand-in calls + dev server log |
| T-WP12 | `the run of {string} for the tag {string} was given {string} holding the scenario proof's report path for that tag, and {string} holding a directory of that tag's own inside the scenario proof's artifacts directory` | Asserts the first variable holds the returned proof's report path for the tag (`junit-<tag>.xml` beside the proof file). Asserts the second names a directory inside the proof's `artifactsDir` that no other tag's run was given | phase-import | recorded stand-in calls + returned scenario proof |
| T-WP13 | `the dev server ADW started answered throughout the run of {string} for the tag {string}, and was stopped by the end of the phase` | Asserts the run's recorded health probes answered 200 at its start and its end, then polls until the dev server's port is free again (up to 6 s) | phase-import | recorded probes + port state |
| T-WP14 | `{string} was not run` | Asserts the call log holds no run of the command | phase-import | recorded stand-in calls |
| T-WP15 | `the scenario command {string} configures ran in the worktree's root for the tag {string}` | Asserts the stand-in scenario command ran for the tag with the worktree's root as its working directory | phase-import | recorded stand-in calls |
| T-WP16 | `the step-definition generator was started once, for issue {int}` | From the throwaway CLI's run log: asserts exactly one `/generate_step_definitions` run, whose first quoted argument is the issue number | phase-import | recorded CLI runs |
| T-WP17 | `the step-definition generator was started in the mode for ADW's Playwright project` | Asserts that run's third quoted argument is the `adw_playwright` runner mode | phase-import | recorded CLI runs |
| T-WP18 | `the step-definition generator was started in the mode for the scenario runner that {string} describes` | Asserts that run's third quoted argument is the `descriptor` runner mode; the file named must be `.adw/scenarios.md` | phase-import | recorded CLI runs |
| T-WP19 | `the scenario proof records the tag {string} as passed` | Asserts the returned proof ran the tag and that its result passed and was not skipped, showing the run's exit code and output otherwise | phase-import | returned scenario proof |
| T-WP20 | `the JUnit report of the run for the tag {string} is at the path ADW gave it, and records these scenarios as passed:` | Asserts the report exists at the proof's report path for the tag and records every scenario in the table as passed. Playwright names a case `<feature> › <scenario>` | phase-import | JUnit report (run artefact) |
| T-WP21 | `the JUnit report attaches exactly one image to {string}, and that image is in the scenario proof's artifacts directory` | Asserts the scenario's case lists exactly one image attachment, that the image exists, and that it lies inside the proof's `artifactsDir` | phase-import | JUnit report + proof artefacts |
| T-WP22 | `the JUnit report attaches no image to {string}` | Asserts the scenario's case lists no image attachment | phase-import | JUnit report (run artefact) |
| T-WP23 | `the dev server ADW started served {string} during the run` | Asserts the dev server's request log holds `GET <path>` | phase-import | dev server log |

**Closing reuse paragraph:** "This section also reuses already-registered phrases, so they need no new rows: `the ADW
codebase is checked out` (G18, Background), `the framework content hash is computed for the fixture framework`
(W-HC1), `the recorded hashes are all different` (T-HC3), `the scenario proof records no blocker failures` (T-PY3),
`the scenario proof records a blocker failure for the tag {string}` (T-S12) and `the ADW TypeScript type-check passes`
(T22)."

Then check the result:
- `grep -cE '^\| [GWT]-WP[0-9]+ \|' features/regression/vocabulary.md` prints `51`.
- `grep -E '^\| [GWT]-WP' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u` prints only `7`.

### 11. Update the README
- In the `features/` tree, insert one line between `│   ├── plan-commit/` and `│   ├── rate-limit/`. Pad the name to
  the neighbours' column (`playwright/` plus five spaces):
  `│   ├── playwright/     # Regression scenarios covering web repositories running their Gherkin on ADW's Playwright project: the framework upgrade installing it in features/ byte-identical to its template (beside the repository's own e2e setup, never for cli), the scenario test phase running npx bddgen then npx playwright test with the dev server's address and ADW's report and proof paths, the step-definition phase's runner mode, and a fresh web repository's real run (#992)`
- In the Docker section:
  - Change the comment `# Run @regression scenarios inside the container (same results as host)` to
    `# Run @regression scenarios inside the container (same results as host, less the @host-only scenarios)`.
  - After the paragraph that ends "`TEST_RUNTIME=docker` is set automatically inside the container.", add:
    "Every container run leaves out the scenarios tagged `@host-only`, whatever `--tags` it is given: they install
    ADW's Playwright project from the npm registry with the real `npm` and `npx` and drive a real Chromium, which the
    image (Bun and Git only) cannot, so they run on the host only."
- Leave the pre-existing uncommitted tree lines (`reviewPromptArgs.ts`, `reviewPromptContext.ts`) as they are.
  Change nothing else.

### 12. Re-run the unit coverage
- `bunx vitest run adws/__tests__/regressionWorkflow.test.ts` covers the new `@host-only` container test and the
  unchanged workflow contract.
- `bunx vitest run adws/promotion/__tests__/vocabularyParser.test.ts adws/core/__tests__/adwPlaywrightProject.test.ts adws/core/__tests__/scenarioRunner.test.ts adws/core/__tests__/applicationType.test.ts adws/phases/__tests__/scenarioProjectSetup.test.ts adws/phases/__tests__/stepDefPhase.test.ts`
  covers the registry format and the production seams the promoted scenarios drive.
- `bun run test:unit` runs the full Vitest suite, for zero regressions.

### 13. Run the Validation Commands
- Run every command under `Validation Commands`, in order. Each must succeed with the stated result.
- If a moved scenario fails under `@regression` but passed per-issue, look first at the hook order and the mock
  environment (Edge Cases). Fix the step definitions, never the `.feature` file's steps.

## Testing Strategy
### Unit Tests
- **New: the `@host-only` container exclusion** (`adws/__tests__/regressionWorkflow.test.ts`, Task 9).
  - It runs `test/docker-run.sh` through its public interface with a fake `docker` on `PATH`.
  - For `--tags "@regression"` and `--tags "@web-playwright-project"`, it asserts the container receives
    `BDD_TAGS=(<tags>) and not @host-only` and that the script exits 0.
  - It would fail if the exclusion were dropped, applied to only one of the two `docker run` paths, or applied
    only to the default tags.
- **Unchanged contract:** `regression.yml` still runs `bash test/docker-run.sh --tags "@regression"` (the pinned
  `DOCKER_COMMAND`), and the host job still runs the whole `@regression` suite, `@host-only` included.
- **No unit test for the harness edits.** The hook re-keys, the CLI-restore guard and the `realGit` clone live in
  Cucumber step definitions under `features/`, which `vitest.config.ts` does not include. The promoted scenarios
  exercise all three on every run.
- **Re-run coverage (Task 12):**
  - `vocabularyParser.test.ts` (row format);
  - `adwPlaywrightProject.test.ts`, `scenarioRunner.test.ts`, `applicationType.test.ts`,
    `scenarioProjectSetup.test.ts` and `stepDefPhase.test.ts` (the seams);
  - `bun run test:unit` (everything).

### Edge Cases
- **The hook tag drifts from the feature tag.** If either hook expression missed `@web-playwright-project`, the
  `Before` resets and `After` cleanups would stop silently: the stand-ins, temp directories, `agents/<adwId>` and the
  CLI restore. State would then leak across rows. Task 6's greps and the `--tags "@web-playwright-project"` run pin it.
- **Hook order under `@regression`.**
  - The moved files now register before `support/hooks.ts`.
  - `Before`: the 931 reset and `beginScenario()` touch no variable the mock manages. Then
    `setupMockInfrastructure()` sets `CLAUDE_CODE_PATH`, puts the git mock first on `PATH`, and sets
    `REAL_GIT_PATH` and `GH_*`.
  - `After` runs in reverse registration order. The `@regression` teardown runs first and restores those variables;
    then this feature's `After` runs, which calls `endScenario()` and then `cli.restore()`.
  - Task 7's guard sees a variable that no longer names the throwaway script, and skips the write-back.
  - The stand-ins change `PATH` and `NODE_OPTIONS` only inside the call (`withStandInsOnPath`,
    `withoutNodeOptions`), so nothing else is written back after the teardown.
- **The git mock.** Every harness and upgrade git call is local (`init`, `config`, `add`, `commit`, `show`,
  `ls-tree`, `rev-parse`), and the mock delegates those to real git. Push, PR and remote reconciliation are stub
  dependencies. `clone` was the only intercepted subcommand in the closure, and Task 8 routes it to the real git. Do
  not "fix" it by changing `feature-931.steps.ts`'s shared `git` helper.
- **Network and the host.**
  - The `@host-only` row needs the npm registry and Playwright's browser download on every host that runs
    `@regression`. That includes each ADW workflow's scenario test phase and the daily `host` job, which runs on
    `ubuntu-latest` with Node, npm and Chromium's libraries present.
  - The browser is cached after the first download.
  - If the registry is unreachable, the row fails. On a workflow run, `regressionTriage` sees the same failure on
    the base branch and classifies it as pre-existing.
- **The Docker leg.** `(@regression) and not @host-only` runs 16 of the 17 rows in the container. The stand-in
  programs carry `process.execPath` as their shebang and are plain CommonJS, so they run under whatever runtime
  runs Cucumber there.
- **Per-issue rows that still carry `@adw-992`.**
  - `feature-989.feature:32` (the protected-path outline) never used the upgrade harness. Dropping `@adw-992` from
    `UPGRADE_SCENARIOS` only stops a no-op reset for it.
  - `feature-991.feature:132` still matches through `@adw-991`.
  - Neither ever ran `feature-992-world.ts`'s hooks (excluded by the old `not @adw-989/991`), and neither carries
    the new tag.
- **Inert clauses.** `feature-990-world.ts`'s `(@adw-993 and not @adw-992)` and `feature-995-world.ts`'s
  `and not @adw-992` excluded only the two #992 rows that also carried `@adw-993`/`@adw-995`. Those rows drop both
  tags now, so the clauses are inert but harmless. They are left as they are.
- **Later per-issue sweeps.**
  - #929 (merged 2026-10-01), #931 (2026-10-02) and #988 (2026-10-04) will be swept with their `feature-N.*`
    siblings.
  - Nothing of the closure stays under `features/per-issue/`, so no sweep can delete a module the promoted scenario
    needs.
  - The per-issue importers that do get swept (`feature-929.steps.ts`, `feature-988.steps.ts`) only lose their own
    rows.
- **Module identity.** After repointing, per-issue and regression files import the same absolute paths. They share
  one instance of `toolchain`, the 988 world and the 931 world, exactly as before.
- **A nested run inside ADW's own test phase.** When a workflow's scenario test phase runs `--tags "@regression"`,
  the outer `ADW_JUNIT_REPORT_PATH`/`ADW_PROOF_DIR` belong to the outer run. The inner `executeScenarioTestPhase`
  gives the stand-in workflow's command its own values, so T-WP12 reads the inner ones.
- **Step arguments that look like tags.** `"@adw-9921"`–`"@adw-9927"` are step arguments; Gherkin reads tags only at
  the start of a line. The tag greps therefore use `^\s*@`, and the leftover-tag grep uses `@adw-992([^0-9]|$)`.
- **No new ambiguity.** Files are moved, not copied, and `cucumber.js` loads both step directories whatever the tags.
  The added import is a helper, not a step. The dry runs prove both suites bind every step.
- **Runtime budget.**
  - The 16 stand-in rows each run one upgrade or one phase in seconds. T22 runs `tsc`.
  - The `@host-only` row takes about 1–3 minutes on a cold cache.
  - All of this fits the 30-minute `host` and `docker` job limits.

## Acceptance Criteria
- `features/regression/playwright/feature-992.feature` exists, moved with `git mv`.
  - Its tag lines are exactly line 1, `@regression @web-playwright-project`, and the fresh-repository scenario's
    `  @host-only`.
  - No `@adw-` or `@promotion-suggested-` tag remains at any level.
  - Its only text change besides tags is the two-line host-only description.
- `features/per-issue/feature-992.feature`, every `features/per-issue/step_definitions/feature-992-*` file and the
  seven shared closure modules no longer exist under `features/per-issue/`.
- The 19-file closure lives flat in `features/regression/step_definitions/`, moved with `git mv`.
  - None of its relative import specifiers changed.
  - The content edits are limited to these:
    - the `OWN_SCENARIOS` value and header comment in `feature-992-world.ts`;
    - the `UPGRADE_SCENARIOS` value in `feature-931.steps.ts`;
    - the restore guard and JSDoc in `feature-929-compacting-cli.ts`;
    - in `feature-992-fresh.steps.ts`, the `realGit` clone, its comment, the added `realGit` import, the dropped
      `git` binding and the header sentence.
- The 42 specifiers in the 23 per-issue files point at `../../regression/step_definitions/…`. No `./…` specifier
  for a moved module remains under `features/per-issue/`.
- `grep -rnE "@adw-992([^0-9]|$)" features/regression` prints nothing.
- `test/docker-run.sh` hands every container run `(<tags>) and not @host-only`. The new unit test passes, and
  `regression.yml` is unchanged.
- `features/regression/vocabulary.md` has the `(@web-playwright-project)` section with 51 five-column
  `phase-import` rows: G-WP1–G-WP24, W-WP1–W-WP4 and T-WP1–T-WP23.
  - Each phrase is identical to its step definition's expression.
  - Every expression the feature uses maps to a new row or to G18, W-HC1, T-HC3, T-PY3, T-S12 or T22.
- `README.md` lists `playwright/` between `plan-commit/` and `rate-limit/`, and its Docker section states the
  `@host-only` exclusion.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@web-playwright-project"` runs 17 scenarios (131 steps),
  all passing under the `@regression` hooks.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` is green, includes those 17, and reports no
  ambiguous or undefined step.
- The per-issue features sharing the harness bind every step in a dry run.
- `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build`,
  `bun run test:unit` and `bun run lint:docs-index` pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `test -z "$(find features/per-issue -name 'feature-992*')" && echo MOVED-OK`: prints `MOVED-OK`.
- `test -z "$(ls features/per-issue/step_definitions | grep -E '^feature-(929-compacting-cli|929-workflow|931\.steps|988-commands|988-world|991-project-md|991-upgrade\.steps)\.ts$')" && echo CLOSURE-OK`:
  prints `CLOSURE-OK`.
- `ls features/regression/playwright/feature-992.feature features/regression/step_definitions/feature-992-*.ts features/regression/step_definitions/{feature-929-compacting-cli,feature-929-workflow,feature-931.steps,feature-988-commands,feature-988-world,feature-991-project-md,feature-991-upgrade.steps}.ts | wc -l`:
  prints `20`.
- `grep -nE '^\s*@' features/regression/playwright/feature-992.feature`: prints exactly
  `1:@regression @web-playwright-project` and one `  @host-only` line.
- `! grep -nE '^\s*(@[^ ]+ +)*@(adw-|promotion-suggested)' features/regression/playwright/feature-992.feature`: no
  per-issue or promotion tag remains.
- `! grep -rnE "@adw-992([^0-9]|$)|adw-2u517h" features/regression`: no per-issue #992 tag in the moved feature or
  its step definitions.
- `grep -c "const OWN_SCENARIOS = '@web-playwright-project';" features/regression/step_definitions/feature-992-world.ts`:
  prints `1`.
- `grep -c "const UPGRADE_SCENARIOS = '@adw-931 or @adw-991 or @web-playwright-project';" features/regression/step_definitions/feature-931.steps.ts`:
  prints `1`.
- `grep -n "=== scriptPath" features/regression/step_definitions/feature-929-compacting-cli.ts`: prints the guard
  line.
- `grep -n "realGit(checkout, 'clone'" features/regression/step_definitions/feature-992-fresh.steps.ts`: prints the
  clone line.
- `! grep -rnE "from '\./feature-(929-compacting-cli|929-workflow|931\.steps|988-commands|988-world|991-project-md|991-upgrade\.steps|992-[a-z-]+(\.steps)?)\.ts'" features/per-issue`:
  no stranded specifier.
- `grep -c 'and not @host-only' test/docker-run.sh`: prints at least `1`, and
  `grep -c 'BDD_TAGS=${CONTAINER_TAGS}' test/docker-run.sh` prints `2`.
- `grep -cE '^\| [GWT]-WP[0-9]+ \|' features/regression/vocabulary.md`: prints `51`.
- `grep -E '^\| [GWT]-WP' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u`: prints only `7`.
- Every expression the moved feature uses is registered in backticks. The command prints `VOCAB-OK`, or lists each
  `UNREGISTERED:` phrase and exits non-zero:
  ```sh
  missing=$(printf '%s\n' \
    'the ADW codebase is checked out' \
    'a target repository never initialised by ADW' \
    'a target repository never initialised by ADW whose only manifest is {string}' \
    'a target repository initialised by an older framework version' \
    "the target repository's default branch has these files of its own:" \
    "the target repository's default branch has this {string}:" \
    'the {string} agent writes a complete ADW configuration whose {string} declares the application type {string}' \
    'the {string} agent writes a complete ADW configuration whose {string} has no {string} section' \
    'the {string} agent writes an ADW configuration with no {string}, whose {string} declares the application type {string}' \
    'a fixture framework copied from the ADW framework under test' \
    "a workflow for issue {int} whose worktree's {string} declares the application type {string}" \
    "the worktree's {string} starts a dev server that answers on its health check path" \
    "the worktree's {string} runs scenarios by tag with {string}" \
    "the worktree's {string} runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes" \
    "the worktree's {string} names the BDD framework {string} and the step definition directory {string}" \
    'the worktree holds a feature tagged {string} in {string} and steps for it in {string}' \
    'the worktree holds a feature tagged {string} and steps for it in the step definition directory {string} names' \
    '{string} is a stand-in that records each run and writes a JUnit report in which every scenario passes' \
    '{string} is a stand-in that records each run, exits 0, and writes a JUnit report in which one scenario fails' \
    '{string} is a stand-in that records each run' \
    'a web application repository never initialised by ADW, whose dev server serves a page titled {string} at {string} and answers {string} with status {int}' \
    'the {string} agent writes a complete ADW configuration whose {string} declares the application type {string} and whose {string} starts that dev server' \
    "the framework upgrade has regenerated the repository's ADW configuration" \
    'a workflow for issue {int} has a worktree checked out fresh from the regen commit' \
    'the worktree holds a feature tagged {string} in {string} with these scenarios, and steps for them in {string} written with {string} from {string}:' \
    "the framework upgrade regenerates the target repository's ADW configuration" \
    'the framework content hash is computed for the fixture framework' \
    "ADW's Playwright configuration template in the fixture framework is modified by a single byte" \
    "the workflow's scenario test phase runs" \
    "the workflow's step-definition phase runs" \
    'the upgrade commits the regenerated configuration' \
    "the regen commit's {string} is byte-identical to ADW's Playwright configuration template" \
    "the regen commit's {string} depends on {string} and {string}" \
    'the upgrade installed the packages {string} names, and the Playwright browser, in {string}' \
    'the regen commit holds nothing under {string}' \
    'the regen commit leaves {string} as the default branch has it' \
    'the regen commit leaves each of those files as the default branch has it' \
    'the regen commit holds no {string}' \
    'the upgrade installed nothing in {string}' \
    'the recorded hashes are all different' \
    '{string} ran in {string} before {string} ran there for the tag {string}' \
    'the run of {string} for the tag {string} was given {string} holding the address of the dev server ADW started' \
    "the run of {string} for the tag {string} was given {string} holding the scenario proof's report path for that tag, and {string} holding a directory of that tag's own inside the scenario proof's artifacts directory" \
    'the dev server ADW started answered throughout the run of {string} for the tag {string}, and was stopped by the end of the phase' \
    'the scenario proof records no blocker failures' \
    'the scenario proof records a blocker failure for the tag {string}' \
    '{string} was not run' \
    "the scenario command {string} configures ran in the worktree's root for the tag {string}" \
    'the step-definition generator was started once, for issue {int}' \
    "the step-definition generator was started in the mode for ADW's Playwright project" \
    'the step-definition generator was started in the mode for the scenario runner that {string} describes' \
    'the scenario proof records the tag {string} as passed' \
    'the JUnit report of the run for the tag {string} is at the path ADW gave it, and records these scenarios as passed:' \
    "the JUnit report attaches exactly one image to {string}, and that image is in the scenario proof's artifacts directory" \
    'the JUnit report attaches no image to {string}' \
    'the dev server ADW started served {string} during the run' \
    'the ADW TypeScript type-check passes' \
    | while read -r phrase; do grep -qF -- "\`$phrase\`" features/regression/vocabulary.md || echo "UNREGISTERED: $phrase"; done); [ -z "$missing" ] && echo VOCAB-OK || { printf '%s\n' "$missing"; false; }
  ```
- `bunx tsc --noEmit`: the root type-check passes. Its `include` is `**/*.ts`, so it covers `features/**` and proves
  every moved and repointed import resolves.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run lint`: the linter passes; it lints `features/**` too.
- `bun run build`: the build succeeds.
- `bunx vitest run adws/__tests__/regressionWorkflow.test.ts`: the workflow contract and the new `@host-only`
  container test pass.
- `bunx vitest run adws/promotion/__tests__/vocabularyParser.test.ts adws/core/__tests__/adwPlaywrightProject.test.ts adws/core/__tests__/scenarioRunner.test.ts adws/core/__tests__/applicationType.test.ts adws/phases/__tests__/scenarioProjectSetup.test.ts adws/phases/__tests__/stepDefPhase.test.ts`:
  the registry format and the seams the scenarios drive pass.
- `bun run test:unit`: the unit suite passes with zero regressions.
- `bun run lint:docs-index`: the living-docs index stays clean. `features/regression/**`, `features/per-issue/**`
  and `test/docker-run.sh` all remain owned.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@web-playwright-project" --dry-run`: 17 scenarios and 131
  steps, with no undefined and no ambiguous step.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-929 or @adw-931 or @adw-988 or @adw-989 or @adw-990 or @adw-991 or @adw-993 or @adw-994 or @adw-995" --dry-run`:
  the per-issue features that share the moved harness still bind every step, with no undefined and no ambiguous
  step.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@web-playwright-project and not @host-only"`: 16 scenarios
  (16 passed), 119 steps (119 passed). These are the stand-in rows, run fast and offline under the `@regression`
  hooks.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@web-playwright-project"`: 17 scenarios (17 passed), 131 steps
  (131 passed). The `@host-only` row needs network access.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run`: the whole regression suite binds
  every step, with no undefined and no ambiguous step.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the full regression suite is green and
  includes the moved feature. This is the primary acceptance command.

## Notes
- **Coding guidelines.** Adhere strictly to `.adw/coding_guidelines.md`.
  - Apart from Markdown and moves, the TypeScript diff is:
    - two hook-tag strings and one rewritten header comment;
    - the restore guard and its comment and JSDoc;
    - the `realGit` clone, its comment, one added import, one dropped binding and one header sentence;
    - 42 specifier strings in per-issue files;
    - the new unit test.
  - Per **Comments**, the new comments state constraints only and cite no issue number.
  - Keep every file under 300 lines; `feature-931.steps.ts` must stay at 296.
- **No new library.** Nothing is installed. If one were ever needed, `.adw/commands.md` names `bun add <package>`.
- **`hitl` is set.** The PR must be human-approved, so do not auto-merge it. Its `regression-promotion` label
  triggers the non-blocking rot/reuse advisory comment. Once the PR merges, the promotion sweep reconciles through
  the issue's `Promotes: feature-992` back-link and reaches `done`.
- **Decision for the reviewer: `@host-only`.** The issue lists the fresh-repository scenario's phrases, so it is
  promoted. It is also the first `@regression` row that needs network access and real third-party tooling, which
  the Docker image (Bun + Git) cannot provide.
  - This plan keeps it on the host and leaves it out of every container run through `docker-run.sh`, with
    `regression.yml` untouched.
  - The alternative is to drop that one scenario from the promotion and keep the 16 hermetic rows. That loses the
    only end-to-end guard on the real template, `bddgen` and the screenshot attachment. Flag it in the PR
    description so the reviewer can choose.
- **Documentation follows in the document phase,** as in #1000–#1006. The build changes only the README.
  - `app_docs/feature-9gjajh-bdd-regression-suite.md` gains several things:
    - a `playwright/` maintain-bullet and an ownership bullet for the 19-file closure;
    - `@web-playwright-project` (`feature-992`) in the line-119 list of promoted hook tags;
    - the `@host-only` Docker rule;
    - a note that the git mock also no-ops a local `clone`, extending line 125.
  - `.adw/conditional_docs.md` gains a condition for the promoted scenario.
  - Leave all of this to the document phase unless the reviewer asks otherwise.
- **The pre-existing README change.** The worktree's `README.md` already held two uncommitted tree lines
  (`reviewPromptArgs.ts`, `reviewPromptContext.ts`) when planning started. Both files exist. Do not revert them;
  they will be committed with this change.
- **Phrase reuse for future authors.** The G-WP/W-WP/T-WP phrases are bound to the moved harness's module-scoped
  worlds. A regression scenario reusing them must carry `@web-playwright-project`. A per-issue scenario may reuse
  them only under a tag the moved hooks list (`@adw-931`/`@adw-991` for the upgrade rows).
- **Per-issue scenarios for this issue.** If the scenario phase writes `features/per-issue/feature-1032.feature`, it
  must not redefine any moved phrase. A second definition is an AmbiguousStepDefinition that fails the whole
  `@regression` run.
- **Optional Docker check.** If `docker` is available, `bash test/docker-run.sh --tags "@web-playwright-project"`
  should run 16 scenarios in the container, all passing. Report it if run; it is not required.
