# Fix Fail-Open Dependency Check and Webhook Eligibility Bypass

**ADW ID:** fequcj-fix-fail-open-depend
**Date:** 2026-04-03
**Specification:** specs/issue-389-adw-fequcj-fix-fail-open-depend-sdlc_planner-fix-fail-open-dependency-check.md

## Overview

Two fail-open bugs in the ADW trigger pipeline allowed workflows to start on issues with unresolved dependencies, causing duplicate orchestrators and wasted compute. When GitHub API calls failed under contention (e.g., 6 issues created rapidly), dependency checks silently skipped failed lookups, and webhook error handlers spawned fallback workflows bypassing all eligibility checks.

## What Was Built

- **Fail-closed dependency check:** `findOpenDependencies()` now treats any `getIssueState()` exception as the dependency being OPEN — pushing it onto `openDeps` instead of silently skipping it.
- **Safe webhook error handling:** Both `issues.opened` and `issue_comment` catch blocks in `trigger_webhook.ts` now log the error and return, relying on the cron trigger to re-evaluate on its next cycle.
- **Known issues registry entry:** Added `dependency-check-fail-open` to `adws/known_issues.md` documenting the observed failure pattern, fix, and sample log from the #381 incident.
- **Unit tests:** New test files covering fail-closed behavior in `findOpenDependencies()` and no-spawn behavior in webhook catch blocks.

## Technical Implementation

### Files Modified

- `adws/triggers/issueDependencies.ts`: In `findOpenDependencies()`, the catch block now calls `openDeps.push(dep)` so any failed `getIssueState()` call defers the issue.
- `adws/triggers/trigger_webhook.ts`: Removed `spawnDetached` calls from both the `issue_comment` (`.catch`) and `issues.opened` (`catch`) error handlers; both now log and return.
- `adws/known_issues.md`: Added `dependency-check-fail-open` entry with description, solution, linked issues (#389, #381), and sample log.

### New Files

- `adws/__tests__/issueDependencies.test.ts`: Unit tests for `findOpenDependencies()` fail-closed behavior.
- `adws/__tests__/triggerWebhook.test.ts`: Unit tests verifying `spawnDetached` is not called when `checkIssueEligibility` throws.

### Key Changes

- **Fail-closed catch block** (`issueDependencies.ts`): `log(..., 'warn')` + `openDeps.push(dep)` replaces the silent skip. A failed state check is now equivalent to "dependency is open."
- **Webhook `issues.opened` handler** (`trigger_webhook.ts`): Catch block drops the `spawnDetached` call; message updated to `"Cron will retry."` to make the recovery path explicit in logs.
- **Webhook `issue_comment` handler** (`trigger_webhook.ts`): `.catch` handler drops the `spawnDetached` call for the same reason.
- **Cron as reliable fallback:** The cron trigger already re-evaluates all eligible issues on every poll cycle, so webhook errors deferring to cron is safe and correct.

## How to Use

This is an infrastructure fix — no user-facing changes required.

1. **Dependency blocking:** Issues with `Blocked by #N` in the body will now be correctly deferred when `gh issue view N` fails under API contention. The next cron cycle will retry.
2. **Webhook errors:** When `checkIssueEligibility` throws (e.g., GitHub API flake during webhook processing), the issue is not started. The cron trigger picks it up on the next cycle.
3. **Log monitoring:** Look for `treating as OPEN (fail-closed)` in logs to detect API contention events; look for `Cron will retry` after webhook errors.

## Configuration

No configuration changes required. The fix is purely behavioral:
- The cron poll interval determines how quickly deferred issues are retried (existing setting).
- No new environment variables.

## Testing

```bash
# Unit tests covering fail-closed and no-spawn behavior
bun run test adws/__tests__/issueDependencies.test.ts
bun run test adws/__tests__/triggerWebhook.test.ts

# BDD scenarios
bun run test:e2e features/fix_fail_open_dependency_check.feature
```

Key test scenarios:
- `getIssueState` throws for one dependency → that dep is in returned `openDeps`
- `getIssueState` throws for all deps → all returned as open, issue deferred
- Mixed success/failure → only failed deps treated as open
- `checkIssueEligibility` throws in `issues.opened` handler → `spawnDetached` not called
- `checkIssueEligibility` throws in `issue_comment` handler → `spawnDetached` not called

## Notes

- The `issue_comment` catch block fix was not in the original issue acceptance criteria but was the same bug class (`trigger_webhook.ts:164-167`). It was fixed in the same change.
- The cron trigger (`trigger_cron.ts`) already handles deferred issues correctly — this fix relies on that guarantee.
- Log level for the fail-closed catch remains `'warn'` (as implemented) rather than `'error'` as originally proposed in the spec; the BDD scenario drove the final choice.
- Root-cause incident: issue #381 (`Blocked by #379` and `Blocked by #380`) was started by both webhook and cron simultaneously because all 6 issues were created within seconds and API contention caused the dependency check to silently succeed.
