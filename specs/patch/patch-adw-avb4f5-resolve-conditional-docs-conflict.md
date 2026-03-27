# Patch: Resolve merge conflict in conditional_docs.md

## Metadata
adwId: `avb4f5-github-actions-worke`
reviewChangeRequest: `Issue #1: .adw/conditional_docs.md contains unresolved merge conflict markers`

## Issue Summary
**Original Spec:** specs/issue-332-adw-avb4f5-github-actions-worke-sdlc_planner-deploy-workers-github-actions.md
**Issue:** `.adw/conditional_docs.md` has git merge conflict markers (`<<<<<<< HEAD`, `=======`, `>>>>>>> origin/dev`) at lines 3-18, plus duplicate entries for `feature-avb4f5` (lines 4 and 617) and a near-duplicate `feature-efcqzc` entry (line 624).
**Solution:** Remove all conflict markers keeping both blocks (feature-avb4f5 from HEAD and feature-92py6q from origin/dev), then remove the duplicate feature-avb4f5 and feature-efcqzc entries appended at the end of the file.

## Files to Modify

- `.adw/conditional_docs.md` — Remove conflict markers and deduplicate entries

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Resolve the merge conflict (lines 3-18)
- Replace the entire conflict block (lines 3-18) with both entries, conflict markers removed:
  ```
  - app_docs/feature-avb4f5-deploy-workers-github-actions.md
    - Conditions:
      - When working with `.github/workflows/deploy-workers.yml`
      - When adding a new Cloudflare Worker under `workers/` that needs CI deployment
      - When troubleshooting GitHub Actions deploy jobs for `screenshot-router` or `cost-api`
      - When configuring `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` secrets for Worker CI

  - app_docs/feature-92py6q-d1-client-dual-write.md
    - Conditions:
      - When working with `adws/cost/d1Client.ts` or the D1 dual-write pipeline
      - When configuring `COST_API_URL` or `COST_API_TOKEN` in ADW
      - When modifying `adws/phases/phaseCostCommit.ts` or the phase cost commit flow
      - When troubleshooting D1 write failures or missing cost records in the D1 database
      - When implementing future changes to the `PhaseCostRecord` → `IngestPayload` transformation
  ```

### Step 2: Remove duplicate entries at end of file (lines 617-629)
- Delete the duplicate `feature-avb4f5` entry (lines 617-622) — it's a copy of the one from the HEAD side of the conflict
- Delete the `feature-efcqzc` entry (lines 624-629) — it's a near-duplicate covering the same deploy-workers topic

### Step 3: Stage the resolved file
- Run `git add .adw/conditional_docs.md` to mark the conflict as resolved

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `grep -c '<<<<<<' .adw/conditional_docs.md` — Must return 0 (no conflict markers remain)
- `grep -c '>>>>>>>' .adw/conditional_docs.md` — Must return 0
- `grep -c 'feature-avb4f5' .adw/conditional_docs.md` — Must return exactly 1 (no duplicates)
- `grep -c 'feature-efcqzc' .adw/conditional_docs.md` — Must return 0 (removed duplicate)
- `grep -c 'feature-92py6q' .adw/conditional_docs.md` — Must return exactly 1 (kept from origin/dev)
- `bun run lint` — Lint passes
- `bun run build` — Build passes

## Patch Scope
**Lines of code to change:** ~20 lines removed/replaced
**Risk level:** low
**Testing required:** Grep validation for conflict markers and duplicate entries; lint and build pass
