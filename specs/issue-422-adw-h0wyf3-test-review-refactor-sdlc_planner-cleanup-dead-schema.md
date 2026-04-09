# Chore: cleanup dead prepareApp schema, REVIEW_AGENT_COUNT docs, Health Check Path in ADW config

## Metadata
issueNumber: `422`
adwId: `h0wyf3-test-review-refactor`
issueJson: `{"number":422,"title":"test/review refactor cleanup: dead prepareApp schema, REVIEW_AGENT_COUNT docs, Health Check Path in ADW config","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nThree small cleanups left over from the test/review refactor (#394–#405). All AFK, all minor, all stem from the deletion list in the PRD missing transitive consequences.\n\n### 1. Dead schema field `prepareApp` in `projectConfig.ts`\n\nThe `prepare_app.md` slash command was deleted in #404. The schema field that drove it — `prepareApp` in `CommandsConfig` — is still present at `adws/core/projectConfig.ts:29` (interface), `:120` (heading map), and `:143` (default value `'bun install && bunx next dev --port {PORT}'`). Nothing reads it anywhere in the codebase. Dead schema.\n\n**Action:**\n- Remove `prepareApp` from `CommandsConfig` interface in `projectConfig.ts`\n- Remove the `'prepare app'` entry from `HEADING_TO_KEY`\n- Remove the default value\n- Remove any tests in `adws/core/__tests__/` that reference `prepareApp`\n- Remove the `## Prepare App` heading from ADW's own `.adw/commands.md`\n- Remove the `## Prepare App` heading from `test/fixtures/cli-tool/.adw/commands.md` if present\n\n### 2. `REVIEW_AGENT_COUNT` documented but constant deleted\n\nParallelism was dropped from review in #401. The runtime constant `REVIEW_AGENT_COUNT` is gone. But documentation still advertises it, which will confuse anyone trying to tune it:\n\n- `README.md:47`: *\"`REVIEW_AGENT_COUNT` - (Optional) Number of parallel review agents per iteration, defaults to `3`\"*\n- `.env.sample:27`: `# REVIEW_AGENT_COUNT=3`\n\n**Action:**\n- Delete the `REVIEW_AGENT_COUNT` line from `README.md` (line 47)\n- Delete the `# REVIEW_AGENT_COUNT=3` line from `.env.sample` (line 27)\n\n### 3. ADW's own `.adw/commands.md` missing `## Health Check Path`\n\n`## Health Check Path` was added as a new schema field in #395. The cli-tool fixture has it (`test/fixtures/cli-tool/.adw/commands.md`). ADW's own `.adw/commands.md` does not. Functionally this doesn't matter — ADW has `## Start Dev Server: N/A` so the health check path is irrelevant. But it's a schema completeness inconsistency that will confuse contributors looking at the canonical example.\n\n**Action:** Pick one of:\n- (a) Add `## Health Check Path` with default `/` to ADW's own `.adw/commands.md` for schema completeness\n- (b) Document in `adw_init.md` and the README that `## Health Check Path` is conditional on `## Start Dev Server` being non-`N/A`, then leave ADW's config as-is\n- (a) is simpler and more consistent.\n\n## Acceptance criteria\n\n- [ ] `prepareApp` field removed from `CommandsConfig` interface in `projectConfig.ts`\n- [ ] `'prepare app'` heading entry removed from `HEADING_TO_KEY`\n- [ ] Default value for `prepareApp` removed\n- [ ] Tests referencing `prepareApp` updated or removed\n- [ ] `## Prepare App` heading removed from ADW's own `.adw/commands.md`\n- [ ] `## Prepare App` heading removed from `test/fixtures/cli-tool/.adw/commands.md` (if present)\n- [ ] `REVIEW_AGENT_COUNT` line removed from `README.md`\n- [ ] `REVIEW_AGENT_COUNT` line removed from `.env.sample`\n- [ ] `## Health Check Path: /` added to ADW's own `.adw/commands.md` (option a)\n- [ ] Type check (`bunx tsc --noEmit`) and lint (`bun run lint`) pass\n- [ ] Existing tests still pass\n\n## Blocked by\n\nNone - can start immediately. Follow-up to the closed test/review refactor.\n\n## User stories addressed\n\nCleanup of trailing inconsistencies from #404 (slash command deletions), #401 (review parallelism removal), and #395 (Health Check Path schema addition). No specific user story from the parent PRD — these are gaps the PRD's deletion list didn't anticipate.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T21:40:09Z","comments":[],"actionableComment":null}`

## Chore Description
Three small cleanups left over from the test/review refactor (#394–#405):

1. **Dead `prepareApp` schema field** — The `prepare_app.md` slash command was deleted in #404, but the schema field that drove it (`prepareApp` in `CommandsConfig`) still exists in `projectConfig.ts` (interface, heading map, default value). Nothing reads it. The `## Prepare App` heading also remains in `.adw/commands.md`, `.claude/commands/adw_init.md` (schema docs), and `adws/README.md` (schema docs).

2. **`REVIEW_AGENT_COUNT` stale documentation** — The runtime constant was removed in #401, but `README.md` and `.env.sample` still advertise it.

3. **Missing `## Health Check Path` in ADW's own `.adw/commands.md`** — Added as a schema field in #395. The cli-tool fixture has it; ADW's own config does not. Option (a): add it for schema completeness.

## Relevant Files
Use these files to resolve the chore:

### Part 1: Dead `prepareApp` schema
- `adws/core/projectConfig.ts` — `CommandsConfig` interface (line 29), `HEADING_TO_KEY` map (line 120), `getDefaultCommandsConfig()` default (line 143). Remove `prepareApp` from all three.
- `adws/core/__tests__/projectConfig.test.ts` — Verified: no references to `prepareApp`. No changes needed.
- `.adw/commands.md` — Lines 24–25 contain `## Prepare App` section. Remove it.
- `test/fixtures/cli-tool/.adw/commands.md` — Verified: does NOT contain `## Prepare App`. No changes needed.
- `.claude/commands/adw_init.md` — Line 47 documents `## Prepare App` as a schema field. Remove that line.
- `adws/README.md` — Line 705 documents `## Prepare App` in the commands.md schema. Remove that line.

### Part 2: `REVIEW_AGENT_COUNT` stale docs
- `README.md` — Line 47: `REVIEW_AGENT_COUNT` env var documentation. Remove.
- `.env.sample` — Lines 26–27: `# REVIEW_AGENT_COUNT=3` with its comment. Remove.

### Part 3: `## Health Check Path` in ADW config
- `.adw/commands.md` — Add `## Health Check Path` section with default `/` after `## Start Dev Server` (where `## Prepare App` was).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove `prepareApp` from `CommandsConfig` interface
- In `adws/core/projectConfig.ts`, remove `prepareApp: string;` from the `CommandsConfig` interface (line 29).

### Step 2: Remove `'prepare app'` from `HEADING_TO_KEY`
- In `adws/core/projectConfig.ts`, remove the `'prepare app': 'prepareApp',` entry from the `HEADING_TO_KEY` map (line 120).

### Step 3: Remove `prepareApp` default value
- In `adws/core/projectConfig.ts`, remove the `prepareApp: 'bun install && bunx next dev --port {PORT}',` line from `getDefaultCommandsConfig()` (line 143).

### Step 4: Remove `## Prepare App` from ADW's `.adw/commands.md` and add `## Health Check Path`
- In `.adw/commands.md`, remove lines 24–25 (`## Prepare App` heading and `bun install` value).
- In the same file, add `## Health Check Path` section with value `/` after `## Start Dev Server` (before `## Additional Type Checks`). This replaces where `## Prepare App` was.

### Step 5: Remove `## Prepare App` from schema documentation
- In `.claude/commands/adw_init.md`, remove line 47 which documents `## Prepare App` as a schema field.
- In `adws/README.md`, remove line 705 which documents `## Prepare App` in the commands.md schema listing.

### Step 6: Remove `REVIEW_AGENT_COUNT` from `README.md`
- In `README.md`, remove line 47: `- \`REVIEW_AGENT_COUNT\` - (Optional) Number of parallel review agents per iteration, defaults to \`3\``.

### Step 7: Remove `REVIEW_AGENT_COUNT` from `.env.sample`
- In `.env.sample`, remove lines 26–27:
  - `# Optional - number of parallel review agents per iteration (default: 3)`
  - `# REVIEW_AGENT_COUNT=3`

### Step 8: Run validation commands
- Run all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bunx tsc --noEmit` — Root-level type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check
- `bun run lint` — Linter check
- `bun run build` — Build check
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression BDD scenarios

## Notes
- The `test/fixtures/cli-tool/.adw/commands.md` fixture was verified to NOT contain `## Prepare App`, so no changes are needed there.
- The `adws/core/__tests__/projectConfig.test.ts` test file was verified to NOT reference `prepareApp`, so no test changes are needed.
- References to `prepareApp` and `prepare_app` in `specs/`, `app_docs/`, `features/`, and `.gitignore` are historical documentation, negative BDD assertions, or gitignore entries for the deleted command file — these should NOT be modified.
- Strictly adhere to coding guidelines in `guidelines/coding_guidelines.md`.
