@adw-1048 @adw-79ve4c-feat-device-boot-is
Feature: The device lifecycle tries three times to boot a device and runs a missing device tool only once; a device that still does not boot, or a missing tool, parks the workflow as "human_gated" for "device_boot_failed", and "## Retry" re-runs the scenario phase

  A boot is one start of the emulator with "emulator", or one "xcrun simctl boot" of the simulator.

  Background:
    Given the ADW codebase is checked out

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario Outline: When the <device> fails its first 2 boots and boots on the third, the device lifecycle runs the callback once, after that third boot, and comes back ready, with what the callback returned, leaving no device behind
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    And the recording executor answers as a host on which the <device> fails its first 2 boots
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the device lifecycle came back ready, with what the callback returned
    And the device lifecycle tried 3 times to boot the <device>
    And the callback ran once
    And the callback ran only after the third boot of the <device>
    And the device lifecycle deleted every AVD and every simulator it created
    And no emulator the device lifecycle started is still running

    Examples:
      | device    |
      | emulator  |
      | simulator |

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario Outline: When every boot of the <device> fails, the device lifecycle tries 3 boots and no more, never runs the callback, removes both devices, and comes back with a failed boot of the platform "<platform>" after 3 attempts, whose output holds what the <device> printed
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    And the recording executor answers as a host on which every boot of the <device> fails, printing "<output>"
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the device lifecycle came back with a failed boot of the platform "<platform>" after 3 attempts
    And the output of that failed boot holds "<output>"
    And the device lifecycle tried 3 times to boot the <device>
    And the callback did not run
    And the device lifecycle deleted every AVD and every simulator it created
    And no emulator the device lifecycle started is still running

    Examples:
      | device    | platform | output                                                                               |
      | emulator  | android  | PANIC: Broken AVD system path. Check your ANDROID_SDK_ROOT value [/opt/android-sdk]! |
      | simulator | ios      | Unable to boot the Simulator. launchd failed to respond.                             |

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario: The output of a failed boot combines what each of its 3 attempts printed, in the order of the attempts
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    And the recording executor answers as a host on which every boot of the simulator fails, printing on each attempt:
      | attempt | prints                                                      |
      | 1       | Unable to boot the Simulator. launchd failed to respond.    |
      | 2       | Unable to boot the Simulator. Operation timed out           |
      | 3       | Unable to boot device because it cannot be located on disk. |
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the device lifecycle came back with a failed boot of the platform "ios" after 3 attempts
    And the output of that failed boot holds what each of the 3 attempts printed, in the order of the attempts

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario: An emulator that has not finished booting by the boot deadline is stopped before the device lifecycle boots it again, and after 3 such boots the device lifecycle comes back with a failed boot of the platform "android", with no emulator left running
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    And the recording executor answers the emulator's property "sys.boot_completed" with "" on every read
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the device lifecycle came back with a failed boot of the platform "android" after 3 attempts
    And the device lifecycle tried 3 times to boot the emulator
    And the device lifecycle stopped each emulator that had not finished booting before it started the next one
    And no emulator the device lifecycle started is still running
    And the device lifecycle deleted every AVD and every simulator it created
    And the callback did not run

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario Outline: On a host on which "<tool>" is not installed, the device lifecycle runs "<tool>" only once, never runs the callback, removes the devices it had created, and comes back with the host tool "<tool>" missing
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    And the recording executor answers as a host on which "<tool>" is not installed
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the device lifecycle came back with the host tool "<tool>" missing
    And the device lifecycle ran "<tool>" only once
    And the callback did not run
    And the device lifecycle deleted every AVD and every simulator it created
    And no emulator the device lifecycle started is still running

    Examples:
      | tool         |
      | avdmanager   |
      | emulator     |
      | adb          |
      | xcrun simctl |

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario: A line of the boot output that reads "## Cancel" is quoted as indented text in the "device_boot_failed" park comment, as every line of the output is, so that ADW takes the comment for no directive
    Given a park for the reason "device_boot_failed" whose evidence is:
      | platform | android                                                                                         |
      | attempts | 3                                                                                               |
      | output   | PANIC: Broken AVD system path. Check your ANDROID_SDK_ROOT value [/opt/android-sdk]!\n## Cancel |
    When the park comment is built
    Then the park comment quotes "PANIC: Broken AVD system path. Check your ANDROID_SDK_ROOT value [/opt/android-sdk]!"
    And the park comment quotes "## Cancel"
    And ADW would take the park comment, as the latest comment on an issue, for no "## Retry", "## Continue" or "## Cancel" directive

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario Outline: In a "mobile:kotlincm" repository on a host where every boot of the <device> fails, the scenario test phase tries 3 boots, runs no scenario, removes the devices it created and parks the workflow as "human_gated" for "device_boot_failed", with a park comment that names the platform "<platform>", quotes the boot output and says what "## Retry" and "## Continue" do
    Given a workflow for issue <issue> whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-<issue>" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which every boot of the <device> fails, printing "<output>"
    When the workflow's scenario test phase is attempted
    Then the workflow for issue <issue> is parked as "human_gated"
    And the workflow for issue <issue> is parked for the reason "device_boot_failed"
    And the scenario test phase tried 3 times to boot the <device>
    And the scenario command ".adw/" configures was not run
    And the scenario test phase deleted every AVD and every simulator it created
    And no emulator the scenario test phase started is still running
    And the park comment posted on issue <issue> names the platform "<platform>"
    And the park comment posted on issue <issue> quotes "<output>"
    And the park comment posted on issue <issue> says that "## Retry" re-runs the scenario phase
    And the park comment posted on issue <issue> says that "## Continue" waives nothing

    Examples:
      | issue  | device    | platform | output                                                                               |
      | 104801 | emulator  | android  | PANIC: Broken AVD system path. Check your ANDROID_SDK_ROOT value [/opt/android-sdk]! |
      | 104802 | simulator | ios      | Unable to boot the Simulator. launchd failed to respond.                             |

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario Outline: In a "mobile:kotlincm" repository on a host on which "<tool>" is not installed, the scenario test phase runs "<tool>" only once, runs no scenario, removes the devices it created and parks the workflow as "human_gated" for "device_boot_failed", with a park comment that names the platform "<platform>" and the tool, quotes what the tool answered, and says what "## Retry" and "## Continue" do
    Given a workflow for issue <issue> whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-<issue>" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which "<tool>" is not installed
    When the workflow's scenario test phase is attempted
    Then the workflow for issue <issue> is parked as "human_gated"
    And the workflow for issue <issue> is parked for the reason "device_boot_failed"
    And the scenario test phase ran "<tool>" only once
    And the scenario command ".adw/" configures was not run
    And the scenario test phase deleted every AVD and every simulator it created
    And no emulator the scenario test phase started is still running
    And the park comment posted on issue <issue> names the platform "<platform>"
    And the park comment posted on issue <issue> names "<tool>"
    And the park comment posted on issue <issue> quotes "<output>"
    And the park comment posted on issue <issue> says that "## Retry" re-runs the scenario phase
    And the park comment posted on issue <issue> says that "## Continue" waives nothing

    Examples:
      | issue  | tool         | platform | output                         |
      | 104803 | avdmanager   | android  | Error: spawn avdmanager ENOENT |
      | 104804 | xcrun simctl | ios      | Error: spawn xcrun ENOENT      |

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario: In a "mobile:kotlincm" repository whose emulator fails its first 2 boots and boots on the third, the scenario test phase runs the issue's scenarios on the devices it booted, and the workflow is not parked
    Given a workflow for issue 104805 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-104805" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator fails its first 2 boots
    When the workflow's scenario test phase is attempted
    Then the scenario test phase tried 3 times to boot the emulator
    And the run of the scenario command ".adw/" configures for the tag "@adw-104805" was given "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID" holding the AVD's name, the emulator's serial and the simulator's UDID of the devices the scenario test phase booted
    And the scenario proof records the tag "@adw-104805" as passed
    And the workflow for issue 104805 is not parked
    And no park comment was posted on issue 104805

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario: In a "mobile:kotlincm" repository whose devices boot but whose issue scenario fails, the scenario test phase does not park the workflow: the scenario proof records the blocker failure, and no park comment is posted
    Given a workflow for issue 104806 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run, exits 1, and writes a JUnit report in which one scenario fails
    And the worktree holds a feature tagged "@adw-104806" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase is attempted
    Then the scenario proof records a blocker failure for the tag "@adw-104806"
    And the workflow for issue 104806 is not parked
    And no park comment was posted on issue 104806

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario: "## Retry" on a workflow parked for "device_boot_failed" re-runs the scenario phase: once the host has been fixed, the resumed scenario test phase creates and boots the devices again, runs the issue's scenarios on them and does not park the workflow again
    Given a workflow for issue 104807 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-104807" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which every boot of the emulator fails, printing "PANIC: Broken AVD system path. Check your ANDROID_SDK_ROOT value [/opt/android-sdk]!"
    And the workflow's scenario test phase has run and parked the workflow as "human_gated"
    And the host has since been fixed, so that its device tools answer as a host on which the emulator and the simulator boot
    When "## Retry" is posted on issue 104807
    And the resumed workflow's scenario test phase runs
    Then the scenario test phase created, booted and waited for the emulator and the simulator before the scenario command's first run, and shut down and deleted both after its last run
    And the scenario proof records the tag "@adw-104807" as passed
    And the workflow for issue 104807 is not parked
    And exactly one park comment was posted on issue 104807

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario: "## Continue" on a workflow parked for "device_boot_failed" waives nothing: no waiver is recorded, and the workflow stays parked as "human_gated" for "device_boot_failed"
    Given a workflow for issue 104808 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-104808" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which every boot of the simulator fails, printing "Unable to boot the Simulator. launchd failed to respond."
    And the workflow's scenario test phase has run and parked the workflow as "human_gated"
    When "## Continue" is posted on issue 104808
    Then the workflow for issue 104808 is parked as "human_gated"
    And the workflow for issue 104808 is parked for the reason "device_boot_failed"
    And the workflow's state records no waiver

  @adw-1048 @adw-79ve4c-feat-device-boot-is
  Scenario: The ADW TypeScript type-check passes once the device lifecycle comes back ready, with a failed boot or with a missing host tool, and the scenario test phase parks the workflow on either failure
    Then the ADW TypeScript type-check passes
