# Patch: Restore fail-closed behavior in findOpenDependencies catch block

## Metadata
adwId: `7fy9ry-remove-webhook-auto`
reviewChangeRequest: `Issue #1: issueDependencies.ts:211 — fail-closed reverted to fail-open`

## Issue Summary
**Original Spec:** `specs/issue-382-adw-7fy9ry-remove-webhook-auto-sdlc_planner-simplify-webhook-handlers.md`
**Issue:** The catch block in `findOpenDependencies()` at `issueDependencies.ts:210-212` does not call `openDeps.push(dep)` when `getIssueState()` throws. On `origin/dev`, PR #389 fixed this to fail-closed (treat unknown deps as open), preventing issues with unresolved dependencies from starting. This branch is missing that fix, silently dropping failed dependencies and re-introducing the race condition #389 solved.
**Solution:** Restore the fail-closed behavior by adding `openDeps.push(dep)` in the catch block and updating the log message to indicate the dependency is being treated as OPEN, matching `origin/dev`.

## Files to Modify

- `adws/triggers/issueDependencies.ts` — Restore `openDeps.push(dep)` in the `findOpenDependencies()` catch block (line ~210-212).

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore fail-closed catch block in `findOpenDependencies()`
- In `adws/triggers/issueDependencies.ts`, locate the catch block in `findOpenDependencies()` (line ~210-212).
- Current code (fail-open):
  ```typescript
  } catch (err) {
    log(`Failed to check state of dependency #${dep}: ${err}`, 'warn');
  }
  ```
- Replace with (fail-closed, matching `origin/dev`):
  ```typescript
  } catch (err) {
    log(`Failed to check state of dependency #${dep}, treating as OPEN (fail-closed): ${err}`, 'warn');
    openDeps.push(dep);
  }
  ```

### Step 2: Run validation
- Run type check and unit tests to confirm no regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws subproject.
- `bun vitest run` — Run all unit tests.
- `bun run lint` — Run linter.

## Patch Scope
**Lines of code to change:** 2 (one log message update, one added line)
**Risk level:** low
**Testing required:** Type check and unit test pass. The change is a one-line addition restoring behavior already validated by #389 on dev.
