@adw-966 @adw-p5u9xh-bug-build-the-hermet
Feature: The init, merge, patch and cron surface rows run as real processes, through a harness that answers gh from the mock GitHub API and keeps every process it starts away from the real gh, the developer's credentials and HOME, and the checkout's state

  Subprocess surface rows are the @surface scenarios tagged @subprocess under features/regression/surfaces/.

  Background:
    Given the ADW codebase is checked out

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: The seven subprocess surface rows pass on two Cucumber runs in a row in the same checkout, and leave no state, logs, spawn lock, running cron, git repository, branch or worktree behind
    When the regression suite's surface scenarios are run through Cucumber twice in a row
    Then each of these surface rows passes on both runs:
      | row                                                          |
      | row-01-adwPlan-workflowInit-happy.feature                    |
      | row-10-adwMerge-autoMergePhase-happy.feature                 |
      | row-11-adwMerge-autoMergePhase-edge-pr-not-merged.feature    |
      | row-16-adwPatch-planPhase-happy.feature                      |
      | row-19-adwInit-workflowInit-edge-already-initialised.feature |
      | row-29-adwSdlc-cronProbe-edge-empty-queue.feature            |
      | row-30-adwSdlc-cronProbe-happy-dispatch.feature              |
    And the checkout holds no state and no logs for any of these adwIds:
      | adwId      |
      | surface-01 |
      | surface-10 |
      | surface-11 |
      | surface-16 |
      | surface-19 |
    And the checkout holds no spawn lock for issue 1001 in the repository "acme/widgets"
    And the checkout holds no spawn lock for issue 1010 in the repository "acme/widgets"
    And the checkout holds no spawn lock for issue 1011 in the repository "acme/widgets"
    And the checkout holds no spawn lock for issue 1016 in the repository "acme/widgets"
    And the checkout holds no spawn lock for issue 1019 in the repository "acme/widgets"
    And the checkout holds no spawn lock for issue 1030 in the repository "acme/widgets"
    And no cron trigger for the repository "acme/widgets" is still running
    And neither run added a branch or a worktree to the checkout for any of these workflows:
      | adwId      | issue |
      | surface-01 | 1001  |
      | surface-10 | 1010  |
      | surface-11 | 1011  |
      | surface-16 | 1016  |
      | surface-19 | 1019  |
    And neither run left a git repository in its temporary directory

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: Run by Cucumber in a process of its own while ADW's auth gate holds a record, the subprocess surface rows pass without calling the developer's gh or touching the developer's HOME, and leave the auth gate, the cron registry and the cron logs as they found them
    Given ADW's auth gate holds a record of an earlier authentication failure
    And the developer's HOME is a throwaway directory holding a ".claude.json" file
    And the developer's gh, first on the PATH, records every call it receives
    When Cucumber runs the scenarios tagged "@regression and @surface and @subprocess" in a child process
    Then that run held at least one scenario, and every one of them passed
    And the developer's gh received no call
    And the developer's ".claude.json" file is as it was before that run
    And the developer's HOME holds no ".adw" directory
    And ADW's auth gate, the cron registry and the cron logs are as they were before that run

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario Outline: A process the subprocess harness starts sees <variable> set to an empty string, not unset, even when the process running the harness has it set, so neither that setting nor the checkout's .env reaches the process
    Given a throwaway @subprocess regression scenario with the steps:
      """
      Given the process running the scenario has "<variable>" set to "adw-966-host-value"
      When a stand-in process that records its environment is run through the subprocess harness
      Then the stand-in process saw "<variable>" set to an empty string
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

    Examples:
      | variable                    |
      | GH_TOKEN                    |
      | GITHUB_APP_ID               |
      | GITHUB_APP_SLUG             |
      | GITHUB_APP_PRIVATE_KEY_PATH |
      | COST_API_URL                |
      | COST_API_TOKEN              |
      | SLACK_WEBHOOK_URL           |
      | R2_ACCESS_KEY_ID            |
      | R2_SECRET_ACCESS_KEY        |
      | CLOUDFLARE_ACCOUNT_ID       |

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: A process the subprocess harness starts runs the Claude CLI stub and holds a GitHub token of the harness's own, even when the process running the harness names another Claude CLI and its own token
    Given a throwaway @subprocess regression scenario with the steps:
      """
      Given the process running the scenario has "CLAUDE_CODE_PATH" set to "/opt/adw-966/host-claude"
      And the process running the scenario has "GITHUB_PAT" set to "ghp_adw966HostTokenThatMustNotReachTheChild0"
      When a stand-in process that records its environment is run through the subprocess harness
      Then the stand-in process saw "CLAUDE_CODE_PATH" set to the Claude CLI stub
      And the stand-in process saw "GITHUB_PAT" set to a token other than "ghp_adw966HostTokenThatMustNotReachTheChild0"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: A process the subprocess harness starts is given no currency to convert costs into, so a workflow it completes asks no exchange-rate service for a rate, even when the process running the harness names currencies
    Given a throwaway @subprocess regression scenario with the steps:
      """
      Given the process running the scenario has "COST_REPORT_CURRENCIES" set to "EUR,GBP"
      When a stand-in process that records its environment is run through the subprocess harness
      Then the stand-in process saw a COST_REPORT_CURRENCIES that gives ADW no currency to convert costs into
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario Outline: A "gh <call>" the gh shadow does not support fails the scenario with the shadow's message, although the process that made the call exits 0
    Given a throwaway @subprocess regression scenario with the steps:
      """
      When a stand-in process that runs the command "gh <call>" and then exits 0 is run through the subprocess harness
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step 'a stand-in process that runs the command "gh <call>" and then exits 0 is run through the subprocess harness'
    And the error message of that failed step contains "gh shadow: unsupported: <call>"

    Examples:
      | call                                                 |
      | codespace list                                       |
      | issue transfer 9661 acme/gadgets --repo acme/widgets |

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: A comment a process posts through the gh shadow, as ADW posts one, reaches the mock GitHub API once that process has exited
    Given a throwaway @subprocess regression scenario with the steps:
      """
      Given an issue 9662 exists in the mock issue tracker
      When a stand-in process that runs the command "printf 'Posted through the gh shadow' | gh issue comment 9662 --repo acme/widgets --body-file -" and then exits 0 is run through the subprocess harness
      Then the mock GitHub API recorded a comment on issue 9662
      And the mock GitHub API recorded a comment containing the text "Posted through the gh shadow"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: A pull-request merge a process makes through the gh shadow, as ADW merges one, reaches the mock GitHub API once that process has exited, where "the mock harness recorded zero PR-merge calls" sees it
    Given a throwaway @subprocess regression scenario with the steps:
      """
      Given a workflow for adwId "throwaway966-merge" is awaiting merge of PR 9665 from branch "throwaway966-merge"
      When a stand-in process that runs the command "gh pr merge 9665 --merge --repo acme/widgets" and then exits 0 is run through the subprocess harness
      Then the mock GitHub API recorded a merge of PR 9665
      And the mock harness recorded zero PR-merge calls
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step "the mock harness recorded zero PR-merge calls"

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: A process that outlives its timeout fails the step with the tail of its output, and the harness kills every process in the group it started
    Given a throwaway @subprocess regression scenario with the steps:
      """
      When a stand-in process that runs the command "echo started-9664; sleep 9664 & sleep 9664" is run through the subprocess harness with a timeout of 3 seconds
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step 'a stand-in process that runs the command "echo started-9664; sleep 9664 & sleep 9664" is run through the subprocess harness with a timeout of 3 seconds'
    And the error message of that failed step contains "started-9664"
    And no process running the command "sleep 9664" is left

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: The cron probe records no exit code, so "the orchestrator subprocess exited 0" fails after it instead of passing on a cron the harness killed
    Given a throwaway @subprocess regression scenario with the steps:
      """
      Given the cron sweep is configured with empty queue
      When the cron probe runs once
      Then the orchestrator subprocess exited 0
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step "the orchestrator subprocess exited 0"

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario Outline: W1 refuses the orchestrator name "<name>", which names no orchestrator, and its failure names the ten orchestrators it can run
    Given a throwaway @subprocess regression scenario with the steps:
      """
      When the "<name>" orchestrator is invoked with adwId "throwaway966-<name>" and issue 9663
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step 'the "<name>" orchestrator is invoked with adwId "throwaway966-<name>" and issue 9663'
    And the error message of that failed step names each of these orchestrators:
      | orchestrator    |
      | sdlc            |
      | chore           |
      | plan            |
      | build           |
      | test            |
      | patch           |
      | merge           |
      | document        |
      | pr-review       |
      | promotion-sweep |

    Examples:
      | name   |
      | review |
      | init   |

  @adw-966 @adw-p5u9xh-bug-build-the-hermet @adw-968
  Scenario Outline: As the only step of a scenario <where> the @regression hooks that is not tagged @subprocess, W9 fails, as W1 and W10 do, and is never reported pending
    Given a throwaway feature whose only scenario runs <where> the @regression hooks, with the steps:
      """
      When the workflow is initialised with config "adwPlan-throwaway966-w9"
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario fails

    Examples:
      | where   |
      | outside |
      | inside  |

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario Outline: An agent run in <directory> below a worktree is answered by the nearest stub manifest at or above that directory, and the manifest's edit lands in that directory
    Given a throwaway git worktree holding a stub manifest whose top-level entry answers "the worktree's answer" and writes "notes/default.md"
    And the directory "packages/app" below that worktree holds a stub manifest whose top-level entry answers "the package's answer" and writes "notes/package.md"
    When the Claude CLI stub is run in the directory "<directory>" below that worktree, as an agent runs it, with a prompt that opens with "/feature"
    Then the stub exits 0 with the result "<answer>"
    And the stub wrote "<written>" into the directory "<directory>" below that worktree, and no other file in that worktree

    Examples:
      | directory                  | answer                | written          |
      | .worktrees/feature-issue-7 | the worktree's answer | notes/default.md |
      | packages/app/src           | the package's answer  | notes/package.md |

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: An agent run in a directory with no stub manifest in it or in any directory above it, up to the filesystem root, gets the answer the stub gives when no manifest programs it, and the stub writes nothing
    Given a throwaway directory under the system's temporary directory, with no stub manifest in it or in any directory above it
    When the Claude CLI stub is run in that directory, as an agent runs it, with a prompt that opens with "/feature"
    Then the stub exits 0 with the answer it gives when no manifest programs it
    And the stub wrote no file into that directory

  @adw-966 @adw-p5u9xh-bug-build-the-hermet
  Scenario: TypeScript type-check passes with the subprocess harness, the gh shadow and the stub's upward manifest lookup in place
    Then the ADW TypeScript type-check passes
