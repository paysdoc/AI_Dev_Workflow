# Feature: adw_init updates for new schema

## Metadata
issueNumber: `405`
adwId: `4jvczx-adw-init-updates-for`
issueJson: `{"number":405,"title":"adw_init updates for new schema","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nUpdate ```.claude/commands/adw_init.md``` to reflect the new `.adw/commands.md` schema:\n\n**Detection logic:**\n- When the target repo is CLI-only → set `## Start Dev Server: N/A`\n- When the target repo uses Playwright with a `webServer` block in `playwright.config.{ts,js}` → set `## Start Dev Server: N/A` (Playwright manages its own)\n- When the target repo uses any other test runner that self-manages → set `## Start Dev Server: N/A`\n- Otherwise → set `## Start Dev Server: <framework's dev command with {PORT} substituted>` (e.g., `bun run dev --port {PORT}`, `bunx next dev --port {PORT}`)\n\n**New field generation:**\n- Always add `## Health Check Path` with default `/`\n\n**Removed field:**\n- Stop generating `## Run E2E Tests` heading\n\n**Documentation:**\n- Update inline comments in ```adw_init.md``` to explain the `{PORT}` substitution requirement on `## Start Dev Server`\n- Note that `## Health Check Path` can be overridden per target repo if `/` is slow or redirects\n\n## Acceptance criteria\n\n- [ ] ```adw_init.md``` includes Playwright/CLI/other-runner detection logic\n- [ ] Generated `.adw/commands.md` files have `## Start Dev Server: N/A` for CLI/Playwright/self-managing targets\n- [ ] Generated `.adw/commands.md` files have `## Start Dev Server: <command with {PORT}>` for other web targets\n- [ ] Generated `.adw/commands.md` files include `## Health Check Path: /`\n- [ ] Generated `.adw/commands.md` files no longer include `## Run E2E Tests`\n- [ ] Manual smoke test: run `bunx tsx adws/adwInit.tsx <issue>` against a fresh Next.js target, confirm the generated config is correct\n- [ ] Manual smoke test: run against a fresh CLI target, confirm `## Start Dev Server: N/A`\n\n## Blocked by\n\n- Blocked by #395\n- Blocked by #403\n\n## User stories addressed\n\n- User story 34\n- User story 35\n- User story 36","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:06:18Z","comments":[{"author":"paysdoc","createdAt":"2026-04-08T18:25:59Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Update the `/adw_init` slash command (`.claude/commands/adw_init.md`) to reflect the new `.adw/commands.md` schema established by the test/review refactor PRD. Three changes are needed: (1) add detection logic for when to set `## Start Dev Server` to `N/A` vs a framework dev command with `{PORT}` substitution, (2) always generate a `## Health Check Path` field defaulting to `/`, and (3) stop generating the deprecated `## Run E2E Tests` heading. The existing BDD scenarios and step definitions that reference `## Run E2E Tests` in fixture data also need updating for consistency.

## User Story
As an ADW developer
I want `adw_init` to detect whether a target repo needs a dev server and generate the correct `## Start Dev Server` and `## Health Check Path` fields while removing the deprecated `## Run E2E Tests` heading
So that newly initialized target repos have correct configuration for the dev server lifecycle helper and don't carry deprecated conventions

## Problem Statement
The current `adw_init.md` does not include dev server detection logic — it generates `## Start Dev Server` with a generic framework command for all projects regardless of whether the project is CLI-only, uses Playwright (which manages its own `webServer`), or uses another self-managing test runner. It also lacks the new `## Health Check Path` field needed by `devServerLifecycle.ts`, and still generates the deprecated `## Run E2E Tests` heading that was removed in issue #403.

## Solution Statement
Update the `adw_init.md` slash command instructions to:
1. Add a detection step that checks for CLI-only projects, Playwright `webServer` blocks, and other self-managing test runners — setting `## Start Dev Server: N/A` in those cases
2. For web targets without self-managing runners, set `## Start Dev Server` to the framework's dev command with `{PORT}` placeholder (e.g., `bun run dev --port {PORT}`)
3. Always add `## Health Check Path` with default `/` to the section list
4. Remove `## Run E2E Tests` from the section list in step 2
5. Add inline documentation explaining `{PORT}` substitution and `## Health Check Path` override semantics
6. Update the existing BDD scenario fixtures that reference `## Run E2E Tests` to remain consistent

## Relevant Files
Use these files to implement the feature:

- `.claude/commands/adw_init.md` — The main file being modified. Contains the slash command instructions for initializing `.adw/` config in target repos. The section list in step 2, the detection logic, and inline documentation all need updating.
- `adws/core/projectConfig.ts` — Already has `healthCheckPath` and `startDevServer` in `CommandsConfig` and `HEADING_TO_KEY`. No code changes needed, but referenced for understanding the schema contract.
- `adws/core/devServerLifecycle.ts` — Consumer of `startDevServer` (with `{PORT}` substitution) and `healthCheckPath`. No changes needed, but understanding its contract informs the `adw_init.md` changes.
- `features/adw_init_commands_md.feature` — Existing BDD scenarios for `adw_init` commands.md generation. The scenario referencing `## Run E2E Tests` in a fixture context needs updating (scenario: "Run Scenarios by Tag in commands.md matches Cucumber when E2E is N/A").
- `features/step_definitions/adwInitCommandsMdSteps.ts` — Step definitions for the above feature. Contains `PLAYWRIGHT_COMMANDS_MD` fixture with `## Run E2E Tests` that should be removed.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `adws/core/__tests__/projectConfig.test.ts` — Existing unit tests for `projectConfig.ts`. Already tests `healthCheckPath`. No changes needed.
- `features/adw_init_schema_updates.feature` — Primary BDD scenarios for this issue. Covers detection logic, Health Check Path, Run E2E Tests removal, generated commands.md shapes, and schema consistency.
- `features/fixture_repo_test_harness.feature` — Contains a `@adw-405`-tagged scenario verifying the CLI-tool fixture has the current commands.md schema (no `## Run E2E Tests`, has `## Health Check Path`, `## Start Dev Server: N/A`).
- `test/fixtures/cli-tool/.adw/commands.md` — Fixture file for the CLI-tool target repo. Must be updated to reflect the new schema: remove `## Run E2E Tests`, add `## Health Check Path`, ensure `## Start Dev Server: N/A`.

### New Files
None — all changes are to existing files.

## Implementation Plan
### Phase 1: Foundation
Update the `adw_init.md` slash command to reflect the new schema. This is the core change — all other changes flow from it. The detection logic needs to be precise: CLI projects and projects with self-managing test runners (Playwright `webServer`, etc.) get `N/A`; web projects without self-managing runners get a framework command with `{PORT}`.

### Phase 2: Core Implementation
1. In `adw_init.md` step 2 (Create `.adw/commands.md`):
   - Remove `## Run E2E Tests` from the section list
   - Add `## Health Check Path` to the section list with default `/` and inline comment about overriding
   - Update `## Start Dev Server` description to include detection logic and `{PORT}` documentation
   - Add `## Prepare App` documentation noting `{PORT}` placeholder requirement
2. Add a new detection sub-step within step 2 (or a dedicated sub-section) that explains the Playwright/CLI/self-managing detection rules

### Phase 3: Integration
Update the existing BDD scenarios and fixtures to remove references to the deprecated `## Run E2E Tests` heading, ensuring the regression suite stays green.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Update `adw_init.md` — Remove `## Run E2E Tests` from step 2
- Open `.claude/commands/adw_init.md`
- In step 2 ("Create `.adw/commands.md`"), remove the `## Run E2E Tests` bullet from the section list
- This heading was part of the old E2E machinery deleted in issue #403

### Step 2: Update `adw_init.md` — Add `## Health Check Path` to step 2
- In step 2's section list, add a new bullet:
  - `## Health Check Path` — HTTP path the dev server health probe hits (default `/`). Can be overridden per target repo if `/` is slow or redirects.
- Place it after `## Start Dev Server` for logical grouping

### Step 3: Update `adw_init.md` — Add dev server detection logic to step 2
- Update the `## Start Dev Server` bullet in step 2 to include detection rules:
  - When the target repo is CLI-only (no web framework detected) → set `N/A`
  - When the target repo uses Playwright with a `webServer` block in `playwright.config.{ts,js}` → set `N/A` (Playwright manages its own dev server)
  - When the target repo uses any other test runner that self-manages its server → set `N/A`
  - Otherwise → set to the framework's dev command with `{PORT}` substituted (e.g., `bun run dev --port {PORT}`, `bunx next dev --port {PORT}`)
- Add an inline comment/note explaining that `{PORT}` is a substitution placeholder used by the dev server lifecycle helper to allocate dynamic ports for parallel workflows

### Step 4: Update BDD fixture — Remove `## Run E2E Tests` from Playwright fixture
- In `features/step_definitions/adwInitCommandsMdSteps.ts`, remove the `## Run E2E Tests` / `bunx playwright test` lines from the `PLAYWRIGHT_COMMANDS_MD` in-memory fixture
- This aligns the fixture with the new schema

### Step 5: Update BDD scenario — Confirm "no E2E tool" scenario wording
- In `features/adw_init_commands_md.feature`, verify the scenario "Run Scenarios by Tag in commands.md defaults to Cucumber when no E2E tool is detected" does not reference `## Run E2E Tests`
- The scenario was already reworded to describe a project with no E2E tool detected rather than referencing the removed heading

### Step 6: Update fixture target repo — Align `test/fixtures/cli-tool/.adw/commands.md` with new schema
- In `test/fixtures/cli-tool/.adw/commands.md`, remove any `## Run E2E Tests` section
- Ensure `## Start Dev Server` is set to `N/A` (CLI-only fixture)
- Ensure `## Health Check Path` section exists with default `/`
- This satisfies the `@adw-405`-tagged scenario in `features/fixture_repo_test_harness.feature`

### Step 7: Run validation commands
- Run the full validation suite to confirm zero regressions

## Testing Strategy
### Unit Tests
The existing `projectConfig.test.ts` already tests `healthCheckPath` parsing and `startDevServer` defaults. No new unit tests are needed since:
- The `CommandsConfig` interface and `HEADING_TO_KEY` map already include both fields
- The `adw_init.md` changes are prompt-level (LLM instruction changes), not TypeScript code changes
- The existing BDD scenarios validate that `adw_init.md` lists the required sections

### Edge Cases
- CLI-only target repo (no `package.json` scripts for `dev`, no web framework) → `## Start Dev Server: N/A`
- Playwright project with `webServer` block → `## Start Dev Server: N/A`
- Next.js project without Playwright → `## Start Dev Server: bunx next dev --port {PORT}`
- Bun/Vite project → `## Start Dev Server: bun run dev --port {PORT}`
- Project with both Playwright and a web framework → `N/A` (Playwright's `webServer` takes precedence)
- Target repo with custom health path (e.g., `/api/health`) → `## Health Check Path: /` generated as default, user overrides manually

## Acceptance Criteria
- `adw_init.md` includes Playwright/CLI/other-runner detection logic for `## Start Dev Server`
- `adw_init.md` step 2 section list includes `## Health Check Path` with default `/`
- `adw_init.md` step 2 section list does NOT include `## Run E2E Tests`
- `adw_init.md` documents the `{PORT}` substitution requirement on `## Start Dev Server`
- `adw_init.md` notes that `## Health Check Path` can be overridden per target repo
- BDD fixture `PLAYWRIGHT_COMMANDS_MD` no longer contains `## Run E2E Tests`
- BDD scenario wording updated to not reference the removed `## Run E2E Tests` heading
- Fixture at `test/fixtures/cli-tool/.adw/commands.md` has no `## Run E2E Tests`, has `## Health Check Path`, and has `## Start Dev Server: N/A`
- All existing BDD scenarios pass (`@regression` tag)
- Linter passes
- Type check passes
- Build passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws module
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-405"` — Run the adw_init schema updates BDD scenarios specifically
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-221"` — Run the adw_init commands.md BDD scenarios specifically
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify zero regressions

## Notes
- The `adws/core/projectConfig.ts` already supports `healthCheckPath` and `startDevServer` fields in `CommandsConfig` with proper parsing and defaults. This issue only changes the slash command prompt that generates the config, not the TypeScript code that parses it.
- The `devServerLifecycle.ts` helper already implements `{PORT}` substitution via `substitutePort()` and uses `healthPath` from `DevServerConfig`. The `adw_init.md` changes ensure newly initialized target repos produce config compatible with this helper.
- The `## Run E2E Tests` heading was deleted from the codebase in issue #403 (legacy E2E machinery removal). This issue completes the cleanup by removing it from the `adw_init.md` generator instructions and BDD fixtures.
- Manual smoke tests (running `adw_init` against real target repos) are listed in the issue acceptance criteria but are out of scope for automated validation — they require actual target repositories.
