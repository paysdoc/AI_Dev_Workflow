# Feature: Generalize ADW Project Configuration

## Metadata
issueNumber: `18`
adwId: `the-adw-is-too-speci-tf7slv`
issueJson: `{"number":18,"title":"The ADW is too specialized","body":"When working on applications in other repositories, the ADW makes assumptions about file structure, bash commands and architecture that may vary from project to project.\n\nIt would be better for the target project to provide the details. The details to be provided should look as follows:\n - a markdown file with a mapping of bash command placeholders to the actual implementations\n - a markdown file that explains the project structure and instructs the adw how to fill the relevant files for the bug, chore, feature and pr_review meta template prompts. \n- other items that need to be generalised can either be added to the two markdown files above or specified in one or more separate files. \n\nAll the files need to reside in a dedicated directory on the target repo. Creating the files can be facilitated by the ADW by providing a specialized ADW that creates them based on an analysis of the existing code base. If the repo is empty, the ADW accepts a prompt (e.g. issue content) that explains what type of project it is to become (language frameworks etc) and creates the markdown files based on industry standards. This ADW should be mapped to a classification type `/adw-init` in the adw classifier.\n\nThe following are issues that I found. They are not exhaustive:\n\n## bug, chore, feature, pr_review, prepare_app, start, test\nNumerous references to npm / npx need to be generified. The target app needs to provide the exact commands (could be python or bash or anything else).\n\n## bug, chore, feature, pr_review\nThe relevant Files section lists files to focus on. This list should be read in from the target repo:\n\"\nFocus on the following files:\n- `README.md` - Contains the project overview and instructions.\n- `guidelines/**` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.\n- `src/app/**` - Contains Next.js App Router pages, layouts, and route handlers.\n- `src/components/**` - Contains React components.\n- `src/lib/**` - Contains utility functions and shared logic.\n- `src/hooks/**` - Contains custom React hooks.\n- `src/styles/**` - Contains global styles and CSS modules.\n- `public/**` - Contains static assets.\n- `adws/**` - Contains the AI Developer Workflow (ADW) scripts.\n\"\n\n## conditional_docs\nThe entire conditianalization needs to be rethought. ADWs are not relevant in most repos. However, the application could be subdivided in other ways, e.g. src/client vs. src/server or various sub-modules in a monorepo. Therefore the target repo needs to define the entirety of the conditional docs.\n\n## prepare_app\nThe whole app preparation is app specific and has to come from the target repo.\n\nThis is a difficult change and must be thoroughly tested. Be very thorough and circumspect when planning a solution.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-25T14:45:47Z","comments":[{"author":"paysdoc","createdAt":"2026-02-25T20:05:08Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
The ADW system currently hardcodes assumptions about target project structure, build tools, and framework conventions throughout its slash command templates (`.claude/commands/*.md`). This includes npm/npx commands, Next.js/React-specific file paths, framework-specific terminology, and hardcoded validation/build/test commands. When the ADW processes issues for non-Next.js projects (Python, Go, monorepos, etc.), these assumptions produce incorrect plans and broken builds.

This feature introduces a **target repo project configuration system** where each target repository provides its own configuration in a dedicated `.adw/` directory. The ADW slash command templates are refactored to read from these config files at runtime, replacing all hardcoded project-specific assumptions with configurable placeholders. An `/adw-init` command is added to bootstrap these config files for new or existing repositories.

## User Story
As a developer using ADW on a non-Next.js project
I want ADW to read my project's specific commands, file structure, and conventions from configuration files in my repo
So that ADW generates correct plans, runs the right build/test commands, and understands my project architecture regardless of language or framework

## Problem Statement
The ADW slash command templates contain 150+ hardcoded references to npm/npx, Next.js, React, and specific file paths (`src/app/**`, `src/components/**`, etc.). When ADW processes issues for target repos that use different languages, package managers, or project structures, the generated plans contain incorrect commands and irrelevant file references. The conditional documentation system assumes ADW-specific modules rather than allowing the target project to define its own module boundaries. The `prepare_app.md` and `start.md` commands are entirely Next.js-specific.

## Solution Statement
Introduce a `.adw/` configuration directory convention in target repos with three configuration files:

1. **`.adw/commands.md`** — Maps command placeholders to actual implementations (e.g., `install_deps` → `npm install`, `run_tests` → `pytest`, `start_dev` → `npm run dev`)
2. **`.adw/project.md`** — Describes the project structure, relevant files for planning commands, and framework-specific context for the ADW to use when filling bug/chore/feature/pr_review templates
3. **`.adw/conditional_docs.md`** — Defines the target project's conditional documentation structure (module boundaries, documentation paths, and conditions)

The ADW slash command templates are refactored to include dynamic injection points that read from these config files. A new TypeScript module (`adws/core/projectConfig.ts`) provides functions to load and validate these configs at runtime, with sensible defaults when no `.adw/` directory exists (falling back to current hardcoded behavior for backward compatibility). A new `/adw_init` command and `adwInit.tsx` orchestrator bootstrap the `.adw/` directory by analyzing the target codebase.

## Relevant Files
Use these files to implement the feature:

### Slash Command Templates (to be refactored)
- `.claude/commands/feature.md` — Contains hardcoded npm commands, Next.js file paths, and React-specific terminology in Relevant Files, Validation Commands, and Instructions sections
- `.claude/commands/bug.md` — Same hardcoded patterns as feature.md
- `.claude/commands/chore.md` — Same hardcoded patterns plus `npx tsx` reference
- `.claude/commands/pr_review.md` — Same hardcoded patterns plus `npx tsx` reference
- `.claude/commands/test.md` — Hardcoded `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`, Next.js references throughout
- `.claude/commands/prepare_app.md` — Entirely hardcoded: `npm install` and `npx next dev --port PORT`
- `.claude/commands/start.md` — Entirely hardcoded: `npm run dev &`
- `.claude/commands/conditional_docs.md` — ADW-specific conditional documentation structure
- `.claude/commands/review.md` — References `prepare_app.md` which is hardcoded
- `.claude/commands/patch.md` — Contains hardcoded relevant files section (`app/server/**`, `app/client/**`, `scripts/**`)
- `.claude/commands/resolve_failed_e2e_test.md` — References hardcoded `http://localhost:3000`
- `.claude/commands/classify_adw.md` — Needs new `/adw_init` command added
- `.claude/commands/classify_issue.md` — No changes needed (issue-type classification is generic)

### ADW Core (runtime config loading)
- `adws/core/config.ts` — Central configuration; will import projectConfig
- `adws/core/issueTypes.ts` — Needs `/adw_init` added to `AdwSlashCommand` type and mappings
- `adws/core/issueClassifier.ts` — Needs to recognize `/adw_init` command

### ADW Agents (runtime integration)
- `adws/agents/planAgent.ts` — Plan agent formats args for slash commands; will inject project config
- `adws/agents/testAgent.ts` — Contains hardcoded `npx playwright test` and Playwright-specific E2E logic
- `adws/agents/claudeAgent.ts` — Core agent runner; may need to pass project config as context

### ADW Phases (worktree context)
- `adws/phases/workflowLifecycle.ts` — `initializeWorkflow()` resolves worktreePath; needs to load project config from target repo
- `adws/phases/planPhase.ts` — Passes worktreePath to plan agent
- `adws/phases/testPhase.ts` — Passes worktreePath to test agent
- `adws/phases/buildPhase.ts` — Passes worktreePath to build agent

### Documentation
- `adws/README.md` — Needs documentation for `.adw/` config system
- `README.md` — Needs documentation update

### Existing Tests (to extend)
- `adws/__tests__/targetRepoManager.test.ts` — Existing target repo tests to extend
- `adws/__tests__/targetRepoIntegration.test.ts` — Existing integration tests to extend
- `adws/__tests__/planAgent.test.ts` — Plan agent tests
- `adws/__tests__/testAgent.test.ts` — Test agent tests
- `adws/__tests__/issueClassifier.test.ts` — Classifier tests

### Conditional Documentation Reference
- `.claude/commands/conditional_docs.md` — Read to understand current conditional docs structure
- `adws/README.md` — Read when operating in `adws/` directory

### New Files
- `.adw/commands.md` — ADW's own project command config (ADW eats its own dog food)
- `.adw/project.md` — ADW's own project structure config
- `.adw/conditional_docs.md` — ADW's own conditional docs config
- `.claude/commands/adw_init.md` — New slash command template for `/adw_init`
- `adws/core/projectConfig.ts` — New module: loads and validates `.adw/` config from target repos
- `adws/adwInit.tsx` — New orchestrator: bootstraps `.adw/` directory in target repos
- `adws/__tests__/projectConfig.test.ts` — Unit tests for projectConfig module

## Implementation Plan
### Phase 1: Foundation — Project Config Schema & Loader
Define the `.adw/` configuration file format and create the TypeScript module that loads, validates, and provides defaults for project configuration. This is the foundation everything else depends on.

Key decisions:
- Config files are markdown for human readability and easy editing
- The loader reads from `<target-repo>/.adw/` directory
- When `.adw/` doesn't exist, the loader returns a default config that matches current hardcoded behavior (backward compatible)
- The project config is loaded once per workflow run in `initializeWorkflow()` and passed through `WorkflowConfig`

### Phase 2: Core Implementation — Refactor Slash Command Templates
Refactor all affected `.claude/commands/*.md` files to use dynamic injection from the project config. The key mechanism:
- Each slash command template includes a new section header or instruction that tells Claude to read the `.adw/commands.md`, `.adw/project.md`, or `.adw/conditional_docs.md` from the target repo's working directory
- The `## Relevant Files` sections are replaced with instructions to read from `.adw/project.md`
- The `## Validation Commands` sections are replaced with instructions to read from `.adw/commands.md`
- The `prepare_app.md` and `start.md` commands are replaced with instructions to read from `.adw/commands.md`
- The `conditional_docs.md` is replaced with instructions to read from `.adw/conditional_docs.md`

### Phase 3: Integration — `/adw_init` Command, Orchestrator, and Self-Configuration
- Create the `/adw_init` slash command and `adwInit.tsx` orchestrator
- Add `/adw_init` to the ADW classifier and type system
- Create ADW's own `.adw/` config files (ADW eats its own dog food)
- Wire project config loading into `WorkflowConfig` and agent invocations
- Update documentation

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Define the `.adw/` Configuration File Schemas
- Create `.adw/commands.md` format specification with sections for:
  - `## Package Manager` — e.g., `npm`, `pip`, `cargo`
  - `## Install Dependencies` — e.g., `npm install`, `pip install -r requirements.txt`
  - `## Run Linter` — e.g., `npm run lint`, `ruff check .`
  - `## Type Check` — e.g., `npx tsc --noEmit`, `mypy .`
  - `## Run Tests` — e.g., `npm test`, `pytest`
  - `## Run Build` — e.g., `npm run build`, `cargo build`
  - `## Start Dev Server` — e.g., `npm run dev`, `python manage.py runserver`
  - `## Prepare App` — Multi-step preparation instructions
  - `## Run E2E Tests` — e.g., `npx playwright test`, `cypress run`
  - `## Additional Type Checks` — e.g., `npx tsc --noEmit -p adws/tsconfig.json` (project-specific extra checks)
- Create `.adw/project.md` format specification with sections for:
  - `## Project Overview` — Brief description of the project, language, framework
  - `## Relevant Files` — The file paths and descriptions for bug/chore/feature/pr_review templates
  - `## Framework Notes` — Framework-specific instructions for the ADW (e.g., "This is a Next.js App Router project, use server components by default")
  - `## Library Install Command` — What to use when a new library is needed (e.g., `npm install`, `pip install`)
  - `## Script Execution` — How to run project scripts (e.g., `npx tsx <script>`, `python <script>`)
- Create `.adw/conditional_docs.md` format specification — Same structure as current `.claude/commands/conditional_docs.md` but defined by the target repo

### Step 2: Create `adws/core/projectConfig.ts` — Config Loader Module
- Create a new TypeScript module at `adws/core/projectConfig.ts`
- Define `ProjectConfig` interface with typed fields for all config sections
- Implement `loadProjectConfig(targetRepoPath: string): ProjectConfig` function:
  - Check for `.adw/` directory at `targetRepoPath/.adw/`
  - Parse `.adw/commands.md` — extract command values from markdown sections (use heading-based parsing)
  - Parse `.adw/project.md` — extract relevant files list, framework notes, overview
  - Parse `.adw/conditional_docs.md` — extract conditional documentation entries
  - Return defaults matching current hardcoded values when files don't exist
- Implement `getDefaultProjectConfig(): ProjectConfig` — returns the backward-compatible defaults
- Export the `ProjectConfig` type and loader functions
- Add `projectConfig` export from `adws/core/index.ts`

### Step 3: Write Unit Tests for `projectConfig.ts`
- Create `adws/__tests__/projectConfig.test.ts`
- Test cases:
  - Loading config from a valid `.adw/` directory with all three files
  - Loading config with missing `.adw/` directory (returns defaults)
  - Loading config with partial files (missing files get default values)
  - Parsing `.adw/commands.md` with various heading formats
  - Parsing `.adw/project.md` with various relevant file formats
  - Parsing `.adw/conditional_docs.md` with various entry formats
  - Edge cases: empty files, malformed markdown, missing sections
- Run tests: `npm test -- --run adws/__tests__/projectConfig.test.ts`

### Step 4: Wire Project Config into `WorkflowConfig` and `initializeWorkflow()`
- In `adws/phases/workflowLifecycle.ts`:
  - Add `projectConfig: ProjectConfig` to the `WorkflowConfig` interface
  - In `initializeWorkflow()`, after resolving `worktreePath`, call `loadProjectConfig(worktreePath)` to load the target repo's config
  - Store the loaded config in the returned `WorkflowConfig` object
- Update the `WorkflowConfig` type export if needed

### Step 5: Create ADW's Own `.adw/` Config Files (Self-Configuration)
- Create `.adw/commands.md` for the ADW project itself:
  - Install Dependencies: `npm install`
  - Run Linter: `npm run lint`
  - Type Check: `npx tsc --noEmit`
  - Additional Type Checks: `npx tsc --noEmit -p adws/tsconfig.json`
  - Run Tests: `npm test`
  - Run Build: `npm run build`
  - Start Dev Server: `npm run dev`
  - Prepare App: `npm install && npx next dev --port {PORT}`
  - Run E2E Tests: `npx playwright test`
  - Package Manager: `npm`
  - Library Install: `npm install`
  - Script Execution: `npx tsx`
- Create `.adw/project.md` for the ADW project itself:
  - Project Overview: ADW is a TypeScript/Node.js project using Claude Code CLI
  - Relevant Files: Current list from feature.md (README.md, guidelines/**, src/app/**, src/components/**, etc.)
  - Framework Notes: Next.js App Router, React, TypeScript
  - Library Install Command: `npm install`
  - Script Execution: `npx tsx <script_name>`
- Create `.adw/conditional_docs.md` for the ADW project itself:
  - Copy current content from `.claude/commands/conditional_docs.md`

### Step 6: Refactor `.claude/commands/feature.md`
- Replace the hardcoded `## Relevant Files` section with:
  ```
  ## Relevant Files

  Read `.adw/project.md` from the current working directory to determine the relevant files for this project. If `.adw/project.md` does not exist, use these defaults:
  - `README.md` - Contains the project overview and instructions.
  - `guidelines/**` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.
  - `adws/**` - Contains the AI Developer Workflow (ADW) scripts.
  ```
- Replace the hardcoded `npm install` instruction with: "Read `.adw/commands.md` for the library install command. If `.adw/commands.md` does not exist, use `npm install`."
- Replace the hardcoded validation commands with instructions to read from `.adw/commands.md`:
  ```
  Read `.adw/commands.md` from the current working directory for the project-specific validation commands. If `.adw/commands.md` does not exist, use these defaults:
  - `npm run lint` - Run linter
  - `npm run build` - Build the application
  - `npm test` - Run tests
  ```
- Replace the instruction to read `.claude/commands/conditional_docs.md` with: "Read `.adw/conditional_docs.md` from the current working directory. If it does not exist, read `.claude/commands/conditional_docs.md` as a fallback."

### Step 7: Refactor `.claude/commands/bug.md`
- Apply the same refactoring pattern as feature.md (Step 6)
- Replace hardcoded `## Relevant Files`, `npm install`, and `## Validation Commands` sections
- Replace conditional docs reference

### Step 8: Refactor `.claude/commands/chore.md`
- Apply the same refactoring pattern as feature.md (Step 6)
- Replace hardcoded `## Relevant Files`, and `## Validation Commands` sections
- Replace the hardcoded `npx tsx <script_name>` reference with instruction to read from `.adw/commands.md` (Script Execution section)
- Replace conditional docs reference

### Step 9: Refactor `.claude/commands/pr_review.md`
- Apply the same refactoring pattern as feature.md (Step 6)
- Replace hardcoded `## Relevant Files`, and `## Validation Commands` sections
- Replace the hardcoded `npx tsx <script_name>` reference
- Replace conditional docs reference

### Step 10: Refactor `.claude/commands/test.md`
- Replace all hardcoded test commands with instructions to read from `.adw/commands.md`:
  - `npm run lint` → read `## Run Linter` from `.adw/commands.md`
  - `npx tsc --noEmit` → read `## Type Check` from `.adw/commands.md`
  - `npx tsc --noEmit -p adws/tsconfig.json` → read `## Additional Type Checks` from `.adw/commands.md`
  - `npm test -- --run adws/__tests__` → read `## Run Tests` from `.adw/commands.md` (with ADW test subset)
  - `npm run build` → read `## Run Build` from `.adw/commands.md`
  - `npm test -- --run src` → read `## Run Tests` from `.adw/commands.md` (with app test subset)
- Remove "Next.js" references from test_purpose descriptions, replace with generic descriptions
- Add instruction: "Read `.adw/commands.md` from the current working directory for all project-specific commands. If `.adw/commands.md` does not exist, use these defaults:" followed by current hardcoded commands

### Step 11: Refactor `.claude/commands/prepare_app.md`
- Replace entire hardcoded content with:
  ```
  # Prepare Application

  Prepare the application for review by installing dependencies and starting the dev server.

  ## Variables
  PORT: $1 if provided, otherwise use 3000

  ## Instructions
  Read `.adw/commands.md` from the current working directory for project-specific preparation steps.

  If `.adw/commands.md` exists, execute the commands listed under `## Prepare App`, substituting `{PORT}` with the PORT variable.

  If `.adw/commands.md` does not exist, use these defaults:
  1. Run `npm install` to install dependencies
  2. Start the dev server in the background with `npx next dev --port PORT`
  3. Wait for the server to be ready on `http://localhost:PORT`
  ```

### Step 12: Refactor `.claude/commands/start.md`
- Replace entire hardcoded content with instructions to read from `.adw/commands.md`:
  ```
  # Start the application

  ## Variables
  PORT: $1 if provided, otherwise 3000

  ## Workflow
  Check to see if a process is already running on port PORT.
  If it is just open it in the browser with `open http://localhost:PORT`.

  If there is no process running on port PORT:
  Read `.adw/commands.md` from the current working directory for the dev server start command.

  If `.adw/commands.md` exists, use the command under `## Start Dev Server`, substituting `{PORT}` if needed.
  If `.adw/commands.md` does not exist, use: `npm run dev &`

  Run `sleep 3`
  Run `open http://localhost:PORT`

  Let the user know that the application is running and the browser is open.
  ```

### Step 13: Refactor `.claude/commands/conditional_docs.md`
- Replace the entire file with instructions to read from `.adw/conditional_docs.md`:
  ```
  # Conditional Documentation Guide

  This prompt helps you determine what documentation you should read based on the specific changes you need to make in the codebase.

  ## Instructions
  - Read `.adw/conditional_docs.md` from the current working directory for project-specific conditional documentation
  - If `.adw/conditional_docs.md` does not exist, there are no conditional documentation requirements for this project
  - Review the task you've been asked to perform
  - Check each documentation path in the conditional documentation
  - For each path, evaluate if any of the listed conditions apply to your task
  - IMPORTANT: Only read the documentation if any one of the conditions match your task
  - IMPORTANT: You don't want to excessively read documentation. Only read the documentation if it's relevant to your task.
  ```

### Step 14: Refactor `.claude/commands/patch.md`
- Replace the hardcoded `## Relevant Files` section with instructions to read from `.adw/project.md`:
  ```
  ## Relevant Files

  Read `.adw/project.md` from the current working directory to determine the relevant files for this project. If `.adw/project.md` does not exist, use these defaults:
  - `README.md` - Contains the project overview and instructions.
  - `adws/**` - Contains the AI Developer Workflow (ADW) scripts.
  ```
- Replace conditional docs reference

### Step 15: Refactor `.claude/commands/resolve_failed_e2e_test.md`
- Replace hardcoded `http://localhost:3000` with: "If `applicationUrl` is present in the JSON, use that URL. Otherwise, read `.adw/commands.md` for the default dev server URL, falling back to `http://localhost:3000`."

### Step 16: Add `/adw_init` to Type System and Classifier
- In `adws/core/issueTypes.ts`:
  - Add `'/adw_init'` to the `AdwSlashCommand` union type
  - Add `'/adw_init': '/chore'` to `adwCommandToIssueTypeMap`
  - Add `'/adw_init': 'adws/adwInit.tsx'` to `adwCommandToOrchestratorMap`
  - Add `'/adw_init'` to the `SlashCommand` union type
- In `adws/core/config.ts`:
  - Add `'/adw_init': 'sonnet'` to `SLASH_COMMAND_MODEL_MAP`
  - Add `'/adw_init': 'haiku'` to `SLASH_COMMAND_MODEL_MAP_FAST`
- In `.claude/commands/classify_adw.md`:
  - Add `/adw_init` to the list of valid ADW commands with description: "Initialize project configuration"

### Step 17: Create `.claude/commands/adw_init.md` — Init Slash Command
- Create the slash command template that:
  - Analyzes the current working directory's codebase structure
  - Detects the language, framework, package manager, and project conventions
  - If the repo has code: analyzes `package.json`, `Cargo.toml`, `requirements.txt`, `go.mod`, etc.
  - If the repo is empty: uses the issue body / prompt to determine the project type
  - Generates `.adw/commands.md`, `.adw/project.md`, and `.adw/conditional_docs.md`
  - Follows the schemas defined in Step 1
  - Reports the created files

### Step 18: Create `adws/adwInit.tsx` — Init Orchestrator
- Create a new orchestrator script following the pattern of existing orchestrators (e.g., `adwPlan.tsx`)
- The orchestrator:
  - Parses CLI arguments (issue number, target repo args)
  - Calls `initializeWorkflow()` with the target repo
  - Runs the `/adw_init` slash command via `runClaudeAgentWithCommand()`
  - Commits the generated `.adw/` files
  - Reports success

### Step 19: Update Existing Tests
- Update `adws/__tests__/issueClassifier.test.ts` to cover `/adw_init` classification
- Update `adws/__tests__/planAgent.test.ts` if plan agent interface changes
- Update `adws/__tests__/testAgent.test.ts` if test agent interface changes
- Update `adws/__tests__/slashCommandModelMap.test.ts` to include `/adw_init` model mapping
- Run all existing tests to ensure no regressions: `npm test -- --run adws/__tests__`

### Step 20: Update Documentation
- Update `adws/README.md`:
  - Add section on `.adw/` project configuration
  - Document the three config files and their formats
  - Document the `/adw_init` command and `adwInit.tsx` orchestrator
  - Add examples for different project types (Node.js, Python, Go, Rust)
- Update `README.md`:
  - Add `.adw/` directory to project structure
  - Mention project configuration in the setup section
  - Add `adwInit.tsx` to the orchestrators list

### Step 21: Run Validation Commands
- `npm run lint` — Run linter to check for code quality issues
- `npm run build` — Build the application to verify no build errors
- `npm test` — Run tests to validate the feature works with zero regressions
- Manually verify: read the ADW's own `.adw/commands.md`, `.adw/project.md`, and `.adw/conditional_docs.md` to confirm they match the current hardcoded values
- Manually verify: read each refactored `.claude/commands/*.md` file to confirm the dynamic injection instructions are correct and fallback defaults match the previous hardcoded values

## Testing Strategy
### Unit Tests
- `adws/__tests__/projectConfig.test.ts` — Tests for the new `projectConfig.ts` module:
  - `loadProjectConfig()` with valid `.adw/` directory
  - `loadProjectConfig()` with missing `.adw/` directory (returns defaults)
  - `loadProjectConfig()` with partial config files
  - Markdown heading-based parsing of commands.md sections
  - Markdown parsing of project.md relevant files
  - Markdown parsing of conditional_docs.md entries
  - `getDefaultProjectConfig()` returns expected defaults
- `adws/__tests__/issueClassifier.test.ts` — Extended to cover `/adw_init` routing
- `adws/__tests__/slashCommandModelMap.test.ts` — Extended to verify `/adw_init` model assignment

### Edge Cases
- Target repo with no `.adw/` directory → falls back to hardcoded defaults (backward compatible)
- Target repo with partial `.adw/` directory (e.g., only `commands.md`) → uses provided configs, defaults for missing
- Target repo with empty `.adw/` files → uses defaults for all values
- Target repo with malformed markdown in `.adw/` files → graceful degradation to defaults
- ADW running on its own repo → reads its own `.adw/` config (self-referential test)
- `/adw_init` on an empty repo with issue body describing the project type
- `/adw_init` on an existing repo with existing `.adw/` directory (should overwrite or merge)
- Commands.md with custom heading names not matching expected sections → graceful handling

## Acceptance Criteria
1. All `.claude/commands/*.md` templates read project-specific config from `.adw/` directory when present
2. When `.adw/` directory is absent, all templates fall back to current hardcoded behavior (100% backward compatible)
3. ADW's own `.adw/` config files exist and match current hardcoded values
4. `/adw_init` command can bootstrap `.adw/` config for an existing codebase
5. `/adw_init` command can bootstrap `.adw/` config for an empty repo given a project description
6. `projectConfig.ts` module loads, validates, and provides defaults correctly
7. All existing tests pass with zero regressions
8. `npm run lint`, `npm run build`, and `npm test` all pass cleanly
9. The three `.adw/` config files cover all previously hardcoded project-specific assumptions
10. Documentation is updated to describe the new configuration system

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npm run build` — Build the application to verify no build errors
- `npm test` — Run tests to validate the feature works with zero regressions
- `npm test -- --run adws/__tests__/projectConfig.test.ts` — Run project config unit tests specifically
- `npm test -- --run adws/__tests__/issueClassifier.test.ts` — Verify classifier handles `/adw_init`
- `npm test -- --run adws/__tests__/slashCommandModelMap.test.ts` — Verify model map includes `/adw_init`
- Verify `.adw/commands.md` exists and contains all required command sections
- Verify `.adw/project.md` exists and contains relevant files matching current feature.md
- Verify `.adw/conditional_docs.md` exists and matches current conditional_docs.md content
- Verify each refactored `.claude/commands/*.md` file contains the dynamic injection instruction pattern and correct fallback defaults

## Notes
- **Backward Compatibility**: This is the highest priority constraint. When `.adw/` does not exist in the target repo, behavior must be identical to the current system. This means every dynamic injection point must include fallback defaults that match the current hardcoded values.
- **Markdown as Config Format**: The config files use markdown rather than JSON/YAML because: (1) they are read by Claude agents as context, so human-readable format is optimal; (2) they can include rich instructions and examples; (3) they're easy for developers to edit without tooling.
- **No Runtime Changes to Agent Invocation**: The slash command templates are the primary injection point. The agents themselves don't need major changes because they invoke slash commands in the target repo's working directory, where `.adw/` files will be available to Claude.
- **Self-Configuration**: The ADW project should use its own `.adw/` config system. This serves as both a test and a reference implementation.
- **Incremental Adoption**: Target repos can adopt the `.adw/` config incrementally. Missing files use defaults. Repos can start with just `commands.md` to customize build commands, then add `project.md` and `conditional_docs.md` later.
- **The `adwInit.tsx` orchestrator** is simpler than other orchestrators because it only needs to run a single slash command, commit the results, and report success. It doesn't need plan/build/test/review phases.
- **The `testAgent.ts` hardcoded `npx playwright test`** is addressed by the `/test` slash command reading from `.adw/commands.md`. The TypeScript `runPlaywrightE2ETests()` function will continue to work for projects that use Playwright. For non-Playwright projects, E2E testing is handled by the `/test` slash command template which reads the correct command from `.adw/commands.md`.
