# Chore: Convert to bun

## Metadata
issueNumber: `86`
adwId: `convert-to-bun-usvxy6`
issueJson: `{"number":86,"title":"Convert to bun","body":"Change the codebase to use bun instead of npm.\n\nConvert the configuration files and replace all references to `npm` by `bun` and `npx` by `bunx`","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-06T12:45:10Z","comments":[],"actionableComment":null}`

## Chore Description
Convert the entire codebase from npm to bun as the package manager. This involves:
1. Replacing all `npm` references with `bun` equivalents (`npm install` → `bun install`, `npm test` → `bun test`, `npm run <script>` → `bun run <script>`)
2. Replacing all `npx` references with `bunx` (`npx tsx` → `bunx tsx`, `npx tsc` → `bunx tsc`, `npx playwright` → `bunx playwright`, `npx next` → `bunx next`)
3. Converting configuration files (`package-lock.json` → `bun.lockb`)
4. Updating shebangs in all executable scripts from `#!/usr/bin/env npx tsx` to `#!/usr/bin/env bunx tsx`

## Relevant Files
Use these files to resolve the chore:

### Configuration Files
- `package.json` — May need to add `"packageManager"` field or other bun-specific config. Scripts themselves don't reference npm directly but the lock file needs replacing.
- `package-lock.json` — Must be deleted and replaced by running `bun install` to generate `bun.lockb`.
- `.gitignore` — May need updating if `bun.lockb` handling differs from `package-lock.json`.
- `.adw/commands.md` — Contains all project command definitions with npm/npx references (12 commands to update).
- `.adw/project.md` — Contains library install and script execution documentation with npm/npx references.

### Source Files
- `adws/core/projectConfig.ts` — Contains hardcoded default command strings with npm/npx (11 command defaults to update).
- `adws/agents/testAgent.ts` — Spawns `npx playwright test` subprocess.
- `adws/triggers/trigger_cron.ts` — Spawns `npx tsx` subprocesses for workflow scripts.
- `adws/triggers/trigger_webhook.ts` — Spawns `npx tsx` subprocesses for workflow scripts.
- `adws/adwBuildHelpers.ts` — May contain npx references for spawning processes.

### Workflow Scripts (shebangs + usage comments)
All 15 files need shebang update from `#!/usr/bin/env npx tsx` to `#!/usr/bin/env bunx tsx` and usage comment updates:
- `adws/adwBuild.tsx`
- `adws/adwClearComments.tsx`
- `adws/adwDocument.tsx`
- `adws/adwInit.tsx`
- `adws/adwPatch.tsx`
- `adws/adwPlan.tsx`
- `adws/adwPlanBuild.tsx`
- `adws/adwPlanBuildDocument.tsx`
- `adws/adwPlanBuildReview.tsx`
- `adws/adwPlanBuildTest.tsx`
- `adws/adwPlanBuildTestReview.tsx`
- `adws/adwPrReview.tsx`
- `adws/adwSdlc.tsx`
- `adws/adwTest.tsx`
- `adws/healthCheck.tsx`

### Claude Hooks (shebangs)
All 5 hook files need shebang update from `#!/usr/bin/env npx tsx` to `#!/usr/bin/env bunx tsx`:
- `.claude/hooks/notification.ts`
- `.claude/hooks/post-tool-use.ts`
- `.claude/hooks/pre-tool-use.ts`
- `.claude/hooks/stop.ts`
- `.claude/hooks/subagent-stop.ts`

### Claude Settings
- `.claude/settings.json` — Contains `"Bash(npm:*)"` permission and 5 hook commands using `npx tsx`.

### Claude Commands (documentation)
- `.claude/commands/adw_init.md` — References npm in package manager detection context.
- `.claude/commands/bug.md` — Default validation commands use npm.
- `.claude/commands/chore.md` — Default validation commands use npm and npx tsx.
- `.claude/commands/feature.md` — Default validation commands use npm.
- `.claude/commands/prepare_app.md` — References npm install and npx next dev.
- `.claude/commands/pr_review.md` — Default validation commands use npm and npx tsx.
- `.claude/commands/start.md` — Default dev server command uses npm.
- `.claude/commands/test.md` — Contains npm/npx references in test execution examples.

### Test Files
- `adws/__tests__/projectConfig.test.ts` — All default command assertions use npm/npx values.
- `adws/__tests__/testAgent.test.ts` — Test fixtures and spawn expectations use npm/npx.
- `adws/__tests__/cwdPropagation.test.ts` — Test fixtures use npm command values.

### Documentation
- `README.md` — Root readme with npm install, npx tsx, and npm test instructions.
- `adws/README.md` — ADW workflow readme with npx tsx usage examples and npm commands.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Generate bun lockfile and remove npm lockfile
- Run `bun install` in the project root to generate `bun.lockb`
- Delete `package-lock.json`
- Verify `bun.lockb` was created

### Step 2: Update `.adw/commands.md`
- Change `## Package Manager` value from `npm` to `bun`
- Change `## Install Dependencies` from `npm install` to `bun install`
- Change `## Run Linter` from `npm run lint` to `bun run lint`
- Change `## Type Check` from `npx tsc --noEmit` to `bunx tsc --noEmit`
- Change `## Additional Type Checks` from `npx tsc --noEmit -p adws/tsconfig.json` to `bunx tsc --noEmit -p adws/tsconfig.json`
- Change `## Run Tests` from `npm test` to `bun test`
- Change `## Run Build` from `npm run build` to `bun run build`
- Change `## Start Dev Server` from `npm run dev` to `bun run dev`
- Change `## Prepare App` from `npm install && npx next dev --port {PORT}` to `bun install && bunx next dev --port {PORT}`
- Change `## Run E2E Tests` from `npx playwright test` to `bunx playwright test`
- Change `## Library Install Command` from `npm install` to `bun install`
- Change `## Script Execution` from `npx tsx <script name>` to `bunx tsx <script name>`

### Step 3: Update `.adw/project.md`
- Change `## Library Install Command` from `npm install` to `bun install`
- Change `## Script Execution` from `npx tsx <script_name>` to `bunx tsx <script_name>`
- Update Framework Notes to change `npx tsx` to `bunx tsx`

### Step 4: Update `adws/core/projectConfig.ts` defaults
- Change `packageManager` default from `'npm'` to `'bun'`
- Change `installDeps` default from `'npm install'` to `'bun install'`
- Change `runLinter` default from `'npm run lint'` to `'bun run lint'`
- Change `typeCheck` default from `'npx tsc --noEmit'` to `'bunx tsc --noEmit'`
- Change `runTests` default from `'npm test'` to `'bun test'`
- Change `runBuild` default from `'npm run build'` to `'bun run build'`
- Change `startDevServer` default from `'npm run dev'` to `'bun run dev'`
- Change `prepareApp` default from `'npm install && npx next dev --port {PORT}'` to `'bun install && bunx next dev --port {PORT}'`
- Change `runE2ETests` default from `'npx playwright test'` to `'bunx playwright test'`
- Change `additionalTypeChecks` default from `'npx tsc --noEmit -p adws/tsconfig.json'` to `'bunx tsc --noEmit -p adws/tsconfig.json'`
- Change `libraryInstall` default from `'npm install'` to `'bun install'`
- Change `scriptExecution` default from `'npx tsx <script name>'` to `'bunx tsx <script name>'`

### Step 5: Update `adws/agents/testAgent.ts`
- Change spawn call from `spawn('npx', ['playwright', 'test'], ...)` to `spawn('bunx', ['playwright', 'test'], ...)`

### Step 6: Update `adws/triggers/trigger_cron.ts`
- Change all `spawn('npx', ['tsx', ...])` calls to `spawn('bunx', ['tsx', ...])`
- Update usage comment from `npx tsx` to `bunx tsx`

### Step 7: Update `adws/triggers/trigger_webhook.ts`
- Change shebang from `#!/usr/bin/env npx tsx` to `#!/usr/bin/env bunx tsx`
- Change all spawn/spawnDetached calls from `('npx', ['tsx', ...])` to `('bunx', ['tsx', ...])`
- Update usage comment from `npx tsx` to `bunx tsx`

### Step 8: Update all 15 workflow script shebangs and usage comments
Update each of the following files:
- `adws/adwBuild.tsx` — shebang + usage comment
- `adws/adwClearComments.tsx` — shebang + usage comment
- `adws/adwDocument.tsx` — shebang + usage comment
- `adws/adwInit.tsx` — shebang + usage comment
- `adws/adwPatch.tsx` — shebang + usage comment
- `adws/adwPlan.tsx` — shebang + usage comment
- `adws/adwPlanBuild.tsx` — shebang + usage comment
- `adws/adwPlanBuildDocument.tsx` — shebang + usage comment
- `adws/adwPlanBuildReview.tsx` — shebang + usage comment
- `adws/adwPlanBuildTest.tsx` — shebang + usage comment
- `adws/adwPlanBuildTestReview.tsx` — shebang + usage comment
- `adws/adwPrReview.tsx` — shebang + usage comment
- `adws/adwSdlc.tsx` — shebang + usage comment
- `adws/adwTest.tsx` — shebang + usage comment
- `adws/healthCheck.tsx` — shebang + usage comment

For each file:
- Change line 1 shebang from `#!/usr/bin/env npx tsx` to `#!/usr/bin/env bunx tsx`
- Change usage comment from `npx tsx adws/<filename>` to `bunx tsx adws/<filename>`

### Step 9: Update all 5 Claude hook shebangs
Update each of the following files:
- `.claude/hooks/notification.ts`
- `.claude/hooks/post-tool-use.ts`
- `.claude/hooks/pre-tool-use.ts`
- `.claude/hooks/stop.ts`
- `.claude/hooks/subagent-stop.ts`

For each file:
- Change line 1 shebang from `#!/usr/bin/env npx tsx` to `#!/usr/bin/env bunx tsx`

### Step 10: Update `.claude/settings.json`
- Change permission `"Bash(npm:*)"` to `"Bash(bun:*)"`
- Change all 5 hook command strings from `npx tsx $CLAUDE_PROJECT_DIR/.claude/hooks/<hook>.ts` to `bunx tsx $CLAUDE_PROJECT_DIR/.claude/hooks/<hook>.ts`

### Step 11: Update Claude command files
Update the following files, replacing all `npm` → `bun` and `npx` → `bunx` references:

- `.claude/commands/adw_init.md` — Update package manager detection reference (npm → bun) where it refers to this project specifically
- `.claude/commands/bug.md` — Change default validation commands: `npm run lint`, `npm run build`, `npm test` → `bun run lint`, `bun run build`, `bun test`
- `.claude/commands/chore.md` — Change `npx tsx <script_name>` → `bunx tsx <script_name>` and default validation commands: `npm run lint`, `npm run build`, `npm test` → `bun run lint`, `bun run build`, `bun test`
- `.claude/commands/feature.md` — Change default validation commands: `npm run lint`, `npm run build`, `npm test` → `bun run lint`, `bun run build`, `bun test`
- `.claude/commands/prepare_app.md` — Change `npm install` → `bun install` and `npx next dev` → `bunx next dev`
- `.claude/commands/pr_review.md` — Change `npx tsx <script_name>` → `bunx tsx <script_name>` and default validation commands: `npm run lint`, `npm run build`, `npm test` → `bun run lint`, `bun run build`, `bun test`
- `.claude/commands/start.md` — Change `npm run dev` → `bun run dev`
- `.claude/commands/test.md` — Change all `npm run lint`, `npx tsc`, `npm test`, `npm run build` → `bun run lint`, `bunx tsc`, `bun test`, `bun run build`

### Step 12: Update test files
- `adws/__tests__/projectConfig.test.ts` — Update all `expect` assertions to match the new bun/bunx default values
- `adws/__tests__/testAgent.test.ts` — Update test fixtures (`execution_command` values) and spawn expectations from npm/npx to bun/bunx
- `adws/__tests__/cwdPropagation.test.ts` — Update test fixtures (`execution_command` values) from npm to bun

### Step 13: Update documentation
- `README.md` — Update all npm/npx references in setup, usage, and testing sections
- `adws/README.md` — Update all npx tsx invocation examples and npm command references

### Step 14: Update `adws/adwBuildHelpers.ts`
- Search for and replace any npm/npx references in this file

### Step 15: Run validation commands
- Run `bun run lint` to verify linting passes
- Run `bunx tsc --noEmit` to verify type checking passes
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW type checking passes
- Run `bun test` to verify all tests pass with zero regressions

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check ADW scripts
- `bun test` — Run tests to validate the chore is complete with zero regressions

## Notes
- IMPORTANT: If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.
- Do NOT modify files in `specs/` or `app_docs/` directories — these are historical records and should be left as-is.
- The `package.json` scripts themselves (`"build": "tsc"`, `"lint": "eslint ."`, `"test": "vitest run"`, `"test:watch": "vitest"`) do not contain npm references and do not need changes.
- When running `bun install`, the `bun.lockb` binary lockfile will be generated automatically. Ensure it is committed to git.
- The `.claude/commands/adw_init.md` file mentions npm in a generic context (detecting package managers for target repos). Only update references that are specific to THIS project's package manager, not generic detection logic that lists multiple package managers.
- After deleting `package-lock.json`, ensure `.gitignore` does not exclude `bun.lockb`.
