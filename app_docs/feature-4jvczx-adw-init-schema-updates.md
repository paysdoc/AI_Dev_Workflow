# adw_init Schema Updates

**ADW ID:** 4jvczx-adw-init-updates-for
**Date:** 2026-04-08
**Specification:** specs/issue-405-adw-4jvczx-adw-init-updates-for-sdlc_planner-adw-init-schema-updates.md

## Overview

Updates the `/adw_init` slash command to align with the dev server lifecycle schema introduced by issues #395 and #403. The command now generates `## Start Dev Server` using detection logic (CLI-only, Playwright with `webServer`, self-managing runners → `N/A`; web frameworks → command with `{PORT}` placeholder), always generates `## Health Check Path: /`, and stops generating the deprecated `## Run E2E Tests` heading.

## What Was Built

- Dev server detection logic in `adw_init.md` step 2 covering CLI-only, Playwright `webServer`, self-managing test runners, and web framework targets
- `{PORT}` substitution documentation explaining runtime dynamic port allocation for parallel workflows
- `## Health Check Path` field always generated with default `/`, with override documentation
- Removal of `## Run E2E Tests` from the generated section list
- Updated wording in step 7 to reference "scenario tool detection" instead of deprecated "E2E test tool" language
- BDD fixture cleanup: removed `## Run E2E Tests` from `PLAYWRIGHT_COMMANDS_MD` in-memory fixture
- `test/fixtures/cli-tool/.adw/commands.md` aligned with new schema (added `## Start Dev Server: N/A` and `## Health Check Path: /`, removed `## Run E2E Tests`)
- New BDD feature file (`features/adw_init_schema_updates.feature`) with 14 `@adw-405 @regression` scenarios

## Technical Implementation

### Files Modified

- `.claude/commands/adw_init.md`: Added detection rules for `## Start Dev Server` (4-case logic), `{PORT}` substitution note, `## Health Check Path` field, and removed `## Run E2E Tests`; updated step 7 terminology from "E2E tool" to "scenario tool"
- `test/fixtures/cli-tool/.adw/commands.md`: Added `## Start Dev Server: N/A` and `## Health Check Path: /`, removed `## Run E2E Tests`
- `features/step_definitions/adwInitCommandsMdSteps.ts`: Removed `## Run E2E Tests` / `bunx playwright test` lines from `PLAYWRIGHT_COMMANDS_MD` fixture; added `lastCheckedSection` tracking in `Then it contains a {string} section`; added `Given adw_init was run on a repository where no E2E tool is detected` step

### New Files

- `features/adw_init_schema_updates.feature`: BDD acceptance scenarios for all schema change cases
- `features/step_definitions/adwInitSchemaUpdatesSteps.ts`: Step definitions for the new feature

### Key Changes

- `## Start Dev Server` now has explicit 4-case detection logic rather than a generic fallback — CLI/Playwright/self-managing → `N/A`, web frameworks → `{PORT}` command
- `## Health Check Path` is a new required field in every generated `.adw/commands.md`, consumed by `devServerLifecycle.ts`'s health probe
- `## Run E2E Tests` is completely removed from the generator — it was legacy E2E machinery cleaned up in #403
- Detection terminology unified: "E2E tool detection" in step 7 renamed to "scenario tool detection" for accuracy
- The `{PORT}` placeholder is now explicitly documented as a runtime substitution point for parallel workflow port isolation

## How to Use

When `/adw_init` is run against a target repo, the updated logic applies automatically during step 2:

1. Inspect the target repo for a web framework (`package.json` dev scripts, `next.config.*`, `vite.config.*`, etc.)
2. Check for `playwright.config.{ts,js}` with a `webServer` block → `## Start Dev Server: N/A`
3. For CLI-only repos with no dev server → `## Start Dev Server: N/A`
4. For web targets → `## Start Dev Server: <framework command> --port {PORT}`
5. Always write `## Health Check Path: /` (override manually if `/` redirects or is slow)
6. Do not write `## Run E2E Tests`

The `{PORT}` token is substituted at runtime by `devServerLifecycle.ts` via `substitutePort()`.

## Configuration

No new environment variables or runtime configuration. The `{PORT}` placeholder in `## Start Dev Server` values is resolved by `adws/core/devServerLifecycle.ts` at workflow execution time using `DevServerConfig.startDevServer`.

The `## Health Check Path` value is read via `CommandsConfig.healthCheckPath` in `adws/core/projectConfig.ts`. Override `/` with a faster, non-redirecting path (e.g., `/api/health`) in the target repo's `.adw/commands.md` after init.

## Testing

```sh
# Run the new adw_init schema update scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-405"

# Run the existing adw_init commands.md scenarios (regression)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-221"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Manual smoke tests (out of scope for automated validation):
- Run `bunx tsx adws/adwInit.tsx <issue>` against a fresh Next.js target → confirm `## Start Dev Server: bunx next dev --port {PORT}` and `## Health Check Path: /`
- Run against a fresh CLI target → confirm `## Start Dev Server: N/A`

## Notes

- `adws/core/projectConfig.ts` already supported `healthCheckPath` and `startDevServer` in `CommandsConfig` before this issue — the TypeScript schema was not changed, only the LLM prompt that generates the config.
- `devServerLifecycle.ts` already implements `{PORT}` substitution via `substitutePort()` and uses `healthPath` from `DevServerConfig`. This issue ensures newly initialized repos produce compatible config.
- The `## Run E2E Tests` removal completes the cleanup started in issue #403 (delete legacy E2E machinery). This issue removes it from the generator prompt and BDD fixtures.
