@adw-507 @adw-nnny1e-vocabulary-md-templa
Feature: vocabulary.md.template + adwInit copies it + writes per-issue/regression dir flags

  Issue #507 adds a checked-in framework template `vocabulary.md.template`
  containing the universal rot-detection principle, an LLM-drafted
  observability-surfaces examples placeholder (filled in by slice #3), and a
  minimal universal phrase seed. It also extends `.claude/commands/adw_init.md`
  step 7 so that on a fresh target-repo init the agent:

    1. Copies `vocabulary.md.template` verbatim to the target repo at
       `features/regression/vocabulary.md`.
    2. Writes `## Per-Issue Scenario Directory` and
       `## Regression Scenario Directory` sections into the generated
       `.adw/scenarios.md`, populated with non-empty defaults.

  The behavioural contract under test is observed through the artefact files
  written into the target repo by the adwInit agent run — not through
  structural assertions against the framework `vocabulary.md.template` or the
  `adw_init.md` prompt source. Asserting against those framework source files
  would be the rot pattern issue #506 was designed to stop; the
  acceptance-criteria bullets referring to framework-file contents are
  PR-review checks for humans. The scenarios below describe the downstream
  observable behaviour the framework changes must produce in a target repo.

  The agent invocation is simulated through the existing claude-cli-stub
  manifest harness (the same pattern used by issue #506), and assertions are
  scoped to the temp target-repo directory created per scenario.

  Background:
    Given the ADW framework codebase is checked out

  # ── §1 vocabulary.md is materialised in the target repo by adwInit ────

  @adw-507 @adw-nnny1e-vocabulary-md-templa
  Scenario: adwInit writes features/regression/vocabulary.md into a fresh target repo
    Given a fresh target repo "tgt-507-vocab" with no features/regression/vocabulary.md
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-writes-vocab.json"
    When the adwInit agent is invoked in target repo "tgt-507-vocab" with adwId "init-507-1" for issue 1101
    Then the artefact file at "features/regression/vocabulary.md" exists in target repo "tgt-507-vocab"

  @adw-507 @adw-nnny1e-vocabulary-md-templa
  Scenario: The materialised vocabulary.md contains the universal rot-detection rubric heading
    Given a fresh target repo "tgt-507-vocab" with no features/regression/vocabulary.md
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-writes-vocab.json"
    When the adwInit agent is invoked in target repo "tgt-507-vocab" with adwId "init-507-2" for issue 1102
    Then the artefact file at "features/regression/vocabulary.md" in target repo "tgt-507-vocab" contains a "## Rot-Detection Rubric" section heading

  @adw-507 @adw-nnny1e-vocabulary-md-templa
  Scenario: The materialised vocabulary.md contains a clearly-marked observability-surfaces examples placeholder
    Given a fresh target repo "tgt-507-vocab" with no features/regression/vocabulary.md
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-writes-vocab.json"
    When the adwInit agent is invoked in target repo "tgt-507-vocab" with adwId "init-507-3" for issue 1103
    Then the artefact file at "features/regression/vocabulary.md" in target repo "tgt-507-vocab" contains an observability-surfaces examples placeholder marker

  @adw-507 @adw-nnny1e-vocabulary-md-templa
  Scenario: The materialised vocabulary.md contains the minimal universal phrase seed for Given/When/Then
    Given a fresh target repo "tgt-507-vocab" with no features/regression/vocabulary.md
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-writes-vocab.json"
    When the adwInit agent is invoked in target repo "tgt-507-vocab" with adwId "init-507-4" for issue 1104
    Then the artefact file at "features/regression/vocabulary.md" in target repo "tgt-507-vocab" contains a "## Given" section heading
    And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-507-vocab" contains a "## When" section heading
    And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-507-vocab" contains a "## Then" section heading
    And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-507-vocab" registers at least one seed phrase under the Given heading
    And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-507-vocab" registers at least one seed phrase under the When heading
    And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-507-vocab" registers at least one seed phrase under the Then heading

  # ── §2 .adw/scenarios.md polymorphism flags are populated by adwInit ──

  @adw-507 @adw-nnny1e-vocabulary-md-templa
  Scenario: adwInit writes the Per-Issue Scenario Directory section into the target repo .adw/scenarios.md
    Given a fresh target repo "tgt-507-scen" with no .adw/scenarios.md
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-writes-scenarios.json"
    When the adwInit agent is invoked in target repo "tgt-507-scen" with adwId "init-507-5" for issue 1105
    Then the artefact file at ".adw/scenarios.md" in target repo "tgt-507-scen" contains a "## Per-Issue Scenario Directory" section heading
    And the Per-Issue Scenario Directory value in target repo "tgt-507-scen" is non-empty

  @adw-507 @adw-nnny1e-vocabulary-md-templa
  Scenario: adwInit writes the Regression Scenario Directory section into the target repo .adw/scenarios.md
    Given a fresh target repo "tgt-507-scen" with no .adw/scenarios.md
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-writes-scenarios.json"
    When the adwInit agent is invoked in target repo "tgt-507-scen" with adwId "init-507-6" for issue 1106
    Then the artefact file at ".adw/scenarios.md" in target repo "tgt-507-scen" contains a "## Regression Scenario Directory" section heading
    And the Regression Scenario Directory value in target repo "tgt-507-scen" is non-empty

  # ── §3 Combined adwInit output on a fresh target repo ─────────────────

  @adw-507 @adw-nnny1e-vocabulary-md-templa
  Scenario: A single adwInit run on a fresh target repo produces both the vocabulary file and both polymorphism flags
    Given a fresh target repo "tgt-507-combined" with no features/regression/vocabulary.md
    And a fresh target repo "tgt-507-combined" with no .adw/scenarios.md
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-writes-vocab-and-scenarios.json"
    When the adwInit agent is invoked in target repo "tgt-507-combined" with adwId "init-507-7" for issue 1107
    Then the artefact file at "features/regression/vocabulary.md" exists in target repo "tgt-507-combined"
    And the artefact file at ".adw/scenarios.md" in target repo "tgt-507-combined" contains a "## Per-Issue Scenario Directory" section heading
    And the artefact file at ".adw/scenarios.md" in target repo "tgt-507-combined" contains a "## Regression Scenario Directory" section heading
    And the Per-Issue Scenario Directory value in target repo "tgt-507-combined" is non-empty
    And the Regression Scenario Directory value in target repo "tgt-507-combined" is non-empty
