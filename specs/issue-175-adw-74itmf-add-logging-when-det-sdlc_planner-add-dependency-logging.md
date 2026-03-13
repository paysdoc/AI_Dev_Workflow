# Feature: Add Logging When Determining Issue Dependencies

## Metadata
issueNumber: `175`
adwId: `74itmf-add-logging-when-det`
issueJson: `{"number":175,"title":"Add logging when determining whether there is an issue dependency","body":"","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-13T13:38:31Z","comments":[{"author":"paysdoc","createdAt":"2026-03-13T13:44:05Z","body":"## Take action"},{"author":"paysdoc","createdAt":"2026-03-13T13:48:22Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Add observability logging to the dependency resolution pipeline so operators can trace how ADW determines whether an issue has blocking dependencies. Currently, `findOpenDependencies()` in `adws/triggers/issueDependencies.ts` silently parses dependencies, checks their states, and silently swallows errors — making it difficult to diagnose why an issue was deferred or why a dependency check failed. This feature adds structured `log()` calls at key decision points: entry, per-dependency state resolution, error handling, and exit.

## User Story
As an ADW operator
I want to see log output when dependencies are parsed and resolved
So that I can diagnose why issues are deferred due to dependencies and detect failures in dependency state lookups

## Problem Statement
The `findOpenDependencies()` function operates silently — it parses dependencies, queries GitHub for each dependency's state, and returns results without any logging. Errors in `getIssueState()` calls are caught and silently ignored. This makes it impossible to determine from logs: (1) how many dependencies were found for an issue, (2) which dependencies were checked and their resolved states, (3) whether any dependency lookups failed, and (4) the final determination of open vs. closed dependencies.

## Solution Statement
Add `log()` calls to `findOpenDependencies()` and `checkIssueEligibility()` at the following decision points:
1. **Entry**: Log the number of parsed dependencies found (or that none were found).
2. **Per-dependency**: Log each dependency's resolved state (OPEN or CLOSED).
3. **Error handling**: Log errors when `getIssueState()` fails for a dependency instead of silently catching.
4. **Exit**: Log the final result — how many open (blocking) dependencies were found.
5. **Eligibility entry**: Log that dependency checking is starting for a given issue number in `checkIssueEligibility()`.

Use the existing `log()` function from `adws/core` with appropriate log levels (`'info'` for progress, `'warn'` for errors that are handled gracefully).

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/issueDependencies.ts` — Primary target. Contains `parseDependencies()` and `findOpenDependencies()`. Logging will be added to `findOpenDependencies()`.
- `adws/triggers/issueEligibility.ts` — Contains `checkIssueEligibility()` which calls `findOpenDependencies()`. Add entry-level logging here to trace which issue is being checked.
- `adws/core/utils.ts` — Contains the `log()` function and `LogLevel` type. Already imported by other trigger files; will be imported into `issueDependencies.ts`.
- `adws/core/index.ts` — Barrel export for core utilities including `log`. Used for imports.
- `adws/triggers/webhookGatekeeper.ts` — Reference file showing existing logging patterns for dependency-related operations (e.g., `logDeferral()`).
- `adws/triggers/trigger_cron.ts` — Reference file showing existing logging patterns for eligibility checks.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

## Implementation Plan
### Phase 1: Foundation
Import the `log` function into `issueDependencies.ts` from `../core`. No new dependencies or libraries are needed — the logging infrastructure already exists.

### Phase 2: Core Implementation
Add `log()` calls to `findOpenDependencies()` at four decision points:
1. After parsing dependencies — log the count (or early return if zero).
2. Inside the per-dependency loop — log each dependency number and its resolved state.
3. In the catch block — log the error with the dependency number instead of silently ignoring.
4. After the loop — log the final count of open (blocking) dependencies.

Add a log call to `checkIssueEligibility()` at entry to trace which issue number is being evaluated.

### Phase 3: Integration
No integration work needed — the `log()` function writes to stdout with timestamps and optional ADW IDs, which is already how all trigger logging works. The new log lines will appear naturally in the existing log stream.

## Step by Step Tasks

### Step 1: Add logging to `findOpenDependencies()` in `issueDependencies.ts`
- Import `log` from `'../core'`
- After `parseDependencies()` call: log `"Checking dependencies: found {N} dependency(ies) to resolve"` at `'info'` level
- If `deps.length === 0`, log `"No dependencies found, skipping dependency check"` before returning
- Inside the for-loop, after resolving state: log `"Dependency #{dep}: {state}"` at `'info'` level
- In the catch block: log `"Failed to check state of dependency #{dep}: {error}"` at `'warn'` level (replacing the silent catch)
- After the loop: log `"Dependency check complete: {openDeps.length} open dependency(ies) found"` at `'info'` level; if open deps exist, include the issue numbers

### Step 2: Add logging to `checkIssueEligibility()` in `issueEligibility.ts`
- Import `log` from `'../core'`
- At the start of the function: log `"Checking eligibility for issue #{issueNumber}"` at `'info'` level

### Step 3: Run validation commands
- Run `bun run lint` to check for linting errors
- Run `bunx tsc --noEmit` to verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific TypeScript compilation

## Testing Strategy
### Unit Tests
Unit tests are disabled for ADW per `.adw/project.md`. No new unit tests will be added.

### Edge Cases
- Issue body with no `## Dependencies` section — should log "No dependencies found" and return early
- Issue body with dependencies that all resolve to CLOSED — should log each as CLOSED and report 0 open
- Issue body with dependencies where `getIssueState()` throws — should log the error at `'warn'` level and continue checking remaining dependencies
- Issue body with a mix of OPEN and CLOSED dependencies — should log each state and report correct open count

## Acceptance Criteria
- `findOpenDependencies()` logs the number of parsed dependencies on entry
- `findOpenDependencies()` logs each dependency's resolved state (OPEN/CLOSED)
- `findOpenDependencies()` logs errors from `getIssueState()` at `'warn'` level instead of silently catching
- `findOpenDependencies()` logs the final count of open dependencies on exit
- `checkIssueEligibility()` logs the issue number being checked on entry
- All logging uses the existing `log()` function from `adws/core`
- No changes to function signatures or return values
- TypeScript compiles without errors
- Linter passes without errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check ADW-specific code

## Notes
- The `guidelines/coding_guidelines.md` says to "isolate side effects at the boundaries." Logging in `findOpenDependencies()` is appropriate because this function is already at a side-effect boundary (it calls `getIssueState()` which executes shell commands via `execSync`).
- No new libraries are needed.
- The existing silent `catch {}` block in `findOpenDependencies()` is an anti-pattern per the coding guidelines ("Provide meaningful error messages"). This feature improves it by logging the error at `'warn'` level while still continuing to check remaining dependencies.
