# Chore: Define BDD scenario configuration in .adw/ and establish tagging conventions

## Metadata
issueNumber: `164`
adwId: `2ft5i1-define-bdd-scenario`
issueJson: `{"number":164,"title":"Define BDD scenario configuration in .adw/ and establish tagging conventions","body":"## Context\n\nThe ADW testing strategy is being revamped to make BDD/scenario testing the primary validation mechanism, replacing unit tests and code-diff review proof. This issue defines the configuration format and conventions that all subsequent features depend on.\n\n## Requirements\n\n### New file: \\`.adw/scenarios.md\\`\n\n- \\`## Scenario Directory\\` — relative path in the target repo where scenario files live (e.g. \\`features/\\`, \\`tests/e2e/\\`)\n- \\`## Run Scenarios by Tag\\` — tool-specific command to run scenarios by tag (e.g. \\`bunx playwright test --grep \"@{tag}\"\\` or \\`cucumber-js --tags \"@{tag}\"\\`)\n- \\`## Run Crucial Scenarios\\` — command to run all \\`@crucial\\`-tagged scenarios\n\n### Additions to \\`.adw/commands.md\\`\n\n- \\`## Run Scenarios by Tag\\` — same as above (used by workflow phase commands)\n- \\`## Run Crucial Scenarios\\` — same as above\n\n### Scenario file format\n\nThe file format is **not prescribed here** — it is determined by the tool specified in \\`## Run E2E Tests\\` in \\`commands.md\\`:\n\n- If \\`## Run E2E Tests\\` contains a real CLI command (e.g. \\`bunx playwright test\\`, \\`cucumber-js\\`) → scenario files match whatever that tool expects (e.g. \\`.spec.ts\\`, \\`.feature\\`)\n- If \\`## Run E2E Tests\\` is \\`n/a\\` or absent → default to Gherkin \\`.feature\\` files; a Cucumber setup will be bootstrapped by the Scenario Planner Agent (see dependent issue)\n\n### Tagging conventions\n\n- \\`@adw-{issueNumber}\\` — marks scenarios created, modified, or flagged as relevant for a specific GitHub issue\n- \\`@crucial\\` — marks scenarios that form the regression safety net; maintained over time by the Scenario Planner Agent\n\n### ADW project configuration\n\n- Create ADW's own \\`.adw/scenarios.md\\` as a reference implementation\n- Document tagging conventions and the format-resolution logic in \\`adws/README.md\\`\n\n## Acceptance Criteria\n\n- \\`.adw/scenarios.md\\` format is specified with examples for both the Playwright and Cucumber cases\n- \\`commands.md\\` additions are documented\n- Tagging conventions are documented in \\`adws/README.md\\`\n- ADW's own \\`.adw/scenarios.md\\` exists\n- The \\`## Run E2E Tests\\` → file format resolution logic is documented","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-13T07:01:21Z","comments":[],"actionableComment":null}`

## Chore Description
This chore defines the BDD scenario configuration format for `.adw/scenarios.md` and establishes tagging conventions used across ADW-managed target repositories. The configuration allows target repos to specify where scenario files live, how to run scenarios by tag, and how to run crucial regression scenarios. It also adds corresponding command sections to `.adw/commands.md` and documents the tagging conventions and file format resolution logic in `adws/README.md`. ADW's own `.adw/scenarios.md` is created as a reference implementation.

## Relevant Files
Use these files to resolve the chore:

- `.adw/commands.md` — Existing command configuration file; needs two new sections (`## Run Scenarios by Tag`, `## Run Crucial Scenarios`) appended.
- `adws/README.md` — Primary ADW documentation; needs tagging conventions, `.adw/scenarios.md` format specification with examples, and the `## Run E2E Tests` → file format resolution logic added to the `.adw/` configuration section.
- `adws/core/projectConfig.ts` — Project configuration loader; needs to load `scenarios.md` and expose it on `ProjectConfig` (consistent with how `review_proof.md` is loaded).
- `adws/core/__tests__/projectConfig.test.ts` — Tests for `projectConfig.ts`; needs test coverage for `scenariosMd` loading.
- `README.md` — Root project overview; needs `scenarios.md` added to the `.adw/` directory listing in the Project Structure section.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md` — Reference doc for `.adw/` configuration system conventions.

### New Files
- `.adw/scenarios.md` — ADW's own BDD scenario configuration (reference implementation). Since ADW's `.adw/commands.md` specifies `## Run E2E Tests` as `bunx playwright test`, this file will use Playwright conventions.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `.adw/scenarios.md` (ADW's reference implementation)

- Create the file `.adw/scenarios.md` with the following sections:
  - `## Scenario Directory` — set to `tests/e2e/` (ADW's Playwright test location)
  - `## Run Scenarios by Tag` — set to `bunx playwright test --grep "@{tag}"` (matches ADW's Playwright setup per `## Run E2E Tests` in `commands.md`)
  - `## Run Crucial Scenarios` — set to `bunx playwright test --grep "@crucial"`
- Keep the file concise, following the same minimal markdown format used by other `.adw/*.md` files (e.g., `review_proof.md`, `commands.md`).

### Step 2: Add scenario command sections to `.adw/commands.md`

- Append two new sections to the end of `.adw/commands.md`:
  - `## Run Scenarios by Tag` — `bunx playwright test --grep "@{tag}"`
  - `## Run Crucial Scenarios` — `bunx playwright test --grep "@crucial"`
- These sections mirror the values in `.adw/scenarios.md` and are used by workflow phase commands that read from `commands.md`.

### Step 3: Update `adws/core/projectConfig.ts` to load `scenarios.md`

- Add `scenariosMd: string` field to the `ProjectConfig` interface (following the same pattern as `reviewProofMd`).
- Add `scenariosMd: ''` to the `getDefaultProjectConfig()` function.
- In `loadProjectConfig()`, add a block to read `.adw/scenarios.md` (following the same try/catch pattern used for `review_proof.md`):
  ```typescript
  // scenarios.md
  const scenariosPath = path.join(adwDir, 'scenarios.md');
  let scenariosMd = '';
  try {
    scenariosMd = fs.readFileSync(scenariosPath, 'utf-8');
  } catch {
    // file missing — keep empty
  }
  ```
- Add `scenariosMd` to the return object of `loadProjectConfig()`.
- Update the module-level JSDoc comment at the top to mention `scenarios.md` alongside the other `.adw/` files.

### Step 4: Update `adws/core/__tests__/projectConfig.test.ts`

- Add test cases for `scenariosMd` loading:
  - When `.adw/scenarios.md` exists: verify the raw content is loaded into `scenariosMd`.
  - When `.adw/scenarios.md` is missing: verify `scenariosMd` defaults to `''`.
  - When `.adw/` directory is absent: verify `scenariosMd` defaults to `''` via `getDefaultProjectConfig()`.
- Follow the existing test patterns (e.g., how `reviewProofMd` is tested).

### Step 5: Update `adws/README.md` — document `.adw/scenarios.md` format and conventions

- In the **Configuration Files** list under `### Project Configuration (.adw/ Directory)`, add a new bullet for `.adw/scenarios.md`:
  ```
  - **`.adw/scenarios.md`** — BDD scenario configuration:
    - `## Scenario Directory` — relative path where scenario files live (e.g., `features/`, `tests/e2e/`)
    - `## Run Scenarios by Tag` — command to run scenarios by tag, with `{tag}` placeholder (e.g., `bunx playwright test --grep "@{tag}"`, `cucumber-js --tags "@{tag}"`)
    - `## Run Crucial Scenarios` — command to run all `@crucial`-tagged scenarios
  ```
- Add the two new headings (`## Run Scenarios by Tag`, `## Run Crucial Scenarios`) to the `.adw/commands.md` section bullets in the same Configuration Files list.
- Add a new subsection **Scenario Tagging Conventions** (after the existing Runtime Loading subsection) documenting:
  - `@adw-{issueNumber}` — marks scenarios created, modified, or flagged as relevant for a specific GitHub issue
  - `@crucial` — marks scenarios that form the regression safety net; maintained over time by the Scenario Planner Agent
- Add a new subsection **Scenario File Format Resolution** (after Scenario Tagging Conventions) documenting:
  - If `## Run E2E Tests` in `.adw/commands.md` contains a real CLI command (e.g., `bunx playwright test`, `cucumber-js`) → scenario files match whatever that tool expects (`.spec.ts` for Playwright, `.feature` for Cucumber)
  - If `## Run E2E Tests` is `n/a` or absent → default to Gherkin `.feature` files; a Cucumber setup will be bootstrapped by the Scenario Planner Agent
- Add examples for both the Playwright and Cucumber cases:

  **Playwright example** (`.adw/scenarios.md`):
  ```markdown
  ## Scenario Directory
  tests/e2e/

  ## Run Scenarios by Tag
  bunx playwright test --grep "@{tag}"

  ## Run Crucial Scenarios
  bunx playwright test --grep "@crucial"
  ```

  **Cucumber example** (`.adw/scenarios.md`):
  ```markdown
  ## Scenario Directory
  features/

  ## Run Scenarios by Tag
  cucumber-js --tags "@{tag}"

  ## Run Crucial Scenarios
  cucumber-js --tags "@crucial"
  ```

### Step 6: Update `README.md` project structure

- In the `.adw/` directory listing in the `## Project Structure` section, add `scenarios.md` with a brief description:
  ```
  ├── scenarios.md      # BDD scenario configuration and tagging
  ```
- Place it alphabetically among the existing `.adw/` entries.

### Step 7: Run validation commands

- Run all validation commands to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws subproject
- `bun run test` — Run all tests to validate zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- IMPORTANT: Follow the coding guidelines in `guidelines/coding_guidelines.md` — especially strict TypeScript types, meaningful names, and modularity.
- The `scenariosMd` field in `ProjectConfig` stores raw markdown content (same pattern as `reviewProofMd`). Parsing the sections from `scenarios.md` is deferred to a subsequent issue that implements the Scenario Planner Agent.
- The `{tag}` placeholder in `## Run Scenarios by Tag` is a convention — the consuming agent will replace `{tag}` with the actual tag value (e.g., `@adw-164` or `@crucial`) at runtime.
- The `## Run Scenarios by Tag` and `## Run Crucial Scenarios` sections appear in both `.adw/scenarios.md` (for scenario-specific context) and `.adw/commands.md` (for workflow phase commands that read from `commands.md`). This duplication is intentional — `scenarios.md` provides the full BDD context while `commands.md` is the single source for all executable commands.
