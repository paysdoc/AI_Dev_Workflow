# Patch: Restore `README.md` to its `origin/dev` content

## Metadata
adwId: `srw01j-chore-comment-sweep`
reviewChangeRequest: `Issue #1: Out-of-scope README.md changes are on the branch (committed in plan commit b6b5de65, not by the build commit dc41e3f2) in violation of the issue's 'Do not touch any file outside that list' rule and the plan's own Step 12 note. They collide with PR #886 already merged to dev: `git merge-tree --write-tree origin/dev HEAD` reports CONFLICT (content) in README.md at the `.github/dependabot.yml` tree-entry line, and the auto-merged remainder would carry two bullets describing the same comment guard ('Comment-only guard' at line 18 and 'Comment-discipline guideline and guard' at line 46) plus two `checkCommentOnly.ts` entries in the adws/ tree listing (lines 888 and 890). The 13 Touched Files themselves are clean; `.claude/commands/scenario_writer.md` already matches origin/dev byte-for-byte and needs no action. Resolution: Restore README.md to the default branch's content on this branch (`git fetch origin dev && git checkout origin/dev -- README.md`) and commit, so the branch's diff against dev contains only the 13 Touched Files and the spec file. Re-run `git merge-tree --write-tree origin/dev HEAD` to confirm no conflict remains. If the tree-listing fixes (drop commitOperations.test.ts / fetchAndResetToRemote.test.ts, add reviewPhaseApprovalGate.test.ts and gitContextFixture.ts, dependabot.yml entry) are wanted, file them as a separate docs chore.`

## Issue Summary
**Original Spec:** `specs/issue-873-adw-srw01j-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-2.md`

**Issue:** The plan-orchestrator commit `b6b5de65` ("chore: add plan for per-issue comment sweep batch 2") committed three files: the spec, a one-line deletion in `.claude/commands/scenario_writer.md`, and a 5-insertion / 2-deletion edit to `README.md`. The README edit is out of scope twice over: the issue says "Do not touch any file outside that list" (the 13 Touched Files), and the spec's own Step 12 says the pre-existing README edits "are not part of this chore. Don't stage or commit them."

It also conflicts with `dev`. Since this branch's merge-base (`34901ec0`, PR #885), `dev` has merged PR #886 (`d46964a0`), whose commit `c3606f9e` ("update docs for comment-only guard") documented the same comment-only guard in README.md differently: a **Comment-discipline guideline and guard** bullet in the feature list (line 46), a `checkCommentOnly.ts` tree entry placed after `checkLivingDocsIndex.ts`, and a reworded `.github/dependabot.yml` tree entry. The branch's copy (from `b6b5de65`) adds its own **Comment-only guard** bullet (line 18), places its `checkCommentOnly.ts` entry before `checkLivingDocsIndex.ts`, rewords the same `dependabot.yml` line a second way, and additionally edits the tree listing (drops `commitOperations.test.ts` and `fetchAndResetToRemote.test.ts`, adds `reviewPhaseApprovalGate.test.ts` and `gitContextFixture.ts`). Verified while planning:

- `git merge-tree --write-tree origin/dev HEAD` exits 1 with `CONFLICT (content): Merge conflict in README.md` (the `dependabot.yml` line, edited differently on both sides).
- The auto-merged remainder would keep both guard bullets and both `checkCommentOnly.ts` tree entries.
- `git diff --numstat origin/dev -- README.md` is `5 5` (five insertions, five deletions) today.
- The only branch-side commit touching README.md is `b6b5de65`; the build commit `dc41e3f2` touches exactly the 13 Touched Files.
- `.claude/commands/scenario_writer.md` needs no action: `git diff origin/dev -- .claude/commands/scenario_writer.md` is empty. It shows up in `git diff --stat origin/dev...HEAD` only because `dev` received the identical one-line deletion through PR #887, so the merge resolves it as both-sides-same.

**Solution:** Restore the single file to its `origin/dev` content with `git checkout origin/dev -- README.md` and commit that restoration on top of `HEAD`. No hand-editing, no other paths. Amending `b6b5de65` is not possible here: it is `HEAD~1`, and editing a non-HEAD commit needs an interactive rebase, which this environment does not support. Because `HEAD` (`dc41e3f2`) does not touch README.md, restore-and-commit-on-top yields the same net tree against `origin/dev` as an amend would, and it is the established repo pattern (`specs/patch/patch-adw-xcivq0-chore-comment-sweep-restore-scenario-writer-command.md`). Simulated while planning with a temporary index: after the restore, `git merge-tree --write-tree origin/dev <tip>` exits 0 with no conflict, and `git diff --name-only origin/dev <merged-tree>` lists exactly 14 paths, the 13 Touched Files plus the spec file. The tree-listing corrections that `b6b5de65` bundled in are deliberately dropped by this patch; per the review, they belong in a separate docs chore if wanted.

## Files to Modify
Use these files to implement the patch:

- `README.md` — restore to `origin/dev` content via git (drops the duplicate **Comment-only guard** bullet, the second `checkCommentOnly.ts` tree entry, the divergent `dependabot.yml` wording, and the four tree-listing edits). This is the only path that changes.

No `adws/**`, `features/**`, `specs/**`, or `.claude/**` file changes. The 13 Touched Files of the sweep and `.claude/commands/scenario_writer.md` are not modified.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run from the worktree root: `/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/chore-issue-873-comment-sweep-per-issue-batch-2`.

### Step 1: Confirm `origin/dev` is current and the tree is clean
- `git fetch origin dev` — make sure `origin/dev` points at the live tip (it must contain PR #886 merge `d46964a0`; check with `git merge-base --is-ancestor d46964a0 origin/dev && echo ok`).
- `git status --porcelain` — must print nothing. If it prints anything, stop and surface the unexpected changes instead of committing them.
- `git diff --numstat origin/dev -- README.md` — confirm the pre-patch state is `5	5	README.md` (five insertions, five deletions) on this one file.

### Step 2: Restore the file to its `origin/dev` content
- Run exactly:
  ```sh
  git checkout origin/dev -- README.md
  ```
- This updates both the index and the working tree for that single path to match `origin/dev`, so it is already staged. Do not hand-edit the file and do not touch any other path. Do **not** try to keep any of the tree-listing corrections; the review asks for them to be filed separately.

### Step 3: Verify the restore nets to zero and nothing else is staged
- `git diff origin/dev -- README.md` — must print nothing.
- `git status --porcelain` — must list exactly one staged path: `M  README.md`.
- `grep -c 'Comment-only guard' README.md` — must print `0` (the branch-only bullet is gone); `grep -c 'Comment-discipline guideline and guard' README.md` — must print `1` (dev's bullet is back).

### Step 4: Commit the restoration
- The file is already staged by Step 2. Commit only that path (do **not** use `git add -A` or `git commit -am`). The subject follows the repo convention `<commitPrefix>: <type>: <present-tense description, 50 chars max>`, with the agent name as prefix:
  ```sh
  git commit -m "patchAgent: chore: restore README.md to origin/dev

Plan commit b6b5de65 bundled out-of-scope README.md edits (a second
comment-only guard bullet and tree-listing changes) into the #873 sweep,
which may touch only the 13 listed files. Those edits conflict with the
guard documentation dev already carries from PR #886. Restore README.md
to origin/dev so the PR's net diff is the 13 Touched Files plus the spec.
(issue #873 review, issue #1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
  ```
- The pipeline's build phase commits only when the worktree is dirty, so this explicit commit does not collide with it.

## Validation
Execute every command to validate the patch is complete with zero regressions. Checks 1 and 2 are the review's binding acceptance checks; checks 3 to 5 are the spec's Validation Commands and prove the in-scope sweep is untouched (all five passed on the pre-patch tip while planning, so any failure is a regression introduced by the patch).

1. **README.md matches `origin/dev` and the merge is conflict-free** (the review's stated check). `git merge-tree` must print a single tree hash, no `CONFLICT` lines, and exit 0:
   ```sh
   git diff origin/dev -- README.md                      # must print nothing
   git log --oneline origin/dev..HEAD -- README.md       # lists b6b5de65 and the new restore commit only
   git merge-tree --write-tree origin/dev HEAD           # one tree hash, exit 0, no CONFLICT
   ```
2. **Merging the branch into `dev` would change only the 13 Touched Files and the spec file.** Note: a plain `git diff --stat origin/dev` is *not* a valid scope check here, because `dev` has moved on by two PRs since the merge-base; the merge-tree form below shows exactly what the PR would land. Expected: 14 paths, all under `features/per-issue/` except the spec, and `comm` prints nothing.
   ```sh
   MERGED=$(git merge-tree --write-tree origin/dev HEAD)
   git diff --name-only origin/dev "$MERGED" | sort > /tmp/srw01j_merge.txt
   wc -l < /tmp/srw01j_merge.txt          # 14
   grep -cE '^(README\.md|\.claude/)' /tmp/srw01j_merge.txt   # 0
   printf '%s\n' features/per-issue/feature-818.feature features/per-issue/feature-820.feature features/per-issue/feature-821.feature features/per-issue/step_definitions/cron-launch-context-ctx.ts features/per-issue/step_definitions/feature-533-then.steps.ts features/per-issue/step_definitions/feature-533.steps.ts features/per-issue/step_definitions/feature-794.steps.ts features/per-issue/step_definitions/feature-796.steps.ts features/per-issue/step_definitions/feature-819.steps.ts features/per-issue/step_definitions/feature-821.steps.ts features/per-issue/step_definitions/feature-823-workspace.steps.ts features/per-issue/step_definitions/feature-844.steps.ts features/per-issue/step_definitions/gitContextSharedWorld.ts specs/issue-873-adw-srw01j-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-2.md | sort > /tmp/srw01j_expected.txt
   comm -3 /tmp/srw01j_expected.txt /tmp/srw01j_merge.txt   # must print nothing
   ```
3. **Comment-only guard still passes for all 13 Touched Files against the default branch.** The `--base origin/dev` form is deterministic without forge credentials; the bare form (guard resolves the default branch itself) is equally acceptable. Must end with `✔ PASS` and exit 0. Pass the paths as separate arguments (a single quoted string is treated as one path and fails):
   ```sh
   bun run lint:comment-only --base origin/dev features/per-issue/feature-818.feature features/per-issue/feature-820.feature features/per-issue/feature-821.feature features/per-issue/step_definitions/cron-launch-context-ctx.ts features/per-issue/step_definitions/feature-533-then.steps.ts features/per-issue/step_definitions/feature-533.steps.ts features/per-issue/step_definitions/feature-794.steps.ts features/per-issue/step_definitions/feature-796.steps.ts features/per-issue/step_definitions/feature-819.steps.ts features/per-issue/step_definitions/feature-821.steps.ts features/per-issue/step_definitions/feature-823-workspace.steps.ts features/per-issue/step_definitions/feature-844.steps.ts features/per-issue/step_definitions/gitContextSharedWorld.ts
   ```
4. **Typechecks and lint still pass** (this patch changes no TypeScript, so these are a zero-regression backstop):
   ```sh
   bun run test
   bunx tsc --noEmit -p adws/tsconfig.json
   bun run lint
   ```
5. **Step-definition modules still load with unchanged phrase registration** (spec Validation Command; README is not loaded by Cucumber, so this is a backstop). Must report no undefined or ambiguous steps:
   ```sh
   NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-819 or @adw-821 or @adw-823 or @adw-844 or @adw-848"
   git status --porcelain   # must print nothing afterwards
   ```

## Patch Scope
**Lines of code to change:** 0 lines of source. 10 README lines (5 removed, 5 restored) reset via `git checkout` with no hand edit, plus one restore commit.
**Risk level:** low — restores a documentation file to its already-merged `origin/dev` state; no TypeScript, feature, step-definition, or spec file is modified, and the 13-file sweep is untouched. The only behavioural effect is that the PR becomes mergeable without a README conflict.
**Testing required:** README diff against `origin/dev` is empty and `git merge-tree` is conflict-free (Validation 1); the would-be merge touches only the 13 Touched Files plus the spec (Validation 2); comment-only guard, typechecks, lint and the Cucumber dry-run all still pass (Validation 3 to 5), matching the pre-patch baseline.

## Notes
- **Ownership doc.** `.adw/conditional_docs.md` assigns `README.md` to `app_docs/feature-9gjajh-root-config.md`. No doc update is needed: the file returns to the exact content `dev` already carries.
- **Dropped on purpose.** The tree-listing corrections bundled into `b6b5de65` (remove `commitOperations.test.ts` and `fetchAndResetToRemote.test.ts`, add `reviewPhaseApprovalGate.test.ts` and `test/.../gitContextFixture.ts`, reword the `dependabot.yml` entry) may well be accurate, but they are out of scope for issue #873 and the review asks for them as a separate docs chore. Do not carry any of them into this patch.
- **Why the merge-tree check instead of `git diff origin/dev`.** `dev` merged PRs #886 and #887 after this branch was cut, so a two-dot diff against `origin/dev` lists roughly a hundred files that this branch never touched. `git diff --name-only origin/dev $(git merge-tree --write-tree origin/dev HEAD)` shows only what merging the PR would actually change, which is the property the review is asking for.
- **No `@adw-873` scenario on the branch.** `features/per-issue/feature-873.feature` has not been authored yet (the pipeline's scenario phase owns it), so the spec's final `cucumber-js --tags "@adw-873"` command has nothing to run and is not part of this patch's validation.
