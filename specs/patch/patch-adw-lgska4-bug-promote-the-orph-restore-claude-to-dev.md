# Patch: Restore `.claude/**` to its `origin/dev` content

## Metadata
adwId: `lgska4-bug-promote-the-orph`
reviewChangeRequest: ``Issue #1: The plan-orchestrator commit 2ed9765b staged 11 `.claude/**` files, which the spec's Worktree hygiene note forbids. They are the host's `origin/main` copies of the framework prompts, not part of this fix. Dev has not touched `.claude` since the merge base ddaf010a, so merging this PR would silently roll dev's prompts back. `.claude/commands/review.md` loses Step 4 (Step Definition Independence Check). `feature.md` and `skills/implement-tdd/SKILL.md` go back from the `.github/adw.yml` unitTests switch to the old `.adw/project.md` rule. `clean_local_repo.md`, `resolve_conflict.md`, `resolve_failed_test.md` and `review.md` hardcode `main`/`develop` again. `adw_init.md`, `document.md`, `generate_step_definitions.md`, `scenario_writer.md` and `skills/depaudit-triage/SKILL.md` are rewritten. `git diff origin/dev...HEAD -- .claude` shows 11 files, +75/-182. Resolution: Restore every `.claude/**` path to its dev content with `git checkout origin/dev -- .claude`, which is identical to merge base ddaf010a. The two uncommitted `.claude` edits already in the working tree match dev, so this command covers them. Stage only `.claude` (`git add .claude`) and commit, leaving out the unrelated `adws/proof/__tests__/proofUploader.test.ts` edit. Then confirm `git diff origin/dev...HEAD -- .claude` is empty, and that no later commit re-stages host-synced `.claude/**` files.``

## Issue Summary
**Original Spec:** `specs/issue-961-adw-lgska4-bug-promote-the-orph-sdlc_planner-promote-webhook-cron-regression-feature.md`

**Issue:** The plan commit `2ed9765b` committed 11 `.claude/**` prompt files, along with the spec and two `README.md` lines. The spec's *Worktree hygiene* note forbids staging `.claude/**`. The files are the host checkout's copies, which are `origin/main`'s versions: `HEAD:.claude` differs from `origin/main:.claude` only in `correct_output.md`, which the branch does not touch.

Verified while planning, against `origin/dev` = `f35d68d4`:

- `2ed9765b` is the only branch commit that touches `.claude`. All 11 entries are modifications (`M`); none is added or deleted. `b5818a20` and `b2f7f8d4` touch no `.claude` file.
- Dev has not touched `.claude` since the merge base. `origin/dev:.claude` and `ddaf010a:.claude` are the same tree, `0dae31e5`.
- `git diff --shortstat origin/dev...HEAD -- .claude` prints `11 files changed, 75 insertions(+), 182 deletions(-)`.
- `git merge-tree --write-tree origin/dev HEAD` merges cleanly, but the merged `.claude` tree is the branch's `40db48f3`, not dev's `0dae31e5`. The merge would therefore silently replace dev's prompts:
  - `review.md` loses `## Step 4: Step Definition Independence Check`;
  - `feature.md` and `skills/implement-tdd/SKILL.md` lose their `adw.yml` references (2 and 1);
  - across `.claude`, `HEAD` carries 4 `origin/main` and 2 `` `main`, `develop` `` hardcodings, and dev carries none.
- The committed content also fails the unit suite. `depauditTriageSkill.test.ts` expects `gh issue create --title <title> --body <body> --label adw:bug`, which dev's `SKILL.md` has and `HEAD`'s lacks.
  - The test phase repaired this only in the working tree. Its runs `resolve-test-adw_init.md …` (11:21–11:28) and `resolve-test-depaudit-triage skill …` (11:29–11:35) appear under `logs/lgska4-bug-promote-the-orph/`.
  - This is why `adw_init.md` and `depaudit-triage/SKILL.md` show as modified: both are now byte-identical to `origin/dev`. Neither was committed.
- `adws/proof/__tests__/proofUploader.test.ts` is a third uncommitted edit: the test phase's 11:42 flake fix (`+2/−4`). It is unrelated to `.claude` and to this issue, and dev does not have it. The branch itself touches nothing under `adws/`.

**Root cause:**
- The host runs `origin/main`'s ADW. On every orchestrator launch, its `copyClaudeAssetsToWorktree` (called at `adws/phases/workflowInit.ts:256` and `:278`) overwrites tracked `.claude` files with the host's copies.
- `origin/main` lacks two dev safeguards: the rule that leaves tracked `.claude` files alone in the framework's own repository, and `planCommitGuard.ts`. Both arrived on dev in `4fdba435`, which is not on main.
- `/commit`'s `git add -A` then carried the copies into the plan commit.

**Solution:**
- Restore every `.claude/**` path from `origin/dev` with one `git checkout origin/dev -- .claude`. It writes both the index and the working tree, so it also covers the two uncommitted edits, which already match.
- Commit `.claude` alone, as one restore commit on top of `HEAD`: 11 files, +182/−75. That is the exact inverse of `2ed9765b`'s `.claude` part.
- Make no hand edit. Do not amend or rebase `2ed9765b`: the branch is pushed, and the pipeline does not force-push. A restore commit gives the same net tree; this is the established pattern (`specs/patch/patch-adw-xcivq0-chore-comment-sweep-restore-scenario-writer-command.md`, `specs/patch/patch-adw-xchzuc-chore-comment-sweep-restore-readme-to-dev.md`).
- `adws/proof/__tests__/proofUploader.test.ts` is neither staged nor reverted.

## Files to Modify
Use these files to implement the patch:

Restore these 11 files to `origin/dev` content with `git checkout`, with no hand edit:
- `.claude/commands/adw_init.md` (the working tree already matches dev; the commit records it)
- `.claude/commands/clean_local_repo.md`
- `.claude/commands/document.md`
- `.claude/commands/feature.md`
- `.claude/commands/generate_step_definitions.md`
- `.claude/commands/resolve_conflict.md`
- `.claude/commands/resolve_failed_test.md`
- `.claude/commands/review.md`
- `.claude/commands/scenario_writer.md`
- `.claude/skills/depaudit-triage/SKILL.md` (the working tree already matches dev; the commit records it)
- `.claude/skills/implement-tdd/SKILL.md`

Not modified:
- `adws/proof/__tests__/proofUploader.test.ts`: it stays an uncommitted working-tree edit, byte for byte.
- `README.md`: the review does not flag its two `2ed9765b` lines, and they document files dev has.
- The spec, and everything under `features/` and `adws/`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run every command from the worktree root, `/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/bugfix-issue-961-promote-webhook-cron-regression-feature`.

### Step 1: Refresh `origin/dev` and confirm the pre-patch state
- Run:
  ```sh
  git fetch origin dev
  git diff --name-status origin/dev...HEAD -- .claude
  test "$(git rev-parse origin/dev:.claude)" = "$(git rev-parse "$(git merge-base origin/dev HEAD):.claude")" && echo "dev .claude == merge-base .claude"
  git status --porcelain
  ```
- The second command must print exactly the 11 paths above, each prefixed `M`.
- The tree check must print its message. If it prints nothing, dev has changed `.claude` since planning:
  - Restore from the merge base instead: in Steps 2 and 3, write `"$(git merge-base origin/dev HEAD)"` wherever the commands say `origin/dev`.
  - The branch then carries no `.claude` change of its own, and the merge takes dev's newer prompts. The Validation commands work unchanged.
- `git status --porcelain` may list only these entries, with nothing staged:
  - ` M .claude/commands/adw_init.md`
  - ` M .claude/skills/depaudit-triage/SKILL.md`
  - ` M adws/proof/__tests__/proofUploader.test.ts`
  - untracked `?? specs/patch/patch-adw-lgska4-bug-promote-the-orph-*.md` entries (this plan, and any sibling plan from the same review)

  If anything else appears, stop and report it. Do not stash.

### Step 2: Restore `.claude` from `origin/dev`, and stage nothing else
- Run exactly:
  ```sh
  git checkout origin/dev -- .claude
  git add -- .claude
  ```
- `git checkout <tree-ish> -- .claude` writes `origin/dev`'s content to both the index and the working tree for every tracked `.claude` path. The resolution's `git add -- .claude` then adds nothing more, because `.claude` holds no untracked, non-ignored file.
- Do not run `git add -A`, `git add .`, `git commit -a`, `git stash`, or `git checkout -- adws/…`.
  - `adws/proof/__tests__/proofUploader.test.ts` must stay unstaged and unmodified.
  - This plan must stay uncommitted, so that the orchestrator's `review-patch-agent` commit picks it up.

### Step 3: Gate the commit
- Run:
  ```sh
  git diff --cached --quiet origin/dev -- .claude && git diff --quiet origin/dev -- .claude && echo "PASS: index and working tree .claude match origin/dev"
  diff <(git diff --cached --name-only) <(git diff --name-only origin/dev...HEAD -- .claude) && echo "PASS: staged set is exactly the branch's 11 .claude paths"
  ```
- Both commands must print `PASS`. The second also proves that `proofUploader.test.ts` is not staged.
- If either fails, do not commit. Report the output instead.

### Step 4: Commit `.claude` alone
- Run:
  ```sh
  git commit -m "patchAgent: fix: restore .claude prompts to origin/dev" -m "Plan commit 2ed9765b staged the host checkout's origin/main copies of
11 framework prompts, which the spec's worktree-hygiene note forbids.
Dev has not changed .claude since the merge base ddaf010a, so merging
would roll dev's prompts back: review.md Step 4, the .github/adw.yml
unitTests rule, and the default-branch wording. Restore .claude to
origin/dev so the pull request carries no .claude change. The unrelated
proofUploader.test.ts working-tree edit stays uncommitted." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  git show --stat --format='%h %s' HEAD
  ```
- `git show --stat` must list the 11 `.claude` paths and nothing else, with `11 files changed, 182 insertions(+), 75 deletions(-)`.
- Do not push. The orchestrator commits this plan and pushes the branch.

## Validation
Execute every command to validate the patch is complete with zero regressions. Run them one at a time.

1. **The review's binding checks: the branch carries no `.claude` change, and a merge keeps dev's prompts.** Three `PASS` lines and the counts in the comments are expected. Before the patch, the merge check compared `40db48f3` against `0dae31e5` and failed.
   ```sh
   git diff --quiet origin/dev...HEAD -- .claude && echo "PASS: git diff origin/dev...HEAD -- .claude is empty"
   MERGED=$(git merge-tree --write-tree origin/dev HEAD) && test "$(git rev-parse "$MERGED:.claude")" = "$(git rev-parse origin/dev:.claude)" && echo "PASS: a merge keeps dev's .claude tree"
   git grep -c -F 'Step Definition Independence' HEAD -- .claude/commands/review.md                       # HEAD:.claude/commands/review.md:1
   git grep -c -F 'adw.yml' HEAD -- .claude/commands/feature.md .claude/skills/implement-tdd/SKILL.md    # feature.md:2 and SKILL.md:1
   ! git grep -n -F -e '`main`, `develop`' -e 'origin/main' HEAD -- .claude && echo "PASS: no hardcoded main/develop"
   ```
2. **Commit hygiene.** Only `.claude` was committed, no host copy is left to be staged again, and the unrelated edit is intact.
   ```sh
   git log --format='%h %s' origin/dev..HEAD -- .claude      # exactly two lines: the restore commit, then 2ed9765b
   git status --porcelain -- .claude                          # prints nothing
   git diff --quiet origin/dev...HEAD -- adws && echo "PASS: nothing under adws/ is committed"
   test "$(git hash-object adws/proof/__tests__/proofUploader.test.ts)" = 10021c3d6eb0aa00641b9cbf7204c74f34b799f6 && echo "PASS: proofUploader.test.ts edit untouched"
   ```
   - An empty `git status --porcelain -- .claude` means the orchestrator's follow-up `/commit` (`git add -A`) finds no `.claude` change to stage.
   - The blob hash is the working-tree file as measured while planning.
3. **The unit tests that read the restored prompts pass, and so does the whole suite (spec Validation 17).**
   ```sh
   env -u ADW_UNIT_TEST_REPORT_PATH bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/depauditTriageSkill.test.ts adws/phases/__tests__/worktreeSetup.test.ts adws/phases/__tests__/worktreeSetupTrackedAssets.test.ts
   bun run test:unit
   ```
   - The first command must report `4 passed (4)` test files and `31 passed (31)` tests. `env -u` stops this partial run from overwriting the run's JUnit report at `$ADW_UNIT_TEST_REPORT_PATH`.
   - The full suite must be green. While planning, on the dev content, it reported `203 passed (203)` files and `3114 passed (3114)` tests.
4. **The issue's own fix is intact (spec Validation 7 and 9).** Run the two commands one at a time: scenarios share `agents/` state.
   ```sh
   NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary            # 0 undefined, 0 ambiguous
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @webhook"     # 11 scenarios (11 passed), exit 0
   ```
5. **Lint and type-checks (spec Validation 13–15).** This patch changes no TypeScript, so these are a zero-regression backstop. All three must pass.
   ```sh
   bun run lint
   bunx tsc --noEmit
   bunx tsc --noEmit -p adws/tsconfig.json
   ```

## Patch Scope
**Lines of code to change:** 0 lines of source. 257 lines of Markdown across 11 `.claude/**` prompt files (+182/−75), restored by `git checkout` with no hand edit, in one restore commit.
**Risk level:** low. The prompt files go back to the exact content that `origin/dev` and the merge base already carry. No TypeScript, test, feature or spec file changes, and this issue's own work is untouched.
**Testing required:**
- Validation 1: the branch's `.claude` diff against the merge base is empty, and a simulated merge keeps dev's `.claude` tree.
- Validation 2: only `.claude` was committed, the `.claude` working tree is clean, and `proofUploader.test.ts` is intact and uncommitted.
- Validation 3: the unit tests that read the restored prompts pass, and so does the full suite.
- Validation 4: the dry run and the promoted webhook feature still pass.
- Validation 5: lint and both type-checks pass.

## Notes
- **When the host copies could be staged again (the review's last check).** Until `4fdba435` reaches main, every orchestrator launch from the host on this branch re-runs `copyClaudeAssetsToWorktree` and writes the 11 host copies back. The next `/commit` (`git add -A`) would then commit them again.
  - Within this review cycle nothing re-copies them, because only `workflowInit.ts` calls the copy. Validation 2's empty `.claude` status therefore still holds when the orchestrator makes its `review-patch-agent` commit.
  - After any relaunch (resume, retry, or pull-request review), re-run `git diff --quiet origin/dev...HEAD -- .claude` before merging. A non-empty result means this patch must be repeated.
- **`proofUploader.test.ts` still reaches the branch through the orchestrator.** This patch keeps the file out of its own commit, as the review asks. Right afterwards, the orchestrator's `review-patch-agent` commit (`adws/phases/reviewPhase.ts:260`) runs `/commit`, which stages with `git add -A`, so the edit lands then.
  - Discarding or stashing it is outside this patch: it is the test phase's flake fix for `uploadProofArtifacts — R2 is not configured`.
  - The owner decides whether to keep it in this pull request or move it to its own change.
- **Ownership doc.** `.adw/conditional_docs.md` assigns these prompts to `app_docs/feature-9gjajh-commands-and-skills.md`. The files return to dev's content, so that doc needs no update.
