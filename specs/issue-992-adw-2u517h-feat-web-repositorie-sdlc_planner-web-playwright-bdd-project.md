# Feature: `web` repositories run their Gherkin on an ADW-owned Playwright project installed by `adw_init`

## Metadata
issueNumber: `992`
adwId: `2u517h-feat-web-repositorie`
issueJson: `{"number":992,"title":"feat: web repositories run their Gherkin on an ADW-owned Playwright project installed by adw_init","body":"Source: `specs/prd/review-proof-redesign.md` and the ADR named below, in `specs/adr/`. The PRD section **Implementation Decisions** describes the module; the ADR holds the decision and its reasons. Read both before planning; they are the specification. Do not change the decisions.\n\n## Decision record\n\nADR-0061 (Playwright project, owned configuration, two generator modes). PRD modules: **`adw_init` changes**, **Scenario phase**, part of **Prompts**.\n\n## What to build\n\n- `adw_init`, for a `web` repository: writes `features/package.json` and `features/playwright.config.ts` from a template held in ADW; installs `@playwright/test` and `playwright-bdd` in `features/` (self-contained Node project, also in non-Node repositories); installs the browser; commits. Existing e2e setups elsewhere in the repository are not touched. The template is the spiked configuration: `defineBddConfig` over `features/**/*.feature` and `features/steps/**/*.ts`; `outputDir` from `ADW_PROOF_DIR`; `list` and `junit` reporters with `outputFile` from `ADW_JUNIT_REPORT_PATH`; `use.baseURL` from `ADW_APPLICATION_URL`; `screenshot: 'on'`; no `webServer` block. The configuration is byte-identical in every web repository; repository values arrive through those variables only; upgrade overwrites it; the fix-round guard already protects it.\n- Remove the inconsistent Playwright branch from `adw_init` step 8 and the writing of `.adw/review_proof.md` from step 6 (the parser removal is in the reviewer issue).\n- Scenario phase in `web` mode: starts the dev server through the existing lifecycle, passes `ADW_APPLICATION_URL` along with the existing variables, runs `npx bddgen` then `npx playwright test --grep \"@<tag>\"` from `features/`. `cli` mode is unchanged.\n- `generate_step_definitions.md` gains the `web` mode: TypeScript steps with `createBdd()` from `playwright-bdd`, taking the `page` fixture. `scenario_writer.md` output is unchanged in both modes.\n- `adws/triggers/promotionSweepDefaults.ts` and the sweep code keep working unchanged: feature paths do not move.\n\n## Acceptance criteria\n\n- [ ] A fresh `web` repository initialised by `adw_init` has the project in `features/`, the configuration identical to the template, and a per-issue scenario run produces a JUnit report on ADW's path and one end-state image per scenario that uses `page`.\n- [ ] Step definitions generated in a `web` repository use `createBdd()`; in a `cli` repository they are as today.\n- [ ] Upgrade overwrites a modified configuration file with the template.\n- [ ] The regression suite's scenarios on `adw_init` and the generators cover the new mode (source-text scenarios, as today).\n- [ ] The `### Confirmation` section of ADR-0061 names the implemented check.\n\n## Known limits\n\nThe spike did not test a real framework application, parallel workers, Scenario Outlines or long scenario names. Test against at least one real web application before closing.\n\n## Blocked by\n\n#991\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-03T23:13:14Z","comments":[],"actionableComment":null}`

## Feature Description
ADR-0061 decided that a `web` repository runs its Gherkin on the Playwright test runner through `playwright-bdd`, in a self-contained Node project in `features/` whose configuration ADW owns. A `cli` repository keeps the runner `.adw/scenarios.md` names. #991 delivered the mapping that makes the choice (`adws/core/applicationType.ts`): `web` resolves to `RunnerMode.AdwPlaywright`, and the gate puts the profile on `WorkflowConfig.applicationProfile`. Nothing consumes that runner mode yet. This issue builds the runner mode end to end:

1. **The project.** Three templates in `templates/playwright/`:
   - the spiked `playwright.config.ts`;
   - a `package.json` that pins `@playwright/test` 1.63.0 and `playwright-bdd` 9.2.1;
   - a `.gitignore` that keeps `node_modules/` and the generated tests out of git.

   For a `web` repository, `adw_init` installs them in `features/` and installs the browser. After the `/adw_init` agent has run, the upgrade itself writes the files from the templates and runs the install. Its regen commit therefore carries them and `features/package-lock.json`, whatever the agent did. The configuration is byte-identical in every web repository and is overwritten on every upgrade. Repository values reach it only through `ADW_APPLICATION_URL`, `ADW_PROOF_DIR` and `ADW_JUNIT_REPORT_PATH`. Existing e2e setups elsewhere in the repository are not touched.
2. **The scenario run.** A framework table maps each `RunnerMode` to a scenario runner: the command, the step-definition directory and extensions, and how the run is prepared. `descriptor` is exactly today's behaviour. `adw_playwright` does the following:
   - installs `features/` from its lockfile when the worktree has no `node_modules`;
   - runs `npx bddgen` and then `npx playwright test --grep "@<tag>"` from `features/`;
   - gives each tag its own output directory.

   The dev server is started through the existing lifecycle. `ADW_APPLICATION_URL` is passed alongside the two existing variables.
3. **The step-definition generator.** `generate_step_definitions.md` receives the runner mode from the profile and gains the `adw_playwright` mode: TypeScript steps under `features/steps/`, registered with `createBdd()` from `playwright-bdd`, taking the `page` fixture. `scenario_writer.md` is unchanged.
4. **Clean-up of `adw_init`.** Step 6 no longer writes `.adw/review_proof.md`, and the file leaves the list of files `adw_init` must produce. The Playwright branch of step 8 is removed. So is the step-2 rule that turned off ADW's dev server for repositories whose own Playwright has a `webServer` block.

Value: every web review gets a JUnit verdict and an end-state screenshot for each scenario that opens a page, however the repository wrote its own tests. One configuration file is the only thing to maintain, and `cli` repositories pay nothing.

## User Story
As an ADW operator running ADW on a web application
I want `adw_init` to install an ADW-owned Playwright project in `features/`, and the scenario phase to run each issue's Gherkin through it against the dev server ADW starts
So that every web review has a JUnit verdict on ADW's path and an end-state screenshot for each scenario that opens a page, regardless of how the repository wrote its own tests

## Problem Statement
- **No consumer of the runner mode.** `RunnerMode.AdwPlaywright` exists, but nothing reads it.
  - `executeScenarioTestPhase` (`adws/phases/scenarioTestPhase.ts`) runs `.adw/commands.md`'s `## Run Scenarios by Tag` in every repository.
  - `runScenarioProof` (`adws/phases/scenarioProof.ts:218-221`) passes only `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR`, so no dev-server address reaches the runner.
- **No ADW-owned Playwright project.** There is no template, `adw_init` does not install a project, and the upgrade does not refresh one.
- **`adw_init` contradicts the scenario writer.**
  - Step 8 has a Playwright branch: `bunx playwright test --grep "@{tag}"` over `tests/e2e/`, which the scenario writer, writing Gherkin only, never feeds.
  - Step 2 sets `## Start Dev Server` to `N/A` when the repository's own Playwright configuration has a `webServer` block. ADW would then not start a server for exactly the repositories that need one.
- **`review_proof.md` cannot simply be dropped.** Step 6 still writes `.adw/review_proof.md`, and `REQUIRED_ADW_FILES` (`adws/phases/worktreeSetup.ts:8-15`) requires it. If step 6 stopped writing it alone, the upgrade of a never-initialised repository would fail as `regen_incomplete`.
- **The generator has no `web` mode.** `generate_step_definitions.md` knows only the descriptor's framework. The step-def agent (`adws/agents/stepDefAgent.ts`) passes only the issue number and adwId, so the prompt cannot know the runner mode.
- **`playwright-bdd` looks like a misconfigured stack.**
  - `adws/core/stepDefDetection.ts` does not know `playwright-bdd`, so `stackCoherenceCheck` would call it "not a recognized Gherkin-based runner".
  - In a Python web application, the Node commands of ADW's project make the stack look like two languages.
  - `reportStackCoherence` would therefore label every such issue `adw:unverified` and post a `stack_incoherent` comment.
- **A fresh issue worktree has no `features/node_modules`.**
  - `npx bddgen` would then resolve the name on the npm registry: `npx` installs a missing package without a prompt when stdin is not a TTY.
  - A repository whose own type check or lint covers `features/**`, such as Next.js's default `"include": ["**/*.ts"]`, fails its static checks on unresolved `@playwright/test` and `playwright-bdd` imports, before scenarios ever run.
- **Shared output directory.** Playwright empties its `outputDir` at the start of every run. With one `ADW_PROOF_DIR` for every tag, a later tag's run deletes the images an earlier run's JUnit `[[ATTACHMENT|…]]` lines point to.

## Solution Statement
- **Templates (`templates/playwright/`).**
  - Files: `playwright.config.ts.template`, `package.json.template` and `gitignore.template`. Their contents are given in task 1.
  - The `.template` suffix follows `templates/vocabulary.md.template`. ADW's root `tsconfig.json` includes every `**/*.ts`, and ADW does not depend on `@playwright/test`, so a `.ts` template would break ADW's own `tsc`.
  - The configuration is the spiked one, and its relative paths resolve from `features/`. `features: '**/*.feature'` and `steps: 'steps/**/*.ts'` therefore cover `features/**/*.feature` and `features/steps/**/*.ts`.
- **Project module (`adws/core/adwPlaywrightProject.ts`).**
  - The constants of the project:
    - project directory `features`;
    - step directory `features/steps`;
    - the setup command `cd features && npm install --no-audit --no-fund && npx playwright install chromium`, the first install in a repository, which writes `features/package-lock.json` and installs the browser;
    - the install command `cd features && (test -d node_modules || npm ci)`;
    - the run-by-tag command `cd features && (test -d node_modules || npm ci) && npx bddgen && npx playwright test --grep "@{tag}\b"`.
  - The file table:
    - `features/playwright.config.ts` is always overwritten;
    - `features/package.json` is created only when absent;
    - `features/.gitignore` is created, or has the template's missing lines appended.
  - `syncAdwPlaywrightProject(worktreePath, frameworkRepoRoot)` applies the table from the framework's templates.
- **Scenario runner table (`adws/core/scenarioRunner.ts`, pure).** `resolveScenarioRunner(runnerMode, projectConfig)` reads a `Record<RunnerMode, …>` and returns:
  - `runByTagCommand`;
  - `stepDefDirectory` and `stepDefExtensions`;
  - `proofDirPerTag`;
  - `installCommand`;
  - `stackSignals`.

  `descriptor` returns today's values from `.adw/commands.md` and `.adw/scenarios.md`. `adw_playwright` returns the project's constants and ignores the descriptors. The `Record` makes the compiler demand a runner for any new mode. A third application type that reuses a mode touches nothing.
- **Scenario phase.**
  - `executeScenarioTestPhase` resolves the runner from `requireApplicationProfile(config).runnerMode` and hands its fields to `runScenarioProof`.
  - It always adds `ADW_APPLICATION_URL` (`config.applicationUrl`), as the PRD's **Scenario phase** module says. That only adds a variable in `cli` mode, where the runner, commands and step definitions stay as they are.
  - `runScenarioProof` gains `env` (extra variables; the two framework variables always win) and `proofDirPerTag` (`ADW_PROOF_DIR = <artifactsDir>/<tag>`). The dev-server lifecycle is unchanged.
- **Unit-test phase.** Before the static checks, `executeUnitTestPhase` runs the runner's `installCommand` in the worktree, when there is one. It is non-fatal: it is logged, and the checks run either way.
  - It runs there because the repository's own type check and lint may cover `features/**`, whose imports resolve only from `features/node_modules`.
  - `reportStackCoherence` takes the BDD signals from `runner.stackSignals`. These are empty for ADW's project, which says nothing about the repository's own stack.
  - `playwright-bdd` is registered as a Gherkin runtime (`.ts`, JavaScript) in `stepDefDetection.ts` and `stackCoherenceCheck.ts`.
- **Step-definition generator.**
  - `runStepDefAgent` takes the runner mode and passes it as `$2`. `executeStepDefPhase` passes `requireApplicationProfile(config).runnerMode`.
  - `generate_step_definitions.md` gains a "Runner mode" section:
    - `descriptor`, or empty, keeps everything as written;
    - `adw_playwright` writes TypeScript steps under `features/steps/` with `createBdd()`, the `page` fixture, relative URLs, `expect` from `@playwright/test`, and `npx bddgen` as its check.
  - `scenario_writer.md` is not modified. In a `web` repository its existing read of `## BDD Framework` (`playwright-bdd`) already makes it write Gherkin that runner supports.
- **`adw_init.md`.**
  - `hashInputs` lists the three templates, so a template change bumps the framework hash and upgrades every target repository.
  - Step 2, `## Start Dev Server`: `web` gets the framework's dev command with `{PORT}`, whatever the repository's own runners do. `cli` gets `N/A`.
  - Step 2, `## Run Scenarios by Tag` and `## Run Regression Scenarios`: for `web`, ADW's commands.
  - Step 6 becomes "Install ADW's Playwright project (`web` only)". Replacing step 6, rather than deleting it, keeps every step number and cross-reference.
  - Step 8 drops the Playwright branch and gains a `web` branch that writes ADW's commands, `playwright-bdd` and `features/steps`. The `cli` branches stay.
  - Step 11 stops listing `review_proof.md` and reports the project.
- **Upgrade (`adws/adwUpgrade.tsx`).**
  - `UpgradeDeps` gains `syncScenarioProject`. Its default, `syncDeclaredScenarioProject` in the new `adws/phases/scenarioProjectSetup.ts`, does three things:
    - it reads the regenerated `.adw/project.md` through `declaredApplicationProfile`, a new function in `applicationTypeGate.ts`: it resolves and never parks;
    - when the runner mode is `adw_playwright`, it syncs the project files;
    - it then installs the project with the setup command (`npm install` and the browser install in `features/`), through an injected `ProcessRunner`.
  - It runs after `verifyAdwRegen` and before `.adw-version` and the commit. "Upgrade overwrites the configuration" therefore holds even if the `/adw_init` agent skipped its copy. The regen commit also carries `features/package-lock.json`, which every worktree's `npm ci` needs, even if the agent skipped its install.
  - The issue gives `adw_init` the jobs "installs `@playwright/test` and `playwright-bdd` in `features/` …; installs the browser; commits". The upgrade lane is `adw_init`'s TypeScript path, and the `@adw-992` upgrade scenario asserts there that "the upgrade installed the packages … and the Playwright browser, in `features/`". The upgrade harness stays hermetic: stand-in `npm` and `npx` lead `PATH` and record the install (task 16).
- **Removals.** `review_proof.md` leaves `REQUIRED_ADW_FILES`. `parseReviewProofMd`, `reviewProofConfig` and ADW's own `.adw/review_proof.md` stay; the reviewer issue removes them.
- **"Commits".** The TypeScript path that runs `/adw_init` is the upgrade lane. Its regen commit carries everything `adw_init` wrote, plus what the upgrade's own sync and install wrote, `features/package-lock.json` included. `features/.gitignore` keeps `node_modules/` and `.features-gen/` out of it. The prompt adds no commit of its own, so the upgrade still lands one regen commit. In a manual `/adw_init` session the operator commits, as today.
- **Records.** Update ADR-0061's `### Confirmation`, the README and `adws/README.md`.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/review-proof-redesign.md` — The specification. Read its *Implementation Decisions*: **`adw_init` changes**, **Scenario phase**, **Prompts**, **Removals and wiring**. *Testing Decisions*: "Not unit-tested: `adw_init` and the prompts … source-text". Read-only.
- `specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md` — The decision: the project in `features/`, the fully ADW-owned configuration with no `webServer` block, two generator modes, no migration. Its `### Confirmation` must be rewritten (acceptance criterion).
- `specs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md` — Image selection is a later issue; it relies on per-issue JUnit attachments pointing at files that still exist (hence one output directory per tag). Read-only.
- `specs/adr/0059-fix-loops-no-progress-stop-and-suppression-guard.md`, `adws/core/fixRoundGuardTable.ts` — The guard already protects `features/playwright.config.*`, and `package.json` at any depth. Not modified.
- `specs/adr/0062-dev-server-start-failure-is-a-failed-review.md` — Dev-server start failures are a later issue. The lifecycle stays as is here. Read-only.
- `specs/adr/0042-hash-versioned-self-upgrade.md` — `hashInputs` drives the framework hash and the upgrade fan-out. Read-only.
- `README.md` — The application-type bullet, `### 4. Bootstrap a target repo with /adw_init`, and the `templates/` tree.
- `adws/README.md` — `### BDD Scenario Configuration` and the `/adw_init` bootstrapping paragraph.
- `.adw/coding_guidelines.md` — Must be followed:
  - guard clauses, nesting ≤ 2, enums for named sets, `readonly`, no `any`;
  - pure core, side effects at the boundaries;
  - files under 300 lines;
  - comments only for invariants, ordering and non-obvious reasons (no issue numbers, no banners).
- `.adw/commands.md` — Source of the validation commands. Read-only.
- `.github/adw.yml` — `unitTests` is commented out, so unit tests are enabled. Read-only.
- `templates/vocabulary.md.template`, `templates/claude-settings-starter.json` — Prior art for framework templates copied from `$3`.
- `adws/core/applicationType.ts` — `RunnerMode`, `ApplicationProfile`, `APPLICATION_TYPE_PROFILES`. Read-only. New modules must not use the identifier `applicationType`: `adws/core/__tests__/applicationType.test.ts` fails any `adws/` source other than `core/projectConfig.ts` and `phases/applicationTypeGate.ts` that names it.
- `adws/phases/applicationTypeGate.ts` — `requireApplicationProfile`, `resolveApplicationType` wiring. Add `declaredApplicationProfile` here, since this module may name the type.
- `adws/phases/__tests__/applicationTypeGate.test.ts` — Add the `declaredApplicationProfile` cases.
- `adws/core/projectConfig.ts` — `CommandsConfig.runScenariosByTag`, `ScenariosConfig.stepDefDirectory`/`bddFramework`, `parseReviewProofMd` (stays). Read-only.
- `adws/core/stepDefDetection.ts`, `adws/core/__tests__/stepDefDetection.test.ts` — `FRAMEWORK_EXTENSION_MAP`, `stepDefExtensionsFor`, `isGherkinFramework`, `hasStepDefinitions`. Register `playwright-bdd`.
- `adws/core/stackCoherenceCheck.ts`, `adws/core/__tests__/stackCoherenceCheck.test.ts` — `LANGUAGE_TOKENS`, `StackCoherenceInput`, `inferStackLanguages`. Add the `playwright-bdd` token.
- `adws/core/checkRunner.ts` — `runShellCommand` and `ProcessRunner`, reused for the install command. Read-only.
- `adws/core/index.ts` — Core barrel. Export the new modules.
- `adws/agents/bddScenarioRunner.ts` — `runScenariosByTag` replaces `{tag}`, spawns with `shell: true` and merges `env` over `process.env`. Read-only.
- `adws/phases/scenarioProof.ts` — `runScenarioProof`: add `env` and `proofDirPerTag`. `artifactsDir` stays the returned harvest root.
- `adws/phases/scenarioTestPhase.ts`, `adws/phases/__tests__/scenarioTestPhase.test.ts` — Resolve the runner and pass `ADW_APPLICATION_URL`. The test mocks the `../core` barrel, so import `resolveScenarioRunner` from `../core/scenarioRunner`, or extend the mock. `makeConfig` needs `applicationProfile`.
- `adws/core/devServerLifecycle.ts` — `withDevServer`. Unchanged ("starts the dev server through the existing lifecycle").
- `adws/phases/workflowInit.ts` — `applicationUrl = http://localhost:<port>` (the value of `ADW_APPLICATION_URL`). Read-only.
- `adws/phases/unitTestPhase.ts`, `adws/phases/__tests__/unitTestPhase.helpers.ts`, `unitTestPhase.test.ts`, `unitTestPhase.guard.test.ts`, `unitTestPhase.park.test.ts` — Run the install command before `runStaticCheckGate`. `makeConfig` needs `applicationProfile`.
- `adws/phases/stackCoherenceReporter.ts` — Take the BDD signals from the runner.
- `adws/phases/staticCheckGate.ts` — `guardConfigFor` keeps reading the descriptors. ADW's run command adds JavaScript patterns in a web repository, whose step files are TypeScript. Not modified.
- `adws/agents/stepDefAgent.ts`, `adws/phases/stepDefPhase.ts` — Pass the runner mode as `$2`.
- `adws/agents/commandAgent.ts` — How `args` reach the slash command as `$0…$n`. Read-only.
- `.claude/commands/generate_step_definitions.md` — Add the runner-mode argument and the `adw_playwright` mode.
- `.claude/commands/scenario_writer.md` — Unchanged; listed so the build does not touch it.
- `.claude/commands/resolve_failed_scenario.md`, `.claude/skills/implement-tdd/SKILL.md` — Agents that read `## Run Scenarios by Tag` from `.adw/scenarios.md`/`.adw/commands.md`. That is why `adw_init` writes ADW's command there, self-installing. Read-only.
- `.claude/commands/adw_init.md` — `hashInputs`, `$3`, and steps 2, 6, 8 and 11.
- `adws/__tests__/adwInitPrompt.test.ts` — Source-text drift tests over `adw_init.md`. Extend it.
- `adws/core/hashComputer.ts` — Every `hashInputs` file must resolve. Its CLI prints the hash. Read-only.
- `adws/phases/worktreeSetup.ts`, `adws/phases/__tests__/worktreeSetup.test.ts` — `REQUIRED_ADW_FILES`, `verifyAdwRegen`, and `copyStarterSettingsToWorktree` (the prior art for the deterministic copy).
- `adws/adwUpgrade.tsx`, `adws/__tests__/adwUpgrade.test.ts` — `UpgradeDeps`, `executeUpgrade`, `buildDefaultUpgradeDeps`, `makeDeps`. Already over 300 lines (pre-existing): add only the dep, the call and its failure branch.
- `adws/triggers/promotionSweepDefaults.ts` — Feature paths (`features/per-issue`, `features/regression/`) do not move, so it is unchanged. Read-only.
- `adws/proof/proofArtifactHarvester.ts` — Recursive harvest under `artifactsDir`, so per-tag subdirectories are found. Read-only.
- `features/regression/support/phaseConfig.ts` — `buildConfigFor` builds the surface rows' `WorkflowConfig` "as initializeWorkflow builds it". It must now set `applicationProfile`: rows 06, 20, 21 and 22 run the unit-test and scenario phases.
- `features/per-issue/step_definitions/feature-929-workflow.ts` — `createWorkflow`, the shared hand-built config of the 929, 988, 989 and 991 harnesses. Add `applicationProfile`.
- `features/per-issue/step_definitions/feature-937-workflow.ts` — Runs the real `executeScenarioTestPhase` (a promotion candidate). Add `applicationProfile`.
- `features/per-issue/step_definitions/feature-929-agents.ts` — Calls `runStepDefAgent` positionally. Update it for the new parameter (`RunnerMode.Descriptor`).
- `features/per-issue/step_definitions/feature-931.steps.ts`, `feature-991-upgrade.steps.ts`, `feature-991-project-md.ts` — The upgrade harness: the real `executeUpgrade` with a stubbed `/adw_init`, and `configureAdwInitAgent`/`regenCommitFile`. The `@adw-992` upgrade scenarios can reuse it. Its assertions check membership, so the extra `features/` files a `web` regen commit gains do not break `@adw-931` or `@adw-991`. The upgrade now runs the install for a `web` regen. That includes feature-991's upgrade outline, whose `web` row also carries `@adw-992`. So the harness puts the stand-in `npm` and `npx` first on `PATH`, and its `Before`/`After` hooks must also cover `@adw-992` (task 16).
- `features/regression/support/launchRecorder.ts` — Prior art for a stand-in executable shadowing a tool on `PATH` (the `bunx` shadow), the model for a hermetic `npx`/`npm` stand-in.
- `test/fixtures/python-app/` — Declares `web` but runs descriptor commands. Only `runScenarioProof` is driven over it (`@python-e2e`), with default options, so it is unaffected. Read-only.
- `app_docs/feature-gfv9kt-application-type-mapping.md` — Conditional doc for the application-type mapping, `RunnerMode`, `requireApplicationProfile`, and `adw_init` writing the type.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — Conditional doc for the scenario, step-def and unit-test phases and the fix-round guard's protected paths.
- `app_docs/feature-9gjajh-scenario-and-stepdef-agents.md` — Conditional doc for `bddScenarioRunner.ts` and `stepDefAgent.ts`.
- `app_docs/feature-9gjajh-commands-and-skills.md` — Conditional doc for `adw_init.md`, `generate_step_definitions.md`, `scenario_writer.md` and `adwInitPrompt.test.ts`.
- `app_docs/feature-9gjajh-freeze-and-coherence.md` — Conditional doc for `stackCoherenceCheck.ts` and `stepDefDetection.ts`.
- `app_docs/feature-9gjajh-feature-orchestrators.md` — Conditional doc for `adwUpgrade.tsx`.
- `app_docs/feature-9gjajh-hash-and-versioning.md` — Conditional doc for the hash and upgrade loop (`hashInputs`).
- `app_docs/feature-9gjajh-proof-and-scenario-proof.md` — Conditional doc for `scenarioProof.ts` and proof harvesting.
- `app_docs/feature-9gjajh-dev-server-and-ports.md` — Conditional doc for `devServerLifecycle.ts`.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — Conditional doc for `features/regression/**` (`phaseConfig.ts`).
- `app_docs/feature-9gjajh-bdd-per-issue.md` — Conditional doc for `features/per-issue/**`.
- `app_docs/feature-9gjajh-specs-and-prd.md` — Conditional doc for `specs/**` (the ADR edit).
- `app_docs/feature-9gjajh-root-config.md` — Conditional doc for `README.md`.

### New Files
- `templates/playwright/playwright.config.ts.template` — ADW's Playwright configuration, copied byte for byte to `features/playwright.config.ts`.
- `templates/playwright/package.json.template` — The scenario project's manifest, pinning `@playwright/test` and `playwright-bdd`.
- `templates/playwright/gitignore.template` — The lines `features/.gitignore` must hold.
- `adws/core/adwPlaywrightProject.ts` — The project's constants, file table and `syncAdwPlaywrightProject`.
- `adws/core/__tests__/adwPlaywrightProject.test.ts` — Sync behaviour over a temp directory, and the templates' pinned decisions.
- `adws/core/scenarioRunner.ts` — `ScenarioRunner`, the `Record<RunnerMode, …>` table and `resolveScenarioRunner`.
- `adws/core/__tests__/scenarioRunner.test.ts` — Both runners, one runner per mode, and the tag regex.
- `adws/phases/scenarioProjectSetup.ts` — `syncDeclaredScenarioProject`, the upgrade's default `syncScenarioProject`: sync the files, then install.
- `adws/phases/__tests__/scenarioProjectSetup.test.ts` — `web` syncs and installs, `cli`/missing/unknown do neither.
- `adws/phases/__tests__/stepDefPhase.test.ts` — The runner mode reaches the agent; a missing profile is non-fatal.
- `adws/phases/__tests__/stackCoherenceReporter.test.ts` — The `web` runner silences the descriptor-based warnings; `cli` is unchanged.
- `adws/__tests__/generateStepDefinitionsPrompt.test.ts` — Source-text drift tests over `generate_step_definitions.md`.
- `features/per-issue/step_definitions/feature-992*.ts` — Step definitions for the `@adw-992` scenarios that the scenario agent writes in `features/per-issue/feature-992.feature`.

## Implementation Plan
### Phase 1: Foundation
- Add the three templates.
- Add the pure and near-pure modules: `adwPlaywrightProject.ts` (constants, table, sync) and `scenarioRunner.ts` (runner table).
- Register `playwright-bdd` in `stepDefDetection.ts` and `stackCoherenceCheck.ts`.
- Add `declaredApplicationProfile` to the gate module.
- Remove `review_proof.md` from `REQUIRED_ADW_FILES`.
- Write the unit tests for each.

### Phase 2: Core Implementation
- `runScenarioProof` gains `env` and `proofDirPerTag`.
- `executeScenarioTestPhase` runs through the resolved runner and passes `ADW_APPLICATION_URL`.
- `executeUnitTestPhase` installs the runner's project before the static checks, and `reportStackCoherence` reads the runner's stack signals.
- The step-def agent and phase pass the runner mode.
- `generate_step_definitions.md` gains the `adw_playwright` mode, and `adw_init.md` changes in `hashInputs`, `$3` and steps 2, 6, 8 and 11.
- `adwUpgrade` syncs the project files and installs the project after the regen.

### Phase 3: Integration
- Every hand-built `WorkflowConfig` that runs these phases carries an application profile: unit-test helpers, the regression surface harness and the per-issue harnesses.
- Prompt drift tests pin the prompts to the constants and the mapping.
- The `@adw-992` step definitions drive the real phases and upgrade hermetically. The exception is the fresh-repository run, which runs the real Playwright stack (acceptance criterion 1).
- ADR-0061's `### Confirmation`, the README and `adws/README.md` describe what shipped.
- Run the full validation.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add the ADW Playwright project templates
- Create `templates/playwright/playwright.config.ts.template` with exactly this content: the spiked configuration plus one ownership comment. Paths are relative to `features/`.
  ```ts
  import { defineConfig } from '@playwright/test';
  import { defineBddConfig } from 'playwright-bdd';

  // ADW owns this file: it is identical in every web repository and overwritten on upgrade. Repository values arrive
  // only through ADW_APPLICATION_URL, ADW_PROOF_DIR and ADW_JUNIT_REPORT_PATH, and ADW starts the dev server itself.
  const testDir = defineBddConfig({
    features: '**/*.feature',
    steps: 'steps/**/*.ts',
  });

  export default defineConfig({
    testDir,
    outputDir: process.env.ADW_PROOF_DIR,
    reporter: [['list'], ['junit', { outputFile: process.env.ADW_JUNIT_REPORT_PATH }]],
    use: {
      baseURL: process.env.ADW_APPLICATION_URL,
      screenshot: 'on',
    },
  });
  ```
- Create `templates/playwright/package.json.template`. Use exact versions from the spike: no `^` or `~`.
  ```json
  {
    "name": "adw-scenarios",
    "private": true,
    "description": "ADW's Playwright project: runs this repository's Gherkin scenarios through playwright-bdd.",
    "devDependencies": {
      "@playwright/test": "1.63.0",
      "playwright-bdd": "9.2.1"
    }
  }
  ```
- Create `templates/playwright/gitignore.template`, one entry per line, with a trailing newline: `node_modules/`, `.features-gen/`, `test-results/`, `playwright-report/`, `blob-report/`. `test-results/` is Playwright's default output directory when a person runs the project without `ADW_PROOF_DIR`.
- Do not name any template `*.ts` or `package.json`. ADW's `tsconfig.json` includes every `**/*.ts`, and ADW has no `@playwright/test`.

### 2. Create `adws/core/adwPlaywrightProject.ts`
- Constants:
  - `ADW_PLAYWRIGHT_PROJECT_DIR = 'features'`;
  - `ADW_PLAYWRIGHT_STEP_DEF_DIR = 'features/steps'`;
  - `ADW_PLAYWRIGHT_TEMPLATE_DIR = path.join('templates', 'playwright')`;
  - `ADW_PLAYWRIGHT_SETUP_COMMAND = 'cd features && npm install --no-audit --no-fund && npx playwright install chromium'`, the first install in a repository: it writes `features/package-lock.json` and installs Chromium. The upgrade runs it, and `adw_init.md` step 6 names it;
  - `ADW_PLAYWRIGHT_INSTALL_COMMAND = 'cd features && (test -d node_modules || npm ci)'`;
  - `` ADW_PLAYWRIGHT_RUN_BY_TAG = `${ADW_PLAYWRIGHT_INSTALL_COMMAND} && npx bddgen && npx playwright test --grep "@{tag}\\b"` ``. The value written to the prompt and run by the shell is `… --grep "@{tag}\b"`.
- Comments on the run command, one line each:
  - the install guard runs first, because a worktree has no `features/node_modules` and `npx` would otherwise resolve `bddgen` on the registry without asking;
  - `\b` keeps `@adw-99` from selecting `@adw-992`, because `--grep` is a regular expression over the title and the tags.
- `enum ProjectFilePolicy { Overwrite = 'overwrite', CreateIfAbsent = 'create_if_absent', AppendMissingLines = 'append_missing_lines' }`.
- `interface AdwPlaywrightProjectFile { readonly template: string; readonly target: string; readonly policy: ProjectFilePolicy }`.
- `ADW_PLAYWRIGHT_PROJECT_FILES: readonly AdwPlaywrightProjectFile[]`:
  - `playwright.config.ts.template` → `features/playwright.config.ts`, `Overwrite`;
  - `package.json.template` → `features/package.json`, `CreateIfAbsent`, because step definitions may need packages the owner adds;
  - `gitignore.template` → `features/.gitignore`, `AppendMissingLines`, so an owner's lines survive and `node_modules/` is always ignored.
- Pure `appendMissingLines(existing: string, template: string): string`:
  - appends each non-empty template line that is not already an exact trimmed line of `existing`;
  - adds a newline separator when `existing` does not end with one;
  - returns `existing` unchanged when nothing is missing, so it is idempotent.
- `syncAdwPlaywrightProject(worktreePath: string, frameworkRepoRoot: string): readonly ProjectFileOutcome[]`, where `ProjectFileOutcome = { readonly target: string; readonly action: 'written' | 'kept' | 'appended' }`:
  - creates `features/` with `mkdirSync(..., { recursive: true })`;
  - applies each row through one small function per policy (guard clauses, no nesting beyond 2), and reads the template from `path.join(frameworkRepoRoot, ADW_PLAYWRIGHT_TEMPLATE_DIR, template)`;
  - lets a missing template throw. The caller decides what that means.
- Export the constants, enum, types, `appendMissingLines` and `syncAdwPlaywrightProject` from `adws/core/index.ts`.

### 3. Create `adws/core/scenarioRunner.ts`
- `interface ScenarioRunner`:
  - `readonly runByTagCommand: string`: `{tag}` placeholder, run from the worktree root;
  - `readonly stepDefDirectory: string`: relative to the worktree;
  - `readonly stepDefExtensions: readonly string[]`;
  - `readonly proofDirPerTag: boolean`;
  - `readonly installCommand: string | null`;
  - `readonly stackSignals: Pick<StackCoherenceInput, 'bddFramework' | 'runScenariosByTag'>`.
- `type ScenarioRunnerConfig = Pick<ProjectConfig, 'commands' | 'scenarios'>`.
- `const SCENARIO_RUNNERS: Readonly<Record<RunnerMode, (config: ScenarioRunnerConfig) => ScenarioRunner>>`:
  - `[RunnerMode.Descriptor]` is today's values:
    - `runByTagCommand: commands.runScenariosByTag`;
    - `stepDefDirectory: scenarios.stepDefDirectory`;
    - `stepDefExtensions: stepDefExtensionsFor(scenarios.bddFramework)` (import from `./stepDefDetection`);
    - `proofDirPerTag: false`, `installCommand: null`;
    - `stackSignals: { bddFramework: scenarios.bddFramework, runScenariosByTag: commands.runScenariosByTag }`.
  - `[RunnerMode.AdwPlaywright]` ignores the descriptors:
    - `ADW_PLAYWRIGHT_RUN_BY_TAG`, `ADW_PLAYWRIGHT_STEP_DEF_DIR`, `['.ts']`;
    - `proofDirPerTag: true`, with a comment: Playwright empties its output directory at the start of each run;
    - `installCommand: ADW_PLAYWRIGHT_INSTALL_COMMAND`;
    - `stackSignals: { bddFramework: '', runScenariosByTag: '' }`, with a comment: ADW's Node project is the same in every web repository and says nothing about the repository's own stack.
- `export function resolveScenarioRunner(runnerMode: RunnerMode, config: ScenarioRunnerConfig): ScenarioRunner`.
- No identifier named `applicationType` anywhere in the module.
- Export `ScenarioRunner`, `ScenarioRunnerConfig` and `resolveScenarioRunner` from the core barrel.
- `adws/core/__tests__/scenarioRunner.test.ts`:
  - descriptor mirrors the descriptors, including the extensions of `cucumber-js`, `behave` and an empty framework;
  - two different descriptor configs produce the same `adw_playwright` runner;
  - `Object.values(RunnerMode)` each resolve (one runner per mode);
  - substituting `adw-99` into `ADW_PLAYWRIGHT_RUN_BY_TAG` gives a `--grep` value that, as `new RegExp(value, 'gi')` as Playwright builds it, matches `"… @adw-99"` and `"… @adw-99 @adw-abc123-slug"` but not `"… @adw-992"`. Extract the quoted value from the substituted command in the test.
  - `@regression` does not match `@regressionx`.

### 4. Register `playwright-bdd` as a Gherkin runtime
- `adws/core/stepDefDetection.ts`: add `'playwright-bdd': ['.ts']` to `FRAMEWORK_EXTENSION_MAP`.
- `adws/core/stackCoherenceCheck.ts`: add `['playwright-bdd', 'javascript']` to `LANGUAGE_TOKENS`, before the generic tokens.
- Tests:
  - `stepDefDetection.test.ts`: `isGherkinFramework('playwright-bdd')` is true and `stepDefExtensionsFor('playwright-bdd')` is `['.ts']`.
  - `stackCoherenceCheck.test.ts`: `bddFramework: 'playwright-bdd'` raises no `non-gherkin-bdd` warning and infers `javascript`.

### 5. Add `declaredApplicationProfile` to `adws/phases/applicationTypeGate.ts`
- `export function declaredApplicationProfile(projectConfig: Pick<ProjectConfig, 'applicationType'>, profiles: ApplicationProfiles = APPLICATION_TYPE_PROFILES): ApplicationProfile | null`. It returns the resolved profile, or `null` where `resolveApplicationType` would park.
- One doc line: for callers that must never park, such as the upgrade that re-runs `adw_init`.
- It does not merge, park or log.
- Tests in `adws/phases/__tests__/applicationTypeGate.test.ts`:
  - `cli` returns the `cli` profile and `web` the `web` profile;
  - missing, blank and unknown return `null`;
  - a fake third type through `profiles` returns its profile;
  - no dependency is called.

### 6. Remove `review_proof.md` from the files `/adw_init` must produce
- `adws/phases/worktreeSetup.ts`:
  - `REQUIRED_ADW_FILES` becomes `commands.md`, `project.md`, `conditional_docs.md`, `providers.md`, `scenarios.md`;
  - fix the two "six" doc comments.
- `adws/phases/__tests__/worktreeSetup.test.ts`: a worktree without `.adw/review_proof.md` passes `verifyAdwRegen`.
- Leave `parseReviewProofMd`, `reviewProofConfig`, `loadProjectConfig`'s read of the file and ADW's own `.adw/review_proof.md` alone. The reviewer issue removes them.

### 7. `runScenarioProof`: extra environment and a proof directory per tag (`adws/phases/scenarioProof.ts`)
- Add the options `env?: Readonly<Record<string, string>>` and `proofDirPerTag?: boolean`, defaulting to `{}` and `false`.
- Per tag:
  - `const tagProofDir = proofDirPerTag ? path.join(artifactsDir, safeTagName) : artifactsDir`;
  - run with `{ ...env, ADW_JUNIT_REPORT_PATH: reportPath, ADW_PROOF_DIR: tagProofDir }`, so the framework variables always win.
- `ScenarioProofResult.artifactsDir` stays the parent, which the recursive harvest and the review upload read.
- The JUnit report paths do not change and stay outside `artifactsDir`.
- Unit tests (extend the existing `runScenarioProof` tests, or add `scenarioProof.env.test.ts`), with a stand-in command that echoes the variables into the report or the output:
  - `env` reaches the command;
  - `env` cannot override `ADW_PROOF_DIR` or `ADW_JUNIT_REPORT_PATH`;
  - with `proofDirPerTag`, each tag's `ADW_PROOF_DIR` is a distinct subdirectory of `artifactsDir`;
  - without it, `ADW_PROOF_DIR` is `artifactsDir` for every tag (the `cli` behaviour).

### 8. Scenario test phase: run through the resolved runner (`adws/phases/scenarioTestPhase.ts`)
- `const runner = resolveScenarioRunner(requireApplicationProfile(config).runnerMode, projectConfig)`. Import `resolveScenarioRunner` from `../core/scenarioRunner`, since the phase test mocks the `../core` barrel.
- Keep both skips:
  - `!scenariosMd.trim()`;
  - `runner.runByTagCommand.trim() === 'N/A'`. Only a descriptor runner can say `N/A`.
- Remove the now-unused `stepDefExtensionsFor` import and the destructuring of `runScenariosByTag`, `stepDefDirectory` and `bddFramework`.
- `runScenarioProof({ scenariosMd, reviewProofConfig, runByTagCommand: runner.runByTagCommand, issueNumber, proofDir, cwd: worktreePath, stepDefDirectory: runner.stepDefDirectory, stepDefExtensions: [...runner.stepDefExtensions], proofDirPerTag: runner.proofDirPerTag, env: { ADW_APPLICATION_URL: applicationUrl } })`.
- Leave the dev-server branch (`isDevServerConfigured`, `withDevServer`, `extractPort`) unchanged.
- `adws/phases/__tests__/scenarioTestPhase.test.ts`:
  - `makeConfig` gains `applicationProfile`, defaulting to `APPLICATION_TYPE_PROFILES.cli`;
  - a `web` profile calls `runScenarioProof` with `ADW_PLAYWRIGHT_RUN_BY_TAG`, `features/steps`, `['.ts']`, `proofDirPerTag: true` and `env.ADW_APPLICATION_URL === 'http://localhost:4567'`;
  - a `web` profile ignores a descriptor `N/A` (it runs) but still skips on an empty `scenariosMd`;
  - a `cli` profile keeps today's values and also gets `env.ADW_APPLICATION_URL`;
  - the dev server wraps the run in both modes when configured;
  - a config without a profile rejects with `requireApplicationProfile`'s error.

### 9. Unit-test phase: install the runner's project before the static checks; stack coherence from the runner
- `adws/phases/unitTestPhase.ts`: before `runStaticCheckGate`, add a small helper `installScenarioProject(config, runProcess)`:
  - it resolves the runner;
  - it returns when `installCommand` is `null`;
  - otherwise it runs the command with `runProcess` in `config.worktreePath`, then logs to the console and `execution.log`: on success, `Scenario project installed (…)`; on failure, a warning with the output.
  - It never throws on a failed command.
- Comment the ordering: the repository's own type check and lint may cover `features/**`, whose imports resolve only from `features/node_modules`.
- `adws/phases/stackCoherenceReporter.ts`: build the input as `{ testFramework: commands.testFramework, runTests: commands.runTests, ...runner.stackSignals }`.
- `adws/phases/__tests__/unitTestPhase.helpers.ts`: `makeConfig` sets `applicationProfile: APPLICATION_TYPE_PROFILES.cli` and accepts an override for the `web` profile.
- Tests in `unitTestPhase.test.ts`:
  - `web`: the first recorded process is `ADW_PLAYWRIGHT_INSTALL_COMMAND` in the worktree, followed by the four checks;
  - a failed install still runs all four checks and logs the failure;
  - `cli`: exactly the four checks, as the existing assertion expects.
- New `adws/phases/__tests__/stackCoherenceReporter.test.ts`, with a fake `repoContext` and `config.ctx`:
  - `web` with `pytest` test descriptors and ADW's Node command in `.adw/commands.md`: no `adw:unverified` label and no comment;
  - `cli` with the same mismatched descriptors: still labelled;
  - `cli` with a non-Gherkin framework: still warned.

### 10. Step-definition agent and phase pass the runner mode
- `adws/agents/stepDefAgent.ts`: `runStepDefAgent(issueNumber, adwId, runnerMode: RunnerMode, logsDir, statePath?, cwd?, issueBody?, contextPreamble?, launchContext?)`, with `args: [String(issueNumber), adwId, runnerMode]`.
- `adws/phases/stepDefPhase.ts`: inside the existing `try`, `const { runnerMode } = requireApplicationProfile(config)`, then pass it. A missing profile stays non-fatal: it is caught and logged by the existing `catch`.
- `features/per-issue/step_definitions/feature-929-agents.ts`: pass `RunnerMode.Descriptor` in its `runStepDefAgent` call.
- New `adws/phases/__tests__/stepDefPhase.test.ts`, mocking `../agents` `runStepDefAgent`:
  - a `web` profile passes `RunnerMode.AdwPlaywright`;
  - a `cli` profile passes `RunnerMode.Descriptor`;
  - without a profile the agent is not called and the phase resolves.

### 11. `generate_step_definitions.md`: the `adw_playwright` mode
- `## Arguments`: add `` `$2` — Scenario runner mode chosen by ADW's application-type mapping: `adw_playwright` or `descriptor`. Empty means `descriptor` ``.
- Add a section `## Runner mode` before "Polymorphism on `.adw/scenarios.md`":
  - `descriptor`, or empty: the runner `.adw/scenarios.md` names. The rest of the prompt applies exactly as written.
  - `adw_playwright`: ADW's Playwright project in `features/`. The scenarios run on the Playwright test runner through `playwright-bdd`, under the configuration ADW owns. In this mode:
    - Write TypeScript step definitions under `features/steps/`, which the configuration loads as `features/steps/**/*.ts`. Do this whatever `## BDD Framework` and `## Step Def Directory` say, and whatever language the application is written in.
    - Register steps with `createBdd()` from `playwright-bdd`. Include a short example: `import { expect } from '@playwright/test'; import { createBdd } from 'playwright-bdd'; const { Given, When, Then } = createBdd();`, then one `Given` that takes `{ page }` and calls `page.goto('/')`, and one `Then` with a `{string}` parameter that asserts with `expect(page.getBy…)`.
    - A step receives Playwright's fixtures as its first argument and the step's parameters after it.
    - Take the `page` fixture in every step that looks at or acts on what a user sees. The configuration captures an end-state screenshot of every scenario that uses `page`, and that image is the review's visual evidence. A step about pure logic or an HTTP API may take `request` instead.
    - Navigate with paths relative to the application. ADW starts the dev server and gives its address to the configuration as `baseURL` (`ADW_APPLICATION_URL`). Never hard-code a host or port, start a server, or add a `webServer` block.
    - Use Cucumber-expression patterns (`{string}`, `{int}`) and `expect` from `@playwright/test`.
    - Never edit `features/playwright.config.ts` or `features/.gitignore`; ADW owns them.
    - Section 5's mock infrastructure belongs to the descriptor runner and does not apply here.
- Step 1: in `adw_playwright` mode, the step-def directory is `features/steps`. `## Vocabulary Registry` validation (Step 4a) applies in both modes.
- Step 3: in `adw_playwright` mode, read every `.ts` file under `features/steps/`. A pattern registered twice makes `bddgen` fail.
- Step 6: write files with the mode's idiom and directory.
- Step 7: in `adw_playwright` mode, the check is `cd features && (test -d node_modules || npm ci) && npx bddgen`, the install-and-generate part of `## Run Scenarios by Tag`:
  - `bddgen` loads the steps as the runner does and fails on an undefined or duplicate step;
  - it is the one exception to the rule against loading step files;
  - never run `npx bddgen` without the install guard, and do not run `npx playwright test`.
- The output JSON is unchanged.
- Do not touch `scenario_writer.md`.

### 12. `adw_init.md`
- Frontmatter: add `templates/playwright/playwright.config.ts.template`, `templates/playwright/package.json.template` and `templates/playwright/gitignore.template` to `hashInputs`.
- `$3` description: also used by step 6 to locate `templates/playwright/`.
- Step 2, `## Start Dev Server`: replace the bullets with:
  - application type `web`: the framework's dev command with `{PORT}` substituted (e.g. `npm run dev -- --port {PORT}`, `bunx next dev --port {PORT}`, `python manage.py runserver 0.0.0.0:{PORT}`), whatever test runners the repository has. ADW starts and stops the server and hands its address to its Playwright project, and that configuration has no `webServer` block. A `webServer` block in the repository's own e2e configuration is ignored.
  - `cli`, or undecided: `N/A`.
  - Keep the `{PORT}` note.
- Step 2: `## Run Scenarios by Tag` and `## Run Regression Scenarios` take the step-8 values, which are ADW's commands for `web`. Update the closing note: "(ADW's Playwright project for `web`; Cypress, Cucumber or default Cucumber otherwise)".
- Replace step 6 with **"6. Install ADW's Playwright project (`web` only)"**:
  - Skip when the type written in step 3 is not `web`, and report `not applicable`. If `$3` is empty, skip and warn in step 11 that the repository's scenarios cannot run.
  - The project is a self-contained Node project, installed even when the application is not Node. It never touches the application's own package management.
  - Any existing e2e setup elsewhere (its own Playwright, Cypress or Cucumber configuration, tests and dependencies) is left as it is, and ADW does not use it.
  - Bash, run from the repository root:
    - `mkdir -p features`;
    - `cp "$3/templates/playwright/playwright.config.ts.template" features/playwright.config.ts`, which always overwrites, even an edited file;
    - `[ -f features/package.json ] || cp "$3/templates/playwright/package.json.template" features/package.json`;
    - `touch features/.gitignore`, then append each line of `"$3/templates/playwright/gitignore.template"` that `features/.gitignore` lacks, using a `grep -qxF` loop.
  - When `features/package.json` already existed, set its `devDependencies` versions of `@playwright/test` and `playwright-bdd` to the template's, and change nothing else.
  - Install: `(cd features && npm install --no-audit --no-fund && npx playwright install chromium)`, which is `ADW_PLAYWRIGHT_SETUP_COMMAND` in a subshell. The upgrade runs the same command again after the agent. This writes `features/package-lock.json`. Each ADW worktree installs from that lockfile with `npm ci`, so it is committed together with `package.json`, the configuration and `.gitignore`; `features/.gitignore` keeps `node_modules/` and `.features-gen/` out.
  - Never edit `features/playwright.config.ts` afterwards, never add a `webServer` block, and never convert or delete existing step definitions: the owner decides what to rewrite.
- Step 8:
  - Delete the **Playwright** branch.
  - Add, first: **If the application type is `web`**, whatever scenario tooling the repository has:
    - `## Scenario Directory` → `features/`;
    - `## Run Scenarios by Tag` → `cd features && (test -d node_modules || npm ci) && npx bddgen && npx playwright test --grep "@{tag}\b"`;
    - `## Run Regression Scenarios` → `cd features && (test -d node_modules || npm ci) && npx bddgen && npx playwright test --grep "@regression\b"`;
    - `## BDD Framework` → `playwright-bdd`;
    - `## Step Def Directory` → `features/steps`.
  - The Cypress, Cucumber and default branches apply otherwise, unchanged.
  - Observability classification: a `web` repository is **browser-test-equipped**, because ADW's project gives it Playwright.
- Step 11:
  - remove `review_proof.md` from the list of files created;
  - add a line for the Playwright project: `not applicable (<type>)`, or each file `written`, `kept` or `appended`, plus the outcome of `npm install` and of the browser install;
  - keep every other line.
- Keep the step numbering, so steps 7–11 and every "step N" reference stay valid.

### 13. Upgrade: overwrite the project's files from the templates
- New `adws/phases/scenarioProjectSetup.ts`:
  - `export type ScenarioProjectSyncResult = { readonly kind: 'synced'; readonly files: readonly ProjectFileOutcome[] } | { readonly kind: 'not_applicable' }`;
  - `export async function syncDeclaredScenarioProject(worktreePath: string, frameworkRepoRoot: string, runProcess: ProcessRunner = runShellCommand): Promise<ScenarioProjectSyncResult>`. It calls `declaredApplicationProfile(loadProjectConfig(worktreePath))`. When the profile's `runnerMode` is `RunnerMode.AdwPlaywright`:
    - it calls `syncAdwPlaywrightProject`;
    - then it runs `ADW_PLAYWRIGHT_SETUP_COMMAND` with `runProcess` in the worktree, and throws with the command's `output` when `exitCode` is not 0.
  - Otherwise it returns `not_applicable` and runs nothing.
  - Comment the install, one line: every worktree's `npm ci` installs from the `features/package-lock.json` it writes, so the regen commit must carry that file whatever the agent did.
- `adws/adwUpgrade.tsx`:
  - `UpgradeDeps` gains `readonly syncScenarioProject: (worktreePath: string, frameworkRepoRoot: string) => Promise<ScenarioProjectSyncResult>`, and `buildDefaultUpgradeDeps` sets it to `(worktreePath, frameworkRepoRoot) => syncDeclaredScenarioProject(worktreePath, frameworkRepoRoot)`.
  - In `executeUpgrade`, right after `verifyAdwRegen` passes, await it inside `try`:
    - on success, log `adwUpgrade: scenario project <kind>`;
    - on throw (a missing template or a failed install), post `buildUpgradeFailureComment(String(error), …)` and return `{ outcome: 'failed', reason: 'scenario_project_error' }`.
  - It runs before `writeAdwVersion` and `commitChanges`, so the files and the lockfile ride in the regen commit.
- `adws/__tests__/adwUpgrade.test.ts`:
  - `makeDeps` gains `syncScenarioProject: vi.fn().mockResolvedValue({ kind: 'not_applicable' })`;
  - it is called once, with the worktree and framework root, after `verifyAdwRegen` and before `writeAdwVersion` and `commitChanges` (check the order of `mock.invocationCallOrder`);
  - it is not called when verification fails;
  - a rejection yields `scenario_project_error`, a failure comment, and no commit.
- New `adws/phases/__tests__/scenarioProjectSetup.test.ts`, over a temp worktree using the real templates (`REPO_ROOT`) and a recording fake `runProcess`:
  - `web` writes the three files, and the configuration is byte-identical to the template;
  - `web` then runs `ADW_PLAYWRIGHT_SETUP_COMMAND` once, in the worktree, after the files exist;
  - a non-zero exit of the install throws, with its output in the message;
  - a modified `features/playwright.config.ts` is overwritten;
  - an existing `features/package.json` is kept byte for byte;
  - `cli`, missing and unknown types return `not_applicable`, write nothing and run no process.

### 14. Give every hand-built `WorkflowConfig` that runs these phases an application profile
- `adws/phases/__tests__/scenarioTestPhase.test.ts` and `adws/phases/__tests__/unitTestPhase.helpers.ts`: done in tasks 8 and 9.
- `features/regression/support/phaseConfig.ts` `buildConfigFor`: resolve the profile from `loadProjectConfig(worktreePath)` as `initializeWorkflow` does, using `declaredApplicationProfile`. Assert it is known, with a message naming the fixture's `.adw/project.md`, and set `applicationProfile`. The `cli-tool` fixture declares `cli`.
- `features/per-issue/step_definitions/feature-929-workflow.ts` (`createWorkflow`) and `feature-937-workflow.ts`: set `applicationProfile: APPLICATION_TYPE_PROFILES.cli`.
- Search for any other hand-built config that reaches `executeScenarioTestPhase`, `executeUnitTestPhase`, `executeStepDefPhase` or `reportStackCoherence`, and add the profile there too: `grep -rln "executeScenarioTestPhase\|executeUnitTestPhase\|executeStepDefPhase\|reportStackCoherence" adws features`.

### 15. Source-text drift tests for the prompts
- `adws/__tests__/adwInitPrompt.test.ts`:
  - every file in `templates/playwright/` appears in `adw_init.md`'s `hashInputs:` frontmatter list, so a template edit bumps the hash;
  - the prompt contains `ADW_PLAYWRIGHT_RUN_BY_TAG` verbatim, and the same command with `{tag}` replaced by `regression`;
  - step 6 copies each template named in `ADW_PLAYWRIGHT_PROJECT_FILES` to its `target`;
  - step 6 contains `ADW_PLAYWRIGHT_SETUP_COMMAND` verbatim, the command the upgrade runs after the agent;
  - the prompt contains no `bunx playwright test --grep` and no `tests/e2e/`, so the old branch is gone;
  - step 6 no longer creates `.adw/review_proof.md` (no `Create \`.adw/review_proof.md\`` heading);
  - step 2 no longer maps a `webServer` block to `N/A`;
  - the existing application-type tests stay green, since step numbering is unchanged.
- New `adws/__tests__/generateStepDefinitionsPrompt.test.ts`:
  - the prompt names every `Object.values(RunnerMode)`;
  - its `adw_playwright` section names `createBdd`, `playwright-bdd`, `{ page }` and `ADW_PLAYWRIGHT_STEP_DEF_DIR`;
  - it contains the install-and-generate check `cd features && (test -d node_modules || npm ci) && npx bddgen`;
  - `$2` is documented.
- `adws/core/__tests__/adwPlaywrightProject.test.ts`, which pins the decisions in the templates:
  - the configuration template uses `defineBddConfig`, `'**/*.feature'`, `'steps/**/*.ts'`, `process.env.ADW_PROOF_DIR`, `process.env.ADW_JUNIT_REPORT_PATH`, `process.env.ADW_APPLICATION_URL`, `['list']`, `'junit'` and `screenshot: 'on'`, and contains no `webServer`;
  - the package template pins exact versions (`/^\d+\.\d+\.\d+$/`) of `@playwright/test` and `playwright-bdd`;
  - the gitignore template holds `node_modules/` and `.features-gen/`;
  - sync over a temp directory: written, overwritten, kept, appended, idempotent on a second run, and a missing template throws;
  - `appendMissingLines` cases: no trailing newline, an existing owner line, nothing missing.
- These vitest tests are the source-text coverage of `adw_init` and the generators that acceptance criterion 4 asks for. The regression suite's rot rubric forbids source-reading steps in `features/regression/`, and today's prompt drift tests live in `adws/__tests__/adwInitPrompt.test.ts`.

### 16. Step definitions for the `@adw-992` scenarios
- Implement the steps of `features/per-issue/feature-992.feature`, written by the scenario agent, in `features/per-issue/step_definitions/feature-992*.ts`. Keep each file under 300 lines.
- Keep them hermetic, except the fresh-repository run described below:
  - never reach the npm registry or download a browser;
  - put a stand-in `npx` and `npm` first on `PATH`, modelled on `features/regression/support/launchRecorder.ts`;
  - the stand-in records argv, cwd and the `ADW_*` variables;
  - for `playwright test`, it writes a JUnit report with an `[[ATTACHMENT|<png>]]` line to `ADW_JUNIT_REPORT_PATH` and a PNG under `ADW_PROOF_DIR`;
  - for the upgrade's `npm install` and `npx playwright install`, it records the call and creates `features/node_modules/`. The real upgrade is then checked against "the upgrade installed the packages … and the Playwright browser, in `features/`", "the upgrade installed nothing in `features/`" and "the regen commit holds nothing under `features/node_modules/`";
  - pre-create `features/node_modules/` in the throwaway worktree, so the install guard is skipped, or let the stand-in `npm ci` record the call.
- The real code under test:
  - the scenario-phase scenarios ("When the workflow's scenario test phase runs") drive the real `executeScenarioTestPhase` with the profile their `.adw/project.md` declares, not `runScenarioProof` alone. The dev server, its address in `ADW_APPLICATION_URL` and its stop by the end of the phase belong to the phase;
  - the generator-mode scenarios drive the real `executeStepDefPhase`. The 929 harness's throwaway CLI records `/generate_step_definitions` and its arguments, so the mode is read from the recorded `$2`;
  - the upgrade scenarios drive the real `executeUpgrade` through `feature-931.steps.ts`'s harness (`configureAdwInitAgent` with a `web` `.adw/project.md`, `regenCommitFile`). Extend the harness's `Before`/`After` tag expression to `@adw-931 or @adw-991 or @adw-992`, so these scenarios get a fresh world and their temporary directories are removed. Put the stand-ins first on `PATH` for every upgrade scenario except the fresh-repository run.
- The fresh-repository run is the scenario "In a fresh "web" repository the framework upgrade initialised, a per-issue scenario run writes its JUnit report to ADW's path and an end-state image for the scenario that opens a page, and none for the one that does not". It checks acceptance criterion 1 end to end. An end-state image for the scenario that takes `page`, and none for the one that does not, is Playwright's own behaviour, which a stand-in could only imitate. So:
  - it runs the real `npm` and `npx`: the upgrade's install from the registry and the Chromium download, `npm ci` in the fresh worktree, and a real `bddgen` and `playwright test`;
  - its fixture is a minimal web application. Its dev server, a Node `http` script started on `{PORT}`, serves a page titled "Widgets" at `/`, answers 200 at `/health`, and records the paths it served;
  - its `createBdd()` step files are written into the temporary repository at run time;
  - it needs network access. Give its steps a timeout long enough for the first install.
- Never add a `.ts` file that imports `@playwright/test` or `playwright-bdd` anywhere in ADW's tree. ADW's `tsc` includes every `.ts` file, and ADW does not depend on them. Write such files into temp directories at run time, or as `.template` text.
- The `@adw-992` run also includes two existing outlines that carry the tag:
  - feature-989's protected-path outline. The guard already rejects edits to `features/playwright.config.ts`, so nothing changes;
  - feature-991's upgrade outline. Its `web` row now syncs and installs the project through the harness.
- Do not re-declare phrases that other step files already register (`@adw-931`, `@adw-991`).

### 17. Records
- ADR-0061 `### Confirmation`: rewrite "Partly implemented. Checked on <date> in the working tree on top of <sha>". Add bullets naming:
  - the project: `templates/playwright/*.template`, `adws/core/adwPlaywrightProject.ts` (`ADW_PLAYWRIGHT_RUN_BY_TAG`, `ADW_PLAYWRIGHT_PROJECT_FILES`, `syncAdwPlaywrightProject`), `adw_init.md` steps 2, 6 and 8, and the upgrade's `syncScenarioProject`. Tests: `adwPlaywrightProject.test.ts`, `adwInitPrompt.test.ts`, `adwUpgrade.test.ts`, `scenarioProjectSetup.test.ts`;
  - the runner: `adws/core/scenarioRunner.ts`, `scenarioTestPhase.ts` (`ADW_APPLICATION_URL` in both modes, one output directory per tag in `web` mode) and `unitTestPhase.ts` (install before the static checks). Tests: `scenarioRunner.test.ts`, `scenarioTestPhase.test.ts`, the `runScenarioProof` tests, `unitTestPhase.test.ts`;
  - the generator's `web` mode: `generate_step_definitions.md` `$2` and `stepDefPhase.ts`. Tests: `generateStepDefinitionsPrompt.test.ts`, `stepDefPhase.test.ts`;
  - the scenarios: `features/per-issue/feature-992.feature` (`@adw-992`).
- In "Still open", keep the proof assembler's evidence selection and the review prompt's per-type guidance sections. Remove the three items this issue delivers.
- Keep the spike limits. Add whether a real web application has been run, and which one.
- `README.md`:
  - extend the application-type bullet with the ADW Playwright project for `web`;
  - in `### 4. Bootstrap a target repo with /adw_init`, add a paragraph: `web` gets `features/` with the owned configuration, `npm install` and the browser; upgrades overwrite the configuration; existing e2e setups are untouched; `adw_init` no longer writes `.adw/review_proof.md`;
  - add `templates/playwright/` to the tree.
- `adws/README.md` `### BDD Scenario Configuration`: add a paragraph on the `web` runner (`features/`, `playwright-bdd`, `features/steps`, ADW's commands, `ADW_APPLICATION_URL`) and on `cli` being unchanged.

### 18. Run the validation commands
- Run every command in `Validation Commands`, and fix every failure before finishing.

## Testing Strategy
### Unit Tests
- `adws/core/__tests__/scenarioRunner.test.ts`:
  - the descriptor runner equals the descriptors, including extensions per framework;
  - the `adw_playwright` runner is fixed regardless of the descriptors;
  - every `RunnerMode` has a runner;
  - the substituted `--grep` regex selects `@adw-99` and rejects `@adw-992`;
  - `@regression` rejects `@regressionx`.
- `adws/core/__tests__/adwPlaywrightProject.test.ts`:
  - the templates pin the decisions: the env variables, `screenshot: 'on'`, `list` and `junit`, the globs, no `webServer`, exact versions, the gitignore entries;
  - sync policies: overwrite, create-if-absent, append-missing-lines; idempotent; a missing template throws;
  - `appendMissingLines` edge cases.
- `adws/core/__tests__/stepDefDetection.test.ts`, `adws/core/__tests__/stackCoherenceCheck.test.ts`: `playwright-bdd` is a Gherkin `.ts` runtime and infers JavaScript.
- `adws/phases/__tests__/applicationTypeGate.test.ts`: `declaredApplicationProfile` returns the profile for `cli`, `web` and a fake third type, `null` for missing or unknown, and calls no dependency.
- `adws/phases/__tests__/worktreeSetup.test.ts`: `verifyAdwRegen` passes without `review_proof.md`.
- `runScenarioProof` tests:
  - `env` passthrough;
  - the framework variables win;
  - a distinct `ADW_PROOF_DIR` per tag under `artifactsDir` with `proofDirPerTag`;
  - unchanged without it.
- `adws/phases/__tests__/scenarioTestPhase.test.ts`:
  - the `web` and `cli` runner values reach `runScenarioProof`;
  - `ADW_APPLICATION_URL` in both modes;
  - `N/A` skips only the descriptor;
  - the dev-server wrap is unchanged;
  - a missing profile rejects.
- `adws/phases/__tests__/unitTestPhase.test.ts`:
  - `web` runs the install command first, in the worktree, then the four checks;
  - a failed install is non-fatal;
  - `cli` runs only the four checks.
- `adws/phases/__tests__/stackCoherenceReporter.test.ts`: `web` with a Python test stack is not labelled; `cli` mismatch and non-Gherkin warnings are unchanged.
- `adws/phases/__tests__/stepDefPhase.test.ts`: the runner mode reaches `runStepDefAgent` for `web` and `cli`; a missing profile is non-fatal.
- `adws/phases/__tests__/scenarioProjectSetup.test.ts`: `web` syncs from the real templates (overwrite, keep), then runs the setup command once in the worktree; a failed install throws; `cli`, missing and unknown write nothing and run nothing.
- `adws/__tests__/adwUpgrade.test.ts`: the sync is called after verify and before version and commit; it is skipped when verify fails; a throw gives `scenario_project_error`.
- `adws/__tests__/adwInitPrompt.test.ts`:
  - templates in `hashInputs`;
  - the run commands equal the constant;
  - the templates are copied to their targets;
  - step 6 runs `ADW_PLAYWRIGHT_SETUP_COMMAND`;
  - the old Playwright branch, the `review_proof.md` step and the `webServer` → `N/A` rule are gone.
- `adws/__tests__/generateStepDefinitionsPrompt.test.ts`: every `RunnerMode` value is named, plus `createBdd`, `playwright-bdd`, `{ page }`, `features/steps`, the guarded `bddgen` check, and `$2`.
- `adws/core/__tests__/applicationType.test.ts` (existing): still green. No new module names `applicationType`.

### Edge Cases
- A `web` repository whose own Playwright, Cypress or Cucumber setup already exists: `adw_init` writes ADW's project in `features/` and ignores the other setup. `## Start Dev Server` is still the dev command, never `N/A` because of a foreign `webServer` block.
- A `web` repository that already has `features/package.json` (an old cucumber-js project): it is kept, with the two versions aligned by `adw_init`, and the upgrade does not overwrite it.
- A `web` repository with its own `features/.gitignore`: the owner's lines are kept, the template's missing lines are appended once, and a second sync changes nothing.
- An edited `features/playwright.config.ts`: the next upgrade restores it byte for byte. A fix round that edits it is already rejected by the guard.
- A non-Node `web` application (Python): the project is still a Node project in `features/`. Stack coherence raises no `adw:unverified`, because ADW's project says nothing about the repository's stack.
- A fresh issue worktree without `features/node_modules`: the install guard runs `npm ci` before `bddgen`. `npx` never resolves `bddgen` on the registry. A failed `npm ci` stops the command before `bddgen`.
- A Node `web` repository whose root `tsconfig.json` or ESLint covers `features/**`: the project is installed before the static checks, so imports resolve.
- Issue numbers that prefix one another (`@adw-99` against `@adw-992`): `\b` keeps the per-issue run to its own scenarios.
- Several tags in one phase run: each tag gets its own output directory, so the per-issue images and their JUnit attachment paths survive a later regression run.
- `ADW_APPLICATION_URL` in `cli` mode: an extra variable only; the runner, commands, step definitions and proof directory are unchanged.
- A missing application profile on a hand-built config: the scenario phase rejects, the unit-test phase rejects, and the step-def phase logs and continues.
- `cli`, missing or unknown type during an upgrade: no Playwright files are written and nothing is installed. Missing or unknown types are parked later by the gate, not by the upgrade.
- An upgrade of a `web` repository whose install fails, for example without registry access: the upgrade fails with `scenario_project_error` and commits nothing, and the next upgrade tries again. A regen commit without `features/package-lock.json` would make `npm ci` fail in every worktree.
- A legacy `/adw_init` run with an empty `$3`: the project is skipped with a warning in the report, as the vocabulary copy is.
- A never-initialised repository upgraded after this change: there is no `review_proof.md`, and `verifyAdwRegen` still passes.
- A scenario that never takes `page`: the run passes with no image and no attachment. The proof line for that case belongs to the proof-assembler issue.

## Acceptance Criteria
- A fresh `web` repository initialised by `adw_init` has `features/playwright.config.ts` byte-identical to `templates/playwright/playwright.config.ts.template`, plus `features/package.json`, `features/package-lock.json` and `features/.gitignore`. Its installed `@playwright/test` and `playwright-bdd` are excluded from git, and the browser is installed. Nothing outside `features/` and `.adw/` changes apart from what `adw_init` already writes.
- In a `web` repository, the scenario test phase:
  - runs `npx bddgen` then `npx playwright test --grep "@<tag>\b"` from `features/`, after installing from the lockfile when needed;
  - passes `ADW_APPLICATION_URL`, `ADW_PROOF_DIR` and `ADW_JUNIT_REPORT_PATH`, with the dev server started through `withDevServer`;
  - leaves a JUnit report at `agents/<adwId>/scenario-test/junit-adw-<N>.xml` and one end-state image under `artifacts/adw-<N>/` per scenario that uses `page`.
- In a `cli` repository, the scenario phase runs `.adw/commands.md`'s command with the same step-definition directory, extensions and `ADW_PROOF_DIR` as before. The only difference is the additional `ADW_APPLICATION_URL`.
- `generate_step_definitions` receives `adw_playwright` in a `web` repository and writes `createBdd()` steps under `features/steps/` that take `page`. In a `cli` repository it receives `descriptor` and behaves as today.
- An upgrade of a `web` repository whose `features/playwright.config.ts` was modified commits the template's bytes for that file.
- An upgrade of a `web` repository installs, after the `/adw_init` agent, the packages `features/package.json` names and the browser in `features/`. It commits `features/package-lock.json` and nothing under `features/node_modules/`. An upgrade of a `cli` repository, or of one with no type, writes and installs nothing in `features/`.
- `adw_init.md` no longer has the Playwright branch in step 8, no longer writes `.adw/review_proof.md`, and lists the templates in `hashInputs`. `REQUIRED_ADW_FILES` no longer contains `review_proof.md`.
- `adws/triggers/promotionSweepDefaults.ts` and the sweep code are unchanged.
- Source-text tests cover the new mode of `adw_init` and the generator (`adwInitPrompt.test.ts`, `generateStepDefinitionsPrompt.test.ts`, `adwPlaywrightProject.test.ts`).
- ADR-0061's `### Confirmation` names the implemented checks.
- All validation commands pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint, including the new modules and tests.
- `bunx tsc --noEmit` — Root type check. It covers `features/**/*.ts`, so it also checks the harness changes and that no `.ts` file imports Playwright.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type check of `adws/`.
- `bun run build` — Build.
- `bun run test:unit` — The whole Vitest suite: the new and extended tests, plus `applicationType.test.ts`'s "only the gate names the type" rule.
- `bunx vitest run adws/core/__tests__/scenarioRunner.test.ts adws/core/__tests__/adwPlaywrightProject.test.ts adws/__tests__/adwInitPrompt.test.ts adws/__tests__/generateStepDefinitionsPrompt.test.ts adws/__tests__/adwUpgrade.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/stepDefPhase.test.ts adws/phases/__tests__/scenarioProjectSetup.test.ts adws/phases/__tests__/applicationTypeGate.test.ts adws/phases/__tests__/worktreeSetup.test.ts` — The feature's own tests, in isolation.
- `bunx tsx adws/core/hashComputer.ts` — Prints the framework hash. It fails if a `hashInputs` file, such as a new template, does not resolve.
- `bun run lint:git-guard` — No raw `git`/`gh` strings in the new code.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-992"` — This issue's scenarios, plus the feature-989 protected-path outline and the feature-991 upgrade outline, which also carry the tag. The fresh-repository run installs from the npm registry and downloads Chromium, so it needs network access.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-991 or @adw-931"` — The upgrade harness and the application-type scenarios still pass with the new upgrade dependency and the shared config's profile.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — The regression suite, including surface rows 06, 20, 21 and 22 with the profile on the harness config, the `@python-e2e` scenario proof, and the `@framework-hash` digest over the live checkout.

## Notes
- Follow `.adw/coding_guidelines.md` strictly:
  - guard clauses and nesting ≤ 2;
  - enums for named sets (`ProjectFilePolicy`), `readonly` data and no `any`;
  - pure modules (`scenarioRunner.ts`, `appendMissingLines`) with I/O at the edges (`syncAdwPlaywrightProject`, `scenarioProjectSetup.ts`);
  - files under 300 lines. `adwUpgrade.tsx` and `workflowInit.ts` are already over it: add only what is listed;
  - comments only for invariants and non-obvious reasons: the `\b`, the install guard, the per-tag directory, the stack signals, the ordering before the static checks.
- **No new library in ADW.** `@playwright/test@1.63.0` and `playwright-bdd@9.2.1` are installed by `adw_init` with `npm` into each `web` target repository's `features/`, not into ADW. ADW's `bun add <package>` is not needed.
- **Consumers read the profile.** `scenarioRunner.ts`, `scenarioProjectSetup.ts`, `stepDefPhase.ts`, `scenarioTestPhase.ts`, `unitTestPhase.ts` and `stackCoherenceReporter.ts` read `runnerMode`. Only `applicationTypeGate.ts` (`declaredApplicationProfile`) and `projectConfig.ts` name `applicationType`, as `applicationType.test.ts` enforces.
- **Interpretations, kept within the decisions.**
  - `--grep "@<tag>\b"`: still tag selection by `--grep`. The word boundary gives the exact-tag semantics cucumber's `--tags` has; without it, issue #99's run would also run #990–#999's scenarios.
  - The install guard (`test -d node_modules || npm ci`): this is "installs … in `features/`" carried into each fresh worktree. It also keeps `npx` from fetching an unrelated `bddgen` from the registry.
  - One output directory per tag in `web` mode: Playwright empties `outputDir` at the start of every run. Regression images now survive in their own subdirectory. ADR-0061 already accepts that `screenshot: 'on'` captures them, and ADR-0063's proof assembler, a later issue, selects the per-issue ones. Until then, the review phase's existing whole-directory upload includes them.
  - `ADW_APPLICATION_URL` in both modes: the PRD's **Scenario phase** module passes it "in addition to the existing variables". `cli` behaviour (runner, commands, step definitions) is unchanged.
  - "Commits": the upgrade lane's regen commit carries what `adw_init` wrote and what the upgrade's own sync and install wrote. The prompt adds no commit of its own, so the upgrade still lands one regen commit.
  - The upgrade runs the install itself. The issue gives "installs … installs the browser; commits" to `adw_init`, and `adw_init`'s TypeScript path is the upgrade lane. The install runs there for the same reason the file sync does. The regen commit then holds the lockfile every worktree's `npm ci` needs, even when the agent skipped step 6, and the `@adw-992` upgrade scenario can check the install.
- **Upgrade fan-out.** Listing the templates in `hashInputs` and editing `adw_init.md` bump the framework hash, so every registered target repository gets an upgrade PR.
  - `web` repositories gain the project and `## Start Dev Server` with `{PORT}`.
  - Their old cucumber-js step definitions are left alone (no migration). Until the owner rewrites them under `features/steps/`, `bddgen` fails on their undefined steps. This is the red regression baseline ADR-0061 accepts.
- **Before closing, test against a real web application, such as a Next.js app.** Check these risks the spike did not cover:
  - The root ESLint or a strict root `tsconfig.json` (`exactOptionalPropertyTypes`, restricted `types`) over `features/playwright.config.ts`. The fix-round guard protects that file, so a lint rule it breaks would stall the static-check fix loop.
  - ESLint over `features/.features-gen/` after an in-build scenario run.
  - Whether `features: '**/*.feature'` picks up `.feature` files from `features/node_modules`.
  - Parallel workers against one dev server, Scenario Outlines, and long scenario names.
  - Report what was run in ADR-0061's Confirmation.
- **Out of scope:**
  - the proof assembler's image selection and the "no scenario opened a page" line (ADR-0063);
  - the review prompt's per-type guidance;
  - turning a dev-server start failure into a failed review (ADR-0062);
  - removing `parseReviewProofMd`, `reviewProofConfig` and ADW's own `.adw/review_proof.md` (the reviewer issue);
  - `web`-mode guidance in `implement-tdd`. It already reads `## BDD Framework: playwright-bdd` and `## Step Def Directory: features/steps` from `.adw/scenarios.md`;
  - the future baseline gate, which will need the same install before its static checks.
- The document phase should give the new modules an owning `Owns:` entry in `.adw/conditional_docs.md`. Likely homes:
  - `adws/core/scenarioRunner.ts`, `adws/core/adwPlaywrightProject.ts`, `adws/phases/scenarioProjectSetup.ts` and `templates/playwright/**`: `app_docs/feature-gfv9kt-application-type-mapping.md`;
  - the phase changes: `app_docs/feature-9gjajh-test-and-scenario-phases.md`.
