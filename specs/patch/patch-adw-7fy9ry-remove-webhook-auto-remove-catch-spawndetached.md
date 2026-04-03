# Patch: Remove spawnDetached fallback from issue_comment and issues.opened catch blocks

## Metadata
adwId: `7fy9ry-remove-webhook-auto`
reviewChangeRequest: `Issue #2: trigger_webhook.ts:160,214 — Catch blocks in the issue_comment and issues.opened handlers call spawnDetached as a fallback, bypassing eligibility gates when dependency checks fail under API contention, causing premature and duplicate orchestrators. Removed by #389 on origin/dev.`

## Issue Summary
**Original Spec:** `specs/issue-382-adw-7fy9ry-remove-webhook-auto-sdlc_planner-simplify-webhook-handlers.md`
**Issue:** The `issue_comment` handler (line 159-162) and `issues.opened` handler (line 213-216) in `trigger_webhook.ts` both have catch blocks that call `spawnDetached('bunx', ['tsx', 'adws/adwPlanBuildTest.tsx', ...])` as an error fallback. This was specifically removed by PR #389 on `origin/dev` because when dependency checks fail under API contention, the catch block spawns a workflow that bypasses eligibility gates, causing premature and duplicate orchestrators.
**Solution:** Remove the `spawnDetached()` calls from both catch blocks. On error, log and return, allowing the cron to retry. This matches the #389 fix on `origin/dev`.

## Files to Modify

- `adws/triggers/trigger_webhook.ts` — Remove `spawnDetached()` calls from catch blocks at lines ~161 and ~215.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove `spawnDetached` from `issue_comment` handler catch block
- In `adws/triggers/trigger_webhook.ts`, locate the `.catch()` block at lines 159-162 in the `issue_comment` handler.
- Current code:
  ```typescript
  .catch((error) => {
    log(`Error handling comment on issue #${issueNumber}: ${error}`, 'error');
    spawnDetached('bunx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...commentTargetRepoArgs]);
  });
  ```
- Replace with (log only, let cron retry):
  ```typescript
  .catch((error) => {
    log(`Error handling comment on issue #${issueNumber}: ${error}`, 'error');
  });
  ```

### Step 2: Remove `spawnDetached` from `issues.opened` handler catch block
- In `adws/triggers/trigger_webhook.ts`, locate the catch block at lines 213-216 in the `issues.opened` handler.
- Current code:
  ```typescript
  } catch (error) {
    log(`Error processing issue #${issueNumber}: ${error}`, 'error');
    spawnDetached('bunx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...issueTargetRepoArgs]);
  }
  ```
- Replace with (log only, let cron retry):
  ```typescript
  } catch (error) {
    log(`Error processing issue #${issueNumber}: ${error}`, 'error');
  }
  ```

### Step 3: Clean up unused imports if applicable
- Check if `spawnDetached` is still used elsewhere in `trigger_webhook.ts` (lines 110, 123 for `adwPrReview.tsx`).
- Since `spawnDetached` is still imported and used for PR review dispatch (lines 110 and 123), the import must be kept. No import cleanup needed.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws subproject.
- `bun vitest run` — Run all unit tests.
- `bun run lint` — Run linter.

## Patch Scope
**Lines of code to change:** 2 lines removed (one `spawnDetached` call from each catch block)
**Risk level:** low
**Testing required:** Type check and unit test pass. The change removes fallback spawning that was already validated as harmful by #389 on dev. The cron trigger will retry eligible issues on the next cycle.
