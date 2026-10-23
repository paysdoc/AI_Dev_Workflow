@adw-1044 @adw-g0m1dk-feat-adw-init-preser @promotion-suggested-2026-10-23
Feature: "adw_init" is run again on a hand-set "mobile:kotlincm", and the Kotlin and Gradle descriptors it writes for it let a bootstrap issue through the baseline and the scenario phase, run each scenario tag through the ":scenarios" module, and give the scenario proof each platform's screenshot

  A bootstrap issue is the first issue of a repository that holds no application yet.

  Background:
    Given the ADW codebase is checked out

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: Editing the "/adw_init" command below its frontmatter changes the framework content hash, so every target repository is upgraded and "adw_init" writes its ".adw/" again
    Given a fixture framework copied from the ADW framework under test
    When the framework content hash is computed for the fixture framework
    And the "/adw_init" command in the fixture framework is edited below its frontmatter
    And the framework content hash is computed for the fixture framework
    Then the recorded hashes are all different

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: The framework upgrade of a repository whose owner set "mobile:kotlincm" and its device sources by hand in ".adw/project.md" runs the "/adw_init" agent in a worktree that holds them, commits an ".adw/project.md" in which each of the four device-source sections keeps the value the owner set, installs no Playwright project, and ADW reads "mobile:kotlincm" from the regen commit
    Given a target repository initialised by an older framework version
    And the target repository's default branch has this ".adw/project.md":
      """
      # Project

      ## Application Type
      mobile:kotlincm

      ## Android System Image
      system-images;android-34;google_apis;arm64-v8a

      ## Android Device Profile
      pixel_7

      ## iOS Device Type
      com.apple.CoreSimulator.SimDeviceType.iPhone-15

      ## iOS Runtime
      com.apple.CoreSimulator.SimRuntime.iOS-17-5
      """
    And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "mobile:kotlincm" and has the device-source sections the "/adw_init" command tells it to write
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the "/adw_init" agent ran in a worktree whose ".adw/project.md" was the default branch's
    And the upgrade commits the regenerated configuration
    And ADW reads the application type "mobile:kotlincm" from the regen commit's ".adw/project.md"
    And ADW reads these device sources from the regen commit's ".adw/project.md":
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-34;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_7                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-15 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-17-5     |
    And the regen commit holds no "features/playwright.config.ts"
    And the regen commit holds no "features/package.json"
    And the upgrade installed nothing in "features/"

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: The framework upgrade of a repository whose owner set "mobile:kotlincm" by hand in ".adw/project.md", and none of its device sources, commits an ".adw/project.md" in which each of the four device-source sections holds its default
    Given a target repository initialised by an older framework version
    And the target repository's default branch has this ".adw/project.md":
      """
      # Project

      ## Application Type
      mobile:kotlincm
      """
    And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "mobile:kotlincm" and has the device-source sections the "/adw_init" command tells it to write
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And ADW reads these device sources from the regen commit's ".adw/project.md":
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-36;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-26-0     |

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: The bootstrap issue of a "mobile:kotlincm" repository is not parked by the baseline: on a base branch with the ".adw/" "adw_init" writes and no manifest or Gradle wrapper yet, the Gradle build check passes, no dev server is started, and the plan phase runs
    Given a target repository whose default branch "dev" holds the ".adw/" that "adw_init" writes for the application type "mobile:kotlincm", and no manifest and no Gradle wrapper yet
    And a workflow of the "adwSdlc" orchestrator for issue 104401 in that repository
    When the workflow runs
    Then the workflow's state records that the baseline passed on the base branch "dev"
    And the baseline's "build" check passed on the base branch "dev" with a Gradle command
    And the baseline started no dev server on its worktree of the base branch "dev"
    And the plan phase ran after the baseline
    And no park comment was posted on issue 104401

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: In a "mobile:kotlincm" repository whose ".adw/" is what "adw_init" writes, the step-definition phase starts the generator in the mode for the scenario runner that ".adw/scenarios.md" describes, and, because that ".adw/scenarios.md" has a "## Scenario Run Contract", the command the generator is started with tells the step definitions which devices to drive, never to create, boot, shut down or delete one, and where each platform's screenshots go
    Given a workflow for issue 104406 whose worktree holds the ".adw/" that "adw_init" writes for the application type "mobile:kotlincm"
    When the workflow's step-definition phase runs
    Then the step-definition generator was started once, for issue 104406
    And the step-definition generator was started in the mode for the scenario runner that ".adw/scenarios.md" describes
    And the command the step-definition generator was started with tells the step definitions to drive the devices named by "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"
    And the command the step-definition generator was started with tells the step definitions never to create, boot, shut down or delete a device
    And the command the step-definition generator was started with tells the step definitions to write each screenshot under "android/" or "ios/" in "ADW_PROOF_DIR"

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: In a "mobile:kotlincm" repository whose ".adw/" is what "adw_init" writes, the "## Run Tests" command gathers the JUnit reports under each module's "build/test-results/" into the one report ADW reads at "ADW_UNIT_TEST_REPORT_PATH", leaves out those of the ":scenarios" module, and exits with the Gradle wrapper's exit code
    Given a workflow for issue 104405 whose worktree holds the ".adw/" that "adw_init" writes for the application type "mobile:kotlincm"
    And the worktree's Gradle wrapper is a stand-in that, run for the task "test", writes the JUnit report of each of these test classes under its module's "build/test-results/" directory, and exits with code 1:
      | module      | test class                  | test case                       | status |
      | :composeApp | com.example.GreetingTest    | greetingNamesThePlatform        | passed |
      | :shared     | com.example.ClockTest       | clockFormatsTheTime             | failed |
      | :scenarios  | com.example.RunCucumberTest | The home screen greets the user | passed |
    When the "## Run Tests" command of the worktree's ".adw/commands.md" is run as written from the worktree's root, with "ADW_UNIT_TEST_REPORT_PATH" holding the unit-test phase's report path
    Then ADW reads exactly these test cases from the JUnit report at "ADW_UNIT_TEST_REPORT_PATH":
      | test class               | test case                | status |
      | com.example.GreetingTest | greetingNamesThePlatform | passed |
      | com.example.ClockTest    | clockFormatsTheTime      | failed |
    And the "## Run Tests" command exited with code 1

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: In a "mobile:kotlincm" repository whose ".adw/" is what "adw_init" writes, the scenario proof looks for step definitions under "scenarios/src/test/kotlin", and while the bootstrap issue has written none it runs no tag and records no blocker failure
    Given a workflow for issue 104402 whose worktree holds the ".adw/" that "adw_init" writes for the application type "mobile:kotlincm"
    And the worktree holds a feature tagged "@adw-104402" in the scenario directory ".adw/scenarios.md" names, and no step definition file
    When the workflow's scenario test phase runs
    Then the scenario proof ran no tag
    And the scenario proof notes that no step definition file was found in "scenarios/src/test/kotlin/"
    And the scenario proof records no blocker failures
    And the scenario test phase started no dev server

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: In a "mobile:kotlincm" repository whose ".adw/" is what "adw_init" writes, the scenario proof runs the per-issue and the regression scenarios through the Gradle wrapper's ":scenarios:test" task from the worktree's root, filtered to each tag, with ADW's report path for the tag and its artifacts directory as "ADW_PROOF_DIR", and starts no dev server
    Given a workflow for issue 104403 whose worktree holds the ".adw/" that "adw_init" writes for the application type "mobile:kotlincm"
    And the worktree holds a feature tagged "@adw-104403" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/HomeScreenSteps.kt"
    And the worktree holds a feature tagged "@regression" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LaunchSteps.kt"
    And the worktree's Gradle wrapper is a stand-in that records each run and writes a JUnit report in which every scenario passes
    When the workflow's scenario test phase runs
    Then the Gradle wrapper ran the task ":scenarios:test" from the worktree's root once for each of these cucumber tag filters:
      | tag filter  |
      | @adw-104403 |
      | @regression |
    And each of those runs was given "ADW_JUNIT_REPORT_PATH" holding the scenario proof's report path for its tag, and "ADW_PROOF_DIR" holding the scenario proof's artifacts directory
    And the scenario proof records the tag "@adw-104403" as passed
    And the scenario proof records the tag "@regression" as passed
    And the scenario test phase started no dev server

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: In a "mobile:kotlincm" repository whose ".adw/" is what "adw_init" writes, a run that saves each platform's screenshot under "android/" or "ios/" in "ADW_PROOF_DIR" and reports the scenario under one title on both platforms, attaching the screenshot by its path from the JUnit report's directory, gives the per-issue scenario both screenshots as its images
    Given a workflow for issue 104404 whose worktree holds the ".adw/" that "adw_init" writes for the application type "mobile:kotlincm"
    And the worktree holds a feature tagged "@adw-104404" in the scenario directory ".adw/scenarios.md" names, whose one scenario is "The home screen greets the user", and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/HomeScreenSteps.kt"
    And the worktree's Gradle wrapper is a stand-in that runs each scenario of the tag once on each of these platforms, saves its screenshot under the platform's directory in "ADW_PROOF_DIR", and reports every run as a passed test case named after the scenario that attaches the screenshot by its path from the JUnit report's directory:
      | platform | screenshot      |
      | android  | home-screen.png |
      | ios      | home-screen.png |
    When the workflow's scenario test phase runs
    Then the scenario proof records the tag "@adw-104404" as passed
    And the scenario proof gives "The home screen greets the user" exactly these images, by their path in "ADW_PROOF_DIR":
      | image                   |
      | android/home-screen.png |
      | ios/home-screen.png     |

  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: The ADW TypeScript type-check passes once "adw_init" writes the descriptors of "mobile:kotlincm"
    Then the ADW TypeScript type-check passes
