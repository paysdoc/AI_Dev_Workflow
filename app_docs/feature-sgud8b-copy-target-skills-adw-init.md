# Copy Target Skills and Commands During adw_init

**ADW ID:** sgud8b-copy-target-true-ski
**Date:** 2026-03-23
**Specification:** specs/issue-267-adw-sgud8b-copy-target-true-ski-sdlc_planner-copy-target-skills-commands.md

## Overview

Introduces a `target: true/false` YAML frontmatter convention on all Claude Code skills and commands. During `adw_init`, skills and commands marked `target: true` are copied to the target repository and committed alongside the `.adw/` config, making them permanently available to anyone working in the target repo. Additionally, `workflowInit` now skips gitignoring command files that are already tracked by git (i.e., committed during `adw_init`).

## What Was Built

- `parseFrontmatterTarget()` — reads YAML frontmatter from markdown files and returns whether `target: true` is set
- `copyDirContents()` — helper that recursively copies a directory's files to a destination, overwriting existing files
- `copyTargetSkillsAndCommands()` — scans `.claude/skills/` and `.claude/commands/` for `target: true` items and copies them to the target repo worktree
- Modified `copyClaudeCommandsToWorktree()` to skip gitignoring commands already tracked by git in the target repo
- `adwInit.tsx` now calls `copyTargetSkillsAndCommands()` before `commitChanges()` so skills and commands land in the same commit as `.adw/` config
- `target: true` frontmatter added to 6 skill SKILL.md files (`grill-me`, `improve-codebase-architecture`, `write-a-prd`, `prd-to-issues`, `tdd`, `ubiquitous-language`)
- `target: true` frontmatter added to `prime.md` and `install.md`
- `target: false` frontmatter added to all remaining 31 command files

## Technical Implementation

### Files Modified

- `adws/phases/worktreeSetup.ts`: Added `parseFrontmatterTarget()`, `copyDirContents()`, and `copyTargetSkillsAndCommands()`. Modified `copyClaudeCommandsToWorktree()` to use `git ls-files` to detect already-tracked commands and skip gitignoring them.
- `adws/adwInit.tsx`: Imports and calls `copyTargetSkillsAndCommands(config.worktreePath)` between `/adw_init` command completion and `commitChanges()`. Updated commit message to reflect new content. Migrated `persistTokenCounts`, `ModelUsageMap`, `emptyModelUsageMap`, and `mergeModelUsageMaps` imports from `./core` to `./cost`.
- `adws/phases/workflowInit.ts`: Re-exports `copyTargetSkillsAndCommands` for use by `workflowPhases.ts`.
- `.claude/skills/*/SKILL.md` (6 files): Added `target: true` to existing YAML frontmatter.
- `.claude/commands/prime.md`, `.claude/commands/install.md`: Added `target: true` YAML frontmatter block.
- `.claude/commands/*.md` (31 files): Added `target: false` YAML frontmatter block.
- `features/copy_target_skills_adw_init.feature`: BDD scenarios for the feature.
- `features/step_definitions/copyTargetSkillsAdwInitSteps.ts`: Cucumber step definitions.

### Key Changes

- **Frontmatter convention**: Simple string-based YAML parsing (no external library) checks for `target: true` in the first `---` block of each markdown file.
- **Skill copying**: Entire skill directories (all files) are copied when `SKILL.md` has `target: true`. Sub-files are not checked individually.
- **Command copying**: Only `.md` files with `target: true` frontmatter are copied; others are ignored.
- **Overwrite semantics**: Re-running `adw_init` overwrites existing skill/command files in the target repo, acting as an update mechanism.
- **Gitignore skip logic**: `copyClaudeCommandsToWorktree()` calls `git ls-files .claude/commands/` in the worktree and filters out already-tracked files before writing gitignore entries, preventing `workflowInit` from hiding previously committed commands.

## How to Use

1. Run `adw_init` against a target repository as usual.
2. After the `/adw_init` command completes, `copyTargetSkillsAndCommands()` automatically scans ADW's `.claude/skills/` and `.claude/commands/` for `target: true` items.
3. Matching skill directories and command files are copied to the target repo worktree's `.claude/skills/` and `.claude/commands/`.
4. The commit created by `adw_init` includes the `.adw/` config and all copied skills/commands under the message `chore: initialize .adw/ config with target skills and commands`.
5. Anyone cloning the target repo can now use `/prime`, `/install`, `/grill-me`, `/improve-codebase-architecture`, `/write-a-prd`, `/prd-to-issues`, `/tdd`, and `/ubiquitous-language` without ADW installed.

## Configuration

To mark a new skill for target copying, add `target: true` to its `SKILL.md` frontmatter:

```yaml
---
name: my-skill
description: ...
target: true
---
```

To mark a command for target copying, prepend to the `.md` file:

```yaml
---
target: true
---
```

Skills or commands without frontmatter, or with `target: false`, are never copied.

## Testing

Run BDD regression scenarios:

```
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Run scenarios specific to this feature:

```
NODE_OPTIONS="--import tsx" bunx cucumber-js features/copy_target_skills_adw_init.feature
```

Run linting and type checks:

```
bun run lint
bun run build
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- `/prime` references `adws/README.md` which does not exist in target repos. This is intentional — Claude handles missing files gracefully.
- The frontmatter parser uses simple string splitting, not a YAML library, since only a single boolean field is needed.
- `commitChanges()` uses `git add -A`, so any files written to the worktree before it is called are automatically included in the commit.
- Skill directory copying is flat (files only, no recursion into subdirectories) via `copyDirContents()`. Nested subdirectories within a skill are not copied.
