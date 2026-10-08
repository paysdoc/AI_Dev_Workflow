@regression @web-playwright-project
Feature: A "web" repository runs its Gherkin on a Playwright project that ADW owns and the framework upgrade installs in "features/"

  ADW's Playwright project is "features/package.json" and "features/playwright.config.ts", written from ADW's templates.
  The fresh-repository scenario installs that project from the npm registry with the real "npm" and "npx" and runs it
  in a real Chromium, so it needs network access; it is tagged host-only, and the Docker leg, whose image has neither, leaves it out.

  Background:
    Given the ADW codebase is checked out

  Scenario Outline: The framework upgrade of a <stack> repository never initialised by ADW, whose "/adw_init" agent declares it "web", installs ADW's Playwright project in "features/" and commits it with the configuration byte-identical to ADW's template
    Given a target repository never initialised by ADW whose only manifest is "<manifest>"
    And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "web"
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And the regen commit's "features/playwright.config.ts" is byte-identical to ADW's Playwright configuration template
    And the regen commit's "features/package.json" depends on "@playwright/test" and "playwright-bdd"
    And the upgrade installed the packages "features/package.json" names, and the Playwright browser, in "features/"
    And the regen commit holds nothing under "features/node_modules/"
    And the regen commit leaves "<manifest>" as the default branch has it

    Examples:
      | stack  | manifest       |
      | Node   | package.json   |
      | Python | pyproject.toml |

  Scenario: The framework upgrade of a "web" repository adds ADW's Playwright project beside the repository's own e2e setup and cucumber-js steps, and leaves their files as they were
    Given a target repository initialised by an older framework version
    And the target repository's default branch has these files of its own:
      | file                                    |
      | package.json                            |
      | playwright.config.ts                    |
      | e2e/home.spec.ts                        |
      | features/home.feature                   |
      | features/step_definitions/home.steps.ts |
    And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "web"
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And the regen commit leaves each of those files as the default branch has it
    And the regen commit's "features/playwright.config.ts" is byte-identical to ADW's Playwright configuration template

  Scenario: The framework upgrade of a "web" repository whose "features/playwright.config.ts" was edited by hand overwrites it with ADW's template
    Given a target repository initialised by an older framework version
    And the target repository's default branch has this "features/playwright.config.ts":
      """
      import { defineConfig } from '@playwright/test';
      import { defineBddConfig } from 'playwright-bdd';

      export default defineConfig({
        testDir: defineBddConfig({ features: '**/*.feature', steps: 'steps/**/*.ts' }),
        use: { baseURL: 'http://localhost:3000', screenshot: 'off' },
        webServer: { command: 'npm run dev', url: 'http://localhost:3000' },
      });
      """
    And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "web"
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And the regen commit's "features/playwright.config.ts" is byte-identical to ADW's Playwright configuration template

  Scenario: A change to ADW's Playwright configuration template changes the framework content hash, which decides when a repository is upgraded
    Given a fixture framework copied from the ADW framework under test
    When the framework content hash is computed for the fixture framework
    And ADW's Playwright configuration template in the fixture framework is modified by a single byte
    And the framework content hash is computed for the fixture framework
    Then the recorded hashes are all different

  Scenario Outline: The framework upgrade commits no Playwright project and installs nothing in "features/" when the ".adw/project.md" the "/adw_init" agent writes <declaration>
    Given a target repository never initialised by ADW
    And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" <declaration>
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And the regen commit holds no "features/playwright.config.ts"
    And the regen commit holds no "features/package.json"
    And the upgrade installed nothing in "features/"

    Examples:
      | declaration                          |
      | declares the application type "cli"  |
      | has no "## Application Type" section |

  Scenario Outline: The framework upgrade of a "<type>" repository never initialised by ADW completes when the "/adw_init" agent writes no ".adw/review_proof.md", and commits none
    Given a target repository never initialised by ADW
    And the "/adw_init" agent writes an ADW configuration with no ".adw/review_proof.md", whose ".adw/project.md" declares the application type "<type>"
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And the regen commit holds no ".adw/review_proof.md"

    Examples:
      | type |
      | cli  |
      | web  |

  Scenario: In a "web" repository the scenario test phase starts the dev server and runs "npx bddgen" and then "npx playwright test --grep" for the issue's tag in "features/", giving the run the dev server's address and ADW's report and proof paths
    Given a workflow for issue 9921 whose worktree's ".adw/project.md" declares the application type "web"
    And the worktree's ".adw/commands.md" starts a dev server that answers on its health check path
    And the worktree holds a feature tagged "@adw-9921" in "features/per-issue/" and steps for it in "features/steps/"
    And "npx" is a stand-in that records each run and writes a JUnit report in which every scenario passes
    When the workflow's scenario test phase runs
    Then "npx bddgen" ran in "features/" before "npx playwright test --grep" ran there for the tag "@adw-9921"
    And the run of "npx playwright test --grep" for the tag "@adw-9921" was given "ADW_APPLICATION_URL" holding the address of the dev server ADW started
    And the run of "npx playwright test --grep" for the tag "@adw-9921" was given "ADW_JUNIT_REPORT_PATH" holding the scenario proof's report path for that tag, and "ADW_PROOF_DIR" holding a directory of that tag's own inside the scenario proof's artifacts directory
    And the dev server ADW started answered throughout the run of "npx playwright test --grep" for the tag "@adw-9921", and was stopped by the end of the phase
    And the scenario proof records no blocker failures

  Scenario: In a "web" repository a scenario that fails in the JUnit report the Playwright run writes to ADW's path is a blocker failure for the issue's tag, although "npx playwright test" exits 0
    Given a workflow for issue 9922 whose worktree's ".adw/project.md" declares the application type "web"
    And the worktree's ".adw/commands.md" starts a dev server that answers on its health check path
    And the worktree holds a feature tagged "@adw-9922" in "features/per-issue/" and steps for it in "features/steps/"
    And "npx" is a stand-in that records each run, exits 0, and writes a JUnit report in which one scenario fails
    When the workflow's scenario test phase runs
    Then the scenario proof records a blocker failure for the tag "@adw-9922"

  Scenario: A "web" repository whose ".adw/" still names cucumber-js has its scenarios run on ADW's Playwright project, and cucumber-js is not run
    Given a workflow for issue 9923 whose worktree's ".adw/project.md" declares the application type "web"
    And the worktree's ".adw/commands.md" starts a dev server that answers on its health check path
    And the worktree's ".adw/" runs scenarios by tag with "npx cucumber-js --tags @{tag}"
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-js" and the step definition directory "features/step_definitions"
    And the worktree holds a feature tagged "@adw-9923" in "features/per-issue/" and steps for it in "features/steps/"
    And "npx" is a stand-in that records each run and writes a JUnit report in which every scenario passes
    When the workflow's scenario test phase runs
    Then "npx bddgen" ran in "features/" before "npx playwright test --grep" ran there for the tag "@adw-9923"
    And "npx cucumber-js" was not run

  Scenario: In a "cli" repository the scenario test phase runs the scenario command ".adw/" configures for the issue's tag from the worktree's root, and runs neither "npx bddgen" nor "npx playwright test"
    Given a workflow for issue 9924 whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-9924" and steps for it in the step definition directory ".adw/scenarios.md" names
    And "npx" is a stand-in that records each run
    When the workflow's scenario test phase runs
    Then the scenario command ".adw/" configures ran in the worktree's root for the tag "@adw-9924"
    And "npx bddgen" was not run
    And "npx playwright test --grep" was not run
    And the scenario proof records no blocker failures

  Scenario: In a "web" repository the step-definition phase starts the generator in the mode for ADW's Playwright project
    Given a workflow for issue 9926 whose worktree's ".adw/project.md" declares the application type "web"
    When the workflow's step-definition phase runs
    Then the step-definition generator was started once, for issue 9926
    And the step-definition generator was started in the mode for ADW's Playwright project

  Scenario: In a "cli" repository the step-definition phase starts the generator in the mode for the scenario runner that ".adw/scenarios.md" describes
    Given a workflow for issue 9927 whose worktree's ".adw/project.md" declares the application type "cli"
    When the workflow's step-definition phase runs
    Then the step-definition generator was started once, for issue 9927
    And the step-definition generator was started in the mode for the scenario runner that ".adw/scenarios.md" describes

  @host-only
  Scenario: In a fresh "web" repository the framework upgrade initialised, a per-issue scenario run writes its JUnit report to ADW's path and an end-state image for the scenario that opens a page, and none for the one that does not
    Given a web application repository never initialised by ADW, whose dev server serves a page titled "Widgets" at "/" and answers "/health" with status 200
    And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "web" and whose ".adw/commands.md" starts that dev server
    And the framework upgrade has regenerated the repository's ADW configuration
    And a workflow for issue 9925 has a worktree checked out fresh from the regen commit
    And the worktree holds a feature tagged "@adw-9925" in "features/per-issue/" with these scenarios, and steps for them in "features/steps/" written with "createBdd()" from "playwright-bdd":
      | scenario                      | steps                                                                  |
      | The home page shows its title | open "/" with the "page" fixture and expect the title "Widgets"        |
      | The health endpoint answers   | request "/health" with the "request" fixture and expect the status 200 |
    When the workflow's scenario test phase runs
    Then the scenario proof records the tag "@adw-9925" as passed
    And the JUnit report of the run for the tag "@adw-9925" is at the path ADW gave it, and records these scenarios as passed:
      | scenario                      |
      | The home page shows its title |
      | The health endpoint answers   |
    And the JUnit report attaches exactly one image to "The home page shows its title", and that image is in the scenario proof's artifacts directory
    And the JUnit report attaches no image to "The health endpoint answers"
    And the dev server ADW started served "/" during the run

  Scenario: The ADW TypeScript type-check passes once web repositories run their scenarios on ADW's Playwright project
    Then the ADW TypeScript type-check passes
