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

5. **Create `.adw/providers.md`**
   - Detect the code host from the git remote URL:
     - `github.com` → `github`
     - `gitlab.com` → `gitlab`
     - `bitbucket.org` → `bitbucket`
     - Unknown → `github` (default)
   - Extract the base URL from the remote (e.g., `https://github.com`)
   - Generate `.adw/providers.md` with the following sections:
     - `## Code Host` — The detected code host platform
     - `## Code Host URL` — The base URL extracted from the remote
     - `## Issue Tracker` — Same as code host (default assumption; user can change)
     - `## Issue Tracker URL` — Same as code host URL
     - `## Issue Tracker Project Key` — Empty (user fills in for Jira/Linear)

6. **Create `.adw/review_proof.md`**
   - Generate `.adw/review_proof.md` defining the proof requirements for the `/review` command
   - Analyze the project type detected in step 1 to determine appropriate proof requirements:
     - **Web/UI projects** (Next.js, React, Vue, Angular, Svelte, etc.): proof should include browser screenshots of key pages/components, test output summaries, visual regression checks, and dev server verification
     - **CLI/automation tools** (no UI): proof should include code-diff verification, test output summaries, type check and lint verification — do NOT include browser screenshots
     - **API projects** (Express, FastAPI, Django REST, etc.): proof should include API response validation (curl/httpie output), test output summaries, and endpoint verification
     - **Library/package projects**: proof should include test output summaries, type check verification, API compatibility checks, and export validation
   - Include the following sections in the generated file:
     - `# Review Proof Requirements` — Intro sentence explaining this file defines proof requirements for the project and that the `/review` command reads it
     - `## Proof Type` — State the project type and list the specific evidence to produce (numbered list), tailored to the detected project type
     - `## Proof Format` — How to structure proof in the review JSON output: `reviewSummary` for overview, `reviewIssues` for discrepancies, `screenshots` for proof artifact paths
     - `## Proof Attachment` — How proof gets attached to the PR via review JSON fields (`reviewSummary`, `screenshots`, `reviewIssues`)
     - `## What NOT to Do` — Actions to avoid based on the project type (e.g., CLI projects should not take browser screenshots; UI projects should not skip visual verification)

7. **Create `.adw/scenarios.md`**
   - Detect the E2E test tool from the `## Run E2E Tests` value determined in step 2
   - If **Playwright** detected (`bunx playwright test`, `npx playwright test`, etc.):
     - `## Scenario Directory` → `tests/e2e/` (or the detected test directory)
     - `## Run Scenarios by Tag` → `bunx playwright test --grep "@{tag}"`
     - `## Run Crucial Scenarios` → `bunx playwright test --grep "@crucial"`
   - If **Cypress** detected (`npx cypress run`, `cypress run`, etc.):
     - `## Scenario Directory` → `cypress/e2e/`
     - `## Run Scenarios by Tag` → `npx cypress run --spec "**/*{tag}*"`
     - `## Run Crucial Scenarios` → `npx cypress run --tag "@crucial"`
   - If **Cucumber** detected (`cucumber-js`, `@cucumber/cucumber`, etc.):
     - `## Scenario Directory` → `features/`
     - `## Run Scenarios by Tag` → `cucumber-js --tags "@{tag}"`
     - `## Run Crucial Scenarios` → `cucumber-js --tags "@crucial"`
   - If E2E is `N/A`, absent, or tool is unrecognized — default to Cucumber/Gherkin:
     - `## Scenario Directory` → `features/`
     - `## Run Scenarios by Tag` → `cucumber-js --tags "@{tag}"`
     - `## Run Crucial Scenarios` → `cucumber-js --tags "@crucial"`

8. **Report**
   - List all files created (`commands.md`, `project.md`, `conditional_docs.md`, `providers.md`, `review_proof.md`, `scenarios.md`)
   - Summarize the detected project type and key configuration choices
