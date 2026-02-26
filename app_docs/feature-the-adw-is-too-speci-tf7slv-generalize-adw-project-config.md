# Generalize ADW Project Configuration

**ADW ID:** the-adw-is-too-speci-tf7slv
**Date:** 2026-02-25
**Specification:** specs/issue-18-adw-the-adw-is-too-speci-tf7slv-sdlc_planner-generalize-adw-project-config.md

## Overview

The ADW system previously hardcoded assumptions about target project structure, build tools (npm/npx), and framework conventions (Next.js/React) throughout its slash command templates. This feature introduces a `.adw/` project configuration directory convention that allows any target repository to provide its own commands, file structure, and conditional documentation, making ADW language- and framework-agnostic while maintaining full backward compatibility when no `.adw/` directory exists.

## What Was Built

- **`.adw/` directory convention** — Three markdown config files (`commands.md`, `project.md`, `conditional_docs.md`) that target repos place in their root to customize ADW behavior
- **`adws/core/projectConfig.ts`** — TypeScript module that loads, parses, and validates `.adw/` config files with sensible defaults
- **`adws/adwInit.tsx`** — New orchestrator that bootstraps `.adw/` config by analyzing a target repository's codebase
- **`.claude/commands/adw_init.md`** — New slash command template for `/adw_init` that detects project type and generates the three config files
- **Refactored slash command templates** — All affected `.claude/commands/*.md` files updated to dynamically read from `.adw/` instead of hardcoded values
- **ADW self-configuration** — ADW's own `.adw/commands.md`, `.adw/project.md`, and `.adw/conditional_docs.md` created as a reference implementation
- **`/adw_init` type system integration** — New command added to `AdwSlashCommand`, `SlashCommand`, model maps, and orchestrator map
- **`ProjectConfig` in `WorkflowConfig`** — Project config loaded during `initializeWorkflow()` and available throughout the workflow

## Technical Implementation

### Files Modified

- `adws/core/projectConfig.ts`: **New** — `ProjectConfig` interface, `CommandsConfig` interface, markdown heading parser (`parseMarkdownSections`), `loadProjectConfig()`, `getDefaultProjectConfig()`, `parseCommandsMd()`
- `adws/adwInit.tsx`: **New** — ADW init orchestrator; runs `/adw_init` slash command then commits generated `.adw/` files
- `.claude/commands/adw_init.md`: **New** — Slash command that detects project type from manifest files and generates all three `.adw/` config files
- `.adw/commands.md`: **New** — ADW's own command configuration (npm/npx defaults)
- `.adw/project.md`: **New** — ADW's own project structure and relevant files
- `.adw/conditional_docs.md`: **New** — ADW's own conditional documentation config
- `adws/core/issueTypes.ts`: Added `/adw_init` to `AdwSlashCommand`, `SlashCommand`, `adwCommandToIssueTypeMap`, and `adwCommandToOrchestratorMap`
- `adws/core/config.ts`: Added `/adw_init` to `SLASH_COMMAND_MODEL_MAP` (sonnet) and `SLASH_COMMAND_MODEL_MAP_FAST` (haiku)
- `adws/core/index.ts`: Exported `ProjectConfig` and `loadProjectConfig`
- `adws/phases/workflowLifecycle.ts`: Added `projectConfig: ProjectConfig` to `WorkflowConfig`; calls `loadProjectConfig(worktreePath)` in `initializeWorkflow()`
- `.claude/commands/feature.md`: Replaced hardcoded relevant files, `npm install`, and validation commands with `.adw/` dynamic injection
- `.claude/commands/bug.md`: Same refactoring as `feature.md`
- `.claude/commands/chore.md`: Same refactoring plus script execution (`npx tsx`) generalization
- `.claude/commands/pr_review.md`: Same refactoring pattern
- `.claude/commands/test.md`: All test commands now read from `.adw/commands.md` with defaults; removed Next.js-specific language
- `.claude/commands/prepare_app.md`: Added `.adw/commands.md` Prepare App section lookup with fallback
- `.claude/commands/start.md`: Added `.adw/commands.md` Start Dev Server section lookup with fallback
- `.claude/commands/conditional_docs.md`: Now delegates entirely to `.adw/conditional_docs.md`; removed hardcoded ADW-specific entries
- `.claude/commands/patch.md`: Relevant files now read from `.adw/project.md`
- `.claude/commands/resolve_failed_e2e_test.md`: Falls back to `.adw/commands.md` for dev server URL
- `.claude/commands/classify_adw.md`: Added `/adw_init` command entry
- `adws/__tests__/projectConfig.test.ts`: **New** — 312 lines of unit tests covering all `projectConfig.ts` functions
- `adws/__tests__/slashCommandModelMap.test.ts`: Extended to verify `/adw_init` model mapping
- `adws/__tests__/tokenLimitRecovery.test.ts` / `workflowPhases.test.ts`: Updated for new `WorkflowConfig.projectConfig` field
- `adws/README.md`: Added full `.adw/` configuration system documentation section
- `README.md`: Added `.adw/` directory to project structure

### Key Changes

- **Markdown as config format**: Config files use `## Heading` sections for human-readable, Claude-friendly configuration that agents can read directly as context
- **Heading-based parser**: `parseMarkdownSections()` splits markdown by `## Heading` and maps lowercased heading text to `CommandsConfig` keys via `HEADING_TO_KEY` lookup table
- **Graceful degradation**: Every dynamic injection point in slash command templates includes explicit fallback defaults matching previous hardcoded values — fully backward compatible when `.adw/` is absent
- **Single load point**: `loadProjectConfig()` is called once in `initializeWorkflow()`, stored in `WorkflowConfig`, eliminating redundant file reads across the workflow
- **Self-referential validation**: ADW's own `.adw/` files serve as both the reference implementation and a live test that the system reads its own config correctly

## How to Use

### For target repository maintainers

1. Run `/adw_init` on the target repository issue (or directly via `npx tsx adws/adwInit.tsx <issueNumber>`) to auto-generate the `.adw/` directory
2. Review and customize the generated files:
   - `.adw/commands.md` — Update commands for your language/package manager
   - `.adw/project.md` — Verify the relevant files list matches your structure
   - `.adw/conditional_docs.md` — Add conditions for your documentation
3. Commit the `.adw/` directory to your repository

### Example `.adw/commands.md` for a Python project

```markdown
## Package Manager
pip

## Install Dependencies
pip install -r requirements.txt

## Run Linter
ruff check .

## Type Check
mypy .

## Run Tests
pytest

## Run Build
python -m build

## Start Dev Server
python manage.py runserver {PORT}

## Prepare App
pip install -r requirements.txt && python manage.py runserver {PORT}

## Run E2E Tests
N/A

## Library Install Command
pip install

## Script Execution
python
```

### Without `.adw/` configuration

All ADW slash commands fall back to npm/Next.js defaults — no configuration required for existing Node.js projects.

## Configuration

The `.adw/` directory lives in the **target repository root** (not in the ADW repo itself, unless the target repo is ADW). All three files are optional; missing files use defaults:

| File | Purpose | Required |
|---|---|---|
| `.adw/commands.md` | Command mappings | No (defaults to npm) |
| `.adw/project.md` | Project structure & relevant files | No (defaults to generic) |
| `.adw/conditional_docs.md` | Conditional documentation paths | No (no conditionals) |

**Default commands** (when `.adw/commands.md` is absent):
- Install: `npm install`
- Lint: `npm run lint`
- Type check: `npx tsc --noEmit`
- Tests: `npm test`
- Build: `npm run build`
- Dev server: `npm run dev`
- E2E: `npx playwright test`

## Testing

```bash
# Run project config unit tests
npm test -- --run adws/__tests__/projectConfig.test.ts

# Run all ADW tests (includes updated slash command model map tests)
npm test -- --run adws/__tests__

# Run full validation suite
npm run lint && npm run build && npm test
```

The `projectConfig.test.ts` test suite covers:
- Loading config from a valid `.adw/` directory with all three files
- Loading config with missing `.adw/` directory (returns defaults)
- Loading config with partial files (missing files get default values)
- `parseMarkdownSections()` with various heading formats
- `parseCommandsMd()` heading-to-key mapping
- Edge cases: empty files, missing sections

## Notes

- **Backward compatibility**: The highest priority constraint. Repositories without `.adw/` continue to work exactly as before.
- **Incremental adoption**: Repos can start with just `commands.md` to override build commands, then add `project.md` and `conditional_docs.md` later.
- **No agent-level changes**: The slash command templates are the primary injection point. Agents don't require changes because they invoke slash commands in the target repo's working directory where `.adw/` is available to Claude.
- **`adwInit.tsx` is intentionally simple**: It only needs to run a single slash command, commit the results, and report success — no plan/build/test/review phases needed.
