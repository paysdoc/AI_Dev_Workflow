@adw-1047 @adw-ko14m9-feat-adw-creates-boo
Feature: ADW creates, boots and destroys one Android emulator and one iOS simulator per workflow, named after its ADW ID, around the scenario proof run of a profile with platforms, and gives the scenario command their AVD name, serial and UDID; a "cli" or "web" workflow runs no device tool

  The device tools are "avdmanager", "emulator" and "adb" for the Android emulator, and "xcrun simctl" for the iOS simulator.

  Background:
    Given the ADW codebase is checked out

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo @adw-1048 @adw-1050
  Scenario: A successful run creates, boots and waits for the emulator and the simulator before the callback, then shuts down and deletes both, and the callback is given exactly "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the device lifecycle took these steps for each of the emulator and the simulator, in this order:
      | step             |
      | create           |
      | boot             |
      | wait until ready |
      | run the callback |
      | shut down        |
      | delete           |
    And the callback ran once
    And the callback was given exactly the variables "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"
    And the device lifecycle came back ready, with what the callback returned

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: The callback is given the name of the AVD the device lifecycle created, the serial "adb" reports for the emulator's console port, and the UDID the simulator's creation answered with
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    And the recording executor answers the creation of the simulator with the UDID "8A1F6C52-3B7E-4D90-9C1A-2E5B7F0D4C13"
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the callback was given "ADW_ANDROID_AVD" holding the name of the AVD the device lifecycle created
    And the callback was given "ADW_ANDROID_SERIAL" holding "emulator-" followed by the console port the emulator was started on
    And the callback was given "ADW_IOS_UDID" holding "8A1F6C52-3B7E-4D90-9C1A-2E5B7F0D4C13"

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo @adw-1050
  Scenario: The device lifecycle creates the AVD from the system image and the device profile, and the simulator from the device type and the runtime, each under a name that carries the ADW ID, starts the emulator headless on a console port, and boots the simulator by the UDID its creation answered with
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    And the recording executor answers the creation of the simulator with the UDID "8A1F6C52-3B7E-4D90-9C1A-2E5B7F0D4C13"
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the AVD was created with "avdmanager create avd" from the system image "system-images;android-35;google_apis;arm64-v8a" and the device profile "pixel_8", under a name that carries the ADW ID "k7m2p9-login-screen"
    And the emulator was started with "emulator" from that AVD, headless with "-no-window", on the console port given with "-port"
    And the simulator was created with "xcrun simctl create" of the device type "com.apple.CoreSimulator.SimDeviceType.iPhone-16" and the runtime "com.apple.CoreSimulator.SimRuntime.iOS-18-2", under a name that carries the ADW ID "k7m2p9-login-screen"
    And the simulator was booted with "xcrun simctl boot" by the UDID "8A1F6C52-3B7E-4D90-9C1A-2E5B7F0D4C13"

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo @adw-1050
  Scenario: The device lifecycle waits for the emulator with "adb" until its device state is "device" and "sys.boot_completed" reads "1", and for the simulator with "xcrun simctl bootstatus", and afterwards shuts the emulator down with "adb", deletes its AVD with "avdmanager", and shuts down and deletes the simulator with "xcrun simctl"
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    And the recording executor answers the creation of the simulator with the UDID "8A1F6C52-3B7E-4D90-9C1A-2E5B7F0D4C13"
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the emulator was waited for with "adb", addressed by the serial of its console port, until its device state was "device" and its property "sys.boot_completed" read "1"
    And the simulator was waited for with "xcrun simctl bootstatus" by the UDID "8A1F6C52-3B7E-4D90-9C1A-2E5B7F0D4C13"
    And the emulator was shut down with the "adb" command "emu kill", addressed by its serial
    And the AVD was deleted with "avdmanager delete avd", by its name
    And the simulator was shut down with "xcrun simctl shutdown" and deleted with "xcrun simctl delete", each by the UDID "8A1F6C52-3B7E-4D90-9C1A-2E5B7F0D4C13"

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo @adw-1048
  Scenario: The device lifecycle runs the callback only once the emulator's "sys.boot_completed" property reads "1": while it reads empty within the boot deadline, the lifecycle reads it again and does not boot the emulator again
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    And the recording executor answers the emulator's property "sys.boot_completed" with "" on the first 2 reads, and with "1" after them
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    Then the device lifecycle read the emulator's property "sys.boot_completed" 3 times, and ran the callback only after the last read
    And the device lifecycle ran "emulator" only once
    And the callback ran once

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo @adw-1048 @adw-1050
  Scenario: A callback that throws still gets the emulator and the simulator shut down and deleted, and the device lifecycle fails with the error the callback threw
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    When the device lifecycle runs a callback that throws the error "The Appium session could not be created", with devices for the ADW ID "k7m2p9-login-screen"
    Then the device lifecycle failed with the error the callback threw
    And the device lifecycle took these steps for each of the emulator and the simulator, in this order:
      | step             |
      | create           |
      | boot             |
      | wait until ready |
      | run the callback |
      | shut down        |
      | delete           |

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: Each workflow's emulator gets a console port of its own: the emulators for two ADW IDs are started on different console ports, and each callback is given the serial of its own emulator's port
    Given these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    And a recording executor that answers every device command as a host on which the emulator and the simulator boot
    When the device lifecycle runs a callback with devices for the ADW ID "k7m2p9-login-screen"
    And the device lifecycle runs a callback with devices for the ADW ID "q4w8z1-settings-page"
    Then the emulators for the ADW IDs "k7m2p9-login-screen" and "q4w8z1-settings-page" were started on different console ports
    And the callback for each ADW ID was given "ADW_ANDROID_SERIAL" holding "emulator-" followed by the console port of that ADW ID's emulator

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: In a "mobile:kotlincm" repository the scenario test phase gives the scenario command's runs for "@regression" and for the issue's tag the AVD name, the emulator serial and the simulator UDID of the devices it booted, beside ADW's report path, proof directory and application URL
    Given a workflow for issue 104701 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@regression" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/HomeScreenSteps.kt"
    And the worktree holds a feature tagged "@adw-104701" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase runs
    Then the run of the scenario command ".adw/" configures for the tag "@regression" was given "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID" holding the AVD's name, the emulator's serial and the simulator's UDID of the devices the scenario test phase booted
    And the run of the scenario command ".adw/" configures for the tag "@adw-104701" was given "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID" holding the AVD's name, the emulator's serial and the simulator's UDID of the devices the scenario test phase booted
    And the run of the scenario command ".adw/" configures for the tag "@adw-104701" was given "ADW_JUNIT_REPORT_PATH" holding the scenario proof's report path for that tag, "ADW_PROOF_DIR" holding the scenario proof's artifacts directory, and "ADW_APPLICATION_URL" holding the workflow's application URL
    And the scenario proof records the tag "@regression" as passed
    And the scenario proof records the tag "@adw-104701" as passed

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: In a "mobile:kotlincm" repository the scenario test phase creates one AVD and one simulator, each named after the workflow's ADW ID, from the device sources ".adw/project.md" names, boots both before the scenario command's first run, and shuts down and deletes both after its last run
    Given a workflow for issue 104702 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@regression" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/HomeScreenSteps.kt"
    And the worktree holds a feature tagged "@adw-104702" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase runs
    Then the scenario test phase created one AVD and one simulator, each under a name that carries the workflow's ADW ID
    And the scenario test phase created the AVD from the system image and the device profile, and the simulator from the device type and the runtime, that the worktree's ".adw/project.md" names
    And the scenario test phase created, booted and waited for the emulator and the simulator before the scenario command's first run, and shut down and deleted both after its last run
    And the scenario proof records no blocker failures

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: In a "mobile:kotlincm" repository whose issue scenario fails, the scenario test phase still shuts down and deletes the AVD and the simulator after the scenario command's run, and the scenario proof records the blocker failure
    Given a workflow for issue 104703 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run, exits 1, and writes a JUnit report in which one scenario fails
    And the worktree holds a feature tagged "@adw-104703" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase runs
    Then the scenario proof records a blocker failure for the tag "@adw-104703"
    And the scenario test phase created, booted and waited for the emulator and the simulator before the scenario command's first run, and shut down and deleted both after its last run

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: The execution log of a "mobile:kotlincm" workflow's scenario test phase gives the names of the AVD and the simulator it created, the time each took to boot, and their removal
    Given a workflow for issue 104704 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-104704" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/LoginScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase runs
    Then the workflow's execution log has a line that gives the name of the AVD the scenario test phase created and the time the emulator took to boot
    And the workflow's execution log has a line that gives the name of the simulator the scenario test phase created and the time it took to boot
    And the workflow's execution log says, after those lines, that the AVD and the simulator were removed, giving the name of each

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: In a "mobile:kotlincm" repository whose ".adw/" runs scenarios by tag with "N/A", the scenario test phase is skipped and runs no device tool
    Given a workflow for issue 104707 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with "N/A"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase runs
    Then the scenario test phase was skipped, with no scenario proof
    And no device tool was run

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: In a "cli" repository whose ".adw/project.md" names every device source, the scenario test phase runs no device tool, and the scenario command's run for the issue's tag is given ADW's report path, proof directory and application URL as before, and no device variable
    Given a workflow for issue 104705 whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-104705" and steps for it in the step definition directory ".adw/scenarios.md" names
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase runs
    Then no device tool was run
    And the run of the scenario command ".adw/" configures for the tag "@adw-104705" was given none of "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"
    And the run of the scenario command ".adw/" configures for the tag "@adw-104705" was given "ADW_JUNIT_REPORT_PATH" holding the scenario proof's report path for that tag, "ADW_PROOF_DIR" holding the scenario proof's artifacts directory, and "ADW_APPLICATION_URL" holding the workflow's application URL
    And the workflow's execution log mentions no emulator, AVD or simulator
    And the scenario proof records the tag "@adw-104705" as passed

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: In a "web" repository whose ".adw/project.md" names every device source, the scenario test phase runs no device tool, and the run of "npx playwright test --grep" for the issue's tag is given the dev server's address and ADW's report and proof paths as before, and no device variable
    Given a workflow for issue 104706 whose worktree's ".adw/project.md" declares the application type "web"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/commands.md" starts a dev server that answers on its health check path
    And the worktree holds a feature tagged "@adw-104706" in "features/per-issue/" and steps for it in "features/steps/"
    And "npx" is a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase runs
    Then no device tool was run
    And the run of "npx playwright test --grep" for the tag "@adw-104706" was given none of "ADW_ANDROID_AVD", "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"
    And the run of "npx playwright test --grep" for the tag "@adw-104706" was given "ADW_APPLICATION_URL" holding the address of the dev server ADW started
    And the run of "npx playwright test --grep" for the tag "@adw-104706" was given "ADW_JUNIT_REPORT_PATH" holding the scenario proof's report path for that tag, and "ADW_PROOF_DIR" holding a directory of that tag's own inside the scenario proof's artifacts directory
    And the workflow's execution log mentions no emulator, AVD or simulator
    And the scenario proof records the tag "@adw-104706" as passed

  @adw-1047 @adw-ko14m9-feat-adw-creates-boo
  Scenario: The ADW TypeScript type-check passes once the scenario test phase of a profile with platforms runs the scenario proof on devices the device lifecycle creates, boots and destroys
    Then the ADW TypeScript type-check passes
