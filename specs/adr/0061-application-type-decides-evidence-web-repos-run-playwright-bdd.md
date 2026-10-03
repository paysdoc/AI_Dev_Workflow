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

Not yet implemented; carried by `specs/prd/review-proof-redesign.md`. Checked on 2026-10-02 at `origin/dev`: `applicationType` still has no consumer; `adw_init.md` still writes no `## Application Type` and still has the Gherkin-plus-Playwright inconsistency; `scenarioTestPhase.ts` still passes only the two environment variables.

Spike limits, so that nobody takes more from it than it showed: not tested against a real framework application, with parallel workers, with Scenario Outlines, or with long scenario names.

## More Information

* Supersedes, in part, ADR-0031: "the runner behind it is the target repo's choice" no longer holds for `web` repositories, and the Playwright test runner returns, as the Gherkin runner rather than as a second test path. The removal of the old E2E machinery stands.
* Supersedes, in part, ADR-0043: "only the step-definition runtime varies" and the detected `## BDD Framework` descriptor now apply to `cli` repositories only; in `web` repositories the runtime is fixed by the framework. The Gherkin mandate and the JUnit rail stand.
* The `## Run E2E Tests` heading kept by ADR-0031 as the scenario writer's tool descriptor is unaffected.
