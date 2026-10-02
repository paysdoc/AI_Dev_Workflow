# Patch: Restore ten prompt files that the plan commit reverted to the runner's stale `main`

## Metadata
adwId: `3lva71-bug-the-conformance`
reviewChangeRequest: `` Issue #1: Plan commit cdd13660 also committed reverts of 10 prompt files: `.claude/commands/{adw_init,bug,chore,clean_local_repo,document,feature,resolve_conflict,resolve_failed_test,review}.md` and `.claude/skills/depaudit-triage/SKILL.md`. The spec's Notes say these edits are not part of the fix and must not be committed with it (ADR-0056). Effect 1: `bun run lint:branch-names` exits 1 with 8 violations, all on lines this commit brought back: clean_local_repo.md:12, document.md:6, 17, 18 and 19, resolve_conflict.md:12, resolve_failed_test.md:16 and review.md:17. `.github/workflows/git-cli-guard.yml` runs this guard on every pull request, so the PR goes red for a reason unrelated to #939. Effect 2: merging would strip newer prompt text from dev. That includes `/review` Step 4, the step-definition independence check (this review ran with the reverted copy); the read-only and time-limit planning rules in `/bug`, `/chore` and `/feature`; `/document`'s Decisions blocks and default-branch argument; `/adw_init`'s rule to keep an existing conditional_docs.md; and depaudit-triage's `adw:bug` label routing. The depaudit-triage restore is staged in the worktree but not committed.
Resolution: Restore the files from dev and commit only that change: `git checkout origin/dev -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/skills/depaudit-triage/SKILL.md`. Then confirm that `git diff origin/dev HEAD --name-only -- .claude/` prints nothing and that `bun run lint:branch-names` passes. Change no other file. ``

## Issue Summary
**Original Spec:** `specs/issue-939-adw-3lva71-bug-the-conformance-sdlc_planner-fail-conformance-gate-missing-secret.md`

**Issue:** The plan commit `cdd13660` carries ten prompt files that the #939 fix never touches. The spec's Notes say these edits "are not part of this fix and must not be committed with it (ADR-0056)". On `HEAD`, each of the ten is byte-identical to the ADW runner's checkout, which sits on local `main` at `3f1ed745`, behind dev. When the worktree was created, `copyClaudeAssetsToWorktree` (`adws/phases/worktreeSetup.ts:212`) copied the runner's prompts over the worktree's tracked copies. The plan commit's `git add -A` (step 2 of `.claude/commands/commit.md`) then staged them. This has two effects:
- `bun run lint:branch-names` exits 1 with 8 violations, all on lines the revert brought back: `clean_local_repo.md:12`, `document.md:6`, `:17`, `:18`, `:19`, `resolve_conflict.md:12`, `resolve_failed_test.md:16` and `review.md:17`. The `branch-names` job of `.github/workflows/git-cli-guard.yml` runs on every pull request, so the PR goes red for a reason unrelated to #939.
- Merging would strip newer text from dev:
  - `/review` Step 4, the step-definition independence check;
  - the read-only and time-limit planning rules of `/bug`, `/chore` and `/feature`;
  - `/document`'s `Decisions:` blocks, its step 8 "Check decisions" and its `defaultBranch` argument;
  - `/adw_init`'s rule to keep an existing `.adw/conditional_docs.md`;
  - depaudit-triage's `adw:bug` label routing, which `adws/__tests__/depauditTriageSkill.test.ts` pins.

`.claude/skills/depaudit-triage/SKILL.md` is already staged at dev's content but not committed. No other change is pending.

**Solution:** Restore the ten files with one `git checkout` from the branch's merge base with dev, then commit only those ten paths on top of `HEAD`. No history rewrite is needed. Only `cdd13660` touches these files on the branch, so a restore commit leaves the same net tree as dropping them from it.

The restore source is the merge base (`1e7fa6d4`), not the moving `origin/dev` ref. While this patch was planned, another process fetched and moved `origin/dev` to `d16c5784` (PR #953). That merge did not touch any of the ten files, so both refs hold identical content for them, and the result is exactly the review's resolution. The merge base keeps the restore exact even if dev moves again before the build runs.

The same move affects one check. #953 added `.claude/commands/correct_output.md`, so the review's two-dot `git diff origin/dev HEAD --name-only -- .claude/` now lists that file whatever this patch does. The branch's own `.claude/` changes are therefore checked with the three-dot form `origin/dev...HEAD`. It compares `HEAD` with the merge base, which is what the review's check meant while dev and the merge base were the same commit.

The restore holds for the rest of this run. On this repository's path, the copy runs only when the worktree is first created (`adws/phases/workflowInit.ts:278`). A reused worktree only merges the default branch and copies `.env`. Agents read slash commands from the worktree, so this run's later phases use dev's `/review` and `/document`.

## Files to Modify
Use these files to implement the patch:

Restore each file to its merge-base content with `git checkout`. Do not edit them by hand.
- `.claude/commands/adw_init.md`
- `.claude/commands/bug.md`
- `.claude/commands/chore.md`
- `.claude/commands/clean_local_repo.md`
- `.claude/commands/document.md`
- `.claude/commands/feature.md`
- `.claude/commands/resolve_conflict.md`
- `.claude/commands/resolve_failed_test.md`
- `.claude/commands/review.md`
- `.claude/skills/depaudit-triage/SKILL.md`

Nothing else changes. Leave the #939 fix exactly as committed: `.github/workflows/envelope-conformance.yml`, `README.md`, `app_docs/`, `adws/` (including `adws/phases/worktreeSetup.ts`), `features/`, `specs/adr/` and the spec. Leave `.gitignore` and `.adw-version` alone, and do not merge dev into the branch.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

Run every command from the worktree root. Write every path out in full, as below: in zsh, an unquoted `$VAR` that holds several paths reaches git as a single argument. The build agent runs in TDD mode because `features/per-issue/feature-939.feature` exists (`adws/agents/buildAgent.ts:72-73`). This patch changes no behaviour, so it has no RED step. Do not add or change tests, step definitions or `.feature` files.

### Step 1: Confirm the starting state
- `git rev-parse HEAD` prints `1a90188d31b9b27b3a8288488b674c1f264e747c`, and `git merge-base HEAD origin/dev` prints `1e7fa6d46cdda5311992bbf500f67910fcead03d`.
- Only the plan commit touches the ten files. This lists only `cdd13660`:
  ```sh
  git log --oneline "$(git merge-base HEAD origin/dev)"..HEAD -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/skills/depaudit-triage/SKILL.md
  ```
- `git status --porcelain` prints `M  .claude/skills/depaudit-triage/SKILL.md` and `?? specs/patch/patch-adw-3lva71-bug-the-conformance-restore-reverted-prompts.md` (this plan), and nothing else.

### Step 2: Restore the ten files from the merge base
- Run exactly:
  ```sh
  git checkout "$(git merge-base HEAD origin/dev)" -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/skills/depaudit-triage/SKILL.md
  ```
- This sets the index and the working tree of those ten paths to the merge base's content and touches nothing else. No fetch is needed.
- `depaudit-triage/SKILL.md` is already staged at that content, so the checkout leaves it as it is.
- `.claude/commands/adw_init.md` matches a `.gitignore` entry but is tracked, so `git checkout` and the commit below treat it like the others. No `-f` is needed.

### Step 3: Commit only the ten paths
- Run:
  ```sh
  git commit \
    -m "patchAgent: fix: restore prompts reverted by plan commit" \
    -m "Creating the worktree copied the ADW runner's stale checkout over the tracked .claude/ prompts, and the plan commit picked them up. Restore them to the branch point so the branch-name guard passes and merging keeps dev's newer /review, /bug, /chore, /feature, /document, /adw_init and depaudit-triage text." \
    -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/skills/depaudit-triage/SKILL.md
  ```
- The pathspec commits these ten paths and nothing else. Do not use `git add -A`, `git commit -a`, `--amend`, a rebase or a push.
- Leave this plan file untracked. The review-patch loop commits it right after this build (`runCommitAgent` → `/commit`, `adws/phases/reviewPhase.ts:261`) and then pushes the branch.

### Step 4: Run the validation
- Run every command under `## Validation`.
- This patch changes only prompt text. If a gate fails for a reason outside the ten files, report it. Do not change any other file to fix it.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. **The restore is one commit of exactly the ten files, and nothing under `.claude/` is left for the next `git add -A`.**
   - `git diff --name-only 1a90188d HEAD` prints exactly the ten paths of `Files to Modify`.
   - `git diff --name-only origin/dev...HEAD -- .claude/` prints nothing, so the branch no longer changes any file under `.claude/`. Before the patch it prints the ten paths.
   - `git status --porcelain -- .claude/` prints nothing.
   - The review's two-dot `git diff --name-only origin/dev HEAD -- .claude/` lists none of the ten paths. It does list `.claude/commands/correct_output.md`, which dev added after the review (PR #953). The branch never touched that file, and merging dev brings it in.
2. **The branch-name guard passes.** `bun run lint:branch-names` exits 0 and prints `✔ PASS  No file names a branch to act on.` Before the patch it exits 1 with the 8 violations the review lists. At planning time, the guard's own `scanMarkdown` found no violations in dev's copies of the nine scanned command files.
3. **Dev's text is back.**
   - `grep -n "^## Step 4: Step Definition Independence Check" .claude/commands/review.md` matches line 47.
   - `grep -c -E "Research is read-only|Planning runs under a hard time limit" .claude/commands/bug.md .claude/commands/chore.md .claude/commands/feature.md` prints `2` for each file.
   - `grep -n -E '^defaultBranch: \$3|^### 8\. Check decisions' .claude/commands/document.md` matches lines 13 and 78.
   - `grep -n "already exists and is not empty, leave it unchanged" .claude/commands/adw_init.md` matches line 77.
   - `bunx vitest run adws/__tests__/depauditTriageSkill.test.ts` passes. It checks the skill's `gh label create 'adw:bug'` and `--label adw:bug` lines.
4. **The #939 fix is untouched.**
   - `git diff --name-only origin/dev...HEAD` lists 18 files, none of them under `.claude/`.
   - `bunx vitest run adws/__tests__/envelopeConformanceWorkflow.test.ts` passes.
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-939"` passes all four scenarios.
5. **Zero regressions**, using the spec's gates: `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build`, `bun run lint:git-guard`, `bun run lint:docs-index`, `bun run test:unit`, `bun run jsonl:check` and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`. Apart from `depauditTriageSkill.test.ts`, no unit test or scenario reads the wording of the ten files. The `@regression` hashing and upgrade scenarios (`feature-537`, `feature-729`) build their own fixture frameworks.

## Patch Scope
**Lines of code to change:** 0 written by hand. `git checkout` brings back the branch point's content in ten prompt files (73 lines added, 21 removed), all in one restore commit.
**Risk level:** low
**Testing required:** Git-state checks show that the restore is one commit of exactly the ten files and that the branch no longer changes `.claude/` (Validation 1). The branch-name guard passes (2). Content checks and the skill's unit test show dev's text is back (3). The #939 contract test and scenarios, plus the spec's lint, type, build, unit and regression gates, show nothing else changed (4–5).

## Notes
- Do not touch `.adw-version`. `adw_init.md` and `document.md` are `hashInputs` of the framework hash, so the restore returns the computed hash to dev's value. The branch does not change the stamp.
- The root cause is out of scope and still open. The runner's checkout is still on local `main` at `3f1ed745`, `copyClaudeAssetsToWorktree` overwrites tracked prompts when it creates a worktree, and the plan commit stages them through `git add -A` (ADR-0056, Divergence item 1). This is the second patch of its kind, after `specs/patch/patch-adw-axbb2a-bug-review-checks-st-restore-reverted-command-prompts.md` for #937. Moving the runner's checkout to the current dev stops it recurring.
- Also out of scope: `git merge-tree` showed at planning time that merging the current dev (`d16c5784`) into this branch conflicts in `app_docs/feature-9gjajh-jsonl-schema.md`, which both #953 and this branch edit. This patch does not merge dev.
