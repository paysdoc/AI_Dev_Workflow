# Patch: Align README.md with dev to clear the merge conflict

## Metadata
adwId: `0f9cha-chore-comment-sweep`
reviewChangeRequest: `Issue #1: README.md conflicts with origin/dev. This branch's plan commit (a639bc7b) committed the stray README.md edits the spec told the build agent to leave alone, but PR #886 (the #884 batch, commit c3606f9e) merged to dev during review with a differently-worded version of the same two lines: the feature bullet after 'Issue comment reset' (dev: '**Comment-discipline guideline and guard** — …'; branch: '**Comment-only guard** — …') and the adws/ tree entry for checkCommentOnly.ts (dev: '# Comment-discipline guard: …'; branch: '# Comment-only diff guard: …'). Dev also adds a .github/dependabot.yml tree line this branch lacks. git merge-tree --write-tree origin/dev HEAD exits 1 with CONFLICT (content) in README.md at both hunks, so the auto-merge described in the spec's 'Merge path' note will fail. .claude/commands/scenario_writer.md carries the identical one-line deletion on both sides and merges cleanly, and none of the 31 swept adws/core files overlap with dev's new commits. Resolution: Align this branch's README.md with dev's already-merged wording: run git checkout origin/dev -- README.md on this branch and commit, so both sides carry identical content and the three-way merge resolves trivially. Do not touch the 48 swept files or .claude/commands/scenario_writer.md. Afterwards confirm git merge-tree --write-tree origin/dev HEAD exits 0 and bun run lint:comment-only <48 Touched Files> still reports PASS.`

## Issue Summary
**Original Spec:** specs/issue-870-adw-0f9cha-chore-comment-sweep-sdlc_planner-comment-sweep-adws-core-part2.md
**Issue:** The plan commit `a639bc7b` committed the two stray README.md edits the spec's Step 1 told the build agent to leave alone: the feature bullet after "Issue comment reset" and the `adws/` tree entry for `checkCommentOnly.ts`. PR #886 (commit `c3606f9e`) then merged to dev with differently worded versions of both lines plus a new `.github/dependabot.yml` tree line. `git merge-tree --write-tree origin/dev HEAD` now exits 1 with `CONFLICT (content): Merge conflict in README.md`, so the batch's auto-merge would fail. Confirmed at patch-planning time: `git diff HEAD origin/dev -- README.md` shows exactly those three hunks and nothing else; dev's commits since the merge base touch only `README.md`, `.claude/commands/scenario_writer.md` (identical one-line deletion on both sides, no diff), `features/regression/**`, and the #884 spec, so none of the 48 swept files overlap.
**Solution:** Take dev's already-merged README.md wholesale with `git checkout origin/dev -- README.md`, so both sides of the three-way merge carry identical README.md content and the merge resolves trivially. Proven in advance with a throwaway commit whose only change versus HEAD is dev's README.md: `git merge-tree --write-tree origin/dev <that-commit>` exits 0 with no conflict. Reverting README.md to the merge-base version would merge equally cleanly, but the review asked for dev alignment and that keeps the branch's README.md byte-identical to dev. The build agent only stages the file; the pipeline's `build_committing` step (commit agent: `git add -A` + `git commit`) creates the commit, so an explicit `git commit` in the build step is neither needed nor wanted.

## Files to Modify
Use these files to implement the patch:

- `README.md` — replace with the `origin/dev` version. Three lines differ: the **Comment-discipline guideline and guard** feature bullet (line 45), the `checkCommentOnly.ts` tree entry (line 889), and the added `.github/dependabot.yml` tree line (line 916).

Do not touch the 48 swept files under `adws/core/`, `.claude/commands/scenario_writer.md`, or the spec.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Refresh origin/dev and confirm the conflict is still README.md only
- `git fetch origin dev`
- `git status --short` must print nothing before proceeding.
- `git merge-tree --write-tree origin/dev HEAD; echo "exit=$?"` — expect `exit=1` and a single `CONFLICT (content): Merge conflict in README.md` line. If any other file conflicts, dev has moved again since this plan was written: do not widen the patch, report the extra file in the build output and stop.

### Step 2: Replace README.md with dev's version (stage only, no commit)
- `git checkout origin/dev -- README.md` — updates both the index and the working tree.
- `git diff --stat HEAD -- README.md` must show `README.md | 5 +++--` (3 insertions, 2 deletions).
- `git diff origin/dev -- README.md` must print nothing.
- Do NOT run `git commit`. The pipeline's `build_committing` step commits the staged change with the standard `build-agent: chore: …` message.

### Step 3: Confirm nothing else changed
- `git status --short` must list README.md only (`M  README.md`).
- `git diff --name-only origin/dev -- adws .claude` must list only files under `adws/core/` from the spec's Touched Files. `.claude/commands/scenario_writer.md` must not appear (it is already identical to dev).

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. README.md is identical to dev — must print nothing:
   `git diff origin/dev -- README.md`
2. The three-way merge resolves cleanly. Pre-commit form (merges the staged index tree, so it works before the pipeline commits):
   `git merge-tree --write-tree --merge-base=$(git merge-base origin/dev HEAD) origin/dev $(git write-tree); echo "exit=$?"`
   Must print a tree id, no `CONFLICT` line, and `exit=0`. After the pipeline's commit lands, the review's form must also exit 0: `git merge-tree --write-tree origin/dev HEAD; echo "exit=$?"`.
3. No swept file touched — must list only the 48 Touched Files from the spec, all under `adws/core/`:
   `git diff --name-only origin/dev -- adws`
4. Comment-only guard still passes (the guard fetches and resolves the default branch itself; needs forge auth; do not pass `--base`). Passed at patch-planning time against current dev; must still print `✔ PASS`:
   ```
   bun run lint:comment-only adws/core/__tests__/adwLabels.test.ts adws/core/__tests__/adwVersion.test.ts adws/core/__tests__/adwYmlConfig.test.ts adws/core/__tests__/docsIndexHealth.test.ts adws/core/__tests__/environment.test.ts adws/core/__tests__/githubAppAuth.test.ts adws/core/__tests__/hashComputer.test.ts adws/core/__tests__/issueClassifier.test.ts adws/core/__tests__/issueRecord.test.ts adws/core/__tests__/prReviewInvocation.test.ts adws/core/__tests__/promotionSweepDecider.test.ts adws/core/__tests__/providerConfig.test.ts adws/core/__tests__/resolveFreezeGuard.test.ts adws/core/__tests__/resolveResumeSpawn.test.ts adws/core/__tests__/sshCloneUrl.test.ts adws/core/__tests__/stateHelpers.test.ts adws/core/__tests__/stepDefDetection.test.ts adws/core/__tests__/testVerdict.test.ts adws/core/__tests__/upgradeClaim.test.ts adws/core/__tests__/upgradeFailureCap.test.ts adws/core/__tests__/workspaceBinding.test.ts adws/core/__tests__/workspaceTrust.test.ts adws/core/adwId.ts adws/core/claudeStreamParser.ts adws/core/docsGuards.ts adws/core/guardrailsGate.ts adws/core/hashComputer.ts adws/core/hungOrchestratorDetector.ts adws/core/issueClassifier.ts adws/core/jsonParser.ts adws/core/launchGitContext.ts adws/core/pauseQueue.ts adws/core/phaseRunner.ts adws/core/prReviewInvocation.ts adws/core/promotionIssueBody.ts adws/core/promotionReconcileLink.ts adws/core/promotionTagState.ts adws/core/providerConfig.ts adws/core/resolveFreezeGuard.ts adws/core/resolveVerdict.ts adws/core/slackNotifier.ts adws/core/stageClassifier.ts adws/core/targetRepoManager.ts adws/core/testVerdict.ts adws/core/unaddressedComments.ts adws/core/upgradeFailureCap.ts adws/core/workflowCommentParsing.ts adws/core/workspaceTrust.ts
   ```
5. Regression checks carried over from the spec. No code changes, so all must stay green:
   `bun run lint && bun run test && bunx tsc --noEmit -p adws/tsconfig.json && bun run test:unit && bun run lint:git-guard && bun run build`

## Patch Scope
**Lines of code to change:** 0 code lines. 3 README.md lines (2 reworded, 1 added), taken verbatim from `origin/dev`.
**Risk level:** low
**Testing required:** merge-tree dry run exits 0 with no conflict; comment-only guard reports PASS over the 48 files; the spec's lint, typecheck, unit-test, git-guard, and build commands stay green.
