@adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
Feature: The application type "mobile:kotlincm" resolves end to end: the gate lets it through, its Kotlin and Java step definitions are found, its Gradle stack reads as one JVM stack, and its reviewer is given the mobile guidance section

  An application type's platforms are the kinds of device its scenarios run on; "cli" and "web" have none.

  Background:
    Given the ADW codebase is checked out

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario: The mapping runs a "mobile:kotlincm" application's scenarios with the runner ".adw/scenarios.md" describes, asks for an image of each per-issue scenario as evidence, declares the platforms "android" and "ios", and chooses the review guidance section "Mobile applications (Kotlin Compose Multiplatform)"
    When the application-type mapping is consulted for the application type "mobile:kotlincm"
    Then the mapping chooses the scenario runner that ".adw/scenarios.md" describes
    And the mapping asks for an image of each per-issue scenario as evidence
    And the mapping declares exactly the platforms "android" and "ios"
    And the mapping chooses the review guidance section "Mobile applications (Kotlin Compose Multiplatform)"

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario Outline: The mapping declares no platform for the application type "<type>", and keeps its review guidance section "<section>"
    When the application-type mapping is consulted for the application type "<type>"
    Then the mapping declares no platform
    And the mapping chooses the review guidance section "<section>"

    Examples:
      | type | section          |
      | cli  | CLI applications |
      | web  | Web applications |

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario: The mapping gives "cli", "web" and "mobile:kotlincm" each a review guidance section of its own
    When the application-type mapping is consulted for the application type "cli"
    And the application-type mapping is consulted for the application type "web"
    And the application-type mapping is consulted for the application type "mobile:kotlincm"
    Then each of those consultations chose a review guidance section, and no two chose the same one

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario Outline: The mapping knows a mobile application type only by its whole name: it parks the issue for the application type "<value>", and records the value it found
    When the application-type mapping is consulted for the application type "<value>"
    Then the mapping decides to park the issue for the reason "missing_application_type"
    And the park records that the application type "<value>" was found

    Examples:
      | value          |
      | mobile         |
      | kotlincm       |
      | mobile:flutter |

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario: An issue in a repository whose ".adw/project.md" declares the application type "mobile:kotlincm" is not parked when its workflow starts
    Given a workflow for issue 104301 whose repository's ".adw/project.md" declares the application type "mobile:kotlincm"
    When the workflow for issue 104301 starts
    Then the workflow's start completed
    And the workflow for issue 104301 is not parked
    And no park comment was posted on issue 104301

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario Outline: An issue in a repository whose ".adw/project.md" declares "<value>" rather than "mobile:kotlincm" is parked as "human_gated" when its workflow starts, with a comment that names the value
    Given a workflow for issue <issue> whose repository's ".adw/project.md" declares the application type "<value>"
    When the workflow for issue <issue> starts
    Then the workflow's start did not complete
    And the workflow for issue <issue> is parked as "human_gated"
    And the park comment posted on issue <issue> names "## Application Type"
    And the park comment posted on issue <issue> names "<value>"

    Examples:
      | issue  | value          |
      | 104302 | mobile         |
      | 104303 | mobile:flutter |

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario: "## Retry" on an issue parked because its repository declared no application type re-reads "## Application Type": once the default branch declares "mobile:kotlincm", the resumed workflow starts and is not parked again
    Given a workflow for issue 104304 whose repository's ".adw/project.md" has no "## Application Type" section
    And the workflow for issue 104304 has started and been parked as "human_gated"
    And the repository's default branch has since gained a commit whose ".adw/project.md" declares the application type "mobile:kotlincm"
    When "## Retry" is posted on issue 104304
    And the resumed workflow starts
    Then the workflow's start completed
    And the workflow for issue 104304 is not parked
    And exactly one park comment was posted on issue 104304

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario: When the workflow starts in a "mobile:kotlincm" repository, the run log describes the application type by its profile: the runner ".adw/scenarios.md" describes, per-issue scenario images as evidence, and the platforms "android" and "ios"
    Given a workflow for issue 104305 whose repository's ".adw/project.md" declares the application type "mobile:kotlincm"
    When the workflow for issue 104305 starts
    Then the workflow's start completed
    And the workflow's execution log has a line for the application type "mobile:kotlincm"
    And that line says the scenarios run with the runner that ".adw/scenarios.md" describes
    And that line says the evidence is per-issue scenario images
    And that line names the platforms "android" and "ios"

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario Outline: When the workflow starts in a "<type>" repository, the run log describes the application type by its profile and names no platform
    Given a workflow for issue <issue> whose repository's ".adw/project.md" declares the application type "<type>"
    When the workflow for issue <issue> starts
    Then the workflow's start completed
    And the workflow's execution log has a line for the application type "<type>"
    And that line names no platform

    Examples:
      | issue  | type |
      | 104306 | cli  |
      | 104307 | web  |

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario: "cucumber-jvm" is a Gherkin runtime whose step definitions are Kotlin and Java files
    When the Gherkin runtime registry is consulted for the BDD framework "cucumber-jvm"
    Then the registry counts "cucumber-jvm" as a Gherkin runtime
    And the registry looks for the step definitions of "cucumber-jvm" in files ending in ".kt" and ".java", and in no others

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl @adw-1045 @adw-1047
  Scenario Outline: In a "mobile:kotlincm" repository whose ".adw/scenarios.md" names "cucumber-jvm", a <language> step definition file under the step definition directory it names is found: the scenario command runs for the issue's tag and the scenario proof is not skipped
    Given a workflow for issue <issue> whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "<step definition directory>"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-<issue>" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "<step definition file>"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase runs
    Then the scenario command ".adw/" configures ran in the worktree's root for the tag "@adw-<issue>"
    And the scenario proof records the tag "@adw-<issue>" as passed

    Examples:
      | issue  | language | step definition directory | step definition file                                           |
      | 104308 | Kotlin   | scenarios/src/test/kotlin | scenarios/src/test/kotlin/com/example/steps/HomeScreenSteps.kt |
      | 104309 | Java     | scenarios/src/test/java   | scenarios/src/test/java/com/example/steps/HomeScreenSteps.java |

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl @adw-1045 @adw-1047
  Scenario: Under "cucumber-jvm" a TypeScript file is not a step definition, although it would be under a runner ADW does not know: with no Kotlin or Java file under the step definition directory, the scenario proof is skipped and no tag is run
    Given a workflow for issue 104310 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/project.md" names every device source
    And the worktree's ".adw/scenarios.md" names the BDD framework "cucumber-jvm" and the step definition directory "scenarios/src/test/kotlin"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@adw-104310" in the scenario directory ".adw/scenarios.md" names, and steps for it in the file "scenarios/src/test/kotlin/com/example/steps/home.steps.ts"
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the workflow's scenario test phase runs
    Then the scenario proof ran no tag
    And the scenario proof notes that no step definition file was found in "scenarios/src/test/kotlin/"

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario: In a "mobile:kotlincm" repository the step-definition phase starts the generator in the mode for the scenario runner that ".adw/scenarios.md" describes, as in a "cli" repository
    Given a workflow for issue 104311 whose worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    When the workflow's step-definition phase runs
    Then the step-definition generator was started once, for issue 104311
    And the step-definition generator was started in the mode for the scenario runner that ".adw/scenarios.md" describes

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario Outline: The stack-coherence check reads "cucumber-jvm" with the unit-test command "<run tests>" and a Gradle scenario command as one JVM stack, and warns about nothing
    Given a target repository whose ".adw/" describes its stack as:
      | test framework       | <test framework>       |
      | run tests            | <run tests>            |
      | BDD framework        | cucumber-jvm           |
      | run scenarios by tag | <run scenarios by tag> |
    When the stack-coherence check judges that repository's stack
    Then the stack-coherence check reads the stack as the single language "jvm"
    And the stack-coherence check warns about nothing

    Examples:
      | test framework | run tests          | run scenarios by tag                                                                 |
      | JUnit          | ./gradlew test     | ./gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}"                            |
      | kotlin.test    | ./gradlew allTests | ./gradlew :scenarios:test --tests "*RunCucumberTest" -Dcucumber.filter.tags="@{tag}" |
      | JUnit          | gradle test        | gradle :scenarios:test -Dcucumber.filter.tags="@{tag}"                               |

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario Outline: The stack-coherence check still warns "language-mismatch", and only that, when "<bdd framework>" meets the unit-test command "<run tests>"
    Given a target repository whose ".adw/" describes its stack as:
      | test framework       | <test framework>       |
      | run tests            | <run tests>            |
      | BDD framework        | <bdd framework>        |
      | run scenarios by tag | <run scenarios by tag> |
    When the stack-coherence check judges that repository's stack
    Then the stack-coherence check gives the one warning "language-mismatch"
    And that warning names "<bdd framework>" and "<run tests>"

    Examples:
      | test framework | run tests      | bdd framework | run scenarios by tag                                      |
      | JUnit          | ./gradlew test | cucumber-js   | npx cucumber-js --tags "@{tag}"                           |
      | vitest         | bun run test   | cucumber-jvm  | ./gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}" |

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario: In a "mobile:kotlincm" repository whose ".adw/" describes its Kotlin and Gradle stack, the unit-test phase posts no stack-coherence warning and does not label the issue "adw:unverified"
    Given a workflow for issue 104312 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command |
      | type check             | N/A     |
      | additional type checks | N/A     |
      | lint                   | N/A     |
      | build                  | N/A     |
    And the worktree's ".adw/project.md" declares the application type "mobile:kotlincm"
    And the worktree's ".adw/" describes its stack as:
      | test framework       | JUnit                                                     |
      | run tests            | ./gradlew test                                            |
      | BDD framework        | cucumber-jvm                                              |
      | run scenarios by tag | ./gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}" |
    And the test agent writes a JUnit report in which every unit test passes
    When the workflow's unit-test phase runs
    Then the unit-test phase completed
    And the unit-test phase posted no comment headed "Stack Coherence" on issue 104312
    And issue 104312 was not labelled "adw:unverified"

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl @adw-1045 @adw-1047
  Scenario Outline: The review agent of a "<type>" repository is started with the review guidance section "<section>" in its prompt, and with neither of the other two application types' sections
    Given a workflow for issue <issue> in a "<type>" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's ".adw/project.md" names <device sources>
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                               | scenario tags | scenario                     | outcome | attachments |
      | features/per-issue/feature-<issue>.feature | @adw-<issue>  | The welcome message is shown | passed  |             |
    And the stand-in review agent's verdict on every review is a pass
    And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot
    When the scenario test phase runs and the review phase judges its proof
    Then the review agent was started on review attempt 1 with the review guidance section "<section>" in its prompt
    And the review agent was started on review attempt 1 without the review guidance section "<other section>" in its prompt
    And the review agent was started on review attempt 1 without the review guidance section "<third section>" in its prompt

    Examples:
      | issue  | type            | device sources      | section                                            | other section    | third section                                      |
      | 104313 | mobile:kotlincm | every device source | Mobile applications (Kotlin Compose Multiplatform) | CLI applications | Web applications                                   |
      | 104314 | cli             | no device source    | CLI applications                                   | Web applications | Mobile applications (Kotlin Compose Multiplatform) |
      | 104315 | web             | no device source    | Web applications                                   | CLI applications | Mobile applications (Kotlin Compose Multiplatform) |

  @adw-1043 @adw-z3fh5r-feat-the-mobile-kotl
  Scenario: The ADW TypeScript type-check passes once every application profile declares its platforms and the stack-coherence check knows the JVM
    Then the ADW TypeScript type-check passes
