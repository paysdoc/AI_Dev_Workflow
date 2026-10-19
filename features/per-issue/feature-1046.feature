@adw-1046 @adw-lrbgfw-feat-per-issue-image
Feature: For a profile with platforms, each selected per-issue image carries the platform of its first directory under the harvest root, an image outside a platform directory is never evidence, and the proof names the missing platforms of each per-issue scenario shown on only some of them, for the reviewer to judge

  An image's platform is the first directory of its path under the harvest root, the proof directory ADW gives the scenario run.

  Background:
    Given the ADW codebase is checked out

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario Outline: For a profile whose platforms are "android" and "ios", the image at "<path>" under the harvest root has the platform "<platform>", the first directory of its path
    When the platform of the image at "<path>" under the harvest root is read, for a profile whose platforms are "android" and "ios"
    Then the image's platform is "<platform>"

    Examples:
      | path                   | platform |
      | android/login.png      | android  |
      | ios/login.png          | ios      |
      | ios/a/b.png            | ios      |
      | android/login/home.png | android  |

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario Outline: For a profile whose platforms are "android" and "ios", the image at "<path>" under the harvest root is unattributed, as it lies in no directory or the first directory of its path is no platform of the profile
    When the platform of the image at "<path>" under the harvest root is read, for a profile whose platforms are "android" and "ios"
    Then the image is unattributed

    Examples:
      | path                      |
      | login.png                 |
      | linux/x.png               |
      | androidx/login.png        |
      | screens/android/login.png |

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: For a profile whose only platform is "android", the image at "ios/login.png" under the harvest root is unattributed
    When the platform of the image at "ios/login.png" under the harvest root is read, for a profile whose only platform is "android"
    Then the image is unattributed

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: The Android run and the iOS run report a per-issue scenario under its identical title: both test cases are attributed to the scenario, each run's image is selected with its platform, and the regression run's images are not selected
    Given a scenario run for issue 104601 in a "mobile:kotlincm" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-104601.feature":
      """
      @adw-104601
      Feature: Login

        Scenario: The login screen greets the user
          Given the user has an account
          When the user opens the app
          Then the login screen greets the user by name
      """
    And the scenario run's worktree holds the feature file "features/regression/home.feature":
      """
      @regression
      Feature: Home

        Scenario: The home screen opens
          When the user opens the app
          Then the home screen shows its title
      """
    And the scenario run's JUnit report for the tag "@adw-104601" records these test cases of its platform runs, with attachments at these paths under the proof directory ADW gave the run:
      | platform run | test case                        | outcome | attachments       |
      | android      | The login screen greets the user | passed  | android/login.png |
      | ios          | The login screen greets the user | passed  | ios/login.png     |
    And the scenario run's JUnit report for the tag "@regression" records these test cases of its platform runs, with attachments at these paths under the proof directory ADW gave the run:
      | platform run | test case             | outcome | attachments      |
      | android      | The home screen opens | passed  | android/home.png |
      | ios          | The home screen opens | passed  | ios/home.png     |
    When the proof assembler assembles the proof of the scenario run
    Then the proof assembler selects exactly these images, each for the scenario and the platform named:
      | image             | scenario                         | platform |
      | android/login.png | The login screen greets the user | android  |
      | ios/login.png     | The login screen greets the user | ios      |
    And the scenario proof has no platform coverage line
    And the scenario proof does not state "no scenario opened a screen"

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: The images a per-issue scenario attaches outside a platform directory are listed in the proof as unattributed, are not selected and count for no platform, while its images under "android/" and "ios/" are selected
    Given a scenario run for issue 104602 in a "mobile:kotlincm" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-104602.feature":
      """
      @adw-104602
      Feature: Account

        Scenario: The login screen greets the user
          Given the user has an account
          When the user opens the app
          Then the login screen greets the user by name

        Scenario: The settings screen lists the account
          Given the user is logged in
          When the user opens the settings
          Then the settings screen lists the account's e-mail address
      """
    And the scenario run's JUnit report for the tag "@adw-104602" records these test cases of its platform runs, with attachments at these paths under the proof directory ADW gave the run:
      | platform run | test case                             | outcome | attachments                    |
      | android      | The login screen greets the user      | passed  | android/login.png, login.png   |
      | ios          | The login screen greets the user      | passed  | ios/login.png, linux/login.png |
      | android      | The settings screen lists the account | passed  | android/settings.png           |
      | ios          | The settings screen lists the account | passed  | settings.png                   |
    When the proof assembler assembles the proof of the scenario run
    Then the proof assembler selects exactly these images, each for the scenario and the platform named:
      | image                | scenario                              | platform |
      | android/login.png    | The login screen greets the user      | android  |
      | ios/login.png        | The login screen greets the user      | ios      |
      | android/settings.png | The settings screen lists the account | android  |
    And the scenario proof lists exactly these images as unattributed:
      | image           |
      | login.png       |
      | linux/login.png |
      | settings.png    |
    And the scenario proof has one platform coverage line for each of exactly these per-issue scenarios, naming the platforms present and the platforms missing:
      | scenario                              | present | missing |
      | The settings screen lists the account | android | ios     |

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: The proof has one platform coverage line for each per-issue scenario whose images come from one platform run only, naming the platform present and the platform missing, and none for the scenario with images from both runs or for the one with no image
    Given a scenario run for issue 104603 in a "mobile:kotlincm" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-104603.feature":
      """
      @adw-104603
      Feature: Account

        Scenario: The login screen greets the user
          Given the user has an account
          When the user opens the app
          Then the login screen greets the user by name

        Scenario: The onboarding screen asks to send notifications
          Given the user has just installed the app
          When the user opens the app
          Then the onboarding screen asks to send notifications

        Scenario: The settings screen lists the account
          Given the user is logged in
          When the user opens the settings
          Then the settings screen lists the account's e-mail address

        Scenario: The sync API answers with the account
          Given the user is logged in
          When the app asks the sync API for the account
          Then the sync API answers with the account
      """
    And the scenario run's JUnit report for the tag "@adw-104603" records these test cases of its platform runs, with attachments at these paths under the proof directory ADW gave the run:
      | platform run | test case                                        | outcome | attachments                                            |
      | android      | The login screen greets the user                 | passed  | android/login/greeting.png, android/login/keyboard.png |
      | ios          | The login screen greets the user                 | passed  |                                                        |
      | android      | The onboarding screen asks to send notifications | passed  |                                                        |
      | ios          | The onboarding screen asks to send notifications | passed  | ios/onboarding.png                                     |
      | android      | The settings screen lists the account            | passed  | android/settings.png                                   |
      | ios          | The settings screen lists the account            | passed  | ios/settings.png                                       |
      | android      | The sync API answers with the account            | passed  |                                                        |
      | ios          | The sync API answers with the account            | passed  |                                                        |
    When the proof assembler assembles the proof of the scenario run
    Then the scenario proof has one platform coverage line for each of exactly these per-issue scenarios, naming the platforms present and the platforms missing:
      | scenario                                         | present | missing |
      | The login screen greets the user                 | android | ios     |
      | The onboarding screen asks to send notifications | ios     | android |
    And the scenario proof does not state "no scenario opened a screen"

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: A test case is still attributed to a scenario by its exact title: when the iOS run reports the per-issue scenario under another title, that test case is left out with its image, and the proof names "ios" as the platform missing for the scenario
    Given a scenario run for issue 104604 in a "mobile:kotlincm" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-104604.feature":
      """
      @adw-104604
      Feature: Login

        Scenario: The login screen greets the user
          Given the user has an account
          When the user opens the app
          Then the login screen greets the user by name
      """
    And the scenario run's JUnit report for the tag "@adw-104604" records these test cases of its platform runs, with attachments at these paths under the proof directory ADW gave the run:
      | platform run | test case                               | outcome | attachments       |
      | android      | The login screen greets the user        | passed  | android/login.png |
      | ios          | The login screen greets the user on iOS | passed  | ios/login.png     |
    When the proof assembler assembles the proof of the scenario run
    Then the proof assembler selects exactly these images, each for the scenario and the platform named:
      | image             | scenario                         | platform |
      | android/login.png | The login screen greets the user | android  |
    And the scenario proof states "Left out, because no scenario in the feature files has their name: `The login screen greets the user on iOS`"
    And the scenario proof has one platform coverage line for each of exactly these per-issue scenarios, naming the platforms present and the platforms missing:
      | scenario                         | present | missing |
      | The login screen greets the user | android | ios     |

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario Outline: A "mobile:kotlincm" proof that selected no image, because its per-issue scenario <reason>, states "no scenario opened a screen", and neither the "web" line "no scenario opened a page" nor a platform coverage line
    Given a scenario run for issue <issue> in a "mobile:kotlincm" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-<issue>.feature":
      """
      @adw-<issue>
      Feature: Sync

        Scenario: The sync API answers with the account
          Given the user is logged in
          When the app asks the sync API for the account
          Then the sync API answers with the account
      """
    And the scenario run's worktree holds the feature file "features/regression/home.feature":
      """
      @regression
      Feature: Home

        Scenario: The home screen opens
          When the user opens the app
          Then the home screen shows its title
      """
    And the scenario run's JUnit report for the tag "@adw-<issue>" records these test cases of its platform runs, with attachments at these paths under the proof directory ADW gave the run:
      | platform run | test case                             | outcome | attachments           |
      | android      | The sync API answers with the account | passed  | <android attachments> |
      | ios          | The sync API answers with the account | passed  | <ios attachments>     |
    And the scenario run's JUnit report for the tag "@regression" records these test cases of its platform runs, with attachments at these paths under the proof directory ADW gave the run:
      | platform run | test case             | outcome | attachments      |
      | android      | The home screen opens | passed  | android/home.png |
      | ios          | The home screen opens | passed  | ios/home.png     |
    When the proof assembler assembles the proof of the scenario run
    Then the proof assembler selects no image
    And the scenario proof states "no scenario opened a screen"
    And the scenario proof does not state "no scenario opened a page"
    And the scenario proof has no platform coverage line

    Examples:
      | issue  | reason                                            | android attachments | ios attachments |
      | 104605 | attached no image                                 |                     |                 |
      | 104606 | attached images only outside a platform directory | sync.png            | linux/sync.png  |

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: A "web" proof whose per-issue scenarios opened no page keeps its line "no scenario opened a page", and has neither the line "no scenario opened a screen" nor a platform coverage line
    Given a scenario run for issue 104607 in a "web" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-104607.feature":
      """
      @adw-104607
      Feature: Order total

        Scenario: The cart API answers with the order total
          Given the cart holds a lamp and a chair
          When the shopper asks the cart API for the order total
          Then the cart API answers with the sum of their prices
      """
    And the scenario run's worktree holds the feature file "features/regression/cart.feature":
      """
      @regression
      Feature: Cart

        Scenario: The cart page loads
          When the shopper opens the cart
          Then the cart page shows its heading
      """
    And the scenario run's JUnit reports record these test cases, each named as the repository's scenario runner names it:
      | feature file                              | scenario                                  | outcome | attachments   |
      | features/per-issue/feature-104607.feature | The cart API answers with the order total | passed  |               |
      | features/regression/cart.feature          | The cart page loads                       | passed  | cart-page.png |
    When the proof assembler assembles the proof of the scenario run
    Then the proof assembler selects no image
    And the scenario proof states "no scenario opened a page"
    And the scenario proof does not state "no scenario opened a screen"
    And the scenario proof has no platform coverage line

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: A "web" proof reads as before: its two tag sections, and an Evidence section that gives the absolute path of each per-issue image with the name of its scenario and says nothing about platforms
    Given a scenario run for issue 104608 in a "web" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-104608.feature":
      """
      @adw-104608
      Feature: Order total

        Scenario: The cart shows the order total
          Given the cart holds a lamp and a chair
          When the shopper opens the cart
          Then the cart shows the sum of their prices
      """
    And the scenario run's worktree holds the feature file "features/regression/cart.feature":
      """
      @regression
      Feature: Cart

        Scenario: The cart page loads
          When the shopper opens the cart
          Then the cart page shows its heading
      """
    And the scenario run's JUnit reports record these test cases, each named as the repository's scenario runner names it:
      | feature file                              | scenario                       | outcome | attachments    |
      | features/per-issue/feature-104608.feature | The cart shows the order total | passed  | cart-total.png |
      | features/regression/cart.feature          | The cart page loads            | passed  | cart-page.png  |
    When the proof assembler assembles the proof of the scenario run
    Then the scenario proof reads exactly as follows, each value in angle brackets standing for what it names:
      """
      # Scenario Proof

      Generated at: <generated at>

      ## @regression Scenarios (severity: blocker)

      **Status:** ✅ PASSED
      **Exit Code:** 0
      **Report:** 1 passed, 0 failed of 1

      ### Output

      ```
      (no output)
      ```

      ## @adw-104608 Scenarios (severity: blocker)

      **Status:** ✅ PASSED
      **Exit Code:** 0
      **Report:** 1 passed, 0 failed of 1

      ### Output

      ```
      (no output)
      ```

      ## Evidence

      Per-issue scenario images (1):

      - `Order total › The cart shows the order total`: <path of cart-total.png>
      """

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: A "cli" proof reads as before: its two tag sections and no Evidence section, although its per-issue scenario attached an image
    Given a scenario run for issue 104609 in a "cli" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-104609.feature":
      """
      @adw-104609
      Feature: Report

        Scenario: The report command prints the total
          When the user runs the report command
          Then the report shows the total
      """
    And the scenario run's worktree holds the feature file "features/regression/report.feature":
      """
      @regression
      Feature: Report command

        Scenario: The report command starts
          When the user runs the report command
          Then the report command exits cleanly
      """
    And the scenario run's JUnit reports record these test cases, each named as the repository's scenario runner names it:
      | feature file                              | scenario                            | outcome | attachments  |
      | features/per-issue/feature-104609.feature | The report command prints the total | passed  | terminal.png |
      | features/regression/report.feature        | The report command starts           | passed  |              |
    When the proof assembler assembles the proof of the scenario run
    Then the scenario proof reads exactly as follows, each value in angle brackets standing for what it names:
      """
      # Scenario Proof

      Generated at: <generated at>

      ## @regression Scenarios (severity: blocker)

      **Status:** ✅ PASSED
      **Exit Code:** 0
      **Report:** 1 passed, 0 failed of 1

      ### Output

      ```
      (no output)
      ```

      ## @adw-104609 Scenarios (severity: blocker)

      **Status:** ✅ PASSED
      **Exit Code:** 0
      **Report:** 1 passed, 0 failed of 1

      ### Output

      ```
      (no output)
      ```
      """

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: In a "mobile:kotlincm" repository the images a per-issue scenario's Android and iOS runs attach under "android/" and "ios/" are uploaded, shown in the "Review Passed" comment and on the pull request, and handed to the review agent, while the images it attaches outside a platform directory are listed to the review agent as unattributed and reach none of them
    Given a workflow for issue 104610 in a "mobile:kotlincm" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner's platform runs report with these outcomes and with attachments at these paths under the proof directory ADW gave the run:
      | feature file                              | scenario tags | scenario                         | platform run | outcome | attachments                                |
      | features/per-issue/feature-104610.feature | @adw-104610   | The login screen greets the user | android      | passed  | android/greeting-android.png, greeting.png |
      | features/per-issue/feature-104610.feature | @adw-104610   | The login screen greets the user | ios          | passed  | ios/greeting-ios.png, appium/session.png   |
      | features/regression/home.feature          | @regression   | The home screen opens            | android      | passed  | android/home-android.png                   |
      | features/regression/home.feature          | @regression   | The home screen opens            | ios          | passed  | ios/home-ios.png                           |
    And the stand-in review agent's verdict on every review is a pass
    When the scenario test phase runs and the review phase judges its proof
    And the proof is published on pull request 4610
    Then the screenshot store received exactly these images, and nothing else:
      | image                |
      | greeting-android.png |
      | greeting-ios.png     |
    And the "Review Passed" comment on issue 104610 shows exactly these images, each embedded from a URL the screenshot store returned for it:
      | image                |
      | greeting-android.png |
      | greeting-ios.png     |
    And the comments on pull request 4610 show exactly these images, each embedded from a URL the screenshot store returned for it:
      | image                |
      | greeting-android.png |
      | greeting-ios.png     |
    And the review agent was started on review attempt 1 with the paths of exactly these images in its prompt, each of which existed when it started:
      | image                |
      | greeting-android.png |
      | greeting-ios.png     |
    And the proof the review agent received lists exactly these images as unattributed:
      | image              |
      | greeting.png       |
      | appium/session.png |
    And the proof the review agent received has no platform coverage line

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: In a "mobile:kotlincm" repository a per-issue scenario shown on Android only fails no gate: the review agent receives a proof whose platform coverage line names "android" as present and "ios" as missing, and the review goes as the review agent's verdict says
    Given a workflow for issue 104611 in a "mobile:kotlincm" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner's platform runs report with these outcomes and with attachments at these paths under the proof directory ADW gave the run:
      | feature file                              | scenario tags | scenario                         | platform run | outcome | attachments                  |
      | features/per-issue/feature-104611.feature | @adw-104611   | The login screen greets the user | android      | passed  | android/greeting-android.png |
      | features/per-issue/feature-104611.feature | @adw-104611   | The login screen greets the user | ios          | passed  |                              |
      | features/regression/home.feature          | @regression   | The home screen opens            | android      | passed  | android/home-android.png     |
      | features/regression/home.feature          | @regression   | The home screen opens            | ios          | passed  | ios/home-ios.png             |
    And the stand-in review agent's verdict on every review is a pass
    When the scenario test phase runs and the review phase judges its proof
    Then the scenario proof records no blocker failures
    And the proof the review agent received has one platform coverage line for each of exactly these per-issue scenarios, naming the platforms present and the platforms missing:
      | scenario                         | present | missing |
      | The login screen greets the user | android | ios     |
    And the "Review Passed" comment on issue 104611 shows exactly these images, each embedded from a URL the screenshot store returned for it:
      | image                |
      | greeting-android.png |

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: In a "mobile:kotlincm" repository whose per-issue scenarios opened no screen, the gate passes, nothing is uploaded, the "Review Passed" comment shows no image, and the proof the review agent receives states "no scenario opened a screen"
    Given a workflow for issue 104612 in a "mobile:kotlincm" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner's platform runs report with these outcomes and with attachments at these paths under the proof directory ADW gave the run:
      | feature file                              | scenario tags | scenario                              | platform run | outcome | attachments              |
      | features/per-issue/feature-104612.feature | @adw-104612   | The sync API answers with the account | android      | passed  |                          |
      | features/per-issue/feature-104612.feature | @adw-104612   | The sync API answers with the account | ios          | passed  |                          |
      | features/regression/home.feature          | @regression   | The home screen opens                 | android      | passed  | android/home-android.png |
      | features/regression/home.feature          | @regression   | The home screen opens                 | ios          | passed  | ios/home-ios.png         |
    And the stand-in review agent's verdict on every review is a pass
    When the scenario test phase runs and the review phase judges its proof
    Then the scenario proof records no blocker failures
    And nothing was uploaded to the screenshot store
    And the "Review Passed" comment on issue 104612 shows no image
    And the review agent was started on review attempt 1 with no image path in its prompt
    And the review agent received no image path with the proof
    And the proof the review agent received states "no scenario opened a screen"
    And the proof the review agent received does not state "no scenario opened a page"

  @adw-1046 @adw-lrbgfw-feat-per-issue-image
  Scenario: The ADW TypeScript type-check passes once each per-issue image carries a platform and the proof states the platform coverage of the per-issue scenarios
    Then the ADW TypeScript type-check passes
