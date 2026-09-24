# Patch: Restore `.claude/commands/scenario_writer.md` to its `origin/dev` content

## Metadata
adwId: `xcivq0-chore-comment-sweep`
reviewChangeRequest: `Issue #1: .claude/commands/scenario_writer.md is modified even though the issue forbids touching any file outside the 45 listed and the spec's residual scan (step 8) requires `git diff --stat origin/dev -- . ':!specs/'` to list only touched files. Commit b59d801a (plan-orchestrator) deleted the rule line '- Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident.' at line 95. That line was added to dev by #853 (PR #885, this branch's merge-base), so merging would silently revert that guideline for every future scenario-writer run. Resolution: Restore .claude/commands/scenario_writer.md to its origin/dev content (e.g. `git checkout origin/dev -- .claude/commands/scenario_writer.md`), commit, and confirm `git diff --stat origin/dev -- . ':!specs/'` lists only the 45 touched files.`

## Issue Summary
**Original Spec:** `specs/issue-882-adw-xcivq0-chore-comment-sweep-sdlc_planner-comment-sweep-forge-workers-vcs-scripts.md`

**Issue:** The plan-orchestrator commit `b59d801a` ("chore: add scenario for issue 882 comment sweep") committed two files: the spec and a one-line deletion in `.claude/commands/scenario_writer.md`. The deleted line is rule 5 under "### 5. Write scenarios › Rules" (line 95 on `origin/dev`):

```
- Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident.
```

That rule was added to `dev` by `bebda8dd` ("add comment discipline guard and guideline", issue #853), merged via PR #885 as `34901ec0`, which is this branch's merge-base. So the deletion is an *active revert of merged work*, not a stale-branch artifact: merging PR #882 as-is would silently drop the guideline for every future `/scenario_writer` run. It also breaks two binding requirements of the issue and spec:

- The issue says "Do not touch any file outside that list" (the 45 Touched Files). `.claude/commands/scenario_writer.md` is not on the list.
- Spec step 8 (Residual scan) requires `git diff --stat origin/dev -- . ':!specs/'` to list only files from the Touched Files list. Today it lists 39 files: the 38 touched files that actually changed plus the stray command file.

The in-scope #882 work (build-agent commit `418d8d43`, 38 source/test files) is correct and untouched by this patch. Verified while planning: the comment-only guard passes for all 45 files against `origin/dev`, and `bun run test`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run test:unit` (145 files, 2321 tests) and `bun run build` all pass on the current branch tip.

**Solution:** Restore the single file to its `origin/dev` content with `git checkout origin/dev -- .claude/commands/scenario_writer.md` and commit that restoration on top of `HEAD`. No hand-editing, no other paths. Amending `b59d801a` literally is not possible here: it is `HEAD~1` (HEAD is `418d8d43`), and editing a non-HEAD commit needs an interactive rebase, which this environment does not support. Because `HEAD` does not touch the file (`git log origin/dev..HEAD -- .claude/commands/scenario_writer.md` lists only `b59d801a`), restore-and-commit-on-top yields an identical net tree against `origin/dev` and satisfies the review's stated acceptance check. This is the established repo pattern (see `specs/patch/patch-adw-11ormi-feat-bounded-resume-restore-out-of-scope-command-doc-files.md`).

## Files to Modify
Use these files to implement the patch:

- `.claude/commands/scenario_writer.md` — restore to `origin/dev` content via git (re-adds the one deleted rule line at line 95). This is the only path that changes.

No `adws/**`, `workers/**`, `scripts/**`, `specs/**`, or `features/**` file changes. The 45 touched files of the sweep are not modified.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run from the worktree root: `/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/chore-issue-882-comment-sweep-forge-workers-vcs-scripts`.

### Step 1: Confirm `origin/dev` is current and the tree is clean
- `git fetch origin dev` — make sure `origin/dev` points at the live tip.
- `git status --porcelain` — must print nothing. If it prints anything, stop and surface the unexpected changes instead of committing them.
- `git diff --stat origin/dev -- .claude/commands/scenario_writer.md` — confirm the pre-patch state is exactly `1 deletion(-)` on this one file.

### Step 2: Restore the file to its `origin/dev` content
- Run exactly:
  ```sh
  git checkout origin/dev -- .claude/commands/scenario_writer.md
  ```
- This updates both the index and the working tree for that single path to match `origin/dev` (so it is already staged). Do not hand-edit the file and do not touch any other path.

### Step 3: Verify the restore nets to zero and nothing else is staged
- `git diff origin/dev -- .claude/commands/scenario_writer.md` — must print nothing.
- `sed -n '95p' .claude/commands/scenario_writer.md` — must print the restored rule line beginning `- Feature files carry no commentary.`
- `git status --porcelain` — must list exactly one staged path: `M  .claude/commands/scenario_writer.md`.

### Step 4: Commit the restoration
- The file is already staged by Step 2. Commit only that path (do **not** use `git add -A` or `git commit -am`). The subject follows the repo convention `<commitPrefix>: <type>: <present-tense description, 50 chars max>`; the ADW commit step supplies the prefix (the agent name, e.g. `patchAgent`):
  ```sh
  git commit -m "patchAgent: chore: restore scenario_writer.md to origin/dev

Plan commit b59d801a deleted the 'Feature files carry no commentary'
rule from .claude/commands/scenario_writer.md. That rule landed on dev
via #853 (PR #885), so the deletion was an active revert of merged work
and an out-of-scope change for the #882 comment sweep (Touched Files
only). Restore the file to origin/dev so the PR's net diff carries only
the 45 listed files. (issue #882 review, issue #1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
  ```

## Validation
Execute every command to validate the patch is complete with zero regressions. Checks 1 and 2 are the review's binding acceptance checks; checks 3 to 5 are the spec's Validation Commands and prove the in-scope sweep is untouched.

1. **Residual scan (spec step 8): the diff against `origin/dev` lists only Touched Files.** Expected: the `comm` output is empty and the diff lists 38 files (the 7 files marked **no-op** in the spec have no diff, by design).
   ```sh
   SPEC=specs/issue-882-adw-xcivq0-chore-comment-sweep-sdlc_planner-comment-sweep-forge-workers-vcs-scripts.md
   sed -n '/^### Touched files/,/^### /p' "$SPEC" | grep -E '^- (adws|workers|scripts)/' | awk '{print $2}' | sort -u > /tmp/xcivq0_touched.txt
   git diff --stat origin/dev -- . ':!specs/' | grep '|' | awk '{print $1}' | sort -u > /tmp/xcivq0_diff.txt
   wc -l < /tmp/xcivq0_touched.txt      # 45
   wc -l < /tmp/xcivq0_diff.txt         # 38
   comm -13 /tmp/xcivq0_touched.txt /tmp/xcivq0_diff.txt   # must print nothing
   git diff --stat origin/dev -- . ':!specs/' | grep -c 'scenario_writer'   # must print 0
   ```
2. **The restored file exactly matches `origin/dev`:**
   ```sh
   git diff origin/dev -- .claude/commands/scenario_writer.md   # must print nothing
   git log --oneline origin/dev..HEAD -- .claude/commands/scenario_writer.md   # lists b59d801a and the new restore commit only
   ```
3. **Comment-only guard still passes for all 45 touched files against `origin/dev`:**
   ```sh
   bun run lint:comment-only $(cat /tmp/xcivq0_touched.txt)
   ```
   Must end with `✔ PASS` for all 45 files and exit 0.
4. **Typechecks and lint still pass** (this patch changes no TypeScript, so these are a zero-regression backstop):
   ```sh
   bun run test
   bunx tsc --noEmit -p adws/tsconfig.json
   bun run lint
   ```
5. **Unit suite and build still pass:**
   ```sh
   bun run test:unit
   bun run build
   git status --porcelain   # must print nothing after the build
   ```

## Patch Scope
**Lines of code to change:** 0 lines of source. 1 line of a slash-command prompt file re-added via `git checkout` (no hand edit), plus one restore commit.
**Risk level:** low — restores a non-code prompt file to its already-merged `origin/dev` state; no TypeScript, test, worker, script, or spec file is modified, and the 45-file sweep is untouched.
**Testing required:** Residual scan shows only Touched Files and no `scenario_writer.md` (Validation 1 and 2); comment-only guard, typechecks, lint, unit suite and build all still pass (Validation 3 to 5), matching the pre-patch baseline recorded above.

## Notes
- **Ownership doc.** `.adw/conditional_docs.md` assigns `.claude/commands/scenario_writer.md` to `app_docs/feature-9gjajh-commands-and-skills.md`. No doc update is needed: the file returns to the exact content that doc already describes.
- **Out-of-scope observation (no action in this patch).** No `features/per-issue/*882*` feature file exists on this branch or on `origin/dev`, so the residual scan's expected output is exactly the 38 changed source files. The review's issue #1 does not cover this; it is recorded only so the implementer can interpret the Validation 1 output correctly.
