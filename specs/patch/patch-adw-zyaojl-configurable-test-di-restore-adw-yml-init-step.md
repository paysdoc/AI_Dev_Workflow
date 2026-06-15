# Patch: Restore #576's `Create .github/adw.yml` step in `adw_init.md` (preserve #577's Test Directory/Framework emission)

## Metadata
adwId: `zyaojl-configurable-test-di`
reviewChangeRequest: `Issue #1: .claude/commands/adw_init.md is missing #576's "Create .github/adw.yml (only if absent)" step (and the .github/adw.yml status line in the Report step). The merge-base (dbd70d5) and origin/dev both contain this step (grep -Fc = 2); the branch HEAD contains 0 — it was removed by this branch's plan/build commits (c13ec80, 6731c8b). This is precisely the worktree contamination the spec's Step 0 and Notes required discarding via git checkout -- .claude/commands/adw_init.md. Critically, origin/dev's adw_init.md is byte-identical to the merge-base (the only divergent dev commit, c9f613d, touches just agentic_kpis.md), so a git merge into dev reports NO conflict and auto-resolves to the branch version — silently dropping the step. Effect: after this PR merges, target repos initialized or regenerated via /adw_init will no longer have .github/adw.yml created, removing #576's unit-test/HITL gate provisioning. The feature's own additive change (emitting ## Test Directory / ## Test Framework) is correct and still raises the framework hash; the only defect is the collateral deletion of the adw.yml step. Resolution: Restore the "Create .github/adw.yml (only if absent)" step, keeping its heredoc byte-identical to ADW_YML_TEMPLATE in adws/core/adwYmlConfig.ts; restore the .github/adw.yml status line in the Report step; and renumber the Report step back to 9 — while preserving the new ## Test Directory / ## Test Framework emission this feature adds. Verify with: git show HEAD:.claude/commands/adw_init.md | grep -Fc 'Create \`.github/adw.yml\`' returns 2.`

## Issue Summary
**Original Spec:** `specs/issue-577-adw-zyaojl-configurable-test-di-sdlc_planner-configurable-test-directory.md`

**Issue:** This worktree was created with stray uncommitted edits (unrelated to #577) that **deleted** #576's `8. **Create `.github/adw.yml` (only if absent)`** step from `.claude/commands/adw_init.md`, renumbered the `Report` step from `9` to `8`, and dropped the `.github/adw.yml` status line from the Report step. The spec's **Step 0** and **Notes → "Worktree contamination"** explicitly required discarding these with `git checkout -- .claude/commands/adw_init.md` *before* implementation. Instead, the build/plan commits (`c13ec80`, `6731c8b`) baked the deletion in. Confirmed:
- `git show HEAD:.claude/commands/adw_init.md | grep -Fc 'Create `.github/adw.yml`'` → **0** (should be **2**)
- merge-base `dbd70d5` and `origin/dev` → **2** each.

Because `origin/dev`'s `adw_init.md` is byte-identical to the merge-base, a merge into `dev` produces **no conflict** and silently auto-resolves to the branch version — so target repos initialized/regenerated via `/adw_init` would stop getting `.github/adw.yml`, removing #576's unit-test/HITL gate provisioning.

**Solution:** Surgically restore the deleted step, the Report-step status line, and the `9.` Report numbering — keeping the heredoc **byte-identical** to `ADW_YML_TEMPLATE` (`adws/core/adwYmlConfig.ts` lines 49–60). The feature's intended additive change in **step 2** (the `## Test Directory` / `## Test Framework` emission) is correct and **must be left untouched**. This is a pure restoration: the only net divergence from `dbd70d5` after the patch should be the step-2 additions.

## Files to Modify
Use these files to implement the patch:

- `.claude/commands/adw_init.md` — **edit (the only file changed).** Restore the removed step, the Report status line, and the Report step number.
- `adws/core/adwYmlConfig.ts` — **reference (read-only).** `ADW_YML_TEMPLATE` (lines 49–60) is the byte-for-byte source of truth for the restored heredoc. Do **not** edit it.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Do NOT touch step 2's `## Test Directory` / `## Test Framework` block — that is #577's correct feature change and must be preserved.

### Step 1: Re-insert the `Create .github/adw.yml (only if absent)` step before the Report step
- Open `.claude/commands/adw_init.md`. Locate the end of step 7 — the closing ```` ``` ```` of the **Fallback block** (immediately after the line `Note: the stack could not be classified automatically; refine this list as your test surfaces solidify.`), which is directly followed by the current `8. **Report**` heading.
- Insert the following step verbatim between that closing ```` ``` ```` and the Report heading. The heredoc body **must stay byte-identical to `ADW_YML_TEMPLATE`** in `adws/core/adwYmlConfig.ts` (lines 49–60):

```md
8. **Create `.github/adw.yml` (only if absent)**
   - Create `.github/adw.yml` only when it does not already exist. Never overwrite an existing file — it carries durable operator policy that survives regeneration.
   - Run the following via the Bash tool:
     ```bash
     if [ ! -f .github/adw.yml ]; then
       mkdir -p .github
       cat > .github/adw.yml <<'EOF'
# ADW configuration for this repository.
# This file lives outside `.adw/`, so `/adw_init` regeneration never overwrites it.
# Uncomment a key and set its value to change policy; absent keys use the defaults below.

# Unit-test gate (opt-out). When enabled, the unit-test phase runs your test
# command and fails the workflow on unit-test failure. Default: enabled.
# unitTests: true

# Human-in-the-loop gate for framework-upgrade PRs (opt-in). When true, ADW opens
# the upgrade PR but leaves it for human review instead of auto-merging. Default: false.
# hitl: false
EOF
       echo "created .github/adw.yml"
     else
       echo ".github/adw.yml already exists — left untouched"
     fi
     ```
   - IMPORTANT: the heredoc content above MUST stay byte-identical to `ADW_YML_TEMPLATE` in `adws/core/adwYmlConfig.ts` — a unit test guards the parse result against drift.
```

### Step 2: Renumber the Report step from `8` back to `9`
- Change the heading `8. **Report**` to `9. **Report**` (it follows the step re-inserted in Step 1).

### Step 3: Restore the `.github/adw.yml` status line in the Report step
- As the **final bullet** of the `9. **Report**` step (after the `Examples-block class chosen: ...` line), append:
  ```md
   - `.github/adw.yml` status: `created` or `already present — left untouched`.
  ```

### Step 4: Confirm the feature's additive change is intact (no edit — verification only)
- Confirm step 2 ("Create `.adw/commands.md`") still contains the `## Test Directory` and `## Test Framework` bullets added by #577. Do not modify them.

## Validation
Execute every command to validate the patch is complete with zero regressions. Run from the worktree root.

1. **Restored step present (working tree):**
   `grep -Fc 'Create `.github/adw.yml`' .claude/commands/adw_init.md` → must print **2** (step heading + Report status line).
2. **Feature emission preserved:**
   `grep -Fc '## Test Directory' .claude/commands/adw_init.md` → must print **1**, and `grep -Fc '## Test Framework' .claude/commands/adw_init.md` → must print **1**.
3. **Decisive baseline diff (proves byte-identical restore + nothing else changed):**
   `git diff dbd70d5 -- .claude/commands/adw_init.md` → must show **only additions** of the `## Test Directory` / `## Test Framework` block in step 2, with **zero deletions** and **no** changes touching the `Create .github/adw.yml` step or the Report numbering. Any `-` line, or any drift in the restored heredoc, fails this check.
4. **Drift guard (the test the step references):**
   `bunx vitest run adws/core/__tests__/adwYmlConfig.test.ts` → passes (confirms `ADW_YML_TEMPLATE` parses to `{ hitl: false, unitTests: true }` and `writeAdwYmlTemplateIfAbsent` writes it; the restored heredoc mirrors this template).
5. **Zero regressions across the spec's unit suite** (markdown-only change should leave these green):
   `bun run test:unit`
6. **Reviewer's stated acceptance check (after the patch is committed):**
   `git show HEAD:.claude/commands/adw_init.md | grep -Fc 'Create `.github/adw.yml`'` → returns **2**.

## Patch Scope
**Lines of code to change:** ~33 lines added to one Markdown file (re-inserted step ≈ 26 lines + 1 status line + 1 heading renumber); no TypeScript touched.
**Risk level:** low — pure restoration of a previously-shipped step to its byte-identical baseline; isolated to a single prompt/command file; the feature's additive emission is untouched.
**Testing required:** Grep counts (checks 1–2), the baseline diff (check 3, decisive for byte-identical restore), the `adwYmlConfig` drift guard (check 4), and the full unit suite for zero regressions (check 5).
