@adw-249
Feature: Step definition generation, review-first gating, and guidelines check

  BDD scenarios currently have no step definitions, causing Cucumber to fail
  with undefined steps and blocking PR creation. This feature restructures the
  workflow: generates step definitions, moves BDD execution to the review phase,
  gates PR creation behind review, and adds a coding guidelines check.

  # ── 1. New slash command: /generate_step_definitions ──

  @adw-249 @regression
  Scenario: generate_step_definitions.md slash command exists
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should declare $1 as the issue number argument
    And it should declare $2 as the adwId argument

  @adw-249 @regression
  Scenario: generate_step_definitions command reads tagged feature files
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should instruct reading feature files tagged @adw-{issueNumber} from the scenario directory

  @adw-249 @regression
  Scenario: generate_step_definitions command reads existing step definitions
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should instruct reading all existing step definition files to avoid duplicate patterns

  @adw-249 @regression
  Scenario: generate_step_definitions command reads implementation code
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should instruct reading implementation code from the worktree

  @adw-249 @regression
  Scenario: generate_step_definitions command can create or modify step definition files
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should allow creating new step definition files
    And it should allow modifying existing step definition files

  @adw-249 @regression
  Scenario: generate_step_definitions command removes ungeneratable scenarios
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should instruct removing scenarios that require runtime infrastructure, mocked LLMs, or external services
    And it should instruct returning the list of removed scenarios in the output

  # ── 2. Step definition agent and phase ──

  @adw-249 @regression
  Scenario: stepDefAgent.ts agent wrapper exists
    Given the file "adws/agents/stepDefAgent.ts" exists
    Then it should export a function to run the step definition generation agent
    And it should invoke the /generate_step_definitions command

  @adw-249 @regression
  Scenario: stepDefPhase.ts phase orchestration exists
    Given the file "adws/phases/stepDefPhase.ts" exists
    Then it should export a function to execute the step definition generation phase
    And it should call the step definition agent
    And it should return phase cost records

  @adw-249
  Scenario: stepDefPhase posts warning comment for removed scenarios
    Given the file "adws/phases/stepDefPhase.ts" exists
    Then it should post a warning comment on the issue listing any scenarios removed by the agent

  # ── 3. Test phase: remove BDD, unit tests only ──

  @adw-249 @regression
  Scenario: testPhase.ts does not execute BDD scenarios
    Given the file "adws/phases/testPhase.ts" exists
    Then it should not call runBddScenariosWithRetry
    And it should not call runScenariosByTag
    And it should not reference bddScenarioRunner

  @adw-249 @regression
  Scenario: testPhase.ts preserves unit test opt-in behavior
    Given the file "adws/phases/testPhase.ts" exists
    Then it should check the project config for unit test enablement
    And it should log a skip message when unit tests are disabled

  # ── 4. Review phase: works on branch diff, no PR dependency ──

  @adw-249 @regression
  Scenario: review.md works against branch diff instead of PR
    Given the file ".claude/commands/review.md" exists
    Then it should instruct running git diff against the default branch
    And it should not require a pull request number as input

  @adw-249 @adw-3tkya9-machine-readable-rev @regression
  Scenario: review.md runs tag-driven BDD scenarios from review_proof.md config
    Given the file ".claude/commands/review.md" exists
    Then it should instruct reading tags from ".adw/review_proof.md"
    And it should instruct running scenarios for each configured tag

  @adw-249 @regression
  Scenario: Review failure is a hard fail that blocks PR creation
    Given the file "adws/phases/workflowCompletion.ts" exists
    Then when review fails it should post an error comment on the issue
    And when review fails the workflow should exit with code 1
    And no PR should be created when review fails

  # ── 5. Review command: coding guidelines check ──

  @adw-249 @regression
  Scenario: review.md checks coding guidelines from .adw/coding_guidelines.md
    Given the file ".claude/commands/review.md" exists
    Then it should instruct reading ".adw/coding_guidelines.md" if present

  @adw-249 @regression
  Scenario: review.md falls back to guidelines/coding_guidelines.md
    Given the file ".claude/commands/review.md" exists
    Then it should instruct falling back to "guidelines/coding_guidelines.md" when .adw/coding_guidelines.md is absent

  @adw-249
  Scenario: Coding guideline violations are reported as tech-debt severity
    Given the file ".claude/commands/review.md" exists
    Then guideline violations should be reported with severity "tech-debt"

  # ── 6. Orchestrator phase ordering: review orchestrators ──

  @adw-249 @adw-71pdjz-cache-install-contex @adw-306
  Scenario: adwPlanBuildTestReview.tsx follows post-306 phase ordering
    Given the file "adws/adwPlanBuildTestReview.tsx" exists
    Then the phase ordering should be:
      | phase              |
      | install            |
      | plan + scenarios   |
      | alignment          |
      | build              |
      | test               |
      | review             |
      | pr                 |

  @adw-249 @adw-71pdjz-cache-install-contex @adw-306
  Scenario: adwSdlc.tsx follows post-306 phase ordering
    Given the file "adws/adwSdlc.tsx" exists
    Then the phase ordering should be:
      | phase              |
      | install            |
      | plan + scenarios   |
      | alignment          |
      | build              |
      | test               |
      | review             |
      | document           |
      | pr                 |
      | kpi                |

  @adw-249 @adw-71pdjz-cache-install-contex @adw-306
  Scenario: adwPlanBuildReview.tsx follows post-306 phase ordering
    Given the file "adws/adwPlanBuildReview.tsx" exists
    Then the phase ordering should be:
      | phase              |
      | install            |
      | plan + scenarios   |
      | alignment          |
      | build              |
      | test               |
      | review             |
      | pr                 |

  # ── 7. Orchestrator phase ordering: non-review orchestrators ──

  @adw-249 @adw-71pdjz-cache-install-contex @regression
  Scenario: adwPlanBuild.tsx skips scenario writing, plan validation, and step def generation
    Given the file "adws/adwPlanBuild.tsx" exists
    Then it should not invoke the scenario phase
    And it should not invoke the plan validation phase
    And it should not invoke the step def phase
    And the phase ordering should be:
      | phase              |
      | install            |
      | plan               |
      | build              |
      | test               |
      | pr                 |

  @adw-249 @adw-71pdjz-cache-install-contex @regression
  Scenario: adwPlanBuildTest.tsx skips scenario writing, plan validation, and step def generation
    Given the file "adws/adwPlanBuildTest.tsx" exists
    Then it should not invoke the scenario phase
    And it should not invoke the plan validation phase
    And it should not invoke the step def phase
    And the phase ordering should be:
      | phase              |
      | install            |
      | plan               |
      | build              |
      | test               |
      | pr                 |

  @adw-249 @adw-71pdjz-cache-install-contex @regression
  Scenario: adwPlanBuildDocument.tsx skips scenario writing, plan validation, and step def generation
    Given the file "adws/adwPlanBuildDocument.tsx" exists
    Then it should not invoke the scenario phase
    And it should not invoke the plan validation phase
    And it should not invoke the step def phase
    And the phase ordering should be:
      | phase              |
      | install            |
      | plan               |
      | build              |
      | test               |
      | document           |
      | pr                 |

  # ── 8. PR creation gated behind review ──

  @adw-249 @regression
  Scenario: PR creation occurs after review in review orchestrators
    Given the file "adws/adwPlanBuildTestReview.tsx" exists
    And the file "adws/adwSdlc.tsx" exists
    And the file "adws/adwPlanBuildReview.tsx" exists
    Then in each review orchestrator the PR phase should come after the review phase

  @adw-249 @regression
  Scenario: PR creation in non-review orchestrators does not require review
    Given the file "adws/adwPlanBuild.tsx" exists
    And the file "adws/adwPlanBuildTest.tsx" exists
    And the file "adws/adwPlanBuildDocument.tsx" exists
    Then in each non-review orchestrator the PR phase should not depend on a review phase

  # ── 9. Step def gen wired into SLASH_COMMAND_MODEL_MAP ──

  @adw-249
  Scenario: generate_step_definitions is registered in SLASH_COMMAND_MODEL_MAP
    Given the file "adws/core/config.ts" exists
    Then SLASH_COMMAND_MODEL_MAP should contain an entry for "/generate_step_definitions"

  @adw-249
  Scenario: generate_step_definitions is registered in SLASH_COMMAND_EFFORT_MAP
    Given the file "adws/core/config.ts" exists
    Then SLASH_COMMAND_EFFORT_MAP should contain an entry for "/generate_step_definitions"

  # ── 10. stepDefPhase non-fatal error handling ──

  @adw-249
  Scenario: stepDefPhase handles errors gracefully as a non-fatal phase
    Given the file "adws/phases/stepDefPhase.ts" exists
    Then it should wrap execution in a try-catch block
    And it should log errors when the step def agent fails
    And it should return empty cost records on failure

  # ── 11. TypeScript integrity ──

  @adw-249 @regression
  Scenario: TypeScript type-check passes after all changes
    Given the ADW codebase has been modified for issue 249
    When the TypeScript compiler runs with --noEmit
    Then the compilation should succeed with no errors
