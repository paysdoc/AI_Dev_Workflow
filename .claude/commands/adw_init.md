---
target: false
hashInputs:
  - .claude/commands/adw_init.md
  - .claude/commands/document.md
  - templates/vocabulary.md.template
  - templates/playwright/playwright.config.ts.template
  - templates/playwright/package.json.template
  - templates/playwright/gitignore.template
---
# Initialize ADW Project Configuration

Analyze the current working directory's codebase and generate the `.adw/` configuration directory with project-specific configuration files.

## Variables
issueNumber: $0 — MUST be a numeric GitHub issue number (e.g., 31, 456). Default: 0
adwId: $1 — MUST be the alphanumeric ADW workflow ID string (e.g., "init-adw-env-4qugib", "abc123"). Default: `adw-unknown`
issueJson: $2 — JSON string containing full issue details. Default: `{}`
frameworkRepoRoot: $3 — Absolute path to the ADW framework repository root. Used by step 6 to locate `templates/playwright/`, by step 7 to locate `templates/claude-settings-starter.json` and by step 8 to locate `templates/vocabulary.md.template`. Default: empty string (skip all three template copies if empty).

CRITICAL: $0 is ALWAYS the numeric issue number. $1 is ALWAYS the ADW ID string. $2 is ALWAYS the issue JSON string. $3 is ALWAYS the framework repo root path. Do NOT swap these values.
Example: if $0=31 and $1=init-adw-env-4qugib, the filename is `issue-31-adw-init-adw-env-4qugib-sdlc_planner-{descriptiveName}.md`

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
   - **Detect the application type.** It decides what evidence ADW's review needs, and ADW assumes no type, so decide only from what the project shows:
     - `web`: the application serves pages that a person opens in a browser. Signals: a web framework or front-end build in the manifest (for example Next.js, Nuxt, Remix, SvelteKit, Astro, Angular, Vue, React with Vite; Django, Flask or FastAPI serving templates; Rails, Laravel, Phoenix), or routes and templates that render HTML.
     - `cli`: the application has no browser user interface and is not a mobile app. Examples: a command-line tool (a `bin` entry, commander, yargs, oclif, click, typer, cobra, clap), a library, scripts or automation, or a service with an HTTP API and no pages.
     - Test tooling alone (Playwright, Cypress, Cucumber) does not decide the type.
     - Undecided: the signals conflict (for example a CLI and a separate browser UI, neither of them primary), there is nothing to go on (an empty repository whose issue describes no application), or the application is a mobile app, one that runs on Android or iOS: no signal decides the type of a mobile app, because only the repository's owner sets it. Do not guess, and never fall back to `cli`.

2. **Create `.adw/commands.md`**
   - Create the `.adw/` directory if it doesn't exist
   - Generate `.adw/commands.md` with the following sections, populated based on the detected project type:
     - `## Package Manager` — The package manager command (e.g., `npm`, `pip`, `cargo`)
     - `## Install Dependencies` — Command to install dependencies
     - `## Run Linter` — Command to run the linter
     - `## Type Check` — Command for type checking (if applicable, otherwise "N/A")
     - `## Run Tests` — Command to run the unit-test suite **and emit a JUnit report**:
       - **If `.adw/commands.md` already has a `## Run Tests` section, preserve it verbatim — never overwrite a custom command.** A repo whose pre-existing custom command does not emit a JUnit report will resolve to `unverified` (by design); it can be upgraded manually at any time.
         - For `mobile:kotlincm`, a section that holds no command but `N/A` is not a custom command: an earlier run wrote it while the repository had no manifest. Treat the section as absent, and drop the comment line that may stand beside the `N/A`.
       - **If the section is absent**, author a JUnit-emitting command per the detected language, referencing `$ADW_UNIT_TEST_REPORT_PATH`:
         - **`mobile:kotlincm`**, whatever the detected language and also when there is no manifest yet → `./gradlew test -x :scenarios:test --continue; exit_code=$?; { echo '<testsuites>'; find . -path ./scenarios -prune -o -path '*/build/test-results/*' -name 'TEST-*.xml' -exec sed 's/<?xml[^?]*?>//' {} +; echo '</testsuites>'; } > "$ADW_UNIT_TEST_REPORT_PATH"; exit $exit_code`, alone in the section and exactly as written. It runs the `test` task of every module except `:scenarios`, whose scenarios the scenario phase runs on the devices ADW boots, and gathers the per-class JUnit reports Gradle writes under each module's `build/test-results/` into the one file ADW reads.
         - **vitest** → `vitest run --reporter=default --reporter=junit --outputFile=$ADW_UNIT_TEST_REPORT_PATH`
         - **jest** → `jest --reporters=default --reporters=jest-junit` (requires `JEST_JUNIT_OUTPUT_FILE=$ADW_UNIT_TEST_REPORT_PATH` in env; note in comments)
         - **pytest** → `pytest --junitxml=$ADW_UNIT_TEST_REPORT_PATH`
         - **go / gotestsum** → `gotestsum --junitfile=$ADW_UNIT_TEST_REPORT_PATH`
         - **cargo nextest** → `cargo nextest run --profile ci` with a nextest profile that sets `junit.path = "$ADW_UNIT_TEST_REPORT_PATH"` (document the nextest config requirement)
         - **other / unknown** → use the idiomatic test command (e.g. `bun run test`) with a comment noting that JUnit emission is not configured; runs will resolve to `unverified` until the command is updated to emit a report to `$ADW_UNIT_TEST_REPORT_PATH`
     - `## Run Build` — Command to build the project
       - **`mobile:kotlincm`**, whatever the manifests show and also when there is none yet → `if [ -e gradlew ] || [ -e settings.gradle.kts ] || [ -e settings.gradle ]; then ./gradlew build -x test; else echo 'No Gradle build yet: nothing to build'; fi`, alone in the section and exactly as written. It runs Gradle's `build` without its `test` tasks, because the unit-test phase runs the unit tests and the scenario phase runs `:scenarios:test` on the devices ADW boots. Until the repository has a Gradle wrapper or settings file there is nothing to build, and the command passes: ADW checks the base branch before any work starts, and the base branch of the issue that bootstraps the repository holds no Gradle build yet.
     - `## Start Dev Server` — Determine the correct value from the application type step 3 writes (the type it preserves, or the one step 1 detects):
       - **`web`** → the framework's dev command with `{PORT}` substituted (e.g., `npm run dev -- --port {PORT}`, `bunx next dev --port {PORT}`, `python manage.py runserver 0.0.0.0:{PORT}`), whatever test runners the repository has. ADW starts and stops the server itself and hands its address to its own Playwright project, whose configuration has no `webServer` block. A `webServer` block in the repository's own e2e configuration is ignored.
       - **`cli`, `mobile:kotlincm`, or undecided** → `N/A`
       - Note: `{PORT}` is a substitution placeholder used at runtime by the dev server lifecycle helper to allocate dynamic ports for parallel workflows, avoiding port collisions between concurrent workflow runs
     - `## Health Check Path` — HTTP path the dev server health probe hits (default `/`). Can be overridden per target repo if `/` is slow or redirects to a login page.
     - `## Prepare App` — Multi-step preparation (install + start), use `{PORT}` as placeholder in any dev server start command
     - `## Additional Type Checks` — Extra type checks (if applicable, otherwise "N/A")
     - `## Library Install Command` — Command to install a new library
     - `## Script Execution` — How to run project scripts
     - `## Run Scenarios by Tag` — Command to run scenarios by tag, using `{tag}` placeholder (values determined by scenario tool detection in step 8)
     - `## Run Regression Scenarios` — Command to run all `@regression`-tagged scenarios (values determined by scenario tool detection in step 8)
     - `## Test Directory` — Root directory where the project's unit tests live. Detection rules:
       - If `tests/` exists at the repo root → `tests`
       - If `test/` exists at the repo root → `test`
       - If `src/` exists at the repo root → `src` (TypeScript / Bun convention)
       - Otherwise → `.` (run from repo root)
     - `## Test Framework` — Test framework detected in the dependency manifest (e.g., `pytest`, `vitest`, `jest`). Set to the detected framework name; leave empty when none detected. Examples:
       - `pytest` or `pytest-asyncio` in `pyproject.toml` / `requirements*.txt` → `pytest`
       - `vitest` in `package.json` devDependencies → `vitest`
       - `jest` in `package.json` devDependencies → `jest`
       - No test framework detected → leave empty
     - `## Suppression Patterns` — The repository owner's own additions to ADW's table of suppression patterns, one pattern per line. ADW's framework table always applies as well, and a line starting with `!` is ignored:
       - **If `.adw/commands.md` already has a `## Suppression Patterns` section, preserve it verbatim — never create, populate or reorder it.** Regenerating `.adw/` on a framework upgrade would otherwise drop the owner's additions.
       - **If the section is absent**, leave it out.
   - Note: the values for `## Run Scenarios by Tag` and `## Run Regression Scenarios` are the ones step 8 writes, and must be consistent with the scenario tool chosen there (ADW's Playwright project for `web`; the `:scenarios` Gradle module for `mobile:kotlincm`; Cypress, Cucumber or default Cucumber otherwise)

3. **Create `.adw/project.md`**
   - Generate `.adw/project.md` with the following sections:
     - `## Project Overview` — Brief description based on README and manifest files
     - `## Relevant Files` — List of key directories and files with descriptions, based on actual project structure
       - For `mobile:kotlincm`, include `.adw/scenarios.md`: its `## Scenario Run Contract` says what the repository's `:scenarios` Gradle module must do for ADW.
     - `## Framework Notes` — Framework-specific instructions for the ADW
     - `## Library Install Command` — How to add new libraries
     - `## Script Execution` — How to run project scripts
     - `## Application Type` — exactly one of `cli`, `web` or `mobile:kotlincm`, alone on its line. The last is never detected: only the repository's owner sets it, by hand.
       - If the existing `.adw/project.md` has `## Application Type` holding `cli`, `web` or `mobile:kotlincm`, preserve it verbatim. The owner may have set it by hand, and an upgrade must not drop it.
       - Otherwise write the type detected in step 1, `cli` or `web`.
       - If step 1 could not decide, leave the section out entirely: no default, no placeholder, no empty section. ADW then parks every issue with the `missing_application_type` comment until the section is added or `adw_init` is re-run.
     - `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` and `## iOS Runtime` — the device sources: what ADW creates each workflow's Android emulator and iOS simulator from. Write these four sections only when the `## Application Type` this step writes is `mobile:kotlincm`; for any other type, or none, leave them out.
       - If the existing `.adw/project.md` has the section and it holds a value, preserve the value verbatim. The owner may have chosen other images or devices, and an upgrade must not reset them.
       - Otherwise write the default, alone on its line:
         - `## Android System Image` → `system-images;android-36;google_apis;arm64-v8a` (an `sdkmanager` package path)
         - `## Android Device Profile` → `pixel_8` (an `avdmanager` device id)
         - `## iOS Device Type` → `com.apple.CoreSimulator.SimDeviceType.iPhone-16` (a `simctl` device type identifier)
         - `## iOS Runtime` → `com.apple.CoreSimulator.SimRuntime.iOS-26-0` (a `simctl` runtime identifier)
   - Do not add a section that enables or disables unit tests. The only unit-test switch is `unitTests` in `.github/adw.yml` (step 9). If the existing `.adw/project.md` has such a section, leave it out.

4. **Create `.adw/conditional_docs.md`**
   - If `.adw/conditional_docs.md` already exists and is not empty, leave it unchanged and skip the rest of this step. `/document` maintains it, and its `Owns:` and `Decisions:` blocks cannot be regenerated from the code.
   - Generate `.adw/conditional_docs.md` with conditional documentation entries based on the project structure
   - Include `README.md` with relevant conditions
   - Include any documentation directories found in the project
   - If the project has distinct modules or sub-packages, create conditions for each
   - For each entry, include an `Owns:` glob block listing the file globs the entry covers (e.g., `adws/vcs/**`). This makes future `/document` runs route convergently to the right entry instead of appending a duplicate.
   - The `Conditions:` lines must be **descriptive enough to support semantic routing**: name the module's responsibility in plain language (e.g., `When working on the VCS worktree management module`), not just a file path. `/document` routes by semantic match against this text when no glob matches the touched file.
   - New-format entry shape:
     ```md
     - app_docs/feature-xxx.md
       - Owns:
         - <glob covering the module's files>
       - Conditions:
         - When working on the <module name and responsibility description>
     ```

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

6. **Install ADW's Playwright project (`web` only)**
   - Skip this step when the application type written in step 3 is not `web`, and report `not applicable (<type>)` in step 11. If `$3` (`frameworkRepoRoot`) is empty (legacy invocation without framework repo root), skip it and log a warning in the step 11 report that this repository's scenarios cannot run — same convention as the vocabulary template copy in step 8.
   - The project is a self-contained Node project in `features/`, installed even when the application itself is not a Node application. It never touches the application's own package management.
   - Any e2e setup the repository already has elsewhere (its own Playwright, Cypress or Cucumber configuration, tests and dependencies) is left exactly as it is, and ADW does not use it.
   - Run the following via the Bash tool, from the repository root:
     ```bash
     mkdir -p features
     cp "$3/templates/playwright/playwright.config.ts.template" features/playwright.config.ts
     [ -f features/package.json ] || cp "$3/templates/playwright/package.json.template" features/package.json
     touch features/.gitignore
     [ -n "$(tail -c1 features/.gitignore)" ] && echo >> features/.gitignore
     while IFS= read -r line; do grep -qxF -- "$line" features/.gitignore || echo "$line" >> features/.gitignore; done < "$3/templates/playwright/gitignore.template"
     ```
   - The configuration is always copied over, even when the file exists and was edited: ADW owns `features/playwright.config.ts`, it is byte-identical in every web repository, and every upgrade restores it.
   - When `features/package.json` already existed, set its `devDependencies` versions of `@playwright/test` and `playwright-bdd` to the template's, and change nothing else in it.
   - Install the packages and the browser: `(cd features && npm install --no-audit --no-fund && npx playwright install chromium)`. The upgrade runs the same command again after this step. It writes `features/package-lock.json`: every ADW worktree installs from that lockfile with `npm ci`, so commit it together with `features/package.json`, `features/playwright.config.ts` and `features/.gitignore`. `features/.gitignore` keeps `node_modules/` and the generated tests (`.features-gen/`) out of git.
   - Never edit `features/playwright.config.ts` afterwards, never add a `webServer` block to it, and never convert or delete existing step definitions: the owner decides what to rewrite.

7. **Copy Starter Guardrails Settings**
   - If `$3` (`frameworkRepoRoot`) is non-empty and the target repo does NOT already have a `.claude/settings.json`, copy the canonical deny-only starter guardrails template verbatim so the repo owner's own interactive Claude Code sessions get a sensible deny list (recursive-force `rm`, force-push, `.env` secrets) without the owner having to author one from scratch:
     ```bash
     if [ -n "$3" ] && [ ! -f .claude/settings.json ]; then
       mkdir -p .claude
       cp "$3/templates/claude-settings-starter.json" .claude/settings.json
     fi
     ```
   - **Skip-if-exists is mandatory.** If `.claude/settings.json` already exists, do NOT read, merge into, or overwrite it — leave it byte-for-byte untouched. This is the same skip-if-exists rule the `adwUpgrade.tsx` upgrade-regen path applies via `decideStarterSettingsCopy` (issue #763); this step applies it here for a fresh `/adw_init` bootstrap that can run outside that TypeScript orchestrator (e.g. the manual `/adw_init` escape hatch documented in `README.md`).
   - **Never** add `.claude/settings.json` to `.gitignore`. Unlike the copied commands/skills, this file is the repo owner's to keep, edit, or delete, and must remain committable.
   - Append a `## Agent Guardrails` section to `.adw/project.md` (created in step 3) reflecting the outcome:
     - If copied: note that ADW copied a starter deny-only guardrail file into the repo during initialization (the owner's to edit or delete), that its `Read(!**/.env.sample)` / `Read(!**/.env.example)` negation carve-outs rely on UNDOCUMENTED Claude Code CLI precedence behavior, that the framework verifies this with `scripts/guardrails-probe.ts` (issue #762), and that the probe should be re-run after each Claude Code CLI upgrade to confirm the carve-outs still hold.
     - If skipped (a `.claude/settings.json` already existed): note that the repo already had its own `.claude/settings.json`, so ADW left it untouched and did not apply the starter guardrails template.
   - If `$3` is empty (legacy invocation without framework repo root), skip the copy and log a warning in the step 11 report — same convention as the vocabulary template copy in step 8.

8. **Create `.adw/scenarios.md`**
   - Detect the scenario tool from the project's test configuration
   - If the application type is **`web`**, whatever scenario tooling the repository has (ADW's Playwright project from step 6 runs the scenarios; the repository's own e2e setup is not used):
     - `## Scenario Directory` → `features/`
     - `## Run Scenarios by Tag` → `cd features && (test -d node_modules || npm ci) && npx bddgen && npx playwright test --grep "@{tag}\b"`
     - `## Run Regression Scenarios` → `cd features && (test -d node_modules || npm ci) && npx bddgen && npx playwright test --grep "@regression\b"`
     - `## BDD Framework` → `playwright-bdd`
     - `## Step Def Directory` → `features/steps`
   - If the application type is **`mobile:kotlincm`**, whatever scenario tooling the repository has, and also when it has no manifest yet (the repository's own `:scenarios` Gradle module runs the scenarios with cucumber-jvm, on the devices ADW boots for each workflow):
     - `## Scenario Directory` → `features/`
     - `## Run Scenarios by Tag` → `./gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@{tag}"`
     - `## Run Regression Scenarios` → `./gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@regression"`
     - `## BDD Framework` → `cucumber-jvm`
     - `## Step Def Directory` → `scenarios/src/test/kotlin`
     - `--rerun` keeps Gradle from skipping a run whose inputs did not change: every run has new devices and a new report path.
     - `## Scenario Run Contract` → the text below, verbatim. It is what ADW passes the run and what it reads back, so the repository's `:scenarios` module, its screenshot hook and its JUnit reporter keep to it:
       ```md
       ADW runs `## Run Scenarios by Tag` from the repository root, with `{tag}` replaced by the tag it runs, and gives the run these environment variables:

       - `ADW_JUNIT_REPORT_PATH`: the absolute path of the JUnit XML report the run writes.
       - `ADW_PROOF_DIR`: the absolute path of the directory the run writes its screenshots to.
       - `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`: the Android emulator and the iOS simulator ADW created and booted for this workflow, by the AVD's name, the emulator's `adb` serial and the simulator's UDID. The run drives these two devices and never creates, boots, shuts down or deletes one.

       The `:scenarios` Gradle module runs the `.feature` files under `features/` with cucumber-jvm and the Kotlin step definitions under `scenarios/src/test/kotlin`. Its `test` task hands the `cucumber.filter.tags` system property to cucumber-jvm, so that a run executes the scenarios of its tag and no others. It builds the application, installs it on both devices and starts the Appium server its step definitions talk to.

       The report at `ADW_JUNIT_REPORT_PATH`:

       - holds one `<testcase>` per scenario and platform. Its `name` is the scenario's title as the `.feature` file spells it, and the Android and the iOS run of a scenario report the identical title. A Scenario Outline row is titled with the outline's title, its `<column>` placeholders filled in from the row, or `Example #<n>` for the outline's n-th row when the title names no column.
       - names each screenshot of a case on a line of its own in that case's `<system-out>`: `[[ATTACHMENT|<path>]]`, the path relative to the directory that holds the report.

       Each screenshot is a `.png` or `.jpg` file under `ADW_PROOF_DIR`: in `android/` when it was taken on Android, in `ios/` when it was taken on iOS. ADW reads the platform of an image from its first directory under `ADW_PROOF_DIR`, and shows the reviewer only the screenshots of the issue's own scenarios (`@adw-<issue number>`) that lie in a platform directory. A scenario about something a user sees needs a screenshot on each platform.
       ```
   - For any other application type, or an undecided one, take the first of these that matches:
   - If **Cypress** detected (`npx cypress run`, `cypress run`, etc.):
     - `## Scenario Directory` → `cypress/e2e/`
     - `## Run Scenarios by Tag` → `npx cypress run --spec "**/*{tag}*"`
     - `## Run Regression Scenarios` → `npx cypress run --tag "@regression"`
   - If **Cucumber** detected (`cucumber-js`, `@cucumber/cucumber`, etc.):
     - `## Scenario Directory` → `features/`
     - `## Run Scenarios by Tag` → `cucumber-js --tags "@{tag}"`
     - `## Run Regression Scenarios` → `cucumber-js --tags "@regression"`
     - `## BDD Framework` → the detected Gherkin step-def runtime (e.g. `cucumber-js` for JS/TS projects, `behave` or `pytest-bdd` for Python, `godog` for Go, `cucumber-rs` for Rust, `cucumber-ruby` for Ruby). **Never emit a non-Gherkin framework name**; fall back to `cucumber-js` on non-recognition.
     - `## Step Def Directory` → the conventional step-def directory for that framework (`features/step_definitions` for cucumber-js; `features/steps` for behave/pytest-bdd; default `features/step_definitions`).
   - If E2E is `N/A`, absent, or tool is unrecognized — default to Cucumber/Gherkin:
     - `## Scenario Directory` → `features/`
     - `## Run Scenarios by Tag` → `cucumber-js --tags "@{tag}"`
     - `## Run Regression Scenarios` → `cucumber-js --tags "@regression"`
     - `## BDD Framework` → `cucumber-js` (default Gherkin runtime)
     - `## Step Def Directory` → `features/step_definitions` (default)
   - **Always include** a `## Per-Issue Scenario Directory` section with value `features/per-issue/` (independent of the detected scenario tool).
   - **Always include** a `## Regression Scenario Directory` section with value `features/regression/` (independent of the detected scenario tool).
   - **Copy the framework vocabulary template**: if `$3` (`frameworkRepoRoot`) is non-empty, run the following via the Bash tool:
     ```bash
     mkdir -p features/regression
     cp "$3/templates/vocabulary.md.template" features/regression/vocabulary.md
     ```
     If `$3` is empty (legacy invocation without framework repo root), skip the copy and log a warning in the step 11 report.
   - **Draft the observability-surfaces examples block**: after the template copy above, classify the target repo's stack and replace the placeholder in the materialised `features/regression/vocabulary.md`.

     **Classification rules** (use the analysis already performed in step 1 — do not re-read manifests):
     - **browser-test-equipped** — the application type is `web`, because ADW's Playwright project gives it Playwright; or at least one of `@playwright/test`, `playwright`, `cypress`, `puppeteer`, `webdriverio`, `nightwatch` appears in `devDependencies` of `package.json` (Node), or the equivalent browser-test runner in `requirements.txt`/`pyproject.toml` (Python: `playwright`, `pytest-playwright`, `selenium`), `Gemfile` (Ruby: `capybara`, `selenium-webdriver`), `pom.xml`/`build.gradle` (Java: `selenium-java`, `playwright-java`), or `.csproj`/`packages.config` (.NET: `Microsoft.Playwright`, `Selenium.WebDriver`).
     - **CLI-only** — no browser test runner detected and at least one manifest was parseable.
     - **fallback** — no manifest could be parsed (empty repo, unrecognised stack).

     **Locate the placeholder**: find the literal text `<!-- TODO (slice #3, issue ??):` in `features/regression/vocabulary.md`, between the `## Observability Surfaces (Examples)` heading and `## Three Permitted Execution Patterns`. Use the Edit tool with `old_string` set to the full placeholder comment and `new_string` set to the block body below. If the placeholder is not present (file absent or pre-edited), skip and log a warning in step 11.

     **Browser-test-equipped block** (`new_string`):
     ```
     Scenarios in this repo can assert against the following observable surfaces:

     | # | Surface | Evidence | Example |
     |---|---------|----------|---------|
     | 1 | State files | JSON or other structured output files written by orchestrators, CLI tools, or test fixtures | `agents/<adwId>/state.json` |
     | 2 | Recorded HTTP requests | Request logs captured by a mock HTTP server fronting the system under test | mock server `getRecordedRequests()` |
     | 3 | Git artefacts | Branches, commits, pushes, and worktree state produced by the system under test | `git log --oneline` on the worktree branch |
     | 4 | DOM snapshots | Serialised page DOM extracted by the browser test runner during scenario execution | Playwright `page.content()` capture |
     | 5 | Screenshot artefacts | Image files captured by the browser test runner at known assertion points | Playwright `page.screenshot()` output |
     | 6 | Exit codes | Termination status of subprocesses spawned by the test harness | `spawnSync(...).status` |
     | 7 | Log streams | stdout/stderr captured from spawned processes and asserted against by substring or regex | `spawnSync(...).stdout` |
     ```

     **CLI-only block** (`new_string`):
     ```
     Scenarios in this repo can assert against the following observable surfaces:

     | # | Surface | Evidence | Example |
     |---|---------|----------|---------|
     | 1 | State files | JSON or other structured output files written by orchestrators, CLI tools, or test fixtures | `agents/<adwId>/state.json` |
     | 2 | Recorded HTTP requests | Request logs captured by a mock HTTP server fronting the system under test | mock server `getRecordedRequests()` |
     | 3 | Git artefacts | Branches, commits, pushes, and worktree state produced by the system under test | `git log --oneline` on the worktree branch |
     | 4 | Exit codes | Termination status of subprocesses spawned by the test harness | `spawnSync(...).status` |
     | 5 | Log streams | stdout/stderr captured from spawned processes and asserted against by substring or regex | `spawnSync(...).stdout` |
     ```

     **Fallback block** (`new_string`):
     ```
     Scenarios in this repo can assert against the following observable surfaces:

     | # | Surface | Evidence | Example |
     |---|---------|----------|---------|
     | 1 | State files | JSON or other structured output files written by the system under test | (refine as patterns emerge) |
     | 2 | Recorded HTTP requests | Request logs captured by a mock HTTP server (if one is present in the repo) | (refine as patterns emerge) |
     | 3 | Exit codes | Termination status of subprocesses | `spawnSync(...).status` |
     | 4 | Log streams | stdout/stderr captured from spawned processes | `spawnSync(...).stdout` |

     Note: the stack could not be classified automatically; refine this list as your test surfaces solidify.
     ```

9. **Create `.github/adw.yml` (only if absent)**
   - Create `.github/adw.yml` only when it does not already exist. Never overwrite an existing file — it carries durable operator policy that survives regeneration, including the `unitTests` switch.
   - Run the following via the Bash tool:
     ```bash
     if [ ! -f .github/adw.yml ]; then
       mkdir -p .github
       cat > .github/adw.yml <<'EOF'
# ADW configuration for this repository.
# This file lives outside `.adw/`, so `/adw_init` regeneration never overwrites it.
# Uncomment a key and set its value to change policy; absent keys use the defaults below.

# Unit-test gate (opt-out). When enabled, the unit-test phase runs your test
# command and fails the workflow on unit-test failure. Default: enabled.
# unitTests: true

# Human-in-the-loop gate for framework-upgrade PRs (opt-in). When true, ADW opens
# the upgrade PR but leaves it for human review instead of auto-merging. Default: false.
# hitl: false
EOF
       echo "created .github/adw.yml"
     else
       echo ".github/adw.yml already exists — left untouched"
     fi
     ```
   - IMPORTANT: the heredoc content above MUST stay byte-identical to `ADW_YML_TEMPLATE` in `adws/core/adwYmlConfig.ts`; `adws/__tests__/adwInitPrompt.test.ts` compares them.

10. **Add the Comments entry to the coding guidelines**
   - Use `.adw/coding_guidelines.md` if it exists; otherwise `guidelines/coding_guidelines.md` if it exists; otherwise create `.adw/coding_guidelines.md` containing a `# Coding Guidelines` heading.
   - The entry, verbatim:
     ```md
     - **Comments** — Comment only what the code cannot say: invariants, ordering constraints, and the reason a non-obvious choice was made. Never restate what the next line does, never add section banners, never cite issue numbers (git blame carries history). Do not JSDoc a field or function whose name already says what it is.
     ```
   - If the file already has a bullet starting with `- **Comments**`, replace that whole bullet with the entry. Otherwise add the entry as the last line of the file, after a blank line.
   - Where the file asks for comments or JSDoc to explain non-obvious logic (the instruction this entry replaces), remove that clause and keep the rest of its line.
   - Change nothing else in the file.

11. **Report**
   - List all files created (`commands.md`, `project.md`, `conditional_docs.md`, `providers.md`, `scenarios.md`, `features/regression/vocabulary.md` when copied, `.github/adw.yml` when created, and the coding guidelines file when created)
   - Playwright project (step 6): `not applicable (<type>)`, or each of `features/playwright.config.ts`, `features/package.json` and `features/.gitignore` as `written`, `kept` or `appended`, plus the outcome of `npm install` and of the browser install. If the step was skipped for an empty `$3`, note the warning that this repository's scenarios cannot run.
   - Summarize the detected project type and key configuration choices
   - Note the `## Application Type` written to `.adw/project.md`: the value, and whether it was detected or preserved; or `left out — detection could not decide (the next ADW run parks the issue with missing_application_type)`.
   - Note both `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` sections written to `scenarios.md`
   - Note `## BDD Framework` and `## Step Def Directory` sections written to `scenarios.md` (`web`, `mobile:kotlincm` and Cucumber/Gherkin branches only).
   - For `mobile:kotlincm`: the `## Scenario Run Contract` written to `scenarios.md`; each of `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` and `## iOS Runtime` in `project.md` as `default` or `preserved`; and whether the Gradle `## Run Tests` was written, replaced an `N/A`, or a custom command was preserved.
   - Note the `## Run Tests` value written and whether it was seeded (new) or preserved (pre-existing). Because `adw_init.md` is a `hashInputs:` file, any edit to it raises `.adw-version` and triggers `adwUpgrade` to regenerate `.adw/` across all registered target repos — the intended emit-parse coupling propagation for the JUnit report rail (same mechanism issue #578 used for `scenarios.md` sections).
   - Note the `## Test Directory` and `## Test Framework` values written to `commands.md`.
   - Note whether the starter guardrails `.claude/settings.json` (step 7) was copied or skipped (already present), and that a `## Agent Guardrails` section was written to `.adw/project.md` reflecting that outcome. This edit's presence in `adw_init.md` is what bumps `.adw-version` and fans the starter-settings copy out to every registered target repo on the next upgrade regen (issue #763).
   - If the vocabulary template copy was skipped (empty `$3`), note the warning here
   - Examples-block class chosen: `<browser-test-equipped | CLI-only | fallback>`; placeholder replacement: `<succeeded | skipped: <reason>>`.
   - `.github/adw.yml` status: `created` or `already present — left untouched`.
   - Comments entry: the guidelines file used, and `added`, `replaced` or `already present`.
