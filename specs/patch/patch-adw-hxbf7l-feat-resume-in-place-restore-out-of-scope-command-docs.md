# Patch: Restore three out-of-scope reverted command/doc files to origin/dev

## Metadata
adwId: `hxbf7l-feat-resume-in-place`
reviewChangeRequest: `Issue #1: Out-of-scope command/doc files unrelated to #638 are committed in plan commit 3a43703 and diverge from origin/dev — the recurring 'worktree born with dependency reversion' pattern the spec's Notes (line 298) explicitly designates as a blocker if found via 'git diff origin/dev'. (1) .claude/commands/document.md (+57/-63): ACTIVE REVERT of the merged convergent-docs system — strips semantic-first ownership routing, sibling-collapse (collapseEntries), rewrite-in-place, and the current-state module template, reverting to the old changelog-style 'Generate Documentation' command. Confirmed active (not a stale branch) via 'git merge-base --is-ancestor 17f8548 e750d84' = true (the convergent-docs commit was already merged at the fork point; merge-base document.md contains 'Collapse sibling entries', HEAD does not). (2) .claude/commands/adw_init.md (-11): removes the Owns: glob-block authoring instructions and the document.md hashInput that drive convergent routing (Owns count 2→0). (3) README.md (+5): out-of-scope file-tree additions (docsGuards/docsSelfCheck/stageClassifier entries) unrelated to this slice. Landing this PR would re-break the merged convergent-docs routing. The in-scope #638 source/test/doc changes are correct and must be the only changes in the PR. Resolution: Restore the three files to their origin/dev state and commit the restoration ON TOP of HEAD — the revert lives in non-HEAD plan commit 3a43703 (HEAD~2) which cannot be amended in the patch env: 'git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md && git commit -m "patch: restore three out-of-scope reverted command/doc files"'. Afterward 'git diff origin/dev --name-only' must list only the #638 stage-recovery source/test/doc/feature/spec files.`

## Issue Summary
**Original Spec:** `specs/issue-638-adw-hxbf7l-feat-resume-in-place-sdlc_planner-worktree-reuse-gate-resume-in-place.md`

**Issue:** This worktree was "born with a dependency reversion" — the recurring incident the #638 spec's own Notes (line 298) flags as a review blocker. Plan commit `3a43703` (HEAD~2) committed three command/doc files that are **out of scope for #638** and **actively revert merged work** on `origin/dev`:

1. `.claude/commands/document.md` — reverts the merged **convergent-docs `/document`** command (semantic-first ownership routing, sibling-collapse / `collapseEntries`, rewrite-in-place, current-state module template) back to the old changelog-style "Generate Documentation" command. Confirmed an **active revert**, not a stale branch: `git merge-base --is-ancestor 17f8548 e750d84` = **true** (the convergent-docs commit `17f8548` was already merged at the fork point `e750d84`). Verified: `origin/dev` document.md contains the convergent-docs markers (`collapse sibling`/`collapseEntries`/`semantic-first`); HEAD contains **none**.
2. `.claude/commands/adw_init.md` — removes the `Owns:` glob-block authoring instructions and the `document.md` hashInput that drive convergent routing. Verified: `Owns` references 2 on `origin/dev` → **0** on HEAD.
3. `README.md` — +5 out-of-scope file-tree additions (docsGuards/docsSelfCheck/stageClassifier entries) unrelated to this slice.

Landing the PR as-is would re-break the merged convergent-docs routing. The in-scope #638 changes (the `adws/vcs/` reuse-gate + probe, `adws/triggers/takeoverHandler.ts`, their tests, the feature/step-def/app_docs/spec files) are correct and must be the **only** changes in the PR.

**Solution:** Restore the three files to their `origin/dev` state with a single pathspec `git checkout`, then commit the restoration **on top of HEAD**. The revert lives in non-HEAD plan commit `3a43703` (HEAD~2), which cannot be amended in the patch environment (no interactive rebase) — restore-and-commit-on-top is the established recipe for this class (precedent: commit `1503880`, "patch: restore three out-of-scope command/doc files reverted by worktree"). This is a markdown-only restore: it touches **no** TypeScript, build, or test code.

## Files to Modify
Restore each of these to its `origin/dev` content (no hand-editing — restore verbatim from the `origin/dev` tree):

- `.claude/commands/document.md` — restores the convergent-docs `/document` command (owned by `app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md`).
- `.claude/commands/adw_init.md` — restores the `Owns:` glob-block authoring instructions + `document.md` hashInput (owned by `app_docs/feature-9gjajh-commands-and-skills.md`).
- `README.md` — drops the out-of-scope file-tree additions (owned by `app_docs/feature-9gjajh-root-config.md`).

No living-doc updates are needed: the patch restores these files to the exact `origin/dev` state their owning docs already describe.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify preconditions
- Confirm the working tree is clean so the restoration commit stays focused: `git status --short` must print nothing.
- Confirm `origin/dev` resolves locally (needed for the checkout): `git rev-parse --verify origin/dev`. If it errors or is stale, run `git fetch origin dev` first.
- Confirm the three files currently diverge from `origin/dev`: `git diff origin/dev --name-only` lists `.claude/commands/document.md`, `.claude/commands/adw_init.md`, and `README.md`.

### Step 2: Restore the three files from origin/dev and commit on top of HEAD
- Restore all three with one pathspec checkout (this also stages them):
  ```
  git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md
  ```
- Commit the restoration on top of HEAD (the revert sits in non-HEAD plan commit `3a43703` / HEAD~2 and cannot be amended in this env):
  ```
  git commit -m 'patch: restore three out-of-scope reverted command/doc files'
  ```
- Do **not** use `git add -A` / `git commit -am`. Stay pathspec-scoped to exactly the three files per the recurring "worktree born with dependency reversion" guidance — never sweep these reverted command files into the #638 PR.

### Step 3: Confirm the PR scope is corrected
- Re-run `git diff origin/dev --name-only` and confirm the three command/doc files are **gone** from the list — only the in-scope #638 stage-recovery source/test/doc/feature/spec files remain (the `adws/vcs/worktreeReuseGate.ts` + `worktreeProbe.ts` and their tests, `adws/triggers/takeoverHandler.ts` and its tests, `features/per-issue/feature-63{6,7,8}*`, the `feature-504`/`feature-636`/`feature-638` step defs + `takeover-probe-ctx.ts`, the three `app_docs/feature-*` docs, and the `specs/issue-638-…` spec — plus this patch plan).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md` — **must print nothing** (the three files now match `origin/dev` exactly).
- `git diff origin/dev --name-only` — must **not** list `.claude/commands/document.md`, `.claude/commands/adw_init.md`, or `README.md`; only the #638 in-scope files remain.
- `git show HEAD:.claude/commands/document.md | grep -ciE 'collapse sibling|collapseEntries|semantic-first'` — returns **≥1** (convergent-docs `/document` restored); `git show HEAD:.claude/commands/adw_init.md | grep -ciE 'Owns'` — returns **2** (Owns glob-block instructions restored).
- `git status --short` — empty (clean working tree after the focused commit).
- `bun run test:unit` — the complete Vitest suite passes (zero regressions). The patch touches no TypeScript, so the #638 gate/probe/takeover unit tests are unaffected; this is the zero-regression gate from the spec's Validation Commands.

## Patch Scope
**Lines of code to change:** 0 hand-edited lines. ~131 lines across 3 markdown files are restored to their `origin/dev` content via a single `git checkout` pathspec (no manual edits).
**Risk level:** low — markdown-only restore to the canonical `origin/dev` state; touches no TypeScript, build, or test code, and reverts nothing in the in-scope #638 work.
**Testing required:** `git diff origin/dev` scope verification (the primary proof) plus the full unit suite as a zero-regression gate.
