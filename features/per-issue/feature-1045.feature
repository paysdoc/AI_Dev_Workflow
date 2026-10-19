@adw-1045 @adw-m9cru8-feat-device-source-s
Feature: ADW reads a repository's device sources from ".adw/project.md"; the scenario test phase of a "mobile:kotlincm" repository fails before it runs anything when one is missing, naming it, and that of a "cli" or "web" repository ignores them

  The device sources are "## Android System Image", "## Android Device Profile", "## iOS Device Type" and "## iOS Runtime" of ".adw/project.md", in that order.

  Background:
    Given the ADW codebase is checked out

  @adw-1045 @adw-m9cru8-feat-device-source-s
  Scenario: ADW reads each device source of ".adw/project.md" as it is written, without the HTML comments in its section or the whitespace around it
    Given a repository whose ".adw/project.md" holds:
      """
      # ADW Project Configuration

      ## Application Type
      mobile:kotlincm

      ## Android System Image
      <!-- The SDK package of the emulator's system image -->
      system-images;android-35;google_apis;arm64-v8a

      ## Android Device Profile
      pixel_8 <!-- an "avdmanager list device" id -->

      ## iOS Device Type

        com.apple.CoreSimulator.SimDeviceType.iPhone-16

      ## iOS Runtime
      <!--
        A runtime that "xcrun simctl list runtimes" lists
      -->
      com.apple.CoreSimulator.SimRuntime.iOS-18-2
      """
    When ADW reads the repository's project configuration
    Then the project configuration names these device sources, and no other:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |

  @adw-1045 @adw-m9cru8-feat-device-source-s
  Scenario: ADW reads no device source from a section that is missing, empty or holds only an HTML comment, and still reads the device source beside it
    Given a repository whose ".adw/project.md" holds:
      """
      # ADW Project Configuration

      ## Application Type
      mobile:kotlincm

      ## Android System Image
      system-images;android-35;google_apis;arm64-v8a

      ## Android Device Profile

      ## iOS Device Type
      <!-- com.apple.CoreSimulator.SimDeviceType.iPhone-16 -->

      ## Framework Notes
      A Kotlin Compose Multiplatform application for Android and iPhone.
      """
    When ADW reads the repository's project configuration
    Then the project configuration names these device sources, and no other:
      | section                 | value                                          |
      | ## Android System Image | system-images;android-35;google_apis;arm64-v8a |

  @adw-1045 @adw-m9cru8-feat-device-source-s
  Scenario Outline: ADW reads no device source, and fills in no default one, from a repository <repository>
    Given a repository <repository>
    When ADW reads the repository's project configuration
    Then the project configuration names no device source

    Examples:
      | repository                                                                                         |
      | whose ".adw/project.md" declares the application type "mobile:kotlincm" and names no device source |
      | that has no ".adw/" directory                                                                      |

  @adw-1045 @adw-m9cru8-feat-device-source-s
  Scenario: The device sources of a "mobile:kotlincm" repository whose ".adw/project.md" names all four resolve to the system image, device profile, device type and runtime it names
    Given a repository whose ".adw/project.md" declares the application type "mobile:kotlincm" and names these device sources:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |
    When ADW reads the repository's project configuration
    And the device sources are resolved from that project configuration
    Then the device sources resolve to:
      | section                   | value                                           |
      | ## Android System Image   | system-images;android-35;google_apis;arm64-v8a  |
      | ## Android Device Profile | pixel_8                                         |
      | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
      | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-18-2     |

  @adw-1045 @adw-m9cru8-feat-device-source-s
  Scenario Outline: Resolving the device sources of a "mobile:kotlincm" repository whose ".adw/project.md" names <device sources> fails with an error that names "<section>"
    Given a repository whose ".adw/project.md" declares the application type "mobile:kotlincm" and names <device sources>
    When ADW reads the repository's project configuration
    And the device sources are resolved from that project configuration
    Then resolving the device sources fails with an error that names "<section>"

    Examples:
      | device sources                                      | section                   |
      | no device source                                    | ## Android System Image   |
      | every device source but "## Android System Image"   | ## Android System Image   |
      | every device source but "## Android Device Profile" | ## Android Device Profile |
      | every device source but "## iOS Device Type"        | ## iOS Device Type        |
      | every device source but "## iOS Runtime"            | ## iOS Runtime            |

  @adw-1045 @adw-m9cru8-feat-device-source-s
  Scenario: Of two missing device sources, "## Android Device Profile" and "## iOS Runtime", resolving names only the first in the order of the four sections
    Given a repository whose ".adw/project.md" declares the application type "mobile:kotlincm" and names these device sources:
      | section                 | value                                           |
      | ## Android System Image | system-images;android-35;google_apis;arm64-v8a  |
      | ## iOS Device Type      | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
    When ADW reads the repository's project configuration
    And the device sources are resolved from that project configuration
    Then resolving the device sources fails with an error that names "## Android Device Profile"
    And that error does not name "## iOS Runtime"

  @adw-1045 @adw-m9cru8-feat-device-source-s @adw-1047 @adw-1048
  Scenario Outline: In a "mobile:kotlincm" worktree whose ".adw/project.md" names <device sources>, the scenario test phase fails before it runs anything, with an error that names "<section>": the scenario command is not run and the workflow is not parked
    Given a workflow for issue <issue> whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names <device sources>
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-<issue>" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/HomeScreenSteps.kt"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase is attempted
    Then the scenario test phase failed with an error that names "<section>"
    And the scenario command ".adw/" configures was not run
    And no device tool was run
    And the workflow for issue <issue> is not parked
    And no park comment was posted on issue <issue>

    Examples:
      | issue  | device sources                                                            | section                   |
      | 104501 | no device source                                                          | ## Android System Image   |
      | 104502 | every device source but "## iOS Runtime"                                  | ## iOS Runtime            |
      | 104503 | every device source, but its "## Android Device Profile" section is empty | ## Android Device Profile |

  @adw-1045 @adw-m9cru8-feat-device-source-s
  Scenario Outline: In a "cli" worktree whose ".adw/project.md" names <device sources>, the scenario test phase ignores the device sources: it runs the scenario command ".adw/" configures for the issue's tag, and the scenario proof records the tag as passed
    Given a workflow for issue <issue> whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/project.md" names <device sources>
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-<issue>" and steps for it in the step definition directory ".adw/scenarios.md" names
    When the workflow's scenario test phase runs
    Then the scenario command ".adw/" configures ran in the worktree's root for the tag "@adw-<issue>"
    And the scenario proof records the tag "@adw-<issue>" as passed

    Examples:
      | issue  | device sources                           |
      | 104504 | no device source                         |
      | 104505 | every device source but "## iOS Runtime" |

  @adw-1045 @adw-m9cru8-feat-device-source-s
  Scenario: In a "web" worktree whose ".adw/project.md" names no device source, the scenario test phase runs the issue's scenarios on ADW's Playwright project as before, and the scenario proof records the tag as passed
    Given a workflow for issue 104506 whose worktree's ".adw/project.md" declares the application type "web"
    And the worktree's ".adw/project.md" names no device source
    And the worktree holds a feature tagged "@adw-104506" in "features/per-issue/" and steps for it in "features/steps/"
    And "npx" is a stand-in that records each run and writes a JUnit report in which every scenario passes
    When the workflow's scenario test phase runs
    Then "npx bddgen" ran in "features/" before "npx playwright test --grep" ran there for the tag "@adw-104506"
    And the scenario proof records the tag "@adw-104506" as passed

  @adw-1045 @adw-m9cru8-feat-device-source-s
  Scenario: The ADW TypeScript type-check passes once the project configuration carries the device sources and the scenario test phase requires them of a profile with platforms
    Then the ADW TypeScript type-check passes
