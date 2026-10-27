@adw-1105 @adw-yyx1pt-orchestrator-that-lo @promotion-suggested-2026-10-27
Feature: An orchestrator that loses an issue's spawn lock leaves the top-level state as the lock holder recorded it and uses up none of the workflow's resume attempts, and the cron launches no second orchestrator for a timed-out workflow whose relaunched orchestrator is still starting up

  The spawn lock is the per-issue lock under agents/spawn_locks/ that the one orchestrator running an issue's workflow holds.

  Background:
    Given the ADW codebase is checked out

  @adw-1105 @adw-yyx1pt-orchestrator-that-lo @subprocess
  Scenario Outline: An orchestrator started for a workflow whose live orchestrator holds the issue's spawn lock at "<stage>" exits 0 without running a phase, logs the pid that holds the lock, and leaves the top-level state as the lock holder recorded it
    Given an issue <issue> exists in the mock issue tracker
    And another live process holds the spawn lock for issue <issue> in the repository "acme/widgets"
    And the top-level state for adwId "<adwId>" records the process holding the spawn lock for issue <issue> as its orchestrator, at workflowStage "<stage>"
    When the "sdlc" orchestrator is invoked with adwId "<adwId>" and issue <issue>
    Then the orchestrator subprocess exited 0
    And the execution log of the "sdlc-orchestrator" for adwId "<adwId>" records that the spawn lock for issue <issue> is held by the pid of the process holding it, exiting without running a phase
    And the orchestrator subprocess did not write the top-level state for adwId "<adwId>"
    And the top-level state for adwId "<adwId>" records the pid and start time of the process holding the spawn lock for issue <issue>
    And the state file for adwId "<adwId>" records workflowStage "<stage>"

    Examples:
      | stage         | issue  | adwId                       |
      | starting      | 110501 | throwaway1105-held-starting |
      | build_running | 110502 | throwaway1105-held-build    |

  @adw-1105 @adw-yyx1pt-orchestrator-that-lo @subprocess
  Scenario: The orchestrator the cron relaunches for a timed-out workflow that has used 2 resume attempts finds the spawn lock taken first by another live process, exits 0 without running a phase, and leaves the workflow at "phase_timeout" with 2 resume attempts used
    Given an issue 110503 exists in the mock issue tracker
    And issue 110503 holds an ADW workflow comment for adwId "throwaway1105-lost-resume"
    And a prior run for adwId "throwaway1105-lost-resume" recorded workflowStage "phase_timeout" for the repository "acme/widgets"
    And the prior run for adwId "throwaway1105-lost-resume" has used 2 resume attempts
    When the cron probe runs once
    Then the "sdlc" orchestrator was launched for issue 110503
    When another live process holds the spawn lock for issue 110503 in the repository "acme/widgets"
    And the orchestrator the cron launched for issue 110503 runs
    Then the orchestrator subprocess exited 0
    And the execution log of the "sdlc-orchestrator" for adwId "throwaway1105-lost-resume" records that the spawn lock for issue 110503 is held by the pid of the process holding it, exiting without running a phase
    And the state file for adwId "throwaway1105-lost-resume" records workflowStage "phase_timeout"
    And the top-level state for adwId "throwaway1105-lost-resume" records a resume attempt count of 2

  @adw-1105 @adw-yyx1pt-orchestrator-that-lo @subprocess
  Scenario: The orchestrator the cron relaunches for a timed-out workflow that has used 1 resume attempt takes the free spawn lock, and its relaunch is counted as the workflow's second resume attempt
    Given an issue 110504 exists in the mock issue tracker
    And issue 110504 holds an ADW workflow comment for adwId "throwaway1105-won-resume"
    And a prior run for adwId "throwaway1105-won-resume" recorded workflowStage "phase_timeout" for the repository "acme/widgets"
    And the prior run for adwId "throwaway1105-won-resume" has used 1 resume attempt
    And no spawn lock exists for issue 110504
    When the cron probe runs once
    Then the "sdlc" orchestrator was launched for issue 110504
    When the orchestrator the cron launched for issue 110504 runs
    Then the top-level state for adwId "throwaway1105-won-resume" records a resume attempt count of 2

  @adw-1105 @adw-yyx1pt-orchestrator-that-lo @dead-orchestrator-takeover
  Scenario: The same cron, polling again while the orchestrator it relaunched for a timed-out workflow is alive but has not yet recorded anything or taken the spawn lock, launches no second orchestrator for the issue
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 110505 has an ADW workflow under adwId "dup1105-110505" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And every orchestrator the cron launches stays alive, still starting up, without recording anything
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 1 orchestrator for issue 110505
    When the same cron polls again from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 1 orchestrator for issue 110505
    And every orchestrator the cron launched for issue 110505 runs "adws/adwSdlc.tsx" under adwId "dup1105-110505"

  @adw-1105 @adw-yyx1pt-orchestrator-that-lo @dead-orchestrator-takeover
  Scenario: The same cron relaunches a timed-out workflow again on its next poll once the orchestrator it relaunched has exited without recording anything
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 110506 has an ADW workflow under adwId "dup1105-110506" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And every orchestrator the cron launches stays alive, still starting up, without recording anything
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 1 orchestrator for issue 110506
    When the orchestrator the cron launched for issue 110506 exits, having recorded nothing
    And the same cron polls again from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 2 orchestrators for issue 110506
    And every orchestrator the cron launched for issue 110506 runs "adws/adwSdlc.tsx" under adwId "dup1105-110506"

  @adw-1105 @adw-yyx1pt-orchestrator-that-lo @dead-orchestrator-takeover
  Scenario: A timed-out workflow whose relaunched orchestrators keep exiting during startup, before taking the spawn lock, uses up none of its resume attempts on them: the same cron relaunches it on each of its 4 polls and leaves it at "phase_timeout" instead of escalating it to "human_gated"
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 110507 has an ADW workflow under adwId "cap1105-110507" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And every orchestrator the cron launches stays alive, still starting up, without recording anything
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    And the orchestrator the cron launched for issue 110507 exits, having recorded nothing
    And the same cron polls again from that boundary, with its hung-orchestrator sweep due
    And the orchestrator the cron launched for issue 110507 exits, having recorded nothing
    And the same cron polls again from that boundary, with its hung-orchestrator sweep due
    And the orchestrator the cron launched for issue 110507 exits, having recorded nothing
    And the same cron polls again from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 4 orchestrators for issue 110507
    And every orchestrator the cron launched for issue 110507 runs "adws/adwSdlc.tsx" under adwId "cap1105-110507"
    And the state file for adwId "cap1105-110507" records workflowStage "phase_timeout"

  @adw-1105 @adw-yyx1pt-orchestrator-that-lo
  Scenario: The ADW TypeScript type-check passes once an orchestrator that loses the spawn lock leaves the top-level state and the resume attempts alone
    Then the ADW TypeScript type-check passes
