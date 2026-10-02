@adw-963 @adw-g53ol8-bug-build-the-in-pro
Feature: The plan, build and lock surface rows run in-process in seconds, against a fixture git worktree and a Claude stub that answers per command and refuses to write what a Then step reads

  Surface rows are the @surface scenarios under features/regression/surfaces/.

  Background:
    Given the ADW codebase is checked out

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario: The six in-process surface rows pass on two Cucumber runs in a row in the same checkout, each in under 5 seconds, and leave no spawn lock and no git repository behind
    When the regression suite's surface scenarios are run through Cucumber twice in a row
    Then each of these surface rows passes on both runs, in under 5 seconds each time:
      | row                                                    |
      | row-02-adwPlan-planPhase-happy.feature                 |
      | row-03-adwPlan-planPhase-error-stub-failure.feature    |
      | row-04-adwBuild-buildPhase-happy.feature               |
      | row-05-adwBuild-buildPhase-edge-missing-lock.feature   |
      | row-31-adwPlan-orchestratorLock-acquired-happy.feature |
      | row-32-adwBuild-orchestratorLock-re-entry-edge.feature |
    And the checkout holds no spawn lock for issue 1005 in the repository "acme/widgets"
    And the checkout holds no spawn lock for issue 1031 in the repository "acme/widgets"
    And the checkout holds no spawn lock for issue 1032 in the repository "acme/widgets"
    And neither run left a git repository in its temporary directory

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario: Under the @regression hooks, T6 fails while another live process holds the issue's spawn-gate lock, and the After hook releases that lock
    Given a throwaway regression scenario with the steps:
      """
      Given another live process holds the spawn lock for issue 9631 in the repository "acme/widgets"
      Then the spawn-gate lock for issue 9631 is released
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step "the spawn-gate lock for issue 9631 is released"
    And the checkout holds no spawn lock for issue 9631 in the repository "acme/widgets"

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario: Under the @regression hooks, G5 clears the spawn-gate lock another live process holds on the issue, after which T6 passes
    Given a throwaway regression scenario with the steps:
      """
      Given another live process holds the spawn lock for issue 9632 in the repository "acme/widgets"
      And no spawn lock exists for issue 9632
      Then the spawn-gate lock for issue 9632 is released
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario: G11 makes a git repository of the cli-tool fixture under the system's temporary directory, on the scenario's branch, whose origin's main is its own main, and which ignores the stub's files
    Given the worktree for adwId "fixture963-g11" is initialised at branch "fixture963-g11"
    Then the worktree for adwId "fixture963-g11" and its origin lie under the system's temporary directory
    And the worktree for adwId "fixture963-g11" has the branch "fixture963-g11" checked out
    And in the worktree for adwId "fixture963-g11", "HEAD", "main" and "refs/remotes/origin/main" name the same commit
    And in the worktree for adwId "fixture963-g11", the branch "main" tracks every file of "test/fixtures/cli-tool"
    And git ignores ".adw-stub-manifest.json", ".adw-stub-payload.json" and ".adw-stub-invocations" in the worktree for adwId "fixture963-g11"

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario Outline: A prompt that opens with <command> is answered by <entry>, and the stub writes only that entry's file
    Given a throwaway git worktree holding a stub manifest whose top-level entry answers "the default answer" and writes "notes/default.md"
    And the stub manifest also has these per-command entries:
      | command    | answer           | writes                |
      | /feature   | the plan answer  | specs/issue-7-plan.md |
      | /implement | the build answer | src/featureStub.ts    |
    When the Claude CLI stub is run in that worktree, as an agent runs it, with a prompt that opens with "<command>"
    Then the stub exits 0 with the result "<answer>"
    And the stub wrote "<written>" into the worktree, and none of the files the manifest's other entries write

    Examples:
      | command        | entry                                                     | answer             | written               |
      | /feature       | its /feature entry                                        | the plan answer    | specs/issue-7-plan.md |
      | /implement     | its /implement entry                                      | the build answer   | src/featureStub.ts    |
      | /implement-tdd | the top-level entry, as no entry is keyed on that command | the default answer | notes/default.md      |
      | /review        | the top-level entry, as no entry is keyed on that command | the default answer | notes/default.md      |

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario: A prompt that follows the guardrails --settings JSON and the other value-taking flags an agent passes is still answered by its command's entry
    Given a throwaway git worktree holding a stub manifest whose top-level entry answers "the default answer" and writes "notes/default.md"
    And the stub manifest also has these per-command entries:
      | command  | answer          | writes                |
      | /feature | the plan answer | specs/issue-7-plan.md |
    When the Claude CLI stub is run in that worktree with the arguments an agent passes for a target repository whose guardrails are injected, ending in a prompt that opens with "/feature"
    Then the stub exits 0 with the result "the plan answer"
    And the stub wrote "specs/issue-7-plan.md" into the worktree, and none of the files the manifest's other entries write

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario Outline: A manifest whose <entry> answers with the error response makes the stub stream a result marked is_error, and exit 1
    Given a throwaway git worktree holding a stub manifest whose <entry> answers with the error response
    When the Claude CLI stub is run in that worktree, as an agent runs it, with a prompt that opens with "/feature"
    Then the stub exits 1
    And the stub's output ends with a result whose is_error is true

    Examples:
      | entry           |
      | top-level entry |
      | /feature entry  |

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario: An agent whose /feature call the stub answers with the error response reports a plain failure, neither a rate limit nor an expired login
    Given a throwaway git worktree holding a stub manifest whose /feature entry answers with the error response
    When an agent runs "/feature" in that worktree against the Claude CLI stub
    Then the agent run reports failure
    And the agent run reports neither a rate limit nor an expired login

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario Outline: The stub refuses a manifest whose <entry> would write <path>, a file a Then step reads as the system's output, and writes none of the manifest's edits
    Given a throwaway git worktree holding a stub manifest whose top-level entry answers "the default answer" and writes "notes/default.md"
    And the stub manifest's <entry> also writes "<path>"
    When the Claude CLI stub is run in that worktree, as an agent runs it, with a prompt that opens with "/feature"
    Then the stub exits 1 with an error that names "<path>"
    And the stub wrote none of the manifest's edits into the worktree

    Examples:
      | entry           | path                                            |
      | top-level entry | .adw/state.json                                 |
      | top-level entry | agents/surface-04/state.json                    |
      | top-level entry | agents/spawn_locks/acme_widgets_issue-1005.json |
      | top-level entry | agents/paused_queue.json                        |
      | /feature entry  | .adw/state.json                                 |
      | /commit entry   | agents/surface-04/state.json                    |

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario Outline: The refusal guard lets a manifest write <path>, which no Then step reads as the system's output
    Given a throwaway git worktree holding a stub manifest whose top-level entry answers "the default answer" and writes "<path>"
    When the Claude CLI stub is run in that worktree, as an agent runs it, with a prompt that opens with "/feature"
    Then the stub exits 0 with the result "the default answer"
    And the stub wrote "<path>" into the worktree

    Examples:
      | path                        |
      | .adw/commands.md            |
      | .adw/project.md             |
      | .claude/commands/feature.md |
      | specs/issue-7-plan.md       |
      | adws/agents/planAgent.ts    |

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario: The refusal guard refuses none of the manifests committed under test/fixtures/jsonl/manifests
    When the stub's manifest interpreter applies every manifest committed under "test/fixtures/jsonl/manifests", each in a throwaway git worktree
    Then the refusal guard refused none of them

  @adw-963 @adw-g53ol8-bug-build-the-in-pro
  Scenario: TypeScript type-check passes with the in-process phase harness, the stub's per-command routing and the refusal guard in place
    Then the ADW TypeScript type-check passes
