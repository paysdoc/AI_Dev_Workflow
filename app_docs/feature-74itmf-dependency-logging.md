# Dependency Resolution Logging

**ADW ID:** 74itmf-add-logging-when-det
**Date:** 2026-03-13
**Specification:** specs/issue-175-adw-74itmf-add-logging-when-det-sdlc_planner-add-dependency-logging.md

## Overview

Adds structured observability logging to the dependency resolution pipeline so operators can trace how ADW determines whether an issue has blocking dependencies. Previously, `findOpenDependencies()` operated silently — making it impossible to diagnose why issues were deferred or why dependency state lookups failed. All logging uses the existing `log()` function from `adws/core`.

## What Was Built

- Entry log in `checkIssueEligibility()` reporting which issue number is being evaluated
- Entry log in `findOpenDependencies()` reporting how many dependencies were parsed (or that none were found)
- Per-dependency log inside the resolution loop reporting each dependency number and its resolved state (`OPEN` / `CLOSED`)
- Error log at `'warn'` level when `getIssueState()` throws, replacing the previous silent `catch {}` block
- Exit log summarizing the count of open (blocking) dependencies, including their issue numbers when any are found

## Technical Implementation

### Files Modified

- `adws/triggers/issueDependencies.ts`: Added `log` import from `'../core'`; added 5 log call-sites to `findOpenDependencies()` covering entry, per-dependency state, error handling, and exit
- `adws/triggers/issueEligibility.ts`: Added `log` import from `'../core'`; added entry-level log to `checkIssueEligibility()` reporting the issue number being checked

### Key Changes

- `findOpenDependencies()` now logs `"No dependencies found, skipping dependency check"` and returns early when `deps.length === 0`
- Each dependency resolved in the for-loop emits `"Dependency #<N>: <STATE>"` at `'info'` level
- The previously silent `catch {}` block now logs `"Failed to check state of dependency #<N>: <err>"` at `'warn'` level, preserving the continue-on-error behavior while surfacing failures
- On exit, the function logs either `"Dependency check complete: N open dependency(ies) found (#X, #Y)"` or `"Dependency check complete: 0 open dependency(ies) found"`
- `checkIssueEligibility()` logs `"Checking eligibility for issue #<issueNumber>"` at the start of each evaluation

## How to Use

No configuration or code changes are required by consumers. Log output appears automatically in the existing log stream whenever `checkIssueEligibility()` is called (e.g., from `trigger_cron.ts` or `webhookGatekeeper.ts`).

Example log output for an issue with one open and one closed dependency:

```
[INFO] Checking eligibility for issue #180
[INFO] Checking dependencies: found 2 dependency(ies) to resolve
[INFO] Dependency #175: CLOSED
[INFO] Dependency #176: OPEN
[INFO] Dependency check complete: 1 open dependency(ies) found (#176)
```

## Configuration

None. The `log()` function from `adws/core` writes to stdout with timestamps and propagates the optional ADW ID context automatically.

## Testing

Unit tests are disabled for ADW per `.adw/project.md`. Validate manually by triggering an eligibility check on an issue that has a `## Dependencies` section, then inspecting the log output. Validation commands:

```sh
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- No function signatures or return values were changed — this is a pure observability addition.
- The existing silent `catch {}` was an anti-pattern per `guidelines/coding_guidelines.md` ("Provide meaningful error messages"); this feature replaces it with a `'warn'`-level log while preserving the continue-on-error semantics.
