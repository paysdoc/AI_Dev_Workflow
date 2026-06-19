# Patch: Discard residual uncommitted working-tree revert of two command files

## Metadata
adwId: `hxbf7l-feat-resume-in-place`
reviewChangeRequest: `Issue #1: Out-of-scope working-tree reversion of merged command/doc files (the recurring 'worktree born with dependency reversion' pattern). git diff origin/dev shows .claude/commands/document.md (~120 lines) and .claude/commands/adw_init.md (~11 lines) stripped from the merged convergent-docs format back to the legacy changelog format: origin/dev's document.md has 8 Owns: glob blocks, the working tree has 0; adw_init.md loses its Owns: routing instructions and the document.md hashInput. HEAD itself matches origin/dev for these files (the committed state is clean — restored by f7aeef3), so this is an uncommitted working-tree revert that must not be swept into the PR. The #638 spec (Notes, line 298) explicitly states: 'If review uses git diff origin/dev, blocker any out-of-scope command-file revert.' A restoration patch spec already exists on the branch (commit c74a971, specs/patch/...restore-out-of-scope-command-docs.md) but the working tree still carries the reversion. Note: README.md's working-tree change is forward #638 documentation (adds worktreeReuseGate/WorktreeProbe), not a reversion, and is excluded from this issue. Resolution: Restore the two files to their origin/dev state: git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md. Never git add -A/git commit -am these reverted command files; commit only the #638 stage-recovery source/test/doc files. Verify the final git diff origin/dev shows no command-file revert before opening the PR.`

## Issue Summary
**Original Spec:** `specs/issue-638-adw-hxbf7l-feat-resume-in-place-sdlc_planner-worktree-reuse-gate-resume-in-place.md`

**Issue:** A residual **uncommitted working-tree revert** of two out-of-scope command files — the recurring "worktree born with dependency reversion" pattern the #638 spec's own Notes (line ~298) designate as a review blocker. The working tree strips the merged convergent-docs format from these merged files:

1. `.claude/commands/document.md` — reverts the merged **convergent-docs `/document`** command (semantic-first ownership routing, sibling-collapse / `collapseEntries`, rewrite-in-place) back to the legacy changelog-style command. Verified ground truth: `origin/dev` document.md contains the convergent-docs markers (`collapse sibling`/`collapseEntries`/`semantic-first`) **3** times; the working tree contains them **0** times.
2. `.claude/commands/adw_init.md` — strips the `Owns:` glob-block authoring instructions (semantic-routing guidance + new-format entry-shape example) and the `.claude/commands/document.md` line from the `hashInputs:` block. Verified: `Owns` mentions `2` on `origin/dev` → **0** in the working tree; the `document.md` hashInput line is removed.

**Crucially different from the existing patch spec on this branch.** The committed history is already clean: `git diff origin/dev HEAD -- .claude/commands/document.md .claude/commands/adw_init.md` prints **nothing** (HEAD matches `origin/dev`). The earlier patch spec `specs/patch/patch-adw-hxbf7l-feat-resume-in-place-restore-out-of-scope-command-docs.md` (commit `c74a971`) addressed the **committed** revert that lived in plan commit `3a43703`; that was resolved by the restore-and-commit-on-top in `f7aeef3`. What survives now is an **uncommitted working-tree** copy of the same revert — so the fix is a pure working-tree **discard**, not a new commit.

**`README.md` is explicitly out of scope for this issue.** Its working-tree change is **forward #638 documentation** (it *adds* `worktreeReuseGate`/`WorktreeProbe`/`stageClassifier` file-tree and coordination-summary entries), not a reversion. Verified: HEAD matches `origin/dev` for README too, and the diff is purely additive forward docs. `README.md` must be **left untouched** — it is a legitimate part of the #638 PR.

**Solution:** Discard the two command files' working-tree changes by checking them out from `origin/dev`, exactly as the `reviewChangeRequest` prescribes. Because HEAD already matches `origin/dev` for both files, this returns them to their committed state and leaves a clean tree — **no new commit is created or needed**. This is a markdown-only working-tree operation: it touches **no** TypeScript, build, or test code, and changes **nothing** in the committed #638 work.

## Files to Modify
Restore each to its `origin/dev` content verbatim (no hand-editing — discard the working-tree change via `git checkout`):

- `.claude/commands/document.md` — restores the convergent-docs `/document` command (owned by `app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md`).
- `.claude/commands/adw_init.md` — restores the `Owns:` glob-block authoring instructions + the `document.md` hashInput line (owned by `app_docs/feature-9gjajh-commands-and-skills.md`).

**Do NOT touch** `README.md` (legitimate forward #638 doc) and do **not** stage or commit anything. No living-doc update is needed: the discard returns these files to the exact `origin/dev` state their owning docs already describe.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify preconditions
- Confirm `origin/dev` resolves locally (needed for the checkout): `git rev-parse --verify origin/dev`. If it errors or is stale, run `git fetch origin dev` first.
- Confirm the committed state is already clean (this is a working-tree-only revert, not a committed one): `git diff origin/dev HEAD -- .claude/commands/document.md .claude/commands/adw_init.md` must print **nothing**.
- Confirm the two command files currently diverge in the working tree: `git status --short` lists ` M .claude/commands/document.md` and ` M .claude/commands/adw_init.md` (and ` M README.md`, which stays).

### Step 2: Discard the working-tree revert for the two command files
- Restore both from `origin/dev` with one pathspec checkout (this overwrites the working tree and index with the committed content):
  ```
  git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md
  ```
- Because HEAD already equals `origin/dev` for these two files, the result is a **clean tree** for them — no diff vs HEAD, nothing to commit.
- Do **NOT** run `git add -A` / `git commit -am` / any commit. The #638 PR's command-file content is already correct at HEAD; this step only removes the stray uncommitted edits. Stay pathspec-scoped to exactly these two files per the recurring "worktree born with dependency reversion" guidance — and leave `README.md` alone.

### Step 3: Confirm the PR scope is corrected
- Re-run `git status --short`: the two command files are **gone** from the list; only ` M README.md` remains (the legitimate forward #638 doc).
- Re-run `git diff origin/dev --name-only`: it must **not** list `.claude/commands/document.md` or `.claude/commands/adw_init.md`. (`README.md` may still appear — that is the in-scope forward documentation and is expected.)

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md` — **must print nothing** (both files now match `origin/dev` exactly).
- `git diff origin/dev --name-only` — must **not** list `.claude/commands/document.md` or `.claude/commands/adw_init.md` (only in-scope #638 files plus the forward-doc `README.md` remain).
- `grep -ciE 'collapse sibling|collapseEntries|semantic-first' .claude/commands/document.md` — returns **3** (convergent-docs `/document` restored).
- `grep -cE 'Owns' .claude/commands/adw_init.md` — returns **2** (Owns glob-block instructions restored); `grep -c '\.claude/commands/document\.md' .claude/commands/adw_init.md` — returns **1** (the `document.md` hashInput line restored).
- `git status --short` — shows only ` M README.md`; the two command files are no longer listed (and nothing is staged for commit).
- `bun run test:unit` — the complete Vitest suite passes (zero regressions). The patch touches no TypeScript and creates no commit, so the #638 gate/probe/takeover unit tests are unaffected; this is the spec's zero-regression gate (Validation Commands).

## Patch Scope
**Lines of code to change:** 0 hand-edited lines, 0 commits. ~131 lines across 2 markdown files are discarded from the working tree (restored to their committed `origin/dev` content) via a single `git checkout` pathspec.
**Risk level:** low — a working-tree-only discard to the canonical `origin/dev` state; touches no TypeScript, build, or test code, creates no commit, and reverts nothing in the in-scope #638 work. `README.md` is deliberately untouched.
**Testing required:** `git diff origin/dev` scope verification (the primary proof) plus the full unit suite as a zero-regression gate.
