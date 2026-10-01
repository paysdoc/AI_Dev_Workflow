# Patch: Restore five command prompts that worktree creation reverted to the runner's stale `main`

## Metadata
adwId: `axbb2a-bug-review-checks-st`
reviewChangeRequest: `` Issue #1: The plan commit (ecb15bf3) changed five prompt files that the spec never mentions, and merging would silently undo three merged dev commits. Each file is byte-identical to the stale `main` copy that the ADW runner's checkout is on. This fits `copyClaudeAssetsToWorktree` copying the runner's `target: false` commands over the tracked worktree copies when the worktree was created. (1) `.claude/commands/bug.md` loses the read-only planner rules of 2294d856: no tests or builds while planning, write exactly one file, stop once the plan is written. It also tells the planner to reproduce the bug again. (2) `.claude/commands/chore.md` and `.claude/commands/feature.md` lose the same rules from cae6dbe7. (3) `.claude/commands/document.md` and `.claude/commands/adw_init.md` lose the ADR mapping of 92a759ff: keeping and writing `Decisions:` blocks and `## Decisions` sections, step 8 'Check decisions', and adw_init's guard that leaves an existing `.adw/conditional_docs.md` unchanged. The spec says the plan commit must carry only the plan file. This workflow's own document phase would also run with the reverted `document.md` and could drop the `Decisions:` blocks of the docs it rewrites.
Resolution: Restore only these five files to their dev versions: `git checkout origin/dev -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/document.md .claude/commands/feature.md`, then commit. Afterwards `git diff origin/dev --name-only` must not list them, and `.claude/commands/review.md` must keep its new Step 4. To stop this happening again, the operator should move the ADW runner's checkout from `main` to the current `dev`. ``

## Issue Summary
**Original Spec:** `specs/issue-937-adw-axbb2a-bug-review-checks-st-sdlc_planner-review-independence-check-and-screenshots.md`

**Issue:** The plan commit `ecb15bf3` carries five prompt files that the spec never mentions. The spec says "The plan commit must carry only this plan file". Each file is byte-identical to the ADW runner's checkout, which sits on local `main` at `3f1ed745` (2026-09-28), behind both `origin/main` and `origin/dev`. `copyClaudeAssetsToWorktree` (`adws/phases/worktreeSetup.ts:212`) "overwrites existing files unconditionally" (`app_docs/feature-9gjajh-worktree-and-vcs.md:53`). It copied the runner's commands over the new worktree's tracked copies, and the plan commit picked them up. Merging would undo three commits that are already ancestors of `origin/dev`:
- `.claude/commands/bug.md` (2294d856) loses the read-only planner rules: no tests, builds, linters or type checks while planning, write exactly one file, stop once the plan is written, and list the Validation Commands without running them. It also tells the planner to reproduce the bug again.
- `.claude/commands/chore.md` and `.claude/commands/feature.md` (cae6dbe7) lose the same rules.
- `.claude/commands/document.md` and `.claude/commands/adw_init.md` (92a759ff) lose the ADR mapping: keeping and writing `Decisions:` blocks and `## Decisions` sections, and step 8 "Check decisions". `adw_init.md` also loses its guard that leaves an existing `.adw/conditional_docs.md` unchanged.

These five are exactly the `.claude/commands/` files that differ between the runner's checkout and `origin/dev`. No skill was overwritten: the only skill that differs, `.claude/skills/write-an-adr/`, exists only on dev, and the copy never deletes. `.claude/commands/review.md` differs from dev only by the build agent's new Step 4, which is part of this issue's fix.

**Solution:** Restore the five files to `origin/dev` with one `git checkout origin/dev -- <paths>`, then commit only those paths on top of `HEAD`. No history rewrite is needed. `ecb15bf3` is `HEAD~2` and no later branch commit touches the five files, so a restore commit gives the same net tree as dropping them from the plan commit. Agents read slash commands from the worktree, so the restore also gives this workflow's later document phase dev's `document.md`.

The restore stays put for the rest of this workflow. On this repository's path the copy runs only when the worktree is first created (`adws/phases/workflowInit.ts:278`); reusing a worktree only merges dev and copies `.env`. A merge from dev cannot undo the revert by itself, because the branch changed the files and dev did not. The lasting fix is an operator action outside this patch: move the runner's checkout from `main` to the current `dev`.

## Files to Modify
Use these files to implement the patch:

Restore each file to its `origin/dev` content with `git checkout`. Do not edit them by hand.
- `.claude/commands/adw_init.md`
- `.claude/commands/bug.md`
- `.claude/commands/chore.md`
- `.claude/commands/document.md`
- `.claude/commands/feature.md`

Nothing else changes. Leave these as they are: `.claude/commands/review.md` (its Step 4 is this issue's fix), `README.md`, `.adw-version`, and every file under `adws/`, `features/` and `specs/`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

Run every command from the worktree root. The build agent runs in TDD mode here because `features/per-issue/feature-937.feature` exists. This patch changes no behaviour, so there is no RED step. Do not add or change tests, step definitions or `.feature` files.

### Step 1: Confirm the revert lives only in the plan commit
- `git log --oneline origin/dev..HEAD -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/document.md .claude/commands/feature.md` lists only `ecb15bf3`. Neither the alignment commit `9ce31f7e` nor the build commit `39b78f00` touched these files, so restoring them to dev loses nothing the issue asked for.
- `git diff --stat origin/dev -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/document.md .claude/commands/feature.md` lists exactly these five files and ends with `5 files changed, 8 insertions(+), 39 deletions(-)`.

### Step 2: Restore the five files from `origin/dev`
- Run exactly:
  ```sh
  git checkout origin/dev -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/document.md .claude/commands/feature.md
  ```
- This sets the index and the working tree of those five paths to dev's content and touches nothing else. Use `origin/dev` as it stands, without fetching. At planning time it is `a47f7670`, the branch's merge base.

### Step 3: Commit only the five paths
- Run:
  ```sh
  git commit \
    -m "patchAgent: chore: restore five command prompts to origin/dev" \
    -m "Creating the worktree copied the ADW runner's stale main checkout over the tracked .claude/commands/ files, and the plan commit picked them up. Restore them so the branch no longer reverts the read-only planner rules of bug, chore and feature, or the ADR mapping of /document and /adw_init." \
    -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/document.md .claude/commands/feature.md
  ```
- The pathspec commits these five paths and nothing else. Do not use `git add -A`, `git commit -a`, `--amend` or a rebase.
- Leave this patch plan file (untracked) and any other working-tree changes alone. The review-patch loop commits them right after this build (`runCommitAgent` → `/commit`) and then pushes. Do not push.

### Step 4: Run the validation
- Run every command under `## Validation`.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. The five files match dev and are committed. `git diff --exit-code origin/dev -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/document.md .claude/commands/feature.md` prints nothing and exits 0. `git status --porcelain -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/document.md .claude/commands/feature.md` prints nothing.
2. The branch diff no longer lists them, and `review.md` is the only `.claude/` change left:
   - `git diff origin/dev --name-only | grep -E '^\.claude/commands/(adw_init|bug|chore|document|feature)\.md$'` prints nothing.
   - `git diff origin/dev --name-only -- .claude/` prints exactly `.claude/commands/review.md`.
3. `review.md` keeps its new Step 4, and the rest of the issue's work is untouched (the spec's reproduce checks):
   - `grep -n "^## Step 4: Step Definition Independence Check" .claude/commands/review.md` matches (line 47 at planning time).
   - `grep -rn "screenshotUrls =" adws --include='*.ts'` matches the assignment in `adws/phases/reviewPhase.ts`.
   - `grep -n "## Divergence" specs/adr/0024-tdd-in-build-phase-single-pass-alignment.md specs/adr/0022-review-proof-in-r2-behind-router-worker.md` prints nothing.
4. The restored rules are back:
   - `grep -c "Research is read-only" .claude/commands/bug.md .claude/commands/chore.md .claude/commands/feature.md` prints `1` for each file.
   - `grep -n "### 8. Check decisions" .claude/commands/document.md` matches.
   - `grep -n "already exists and is not empty, leave it unchanged" .claude/commands/adw_init.md` matches.
5. Zero regressions, using the spec's gates: `bun run test:unit`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build`, `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-937"` and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`. Expect the same results as before the patch. No unit test, step definition or scenario reads the wording of these five files: `feature-940.feature` never runs `/document`, and the hash tests on the real checkout check only the digest's format and stability.

## Patch Scope
**Lines of code to change:** 0 written by hand. `git checkout` brings back dev's content in five prompt files (39 lines added, 8 removed), all in one restore commit.
**Risk level:** low
**Testing required:** Git-state checks show that the five files match `origin/dev`, have left the branch diff, and that `review.md` keeps Step 4 (Validation 1–4). The spec's unit, type, lint, build and BDD gates confirm nothing else changed (Validation 5).

## Notes
- Do not touch `.adw-version`. `adw_init.md` and `document.md` are `hashInputs`, so the restore moves the branch's framework hash from `58ba2954…` back to dev's `6a6b1965…`. The stamp `58ba2954…` is the same on dev, where it already differs from the computed hash, and no test compares the two.
- The plan commit's one `README.md` line (`legacyModelUsage.ts`) names a file that exists. The review does not flag it, so it stays.
