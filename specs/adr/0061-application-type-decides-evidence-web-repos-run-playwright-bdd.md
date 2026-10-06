---
status: accepted
date: 2026-10-02
recorded: 2026-10-04
provenance:
  - kind: transcript
    source: "Claude Code session 2dc3e364, 2026-10-01 to 2026-10-04"
supersedes: ["0031", "0043"]
superseded-by: []
---

# The application type decides the evidence; `web` repositories run their Gherkin on an ADW-owned Playwright project

## Context and Problem Statement

A review of a web application needs visual evidence; a review of a command-line tool does not. Nothing in ADW made that distinction work. Checked on 2026-10-01 at `c351b62b`:

* `## Application Type` in `.adw/project.md` is parsed (`ApplicationType = 'cli' | 'web'`, default `cli`) and has no consumer. `adw_init` never writes it. Only ADW's own repository carries the section.
* The scenario run receives `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR` and nothing else; no dev-server address reaches it.
* Whether a scenario run produces an image depends entirely on the target repository's own step definitions. Three web repositories were inspected: Vestmatic (cucumber-js, no browser library at all, 44 of 98 step files assert on source text), paysdoc.nl (cucumber-js with the `playwright` library, `page` a private variable in one step file), Millennium-admin (`@playwright/test`, no Cucumber, not ADW-initialised). No single ADW-generated hook could capture a screenshot in all three; my earlier claim that one could was falsified by that inspection.
* `adw_init` has a Playwright branch (`playwright test --grep "@{tag}"`) that contradicts the scenario writer, which always writes Gherkin.

The owner (2026-10-01): "the whole scenario test AND review design need to be overhauled" and "I don't want this to be a half-baked solution". On the inspected repositories: "paysdoc.nl is no longer relevant and vestmatic is being replaced."

The decision covers `.adw/project.md`, `adw_init`, the scenario writer, the step-definition generator, the scenario phase and the proof.

## Decision Drivers

* The evidence a review needs is a property of the kind of application, not of each repository's test setup.
* Gherkin stays the one scenario language ([ADR-0043](0043-multi-language-test-seam.md)); the promotion, sweep and vocabulary subsystems parse it.
* Screenshots must come from a mechanism ADW owns, or they will not come at all.
* The owner: "Playwright gives the most flexibility."

## Considered Options

For what decides the evidence: the application type alone; a per-repository evidence declaration; detection from the diff.

For the screenshot mechanism: a generated capture hook in each repository's step definitions; a Cucumber hook ADW injects; the Playwright test runner's own screenshots.

For running Gherkin under Playwright: `playwright-bdd`; rewriting scenarios as Playwright specs; keeping cucumber-js and adding a Playwright hook.

For where the scenario project lives: in `features/` itself; a separate directory; the repository's own package.

For `cli` repositories: unchanged runner from `.adw/scenarios.md`; the Playwright runner everywhere.

For already-initialised repositories: no migration; a one-off conversion command; treat a missing type as `cli`.

## Decision Outcome

* **`## Application Type` alone decides the evidence**, through a framework-owned mapping from type to scenario runner mode and evidence kinds. Two types now, `cli` and `web`; the mapping is built so a third can be added without touching the phases. `adw_init` detects and writes the type. A missing or unknown type parks the issue; there is no default.
* **`web` repositories run their Gherkin on the Playwright test runner through `playwright-bdd`.** Screenshots are the runner's own (`screenshot: 'on'`), one per scenario, attached to the JUnit report. Verified by a spike on 2026-10-02 (`@playwright/test` 1.63.0, `playwright-bdd` 9.2.1): tag selection by `--grep`, JUnit on ADW's path parsed by ADW's `readJUnitReport`, end-state image per scenario, `[[ATTACHMENT|path]]` link per test case, harvested by `harvestProofArtifacts`.
* **A self-contained Node scenario project in `features/`**, in Node and non-Node web repositories alike (verified with a Python application). `adw_init` installs the stack, writes `package.json` and the Playwright configuration there and commits; existing e2e setups are left alone and ignored. Feature paths are unchanged, so the sweep and promotion code need no change.
* **The Playwright configuration is fully ADW-owned**: byte-identical in every web repository, repository-specific values arrive through environment variables (`ADW_APPLICATION_URL`, `ADW_PROOF_DIR`, `ADW_JUNIT_REPORT_PATH`), overwritten at upgrade, protected by the guard of [ADR-0059](0059-fix-loops-no-progress-stop-and-suppression-guard.md). No override file. The configuration has no `webServer` block: ADW starts and stops the dev server ([ADR-0031](0031-active-test-phase-passive-review-judge.md) lifecycle, [ADR-0062](0062-dev-server-start-failure-is-a-failed-review.md) failure rule) and hands the address to the runner.
* **`cli` repositories are unchanged**: the runner named in `.adw/scenarios.md` (cucumber-js, behave, and so on), JUnit as the verdict, the seam of ADR-0043. Consequence: the scenario writer and the step-definition generator each have two modes, chosen by application type; in `web` mode step definitions are TypeScript using `createBdd()` from `playwright-bdd`.
* **No migration.** An already-initialised repository lacks the type section, so its issues park with a comment that says to re-run `adw_init`. In a web repository the re-run installs the Playwright project; the old step definitions are the owner's to rewrite or delete. ADW converts nothing. Rejected: reading a missing type as `cli`, because it would bring back the silent default and review web changes without visual evidence.

### Consequences

* Good, because screenshots exist in every web repository regardless of how its steps are written.
* Good, because one scenario language and one proof rail serve both types.
* Bad, because a web repository must accept a Node project in `features/`, and its step definitions must be TypeScript even when the application is not.
* Bad, because a re-initialised web repository has a regression suite that does not run until its step definitions are rewritten, so its issues park on a red baseline ([ADR-0060](0060-baseline-gate-on-the-base-branch.md)) until then.
* Bad, because `screenshot: 'on'` captures every scenario, including regression ones; ADR-0063 selects which are used.

### Confirmation

Partly implemented. Checked on 2026-10-06 in the working tree on top of `c3601f68`:

* The mapping: `adws/core/applicationType.ts` (`APPLICATION_TYPE_PROFILES`, `resolveApplicationType`). `cli` maps to the descriptor runner from `.adw/scenarios.md` and no images; `web` maps to the ADW Playwright project and per-issue images; a missing or unknown type resolves to a `missing_application_type` park. Consumers read the profile and never the type. Unit tests: `adws/core/__tests__/applicationType.test.ts` (both types, missing, unknown, a fake third type through the mapping, and the rule that only the config parser and the gate name `applicationType`).
* No default: `adws/core/projectConfig.ts` reads an absent or empty `## Application Type` as `null` (`parseApplicationType`, `getDefaultProjectConfig`). Unit tests: the `projectConfig` test files.
* The park: `adws/phases/applicationTypeGate.ts` (`runApplicationTypeGate`) runs in `initializeWorkflow` and `initializePRReviewWorkflow`. A missing or unknown type parks the workflow as `human_gated` with the `missing_application_type` comment of `adws/forge/parkComment.ts`, after merging the latest default branch once so that `## Retry` sees a re-run `adw_init`. `cli` or `web` proceeds, with the profile on `WorkflowConfig.applicationProfile` (`requireApplicationProfile`). `adwUpgrade`, which re-runs `adw_init`, never parks on the type. Unit tests: `adws/phases/__tests__/applicationTypeGate.test.ts` (including a fake third type that reaches the gate without a gate change), `adws/phases/__tests__/workflowInit.test.ts` and `adws/phases/__tests__/prReviewPhase.test.ts`.
* `adw_init`: `.claude/commands/adw_init.md` detects and writes `## Application Type`, preserves a value the owner set by hand, and leaves the section out when it cannot decide. `adws/__tests__/adwInitPrompt.test.ts` asserts that the types the prompt offers equal the mapping's keys.
* Scenarios: `features/per-issue/feature-991.feature` (`@adw-991`) covers the mapping and the config's missing type; the park and its comment, and the run that proceeds; `## Retry` after the default branch gains the type; an upgrade that commits the type `/adw_init` wrote, and one that commits no default when `/adw_init` wrote none.
* The project: `templates/playwright/` holds `playwright.config.ts.template`, `package.json.template` (exact versions of `@playwright/test` 1.63.0 and `playwright-bdd` 9.2.1) and `gitignore.template`; they are `hashInputs` of `adw_init.md`, so an edit to one upgrades every target repository. `adws/core/adwPlaywrightProject.ts` holds the commands (`ADW_PLAYWRIGHT_SETUP_COMMAND`, `ADW_PLAYWRIGHT_INSTALL_COMMAND`, `ADW_PLAYWRIGHT_RUN_BY_TAG`) and the file table `ADW_PLAYWRIGHT_PROJECT_FILES`: the configuration is overwritten, `features/package.json` is created only when absent, `features/.gitignore` gets the template's missing lines. `syncAdwPlaywrightProject` applies the table. `.claude/commands/adw_init.md` step 6 installs the project for a `web` repository (and no longer writes `.adw/review_proof.md`), step 2 gives a `web` repository the framework's dev command, and step 8 writes ADW's commands, `playwright-bdd` and `features/steps` in place of the old Playwright branch. The upgrade also runs the sync and the install itself, after the `/adw_init` agent and before the regen commit (`syncScenarioProject`, `adws/phases/scenarioProjectSetup.ts`), so the commit carries the configuration byte for byte and `features/package-lock.json` whatever the agent did; a failed install fails the upgrade as `scenario_project_error` and commits nothing. `REQUIRED_ADW_FILES` no longer holds `review_proof.md`. Tests: `adws/core/__tests__/adwPlaywrightProject.test.ts`, `adws/__tests__/adwInitPrompt.test.ts`, `adws/__tests__/adwUpgrade.test.ts`, `adws/phases/__tests__/scenarioProjectSetup.test.ts`, `adws/phases/__tests__/worktreeSetup.test.ts`.
* The runner: `adws/core/scenarioRunner.ts` (`resolveScenarioRunner`) turns the profile's runner mode into the command, step-definition directory and extensions, per-tag proof directory, install command and stack signals; `descriptor` returns today's values from `.adw/`, `adw_playwright` ignores them. `scenarioTestPhase.ts` runs through it and passes `ADW_APPLICATION_URL` in both modes; in `web` mode `runScenarioProof` gives each tag its own `ADW_PROOF_DIR`, because Playwright empties its output directory at the start of a run, and the run command selects with `--grep "@<tag>\b"` so that `@adw-99` does not select `@adw-992`. `unitTestPhase.ts` installs the project before the static checks, because a repository's own type check or lint may cover `features/**`. `playwright-bdd` is a registered Gherkin runtime, and the stack-coherence check reads the runner's signals, which are empty for ADW's project. Tests: `adws/core/__tests__/scenarioRunner.test.ts`, `adws/phases/__tests__/scenarioTestPhase.test.ts`, `adws/phases/__tests__/scenarioProofRun.test.ts`, `adws/phases/__tests__/unitTestPhase.test.ts`, `adws/phases/__tests__/stackCoherenceReporter.test.ts`, `adws/core/__tests__/stepDefDetection.test.ts`, `adws/core/__tests__/stackCoherenceCheck.test.ts`.
* The generator's `web` mode: `runStepDefAgent` takes the runner mode and passes it as `$2` of `generate_step_definitions.md`; `adw_playwright` writes TypeScript steps under `features/steps/` with `createBdd()` from `playwright-bdd`, taking the `page` fixture, and checks them with `bddgen`. `descriptor` is as before, and `scenario_writer.md` is unchanged. Tests: `adws/__tests__/generateStepDefinitionsPrompt.test.ts`, `adws/phases/__tests__/stepDefPhase.test.ts`.
* Scenarios: `features/per-issue/feature-992.feature` (`@adw-992`) drives the real `executeUpgrade`, `executeScenarioTestPhase` and `executeStepDefPhase`. Its upgrade scenarios put a stand-in `npm` and `npx` first on `PATH`; its fresh-repository scenario runs the real `npm`, `npx`, `bddgen` and Playwright with a Chromium download against a dev server written as a small Node program, and needs network access. It checks a JUnit report on ADW's path, an end-state image for the scenario that takes `page`, and none for the one that does not.
* A real application, run on 2026-10-06: a Next.js 16.4.0 application from `create-next-app` (App Router, TypeScript, ESLint, npm), in a scratch directory. ADW's `syncDeclaredScenarioProject` wrote and installed the project, and the real `executeScenarioTestPhase` started `next dev` through `withDevServer` and ran the tags `@regression` (twenty scenarios in five feature files, on five parallel workers against the one dev server) and `@adw-9999` (a Scenario Outline of three rows, a scenario title of 401 characters, and a scenario that takes only `request`). All passed. One image was attached to each scenario that took `page`, none to the `request` one; the images of the two tags sat in their own directories, and each JUnit attachment path resolved from the report's directory. A scenario of issue 99999 was not selected for issue 9999. A failing scenario made a blocker failure, with a failure screenshot attached. In a fresh clone of the committed repository the install guard ran `npm ci` from `features/package-lock.json` and every scenario passed, with a clean working tree afterwards (`node_modules/` and `.features-gen/` ignored). The repository's own `tsc --noEmit`, `eslint .` (Next's flat configuration, which lints `features/` and the generated specs) and `next build` passed with the project installed; without `features/node_modules`, `tsc` failed on `@playwright/test` and `playwright-bdd`, which is why the install runs before the static checks. `features/node_modules` held no `.feature` file, so the `**/*.feature` glob had nothing to pick up there.
* A limit that run found: the configuration reads `process.env.ADW_PROOF_DIR` and its two siblings as `string | undefined` by property access. A repository whose root `tsconfig.json` covers `features/**` and sets `exactOptionalPropertyTypes` or `noPropertyAccessFromIndexSignature` therefore fails its own type check on `features/playwright.config.ts`, which the fix-round guard does not let a fix round edit. Such a repository has to leave `features/` out of its own type check. `noUncheckedIndexedAccess`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` and `verbatimModuleSyntax` were tried and pass.

Still open, carried by `specs/prd/review-proof-redesign.md`:

* The proof assembler's evidence selection.
* The review prompt's per-type guidance sections.

Spike limits, so that nobody takes more from it than it showed: not tested against a real framework application, with parallel workers, with Scenario Outlines, or with long scenario names. Since then the real-application run above covers all four, on one framework (Next.js 16.4.0) and one dev server. Not run: another framework, a non-Node framework application, a root ESLint configuration stricter than Next's, a Playwright configuration with retries, or a large suite.

## More Information

* Supersedes, in part, ADR-0031: "the runner behind it is the target repo's choice" no longer holds for `web` repositories, and the Playwright test runner returns, as the Gherkin runner rather than as a second test path. The removal of the old E2E machinery stands.
* Supersedes, in part, ADR-0043: "only the step-definition runtime varies" and the detected `## BDD Framework` descriptor now apply to `cli` repositories only; in `web` repositories the runtime is fixed by the framework. The Gherkin mandate and the JUnit rail stand.
* The `## Run E2E Tests` heading kept by ADR-0031 as the scenario writer's tool descriptor is unaffected.
