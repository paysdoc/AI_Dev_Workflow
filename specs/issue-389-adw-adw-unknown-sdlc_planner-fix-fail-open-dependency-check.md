# Bug: Fix fail-open dependency check and webhook eligibility bypass

## Metadata
issueNumber: `389`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
Two fail-open bugs allow workflows to start on issues with unresolved dependencies, causing duplicate orchestrators and wasted compute.

1. **`findOpenDependencies` swallows errors (fail-open):** In `adws/triggers/issueDependencies.ts`, when `getIssueState(dep)` throws (e.g., GitHub API rate limit, CLI contention from rapid issue creation), the error is logged as a warning and the dependency is silently skipped — treated as non-blocking. If a dependency's state cannot be verified, the system should assume it is still open (fail-closed), not skip it.

2. **Webhook catch-block spawns workflow bypassing all eligibility checks:** In `adws/triggers/trigger_webhook.ts`, in the `issues.opened` handler, if `checkIssueEligibility` throws, the catch block spawns `adwPlanBuildTest.tsx` as a fallback — completely bypassing dependency and concurrency checks. This means an error during eligibility checking causes the issue to be processed unconditionally.

**Observed impact:** Issue #381 had `Blocked by #379` and `Blocked by #380` (both open). Both the webhook and cron started workflows simultaneously because the dependency check failed silently under API contention from 6 issues being created rapidly.

## Problem Statement
1. `findOpenDependencies` in `adws/triggers/issueDependencies.ts` (line 210-212): the catch block for `getIssueState` logs a warning and continues, silently treating a failed dep check as non-blocking.
2. `trigger_webhook.ts` (lines 218-220): the catch block for the `issues.opened` handler spawns a workflow fallback, bypassing all eligibility gates.

## Solution Statement
1. In `findOpenDependencies`, change the catch block to treat a failed `getIssueState` call as fail-closed: add the dependency number to `openDeps` so the issue is deferred.
2. In the `issues.opened` catch block in `trigger_webhook.ts`, remove the `spawnDetached` call and replace it with a log-and-return — letting the cron pick up the issue on the next cycle.

## Steps to Reproduce
1. Create 6+ issues in rapid succession where some issues declare `Blocked by #N` on issues that are still open.
2. Observe that under API rate-limit contention, `getIssueState` throws for some dependencies.
3. Observe that the failing dependency is skipped, and the blocked issue is incorrectly treated as eligible to start.
4. Observe (for bug #2) that if `checkIssueEligibility` throws in the webhook handler, a workflow is spawned anyway.

## Root Cause Analysis
**Bug 1:** `findOpenDependencies` iterates over detected dependencies and calls `getIssueState(dep, repoInfo)`. The current catch block only logs a warning and does not add the dep to `openDeps`, so a transient API failure causes the dependency to be skipped entirely — fail-open behavior.

**Bug 2:** The `issues.opened` async IIFE in `trigger_webhook.ts` has a catch block that was meant as a safety net but instead spawns a workflow unconditionally. This completely bypasses the dependency check, concurrency check, and eligibility logic that were just evaluated (and threw an error). The correct behavior is to fail safely and let the cron retry.

## Relevant Files

- `adws/triggers/issueDependencies.ts` — Contains `findOpenDependencies`. The catch block for `getIssueState` (lines 210-212) must be changed to add the dep to `openDeps` instead of silently skipping it.
- `adws/triggers/trigger_webhook.ts` — Contains the `issues.opened` event handler (lines 201-225). The catch block (lines 218-220) must be changed to log and return, not spawn.
- `adws/known_issues.md` — Must receive a new entry documenting the dependency-check-fail-open bug per the acceptance criteria.

## Step by Step Tasks

### 1. Fix `findOpenDependencies` to be fail-closed
- In `adws/triggers/issueDependencies.ts`, locate the `findOpenDependencies` function (around line 202).
- In the `for (const dep of deps)` loop, find the catch block (lines 210-212):
  ```typescript
  } catch (err) {
      log(`Failed to check state of dependency #${dep}: ${err}`, 'warn');
  }
  ```
- Change it to treat the failed dep as OPEN (fail-closed):
  ```typescript
  } catch (err) {
      log(`Failed to check state of dependency #${dep}: ${err} — treating as OPEN (fail-closed)`, 'warn');
      openDeps.push(dep);
  }
  ```

### 2. Fix webhook `issues.opened` catch block to not spawn
- In `adws/triggers/trigger_webhook.ts`, locate the `issues.opened` handler (around line 201).
- Find the catch block (lines 218-220):
  ```typescript
  } catch (error) {
      log(`Error processing issue #${issueNumber}: ${error}`, 'error');
      spawnDetached('bunx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...issueTargetRepoArgs]);
  }
  ```
- Replace it with log-and-return only:
  ```typescript
  } catch (error) {
      log(`Error processing issue #${issueNumber}: ${error} — deferring to cron`, 'error');
  }
  ```

### 3. Add entry to `known_issues.md`
- Open `adws/known_issues.md` and add a new entry documenting the dependency-check-fail-open bug:
  - Issue title: `dependency-check-fail-open`
  - Description: transient `getIssueState` errors caused dep checks to silently pass (fail-open), allowing blocked issues to start workflows
  - Fixed in: issue #389
  - Root cause: catch block in `findOpenDependencies` did not push the dep to `openDeps` on error

### 4. Run Validation Commands
- Run all validation commands listed below to confirm the fixes and zero regressions.

## Validation Commands

```bash
# Type check — must pass with zero errors
bunx tsc --noEmit -p adws/tsconfig.json

# Linter — must pass with zero errors
bun run lint

# Build — must pass with zero errors
bun run build
```

Manual verification checklist:
- Confirm `findOpenDependencies` in `issueDependencies.ts` catch block now pushes dep to `openDeps`.
- Confirm `trigger_webhook.ts` `issues.opened` catch block no longer calls `spawnDetached`.
- Confirm `known_issues.md` has the new `dependency-check-fail-open` entry.

## Notes
- The `issue_comment` handler in `trigger_webhook.ts` (lines 164-166) has the same fail-open spawn pattern. It is out of scope for this issue but worth a follow-up.
- No new dependencies are required.
- The fix for bug #1 is intentionally conservative: any error verifying a dep treats it as open. This may cause temporary deferrals under transient API failures, but this is the correct safe behavior.
