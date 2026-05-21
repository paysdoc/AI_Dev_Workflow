@adw-506 @adw-mzgyjj-rot-prevention-block
Feature: scenario_writer rot prevention block — refuse rotting scenarios, prefer vocabulary

  Issue #506 adds a "Rot Prevention" instruction block to the framework
  .claude/commands/scenario_writer.md prompt. The block forbids the agent from
  writing scenarios that:

    1. Check whether a file exists
    2. Match substrings in file contents
    3. Parse and assert against the structure of source files

  It also instructs the agent to read features/regression/vocabulary.md from the
  target repo (when present) and prefer phrases already registered there before
  introducing novel phrasing.

  The behavioural contract under test is observed through the agent's outputs —
  the per-issue .feature file it writes and the files it reads while running —
  not through structural assertions against scenario_writer.md itself. Asserting
  against the prompt source file would be the very rot pattern this issue is
  designed to stop. The acceptance-criteria bullets that describe prompt-file
  contents are PR-review checks for humans; the scenarios in this file describe
  the downstream behaviour the prompt change must produce.

  Existing polymorphism on .adw/scenarios.md — Per-Issue Scenario Directory
  routing and the Regression-directory sweep skip — must continue to work
  unchanged.

  Background:
    Given the ADW framework codebase is checked out

  # ── §1 Vocabulary registry is loaded into the agent context ───────────

  @adw-506 @adw-mzgyjj-rot-prevention-block
  Scenario: scenario_writer reads vocabulary.md when present in the target repo
    Given a target repo "tgt-506-vocab" with features/regression/vocabulary.md present
    And a target repo "tgt-506-vocab" with .adw/scenarios.md routing per-issue output to "features/per-issue/"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/scenario-writer-reads-vocab.json"
    When the scenario_writer agent is invoked in target repo "tgt-506-vocab" with adwId "sw-506-1" for issue 901
    Then the agent's recorded file reads for adwId "sw-506-1" include "features/regression/vocabulary.md"

  @adw-506 @adw-mzgyjj-rot-prevention-block
  Scenario: scenario_writer proceeds without error when vocabulary.md is absent in the target repo
    Given a target repo "tgt-506-novocab" with no features/regression/vocabulary.md
    And a target repo "tgt-506-novocab" with .adw/scenarios.md routing per-issue output to "features/per-issue/"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/scenario-writer-no-vocab.json"
    When the scenario_writer agent is invoked in target repo "tgt-506-novocab" with adwId "sw-506-2" for issue 902
    Then the scenario_writer agent run for adwId "sw-506-2" exits 0
    And the artefact feature file for issue 902 is written under the resolved per-issue directory in target repo "tgt-506-novocab"

  # ── §2 Polymorphism on .adw/scenarios.md is preserved ────────────────

  @adw-506 @adw-mzgyjj-rot-prevention-block
  Scenario: Per-issue scenario is written to the configured Per-Issue Scenario Directory
    Given a target repo "tgt-506-vocab" with .adw/scenarios.md routing per-issue output to "features/per-issue/"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/scenario-writer-per-issue-routing.json"
    When the scenario_writer agent is invoked in target repo "tgt-506-vocab" with adwId "sw-506-3" for issue 903
    Then the artefact file at "features/per-issue/feature-903.feature" exists in target repo "tgt-506-vocab"
    And the artefact file at "features/per-issue/feature-903.feature" is tagged "@adw-903"

  @adw-506 @adw-mzgyjj-rot-prevention-block
  Scenario: Regression maintenance sweep is skipped when Regression Scenario Directory is configured
    Given a target repo "tgt-506-vocab" with .adw/scenarios.md configuring "features/regression/" as the Regression Scenario Directory
    And a target repo "tgt-506-vocab" with an existing regression scenario at "features/regression/smoke/baseline.feature" tagged "@regression"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/scenario-writer-skip-sweep.json"
    When the scenario_writer agent is invoked in target repo "tgt-506-vocab" with adwId "sw-506-4" for issue 904
    Then the artefact file at "features/regression/smoke/baseline.feature" is byte-identical to its pre-invocation contents in target repo "tgt-506-vocab"
    And the scenario_writer agent run for adwId "sw-506-4" wrote no files under "features/regression/" in target repo "tgt-506-vocab"

  @adw-506 @adw-mzgyjj-rot-prevention-block
  Scenario: Per-issue directory falls back to Scenario Directory when Per-Issue Scenario Directory is absent
    Given a target repo "tgt-506-fallback" with .adw/scenarios.md setting only "## Scenario Directory" to "features/"
    And a target repo "tgt-506-fallback" with no "## Per-Issue Scenario Directory" section in .adw/scenarios.md
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/scenario-writer-fallback-dir.json"
    When the scenario_writer agent is invoked in target repo "tgt-506-fallback" with adwId "sw-506-5" for issue 905
    Then the artefact feature file for issue 905 is written under "features/" in target repo "tgt-506-fallback"

  # ── §3 Rot prevention applies to the generated per-issue artefact ─────

  @adw-506 @adw-mzgyjj-rot-prevention-block
  Scenario: Generated per-issue feature file contains no rot-pattern step phrasing
    Given a target repo "tgt-506-vocab" with features/regression/vocabulary.md present
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/scenario-writer-behavioural-output.json"
    When the scenario_writer agent is invoked in target repo "tgt-506-vocab" with adwId "sw-506-6" for issue 906
    Then the artefact file at "features/per-issue/feature-906.feature" has no step phrasing asserting that a literal file path exists
    And the artefact file at "features/per-issue/feature-906.feature" has no step phrasing asserting that a source file's contents include a literal substring
    And the artefact file at "features/per-issue/feature-906.feature" has no step phrasing parsing a source file as JSON or AST to assert against its structure
