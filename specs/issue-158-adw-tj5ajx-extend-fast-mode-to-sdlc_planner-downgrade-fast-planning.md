# Chore: Extend fast mode to downgrade planning model and effort to sonnet + medium

## Metadata
issueNumber: `158`
adwId: `tj5ajx-extend-fast-mode-to`
issueJson: `{"number":158,"title":"Extend fast mode to downgrade planning model and effort to sonnet + medium","body":"## Problem\n\nWhen a workflow is triggered in fast mode (issue body contains `/fast` or `/cheap`), the model map correctly downgrades implementation and review — but **planning commands stay at opus + high**.\n\n## Solution\n\nUpdate `adws/core/config.ts` — both `SLASH_COMMAND_MODEL_MAP_FAST` and `SLASH_COMMAND_EFFORT_MAP_FAST` to downgrade planning commands.\n\n## Acceptance Criteria\n\n- All four model values updated in `SLASH_COMMAND_MODEL_MAP_FAST`\n- All four effort values updated in `SLASH_COMMAND_EFFORT_MAP_FAST`\n- Existing tests updated to reflect new fast-mode values\n- `bun run test` passes with zero regressions","state":"OPEN","author":"paysdoc"}`

## Chore Description
When fast mode (`/fast` or `/cheap`) is active, planning commands (`/feature`, `/bug`, `/chore`, `/pr_review`) currently remain at `opus` + `high` effort — the same as default mode. This defeats the purpose of fast mode for the planning phase, which is often the most expensive step.

This chore updates `SLASH_COMMAND_MODEL_MAP_FAST` to downgrade all four planning commands from `opus` to `sonnet`, and `SLASH_COMMAND_EFFORT_MAP_FAST` to downgrade them from `high` to `medium`. The existing test suite must be updated to assert the new values.

## Relevant Files
Use these files to resolve the chore:

- `adws/core/config.ts` — Contains `SLASH_COMMAND_MODEL_MAP_FAST` and `SLASH_COMMAND_EFFORT_MAP_FAST` maps that need updating (lines 202–223 and 276–297).
- `adws/core/__tests__/slashCommandModelMap.test.ts` — Contains test assertions for both fast maps and `getModelForCommand`/`getEffortForCommand` helpers that must be updated to reflect the new values.
- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — Reference documentation for the effort map feature (read-only, for context on the effort map design).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `SLASH_COMMAND_MODEL_MAP_FAST` in `adws/core/config.ts`

- Change line 204: `'/feature': 'opus'` → `'/feature': 'sonnet'`
- Change line 205: `'/bug': 'opus'` → `'/bug': 'sonnet'`
- Change line 206: `'/chore': 'opus'` → `'/chore': 'sonnet'`
- Change line 207: `'/pr_review': 'opus'` → `'/pr_review': 'sonnet'`
- All other entries in the map remain unchanged.

### Step 2: Update `SLASH_COMMAND_EFFORT_MAP_FAST` in `adws/core/config.ts`

- Change line 278: `'/feature': 'high'` → `'/feature': 'medium'`
- Change line 279: `'/bug': 'high'` → `'/bug': 'medium'`
- Change line 280: `'/chore': 'high'` → `'/chore': 'medium'`
- Change line 281: `'/pr_review': 'high'` → `'/pr_review': 'medium'`
- All other entries in the map remain unchanged.

### Step 3: Update `SLASH_COMMAND_MODEL_MAP_FAST` test assertions in `adws/core/__tests__/slashCommandModelMap.test.ts`

In the `SLASH_COMMAND_MODEL_MAP_FAST` → `has correct fast/cheap values` test (lines 43–46):
- Change line 43: `expect(SLASH_COMMAND_MODEL_MAP_FAST['/feature']).toBe('opus')` → `.toBe('sonnet')`
- Change line 44: `expect(SLASH_COMMAND_MODEL_MAP_FAST['/bug']).toBe('opus')` → `.toBe('sonnet')`
- Change line 45: `expect(SLASH_COMMAND_MODEL_MAP_FAST['/chore']).toBe('opus')` → `.toBe('sonnet')`
- Change line 46: `expect(SLASH_COMMAND_MODEL_MAP_FAST['/pr_review']).toBe('opus')` → `.toBe('sonnet')`

### Step 4: Update `SLASH_COMMAND_EFFORT_MAP_FAST` test assertions in `adws/core/__tests__/slashCommandModelMap.test.ts`

In the `SLASH_COMMAND_EFFORT_MAP_FAST` → `has correct fast effort values` test (lines 238–241):
- Change line 238: `expect(SLASH_COMMAND_EFFORT_MAP_FAST['/feature']).toBe('high')` → `.toBe('medium')`
- Change line 239: `expect(SLASH_COMMAND_EFFORT_MAP_FAST['/bug']).toBe('high')` → `.toBe('medium')`
- Change line 240: `expect(SLASH_COMMAND_EFFORT_MAP_FAST['/chore']).toBe('high')` → `.toBe('medium')`
- Change line 241: `expect(SLASH_COMMAND_EFFORT_MAP_FAST['/pr_review']).toBe('high')` → `.toBe('medium')`

### Step 5: Update `getModelForCommand` tests for commands that now differ between maps

In `getModelForCommand` → `commands that differ between default and fast maps` (around line 138), add four new test cases for the newly-changed commands:
- `/feature`: opus → sonnet
- `/bug`: opus → sonnet
- `/chore`: opus → sonnet
- `/pr_review`: opus → sonnet

Remove these four commands from the `commands that stay the same in both maps` section (lines 180–183 for `/feature`). The `/feature stays opus` test must be removed since `/feature` no longer stays the same.

### Step 6: Update `getEffortForCommand` tests for commands that now differ

In `getEffortForCommand` → `returns fast effort when body contains /fast` (line 279):
- Change `expect(getEffortForCommand('/feature', body)).toBe('high')` → `.toBe('medium')`

In `getEffortForCommand` → `returns fast effort when body contains /cheap` (line 285, if `/feature` or planning commands are tested there, update accordingly).

### Step 7: Run validation commands

- Run `bun run test` to verify all tests pass with zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws directory
- `bun run test` - Run tests to validate the chore is complete with zero regressions

## Notes
- IMPORTANT: If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.
- Only the `_FAST` variants of each map are modified — the default maps (`SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_EFFORT_MAP`) remain unchanged.
- The `max` effort level exists in the `ReasoningEffort` type but is not used in any map — do not introduce it here.
- This chore depends on #156 being merged first (it is — see commit `a1aa97f`).
