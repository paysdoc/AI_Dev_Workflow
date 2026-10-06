# ADW Playwright Project Scaffolding

## Overview

ADW owns the Playwright BDD project that runs the Gherkin scenarios of `web` repositories. This module holds the framework's templates for that project and the code that writes them into a target repository's `features/` directory and installs them. The upgrade workflow runs it so every web repository carries the same project, lockfile included.

## Responsibilities

- Hold the project's templates in `templates/playwright/`: `playwright.config.ts.template`, `package.json.template` and `gitignore.template`.
- `syncAdwPlaywrightProject(worktreePath, frameworkRepoRoot)` (`adws/core/adwPlaywrightProject.ts`) writes each template to its target under `features/`, applying that file's `ProjectFilePolicy`, and returns a `ProjectFileOutcome` (`written`, `kept` or `appended`) per file.
- `syncDeclaredScenarioProject` (`adws/phases/scenarioProjectSetup.ts`) reads the application type declared in the regenerated `.adw/project.md`. If its `runnerMode` is `RunnerMode.AdwPlaywright`, it syncs the files and runs `ADW_PLAYWRIGHT_SETUP_COMMAND`. Otherwise it returns `not_applicable`.
- `adwUpgrade` calls it through the `syncScenarioProject` dep after the init agent's regen check and before the commit, so the files and `features/package-lock.json` ride in the regen commit. A thrown error posts the upgrade-failure comment and ends the run as `failed` with reason `scenario_project_error`.
- Export the command strings other phases use: `ADW_PLAYWRIGHT_INSTALL_COMMAND` and `ADW_PLAYWRIGHT_RUN_BY_TAG`, with `{tag}` as the placeholder.
- Register `playwright-bdd` in `stepDefDetection.ts` with the `.ts` step-definition extension.

## Contracts & Invariants

- Per-file policy:
  - `features/playwright.config.ts` uses `Overwrite`. It is identical in every web repository, and upgrades replace it.
  - `features/package.json` uses `CreateIfAbsent`. An existing manifest belongs to the repository owner because step definitions may need extra packages.
  - `features/.gitignore` uses `AppendMissingLines`. Only absent lines are added, and a second run changes nothing.
- `appendMissingLines` returns `existing` unchanged when every non-empty template line is already present.
- The config takes repository values only from `ADW_APPLICATION_URL`, `ADW_PROOF_DIR` and `ADW_JUNIT_REPORT_PATH`. It discovers `**/*.feature` and `steps/**/*.ts`. ADW starts the dev server itself.
- `ADW_PLAYWRIGHT_RUN_BY_TAG` runs the install guard first (`test -d node_modules || npm ci`), then `bddgen`, then `playwright test --grep "@{tag}\b"`. `\b` stops `@adw-99` from matching `@adw-992`.
- `ADW_PLAYWRIGHT_SETUP_COMMAND` is the first install in a repository: `npm install` writes the lockfile and `playwright install chromium` downloads the browser. Worktrees then use `npm ci` against that lockfile.
- A missing template throws. The caller decides what that means.

## Configuration

- Pinned versions live in `templates/playwright/package.json.template`: `@playwright/test` and `playwright-bdd`.
- Environment variables read by the generated config: `ADW_APPLICATION_URL`, `ADW_PROOF_DIR`, `ADW_JUNIT_REPORT_PATH`.

## Gotchas

- An application type ADW does not recognise gives `not_applicable` here. The application-type gate parks the workflow, not the upgrade.
- The sync runs after the init agent on purpose. The framework's files and lockfile win whatever the agent wrote.
- A worktree has no `features/node_modules`. Without the install guard, `npx` would resolve `bddgen` from the registry.

## Decisions

- [ADR-0061](../specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md) — The application type decides the evidence; `web` repositories run their Gherkin on an ADW-owned Playwright project
