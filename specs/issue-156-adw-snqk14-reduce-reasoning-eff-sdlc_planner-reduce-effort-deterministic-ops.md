# Chore: Reduce reasoning effort for structurally deterministic operations

## Metadata
issueNumber: `156`
adwId: `snqk14-reduce-reasoning-eff`
issueJson: `{"number":156,"title":"Reduce reasoning effort for structurally deterministic operations","body":"## Problem\n\nSeveral slash commands are configured at \\`high\\` reasoning effort despite being structurally deterministic — their output format is well-defined, not open-ended. High effort is wasted on operations where the model is essentially filling in a template or following a mechanical procedure.\n\nCurrent over-specified settings in \\`adws/core/config.ts\\`:\n\n**Default effort map (\\`SLASH_COMMAND_EFFORT_MAP\\`):**\n- ``` `/pull_request` ```: \\`'high'\\` — creates a PR from a completed implementation (structured, templated)\n- ``` `/document` ```: \\`'high'\\` — reads a git diff and writes docs (structured output)\n- ``` `/adw_init` ```: \\`'high'\\` — detects project structure and writes config files (structured output)\n\n**Fast effort map (\\`SLASH_COMMAND_EFFORT_MAP_FAST\\`):**\n- ``` `/resolve_failed_test` ```: \\`'high'\\` — already using fast mode; high effort is contradictory\n- ``` `/resolve_failed_e2e_test` ```: \\`'high'\\` — same as above\n\n## Solution\n\nUpdate \\`adws/core/config.ts\\`:\n\n1. In \\`SLASH_COMMAND_EFFORT_MAP\\` (default):\n   - ``` `/pull_request` ```: \\`'high'\\` → \\`'medium'\\`\n   - ``` `/document` ```: \\`'high'\\` → \\`'medium'\\`\n   - ``` `/adw_init` ```: \\`'high'\\` → \\`'medium'\\`\n\n2. In \\`SLASH_COMMAND_EFFORT_MAP_FAST\\`:\n   - ``` `/resolve_failed_test` ```: \\`'high'\\` → \\`'medium'\\`\n   - ``` `/resolve_failed_e2e_test` ```: \\`'high'\\` → \\`'medium'\\`\n\n## Acceptance Criteria\n\n- All five effort values are updated in \\`config.ts\\` as specified\n- Existing tests in \\`adws/core/__tests__/slashCommandModelMap.test.ts\\` are updated to reflect the new values\n- \\`bun run test\\` passes with zero regressions","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T22:36:52Z","comments":[{"author":"paysdoc","createdAt":"2026-03-12T22:56:52Z","body":"## Take action"}],"actionableComment":null}`

## Chore Description
Five slash command reasoning effort levels in `adws/core/config.ts` are set to `'high'` despite their operations being structurally deterministic (templated or mechanical output). This chore reduces them to `'medium'` to save cost and latency without sacrificing quality:

1. **Default effort map (`SLASH_COMMAND_EFFORT_MAP`):** `/pull_request`, `/document`, and `/adw_init` change from `'high'` to `'medium'`.
2. **Fast effort map (`SLASH_COMMAND_EFFORT_MAP_FAST`):** `/resolve_failed_test` and `/resolve_failed_e2e_test` change from `'high'` to `'medium'` (high effort contradicts fast mode intent).

## Relevant Files
Use these files to resolve the chore:

- `adws/core/config.ts` — Contains `SLASH_COMMAND_EFFORT_MAP` and `SLASH_COMMAND_EFFORT_MAP_FAST` where the five effort values must be changed.
- `adws/core/__tests__/slashCommandModelMap.test.ts` — Contains test assertions for both effort maps that must be updated to expect `'medium'` instead of `'high'` for the five affected commands.
- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — Documents the effort configuration table; must be updated to reflect the new values.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update default effort map in `adws/core/config.ts`

- In the `SLASH_COMMAND_EFFORT_MAP` object (line 252–273), change:
  - `/pull_request`: `'high'` → `'medium'` (line 266)
  - `/document`: `'high'` → `'medium'` (line 267)
  - `/adw_init`: `'high'` → `'medium'` (line 272)

### Step 2: Update fast effort map in `adws/core/config.ts`

- In the `SLASH_COMMAND_EFFORT_MAP_FAST` object (line 276–297), change:
  - `/resolve_failed_test`: `'high'` → `'medium'` (line 286)
  - `/resolve_failed_e2e_test`: `'high'` → `'medium'` (line 287)

### Step 3: Update default effort map tests in `adws/core/__tests__/slashCommandModelMap.test.ts`

- In the `SLASH_COMMAND_EFFORT_MAP` test block (lines 207–233), update:
  - Line 222: `expect(SLASH_COMMAND_EFFORT_MAP['/pull_request']).toBe('high')` → `.toBe('medium')`
  - Line 223: `expect(SLASH_COMMAND_EFFORT_MAP['/document']).toBe('high')` → `.toBe('medium')`
  - Line 227: `expect(SLASH_COMMAND_EFFORT_MAP['/adw_init']).toBe('high')` → `.toBe('medium')`

### Step 4: Update fast effort map tests in `adws/core/__tests__/slashCommandModelMap.test.ts`

- In the `SLASH_COMMAND_EFFORT_MAP_FAST` test block (lines 235–261), update:
  - Line 246: `expect(SLASH_COMMAND_EFFORT_MAP_FAST['/resolve_failed_test']).toBe('high')` → `.toBe('medium')`
  - Line 247: `expect(SLASH_COMMAND_EFFORT_MAP_FAST['/resolve_failed_e2e_test']).toBe('high')` → `.toBe('medium')`

### Step 5: Update the effort configuration documentation

- In `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md`, update the Configuration table:
  - `/pull_request` row: Default Effort `high` → `medium`
  - `/document` row: Default Effort `high` → `medium`
  - `/adw_init` row: Default Effort `high` → `medium`
  - `/resolve_failed_test` row: Fast Effort `high` → `medium`
  - `/resolve_failed_e2e_test` row: Fast Effort `high` → `medium`

### Step 6: Run validation commands

- Execute all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check adws scripts
- `bun run test` - Run full test suite to validate zero regressions

## Notes
- IMPORTANT: Strictly adhere to `guidelines/coding_guidelines.md`.
- This is a purely mechanical change — only literal string values in config maps, their corresponding test assertions, and the documentation table need updating. No logic, type, or signature changes are required.
- The total number of entries in each map (20) remains unchanged.
- No changes to agent caller files are needed since they read effort via `getEffortForCommand()` which is unaffected.
