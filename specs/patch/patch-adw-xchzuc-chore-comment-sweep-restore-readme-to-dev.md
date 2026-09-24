# Patch: Restore `README.md` to its `origin/dev` content

## Metadata
adwId: `xchzuc-chore-comment-sweep`
reviewChangeRequest: ``Issue #2: Commit d860f46e also committed the two pre-existing, out-of-scope worktree edits the plan said must not be staged or committed: README.md (+ a 'Comment-only diff guard' feature bullet and a `checkCommentOnly.ts` line in the adws/ tree) and .claude/commands/scenario_writer.md (− the 'Feature files carry no commentary' rule). The plan requires the diff to touch exactly the 13 listed files plus the plan and the @adw-872 scenario files, nothing else. `git merge-tree --write-tree origin/dev HEAD` merges cleanly, but the merged README would carry two bullets describing the same guard (this branch's 'Comment-only diff guard' at line 20 and dev's 'Comment-discipline guideline and guard' at line 46) and two `checkCommentOnly.ts` entries in the adws/ tree (lines 889 and 891), duplicating documentation dev already has. scenario_writer.md already matches origin/dev byte for byte, so it merges as a no-op and needs no content change. Sibling sweep branches hit the same problem and were fixed with a restore-to-origin/dev patch. Resolution: Restore README.md to origin/dev content (`git fetch origin dev && git checkout origin/dev -- README.md`) and commit it on this branch; leave .claude/commands/scenario_writer.md as is since it is identical to origin/dev. Afterwards `git diff origin/dev -- README.md` must be empty and `git diff origin/dev...HEAD --name-only` must list only the 13 swept files, the spec, features/per-issue/feature-872.feature, features/per-issue/step_definitions/feature-872.steps.ts, and the no-op scenario_writer.md entry.``

## Issue Summary
**Original Spec:** `specs/issue-872-adw-xchzuc-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-1.md`

**Issue:** The build commit `d860f46e` ("sweep comments in features/per-issue batch 1") committed the whole worktree, which swept in two pre-existing edits the spec explicitly excluded (*Relevant Files*: "Those two edits are not part of this chore. Do not stage or commit them."; *Notes*, last bullet):

- `README.md` (+2 lines on the branch): a **Comment-only diff guard** feature bullet at line 20 and a `checkCommentOnly.ts` tree entry placed *before* `checkLivingDocsIndex.ts` at line 889.
- `.claude/commands/scenario_writer.md` (−1 line): the "Feature files carry no commentary" rule.

Since this branch's merge-base (`34901ec0`, the PR #885 merge), `dev` has documented the same guard its own way: a **Comment-discipline guideline and guard** bullet (line 45 on `origin/dev`), a `checkCommentOnly.ts` tree entry placed *after* `checkLivingDocsIndex.ts` (line 889), plus an unrelated `.github/dependabot.yml` tree entry (line 916). Verified while planning against `origin/dev` = `adadc718`:

- `git merge-tree --write-tree origin/dev HEAD` exits 0 (no textual conflict), but the merged `README.md` carries **both** guard bullets (lines 20 and 46) and **both** `checkCommentOnly.ts` tree entries (lines 889 and 891). Its blob (`1301602e`) differs from dev's (`9b077a95`).
- `git diff --numstat origin/dev -- README.md` is `2	3	README.md` today (branch adds 2 lines dev lacks, lacks 3 lines dev has).
- `git log --oneline origin/dev..HEAD -- README.md` lists only `d860f46e`, which is `HEAD`.
- `.claude/commands/scenario_writer.md` needs no action: `git diff origin/dev -- .claude/commands/scenario_writer.md` is empty because `dev` received the identical one-line deletion after the merge-base. It appears in `git diff origin/dev...HEAD --name-only` only because the three-dot form compares against the merge-base; the merge resolves it as both-sides-same.

**Solution:** Restore the single file with `git fetch origin dev && git checkout origin/dev -- README.md` and commit that restoration on top of `HEAD`. No hand-editing, no other paths. Do **not** amend `d860f46e`: the tip has already been pushed and reviewed, so an amend would need a force-push the pipeline does not perform; a restore commit on top yields the identical net tree and is the established pattern for the sibling sweep branches (`d9114197` for #873 via `specs/patch/patch-adw-srw01j-chore-comment-sweep-restore-readme-to-dev.md`, `7247c7a0` for #881, `ed595e3c` for `scenario_writer.md`). Simulated while planning with a temporary index (working tree and refs untouched): after the restore, `git merge-tree --write-tree origin/dev <tip>` exits 0, the merged `README.md` blob equals `origin/dev:README.md` (`9b077a95`), and `git diff --name-only origin/dev <merged-tree>` lists exactly 16 paths: the 13 Touched Files, the spec, `features/per-issue/feature-872.feature`, and `features/per-issue/step_definitions/feature-872.steps.ts`. Note that `git diff origin/dev...HEAD --name-only` will then list `README.md` as a second no-op entry alongside `scenario_writer.md` (both changed relative to the merge-base, identically on both sides); the review's binding checks are the empty two-dot diff and the merged tree, both of which the simulation satisfies.

## Files to Modify
Use these files to implement the patch:

- `README.md` — restore to `origin/dev` content via git (drops the branch-only **Comment-only diff guard** bullet and its `checkCommentOnly.ts` tree entry; brings back dev's **Comment-discipline guideline and guard** bullet, dev's `checkCommentOnly.ts` tree entry, and the `dependabot.yml` tree entry). This is the only path that changes.

Not modified: `.claude/commands/scenario_writer.md` (already byte-identical to `origin/dev`), the 13 Touched Files, `features/per-issue/feature-872.feature`, `features/per-issue/step_definitions/feature-872.steps.ts`, the spec, and anything under `adws/**`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run from the worktree root: `/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/chore-issue-872-comment-sweep-per-issue-batch-1`.

### Step 1: Refresh `origin/dev` and confirm the pre-patch state
- `git fetch origin dev` — make sure `origin/dev` points at the live tip.
- `git status --porcelain` — the only allowed output is untracked `?? specs/patch/patch-adw-xchzuc-chore-comment-sweep-*.md` entries (this plan and the sibling Issue #1 plan). If any tracked file shows as modified, stop and surface it instead of committing it. Do not stash.
- `git log --oneline origin/dev..HEAD -- README.md` — must list only `d860f46e`. `HEAD` may be `d860f46e` itself or a later patch commit; either is fine.
- `git diff --numstat origin/dev -- README.md` — must print `2	3	README.md`. If it prints nothing, the restore has already landed: skip to Validation.
- `git diff --quiet origin/dev -- .claude/commands/scenario_writer.md && echo "scenario_writer.md identical"` — must print the message; that file gets no action.

### Step 2: Restore `README.md` to its `origin/dev` content
- Run exactly:
  ```sh
  git checkout origin/dev -- README.md
  ```
- This writes `origin/dev`'s blob to the working tree and stages it, touching only that path. Do not hand-edit the file, do not carry any of the branch's wording over, and do not touch any other path. Do **not** run `git add -A`, `git add .`, or `git commit -am`: the patch specs under `specs/patch/` must stay uncommitted so the orchestrator's `review-patch-agent` commit picks them up afterwards.

### Step 3: Verify the restore before committing
- `git diff origin/dev -- README.md` — must print nothing.
- `git diff --cached --name-only` — must print exactly `README.md`.
- `grep -c 'Comment-only diff guard' README.md` — must print `0` (the branch-only bullet is gone).
- `grep -c 'Comment-discipline guideline and guard' README.md` — must print `1` (dev's bullet is back).
- `grep -c 'checkCommentOnly\.ts  #' README.md` — must print `1` (one tree entry, not two).
- `grep -c 'dependabot\.yml' README.md` — must print `1` (dev's tree entry is present).

### Step 4: Commit `README.md` alone
- The file is already staged by Step 2. Commit only that path, with the repo convention `<agent name>: <type>: <present-tense description>`:
  ```sh
  git commit -m "patchAgent: chore: restore README.md to origin/dev" -m "Build commit d860f46e bundled a pre-existing out-of-scope README.md edit
(a second comment-only guard bullet and a second checkCommentOnly.ts
tree entry) into the #872 sweep, which may touch only the 13 listed
files. dev already documents the same guard differently, so the merge
would duplicate both entries. Restore README.md to origin/dev so the PR
lands only the 13 Touched Files, the spec, and the @adw-872 scenario
files. .claude/commands/scenario_writer.md already matches origin/dev
and needs no change. (issue #872 review, issue #2)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
  ```
- `git show --stat --format='%h %s' HEAD` — must list `README.md` alone with `1 file changed, 3 insertions(+), 2 deletions(-)`.
- Do not push. The orchestrator commits the remaining patch specs and pushes the branch.

## Validation
Execute every command to validate the patch is complete with zero regressions. Checks 1 and 2 are the review's binding acceptance checks; checks 3 and 4 are the spec's Validation Commands that prove the in-scope sweep is untouched (all passed on the pre-patch tip `d860f46e` while planning, so any failure is a regression introduced by the patch).

1. **Both out-of-scope files match `origin/dev` and the merge is conflict-free.** The first command must print `PASS`; `git merge-tree` must print a single tree OID, no `CONFLICT` line, and exit 0:
   ```sh
   git diff --quiet origin/dev -- README.md .claude/commands/scenario_writer.md && echo "PASS: README.md and scenario_writer.md match origin/dev"
   git merge-tree --write-tree origin/dev HEAD
   ```
2. **Merging the branch into `dev` would land exactly the 16 in-scope paths, with dev's README.** `comm` must print nothing. Entries for this cycle's own patch specs (`specs/patch/patch-adw-xchzuc-chore-comment-sweep-*.md`) are filtered out because the orchestrator may commit them before or after this check runs. The final three-dot listing is informational: it prints the same 16 paths plus `README.md` and `.claude/commands/scenario_writer.md`, both of which are no-op entries whose two-dot diff (check 1) is empty.
   ```sh
   MERGED=$(git merge-tree --write-tree origin/dev HEAD)
   test "$(git rev-parse "$MERGED:README.md")" = "$(git rev-parse origin/dev:README.md)" && echo "PASS: merged README.md is dev's README.md"
   git diff --name-only origin/dev "$MERGED" | grep -v '^specs/patch/patch-adw-xchzuc-chore-comment-sweep-' | sort > /tmp/xchzuc_merge.txt
   printf '%s\n' features/per-issue/feature-816.feature features/per-issue/feature-819.feature features/per-issue/feature-823.feature features/per-issue/feature-872.feature features/per-issue/step_definitions/feature-533-given.steps.ts features/per-issue/step_definitions/feature-797.steps.ts features/per-issue/step_definitions/feature-810.steps.ts features/per-issue/step_definitions/feature-817.steps.ts features/per-issue/step_definitions/feature-818.steps.ts features/per-issue/step_definitions/feature-823-probes.steps.ts features/per-issue/step_definitions/feature-823.steps.ts features/per-issue/step_definitions/feature-846.steps.ts features/per-issue/step_definitions/feature-872.steps.ts features/per-issue/step_definitions/takeover-probe-ctx.ts features/per-issue/support/feature-846-ensure-driver.ts specs/issue-872-adw-xchzuc-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-1.md | sort > /tmp/xchzuc_expected.txt
   comm -3 /tmp/xchzuc_expected.txt /tmp/xchzuc_merge.txt
   git diff origin/dev...HEAD --name-only
   ```
3. **Comment-only guard still passes for the 13 Touched Files against the default branch** (spec Validation Command 1). Let the guard resolve the base ref itself; pass the paths as separate arguments. Must print `✔ PASS` and exit 0:
   ```sh
   bun run lint:comment-only features/per-issue/feature-816.feature features/per-issue/feature-819.feature features/per-issue/feature-823.feature features/per-issue/step_definitions/feature-533-given.steps.ts features/per-issue/step_definitions/feature-797.steps.ts features/per-issue/step_definitions/feature-810.steps.ts features/per-issue/step_definitions/feature-817.steps.ts features/per-issue/step_definitions/feature-818.steps.ts features/per-issue/step_definitions/feature-823-probes.steps.ts features/per-issue/step_definitions/feature-823.steps.ts features/per-issue/step_definitions/feature-846.steps.ts features/per-issue/step_definitions/takeover-probe-ctx.ts features/per-issue/support/feature-846-ensure-driver.ts
   ```
4. **Typecheck and the per-issue scenario still pass** (spec Validation Commands; this patch changes no TypeScript or feature file, so these are the zero-regression backstop). `bun run test` must exit 0; Cucumber must report `1 scenario (1 passed)` and `3 steps (3 passed)`:
   ```sh
   bun run test
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-872"
   ```
5. **Post-commit hygiene.** The restore commit touches README.md only, and nothing tracked is left dirty:
   ```sh
   git show --stat --format='%h %s' HEAD      # README.md only: 1 file changed, 3 insertions(+), 2 deletions(-)
   git status --porcelain                     # only untracked specs/patch/patch-adw-xchzuc-chore-comment-sweep-*.md entries, if the orchestrator has not committed them yet
   ```

## Patch Scope
**Lines of code to change:** 0 lines of source. A 5-line documentation diff on `README.md` (3 lines restored, 2 removed) applied via `git checkout`, with no hand edit, plus one restore commit.
**Risk level:** low — restores a documentation file to the exact content `dev` already carries; no TypeScript, feature, step-definition, command, or spec file changes, and the 13-file sweep is untouched. The only effect is that the PR no longer duplicates dev's guard documentation on merge.
**Testing required:** README.md and scenario_writer.md diff against `origin/dev` empty and `git merge-tree` clean (Validation 1); the would-be merge lands only the 16 in-scope paths with dev's README (Validation 2); comment-only guard, typecheck, and the `@adw-872` scenario still pass (Validation 3 and 4), matching the pre-patch baseline.

## Notes
- **Ownership doc.** `.adw/conditional_docs.md` assigns `README.md` to `app_docs/feature-9gjajh-root-config.md`. No doc update is needed: the file returns to exactly the content `dev` already carries.
- **Independent of the Issue #1 patch** (`specs/patch/patch-adw-xchzuc-chore-comment-sweep-strip-819-tag-feature-818-steps.md`, a one-comment edit in `features/per-issue/step_definitions/feature-818.steps.ts`). The two patches touch different files and can land in either order; Validation 2's expected list is the same either way.
- **Why the three-dot listing still shows `README.md`.** `dev` changed `README.md` after this branch's merge-base, and after the restore both sides carry identical content. `git diff origin/dev...HEAD` compares against the merge-base, so it lists the file even though the two-dot diff is empty and the merge is a no-op, exactly as it already does for `.claude/commands/scenario_writer.md`. The merge-tree form in Validation 2 shows what the PR would actually land, which is the property the review asks for.
- **Dropped on purpose.** The branch's own wording of the guard bullet and its tree-entry placement are not carried over. `dev`'s existing documentation supersedes them; if any README wording change is wanted, it belongs in a separate docs chore.
