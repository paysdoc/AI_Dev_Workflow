@adw-1104 @adw-01sigg-planner-add-a-behavi
Feature: The planner of an issue in a target repository, such as a port that must not change behaviour, runs the framework checkout's current planning command for the issue's type, from the copies of "/feature", "/bug" and "/chore" that worktree setup puts in the worktree, even when the repository's branch tracks an older copy, and the ADW codebase's planning command tells the planner of such a port to add a behavioural equivalence step whose comparison of the old and new implementations is a validation command, without forcing the step on an issue that changes behaviour

  The framework checkout is the ADW checkout whose ".claude/commands/" worktree setup copies into a target repository's worktree.

  Background:
    Given the ADW codebase is checked out

  @adw-1104 @adw-01sigg-planner-add-a-behavi @surface
  Scenario Outline: The planner of a "<command>" issue that ports an existing module and says its behaviour stays the same runs the "<command>" planning command as the framework checkout has it, from the copy worktree setup put in the worktree, and is handed the issue's title and body
    Given an issue <issue> exists in the mock issue tracker
    And issue <issue> in the mock issue tracker is titled "Port decklib to a typed TypeScript package built with esbuild" and its body says "Port the hand-written JavaScript decklib v5.3 to TypeScript, module by module. Anything that uses the library should see no change."
    And the worktree for adwId "<adwId>" is initialised at branch "<adwId>"
    And a framework checkout whose planning commands "/feature", "/bug" and "/chore" each have text of their own
    And the claude-cli-stub is loaded with manifest "<manifest>"
    When worktree setup runs in the worktree for adwId "<adwId>" from that framework checkout
    And the "plan" phase of the "<orchestrator>" orchestrator runs for adwId "<adwId>"
    Then the "plan" phase run succeeded
    And the worktree for adwId "<adwId>" holds the planning commands "/feature", "/bug" and "/chore" as the framework checkout has them
    And the planner of the workflow for adwId "<adwId>" ran the "<command>" planning command as the framework checkout has it
    And the planner of the workflow for adwId "<adwId>" was handed the number of issue <issue>, its adwId and the issue's title and body

    Examples:
      | orchestrator | command  | issue  | adwId           | manifest                                                    |
      | plan         | /feature | 110401 | surface-1104-01 | test/fixtures/jsonl/manifests/surface-plan-phase.json       |
      | chore        | /chore   | 110402 | surface-1104-02 | test/fixtures/jsonl/manifests/surface-chore-plan-phase.json |

  @adw-1104 @adw-01sigg-planner-add-a-behavi @surface
  Scenario: The planner of a "/chore" issue in a target repository whose branch tracks an older copy of the "/chore" planning command still runs the "/chore" planning command as the framework checkout has it
    Given an issue 110403 exists in the mock issue tracker
    And issue 110403 in the mock issue tracker is titled "Port decklib to a typed TypeScript package built with esbuild" and its body says "Port the hand-written JavaScript decklib v5.3 to TypeScript, module by module. Anything that uses the library should see no change."
    And the worktree for adwId "surface-1104-03" is initialised at branch "surface-1104-03"
    And the branch of the worktree for adwId "surface-1104-03" tracks an older copy of the "/chore" planning command
    And a framework checkout whose planning commands "/feature", "/bug" and "/chore" each have text of their own
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-chore-plan-phase.json"
    When worktree setup runs in the worktree for adwId "surface-1104-03" from that framework checkout
    And the "plan" phase of the "chore" orchestrator runs for adwId "surface-1104-03"
    Then the "plan" phase run succeeded
    And the planner of the workflow for adwId "surface-1104-03" ran the "/chore" planning command as the framework checkout has it

  @adw-1104 @adw-01sigg-planner-add-a-behavi @surface
  Scenario Outline: The "<command>" planning command that worktree setup copies from the ADW codebase tells the planner of an issue that ports an existing module and says its behaviour stays the same to add a behavioural equivalence step that compares the old and new implementations, and to make that comparison a validation command
    Given an issue <issue> exists in the mock issue tracker
    And issue <issue> in the mock issue tracker is titled "Port decklib to a typed TypeScript package built with esbuild" and its body says "Port the hand-written JavaScript decklib v5.3 to TypeScript, module by module. Anything that uses the library should see no change."
    And the worktree for adwId "<adwId>" is initialised at branch "<adwId>"
    And the framework checkout is the checked-out ADW codebase
    And the claude-cli-stub is loaded with manifest "<manifest>"
    When worktree setup runs in the worktree for adwId "<adwId>" from that framework checkout
    And the "plan" phase of the "<orchestrator>" orchestrator runs for adwId "<adwId>"
    Then the "plan" phase run succeeded
    And the planner of the workflow for adwId "<adwId>" ran the "<command>" planning command as the framework checkout has it
    And the planner of the workflow for adwId "<adwId>" was handed the number of issue <issue>, its adwId and the issue's title and body
    And the "<command>" planning command the planner of the workflow for adwId "<adwId>" ran tells it that the plan of an issue that ports, rewrites, migrates, re-bundles or restructures existing code, and says or implies that what the code does stays the same, must include a behavioural equivalence step as a task of its own under "## Step by Step Tasks"
    And the "<command>" planning command the planner of the workflow for adwId "<adwId>" ran tells it that the behavioural equivalence step keeps a copy of the old implementation that the tests can run, and runs the old and the new implementation on the same inputs and diffs what they produce, across the public API and odd inputs such as null and undefined options, empty collections and boundary values
    And the "<command>" planning command the planner of the workflow for adwId "<adwId>" ran tells it to list the command that runs the comparison under "## Validation Commands"
    And the "<command>" planning command the planner of the workflow for adwId "<adwId>" ran tells it that a byte-for-byte check of a build artefact against the build's own output, and the existing tests still passing, are not behavioural equivalence checks

    Examples:
      | orchestrator | command  | issue  | adwId           | manifest                                                    |
      | plan         | /feature | 110404 | surface-1104-04 | test/fixtures/jsonl/manifests/surface-plan-phase.json       |
      | chore        | /chore   | 110405 | surface-1104-05 | test/fixtures/jsonl/manifests/surface-chore-plan-phase.json |

  @adw-1104 @adw-01sigg-planner-add-a-behavi @surface
  Scenario: The "/feature" planning command that worktree setup copies from the ADW codebase does not force a behavioural equivalence step on the planner of an issue that changes what an existing module does, and tells it to say in "## Notes" why a restructure has no comparison
    Given an issue 110406 exists in the mock issue tracker
    And issue 110406 in the mock issue tracker is titled "Add a compact option to decklib's table" and its body says "Add a compact option to decklib's table that leaves out the separator lines between rows. Decks that set the option will render their tables differently."
    And the worktree for adwId "surface-1104-06" is initialised at branch "surface-1104-06"
    And the framework checkout is the checked-out ADW codebase
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-phase.json"
    When worktree setup runs in the worktree for adwId "surface-1104-06" from that framework checkout
    And the "plan" phase of the "plan" orchestrator runs for adwId "surface-1104-06"
    Then the "plan" phase run succeeded
    And the planner of the workflow for adwId "surface-1104-06" was handed the number of issue 110406, its adwId and the issue's title and body
    And the "/feature" planning command the planner of the workflow for adwId "surface-1104-06" ran tells it that an issue that restructures no existing code, such as one that adds new behaviour, gets no behavioural equivalence step and needs no note about one
    And the "/feature" planning command the planner of the workflow for adwId "surface-1104-06" ran tells it that when the old implementation cannot be run, or what the code does is meant to change, the plan has no behavioural equivalence step and "## Notes" says so and why

  @adw-1104 @adw-01sigg-planner-add-a-behavi
  Scenario: The ADW TypeScript type-check passes with the step definitions of these planner scenarios in place
    Then the ADW TypeScript type-check passes
