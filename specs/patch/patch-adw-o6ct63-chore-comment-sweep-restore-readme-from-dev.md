# Patch: Restore `README.md` to `origin/dev` content (drop the plan commit's out-of-scope README edits)

## Metadata
adwId: `o6ct63-chore-comment-sweep`
reviewChangeRequest: `Issue #1: README.md was modified outside the 33 Touched Files (introduced by plan commit 2827f8b4, not by the build commit): it adds a '**Comment-only guard**' feature bullet near line 18 and a 'checkCommentOnly.ts' entry in the adws/ tree listing near line 888. origin/dev (via merged PR #886) already documents the guard with a '**Comment-discipline guideline and guard**' bullet and its own 'checkCommentOnly.ts' tree entry in different positions and wording. A read-only trial merge (git merge-tree --write-tree origin/dev HEAD) completes without conflict but leaves README.md with two bullets for the same feature (lines 18 and 46) and two checkCommentOnly.ts tree entries (lines 889 and 891). The issue text explicitly forbids touching any file outside the list, and the residual diff against origin/dev is README.md only (2 insertions, 3 deletions). Note: .claude/commands/scenario_writer.md was also touched by the plan commit, but its one-line removal is identical to what PR #886 merged, so it has no residual diff against origin/dev and needs no action. Resolution: Restore README.md to the default-branch content so this branch carries no README diff: in the worktree run \`git checkout origin/dev -- README.md\`, confirm \`git diff origin/dev --stat -- README.md\` prints nothing, and commit the result. Do not touch any of the 33 swept adws/core files, .claude/commands/scenario_writer.md, or the spec file.`

## Issue Summary
**Original Spec:** `specs/issue-869-adw-o6ct63-chore-comment-sweep-sdlc_planner-comment-sweep-adws-core-part1.md`

**Issue:** Issue #869 forbids touching any file outside its 33 Touched Files, yet the plan commit `2827f8b4` added two lines to `README.md` (a `**Comment-only guard**` feature bullet at line 18 and a `├── checkCommentOnly.ts` entry in the `adws/` tree listing at line 888). The build commit `14cf28c8` did not touch `README.md`. Meanwhile `origin/dev` (PR #886) documents the same guard with its own `**Comment-discipline guideline and guard**` bullet and its own `checkCommentOnly.ts` tree entry, placed and worded differently. Confirmed in this worktree:
- `git show --stat 2827f8b4` → `README.md | 2 +` (plus the spec file and a one-line `scenario_writer.md` removal that is already identical on `origin/dev`).
- `git diff origin/dev --stat -- README.md` → `README.md | 5 ++---` (2 insertions, 3 deletions; the only residual README divergence).
- `git merge-tree --write-tree origin/dev HEAD` merges cleanly but its `README.md` carries two feature bullets (lines 18 and 46) and two `checkCommentOnly.ts` tree entries (lines 889 and 891).
- `git diff origin/dev --stat -- .claude/commands/scenario_writer.md` → empty, so that file needs no action.

**Solution:** Follow the reviewer's resolution verbatim: overwrite the worktree's `README.md` with the `origin/dev` version via `git checkout origin/dev -- README.md`, so the branch carries no README diff at all and the merge into `dev` is a no-op for that file. Two alternatives were considered and rejected: restoring `README.md` from the merge-base `34901ec0`, or hand-deleting the two plan-added lines. Both also remove the post-merge duplicates, but both leave `git diff origin/dev -- README.md` non-empty (the reverse of `dev`'s later README edits), so they fail the reviewer's stated verification and the hand-edit adds room for error. Checking out `origin/dev`'s file is the smallest change that satisfies the check exactly. No unit test reads the real `README.md` (every test hit for `README.md` under `adws/` is a fixture string or sandbox file), so this is a documentation-only, zero-code change.

## Files to Modify
Use these files to implement the patch:

- `README.md` — **the only file changed.** Replace its content with `origin/dev`'s copy (byte-identical). Do not hand-edit it.
- Do **not** touch: any of the 33 swept `adws/core/**` files listed in the spec, `.claude/commands/scenario_writer.md`, or the spec file `specs/issue-869-adw-o6ct63-chore-comment-sweep-sdlc_planner-comment-sweep-adws-core-part1.md`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run every command from the worktree root. Every `git checkout` in this plan is path-scoped to `README.md`; never run it without the `-- README.md` path argument.

### Step 1: Refresh `origin/dev` and confirm the starting state
- Run `git fetch origin dev` so `origin/dev` is the current default-branch tip (the one that contains PR #886).
- Run `git status --short` → must print nothing (clean tree). If it is not clean, stop and report; do not proceed on top of unrelated edits.
- Run `git diff origin/dev --stat -- README.md` → must print `README.md | 5 ++---` (`2 insertions(+), 3 deletions(-)`). This is the defect being fixed.

### Step 2: Restore `README.md` from `origin/dev`
- Run exactly: `git checkout origin/dev -- README.md`
- This overwrites the working-tree file with `origin/dev`'s `README.md` **and stages it** in the index. It removes the two plan-added lines (the `**Comment-only guard**` bullet and the plan's `checkCommentOnly.ts` tree entry) and adopts `dev`'s three lines (the `**Comment-discipline guideline and guard**` bullet, `dev`'s `checkCommentOnly.ts` tree entry, and the `.github/dependabot.yml` tree entry). That is the expected and complete change.
- Do not open or edit `README.md` afterwards; any manual edit would reintroduce a residual diff.

### Step 3: Confirm the file matches `dev` and nothing else moved
- Run `git diff origin/dev --stat -- README.md` → must print nothing (the reviewer's acceptance check).
- Run `git diff --cached --name-only` → must print exactly `README.md`.
- Run `git status --short` → must print exactly `M  README.md` (staged, nothing unstaged, no other paths).
- Run `grep -c 'Comment-only guard\|Comment-discipline guideline and guard' README.md` → must print `1`, and `grep -c '^├── checkCommentOnly.ts' README.md` → must print `1` (one bullet, one tree entry, both `dev`'s wording).

### Step 4: Commit the restored file
- Leave `README.md` staged: the ADW patch workflow's build phase runs the commit agent immediately after this plan is implemented, and it will commit the staged change.
- Only if this plan is being implemented by hand outside the workflow, commit `README.md` alone:
  ```bash
  git commit -m "chore: restore README.md to origin/dev content (outside issue #869 Touched Files)

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- README.md
  ```
- After the commit exists (either path), `git show --stat --format= HEAD` must list `README.md` only.

## Validation
Execute every command to validate the patch is complete with zero regressions. Run from the worktree root.

1. **Reviewer's acceptance check (residual README diff is gone):**
   `git diff origin/dev --stat -- README.md` → prints nothing. Also `cmp <(git show origin/dev:README.md) README.md` → prints nothing (byte-identical to `dev`).
2. **Scope guard (only `README.md` changed; the 33 swept files, `scenario_writer.md`, and the spec are untouched):**
   before commit, `git diff --cached --name-only` → exactly `README.md` and `git status --short` → exactly `M  README.md`; after commit, `git show --stat --format= HEAD` → lists `README.md` only, and `git diff origin/dev --stat -- .claude/commands/scenario_writer.md` → prints nothing.
3. **Post-merge duplicates are gone (run after the commit exists):**
   `TREE=$(git merge-tree --write-tree origin/dev HEAD) && git show "$TREE:README.md" | grep -c 'Comment-only guard\|Comment-discipline guideline and guard'` → prints `1`, and `git show "$TREE:README.md" | grep -c '^├── checkCommentOnly.ts'` → prints `1`. (Before this patch both print `2`.)
4. **Spec's primary acceptance check still passes (README is outside its file set, so this must be unaffected):**
   `bun run lint:comment-only adws/core/__tests__/devServerLifecycle.test.ts adws/core/__tests__/docsGuards.test.ts adws/core/__tests__/execWithRetry.test.ts adws/core/__tests__/forgeWiring.test.ts adws/core/__tests__/guardrailsPayload.test.ts adws/core/__tests__/hungOrchestratorDetector.test.ts adws/core/__tests__/launchGitContext.test.ts adws/core/__tests__/phaseRunner.test.ts adws/core/__tests__/stageClassifier.test.ts adws/core/__tests__/topLevelState.test.ts adws/core/adwVersion.ts adws/core/adwYmlConfig.ts adws/core/agentState.ts adws/core/authGate.ts adws/core/conditionalDocsRegistry.ts adws/core/constants.ts adws/core/devServerLifecycle.ts adws/core/docsIndexHealth.ts adws/core/forgeWiring.ts adws/core/githubAppAuth.ts adws/core/guardrailsPayload.ts adws/core/heartbeat.ts adws/core/index.ts adws/core/portAllocator.ts adws/core/processKill.ts adws/core/promotionSweepDecider.ts adws/core/remoteReconcile.ts adws/core/resolveResumeSpawn.ts adws/core/resumePolicy.ts adws/core/retryOrchestrator.ts adws/core/sshCloneUrl.ts adws/core/stateHelpers.ts adws/core/stepDefDetection.ts` → `✔ PASS` for all 33 files. Do not pass `--base`.
5. **Zero regressions across the spec's remaining validation commands (a Markdown-only change must leave all of these green):**
   `bun run lint`, `bun run test` (typecheck), `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `bun run lint:docs-index`. If any of these fails, the failure is pre-existing on the branch and unrelated to `README.md`; fix it only if it is caused by this branch's changes, otherwise report it.

## Patch Scope
**Lines of code to change:** 0 lines of code; 5 lines of `README.md` (2 plan-added lines dropped, 3 `origin/dev` lines adopted), leaving the file byte-identical to `origin/dev`.
**Risk level:** low — a single documentation file is reset to the default-branch copy via a path-scoped `git checkout`; no TypeScript, feature file, or spec is touched, and no unit test reads the real `README.md`.
**Testing required:** The git-level checks in validation items 1–3 are decisive (residual diff empty, only `README.md` changed, post-merge duplicates gone); items 4–5 rerun the spec's guard and regression commands to confirm nothing else moved.
