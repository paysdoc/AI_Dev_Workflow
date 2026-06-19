# Patch: Restore three out-of-scope command/doc files reverted by the #639 worktree

## Metadata
adwId: `11ormi-feat-bounded-resume`
reviewChangeRequest: `Issue #1: Plan commit 017ce0d committed three files unrelated to issue #639 that diverge from origin/dev. (1) .claude/commands/document.md and (2) .claude/commands/adw_init.md ACTIVELY REVERT the merged semantic-routing / sibling-collapse / Owns-glob feature: the dev commit that introduced it (17f8548) is an ancestor of the branch merge-base (e750d84), proven via 'git merge-base --is-ancestor 17f8548 e750d84' returning true, so this is an active revert of merged work and NOT a stale-branch artifact — merging this PR would regress the /document and /adw_init commands on dev. (3) README.md adds out-of-scope doc-tree lines (docsGuards.ts, checkLivingDocsIndex.ts, stageClassifier.ts) unrelated to the resume cap. The spec's own 'Worktree hygiene' note explicitly warned that these exact files must NOT be committed into this PR and that review should blocker any out-of-scope command-file revert of merged work. The in-scope #639 source/test/spec changes are correct and complete; only these three files are the problem.`

## Issue Summary
**Original Spec:** `specs/issue-639-adw-11ormi-feat-bounded-resume-sdlc_planner-bounded-resume-cap-human-gated.md`

**Issue:** The #639 plan commit `017ce0d` committed three files that are unrelated to the bounded-resume-cap feature and diverge from `origin/dev`:

1. **`.claude/commands/document.md`** — *active revert* of the merged semantic-routing / sibling-collapse / `Owns:`-glob `/document` feature. The diff replaces the "Route by ownership (semantic-first)", "Collapse sibling entries", and "Rewrite in place" steps with the older "Generate Documentation" / "Update Conditional Documentation" flow.
2. **`.claude/commands/adw_init.md`** — *active revert* that strips the `Owns:` glob-block authoring instructions and removes `.claude/commands/document.md` from this command's `hashInputs`.
3. **`README.md`** — *out-of-scope additions*: doc-tree lines for `docsGuards.ts` / `docsGuards.test.ts`, `checkLivingDocsIndex.ts`, `stageClassifier.ts` / `stageClassifier.test.ts`, none of which belong to the resume-cap slice.

This is the recurring "worktree born with dependency reversion" pattern (previously seen on #612 / #636 / #637 / #641). The revert is *active*, not a stale-branch artifact: `git merge-base --is-ancestor 17f8548 e750d84` returns **true** (verified), so the feature commit `17f8548` is already an ancestor of this branch's merge-base `e750d84` — merging the PR as-is would **regress `/document` and `/adw_init` on `dev`**. The spec's own **"Worktree hygiene (recurring incident — important)"** note (spec §Notes) explicitly warned these exact three files must NOT be committed and that review should blocker them.

The in-scope #639 source/test/spec/feature changes are **correct and complete** — this patch touches **only** the three offending files.

**Solution:** Restore the three files to their `origin/dev` content and add the restoration as a commit so the PR's net diff against `origin/dev` no longer carries them. The review's stated resolution ("amend commit 017ce0d") cannot be applied literally in this environment — `017ce0d` is `HEAD~1`, not `HEAD`, and editing a non-HEAD commit requires an interactive rebase (unavailable here). Because **`HEAD` (`98ff7bf`) touches none of the three files** (verified: `git log origin/dev..HEAD -- <file>` lists only `017ce0d` for each), a *restore-and-commit-on-top* yields an **identical net tree** against `origin/dev` and satisfies the binding acceptance check (`git diff origin/dev --name-only` shows none of the three files). This is the established repo pattern — precedent commit `1503880 "patch: restore three out-of-scope command/doc files reverted by worktree"` did exactly this in the prior (#637) cycle.

## Files to Modify
This patch restores file **content** via git (it does not hand-edit them); each is reverted to its `origin/dev` version and the restoration is committed:

- `.claude/commands/document.md` — restore to `origin/dev` (drop the semantic-routing revert).
- `.claude/commands/adw_init.md` — restore to `origin/dev` (drop the `Owns:`-block / `hashInputs` revert).
- `README.md` — restore to `origin/dev` (drop the out-of-scope doc-tree additions).

No `adws/**`, `specs/**`, `features/**`, or `adws/types/**` files change — the in-scope #639 work is untouched.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run from the worktree root: `/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/feature-issue-639-bounded-resume-cap-human-gated`.

### Step 1: Ensure `origin/dev` is current and the tree is clean
- `git fetch origin dev` — make sure the local `origin/dev` ref points at the live tip (currently `e750d84`).
- `git status --porcelain` — confirm the working tree is clean before starting (no unrelated uncommitted changes). If it is not clean, stop and surface the unexpected changes rather than committing them.

### Step 2: Restore the three files to their `origin/dev` content
- Run exactly:
  ```sh
  git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md
  ```
- This updates both the index and the working tree for those three paths to match `origin/dev` (so they are already staged for the restore commit). It touches **only** these three paths.

### Step 3: Verify the restoration nets to zero against `origin/dev`
- `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md` — **must print nothing** (the three files now exactly equal `origin/dev`).
- `git status --porcelain` — should list only the three restored paths as staged (`M`), nothing else.

### Step 4: Commit the restoration
- The three files are already staged by Step 2; commit them as a dedicated restore commit (mirrors precedent `1503880`):
  ```sh
  git commit -m "patch: restore three out-of-scope command/doc files reverted by worktree

Restore .claude/commands/document.md, .claude/commands/adw_init.md, and
README.md to origin/dev. The #639 plan commit (017ce0d) carried an active
revert of the merged semantic-routing / Owns-glob /document feature and
out-of-scope README doc-tree lines, unrelated to the bounded resume cap.
This drops them from the PR so only the #639 resume-cap source/test/spec/
feature changes remain. (issue #639 review; recurring worktree-reversion
hygiene incident.)"
  ```
- Do **not** use `git commit -am` / `git add -A` (would risk sweeping in unrelated worktree state). Only the three staged paths are committed.

## Validation
Execute every command. The first three are the binding acceptance checks from the review's resolution; the last two prove the in-scope #639 work is untouched (zero regression).

1. **No out-of-scope files remain in the PR diff** (the review's confirmation step):
   ```sh
   git diff origin/dev --name-only | grep -E '^(\.claude/commands/(document|adw_init)\.md|README\.md)$' \
     && { echo "FAIL: out-of-scope file(s) still in PR diff"; exit 1; } \
     || echo "PASS: no .claude/commands/* or README.md in the diff"
   ```
2. **The in-scope #639 files are still present** in the PR diff (restoration did not over-reach):
   ```sh
   git diff origin/dev --name-only | grep -E 'adws/core/resumePolicy\.ts|adws/triggers/takeoverHandler\.ts|features/per-issue/feature-639\.feature|specs/issue-639-adw-11ormi' \
     && echo "PASS: #639 resume-cap changes intact" \
     || { echo "FAIL: #639 changes missing"; exit 1; }
   ```
3. **The three restored files exactly match `origin/dev`** (empty diff):
   ```sh
   git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md
   ```
   (Must print nothing.)
4. **ADW typecheck still passes** (proves the in-scope source is unaffected — this patch changes no `.ts`):
   ```sh
   bunx tsc --noEmit -p adws/tsconfig.json
   ```
5. **The #639 targeted unit suites still pass** (zero regression to the resume-cap work):
   ```sh
   bunx vitest run adws/core/__tests__/resumePolicy.test.ts adws/core/__tests__/stageClassifier.test.ts adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/cronIssueFilter.test.ts adws/triggers/__tests__/retryHandler.test.ts
   ```

## Patch Scope
**Lines of code to change:** 0 lines of source. ~199 lines of `.claude/commands/*` and ~5 lines of `README.md` reverted to `origin/dev` via `git checkout` (no hand-editing), plus one restore commit.
**Risk level:** low — restores non-code prompt/doc files to their already-merged `origin/dev` state; no TypeScript, test, or spec file is modified; the in-scope #639 changes are not touched.
**Testing required:** Confirm `git diff origin/dev --name-only` carries none of the three files while the #639 changes remain (Validation 1–3); confirm the ADW typecheck and the five #639 unit suites still pass (Validation 4–5) as a zero-regression backstop.

## Notes
- **Why a restore-commit, not a literal `--amend` of `017ce0d`.** `017ce0d` is `HEAD~1` (the plan commit); `HEAD` is the build-agent commit `98ff7bf`, which touches **none** of the three files (verified per-file with `git log origin/dev..HEAD -- <file>`). Amending a non-HEAD commit needs an interactive rebase, which this environment does not support. Restoring the files and committing on top produces an **identical net tree** vs `origin/dev` for those paths, so `git diff origin/dev --name-only` is clean — the actual acceptance criterion the review specifies. This matches the established repo pattern (precedent commit `1503880`, already on `dev`).
- **Active-revert proof (for the reviewer record).** `git merge-base --is-ancestor 17f8548 e750d84` → **true**: the semantic-routing feature commit `17f8548` is an ancestor of this branch's merge-base, so the `document.md` / `adw_init.md` changes are an *active revert of merged work*, not a stale-branch artifact. Ownership corroborates the regression: `.adw/conditional_docs.md` shows `/document` is owned by `app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md` (the convergence-registry / semantic-routing doc) — exactly the merged feature these files would undo.
- **Recurring incident.** This is the same "worktree born with dependency reversion" class flagged on #612 / #636 / #637 / #641 and explicitly pre-warned in the #639 spec's "Worktree hygiene" note. The durable fix lives elsewhere (worktree birth hygiene); this patch only removes the symptom from PR #639.
