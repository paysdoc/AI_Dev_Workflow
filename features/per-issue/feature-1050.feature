@adw-1050 @adw-o1fnc2-feat-a-device-janito
Feature: The cron's device janitor, run beside the dev-server janitor, shuts down and deletes the emulators and simulators named for an ADW ID that has no live orchestrator process and whose worktree is older than the grace period, and logs each removal with the ADW ID and the device's name; it never touches the devices of a live workflow, of a worktree inside the grace period, or of no ADW ID

  A device is named for an ADW ID when its name is "adw-" followed by that ADW ID, as the device lifecycle names the AVD and the simulator it creates.

  Background:
    Given the ADW codebase is checked out

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: The device janitor shuts down and then deletes the emulator and the simulator named for an ADW ID that has no live orchestrator process and whose worktree is older than the grace period, and leaves neither on the host
    Given a recording executor that answers as a host with these devices:
      | device    | name                    | booted |
      | AVD       | adw-k7m2p9-login-screen | yes    |
      | simulator | adw-k7m2p9-login-screen | yes    |
    And the workflow "k7m2p9-login-screen" has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period
    When the device janitor sweeps the host
    Then the device janitor took these steps for each of the emulator and the simulator of the ADW ID "k7m2p9-login-screen", in this order:
      | step      |
      | shut down |
      | delete    |
    And the host has no emulator, AVD or simulator of the ADW ID "k7m2p9-login-screen" any more

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: The device janitor shuts a dead ADW ID's emulator down with the "adb" command "emu kill", addressed by its serial, deletes its AVD with "avdmanager delete avd", by its name, and shuts down and deletes its simulator with "xcrun simctl", by its UDID
    Given a recording executor that answers as a host with these devices:
      | device    | name                    | booted |
      | AVD       | adw-k7m2p9-login-screen | yes    |
      | simulator | adw-k7m2p9-login-screen | yes    |
    And the workflow "k7m2p9-login-screen" has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period
    When the device janitor sweeps the host
    Then the device janitor shut down the emulator running from the AVD "adw-k7m2p9-login-screen" with the "adb" command "emu kill", addressed by its serial
    And the device janitor deleted the AVD "adw-k7m2p9-login-screen" with "avdmanager delete avd", by its name
    And the device janitor shut down the simulator "adw-k7m2p9-login-screen" with "xcrun simctl shutdown" and deleted it with "xcrun simctl delete", each by its UDID

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: The device janitor neither shuts down nor deletes the emulator and the simulator of an ADW ID whose orchestrator process is alive, however old its worktree, while it removes those of a dead ADW ID beside them
    Given a recording executor that answers as a host with these devices:
      | device    | name                     | booted |
      | AVD       | adw-q4w8z1-settings-page | yes    |
      | simulator | adw-q4w8z1-settings-page | yes    |
      | AVD       | adw-k7m2p9-login-screen  | yes    |
      | simulator | adw-k7m2p9-login-screen  | yes    |
    And the orchestrator process of the workflow "q4w8z1-settings-page" is alive, and its worktree is older than the dev-server janitor's grace period
    And the workflow "k7m2p9-login-screen" has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period
    When the device janitor sweeps the host
    Then the device janitor neither shut down nor deleted the emulator or the simulator of the ADW ID "q4w8z1-settings-page"
    And the host has no emulator, AVD or simulator of the ADW ID "k7m2p9-login-screen" any more

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: The device janitor neither shuts down nor deletes the emulator and the simulator of an ADW ID with no live orchestrator process whose worktree is still inside the grace period, while it removes those of a dead ADW ID whose worktree is older beside them
    Given a recording executor that answers as a host with these devices:
      | device    | name                    | booted |
      | AVD       | adw-r5t6y7-profile-page | yes    |
      | simulator | adw-r5t6y7-profile-page | yes    |
      | AVD       | adw-k7m2p9-login-screen | yes    |
      | simulator | adw-k7m2p9-login-screen | yes    |
    And the workflow "r5t6y7-profile-page" has no live orchestrator process, and its worktree is still inside the dev-server janitor's grace period
    And the workflow "k7m2p9-login-screen" has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period
    When the device janitor sweeps the host
    Then the device janitor neither shut down nor deleted the emulator or the simulator of the ADW ID "r5t6y7-profile-page"
    And the host has no emulator, AVD or simulator of the ADW ID "k7m2p9-login-screen" any more

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: The device janitor never shuts down or deletes an AVD or a simulator that is not named for an ADW ID, booted or not, while it removes those of a dead ADW ID beside them
    Given a recording executor that answers as a host with these devices:
      | device    | name                    | booted |
      | AVD       | Pixel_8_API_35          | yes    |
      | AVD       | Medium_Phone_API_35     | no     |
      | simulator | iPhone 16 Pro           | yes    |
      | simulator | iPad Air 11-inch (M2)   | no     |
      | AVD       | adw-k7m2p9-login-screen | yes    |
      | simulator | adw-k7m2p9-login-screen | yes    |
    And the workflow "k7m2p9-login-screen" has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period
    When the device janitor sweeps the host
    Then the device janitor neither shut down nor deleted any device that is not named for an ADW ID
    And the host has no emulator, AVD or simulator of the ADW ID "k7m2p9-login-screen" any more

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: The device janitor removes the AVD and the simulator of an ADW ID that left no workflow state and no worktree behind, an AVD from which no emulator runs as well as a booted simulator
    Given a recording executor that answers as a host with these devices:
      | device    | name                     | booted |
      | AVD       | adw-m3n8b2-cart-checkout | no     |
      | simulator | adw-m3n8b2-cart-checkout | yes    |
    And no workflow state and no worktree are left for the ADW ID "m3n8b2-cart-checkout"
    When the device janitor sweeps the host
    Then the host has no emulator, AVD or simulator of the ADW ID "m3n8b2-cart-checkout" any more

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: The device janitor logs the removal of each device on a line that names the device and the ADW ID it was removed for
    Given a recording executor that answers as a host with these devices:
      | device    | name                    | booted |
      | AVD       | adw-k7m2p9-login-screen | yes    |
      | simulator | adw-k7m2p9-login-screen | yes    |
    And the workflow "k7m2p9-login-screen" has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period
    When the device janitor sweeps the host
    Then the device janitor logged the removal of the AVD "adw-k7m2p9-login-screen" on a line that also names the ADW ID "k7m2p9-login-screen"
    And the device janitor logged the removal of the simulator "adw-k7m2p9-login-screen" on a line that also names the ADW ID "k7m2p9-login-screen"

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: When the deletion of a dead ADW ID's AVD fails, the device janitor logs a warning that names the AVD and holds what "avdmanager" printed, still removes the devices of the other dead ADW ID, and its sweep completes without an error
    Given a recording executor that answers as a host with these devices:
      | device    | name                     | booted |
      | AVD       | adw-k7m2p9-login-screen  | no     |
      | AVD       | adw-m3n8b2-cart-checkout | yes    |
      | simulator | adw-m3n8b2-cart-checkout | yes    |
    And the recording executor fails the deletion of the AVD "adw-k7m2p9-login-screen", printing "Error: Unable to delete the AVD's files: Permission denied"
    And the workflow "k7m2p9-login-screen" has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period
    And the workflow "m3n8b2-cart-checkout" has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period
    When the device janitor sweeps the host
    Then the device janitor logged a warning that names the AVD "adw-k7m2p9-login-screen" and holds "Error: Unable to delete the AVD's files: Permission denied"
    And the host has no emulator, AVD or simulator of the ADW ID "m3n8b2-cart-checkout" any more
    And the device janitor's sweep completed without an error

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: On a host on which "avdmanager", "emulator" and "adb" are not installed, the device janitor still shuts down and deletes the simulator of a dead ADW ID, and its sweep completes without an error
    Given a recording executor that answers as a host with these devices:
      | device    | name                    | booted |
      | simulator | adw-k7m2p9-login-screen | yes    |
    And on that host, "avdmanager", "emulator" and "adb" are not installed
    And the workflow "k7m2p9-login-screen" has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period
    When the device janitor sweeps the host
    Then the host has no emulator, AVD or simulator of the ADW ID "k7m2p9-login-screen" any more
    And the device janitor's sweep completed without an error

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: On a host on which no device tool is installed, the device janitor's sweep completes without an error
    Given a recording executor that answers as a host on which no device tool is installed
    When the device janitor sweeps the host
    Then the device janitor's sweep completed without an error

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: On a poll that runs its dev-server janitor, the cron also sweeps the host's devices, and removes the emulator and the simulator of an ADW ID that left no workflow state and no worktree behind
    Given the host's device tools are stand-ins that record each run and answer as a host with these devices:
      | device    | name                     | booted |
      | AVD       | adw-m3n8b2-cart-checkout | yes    |
      | simulator | adw-m3n8b2-cart-checkout | yes    |
    And no workflow state and no worktree are left for the ADW ID "m3n8b2-cart-checkout"
    When the cron polls once, on a poll that runs its dev-server janitor
    Then the cron's poll left no emulator, AVD or simulator of the ADW ID "m3n8b2-cart-checkout" on the host

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: On a poll that does not run its dev-server janitor, the cron runs no device tool
    Given the host's device tools are stand-ins that record each run and answer as a host with these devices:
      | device    | name                     | booted |
      | AVD       | adw-m3n8b2-cart-checkout | yes    |
      | simulator | adw-m3n8b2-cart-checkout | yes    |
    And no workflow state and no worktree are left for the ADW ID "m3n8b2-cart-checkout"
    When the cron polls once, on a poll that does not run its dev-server janitor
    Then the cron ran no device tool on that poll

  @adw-1050 @adw-o1fnc2-feat-a-device-janito
  Scenario: The ADW TypeScript type-check passes once the cron sweeps the host's devices beside the dev-server janitor
    Then the ADW TypeScript type-check passes
