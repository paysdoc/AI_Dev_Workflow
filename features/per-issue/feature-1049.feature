@adw-1049 @adw-kqgnim-feat-the-baseline-re
Feature: For a profile with platforms, a regression scenario that fails on the issue's branch is re-run on the base branch on an emulator and a simulator that the device lifecycle creates, boots and removes for that re-run, so that a pre-existing failure is judged under the same conditions as the change; a device that does not boot there parks the workflow for "device_boot_failed", and a "cli" or "web" re-run is unchanged

  A regression scenario that fails on the issue's branch is re-run on its own on a worktree of the base branch, and is pre-existing when it fails there too.

  Background:
    Given the ADW codebase is checked out

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: In a "mobile:kotlincm" repository a regression scenario that fails on the issue's branch is run on its own on the base branch on an emulator and a simulator created for that run, and the run is given "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID" holding their AVD name, serial and UDID, beside "ADW_JUNIT_REPORT_PATH" and "ADW_PROOF_DIR"
    Given a workflow for issue 104901 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The login screen offers a password reset | @regression | fails                 | passes             |
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then the scenario "The login screen offers a password reset" was run on its own on the worktree of the base branch "dev"
    And the run of the scenario command ".adw/" configures on the worktree of the base branch "dev" was given "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID" holding the AVD's name, the emulator's serial and the simulator's UDID of the devices the re-run on the base branch booted
    And the run of the scenario command ".adw/" configures on the worktree of the base branch "dev" was given "ADW_JUNIT_REPORT_PATH" and "ADW_PROOF_DIR"
    And the re-run on the base branch created, booted and waited for the emulator and the simulator before the scenario command's run on the worktree of the base branch, and shut down and deleted both after it

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: In a "mobile:kotlincm" repository the re-run on the base branch creates one AVD and one simulator, each under a name that carries the workflow's ADW ID, from the system image, the device profile, the device type and the runtime that ".adw/project.md" names, as the scenario test phase does
    Given a workflow for issue 104902 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The login screen offers a password reset | @regression | fails                 | passes             |
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then the re-run on the base branch created one AVD and one simulator, each under a name that carries the workflow's ADW ID
    And the re-run on the base branch created the AVD from the system image and the device profile, and the simulator from the device type and the runtime, that the worktree's ".adw/project.md" names

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: In a "mobile:kotlincm" repository a regression scenario that cannot pass without the devices, and passes on the base branch when it runs on the devices booted for it, is not taken for a pre-existing failure: the workflow is not parked
    Given a workflow for issue 104903 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And every scenario of the target repository fails when any of "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID" is missing from the environment it runs in
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The login screen offers a password reset | @regression | fails                 | passes             |
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then the scenario "The login screen offers a password reset" was run on its own on the worktree of the base branch "dev"
    And the workflow's execution log says that the regression scenario "The login screen offers a password reset" passes on the base branch
    And the workflow for issue 104903 is not parked
    And no park comment was posted on issue 104903

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: In a "mobile:kotlincm" repository a regression scenario that fails on the issue's branch, and again on the devices booted for its run on the base branch, is pre-existing: the devices are removed, and then the workflow is parked as "human_gated" for "pre_existing_regression" with a park comment that names the scenario
    Given a workflow for issue 104904 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The login screen offers a password reset | @regression | fails                 | fails              |
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then the scenario "The login screen offers a password reset" was run on its own on the worktree of the base branch "dev"
    And the run of the scenario command ".adw/" configures on the worktree of the base branch "dev" was given "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID" holding the AVD's name, the emulator's serial and the simulator's UDID of the devices the re-run on the base branch booted
    And the workflow for issue 104904 is parked as "human_gated"
    And the workflow for issue 104904 is parked for the reason "pre_existing_regression"
    And the park comment posted on issue 104904 names the scenario "The login screen offers a password reset"
    And the park comment posted on issue 104904 says that it fails on the base branch "dev"
    And the re-run on the base branch deleted every AVD and every simulator it created before the workflow was parked
    And no emulator the re-run on the base branch started was still running when the workflow was parked

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: In a "mobile:kotlincm" repository each of two regression scenarios that fail on the issue's branch is run on its own on the base branch, on an emulator and a simulator created for the re-run and removed after it, and the one that also fails there parks the workflow, naming it, with no device left behind
    Given a workflow for issue 104905 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                           | tag         | on the issue's branch | on the base branch |
      | Removing the last saved card asks for confirmation | @regression | fails                 | passes             |
      | The login screen offers a password reset           | @regression | fails                 | fails              |
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then the scenario "Removing the last saved card asks for confirmation" was run on its own on the worktree of the base branch "dev"
    And the scenario "The login screen offers a password reset" was run on its own on the worktree of the base branch "dev"
    And every run of the scenario command ".adw/" configures on the worktree of the base branch "dev" was given "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID" holding the AVD's name, the emulator's serial and the simulator's UDID of an emulator and a simulator booted before that run and shut down and deleted after it
    And the workflow for issue 104905 is parked for the reason "pre_existing_regression"
    And the park comment posted on issue 104905 names the scenario "The login screen offers a password reset"
    And the re-run on the base branch deleted every AVD and every simulator it created before the workflow was parked
    And no emulator the re-run on the base branch started was still running when the workflow was parked

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario Outline: In a "mobile:kotlincm" repository on a host where every boot of the <device> fails, the re-run on the base branch tries 3 boots, runs no scenario there, removes the devices it created and parks the workflow as "human_gated" for "device_boot_failed", not for "pre_existing_regression", with a park comment that names the platform "<platform>", quotes the boot output and says what "## Retry" and "## Continue" do
    Given a workflow for issue <issue> whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The login screen offers a password reset | @regression | fails                 | fails              |
    And the host's device tools are stand-ins that record each run and answer as a host on which every boot of the <device> fails, printing "<output>"
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then the workflow for issue <issue> is parked as "human_gated"
    And the workflow for issue <issue> is parked for the reason "device_boot_failed"
    And the re-run on the base branch tried 3 times to boot the <device>
    And no scenario was run on the base branch
    And the re-run on the base branch deleted every AVD and every simulator it created before the workflow was parked
    And no emulator the re-run on the base branch started was still running when the workflow was parked
    And the park comment posted on issue <issue> names the platform "<platform>"
    And the park comment posted on issue <issue> quotes "<output>"
    And the park comment posted on issue <issue> says that "## Retry" re-runs the scenario phase
    And the park comment posted on issue <issue> says that "## Continue" waives nothing

    Examples:
      | issue  | device    | platform | output                                                                               |
      | 104906 | emulator  | android  | PANIC: Broken AVD system path. Check your ANDROID_SDK_ROOT value [/opt/android-sdk]! |
      | 104907 | simulator | ios      | Unable to boot the Simulator. launchd failed to respond.                             |

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario Outline: In a "mobile:kotlincm" repository on a host on which "<tool>" is not installed, the re-run on the base branch runs "<tool>" only once, runs no scenario there, removes the devices it created and parks the workflow as "human_gated" for "device_boot_failed", with a park comment that names the platform "<platform>" and the tool and quotes what the tool answered
    Given a workflow for issue <issue> whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The login screen offers a password reset | @regression | fails                 | fails              |
    And the host's device tools are stand-ins that record each run and answer as a host on which "<tool>" is not installed
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then the workflow for issue <issue> is parked as "human_gated"
    And the workflow for issue <issue> is parked for the reason "device_boot_failed"
    And the re-run on the base branch ran "<tool>" only once
    And no scenario was run on the base branch
    And the re-run on the base branch deleted every AVD and every simulator it created before the workflow was parked
    And no emulator the re-run on the base branch started was still running when the workflow was parked
    And the park comment posted on issue <issue> names the platform "<platform>"
    And the park comment posted on issue <issue> names "<tool>"
    And the park comment posted on issue <issue> quotes "<output>"

    Examples:
      | issue  | tool         | platform | output                         |
      | 104908 | avdmanager   | android  | Error: spawn avdmanager ENOENT |
      | 104909 | xcrun simctl | ios      | Error: spawn xcrun ENOENT      |

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: In a "mobile:kotlincm" repository whose emulator fails its first 2 boots for the re-run on the base branch and boots on the third, the regression scenario runs on the devices booted, and, as it fails there too, the workflow is parked for "pre_existing_regression", not for "device_boot_failed"
    Given a workflow for issue 104910 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The login screen offers a password reset | @regression | fails                 | fails              |
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator fails its first 2 boots
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then the re-run on the base branch tried 3 times to boot the emulator
    And the run of the scenario command ".adw/" configures on the worktree of the base branch "dev" was given "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID" holding the AVD's name, the emulator's serial and the simulator's UDID of the devices the re-run on the base branch booted
    And the workflow for issue 104910 is parked for the reason "pre_existing_regression"
    And the park comment posted on issue 104910 names the scenario "The login screen offers a password reset"

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario Outline: In a "mobile:kotlincm" repository in which <case>, nothing is run on the base branch, no device tool is run, and the workflow is not parked
    Given a workflow for issue <issue> whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario   | tag   | on the issue's branch | on the base branch |
      | <scenario> | <tag> | <issue outcome>       | <base outcome>     |
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then no scenario was run on the base branch
    And no device tool was run
    And the workflow for issue <issue> is not parked
    And no park comment was posted on issue <issue>

    Examples:
      | issue  | case                                                            | scenario                                          | tag          | issue outcome | base outcome   |
      | 104911 | every regression scenario passes on the issue's branch          | The login screen offers a password reset          | @regression  | passes        | passes         |
      | 104912 | only a scenario of the issue itself fails on the issue's branch | The login screen remembers the last email address | @adw-104912  | fails         | does not exist |

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: In a "mobile:kotlincm" repository whose baseline the owner waived with "## Continue", a regression scenario that fails on the issue's branch is not run on the base branch, no device tool is run, and the workflow is not parked
    Given a workflow for issue 104913 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The login screen offers a password reset | @regression | fails                 | fails              |
    And the owner has waived the workflow's baseline with "## Continue"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then no scenario was run on the base branch
    And no device tool was run
    And the workflow for issue 104913 is not parked
    And no park comment was posted on issue 104913

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: In a "cli" repository whose ".adw/project.md" names every device source, a regression scenario that fails on the issue's branch is run on its own on the base branch as before: no device tool is run, the run is given none of "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID", and, as the scenario fails there too, the workflow is parked for "pre_existing_regression"
    Given a workflow for issue 104914 whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | fails              |
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then the scenario "The cart total includes the delivery fee" was run on its own on the worktree of the base branch "dev"
    And no device tool was run
    And the run of the scenario command ".adw/" configures on the worktree of the base branch "dev" was given none of "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"
    And the run of the scenario command ".adw/" configures on the worktree of the base branch "dev" was given "ADW_JUNIT_REPORT_PATH" and "ADW_PROOF_DIR"
    And the workflow's execution log mentions no emulator, AVD or simulator
    And the workflow for issue 104914 is parked as "human_gated"
    And the workflow for issue 104914 is parked for the reason "pre_existing_regression"
    And the park comment posted on issue 104914 names the scenario "The cart total includes the delivery fee"

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: In a "web" repository whose ".adw/project.md" names every device source, a regression scenario that fails on the issue's branch is run on the base branch against the dev server started there, as before: no device tool is run, the run of "npx playwright test --grep" is given none of "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID", and, as the scenario fails there too, the workflow is parked for "pre_existing_regression"
    Given a workflow for issue 104915 whose worktree's ".adw/project.md" declares the application type "web"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/commands.md" starts a dev server that answers on its health check path
    And "npx" is a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on
    And the base branch "dev" holds the same ".adw/" as the worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | fails              |
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the regression scenarios that fail on the issue's branch are judged against the base branch
    Then no device tool was run
    And the run of "npx playwright test --grep" on the worktree of the base branch "dev" was given none of "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"
    And the workflow's execution log mentions no emulator, AVD or simulator
    And the workflow for issue 104915 is parked as "human_gated"
    And the workflow for issue 104915 is parked for the reason "pre_existing_regression"
    And the park comment posted on issue 104915 names the scenario "The cart total includes the delivery fee"

  @adw-1049 @adw-kqgnim-feat-the-baseline-re
  Scenario: The ADW TypeScript type-check passes once the re-run on the base branch of a profile with platforms runs on devices the device lifecycle creates, boots and removes, and parks the workflow for "device_boot_failed" when one does not boot
    Then the ADW TypeScript type-check passes
