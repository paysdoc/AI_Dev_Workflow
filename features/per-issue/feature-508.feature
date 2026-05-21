@adw-508 @adw-mqwyb7-llm-drafted-observab
Feature: adwInit LLM-drafts the observability-surfaces examples block in target-repo vocabulary.md

  Issue #508 extends `.claude/commands/adw_init.md` step 7 so that after
  the slice-#507 template copy completes, the agent analyses the target
  repo (manifest files, dev dependencies, test directories) and replaces
  the slice-#507 Observability Surfaces TODO placeholder in the
  materialised `features/regression/vocabulary.md` with a real
  repo-specific examples block. The block must enumerate the kinds of
  observable evidence the team will actually use in scenarios (state
  files, recorded HTTP requests, exit codes, git artefacts, DOM
  snapshots, screenshot artefacts, etc.) and must follow the same
  Markdown table layout as the framework's own
  `features/regression/vocabulary.md` examples.

  Rubber-stamp risk is explicitly accepted per the parent PRD's user
  story 19 — no gating workflow is added on the maintainer's review of
  this block. Miscalibration is expected to surface through the first
  scenarios produced against the target repo, not through an init-PR
  audit step.

  The behavioural contract under test is observed through the artefact
  `vocabulary.md` written into a temp target repo by the simulated
  adwInit agent run — not through any structural assertion against the
  framework source files (`adw_init.md` or `vocabulary.md.template`).
  Asserting against those framework source files would be the very rot
  pattern issue #506 was designed to stop. The acceptance-criteria
  bullet referring to `adw_init.md` step 7's textual content is a
  PR-review check for humans; the scenarios below describe the
  downstream observable behaviour the prompt change must produce in a
  target repo.

  The adwInit agent invocation is simulated through the existing
  claude-cli-stub manifest harness (the same pattern used by slice
  #507), and assertions are scoped to the temp target-repo directory
  created per scenario. Per-issue and regression scenario directory
  routing from slice #507 must continue to hold unchanged.

  Background:
    Given the ADW framework codebase is checked out

  # ── §1 The slice-#507 placeholder is replaced with a real examples block ──

  @adw-508 @adw-mqwyb7-llm-drafted-observab
  Scenario: adwInit replaces the slice-#507 Observability Surfaces TODO placeholder with a populated examples block
    Given a fresh target repo "tgt-508-placeholder" with no features/regression/vocabulary.md
    And the target repo "tgt-508-placeholder" has a package.json declaring "@playwright/test" in devDependencies
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-drafts-playwright-examples.json"
    When the adwInit agent is invoked in target repo "tgt-508-placeholder" with adwId "init-508-1" for issue 1201
    Then the artefact file at "features/regression/vocabulary.md" exists in target repo "tgt-508-placeholder"
    And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-placeholder" no longer contains the slice-#507 observability-surfaces TODO placeholder marker
    And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-placeholder" contains a "## Observability Surfaces" section heading
    And the Observability Surfaces section in target repo "tgt-508-placeholder" has at least one populated table data row

  # ── §2 Playwright-detected repo produces DOM/screenshot evidence entries ──

  @adw-508 @adw-mqwyb7-llm-drafted-observab
  Scenario: adwInit on a repo with @playwright/test in devDependencies drafts DOM and screenshot entries
    Given a fresh target repo "tgt-508-playwright" with no features/regression/vocabulary.md
    And the target repo "tgt-508-playwright" has a package.json declaring "@playwright/test" in devDependencies
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-drafts-playwright-examples.json"
    When the adwInit agent is invoked in target repo "tgt-508-playwright" with adwId "init-508-2" for issue 1202
    Then the Observability Surfaces section in target repo "tgt-508-playwright" lists at least one DOM-based evidence entry
    And the Observability Surfaces section in target repo "tgt-508-playwright" lists at least one screenshot-based evidence entry

  # ── §3 CLI-only repo produces a scoped block without DOM/screenshot entries ─

  @adw-508 @adw-mqwyb7-llm-drafted-observab
  Scenario: adwInit on a CLI-only repo drafts an examples block scoped to state files, recorded requests, and exit codes
    Given a fresh target repo "tgt-508-cli" with no features/regression/vocabulary.md
    And the target repo "tgt-508-cli" has a package.json declaring no UI test framework in devDependencies
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-drafts-cli-examples.json"
    When the adwInit agent is invoked in target repo "tgt-508-cli" with adwId "init-508-3" for issue 1203
    Then the Observability Surfaces section in target repo "tgt-508-cli" lists at least one state-file evidence entry
    And the Observability Surfaces section in target repo "tgt-508-cli" lists at least one recorded-request evidence entry
    And the Observability Surfaces section in target repo "tgt-508-cli" lists at least one exit-code evidence entry
    And the Observability Surfaces section in target repo "tgt-508-cli" lists no DOM-based evidence entries
    And the Observability Surfaces section in target repo "tgt-508-cli" lists no screenshot-based evidence entries

  # ── §4 The drafted block follows the framework's Markdown table layout ────

  @adw-508 @adw-mqwyb7-llm-drafted-observab
  Scenario: The drafted Observability Surfaces section uses a Markdown table with a header row, a separator row, and data rows
    Given a fresh target repo "tgt-508-shape" with no features/regression/vocabulary.md
    And the target repo "tgt-508-shape" has a package.json declaring "@playwright/test" in devDependencies
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-drafts-playwright-examples.json"
    When the adwInit agent is invoked in target repo "tgt-508-shape" with adwId "init-508-4" for issue 1204
    Then the Observability Surfaces section in target repo "tgt-508-shape" begins with a Markdown table header row
    And the Observability Surfaces section in target repo "tgt-508-shape" has a Markdown table separator row immediately beneath the header row
    And the Observability Surfaces section in target repo "tgt-508-shape" has at least two Markdown table data rows under the separator row

  # ── §5 One adwInit pass produces all expected effects in the artefact ─────

  @adw-508 @adw-mqwyb7-llm-drafted-observab
  Scenario: A single adwInit run on a fresh Playwright target repo simultaneously removes the placeholder, populates the examples section, and uses the framework table layout
    Given a fresh target repo "tgt-508-combined" with no features/regression/vocabulary.md
    And the target repo "tgt-508-combined" has a package.json declaring "@playwright/test" in devDependencies
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-drafts-playwright-examples.json"
    When the adwInit agent is invoked in target repo "tgt-508-combined" with adwId "init-508-5" for issue 1205
    Then the artefact file at "features/regression/vocabulary.md" exists in target repo "tgt-508-combined"
    And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-combined" no longer contains the slice-#507 observability-surfaces TODO placeholder marker
    And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-combined" contains a "## Observability Surfaces" section heading
    And the Observability Surfaces section in target repo "tgt-508-combined" lists at least one DOM-based evidence entry
    And the Observability Surfaces section in target repo "tgt-508-combined" lists at least one screenshot-based evidence entry
    And the Observability Surfaces section in target repo "tgt-508-combined" has at least two Markdown table data rows under the separator row
