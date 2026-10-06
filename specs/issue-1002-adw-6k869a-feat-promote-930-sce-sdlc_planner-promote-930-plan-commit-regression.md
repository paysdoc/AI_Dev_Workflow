# Feature: Promote the #930 plan-commit scenario, with its four-file step-definition closure, into the @regression suite

## Metadata
issueNumber: `1002`
adwId: `6k869a-feat-promote-930-sce`
issueJson: `{"number":1002,"title":"feat: promote #930 scenario into the @regression suite","body":"Promotes: feature-930\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-930` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-930.feature features/regression/<subdir>/feature-930.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-930.steps.ts features/regression/step_definitions/feature-930.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-930.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-930.steps.ts`\n\n## Phrases to register\n\n- `a worktree for a workflow on issue 4242 in the target repository \"acme/widgets\"`\n- `the worktree's branch tracks these files:`\n- `the worktree has uncommitted changes to these files:`\n- `the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit`\n- `the planner writes the plan file and makes these changes in the worktree:`\n- `the plan phase runs`\n- `the plan phase completes`\n- `the commits added during the plan phase carry the plan file and no other path`\n- `the worktree still has uncommitted changes to these files:`\n- `worktree setup has left these changes in the worktree:`\n- `the planner writes only the plan file`\n- `the plan phase fails with an error that names \"<path>\"`\n- `no commit added during the plan phase carries \"<path>\"`\n- `the planner writes the plan file, modifies \".claude/commands/scenario_writer.md\" and commits everything itself`\n- `the plan phase fails with an error that names \".claude/commands/scenario_writer.md\"`\n- `the \"<agent>\" commits its work through the commit agent, as its phase does`\n- `the commit recorded on the worktree branch carries these files:`\n- `a worktree of the framework's own repository whose branch carries a newer \"<path>\" than the framework checkout running the workflow`\n- `worktree setup copies the framework's Claude assets into the worktree`\n- `the worktree's \"<path>\" is the copy its branch carries`\n- `the worktree has no uncommitted change to \"<path>\"`\n- `a worktree of a target repository that tracks nothing under \".claude/\"`\n- `git lists \".claude/commands/feature.md\" among the worktree's ignored files`\n- `git lists \".claude/commands/install.md\" among the worktree's untracked files that are not ignored`\n- `the ADW TypeScript type-check passes`\n- `the git/gh guard is run across the repository`\n- `the git/gh guard reports no violations`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-930.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-04T15:36:09Z","comments":[],"actionableComment":null}`

## Feature Description
`features/per-issue/feature-930.feature` pins ADR-0056 (`specs/adr/0056-planner-commits-only-the-plan.md`), the decision that came out of two incidents where a plan commit silently reverted a prompt change made minutes earlier. The feature has nine scenarios and outlines, 21 test cases in all. They check four things:
- the plan commit carries the plan file and nothing else;
- the plan-phase guard (`planCommitGuard.ts`) fails the phase when the planner changes, creates, deletes or commits anything under `.claude/` or `.adw/`;
- every other phase's commit agent still commits every change, `.claude/` and `.adw/` included;
- worktree setup (`copyClaudeAssetsToWorktree`) leaves the framework's own tracked Claude assets as the branch has them, and still copies, and gitignores where appropriate, the assets of a target repository that tracks none.

The last two scenarios are the type-check and git/gh-guard backstops.

Today these scenarios run only in #930's own workflow, by `@adw-930`, and that workflow has merged (PR #956). Nothing re-runs them, so a regression in the plan commit, the guard or worktree setup would go unnoticed. The promotion sweep scored the file and filed this issue. This feature relocates it into the executed `@regression` suite:
- move the feature to `features/regression/plan-commit/feature-930.feature`;
- move its whole step-definition closure (four files) to `features/regression/step_definitions/`;
- retag it `@regression @plan-commit-guard`;
- re-key its hooks to `@plan-commit-guard`;
- register its 23 novel phrases in `features/regression/vocabulary.md`;
- add the new subdirectory to the README's `features/` tree.

## User Story
As an ADW maintainer
I want the plan-commit, plan-phase-guard and worktree-setup scenarios of #930 to run in the standing `@regression` suite
So that a change that lets a plan commit carry anything but the plan file, or that lets worktree setup overwrite the framework's own tracked prompts, fails the daily regression run instead of quietly reverting someone's prompt change again.

## Problem Statement
- Per-issue scenarios run only under their own `@adw-{N}` tag, so #930's 21 test cases no longer guard anything now that #930 has merged. Twelve other merged issues have already been through this.
- The issue names one step-definition file, `feature-930.steps.ts`, which the sweep matches with its `feature-N.` sibling rule. The scenario actually depends on four files:
  - `feature-930.steps.ts` imports `./feature-930-fixtures.ts` and `./feature-930-plan-fixture.ts`;
  - `feature-930-worktree-setup.steps.ts` defines the six worktree-setup phrases;
  - `feature-930-plan-fixture.ts` also imports `./feature-930-fixtures.ts`.

  Moving only the named file breaks Cucumber's whole module load. Leaving the siblings behind leaves dead fixtures in `features/per-issue/`, and the acceptance requires "its step-def siblings" to be gone.
- Four hooks (a `Before` and an `After` in each of the two step files) are keyed on `@adw-930`, and the promoted feature must carry no `@adw-` tag.
- Moving the step files changes when their hooks run, so one hook would restore the wrong value. The steps currently sit in the last `import` glob of `cucumber.js`. After the move they are in the regression step-definition glob, which loads before `features/regression/support/hooks.ts`. Cucumber 12 runs `After` hooks in reverse registration order (`makeAfterHookSteps` in `@cucumber/cucumber/lib/assemble/assemble_test_cases.js`). With the new `@regression` tag, the sequence is:
  1. The `@regression` `Before` (`setupMockInfrastructure`) points `CLAUDE_CODE_PATH` at the shared stub.
  2. The stand-in step saves that stub path and installs its wrapper.
  3. The `@regression` `After` (teardown) restores the original value.
  4. Only then does feature-930's own `After` run `restoreClaudeCli()`, writing the saved stub path back.

  The result: `CLAUDE_CODE_PATH` stays pointing at `test/mocks/claude-cli-stub.ts` for every later scenario in the Cucumber process. Re-keying alone keeps that hook running, but in its new position it restores the wrong value.
- The issue lists 27 phrases. Two of them are the same expression (`the plan phase fails with an error that names {string}`). Three are already registered: T22, W16 and T34. The Background's G18 is registered too. Registering those again would duplicate registry rows.

## Solution Statement
- **Relocate.** Move the feature to `features/regression/plan-commit/feature-930.feature` with `git mv`. The new subdirectory is named after its subject, like `pause-queue/` and `upgrade/`. Move all four step-definition modules into `features/regression/step_definitions/`, the same flat shape #537, #729, #910 and #911 used.
  - Both step-definition directories are three levels below the repository root, so `../../../adws/...`, `./feature-930-*.ts` and the fixture's `FRAMEWORK_ROOT = …'../../..'` all resolve unchanged. No import specifier is touched.
  - No other file imports these modules: `features/per-issue/feature-938.feature` names `feature-930-plan-fixture.ts` only in prose. Nothing needs re-pointing.
- **Retag.** Line 1 becomes `@regression @plan-commit-guard`. That drops `@adw-930` and `@adw-e3523g-bug-the-plan-commit`, and also the `@promotion-suggested-2026-10-04` marker: every promoted regression feature carries only `@regression @<descriptive-tag>`, and the marker only means something under `features/per-issue/`. Delete the nine scenario-level tag lines, which hold only `@adw-930`, `@adw-e3523g-bug-the-plan-commit` and `@adw-963`. #963 merged in PR #975, and no hook anywhere is keyed on `@adw-963`. Every other line of the feature stays byte-identical.
- **Re-key the hooks.** In both step files, change `{ tags: '@adw-930' }` to `{ tags: '@plan-commit-guard' }`. No per-issue file carries `@adw-930`, so no `@adw-930` alternative is kept, unlike the pause-queue hooks.
- **Make the stand-in's restore order-independent.** In `feature-930-plan-fixture.ts`, `restoreClaudeCli()` should put the saved `CLAUDE_CODE_PATH` back only while the variable still names the stand-in's own wrapper. Otherwise it should only clear the CLI path cache and reset its state.
  - Under `@regression` the suite's teardown has already restored the variable by then, so nothing leaks.
  - In any ordering where feature-930's `After` runs first, it restores the stub path and the teardown then restores the original. That is the behaviour today.
- **Register the vocabulary.** Add one new section, `## Given/When/Then — Plan Commit Guard and Worktree Setup (@plan-commit-guard)`, at the end of `features/regression/vocabulary.md`. It holds 23 rows: G-PC1–G-PC10, W-PC1–W-PC3 and T-PC1–T-PC10. Each row uses the step's cucumber-expression form, which the promotion scorer matches as wildcards, so the registry matches any issue number, path or agent. Each row describes the runtime artefact it asserts on. A reuse note covers G18, T22, W16 and T34. The `## Given…` heading keeps the section inside `vocabularyParser.ts`'s parse, and every row keeps the five-column shape.
- **Document.** Add one README tree line for `features/regression/plan-commit/`.
- **Prove it.** These checks show the change is a pure promotion:
  - the 21 test cases pass under `--tags "@regression and @plan-commit-guard"`;
  - the full `@regression` run grows by exactly 21 scenarios with nothing new failing;
  - the whole-tree dry-run is unchanged and has no ambiguous step;
  - every step of the moved feature matches a registry row.

## Relevant Files
Use these files to implement the feature:

- `README.md`: its `features/` tree (around lines 1171–1187) lists one line per regression subdirectory. Add `plan-commit/` between `pause-queue/` and `smoke/`. **This worktree already has an unrelated, uncommitted README modification**: catch-up lines in the `adws/**/__tests__/` tree, which match the files that exist. It is not part of this feature, so don't revert it and don't extend it.
- `.adw/coding_guidelines.md`: the only code change is the small `restoreClaudeCli()` edit. It must follow these guidelines: guard clauses, nesting depth of 2 or less, no `any`, and a comment only for the non-obvious hook-ordering reason, with no issue numbers.
- `cucumber.js`: its `paths` and `import` globs. Every step-definition directory is imported in every run, so the move adds and removes no definitions. It only changes registration order: `features/regression/step_definitions/**` loads before `features/regression/support/**`, and both load before `features/per-issue/step_definitions/**`.
- `features/per-issue/feature-930.feature`: the feature to move and retag.
- `features/per-issue/step_definitions/feature-930.steps.ts`: plan-phase and commit-agent steps. Move it, then re-key its `Before`/`After` (lines 30 and 34).
- `features/per-issue/step_definitions/feature-930-worktree-setup.steps.ts`: worktree-setup steps. Move it, then re-key its `Before`/`After` (lines 33 and 37).
- `features/per-issue/step_definitions/feature-930-plan-fixture.ts`: the plan fixture and the Claude CLI stand-in. Move it, then make `restoreClaudeCli()` order-independent (lines 83–107).
- `features/per-issue/step_definitions/feature-930-fixtures.ts`: git fixtures. Move it unchanged.
- `features/regression/vocabulary.md`: the registry. Append the new section. Its rubric (lines 3–14) and the `@pause-queue-ownership` section (lines 243–310) show the style to follow.
- `features/regression/support/hooks.ts`: read only. Its `@regression` `Before`/`After` (mock infrastructure) will now wrap the moved scenarios, and it registers after the moved hooks.
- `test/mocks/test-harness.ts`: read only. `setupMockInfrastructure` saves `CLAUDE_CODE_PATH`, sets it to the stub, prepends the git mock to `PATH`, and sets `GH_TOKEN`/`GH_HOST`/`MOCK_*`. Teardown restores them.
- `test/mocks/git-remote-mock.ts`: read only. It intercepts only `push`, `fetch`, `clone`, `pull` and `ls-remote`, and passes every other subcommand to real git with `stdio: 'inherit'` and the real exit status. These scenarios use none of the network subcommands.
- `features/regression/support/claudeCliStub.ts`: read only. `pointClaudeCodeAtStub` is the suite's own pattern for restoring `CLAUDE_CODE_PATH` (via `World.cleanup`, before teardown), and the reference for the ordering issue.
- `features/regression/step_definitions/givenSteps.ts` (G18), `whenSteps.ts` (W16) and `thenSteps.ts` (T22, T34): read only. These already-registered definitions are reused by the moved feature.
- `adws/promotion/vocabularyParser.ts`, `adws/promotion/promotionScorer.ts` and `adws/promotion/scenarioParser.ts`: read only. They define the registry row format, the `## Given|When|Then` section rule, and the `{string}`→`.*` / `{int}`→`\d+` matching that the registry-coverage check mirrors.
- `adws/checkGitGhGuard.ts`: read only. `EXEMPT_DIR_NAMES` exempts the whole `features` tree, so the fixtures' direct `git` calls and `new GitContext(...)` stay outside the guard in either location.
- `adws/phases/planPhase.ts`, `adws/phases/planCommitGuard.ts`, `adws/agents/gitAgent.ts` and `adws/phases/worktreeSetup.ts`: read only. This is the code under test, and none of it changes.
- `adws/core/promotionIssueBody.ts`: read only. It produced this issue's instructions.

### Relevant Documentation (matched via `.adw/conditional_docs.md`)
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: matched by "manually promoting a `features/per-issue/` scenario into `features/regression/`". It sets the rules this plan follows: the dependency closure moves without import rewrites, every regression step phrase is registered, hooks are re-keyed to a descriptive tag, and the mock infrastructure is transparent to local git.
- `app_docs/feature-9gjajh-bdd-per-issue.md`: it owns `features/per-issue/**`, where the five files are removed.
- `app_docs/feature-9gjajh-build-and-plan-phases.md`: matched by the plan commit (plan-file-only commit, `PlanCommitGuardError`), the behaviour the promoted scenarios pin.
- `app_docs/feature-9gjajh-worktree-and-vcs.md`: matched by `copyClaudeAssetsToWorktree` "leaving the framework's own tracked `.claude/` assets untouched", the behaviour the worktree-setup scenarios pin.
- `app_docs/feature-9gjajh-promotion-system.md`: matched by the #734-shaped promotion issue body and the sweep's reconcile once the promotion PR merges.
- `specs/adr/0056-planner-commits-only-the-plan.md` and `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: the decisions behind the scenario and behind the registry.

### New Files
These are all `git mv` renames. Content stays the same except for the edits named in the tasks.
- `features/regression/plan-commit/feature-930.feature`
- `features/regression/step_definitions/feature-930.steps.ts`
- `features/regression/step_definitions/feature-930-worktree-setup.steps.ts`
- `features/regression/step_definitions/feature-930-plan-fixture.ts`
- `features/regression/step_definitions/feature-930-fixtures.ts`

## Implementation Plan
### Phase 1: Foundation
Record the starting state before anything moves:
- `@adw-930` is green on the unmodified tree;
- the whole-tree dry-run totals, with their undefined and ambiguous counts;
- the `@regression` dry-run scenario count;
- the result of a real `@regression` run.

Every later expectation is stated against these baselines, so a pre-existing failure can't be mistaken for one this change introduced.

### Phase 2: Core Implementation
1. `git mv` the feature and the four-file step-definition closure.
2. Retag the feature.
3. Re-key the four hooks to `@plan-commit-guard`.
4. Make `restoreClaudeCli()` order-independent.
5. Append the vocabulary section.

### Phase 3: Integration
1. Add the README tree line.
2. Prove load integrity: same whole-tree totals, no ambiguity, `@adw-930` selects 0 test cases, `@plan-commit-guard` selects 21.
3. Prove the 21 green under `@regression`, with the full `@regression` suite unchanged apart from the 21 additions.
4. Prove registry coverage.
5. Run the static checks and unit tests.
6. Confirm the old paths are gone and the change set is scoped.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Confirm the starting state
- On the unmodified tree, run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-930"`. Expected: `21 scenarios (21 passed)`. If anything fails, the failure predates this change. Record it and investigate before moving anything, because the acceptance needs these scenarios green under `@regression`.
- Record `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: total scenarios, plus the undefined and ambiguous counts.
- Record `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@regression" --format summary`: the regression scenario count, R.
- Record a real `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary` run, noting any pre-existing non-passing scenario by name.
- Never run two Cucumber processes from this checkout at once. The suite shares `agents/` state, spawn locks and `agents/paused_queue.json` under the checkout.

### Task 2: Relocate the feature file
- `mkdir -p features/regression/plan-commit`
- `git mv features/per-issue/feature-930.feature features/regression/plan-commit/feature-930.feature`

### Task 3: Relocate the step-definition closure without touching its imports
- `git mv features/per-issue/step_definitions/feature-930.steps.ts features/regression/step_definitions/feature-930.steps.ts`
- `git mv features/per-issue/step_definitions/feature-930-worktree-setup.steps.ts features/regression/step_definitions/feature-930-worktree-setup.steps.ts`
- `git mv features/per-issue/step_definitions/feature-930-plan-fixture.ts features/regression/step_definitions/feature-930-plan-fixture.ts`
- `git mv features/per-issue/step_definitions/feature-930-fixtures.ts features/regression/step_definitions/feature-930-fixtures.ts`
- Don't edit any `import` line. `../../../adws/...`, `./feature-930-fixtures.ts`, `./feature-930-plan-fixture.ts` and `FRAMEWORK_ROOT`'s `'../../..'` resolve exactly as before, because both directories are three levels deep.
- Don't reformat or refactor the moved files, and keep their header comments. Tasks 5 and 6 are the only content edits.

### Task 4: Retag the moved feature
- Replace line 1 (`@adw-930 @adw-e3523g-bug-the-plan-commit @promotion-suggested-2026-10-04`) with exactly `@regression @plan-commit-guard`.
- Delete the nine scenario-level tag lines. In the source file they are lines 26, 50, 70, 94, 105, 137, 149, 156 and 160, and each holds only `@adw-930 @adw-e3523g-bug-the-plan-commit`, three of them followed by `@adw-963`. Each scenario keeps the blank line above it, with no leftover indented empty line.
- Leave everything else byte-identical: the `Feature:` title, the ADR-0056 description, the Background (`Given the ADW codebase is checked out`), every step, data table and `Examples` table.
- Check: `grep -cE "@adw-|@promotion-suggested-" features/regression/plan-commit/feature-930.feature` prints `0`.

### Task 5: Re-key the four hooks to the descriptive tag
- In `features/regression/step_definitions/feature-930.steps.ts`, change `Before({ tags: '@adw-930' }, …)` and `After({ tags: '@adw-930' }, …)` to `{ tags: '@plan-commit-guard' }`. Leave the bodies unchanged.
- Make the same change in `features/regression/step_definitions/feature-930-worktree-setup.steps.ts`.
- The feature-level `@plan-commit-guard` reaches all 21 test cases, so all four hooks still run for each, as `@adw-930` did. No other file carries `@adw-930`, so no alternative tag is needed.

### Task 6: Make the stand-in's `CLAUDE_CODE_PATH` restore order-independent
- In `features/regression/step_definitions/feature-930-plan-fixture.ts`, replace the `claudeCliReplaced` boolean with the stand-in's own wrapper path, or `null` when no stand-in is installed. Set it in `installClaudeCliStandIn` to the `scriptPath` it writes.
- `restoreClaudeCli()` becomes:
  1. Return when no stand-in is installed (as today).
  2. Put `savedClaudeCodePath` back, deleting the variable when it was `undefined`, only when `process.env['CLAUDE_CODE_PATH']` still equals the stand-in's path.
  3. Always call `clearClaudeCodePathCache()`, and reset the state to `null`.
- Add one short comment for the ordering constraint, which is the reason for this change: Cucumber runs `After` hooks in reverse registration order, so the `@regression` teardown, registered after this file, has usually restored the variable already. No issue numbers. Keep nesting at depth 2 or less, and no `any`.
- The public surface (`installClaudeCliStandIn`, `restoreClaudeCli`) and the `After` hook's call stay as they are.

### Task 7: Register the vocabulary in `features/regression/vocabulary.md`
- Append, after the "Smoke processes" section's closing reuse paragraph, a `---` line, a blank line, and the section below. Use the same five-column table as every other section. No cell may contain a `|`. Keep the `## Given/When/Then — …` heading so `vocabularyParser.ts` reads the rows.

```md
## Given/When/Then — Plan Commit Guard and Worktree Setup (@plan-commit-guard)

These phrases drive three production entry points in-process (phase-import pattern): the plan phase
(`executePlanPhase`), the commit agent (`runCommitAgent`) and worktree setup's copy of the
framework's Claude assets (`copyClaudeAssetsToWorktree`). Their inputs are fixtures the steps build
under `os.tmpdir()`: real git repositories with a real `GitContext`, a fixture framework checkout
handed to worktree setup as its `frameworkRepoRoot`, and the Claude CLI stub
(`test/mocks/claude-cli-stub.ts`) behind a wrapper whose manifest lives outside the worktree, so the
stub's own files never ride in a commit that stages everything. The stub stages and commits every
change whenever it is asked to commit, as `/commit` does, so only the plan phase's own code can keep
the plan commit to the plan file. Every assertion targets a runtime artefact: the error the phase
threw, or its absence; the commits the worktree branch gained since the When step recorded its head;
the worktree's `git status`; git's ignored and untracked listings; and a worktree file compared with
the blob its branch records. No step reads, greps or parses a source file, satisfying the
Rot-Detection Rubric. The definitions live in `feature-930.steps.ts` and
`feature-930-worktree-setup.steps.ts`, over the fixtures in `feature-930-fixtures.ts` and
`feature-930-plan-fixture.ts`; their `Before`/`After` hooks are keyed on `@plan-commit-guard`.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-PC1 | `a worktree for a workflow on issue {int} in the target repository {string}` | Makes a throwaway root under `os.tmpdir()` holding a real git repository, `worktree/`, on the branch `feature-issue-<N>-plan-commit` with one empty commit under a fixed test identity, and a real `GitContext` for the given `owner/repo` (not self-host, a literal token, the throwaway root as framework root and target-repos directory). Picks a fresh adwId, whose plan file is `specs/issue-<N>-adw-<adwId>-sdlc_planner-plan-only.md`. The After hook removes the root and the adwId's `agents/` and `logs/` directories | phase-import | worktree artefact (throwaway git repository) |
| G-PC2 | `the worktree's branch tracks these files:` | Writes each `path` row as `<path> as the branch has it` and commits them all in one commit on the worktree's branch | phase-import | git artefact (commit on the worktree branch) |
| G-PC3 | `the worktree has uncommitted changes to these files:` | Appends a line to each `path` row's file, leaving an unstaged change to a file the branch tracks | phase-import | worktree artefact (uncommitted change) |
| G-PC4 | `the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit` | Points `CLAUDE_CODE_PATH` at a `/bin/sh` wrapper in the throwaway root that runs the Claude CLI stub with no stream delay and a manifest kept outside the worktree, named in the wrapper because the agent runner drops `MOCK_*` variables. The manifest carries the planner's payload (`test/fixtures/jsonl/payloads/plan-agent.json`), the edits, deletions and stagings the planner Givens add, and `onCommitCommand: stage-all-and-commit`, so every `/commit` stages every change in the worktree and commits it. Clears the CLI path cache; the After hook puts the previous value back unless the `@regression` After hook already has | phase-import | stub behaviour (SUT input) |
| G-PC5 | `the planner writes the plan file and makes these changes in the worktree:` | Adds the plan file to the stand-in's edits, then one change per `change`/`path` row: `creates` writes a new file, `modifies` appends to the file, `modifies and stages` also stages it, `deletes` removes it. The stand-in makes them when the plan phase runs the planner | phase-import | stub behaviour (SUT input) |
| G-PC6 | `worktree setup has left these changes in the worktree:` | Makes each `change`/`path` row's change in the worktree before the plan phase, as worktree setup's copy would: `creates` writes a new file, `modifies` appends a stale-copy line to a tracked one. Any other change fails the step | phase-import | worktree artefact (uncommitted change) |
| G-PC7 | `the planner writes only the plan file` | Adds the plan file, and nothing else, to the stand-in's edits | phase-import | stub behaviour (SUT input) |
| G-PC8 | `the planner writes the plan file, modifies {string} and commits everything itself` | Adds the plan file and a modification of the named path to the stand-in's edits, and has the stand-in stage and commit everything in the worktree during the planner's own run, before the plan phase commits anything | phase-import | stub behaviour (SUT input) |
| G-PC9 | `a worktree of the framework's own repository whose branch carries a newer {string} than the framework checkout running the workflow` | Makes a throwaway root holding a worktree repository whose one commit carries the named path (`target: false` frontmatter, a body naming it the branch's newer copy), and a fixture framework checkout: a git repository on `main` with the `origin` `https://github.com/acme/framework.git`, holding older copies of `.claude/commands/scenario_writer.md` and `.claude/skills/tdd/SKILL.md`, plus `.claude/commands/feature.md` (`target: false`) and `.claude/commands/install.md` (`target: true`). The worktree's `GitContext` is for `acme/framework`, the framework's own repository. The After hook removes the root | phase-import | worktree artefact (throwaway git repositories) |
| G-PC10 | `a worktree of a target repository that tracks nothing under {string}` | As G-PC9, but the worktree's one commit carries only `README.md` and its `GitContext` is for `acme/widgets`, a repository other than the framework's. The argument is not read: tracking only `README.md`, the worktree tracks nothing under the directory the scenario names | phase-import | worktree artefact (throwaway git repositories) |
| W-PC1 | `the plan phase runs` | Writes the stand-in's manifest, records the branch head (`git rev-parse HEAD`) as the baseline for the commit Thens, and calls the real `executePlanPhase` in-process with a `WorkflowConfig` for the worktree, the adwId, the issue, `/feature`, the fixture `GitContext` and no repo context, so nothing is posted. Records the error it throws, if any | phase-import | phase outcome + git artefacts |
| W-PC2 | `the {string} commits its work through the commit agent, as its phase does` | Writes the stand-in's manifest, records the branch head as the baseline, and calls the real `runCommitAgent` in-process under the given agent name, as that agent's phase calls it: `/feature`, the issue, the worktree as cwd and the fixture `GitContext`'s command environment. The stand-in answers the `/commit` | phase-import | git artefact (commit on the worktree branch) |
| W-PC3 | `worktree setup copies the framework's Claude assets into the worktree` | Calls the real `copyClaudeAssetsToWorktree` in-process with the worktree, its `GitContext` and the fixture framework checkout as `frameworkRepoRoot`, so neither the real checkout nor its origin plays a part | phase-import | worktree + git artefacts |
| T-PC1 | `the plan phase completes` | Asserts W-PC1 recorded no error; fails giving the error's message | phase-import | phase run outcome |
| T-PC2 | `the commits added during the plan phase carry the plan file and no other path` | Asserts the branch gained at least one commit since the baseline (`git rev-list <baseline>..HEAD`) and that the paths those commits carry (`git show --name-only --no-renames`) are exactly the plan file | phase-import | git artefact (commits on the worktree branch) |
| T-PC3 | `the worktree still has uncommitted changes to these files:` | Asserts each `path` row is among the worktree's staged, unstaged and untracked paths (`git status --porcelain --untracked-files=all`); fails listing them | phase-import | git artefact (worktree status) |
| T-PC4 | `the plan phase fails with an error that names {string}` | Asserts W-PC1 recorded an error whose message contains the path | phase-import | phase run outcome (raised error) |
| T-PC5 | `no commit added during the plan phase carries {string}` | Asserts none of the commits the branch gained since the baseline carries the path | phase-import | git artefact (commits on the worktree branch) |
| T-PC6 | `the commit recorded on the worktree branch carries these files:` | Asserts the branch gained exactly one commit since the baseline and that it carries every `path` row | phase-import | git artefact (commit on the worktree branch) |
| T-PC7 | `the worktree's {string} is the copy its branch carries` | Asserts the worktree's file at the path has the content the branch's HEAD records for it (`git show HEAD:<path>`). The file is what worktree setup left in the worktree, an artefact; no source file is read | phase-import | worktree artefact + git artefact (HEAD blob) |
| T-PC8 | `the worktree has no uncommitted change to {string}` | Asserts `git status --porcelain -- <path>` in the worktree prints nothing | phase-import | git artefact (worktree status) |
| T-PC9 | `git lists {string} among the worktree's ignored files` | Asserts the path is among `git ls-files --others --ignored --exclude-standard` in the worktree: the ignore entry worktree setup wrote covers it | phase-import | git artefact (ignored-file listing) |
| T-PC10 | `git lists {string} among the worktree's untracked files that are not ignored` | Asserts the path is among `git ls-files --others --exclude-standard` in the worktree: worktree setup copied it and wrote no ignore entry for it | phase-import | git artefact (untracked-file listing) |

This section also reuses already-registered phrases, so they need no new rows: `the ADW codebase is
checked out` (G18, Background), `the ADW TypeScript type-check passes` (T22) and the git/gh guard
pair W16/T34.
```

- Don't add rows for G18, T22, W16 or T34, and don't touch any existing row.
- The issue's concrete phrases (`issue 4242`, `"acme/widgets"`, `"<path>"`, `"<agent>"`) are registered in the parameterised form each step defines. That is how the registry stores phrases, and the scorer's `{string}`/`{int}` wildcards then match these values and any other.

### Task 8: Add the README tree line
- In `README.md`'s `features/` tree, insert this line between the `pause-queue/` and `smoke/` lines:
  `│   ├── plan-commit/    # Regression scenarios covering the plan commit that carries only the plan file, the plan-phase guard on .claude/ and .adw/, and worktree setup leaving the framework's own tracked Claude assets as the branch has them (#930)`
- Make no other README edit, and leave the pre-existing unrelated hunks exactly as found.

### Task 9: Prove load integrity and that no step is ambiguous
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: the total scenarios and the undefined and ambiguous counts equal the Task 1 baseline, with 0 ambiguous. The same definitions are loaded, once each, from one glob.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-930"`: `0 scenarios`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@plan-commit-guard" --format summary`: `21 scenarios (21 skipped)`, none undefined or ambiguous.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@regression" --format summary`: R + 21 scenarios.
- If anything is undefined, a sibling was left behind or an import moved. If anything is ambiguous, a file is being loaded twice. Fix it before continuing.

### Task 10: Prove the promoted scenarios green, and the suite unchanged otherwise
- Focused run: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @plan-commit-guard"`. Expected: `21 scenarios (21 passed)`, exit 0. This runs them under the `@regression` mock infrastructure (stub `CLAUDE_CODE_PATH`, git mock on `PATH`), which is new for them.
- Full gate: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`. Expected: R + 21 scenarios, the 21 all passing, 0 undefined, 0 ambiguous. Any non-passing scenario must be one already recorded in Task 1, with the same outcome.
- No test residue: no `adw-930-*` or `adw-930-setup-*` directory left under `os.tmpdir()` from this run, and no `agents/bdd930-*` or `logs/bdd930-*` directory under the checkout. The `After` hooks remove them.

### Task 11: Prove every step of the moved feature matches a registry row
- Run the registry-coverage one-liner in **Validation Commands**. It parses the real registry with `parseVocabulary`, applies the scorer's own wildcard rule, and checks every step of the moved feature, outline placeholders included. Expected: `all … steps match a registered phrase`, exit 0. Any `UNREGISTERED:` line means a Task 7 row is missing, misspelled, or broke the table.

### Task 12: Static checks and unit tests
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint:git-guard`, `bun run test:unit` and `bun run build` all pass.
- No new unit test is written. See **Testing Strategy → Unit Tests**.

### Task 13: Confirm the old paths are gone and nothing dangles
- `for p in features/per-issue/feature-930.feature features/per-issue/step_definitions/{feature-930.steps.ts,feature-930-worktree-setup.steps.ts,feature-930-plan-fixture.ts,feature-930-fixtures.ts}; do test ! -e "$p" || echo "STILL PRESENT: $p"; done` prints nothing.
- `git grep -nE "per-issue/(feature-930\.feature|step_definitions/feature-930)" -- . ':!specs' ':!app_docs'` prints nothing. Historical specs and prose mentions of the file names are fine.
- `git grep -n "@adw-930" -- features/regression` prints nothing. `git grep -n "'@plan-commit-guard'" -- features/regression/step_definitions` prints exactly four lines.

### Task 14: Keep the change set scoped
- `git status --porcelain` shows only:
  - the five renames;
  - the edits to `features/regression/vocabulary.md` and `README.md`. `README.md` also still carries its pre-existing unrelated hunks;
  - this spec.

  `agents/`, `logs/` and `*.tsbuildinfo` are gitignored, so test runs leave nothing tracked.
- `git diff HEAD -M --name-status` lists the five moves as renames:
  - `feature-930-fixtures.ts` as `R100`;
  - the feature, the two step files and the plan fixture with high similarity.

### Task 15: Run the validation commands
- Execute every command in **Validation Commands** and confirm each expectation.

## Testing Strategy
### Unit Tests
Unit tests are enabled: `.github/adw.yml` leaves `unitTests` commented out. This change adds no production logic: it is a relocation, a retag, a hook re-key, a test-fixture fix and a registry edit, so no new unit test is warranted. Vitest covers `adws/**`, not `features/**` step-definition fixtures. The behaviour these scenarios pin keeps its existing unit coverage, which must stay green:
- `adws/phases/__tests__/planCommitGuard*.test.ts`
- `adws/phases/__tests__/planPhaseCommit.test.ts`
- `adws/phases/__tests__/planPhase.test.ts`
- `adws/phases/__tests__/worktreeSetup.test.ts`
- `adws/promotion/__tests__/vocabularyParser.test.ts`, which pins the row format the new section must follow.

Run `bun run test:unit` as the regression guard. The behavioural proof is the BDD run in Task 10, and the registry proof is Task 11.

### Edge Cases
- **The hook order flips with the move.** In the regression glob, the moved hooks register before `features/regression/support/hooks.ts`, so the `@regression` teardown runs before feature-930's own `After`. Without Task 6, `restoreClaudeCli()` would write the stub path back after teardown and leak it to every later scenario in the process. Under `--tags "@regression"` that leak is masked, because every scenario re-sets the stub. A full or mixed-tag run would expose it. With Task 6 the restore is correct in either order. The `Before` hooks only reset module state, and the other `After` hooks only remove directories, so their order doesn't matter.
- **Mock infrastructure is new to these scenarios.**
  - The git mock passes every local subcommand through to real git. These scenarios run no `push`, `fetch`, `clone`, `pull` or `ls-remote`, and surface row 02 already runs the real plan phase under it.
  - `GH_TOKEN`/`GH_HOST` point at the mock. The plan phase has no repo context and posts nothing.
  - The stand-in's wrapper sets its own `MOCK_MANIFEST_PATH`.
  - Each `git` call now pays a `bun` start-up through the wrapper. That is seconds per scenario, well inside the 60 s step timeout.
- **Module-load failure.** One unresolved relative import aborts every Cucumber run. The whole four-file closure moves together and no specifier changes. The Task 9 dry-run proves it.
- **Ambiguous steps.** Every definition is still loaded exactly once from one glob, and no definition is added, copied or removed. G18, T22, W16 and T34 stay where they are, and the 930 files never defined them.
- **The dropped tags.** `@adw-963` was on three scenarios, 14 test cases. #963 merged in PR #975, and no hook is keyed on `@adw-963` (`feature-963-state.ts` keys on its own tag), so nothing loses a hook. `@promotion-suggested-2026-10-04` only means something under `features/per-issue/`: the promotion sweep and the per-issue sweep list only that directory. Once the PR merges, the sweep's reconcile sees this issue's PR merged.
- **Outline placeholders in registry phrases.** Registering `{string}` forms lets the scorer and the coverage check match `"<path>"` and `"<agent>"` placeholders as well as concrete values.
- **The G-PC10 argument.** The step ignores its `{string}`. The row says so, so the registry doesn't promise behaviour the step lacks.
- **Docker leg.** These scenarios need only `bun`, `git`, a writable `os.tmpdir()`, and `agents/` and `logs/` under the writable copy. The suite's other phase-import rows need the same, but this can't be verified on a host without Docker. See Notes.
- **Concurrent runs.** Don't run two Cucumber processes from the same checkout. Shared `agents/` state and spawn locks make results unreliable.

## Acceptance Criteria
- `features/regression/plan-commit/feature-930.feature` exists. Its first line is exactly `@regression @plan-commit-guard`, it contains no `@adw-` or `@promotion-suggested-` token, and it differs from the original only in that line and the nine deleted scenario-level tag lines.
- `feature-930.steps.ts`, `feature-930-worktree-setup.steps.ts`, `feature-930-plan-fixture.ts` and `feature-930-fixtures.ts` exist under `features/regression/step_definitions/` as renames with every `import` line unchanged.
- `features/per-issue/feature-930.feature` and all four `features/per-issue/step_definitions/feature-930*.ts` paths no longer exist.
- The four hooks are keyed on `@plan-commit-guard`, and no file under `features/regression/` mentions `@adw-930`.
- `restoreClaudeCli()` restores `CLAUDE_CODE_PATH` only while it still names the stand-in, and always clears the CLI path cache.
- The whole-tree dry-run reports the same totals as the baseline with 0 ambiguous steps. `--tags "@plan-commit-guard"` selects 21 test cases, and `--tags "@adw-930"` selects none.
- `--tags "@regression and @plan-commit-guard"` gives `21 scenarios (21 passed)`, exit 0.
- `--tags "@regression"` executes all 21 moved test cases, and they pass. The suite grows by exactly 21 scenarios, has 0 undefined and 0 ambiguous, and has no non-passing scenario other than ones recorded at baseline.
- `features/regression/vocabulary.md` has the new `(@plan-commit-guard)` section with 23 rubric-compliant rows (G-PC1–10, W-PC1–3, T-PC1–10) and a reuse note for G18, T22, W16 and T34. No existing row changed and no phrase is duplicated. The registry-coverage check passes.
- `README.md` lists `features/regression/plan-commit/`, and its pre-existing unrelated hunks are untouched.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint:git-guard`, `bun run test:unit` and `bun run build` pass.
- The PR is `hitl`-gated and merges only after human approval.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `head -1 features/regression/plan-commit/feature-930.feature`: prints exactly `@regression @plan-commit-guard`.
- `grep -cE "@adw-|@promotion-suggested-" features/regression/plan-commit/feature-930.feature`: prints `0`.
- `for p in features/per-issue/feature-930.feature features/per-issue/step_definitions/{feature-930.steps.ts,feature-930-worktree-setup.steps.ts,feature-930-plan-fixture.ts,feature-930-fixtures.ts}; do test ! -e "$p" || echo "STILL PRESENT: $p"; done`: prints nothing.
- `for f in feature-930.steps.ts feature-930-worktree-setup.steps.ts feature-930-plan-fixture.ts feature-930-fixtures.ts; do test -e "features/regression/step_definitions/$f" || echo "MISSING: $f"; done`: prints nothing.
- `git grep -n "@adw-930" -- features/regression`: prints nothing.
- `git grep -n "'@plan-commit-guard'" -- features/regression/step_definitions`: prints four lines (a `Before` and an `After` in each of the two step files).
- `git grep -nE "per-issue/(feature-930\.feature|step_definitions/feature-930)" -- . ':!specs' ':!app_docs'`: prints nothing.
- `git diff HEAD -M --name-status`: the five moves are listed as renames (`R…`).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: same totals as the Task 1 baseline, 0 ambiguous.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-930"`: `0 scenarios`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@plan-commit-guard" --format summary`: `21 scenarios (21 skipped)`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @plan-commit-guard"`: `21 scenarios (21 passed)`, exit 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: R + 21 scenarios. The 21 promoted ones pass, 0 undefined, 0 ambiguous, and nothing fails that was not already failing at baseline.
- Registry coverage (from the repository root): prints `all … steps match a registered phrase` and exits 0.
  ```sh
  bunx tsx -e 'import { readFileSync } from "fs"; import { parseVocabulary, parseScenarios } from "./adws/promotion/index.ts"; const toRe = (p) => new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{string\\\}/g, ".*").replace(/\\\{int\\\}/g, "\\d+") + "$"); const res = [...parseVocabulary(readFileSync("features/regression/vocabulary.md", "utf-8")).entries.keys()].map(toRe); const texts = parseScenarios(readFileSync("features/regression/plan-commit/feature-930.feature", "utf-8")).flatMap((s) => s.steps.map((st) => st.text)); const missing = [...new Set(texts.filter((t) => !res.some((r) => r.test(t))))]; console.log(missing.length === 0 ? "all " + texts.length + " steps match a registered phrase" : "UNREGISTERED:\n" + missing.join("\n")); process.exit(missing.length === 0 ? 0 : 1);'
  ```
- `bun run lint`: ESLint passes. It covers `features/**`, including the edited fixture.
- `bunx tsc --noEmit`: the root type-check passes. Its `include` covers `features/**`, so the moved files compile from their new location.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run lint:git-guard`: the git/gh guard passes. W16 runs the same check from inside the suite.
- `bun run test:unit`: the Vitest suite is green.
- `bun run build`: the build (`tsc`) succeeds.
- `git status --porcelain`: only the five renames, `features/regression/vocabulary.md`, `README.md` (this feature's line plus its pre-existing unrelated hunks) and this spec.

## Notes
- **Coding guidelines.** Strictly follow `.adw/coding_guidelines.md`. The only new code is the `restoreClaudeCli()` change:
  - a guard clause and nesting depth of 2 or less;
  - an explicit `string | null` state, and no `any` or `!`;
  - one comment, for the hook-ordering constraint, with no issue numbers.

  Moved files are not reformatted or refactored, and their existing header comments stay.
- **No new libraries.** Nothing is installed. If one were ever needed, the command from `.adw/commands.md` is `bun add <package>`.
- **Deviations from the literal issue text, and why.**
  1. Three more modules move alongside `feature-930.steps.ts`: `feature-930-worktree-setup.steps.ts`, `feature-930-plan-fixture.ts` and `feature-930-fixtures.ts`. The issue lists only the file the sweep's `feature-N.` sibling rule finds. The others are imported by it, or define six of the feature's phrases, and the acceptance requires "its step-def siblings" gone.
  2. `@promotion-suggested-2026-10-04` is dropped with the `@adw-` tags. It is a per-issue promotion marker, and no promoted regression feature carries one.
  3. Of the 27 listed phrases, 23 get new rows. One is a duplicate expression, and T22, W16 and T34 are already registered, so they get a reuse note instead of duplicate rows.
  4. `restoreClaudeCli()` changes. Re-keying keeps the hook running, but in its new registration position it would restore the wrong value. This is the minimal fix that keeps the fixture self-contained.
- **README.** The worktree already held an uncommitted README modification when planning started: catch-up lines for the `adws/**/__tests__/` tree, which match files that exist. It is unrelated to this promotion. Leave it as found, and point it out to the HITL reviewer if it ends up in the PR.
- **Documentation is the document phase's job.** Don't hand-edit `.adw/conditional_docs.md` or `app_docs/`. The document phase should update `app_docs/feature-9gjajh-bdd-regression-suite.md`:
  - add a "Maintain `features/regression/plan-commit/`" entry;
  - add `@plan-commit-guard` to its list of promoted descriptive tags;
  - record the reverse-order `After` constraint for fixtures that restore an environment variable the `@regression` hooks also manage.
- **Docker leg (optional, flagged for the HITL reviewer).** Where Docker is available, `bash test/docker-run.sh --tags "@regression and @plan-commit-guard"` runs the 21 test cases in the container's writable copy. That isn't part of the required validation, because the build host may have no Docker.
- **Scenario agent output.** If the scenario agent writes `@adw-1002` scenarios for this issue, they are this workflow's BDD proof in addition to everything above, and must pass too.
- **After merge.** The `hitl` label holds the PR until a human approves it. Once it merges, the promotion sweep's reconcile sees `Promotes: feature-930` resolved by a merged PR. `features/per-issue/feature-930.feature` is gone, so it is never a candidate again.
