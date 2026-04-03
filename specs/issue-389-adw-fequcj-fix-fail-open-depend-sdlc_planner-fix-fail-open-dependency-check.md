# Feature: Fix fail-open dependency check and webhook eligibility bypass

## Metadata
issueNumber: `389`
adwId: `fequcj-fix-fail-open-depend`
issueJson: `{"number":389,"title":"Fix fail-open dependency check and webhook eligibility bypass","body":"## Parent PRD\n\n`specs/prd/orchestrator-lifecycle-redesign.md`\n\n## What to build\n\nTwo fail-open bugs allow workflows to start on issues with unresolved dependencies, causing duplicate orchestrators and wasted compute.\n\n**1. `findOpenDependencies` swallows errors (fail-open)**\n\nIn `triggers/issueDependencies.ts`, when `getIssueState(dep)` throws (e.g., GitHub API rate limit, CLI contention from rapid issue creation), the error is logged as a warning and the dependency is silently skipped — treated as non-blocking. This is fail-open: if you can't verify a dependency is closed, you should assume it's still open.\n\n```typescript\n// Current: silently skips failed deps (fail-open)\n} catch (err) {\n    log(`Failed to check state of dependency #${dep}: ${err}`, 'warn');\n}\n```\n\nFix: on error, treat the dependency as OPEN (fail-closed). Add the dep to `openDeps` so the issue is deferred.\n\n**2. Webhook catch-block spawns workflow bypassing all eligibility checks**\n\nIn `triggers/trigger_webhook.ts` (issues.opened handler), if `checkIssueEligibility` throws, the catch block spawns `adwPlanBuildTest.tsx` as a fallback — completely bypassing dependency and concurrency checks.\n\n```typescript\n} catch (error) {\n    log(`Error processing issue #${issueNumber}: ${error}`, 'error');\n    spawnDetached('bunx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...issueTargetRepoArgs]);\n}\n```\n\nFix: on error, log and return — do NOT spawn. The cron will pick up the issue on the next cycle.\n\n**Observed impact:** Issue #381 had `Blocked by #379` and `Blocked by #380` (both open). Both the webhook and cron started workflows simultaneously because the dependency check failed silently under API contention from 6 issues being created rapidly.\n\n## Acceptance criteria\n\n- [ ] `findOpenDependencies`: failed `getIssueState` calls treat the dependency as OPEN (fail-closed)\n- [ ] Webhook `issues.opened` catch block logs the error and returns — does not spawn a fallback workflow\n- [ ] Issues with open dependencies are not started even under API contention\n- [ ] Add entry to `known_issues.md` for dependency-check-fail-open\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- Not in original PRD — discovered during issue creation","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T12:00:12Z","comments":[],"actionableComment":null}`

## Feature Description
Two fail-open bugs in the ADW trigger pipeline allow workflows to start on issues that have unresolved (open) dependencies. This causes duplicate orchestrators and wasted compute when multiple issues are created rapidly and GitHub API calls fail under contention.

**Bug 1 — `findOpenDependencies` swallows errors:** In `adws/triggers/issueDependencies.ts`, when `getIssueState(dep)` throws (e.g., GitHub API rate limit, CLI contention), the error is logged as a warning and the dependency is silently skipped. This is fail-open: if you can't verify a dependency is closed, you should assume it's still open and treat it as blocking.

**Bug 2 — Webhook catch-block bypasses eligibility:** In `adws/triggers/trigger_webhook.ts`, the `issues.opened` handler's catch block spawns `adwPlanBuildTest.tsx` as a fallback when `checkIssueEligibility` throws — completely bypassing dependency and concurrency checks. The same pattern exists in the `issue_comment` handler's catch block.

## User Story
As a workflow operator
I want dependency checks to fail-closed and webhook error handlers to not bypass eligibility
So that issues with unresolved dependencies are never started prematurely, preventing duplicate orchestrators and wasted compute

## Problem Statement
When multiple GitHub issues are created rapidly, API contention causes `getIssueState()` calls to throw. The current error handling treats these failures as "dependency resolved" (fail-open), allowing issues with open blockers to proceed. Additionally, when `checkIssueEligibility` throws in the webhook handler, the catch block spawns a workflow anyway — completely bypassing all safety checks. This was observed with issue #381, which had `Blocked by #379` and `Blocked by #380` (both open) but was started by both the webhook and cron simultaneously.

## Solution Statement
1. **Fail-closed dependency check:** In `findOpenDependencies()`, when `getIssueState(dep)` throws, add the dependency to `openDeps` (treat as open/blocking) instead of silently skipping it. Log at `'error'` level to make the failure visible.
2. **Safe webhook error handling:** In `trigger_webhook.ts`, replace the catch-block `spawnDetached` calls with log-and-return. The cron trigger will re-evaluate the issue on its next cycle, ensuring all eligibility checks are applied.
3. **Known issues registry:** Add a `dependency-check-fail-open` entry to `adws/known_issues.md` documenting the observed failure pattern and the fix.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/issueDependencies.ts` — Contains `findOpenDependencies()` with the fail-open catch block (line 210-212). The fix changes the catch to push the dep onto `openDeps`.
- `adws/triggers/trigger_webhook.ts` — Contains the `issues.opened` handler (line 218-221) and `issue_comment` handler (line 164-167) with catch blocks that spawn workflows bypassing eligibility. Both need to log-and-return instead.
- `adws/triggers/webhookGatekeeper.ts` — Contains `spawnDetached`, `classifyAndSpawnWorkflow`, `logDeferral` used by the webhook handlers. Read-only reference for understanding the spawn flow.
- `adws/triggers/issueEligibility.ts` — Contains `checkIssueEligibility()` that calls `findOpenDependencies()`. Read-only reference for understanding the eligibility flow.
- `adws/known_issues.md` — Known issues registry where the new entry must be added.
- `app_docs/feature-74itmf-dependency-logging.md` — Documentation on dependency resolution logging. Read-only reference.
- `app_docs/feature-91v6qi-llm-dependency-extraction.md` — Documentation on LLM dependency extraction. Read-only reference.

### New Files
- `adws/__tests__/issueDependencies.test.ts` — Unit tests for `findOpenDependencies()` fail-closed behavior.
- `adws/__tests__/triggerWebhook.test.ts` — Unit tests for webhook catch-block behavior (log-only, no spawn).

## Implementation Plan
### Phase 1: Foundation
Understand the current error handling flow in `findOpenDependencies()` and the webhook event handlers. Identify all catch blocks that exhibit the fail-open pattern. There are three catch blocks to fix:
1. `issueDependencies.ts:210-212` — `findOpenDependencies()` catch block
2. `trigger_webhook.ts:218-220` — `issues.opened` handler catch block
3. `trigger_webhook.ts:164-167` — `issue_comment` handler catch block (same bug class)

### Phase 2: Core Implementation
Apply the fail-closed fix to `findOpenDependencies()` and remove the fallback spawn calls from both webhook catch blocks. Write unit tests covering:
- `findOpenDependencies()` treats failed deps as open
- Webhook catch blocks log errors without spawning workflows

### Phase 3: Integration
Add the `dependency-check-fail-open` entry to `known_issues.md`. Run lint, type check, and tests to validate zero regressions.

## Step by Step Tasks

### Step 1: Fix `findOpenDependencies()` fail-open catch block
- Open `adws/triggers/issueDependencies.ts`
- In the `findOpenDependencies()` function, locate the catch block at line 210-212:
  ```typescript
  } catch (err) {
    log(`Failed to check state of dependency #${dep}: ${err}`, 'warn');
  }
  ```
- Change it to treat the dependency as OPEN (fail-closed):
  ```typescript
  } catch (err) {
    log(`Failed to check state of dependency #${dep}, treating as OPEN (fail-closed): ${err}`, 'error');
    openDeps.push(dep);
  }
  ```
- This ensures that if `getIssueState()` throws (API rate limit, network error, CLI contention), the dependency is assumed to still be open and the issue is deferred.

### Step 2: Fix webhook `issues.opened` catch block
- Open `adws/triggers/trigger_webhook.ts`
- Locate the `issues.opened` handler's catch block at lines 218-220:
  ```typescript
  } catch (error) {
    log(`Error processing issue #${issueNumber}: ${error}`, 'error');
    spawnDetached('bunx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...issueTargetRepoArgs]);
  }
  ```
- Remove the `spawnDetached` call. The cron trigger will re-evaluate the issue on its next cycle:
  ```typescript
  } catch (error) {
    log(`Error processing issue #${issueNumber}: ${error}. Cron will retry.`, 'error');
  }
  ```

### Step 3: Fix webhook `issue_comment` catch block
- In the same file `adws/triggers/trigger_webhook.ts`, locate the `issue_comment` handler's catch block at lines 164-167:
  ```typescript
  .catch((error) => {
    log(`Error handling comment on issue #${issueNumber}: ${error}`, 'error');
    spawnDetached('bunx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...commentTargetRepoArgs]);
  });
  ```
- Remove the `spawnDetached` call for the same reason — errors should not bypass eligibility:
  ```typescript
  .catch((error) => {
    log(`Error handling comment on issue #${issueNumber}: ${error}. Cron will retry.`, 'error');
  });
  ```

### Step 4: Write unit tests for `findOpenDependencies()` fail-closed behavior
- Create `adws/__tests__/issueDependencies.test.ts`
- Mock `getIssueState` from `../github/issueApi` and `extractDependencies` from the module
- Test cases:
  - When `getIssueState` throws for a dependency, that dependency is included in the returned `openDeps` array
  - When `getIssueState` throws for all dependencies, all are returned as open
  - When `getIssueState` succeeds for some and throws for others, the thrown ones are treated as open
  - When `getIssueState` returns `'CLOSED'` for all, `openDeps` is empty
  - When no dependencies exist, returns empty array

### Step 5: Write unit tests for webhook catch-block behavior
- Create `adws/__tests__/triggerWebhook.test.ts`
- Test that the `spawnDetached` function is NOT called when `checkIssueEligibility` throws in the `issues.opened` handler
- Test that the `spawnDetached` function is NOT called when the `issue_comment` handler's promise chain rejects
- These tests may need to import and test the webhook handler logic in isolation, or verify the behavior by mocking `spawnDetached` and `checkIssueEligibility`

### Step 6: Add `dependency-check-fail-open` entry to `known_issues.md`
- Open `adws/known_issues.md`
- Add a new entry following the existing schema:
  - **slug**: `dependency-check-fail-open`
  - **pattern**: `Failed to check state of dependency`
  - **description**: `getIssueState()` throws under API contention (rate limit, CLI contention from rapid issue creation). The catch block silently skips the dependency, treating it as resolved. Combined with webhook catch blocks that spawn workflows on error, this allows issues with open dependencies to be started.
  - **status**: `solved`
  - **solution**: `findOpenDependencies()` now treats failed deps as OPEN (fail-closed). Webhook catch blocks log and return instead of spawning fallback workflows. Cron trigger re-evaluates on next cycle.
  - **linked_issues**: #389, #381
  - **first_seen**: 2026-04-03
  - **sample_log**: Representative log from the #381 incident

### Step 7: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to type check the main project
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to type check the ADW scripts
- Run `bun run test` to run unit tests and validate zero regressions

## Testing Strategy
### Unit Tests
- **`adws/__tests__/issueDependencies.test.ts`**: Tests for `findOpenDependencies()`:
  - `getIssueState` throws → dependency treated as open (fail-closed)
  - `getIssueState` throws for all deps → all returned as open
  - Mixed success/failure → only failed ones treated as open, successful CLOSED ones excluded
  - All deps CLOSED → empty array returned
  - No deps → empty array returned
- **`adws/__tests__/triggerWebhook.test.ts`**: Tests for webhook error handling:
  - `issues.opened` catch block does not call `spawnDetached`
  - `issue_comment` catch block does not call `spawnDetached`

### Edge Cases
- All dependencies fail to resolve (e.g., total GitHub API outage) — all should be treated as open, issue is deferred
- One dependency fails, others resolve as CLOSED — only the failed one is treated as open, issue is still deferred
- `checkIssueEligibility` throws with a non-Error (string, undefined) — catch block should still handle gracefully
- Rapid webhook events for the same issue — cooldown (`shouldTriggerIssueWorkflow`) prevents duplicates before the eligibility check is even reached
- Cron picks up deferred issue after API recovers — `findOpenDependencies` succeeds on retry, issue proceeds normally

## Acceptance Criteria
- [ ] `findOpenDependencies()`: failed `getIssueState` calls treat the dependency as OPEN (fail-closed) — verified by unit test
- [ ] Webhook `issues.opened` catch block logs the error and returns — does NOT spawn a fallback workflow
- [ ] Webhook `issue_comment` catch block logs the error and returns — does NOT spawn a fallback workflow
- [ ] Issues with open dependencies are not started even under API contention (fail-closed guarantees this)
- [ ] `known_issues.md` has a `dependency-check-fail-open` entry documenting the bug and fix
- [ ] All lint, type check, and existing tests pass with zero regressions

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts
- `bun run test` — Run all unit tests to validate zero regressions

## Notes
- The `issue_comment` catch block at `trigger_webhook.ts:164-167` exhibits the same fail-open pattern as the `issues.opened` catch block. While not explicitly mentioned in the issue, it is the same bug class and is included in this fix for completeness.
- The cron trigger (`trigger_cron.ts`) already handles deferred issues correctly — it re-evaluates eligibility on every poll cycle. This is why the webhook catch blocks can safely log-and-return: the cron acts as the reliable fallback.
- The `findOpenDependencies()` fix changes the error logging level from `'warn'` to `'error'` to reflect that the failure now has a user-visible impact (the issue is deferred). This makes it easier to spot in logs.
- No new libraries are required for this fix.
