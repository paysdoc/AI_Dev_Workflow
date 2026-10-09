# Patch: Take the out-of-scope #937 harness rewrite out of the #992 promotion

## Metadata
adwId: `ljufnl-feat-promote-992-sce`
reviewChangeRequest: ``Issue #1: Out-of-scope rewrite of another regression feature's harness. The scenario-fix commit 149d9379 changes the harness of `features/regression/review/feature-937.feature` (`@review-comment-screenshots`), which issue #1032 never mentions. It adds `features/regression/step_definitions/feature-937-runner.ts`, a stand-in Playwright `npx` that attaches the proof run to an `@adw-<issue>` JUnit case. It switches `feature-937-workflow.ts` from the `cli` profile and its proof-copying scenario command to the `web` profile over a Playwright-project worktree. It adds `runnerBinDir` to `feature-937-world.ts`. It rewrites the G-RS2 and G-RS3 rows and the helper-file sentence of the `(@review-comment-screenshots)` section of `features/regression/vocabulary.md`. Together these change what the registered #937 phrases set up and test. The #992 promotion does not need any of this. The fix agent's own diagnosis shows the same 5 of the 8 #937 scenarios fail on a clean export of origin/dev (8 scenarios, 5 failed). That failure is a pre-existing clash between #994's per-issue image selection and #937's `cli` harness, not something moving #992 caused. Resolution: Take the #937 changes out of this branch. Restore `features/regression/step_definitions/feature-937-workflow.ts` and `features/regression/step_definitions/feature-937-world.ts` to their origin/dev content, and delete `features/regression/step_definitions/feature-937-runner.ts`. In `features/regression/vocabulary.md`, restore the `(@review-comment-screenshots)` section (the helper-file sentence and the G-RS2 and G-RS3 rows) to its origin/dev text, and keep the new `(@web-playwright-project)` section. Fix the pre-existing #937 failure on dev in an issue of its own, so it is reviewed as a change to that feature's harness. ADW's pre-existing-regression park (`adws/phases/preExistingRegressionGate.ts`) handles a regression failure that also fails on the base branch.``

## Issue Summary
**Original Spec:** `specs/issue-1032-adw-ljufnl-feat-promote-992-sce-sdlc_planner-promote-992-web-playwright-project-regression.md`

**Issue:** The scenario-fix commit `149d9379` rewrote the harness of `features/regression/review/feature-937.feature`
(`@review-comment-screenshots`), a regression feature issue #1032 never mentions. The spec's scope (Solution Statement,
and the Notes' list of what "the TypeScript diff is") holds no #937 change. The commit touches exactly four paths:
- `features/regression/step_definitions/feature-937-runner.ts`: new, 145 lines. A stand-in Playwright `npx`.
- `features/regression/step_definitions/feature-937-workflow.ts`: swaps the `cli` profile and the proof-copying
  `runScenariosByTag` for the `web` profile over a Playwright-project worktree.
- `features/regression/step_definitions/feature-937-world.ts`: adds `runnerBinDir` and rewords the `ProofRun` JSDoc.
- `features/regression/vocabulary.md`: rewrites three lines of the `(@review-comment-screenshots)` section. Those are
  the helper-file sentence (line 1102) and the G-RS2 and G-RS3 rows (lines 1111–1112).

Verified while planning. `origin/dev` is `3bd7f360`, which is also this branch's merge-base, so no dev commit since the
branch point touches these paths.
- **The pre-fix tree already holds dev's #937 content.** `149d9379`'s parent is the build-agent commit `26c27df3`.
  - `git diff origin/dev 26c27df3 -- 'features/regression/step_definitions/feature-937*'` is empty.
  - `git diff --numstat origin/dev 26c27df3 -- features/regression/vocabulary.md` is `97 0`. The only change from dev
    is the appended `(@web-playwright-project)` section, which `149d9379` did not touch.
  - `git diff --name-status 26c27df3 149d9379` lists only the four paths above.
- **Nothing else uses the runner.** No other tracked file outside `specs/` references it or its exports.
- **The #937 result is the same before and after.** In throwaway worktrees, `@review-comment-screenshots` gives the
  same result on `26c27df3` (the post-patch code) and on `origin/dev`:
  - `8 scenarios (5 failed, 3 passed)` and `72 steps (5 failed, 3 skipped, 64 passed)`;
  - failing at `feature-937.feature:224`, `:243`, `:261`, `:280` and `:301`;
  - with the message "Image sources in the comment: []".
- **The #992 promotion passes without the #937 changes.** On `26c27df3`:
  - `@web-playwright-project and not @host-only` gives `16 scenarios (16 passed)` and `119 steps (119 passed)`.
  - The full `@regression` run gives `369 scenarios (5 failed, 364 passed)`. Its only failures are those five #937
    scenarios.
  - The `@regression` dry run binds all 2619 steps, with no undefined and no ambiguous step.
  - Both type-checks and `bun run lint` pass.

**Solution:** Put the four paths back to their pre-`149d9379` content with git, without hand-editing anything.
- `feature-937-workflow.ts` and `feature-937-world.ts` come from `origin/dev`.
- `feature-937-runner.ts` is deleted.
- `vocabulary.md` comes from `26c27df3`. That restores the three #937 lines to dev's text and keeps the
  `(@web-playwright-project)` section byte for byte.

The result is exactly the undo of `149d9379`. Use `git checkout`, not `git revert`: a revert would either make its own
commit, or leave a revert in progress for the orchestrator's `review-patch-agent` commit, which commits and pushes after
the build.

After this patch, the branch's `@regression` run fails the five #937 scenarios exactly as `origin/dev` does. That is
expected and out of scope here:
- the #937 harness is fixed on `dev` in an issue of its own;
- the pre-existing-regression park (`adws/phases/preExistingRegressionGate.ts`) handles a regression failure that also
  fails on the base branch.

Do not edit any #937 file to make those five scenarios pass.

## Files to Modify
Use these files to implement the patch:

- `features/regression/step_definitions/feature-937-workflow.ts`: restore to `origin/dev`. That brings back the `cli`
  profile, the proof-copying `runScenariosByTag` and `writeStepDefinitionFile`, and drops the runner import.
- `features/regression/step_definitions/feature-937-world.ts`: restore to `origin/dev`. That drops `runnerBinDir` and
  brings back the `ProofRun` JSDoc.
- `features/regression/step_definitions/feature-937-runner.ts`: delete it. It does not exist on `origin/dev`.
- `features/regression/vocabulary.md`: restore the `(@review-comment-screenshots)` helper-file sentence and the G-RS2
  and G-RS3 rows to their `origin/dev` text. Keep the `(@web-playwright-project)` section unchanged.

Not modified:
- `features/regression/review/feature-937.feature`;
- the other #937 step files: `feature-937.steps.ts`, `feature-937-then.steps.ts` and `feature-937-agent.ts`;
- every #992 closure file, and the 23 repointed per-issue importers;
- `README.md`, `test/docker-run.sh`, `adws/**` and the spec.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run every command from the worktree root:
`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/feature-issue-1032-promote-992-scenario-to-regression`.

### Step 1: Confirm the pre-patch state
If any check below gives a different result, stop and report it instead of restoring.
- `git status --porcelain`: the only output allowed is this plan, untracked
  (`?? specs/patch/patch-adw-ljufnl-feat-promote-992-sce-restore-937-harness-to-dev.md`). If a tracked file shows as
  modified, stop and report it. Do not stash.
- `git log --oneline 149d9379..HEAD -- features/regression/step_definitions/feature-937-workflow.ts features/regression/step_definitions/feature-937-world.ts features/regression/step_definitions/feature-937-runner.ts features/regression/vocabulary.md`
  must print nothing. Otherwise a later commit has touched these paths.
- `git diff --name-status 26c27df3 149d9379` must print exactly these four lines:
  ```
  A	features/regression/step_definitions/feature-937-runner.ts
  M	features/regression/step_definitions/feature-937-workflow.ts
  M	features/regression/step_definitions/feature-937-world.ts
  M	features/regression/vocabulary.md
  ```
- `git diff --quiet origin/dev 26c27df3 -- 'features/regression/step_definitions/feature-937*' && echo same` must print
  `same`.
- `git diff --numstat origin/dev 26c27df3 -- features/regression/vocabulary.md` must print
  `97	0	features/regression/vocabulary.md`.

### Step 2: Restore the two #937 helpers to `origin/dev` and delete the stand-in runner
```sh
git checkout origin/dev -- features/regression/step_definitions/feature-937-workflow.ts features/regression/step_definitions/feature-937-world.ts
git rm --quiet -- features/regression/step_definitions/feature-937-runner.ts
```
- Both commands stage their change.
- Do not hand-edit either helper. Carry nothing over from the `web`-profile harness.

### Step 3: Restore the `(@review-comment-screenshots)` section of `vocabulary.md`, keeping the new section
```sh
git checkout 26c27df3 -- features/regression/vocabulary.md
```
- `26c27df3` is `149d9379`'s parent. Its `vocabulary.md` is `origin/dev`'s text plus the appended
  `(@web-playwright-project)` section.
- `149d9379` changed only the three #937 lines, so this command restores exactly those lines and nothing else.
- Do not use `origin/dev` as the source here: that would delete the `(@web-playwright-project)` section.
- Do not hand-edit the file.

### Step 4: Verify the staged restore and leave it uncommitted
- `git diff --cached --numstat` must print exactly:
  ```
  0	145	features/regression/step_definitions/feature-937-runner.ts
  37	16	features/regression/step_definitions/feature-937-workflow.ts
  1	3	features/regression/step_definitions/feature-937-world.ts
  3	3	features/regression/vocabulary.md
  ```
- `git diff --quiet 26c27df3 && echo "tracked tree matches the pre-fix commit 26c27df3"` must print the message. Every
  tracked file is now as the build-agent commit left it.
- Do not commit and do not push.
  - Do not run `git add -A`, `git add .` or `git commit -am`.
  - The orchestrator's `review-patch-agent` commits the staged restore together with this plan, then pushes.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. **The #937 harness and its vocabulary rows match `origin/dev`, and the #992 section is intact.**
   ```sh
   git diff --quiet origin/dev -- 'features/regression/step_definitions/feature-937*' features/regression/review && test ! -e features/regression/step_definitions/feature-937-runner.ts && echo "PASS: every #937 file matches origin/dev"
   git diff --numstat origin/dev -- features/regression/vocabulary.md
   git grep -n -E 'feature-937-runner|runnerBinDir|installStandInRunner|withStandInRunner|writePlaywrightProject' -- . ':!specs' || echo "PASS: nothing references the removed stand-in runner"
   test "$(grep -cE '^\| [GWT]-WP[0-9]+ \|' features/regression/vocabulary.md)" = 51 && echo "PASS: the 51 @web-playwright-project rows are intact"
   ```
   - Expected output: `PASS`, then `97	0	features/regression/vocabulary.md`, then `PASS` twice.
   - The `97	0` numstat means no line of `origin/dev`'s `vocabulary.md` is changed or removed, so the
     `(@review-comment-screenshots)` section is dev's text. The 97 added lines are the `(@web-playwright-project)`
     section.
2. **Type-checks and lint pass.** `bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json && bun run lint` exits 0.
3. **Every regression step still binds.** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run`
   prints `369 scenarios (369 skipped)` and `2619 steps (2619 skipped)`, with no undefined and no ambiguous step.
4. **The #992 promotion does not depend on the #937 changes.**
   `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@web-playwright-project and not @host-only"` prints
   `16 scenarios (16 passed)` and `119 steps (119 passed)`.
5. **The only regression failures are the pre-existing #937 ones.**
   `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` prints `369 scenarios (5 failed, 364 passed)` and
   `2619 steps (5 failed, 3 skipped, 2611 passed)`.
   - The failing scenarios are exactly `features/regression/review/feature-937.feature:224`, `:243`, `:261`, `:280` and
     `:301`.
   - On `origin/dev` they fail the same way: `@review-comment-screenshots` gives `8 scenarios (5 failed, 3 passed)`.
   - These five are expected. Do not change any #937 file to make them pass; that fix belongs in its own `dev` issue.
   - Any other failing scenario is a regression this patch must fix.
   - The run includes the `@host-only` scenario, which needs network access to the npm registry.

## Patch Scope
**Lines of code to change:** 41 insertions and 167 deletions across 4 files, all restored by git and none written by
hand:
- the deleted runner (145 lines);
- `feature-937-workflow.ts`, 37 insertions and 16 deletions;
- `feature-937-world.ts`, 1 insertion and 3 deletions;
- `vocabulary.md`, 3 insertions and 3 deletions.

**Risk level:** low. Every restored line is byte-identical to `origin/dev`, or to `26c27df3` for `vocabulary.md`. No
production code under `adws/` changes, and no #992 file is touched. The post-patch tree was checked in a throwaway
worktree, with the results stated in Validation.
**Testing required:**
- a git byte-identity check against `origin/dev`;
- both type-checks and lint;
- a `@regression` dry run;
- the 16 offline `@web-playwright-project` scenarios;
- the full `@regression` run, whose only failures must be the five #937 scenarios that fail the same way on `origin/dev`.
