# Feature: Copy target: true skills and commands to target repos during adw_init

## Metadata
issueNumber: `267`
adwId: `sgud8b-copy-target-true-ski`
issueJson: `{"number":267,"title":"Copy target: true skills and commands to target repos during adw_init","body":"## Problem\n\nADW copies all `.claude/commands/` to target repo worktrees and gitignores them. Skills (`.claude/skills/`) are never copied. Some skills and commands are useful for human interactive use in target repos (e.g., `/grill-me`, `/improve-codebase-architecture`, `/prime`) but are unavailable there today.\n\n## Solution\n\nIntroduce a `target: true/false` frontmatter convention on all skills and commands. During `adw_init`, copy `target: true` items to the target repo and commit them alongside the `.adw/` config. During `workflowInit`, stop gitignoring commands that are already committed in the target repo.\n\n## Acceptance Criteria\n\n- [ ] All skills have YAML frontmatter with `target: true`:\n  - `grill-me` (full directory)\n  - `improve-codebase-architecture` (full directory including `REFERENCE.md`)\n  - `write-a-prd` (full directory)\n  - `prd-to-issues` (full directory)\n  - `tdd` (full directory including `deep-modules.md`, `interface-design.md`, `mocking.md`, `refactoring.md`, `tests.md`)\n  - `ubiquitous-language` (full directory)\n- [ ] All commands have YAML frontmatter with `target` field:\n  - `target: true`: `/prime`, `/install`\n  - `target: false`: all other commands\n- [ ] `adw_init` scans `.claude/skills/` and `.claude/commands/` for `target: true` frontmatter\n- [ ] `adw_init` copies matching skills (entire directory) and commands to the target repo\n- [ ] `adw_init` overwrites existing files on re-run (acts as update mechanism)\n- [ ] `adw_init` commits skills/commands in the same commit as `.adw/` config\n- [ ] `workflowInit` (`copyClaudeCommandsToWorktree`) skips gitignoring commands that already exist in the target repo (i.e., were previously committed)\n- [ ] `/prime` is copied as-is without content adaptation (graceful failure on missing `adws/README.md`)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-23T07:59:50Z","comments":[],"actionableComment":null}`

## Feature Description
Introduce a `target: true/false` frontmatter convention on all Claude Code skills and commands. During the `adw_init` ceremony, scan for items marked `target: true` and copy them to the target repository, committing them alongside the `.adw/` configuration. This makes interactive skills like `/grill-me`, `/improve-codebase-architecture`, `/prime` available to anyone who clones the target repo, without requiring ADW to be installed. Additionally, modify `workflowInit` to stop gitignoring commands that were previously committed to the target repo.

## User Story
As a developer working in a target repository initialized by ADW
I want interactive Claude Code skills and commands (like `/grill-me`, `/prime`) available in my repo
So that I can use them directly without needing ADW installed or running

## Problem Statement
ADW currently copies all `.claude/commands/` to target repo worktrees and gitignores them, making them transient. Skills (`.claude/skills/`) are never copied at all. Some skills and commands are useful for human interactive use in target repos but are unavailable there today.

## Solution Statement
Add a `target: true/false` YAML frontmatter field to all skills and commands. Create a new `copyTargetSkillsAndCommands()` function in `worktreeSetup.ts` that scans for `target: true` items and copies them (entire skill directories, individual command files) to the target repo. Call this from `adwInit.tsx` before the commit step so they are committed in the same commit as `.adw/` config. Modify `copyClaudeCommandsToWorktree()` to skip gitignoring commands already tracked by git in the target repo.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `adws/phases/worktreeSetup.ts` — Contains `copyClaudeCommandsToWorktree()` which handles command copying and gitignoring. This is where the new `copyTargetSkillsAndCommands()` function and frontmatter parsing logic will be added, and where `copyClaudeCommandsToWorktree()` will be modified to skip gitignoring committed commands.
- `adws/adwInit.tsx` — The `adw_init` orchestrator. Needs to call the new `copyTargetSkillsAndCommands()` between the `/adw_init` command execution and the `commitChanges()` call.
- `adws/phases/workflowInit.ts` — Re-exports worktree setup helpers. Needs to re-export the new function.
- `.claude/skills/grill-me/SKILL.md` — Needs `target: true` added to existing frontmatter.
- `.claude/skills/improve-codebase-architecture/SKILL.md` — Needs `target: true` added to existing frontmatter.
- `.claude/skills/write-a-prd/SKILL.md` — Needs `target: true` added to existing frontmatter.
- `.claude/skills/prd-to-issues/SKILL.md` — Needs `target: true` added to existing frontmatter.
- `.claude/skills/tdd/SKILL.md` — Needs `target: true` added to existing frontmatter.
- `.claude/skills/ubiquitous-language/SKILL.md` — Needs `target: true` added to existing frontmatter.
- `.claude/commands/prime.md` — Needs `target: true` YAML frontmatter added (currently has no frontmatter).
- `.claude/commands/install.md` — Needs `target: true` YAML frontmatter added (currently has no frontmatter).
- `.claude/commands/bug.md` — Needs `target: false` YAML frontmatter added (representative of all other commands).
- All other `.claude/commands/*.md` files — Each needs `target: false` YAML frontmatter added.

### New Files
No new files need to be created. All logic is added to existing files.

## Implementation Plan

### Phase 1: Foundation — Add `target` frontmatter to all skills and commands
Add the `target: true` or `target: false` YAML frontmatter field to every skill and command. Skills already have YAML frontmatter (`---` blocks with `name` and `description`), so `target: true` is appended as a new field. Commands currently have no frontmatter, so `---` blocks with a `target` field must be prepended.

**Skills (`target: true`):** `grill-me`, `improve-codebase-architecture`, `write-a-prd`, `prd-to-issues`, `tdd`, `ubiquitous-language`

**Commands (`target: true`):** `prime.md`, `install.md`

**Commands (`target: false`):** `adw_init.md`, `bug.md`, `chore.md`, `classify_issue.md`, `clean_local_repo.md`, `commit.md`, `commit_cost.md`, `conditional_docs.md`, `document.md`, `extract_dependencies.md`, `feature.md`, `find_issue_dependencies.md`, `generate_branch_name.md`, `generate_step_definitions.md`, `implement.md`, `in_loop_review.md`, `patch.md`, `pr_review.md`, `prepare_app.md`, `pull_request.md`, `resolve_conflict.md`, `resolve_failed_e2e_test.md`, `resolve_failed_test.md`, `resolve_plan_scenarios.md`, `review.md`, `scenario_writer.md`, `start.md`, `test.md`, `test_e2e.md`, `tools.md`, `track_agentic_kpis.md`, `validate_plan_scenarios.md`

### Phase 2: Core Implementation — Frontmatter parsing and target copy logic
Add two new functions to `adws/phases/worktreeSetup.ts`:

1. **`parseFrontmatterTarget(filePath: string): boolean`** — Reads a markdown file, parses the YAML frontmatter block (`---` delimited), and returns whether `target: true` is set. Returns `false` if no frontmatter or `target` field is absent.

2. **`copyTargetSkillsAndCommands(worktreePath: string): void`** — Resolves the ADW repo root (same pattern as `copyClaudeCommandsToWorktree`). Scans `.claude/skills/` directories: for each skill directory, reads `SKILL.md` for `target: true` in frontmatter, and if true, copies the entire directory to the target repo's `.claude/skills/<name>/`, overwriting existing files. Scans `.claude/commands/` `.md` files: for each file with `target: true` in frontmatter, copies to the target repo's `.claude/commands/`, overwriting existing files.

Re-export `copyTargetSkillsAndCommands` from `adws/phases/workflowInit.ts`.

### Phase 3: Integration — Wire into adwInit.tsx and modify workflowInit gitignore behavior

1. **`adwInit.tsx`**: Import and call `copyTargetSkillsAndCommands(config.worktreePath)` after the `/adw_init` command succeeds but before `commitChanges()`. This ensures skills/commands are committed in the same commit as `.adw/` config. Update the commit message to reflect the additional content.

2. **`copyClaudeCommandsToWorktree()`**: Modify to check which `.claude/commands/` files are already tracked by git in the target worktree (using `git ls-files`). Skip gitignoring any command file that is already tracked (i.e., was committed during `adw_init`). This prevents `workflowInit` from gitignoring target commands that should remain visible.

## Step by Step Tasks

### Step 1: Add `target: true` frontmatter to all 6 skill SKILL.md files
- Edit `.claude/skills/grill-me/SKILL.md` — add `target: true` after the `description` field in the existing frontmatter block
- Edit `.claude/skills/improve-codebase-architecture/SKILL.md` — add `target: true`
- Edit `.claude/skills/write-a-prd/SKILL.md` — add `target: true`
- Edit `.claude/skills/prd-to-issues/SKILL.md` — add `target: true`
- Edit `.claude/skills/tdd/SKILL.md` — add `target: true`
- Edit `.claude/skills/ubiquitous-language/SKILL.md` — add `target: true`

### Step 2: Add `target: true` frontmatter to prime.md and install.md commands
- Edit `.claude/commands/prime.md` — prepend YAML frontmatter block:
  ```
  ---
  target: true
  ---
  ```
- Edit `.claude/commands/install.md` — prepend same YAML frontmatter block

### Step 3: Add `target: false` frontmatter to all other command files
- Edit each of the remaining `.claude/commands/*.md` files (31 files total) — prepend:
  ```
  ---
  target: false
  ---
  ```
- Files: `adw_init.md`, `bug.md`, `chore.md`, `classify_issue.md`, `clean_local_repo.md`, `commit.md`, `commit_cost.md`, `conditional_docs.md`, `document.md`, `extract_dependencies.md`, `feature.md`, `find_issue_dependencies.md`, `generate_branch_name.md`, `generate_step_definitions.md`, `implement.md`, `in_loop_review.md`, `patch.md`, `pr_review.md`, `prepare_app.md`, `pull_request.md`, `resolve_conflict.md`, `resolve_failed_e2e_test.md`, `resolve_failed_test.md`, `resolve_plan_scenarios.md`, `review.md`, `scenario_writer.md`, `start.md`, `test.md`, `test_e2e.md`, `tools.md`, `track_agentic_kpis.md`, `validate_plan_scenarios.md`

### Step 4: Implement `parseFrontmatterTarget()` in `worktreeSetup.ts`
- Add a function that reads a file, extracts the YAML frontmatter block between `---` delimiters, and checks for `target: true`
- Use simple string parsing (no external YAML library needed) — split on `---`, scan lines for `target:` key, parse value as boolean
- Return `false` if file doesn't exist, has no frontmatter, or `target` field is absent/false

### Step 5: Implement `copyTargetSkillsAndCommands()` in `worktreeSetup.ts`
- Resolve the ADW repo root using the same `path.dirname(fileURLToPath(import.meta.url))` pattern as `copyClaudeCommandsToWorktree`
- **Skills scanning**: Read `.claude/skills/` directory. For each subdirectory, check if `SKILL.md` exists and has `target: true`. If yes, copy the entire directory (all files) to `<worktreePath>/.claude/skills/<skillName>/`, creating directories as needed. Overwrite existing files.
- **Commands scanning**: Read `.claude/commands/` directory. For each `.md` file, check frontmatter for `target: true`. If yes, copy the file to `<worktreePath>/.claude/commands/<filename>`, overwriting if it exists.
- Log the number of skills and commands copied
- Do not add copied files to `.gitignore` — these are meant to be committed

### Step 6: Re-export `copyTargetSkillsAndCommands` from `workflowInit.ts`
- Add `copyTargetSkillsAndCommands` to the re-export statement in `adws/phases/workflowInit.ts`

### Step 7: Integrate `copyTargetSkillsAndCommands()` into `adwInit.tsx`
- Import `copyTargetSkillsAndCommands` from `./workflowPhases` (which re-exports from `workflowInit`)
- Call `copyTargetSkillsAndCommands(config.worktreePath)` after the `/adw_init` command succeeds and before `commitChanges()`
- Update the commit message from `'chore: initialize .adw/ project configuration'` to `'chore: initialize .adw/ config with target skills and commands'`

### Step 8: Modify `copyClaudeCommandsToWorktree()` to skip gitignoring committed commands
- After copying commands, before calling `ensureGitignoreEntries`, check which `.claude/commands/` files are already tracked by git in the target worktree
- Use `execSync('git ls-files .claude/commands/', { encoding: 'utf-8', cwd: worktreePath })` to get the list of tracked command files
- Filter `copiedFiles` to exclude any file that is already tracked (appears in the `git ls-files` output)
- Only gitignore the remaining (non-tracked) files
- Import `execSync` from `child_process` (already available in the codebase pattern)

### Step 9: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` for type checking

## Testing Strategy

### Edge Cases
- **No skills directory**: `copyTargetSkillsAndCommands` should handle missing `.claude/skills/` gracefully (log and skip)
- **No commands directory**: Same graceful handling for missing `.claude/commands/`
- **No frontmatter**: Commands/skills without frontmatter should be treated as `target: false`
- **Re-run overwrite**: Running `adw_init` again should overwrite existing skill/command files in target repo
- **Empty git ls-files**: If no commands are tracked (fresh repo), all copied commands should be gitignored as before
- **Partial tracking**: If some commands are tracked and some aren't, only untracked ones get gitignored
- **SKILL.md has `target: true` but supporting files don't**: The entire directory is copied based on SKILL.md's frontmatter, not individual file frontmatter
- **Mixed frontmatter**: Files with `target: false` or missing `target` field are never copied

## Acceptance Criteria
- All 6 skill SKILL.md files have `target: true` in their YAML frontmatter
- `prime.md` and `install.md` have `target: true` YAML frontmatter
- All other 31 command files have `target: false` YAML frontmatter
- `copyTargetSkillsAndCommands()` scans `.claude/skills/` and `.claude/commands/` for `target: true`
- `copyTargetSkillsAndCommands()` copies matching skill directories and command files to target repo
- Existing files are overwritten on re-run (update mechanism)
- `adwInit.tsx` calls `copyTargetSkillsAndCommands()` before `commitChanges()` so skills/commands are in the same commit as `.adw/` config
- `copyClaudeCommandsToWorktree()` skips gitignoring commands already tracked by git
- `/prime` is copied as-is (no content adaptation)
- `bun run lint`, `bun run build`, and type checks pass with zero errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Run root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run ADW-specific TypeScript type check
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression BDD scenarios

## Notes
- Follow `guidelines/coding_guidelines.md` strictly — especially: clarity over cleverness, modularity, type safety, functional programming practices (use `filter`/`map` over loops).
- The frontmatter parsing is intentionally simple (string-based, no YAML library) since we only need to check a single boolean field. This avoids adding a dependency.
- `/prime` references `adws/README.md` which won't exist in target repos. This is acceptable — Claude handles missing files gracefully per the design decisions.
- The `commitChanges()` function uses `git add -A`, so any files written to the worktree before the call will be included in the commit automatically.
- When adding frontmatter to commands, ensure the `---` block is the very first content in the file (no leading whitespace or blank lines) so it's recognized as YAML frontmatter.
