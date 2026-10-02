@adw-965 @adw-mr7y3g-bug-move-the-install
Feature: The install, chore, PR, PR-review, patch, document and depaudit surface rows run in-process on the phase harness, and T11 reads what the git-mock logged

  Issue #965 is a slice of #935. It moves ten rows of features/regression/surfaces/ onto the
  in-process phase harness of #963; item 3 of the `## Divergence` section of ADR-0037 stays open
  until the last slice. Four rows take the title of the orchestrator that runs their phase in
  production: rows 12 and 18 adwPatch, row 27 adwSdlc, and row 35 none, since no orchestrator
  calls the depaudit setup.

  The git-mock, test/mocks/git-remote-mock.ts, stands first on PATH under the @regression hooks and
  turns push, fetch, clone, pull and ls-remote into no-ops. With MOCK_GIT_LOG set, it appends one
  JSONL line, { subcommand, args, cwd }, for each call it intercepts. setupMockInfrastructure points
  MOCK_GIT_LOG at a log of its own and exposes its path as the context's gitLogPath; teardown
  removes it. T11, "the git-mock recorded a push to branch {string}", reads that log. It used to
  compare the branch with World.targetBranch only.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE TEN ROWS ─────────────────────────────────────────────────────────────────────────

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario: The ten surface rows of this slice pass on two Cucumber runs in a row in the same checkout, each in under 5 seconds, and leave no git repository behind
    When the regression suite's surface scenarios are run through Cucumber twice in a row
    Then each of these surface rows passes on both runs, in under 5 seconds each time:
      | row                                                  |
      | row-12-adwMerge-prPhase-happy.feature                |
      | row-13-adwChore-workflowInit-planPhase-happy.feature |
      | row-14-adwChore-buildPhase-happy.feature             |
      | row-17-adwPatch-buildPhase-happy.feature             |
      | row-18-adwInit-installPhase-happy.feature            |
      | row-24-adwPrReview-prReviewPlanPhase-happy.feature   |
      | row-25-adwPrReview-prReviewBuildPhase-happy.feature  |
      | row-26-adwPrReview-commitPushPhase-happy.feature     |
      | row-27-adwDocument-documentPhase-happy.feature       |
      | row-35-adwMerge-depauditSetup-happy.feature          |
    And neither run left a git repository in its temporary directory

  # ── §2 THE GIT-MOCK'S INVOCATION LOG ────────────────────────────────────────────────────────

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario Outline: With MOCK_GIT_LOG set, the git-mock intercepts "git <arguments>", exits 0 and appends one JSONL line recording the subcommand "<subcommand>", the full argument list and the working directory
    Given the worktree for adwId "fixture965-log" is initialised at branch "fixture965-log"
    And the git-mock's MOCK_GIT_LOG names a log file that does not exist yet
    When the git-mock is run with the arguments "<arguments>" in the worktree for adwId "fixture965-log"
    Then the git-mock exits 0
    And the git-mock log holds exactly one line, recording the subcommand "<subcommand>", the arguments "<arguments>" and the worktree for adwId "fixture965-log" as its working directory

    Examples:
      | subcommand | arguments                                                            |
      | push       | push --force-with-lease --force-if-includes -u origin fixture965-log |
      | fetch      | fetch origin fixture965-log                                          |
      | clone      | clone https://github.com/acme/widgets.git widgets                    |
      | pull       | pull --ff-only origin main                                           |
      | ls-remote  | ls-remote --heads origin                                             |

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario: With MOCK_GIT_LOG set, the git-mock hands a local subcommand to the real git and writes no line to its log
    Given the worktree for adwId "fixture965-local" is initialised at branch "fixture965-local"
    And the git-mock's MOCK_GIT_LOG names a log file that does not exist yet
    When the git-mock is run with the arguments "rev-parse --abbrev-ref HEAD" in the worktree for adwId "fixture965-local"
    Then the git-mock exits 0 and prints "fixture965-local"
    And the git-mock wrote no line to its log

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario: A fetch and then a push of the branch, as a phase pushes it, leave two lines in the git-mock log in the order they were made, and the local call between them leaves none
    Given the worktree for adwId "fixture965-order" is initialised at branch "fixture965-order"
    And the git-mock's MOCK_GIT_LOG names a log file that does not exist yet
    When the git-mock is run with the arguments "fetch origin fixture965-order" in the worktree for adwId "fixture965-order"
    And the git-mock is run with the arguments "rev-parse HEAD" in the worktree for adwId "fixture965-order"
    And the git-mock is run with the arguments "push --force-with-lease --force-if-includes -u origin fixture965-order" in the worktree for adwId "fixture965-order"
    Then the git-mock log holds these lines, in this order, each with the worktree for adwId "fixture965-order" as its working directory:
      | subcommand | arguments                                                              |
      | fetch      | fetch origin fixture965-order                                          |
      | push       | push --force-with-lease --force-if-includes -u origin fixture965-order |

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario: Without MOCK_GIT_LOG, the git-mock still turns a push into a no-op that exits 0 and leaves the origin without the branch
    Given the worktree for adwId "fixture965-nolog" is initialised at branch "fixture965-nolog"
    And MOCK_GIT_LOG is unset for the git-mock
    When the git-mock is run with the arguments "push -u origin fixture965-nolog" in the worktree for adwId "fixture965-nolog"
    Then the git-mock exits 0 and prints "Everything up-to-date"
    And the origin of the worktree for adwId "fixture965-nolog" holds no branch "fixture965-nolog"

  # ── §3 THE MOCK INFRASTRUCTURE'S LOG ────────────────────────────────────────────────────────

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario: The mock infrastructure points MOCK_GIT_LOG at a log of its own under the system's temporary directory, exposes it as the context's gitLogPath, and a push through the git on PATH lands in it
    Given the mock infrastructure is set up
    And the worktree for adwId "fixture965-harness" is initialised at branch "fixture965-harness"
    When git is run with the arguments "push -u origin fixture965-harness" in the worktree for adwId "fixture965-harness"
    Then MOCK_GIT_LOG names the mock context's gitLogPath, which lies under the system's temporary directory
    And the log at the mock context's gitLogPath holds exactly one line, recording the subcommand "push", the arguments "push -u origin fixture965-harness" and the worktree for adwId "fixture965-harness" as its working directory

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario Outline: Tearing the mock infrastructure down removes its git-mock log and leaves MOCK_GIT_LOG <before> again, as it was before the setup
    Given MOCK_GIT_LOG is <before> before the mock infrastructure is set up
    And the mock infrastructure is set up
    And the worktree for adwId "fixture965-teardown" is initialised at branch "fixture965-teardown"
    And git is run with the arguments "push -u origin fixture965-teardown" in the worktree for adwId "fixture965-teardown"
    When the mock infrastructure is torn down
    Then no file is left at the gitLogPath the mock context exposed
    And MOCK_GIT_LOG is <before> again

    Examples:
      | before                                    |
      | unset                                     |
      | set to "/nonexistent/adw-965-outer.jsonl" |

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario: A push logged under one setup of the mock infrastructure is not in the log of the next setup
    Given the mock infrastructure is set up
    And the worktree for adwId "fixture965-first" is initialised at branch "fixture965-first"
    And git is run with the arguments "push -u origin fixture965-first" in the worktree for adwId "fixture965-first"
    And the mock infrastructure is torn down
    When the mock infrastructure is set up
    Then the log at the mock context's gitLogPath holds no line

  # ── §4 T11 READS THE LOG ────────────────────────────────────────────────────────────────────

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario Outline: Under the @regression hooks, T11 fails when <what went through git>, even though G2 named the branch
    Given a throwaway regression scenario with the steps:
      """
      Given the worktree for adwId "throwaway965-t11" is initialised at branch "throwaway965-t11"
      And the git-mock has a clean worktree at branch "throwaway965-t11"
      And git is run with the arguments "<arguments>" in the worktree for adwId "throwaway965-t11"
      Then the git-mock recorded a push to branch "throwaway965-t11"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step 'the git-mock recorded a push to branch "throwaway965-t11"'

    Examples:
      | what went through git             | arguments                               |
      | only a local commit on the branch | commit --allow-empty -q -m throwaway965 |
      | only a fetch of the branch        | fetch origin throwaway965-t11           |
      | only a push of another branch     | push -u origin throwaway965-t11-other   |

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario: Under the @regression hooks, T11 passes once a push of the branch, as a phase pushes it, has gone through the git on PATH
    Given a throwaway regression scenario with the steps:
      """
      Given the worktree for adwId "throwaway965-t11" is initialised at branch "throwaway965-t11"
      And git is run with the arguments "push --force-with-lease --force-if-includes -u origin throwaway965-t11" in the worktree for adwId "throwaway965-t11"
      Then the git-mock recorded a push to branch "throwaway965-t11"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  # ── §5 THE ACTIONS-SECRET ROUTE ─────────────────────────────────────────────────────────────

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario: The mock GitHub API answers a PUT that creates an Actions secret 201 and one that updates it 204, records both and keeps the secret in its state
    Given the mock infrastructure is set up
    When a PUT of the Actions secret "SOCKET_API_TOKEN" on the repository "acme/widgets" is sent to the mock GitHub API twice
    Then the mock GitHub API answered the first PUT 201 and the second 204
    And the mock GitHub API recorded 2 total API calls
    And the mock GitHub API recorded the Actions secret "SOCKET_API_TOKEN" being set on the repository "acme/widgets"
    And the mock GitHub API's state holds the Actions secret "SOCKET_API_TOKEN"

  # ── §6 BACKSTOP ─────────────────────────────────────────────────────────────────────────────

  @adw-965 @adw-mr7y3g-bug-move-the-install
  Scenario: TypeScript type-check passes with the git-mock log, the Actions-secret route and the harness for the ten surface rows in place
    Then the ADW TypeScript type-check passes
