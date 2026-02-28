# Initialize ADW Project Configuration

Analyze the current working directory's codebase and generate the `.adw/` configuration directory with project-specific configuration files.

## Variables
issueNumber: $1 — MUST be a numeric GitHub issue number (e.g., 31, 456). Default: 0
adwId: $2 — MUST be the alphanumeric ADW workflow ID string (e.g., "init-adw-env-4qugib", "abc123"). Default: `adw-unknown`
issueJson: $3 — JSON string containing full issue details. Default: `{}`

IMPORTANT: $1 is ALWAYS the numeric issue number. $2 is ALWAYS the ADW ID string. Do NOT swap these values.
Example: if $1=31 and $2=init-adw-env-4qugib, the filename is `issue-31-adw-init-adw-env-4qugib-sdlc_planner-{descriptiveName}.md`

## Instructions

1. **Analyze the Project**
   - Check for project manifest files to determine the language, framework, and package manager:
     - `package.json` → Node.js/npm/yarn/pnpm
     - `Cargo.toml` → Rust/cargo
     - `requirements.txt` or `pyproject.toml` or `setup.py` → Python/pip
     - `go.mod` → Go
     - `pom.xml` or `build.gradle` → Java/Maven/Gradle
     - `Gemfile` → Ruby/bundler
     - `composer.json` → PHP/composer
   - If the repo is empty or has no manifest files, check if `issueJson` contains a project description and use it to determine the project type
   - Scan the directory structure to identify source directories, test directories, and configuration files
   - Read `README.md` if it exists for additional context

2. **Create `.adw/commands.md`**
   - Create the `.adw/` directory if it doesn't exist
   - Generate `.adw/commands.md` with the following sections, populated based on the detected project type:
     - `## Package Manager` — The package manager command (e.g., `npm`, `pip`, `cargo`)
     - `## Install Dependencies` — Command to install dependencies
     - `## Run Linter` — Command to run the linter
     - `## Type Check` — Command for type checking (if applicable, otherwise "N/A")
     - `## Run Tests` — Command to run the test suite
     - `## Run Build` — Command to build the project
     - `## Start Dev Server` — Command to start the dev server
     - `## Prepare App` — Multi-step preparation (install + start), use `{PORT}` as placeholder
     - `## Run E2E Tests` — Command for E2E tests (if applicable, otherwise "N/A")
     - `## Additional Type Checks` — Extra type checks (if applicable, otherwise "N/A")
     - `## Library Install Command` — Command to install a new library
     - `## Script Execution` — How to run project scripts

3. **Create `.adw/project.md`**
   - Generate `.adw/project.md` with the following sections:
     - `## Project Overview` — Brief description based on README and manifest files
     - `## Relevant Files` — List of key directories and files with descriptions, based on actual project structure
     - `## Framework Notes` — Framework-specific instructions for the ADW
     - `## Library Install Command` — How to add new libraries
     - `## Script Execution` — How to run project scripts

4. **Create `.adw/conditional_docs.md`**
   - Generate `.adw/conditional_docs.md` with conditional documentation entries based on the project structure
   - Include `README.md` with relevant conditions
   - Include any documentation directories found in the project
   - If the project has distinct modules or sub-packages, create conditions for each

5. **Report**
   - List all files created
   - Summarize the detected project type and key configuration choices
