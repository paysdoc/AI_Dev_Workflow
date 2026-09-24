# Patch: Restore `README.md` and `.claude/commands/scenario_writer.md` to their `origin/dev` content (drop the out-of-scope edits carried in by the plan commit)

## Metadata
adwId: `l5p91e-chore-comment-sweep`
reviewChangeRequest: `Issue #1: Two files outside the spec's Touched Files list are changed on the branch (introduced by the plan-orchestrator commit 0d0c1788, not by the build commit): README.md gains a 'Comment-only diff guard' feature bullet plus a checkCommentOnly.ts tree entry, and .claude/commands/scenario_writer.md loses the rule line '- Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under \`Feature:\` if the domain term is not self-evident.' That line exists on origin/dev (added by bebda8dd, merged via PR #885 for issue #853), so this PR would revert it. The spec's Step 1 and Notes state these pre-existing working-tree edits are outside scope and must not be committed as part of this chore, and the issue says 'Do not touch any file outside that list'. Resolution: Restore both files to their origin/dev content on this branch (\`git checkout origin/dev -- README.md .claude/commands/scenario_writer.md\`) and commit, so \`git diff origin/dev --name-only\` shows only Touched Files plus the spec. If the README guard documentation is wanted, land it in its own change.`

## Issue Summary
**Original Spec:** `specs/issue-883-adw-l5p91e-chore-comment-sweep-sdlc_planner-comment-sweep-claude-jsonl-r2-proof-promotion.md`

**Issue:** The plan-orchestrator commit `0d0c1788` swept two pre-existing, unrelated working-tree edits into the branch alongside the spec. `README.md` gained a "Comment-only diff guard" feature bullet and a `checkCommentOnly.ts` tree entry (+2 lines), and `.claude/commands/scenario_writer.md` lost the rule line "Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident." (−1 line). Neither file is in the issue's Touched Files list, and the spec's Step 1 and Notes explicitly said to leave these edits uncommitted. The lost rule line lives on `origin/dev` (added by `bebda8dd`, merged via PR #885 for #853). Because `origin/dev`'s copy of that file is byte-identical to the merge-base, merging this branch would auto-resolve to the branch version with no conflict and silently revert the rule. Confirmed on this branch: `git diff origin/dev --stat` shows `README.md | 2 +` and `.claude/commands/scenario_writer.md | 1 -`, and the build commit `836af2df` did not touch either file.

**Solution:** Restore both files to their `origin/dev` blobs with `git checkout origin/dev -- README.md .claude/commands/scenario_writer.md` and let the review-patch cycle commit and push. This is a pure restoration with no hand editing. As of writing, `origin/dev` and the merge-base are the same commit (`34901ec0`), so the restore is exactly an undo of the two stray hunks. The README guard documentation is dropped, not relocated; if it is wanted, it lands in its own change against `dev`.

## Files to Modify
Use these files to implement the patch:

- `README.md` — **restore** to `origin/dev` content via `git checkout` (removes the "Comment-only diff guard" bullet and the `checkCommentOnly.ts` tree entry; 2 lines). No hand edits.
- `.claude/commands/scenario_writer.md` — **restore** to `origin/dev` content via `git checkout` (re-instates the "Feature files carry no commentary…" rule line in the `Rules:` list just above `### 6. @regression tag maintenance sweep`; 1 line). No hand edits.

Nothing else. Do not touch any of the 46 Touched Files, the spec, or any other file.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run from the worktree root.

### Step 1: Sync the base ref and confirm the stray edits match the review
- Run `git fetch origin dev` so `origin/dev` is current (the spec's Step 1 does the same).
- Run `git diff origin/dev --stat -- README.md .claude/commands/scenario_writer.md` and confirm it shows exactly `README.md | 2 +` and `.claude/commands/scenario_writer.md | 1 -`. If the shape differs, stop and read the full diff before restoring.
- Run `git status --short | grep -vE '^\?\? specs/patch/'` and confirm it prints nothing: the only uncommitted entry may be this patch plan. Any other stray edit would be swept into the pipeline's `git add -A` commit.

### Step 2: Restore both files from `origin/dev`
- Run `git checkout origin/dev -- README.md .claude/commands/scenario_writer.md`.
- This writes the `origin/dev` blobs into both the index and the working tree, so the change is already staged. Do not edit either file by hand, and do not re-insert the README bullet or tree entry anywhere else.

### Step 3: Prove the restoration is byte-exact and the branch diff is back in scope
- `git diff origin/dev --quiet -- README.md .claude/commands/scenario_writer.md && echo RESTORED` must print `RESTORED`.
- `grep -Fc 'Feature files carry no commentary' .claude/commands/scenario_writer.md` must print `1` (it prints `0` on the unpatched branch).
- `grep -c 'checkCommentOnly' README.md` and `grep -c 'Comment-only diff guard' README.md` must both print `0` (each prints `2` on the unpatched branch).
- `git diff origin/dev --name-only | grep -E '^(README\.md|\.claude/commands/)'` must print nothing.
- `git diff origin/dev --name-only` must list only the 30 Touched Files that carry comment diffs (6 under `.claude/hooks/`, 7 under `adws/__tests__/`, 5 under `adws/jsonl/`, 2 under `adws/promotion/`, 4 under `adws/proof/`, 5 under `adws/r2/`, and `features/webhook_ensure_cron_on_every_event.feature`) plus the spec `specs/issue-883-adw-l5p91e-chore-comment-sweep-sdlc_planner-comment-sweep-claude-jsonl-r2-proof-promotion.md` (and this patch plan once it is committed).

### Step 4: Commit
- Inside the ADW review-patch cycle, do **not** create a separate commit. `adws/phases/reviewPhase.ts` runs the commit agent (`.claude/commands/commit.md`, prefix `review-patch-agent`) after the patch build; that agent runs `git add -A`, commits, and the phase pushes the branch. Leave the restored files staged from Step 2.
- If this plan is executed standalone (outside the pipeline), commit the two restored files with a message in the repo's `prefix: chore: present-tense description` form, for example `patchAgent: chore: revert stray README and scenario_writer edits`, then push the branch.

## Validation
Execute every command to validate the patch is complete with zero regressions. Run from the worktree root.

1. **Decisive restoration check (byte-exact, both files):**
   `git diff origin/dev --quiet -- README.md .claude/commands/scenario_writer.md && echo RESTORED` → prints `RESTORED`.
   `grep -Fc 'Feature files carry no commentary' .claude/commands/scenario_writer.md` → `1`.
   `grep -c 'checkCommentOnly' README.md` → `0`.
2. **Scope check (the reviewer's stated acceptance criterion):**
   `git diff origin/dev --name-only | grep -E '^(README\.md|\.claude/commands/)'` → prints nothing, so `git diff origin/dev --name-only` shows only Touched Files plus `specs/`. After the pipeline commits, `git show --stat HEAD` must list only `README.md`, `.claude/commands/scenario_writer.md`, and this patch plan.
3. **Comment-only guard over the full batch (unchanged by this patch; proves no collateral damage):**
   `bun run lint:comment-only .claude/hooks/notification.ts .claude/hooks/post-tool-use.ts .claude/hooks/pre-tool-use.ts .claude/hooks/stop.ts .claude/hooks/subagent-stop.ts .claude/hooks/utils/constants.ts .claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts adws/__tests__/adwMerge.test.ts adws/__tests__/adwUpgrade.test.ts adws/__tests__/checkGitGhGuard.test.ts adws/__tests__/checkLivingDocsIndex.test.ts adws/__tests__/depauditSetup.test.ts adws/__tests__/healthCheckChecks.test.ts adws/__tests__/issueDependencies.test.ts adws/__tests__/prTemplateMarker.test.ts adws/__tests__/triggerWebhook.test.ts adws/__tests__/vocabularyTemplate.test.ts adws/jsonl/conformanceCheck.ts adws/jsonl/fixtureUpdater.ts adws/jsonl/index.ts adws/jsonl/schemaProbe.ts adws/jsonl/types.ts adws/promotion/__tests__/promotionScorer.test.ts adws/promotion/__tests__/promotionStatsLoader.test.ts adws/promotion/__tests__/promotionThreshold.test.ts adws/promotion/__tests__/scenarioParser.test.ts adws/promotion/__tests__/vocabularyParser.test.ts adws/promotion/index.ts adws/promotion/promotionScorer.ts adws/promotion/promotionStatsLoader.ts adws/promotion/promotionThreshold.ts adws/promotion/scenarioParser.ts adws/promotion/types.ts adws/promotion/vocabularyParser.ts adws/proof/__tests__/prProofPublisher.test.ts adws/proof/__tests__/proofArtifactHarvester.test.ts adws/proof/index.ts adws/proof/prProofPublisher.ts adws/proof/proofArtifactHarvester.ts adws/proof/types.ts adws/r2/bucketManager.ts adws/r2/index.ts adws/r2/r2Client.ts adws/r2/types.ts adws/r2/uploadService.ts features/webhook_ensure_cron_on_every_event.feature` → `✔ PASS` for all 46 files against `origin/dev`.
4. **Typecheck and lint:**
   `bun run test` → passes. `bunx tsc --noEmit -p adws/tsconfig.json` → passes. `bun run lint` → passes.
5. **Unit tests and the per-issue scenario:**
   `bun run test:unit` → passes.
   `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-883"` → run only if a feature file tagged `@adw-883` exists. None does at the time of writing (`grep -rl '@adw-883' features/` prints nothing), so this step is currently a no-op, as the spec allows.

## Patch Scope
**Lines of code to change:** 3 lines across two Markdown files, all via `git checkout` (2 lines removed from `README.md`, 1 line re-added to `.claude/commands/scenario_writer.md`). No TypeScript, feature, or spec file is touched.
**Risk level:** low — byte-exact restoration of two Markdown files to their `origin/dev` (= merge-base) content; the comment-sweep diff itself is untouched.
**Testing required:** The byte-exact restore and scope checks (1–2) are decisive. Checks 3–5 re-run the spec's validation suite to prove zero regressions; a Markdown-only restore cannot affect them, but they are cheap to run.
