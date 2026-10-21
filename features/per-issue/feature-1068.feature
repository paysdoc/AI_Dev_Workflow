@adw-1068 @adw-1gu1gp-bug-feature-912-regr @rate-limit-in-process-wait
Feature: At the end of an in-process wait the hung-orchestrator detector looks only once an overdue heartbeat tick has landed, a single event-loop stall cannot make it report a live waiting orchestrator, and an orchestrator whose heartbeat has stopped is still reported

  An event-loop stall is a stretch in which the orchestrator's process runs none of its timers, as in a garbage-collection pause, a slow synchronous write or a busy CI runner.

  Background:
    Given the ADW codebase is checked out

  @adw-1068 @adw-1gu1gp-bug-feature-912-regr
  Scenario: A waiting orchestrator whose event loop stalls for longer than the detector's threshold just before a wait ends is not reported hung, because the heartbeat tick that fell due during the stall lands before the detector looks
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 106801 in the target repository "acme/widgets" is running under adwId "wait1068-tick"
    And the "stepDef" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type | resets at            |
      | 1       | rate-limited | five_hour  | 2026-09-22T12:50:00Z |
      | 2       | rate-limited | five_hour  | 2026-09-22T17:50:00Z |
      | 3       | succeeds     |            |                      |
    And the orchestrator's event loop stalls, from just after the last heartbeat tick before every wait ends, for longer than the hung-orchestrator detector's threshold
    When the phase runner runs the "stepDef" phase
    Then the state file for adwId "wait1068-tick" recorded workflowStage "stepDef_running" throughout every wait
    And at the end of every wait, the hung-orchestrator detector found a lastSeenAt in the state file for adwId "wait1068-tick" that the heartbeat wrote after the stall
    And the hung-orchestrator detector did not report adwId "wait1068-tick" at the end of any wait

  @adw-1068 @adw-1gu1gp-bug-feature-912-regr
  Scenario: A single event-loop stall of 300 ms just before the detector looks at the end of a wait, with no heartbeat tick able to land in between, does not make it report a live waiting orchestrator
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 106802 in the target repository "acme/widgets" is running under adwId "wait1068-look"
    And the "stepDef" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type | resets at            |
      | 1       | rate-limited | five_hour  | 2026-09-22T12:50:00Z |
      | 2       | rate-limited | five_hour  | 2026-09-22T17:50:00Z |
      | 3       | succeeds     |            |                      |
    And the orchestrator's event loop stalls for 300 ms just before the hung-orchestrator detector looks at the end of every wait
    When the phase runner runs the "stepDef" phase
    Then the state file for adwId "wait1068-look" recorded workflowStage "stepDef_running" throughout every wait
    And at the end of every wait, the hung-orchestrator detector found lastSeenAt in the state file for adwId "wait1068-look" at least 300 ms old
    And the hung-orchestrator detector did not report adwId "wait1068-look" at the end of any wait

  @adw-1068 @adw-1gu1gp-bug-feature-912-regr
  Scenario: With its heartbeat stopped as the first wait begins, a waiting orchestrator is reported hung at the end of every wait, because every wait outlasts the detector's threshold
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 106803 in the target repository "acme/widgets" is running under adwId "wait1068-stop"
    And the "stepDef" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type | resets at            |
      | 1       | rate-limited | five_hour  | 2026-09-22T12:50:00Z |
      | 2       | rate-limited | five_hour  | 2026-09-22T17:50:00Z |
      | 3       | succeeds     |            |                      |
    And the orchestrator's heartbeat stops as the first wait begins
    When the phase runner runs the "stepDef" phase
    Then the state file for adwId "wait1068-stop" recorded workflowStage "stepDef_running" throughout every wait
    And the hung-orchestrator detector reported adwId "wait1068-stop" at the end of every wait
