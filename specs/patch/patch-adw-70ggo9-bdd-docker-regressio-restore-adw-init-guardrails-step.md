# Patch: Restore merged #763 "Copy Starter Guardrails Settings" step reverted out-of-scope in adw_init.md

## Metadata
adwId: `70ggo9-bdd-docker-regressio`
reviewChangeRequest: `Issue #1: Out-of-scope active revert of merged work. The plan commit 6fdf20cb ('plan-orchestrator: fix: plan docker EROFS mock server leak fix') modified .claude/commands/adw_init.md (32 lines, -24) even though issue #767 is a BDD Docker EROFS / leaked-mock-server bugfix whose spec touches only test/mocks/test-harness.ts, .github/workflows/regression.yml, and new test/BDD files — adw_init.md is not in scope. The change deletes the entire '7. Copy Starter Guardrails Settings' step (the skip-if-exists cp templates/claude-settings-starter.json .claude/settings.json bootstrap plus the ## Agent Guardrails .adw/project.md note), renumbers steps 8->7 and 9->8, strips the claude-settings-starter.json mention from the frameworkRepoRoot ($3) parameter doc, and removes the step-9 report note about the starter-guardrails copy — all merged issue #763 functionality. This is a verified active revert, not branch staleness: merge-base 31adb1e8 and origin/dev both still contain the 'Copy Starter Guardrails Settings' step, the branch is 0 commits behind origin/dev, and git log <merge-base>..HEAD -- .claude/commands/adw_init.md lists only 6fdf20cb (HEAD~1) while the build commit 6a8962aa does not touch the file. Because adw_init.md is a hashInputs file, shipping this bumps .adw-version and fans the #763 regression out to every registered target repo on the next upgrade regen. Resolution: Restore the merged version and preserve all in-scope work. Run git checkout origin/dev -- .claude/commands/adw_init.md to bring back the #763 'Copy Starter Guardrails Settings' step and the original step numbering, then commit the restoration on top (the revert lives in the non-HEAD plan commit 6fdf20cb, so it cannot be amended). Do not modify any other file — the test/mocks/test-harness.ts, .github/workflows/regression.yml, test-harness.test.ts, and feature-767 changes are correct and must be kept.`

## Issue Summary
**Original Spec:** `specs/issue-767-adw-70ggo9-bdd-docker-regressio-sdlc_planner-fix-docker-erofs-leaked-mock-server.md`

**Issue:** The plan commit `6fdf20cb` (HEAD~1) reverted merged issue **#763** work out of scope. It edited `.claude/commands/adw_init.md` — a file that has nothing to do with the #767 BDD Docker EROFS / leaked-mock-server bug — deleting the entire **"7. Copy Starter Guardrails Settings"** step (the skip-if-exists `cp templates/claude-settings-starter.json .claude/settings.json` bootstrap and the `## Agent Guardrails` `.adw/project.md` note), renumbering steps 8→7 and 9→8, stripping the `templates/claude-settings-starter.json` mention from the `frameworkRepoRoot` (`$3`) parameter doc, and removing the step-9 report note about the starter-guardrails copy. This is a **verified active revert, not branch staleness**:
- merge-base `31adb1e8` **and** `origin/dev` both still contain the "Copy Starter Guardrails Settings" step (`git diff origin/dev HEAD -- .claude/commands/adw_init.md` shows the step being *removed*, i.e. present upstream);
- the branch is **0 commits behind** origin/dev (2 ahead);
- `git log <merge-base>..HEAD -- .claude/commands/adw_init.md` lists **only** `6fdf20cb` (HEAD~1); the build commit `6a8962aa` (HEAD) does **not** touch the file.

Because `adw_init.md` is a `hashInputs:` file, shipping this revert bumps `.adw-version` and fans the #763 regression out to **every registered target repo** on the next `adwUpgrade` regen.

**Solution:** Restore the merged `origin/dev` version of `.claude/commands/adw_init.md` verbatim with `git checkout origin/dev -- .claude/commands/adw_init.md`, then **commit the restoration on top**. The revert lives in the non-HEAD plan commit `6fdf20cb` (HEAD~1), which **cannot be amended** (HEAD is the build commit `6a8962aa`), so a new restore commit on top is the correct remediation. All in-scope #767 work (`test/mocks/test-harness.ts`, `test/mocks/__tests__/test-harness.test.ts`, `.github/workflows/regression.yml`, `features/per-issue/feature-767.feature`, `features/per-issue/step_definitions/feature-767.steps.ts`) is correct and **must be preserved untouched**.

## Files to Modify
Use these files to implement the patch:

- `.claude/commands/adw_init.md` — **the only file to change.** Restore it to the merged `origin/dev` content, re-adding the #763 "Copy Starter Guardrails Settings" step and the original step numbering. Do **not** hand-edit — restore via `git checkout` to guarantee a byte-for-byte match with the merged version and zero drift.

Do **not** modify any other file. In particular, leave the in-scope #767 changes exactly as they are:
- `test/mocks/test-harness.ts`
- `test/mocks/__tests__/test-harness.test.ts`
- `.github/workflows/regression.yml`
- `features/per-issue/feature-767.feature`
- `features/per-issue/step_definitions/feature-767.steps.ts`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm the revert is isolated to the non-HEAD plan commit
- Run `git rev-list --left-right --count origin/dev...HEAD` and confirm the branch is `0` behind origin/dev (staleness is ruled out).
- Run `git log --oneline $(git merge-base origin/dev HEAD)..HEAD -- .claude/commands/adw_init.md` and confirm the **only** commit listed is `6fdf20cb` (the plan commit, HEAD~1). Confirm HEAD (`6a8962aa`, the build commit) does **not** appear — i.e. the working tree is clean and the revert is committed in HEAD~1, which cannot be amended.

### Step 2: Restore the merged version of adw_init.md from origin/dev
- Run exactly:
  ```bash
  git checkout origin/dev -- .claude/commands/adw_init.md
  ```
- This overwrites the working-tree copy with the merged #763 version and stages it in one step (`git checkout <ref> -- <path>` updates both the index and the working tree). The local `origin/dev` ref already contains the correct merged content (verified in Step 1), so no `git fetch` is required.
- Do **not** reconstruct the deleted step by hand with an editor — re-typing the ~24 removed lines risks whitespace/wording drift from the merged original.

### Step 3: Verify the restoration is exact and in-scope work is untouched
- Run `git diff origin/dev HEAD -- .claude/commands/adw_init.md` **plus the staged copy**: confirm that, after the checkout, `git diff --cached origin/dev -- .claude/commands/adw_init.md` prints **nothing** (the staged file now matches origin/dev byte-for-byte).
- Confirm the restored step is present: `grep -n "Copy Starter Guardrails Settings" .claude/commands/adw_init.md` returns a match, and `grep -n "claude-settings-starter.json" .claude/commands/adw_init.md` returns the `$3` parameter-doc mention and the step-7 `cp` command.
- Confirm no other file is staged/modified: `git status --short` should show **only** `.claude/commands/adw_init.md` as staged, nothing else.

### Step 4: Commit the restoration on top (do NOT amend)
- The revert is in HEAD~1 (`6fdf20cb`), so it cannot be amended. Create a **new commit on top of HEAD** that restores the file. Suggested message:
  ```
  patch: restore #763 starter-guardrails step reverted out-of-scope in adw_init.md
  ```
- Use a plain `git commit` of the single staged file (`.claude/commands/adw_init.md`). Do **not** run `git add -A` (that could sweep in unrelated worktree-born reverts); stage only the one restored file (already staged by the `git checkout` in Step 2).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `git diff origin/dev -- .claude/commands/adw_init.md` — prints **nothing** after the restore commit: the file now matches the merged version exactly, so the `.adw-version`-bumping revert is fully neutralized.
- `grep -n "Copy Starter Guardrails Settings" .claude/commands/adw_init.md` — returns the restored step-7 heading (the #763 functionality is back).
- `git diff --stat origin/dev HEAD -- test/mocks/test-harness.ts test/mocks/__tests__/test-harness.test.ts .github/workflows/regression.yml features/per-issue/feature-767.feature features/per-issue/step_definitions/feature-767.steps.ts` — still shows the in-scope #767 changes present and unchanged by this patch (nothing lost).
- `git status --short` — clean working tree after the commit (no stray unstaged changes).
- Zero-regression guard on the untouched code (the patch changes only a markdown command file, so these must remain green exactly as before):
  - `bun run lint`
  - `bunx tsc --noEmit`
  - `bun run build`
  - `bun run test:unit` — the new `test/mocks/__tests__/test-harness.test.ts` tests still pass.

## Patch Scope
**Lines of code to change:** ~24 lines restored in one markdown file (`.claude/commands/adw_init.md`), applied mechanically via `git checkout origin/dev -- …`; no source code touched.

**Risk level:** low — a byte-for-byte restore of a merged file from `origin/dev`, isolated to a single documentation/command file, committed on top (no history rewrite). It only *re-adds* previously-merged #763 content and *removes* an unwanted `.adw-version` bump; it cannot regress the #767 bugfix, which is in a separate untouched commit.

**Testing required:** verify the restored file matches `origin/dev` exactly (empty `git diff origin/dev`), the #763 step is present again, the in-scope #767 files are untouched, and the standard lint/type-check/build/unit-test suite stays green.
