@adw-02r4w9-jsonl-schema-probe-c
Feature: JSONL schema probe + CI conformance check

  Keep JSONL fixture envelopes in sync with the real Claude CLI output schema
  by probing the live CLI, validating fixture files against the probed schema,
  and programmatically updating envelope structure when drift is detected.

  Background:
    Given the ADW codebase is at the current working directory

  # ── 1. Schema probe script ──────────────────────────────────────────────────

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Schema probe script exists at the expected path
    When the schema probe script is located
    Then a runnable script exists for probing the Claude CLI JSONL envelope

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Schema probe invokes Claude CLI with a minimal prompt
    Given the schema probe script source is read
    When the CLI invocation is analyzed
    Then it passes a short prompt such as "say hello" to Claude CLI
    And it requests JSONL output format

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Schema probe captures envelope structure from CLI output
    Given the schema probe script source is read
    When the output processing logic is analyzed
    Then it parses each JSONL line as JSON
    And it extracts message types including "assistant" and "result"
    And it extracts field names and nesting depth for each message type

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Schema probe writes captured schema to a reference file
    Given the schema probe script source is read
    When the output persistence logic is analyzed
    Then it writes the extracted envelope schema to a JSON reference file
    And the reference file path is deterministic and version-controllable

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Schema probe cost is minimal
    Given the schema probe script source is read
    When the CLI invocation is analyzed
    Then the prompt is a single short sentence
    And no tool use or multi-turn conversation is requested

  # ── 2. JSONL fixture files ──────────────────────────────────────────────────

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: JSONL fixture files exist for testing parser conformance
    When the fixture directory is scanned
    Then at least one JSONL fixture file is present
    And each fixture file contains valid JSONL with one JSON object per line

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Fixture files contain both assistant and result message types
    Given the JSONL fixture files are read
    When the message types in each fixture are collected
    Then at least one fixture contains a message with type "assistant"
    And at least one fixture contains a message with type "result"

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Fixture envelope and payload content are clearly separated
    Given the JSONL fixture files are read
    When the structure of each fixture message is inspected
    Then the envelope fields (type, top-level keys) are distinguishable from payload content
    And fixture files or accompanying documentation describe the envelope/payload split

  # ── 3. CI conformance check ─────────────────────────────────────────────────

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: CI conformance check script exists
    When the CI conformance check script is located
    Then a runnable script exists for validating fixture envelopes against the probed schema

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: CI check validates fixtures parse through claudeStreamParser
    Given the CI conformance check script source is read
    When the validation logic is analyzed
    Then it passes each fixture file through the parseJsonlOutput function from claudeStreamParser.ts
    And it asserts that parsing completes without errors

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: CI check compares fixture envelope against probed schema
    Given the CI conformance check script source is read
    When the comparison logic is analyzed
    Then it loads the probed schema reference file
    And it compares each fixture message's top-level keys against the probed schema
    And it compares content block types against the probed schema

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: CI check fails when fixture envelope has drifted from probed schema
    Given a fixture file with an outdated envelope structure
    When the CI conformance check is executed
    Then the check exits with a non-zero exit code
    And the error output identifies which fixture files need updating

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: CI check error messages indicate what changed in the schema
    Given a fixture file with an outdated envelope structure
    When the CI conformance check is executed
    Then the error output lists which fields were added to the real schema
    And the error output lists which fields were removed from the real schema
    And the error output lists which fields have changed nesting or type

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: CI check passes when all fixtures conform to probed schema
    Given all fixture files have envelopes matching the probed schema
    When the CI conformance check is executed
    Then the check exits with code 0
    And no drift warnings are emitted

  # ── 4. Programmatic fixture update ──────────────────────────────────────────

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Fixture update script exists
    When the fixture update script is located
    Then a runnable script exists for programmatically updating fixture envelopes

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Fixture update rewrites envelope fields while preserving payload
    Given a fixture file with an outdated envelope structure
    And the fixture file contains hand-maintained payload content
    When the fixture update script is executed
    Then the envelope structure is updated to match the probed schema
    And the hand-maintained payload content is preserved unchanged

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Fixture update adds new envelope fields from probed schema
    Given the probed schema includes a new top-level field not present in a fixture
    When the fixture update script is executed against that fixture
    Then the new field is added to the fixture messages with a sensible default value
    And existing fields remain unchanged

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Fixture update removes obsolete envelope fields
    Given a fixture contains an envelope field no longer present in the probed schema
    When the fixture update script is executed against that fixture
    Then the obsolete field is removed from the fixture messages
    And payload content fields are not removed

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Fixture update processes all fixture files in one invocation
    Given multiple fixture files exist with outdated envelopes
    When the fixture update script is executed without specifying individual files
    Then all fixture files in the fixture directory are updated

  # ── 5. Parser type alignment ────────────────────────────────────────────────

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Probed schema covers all ContentBlock discriminated union types
    Given the probed schema reference file is loaded
    When the content block types in the schema are listed
    Then they include "text", "tool_use", and "tool_result"
    And they align with the ContentBlock union in claudeStreamParser.ts

  @adw-02r4w9-jsonl-schema-probe-c
  Scenario: Probed schema covers JsonlMessage discriminated union types
    Given the probed schema reference file is loaded
    When the top-level message types in the schema are listed
    Then they include "assistant" and "result"
    And they align with the JsonlMessage union in claudeStreamParser.ts

  # ── 6. TypeScript integrity ─────────────────────────────────────────────────

  @adw-02r4w9-jsonl-schema-probe-c @regression
  Scenario: TypeScript type-check passes after all changes for issue 280
    Given the ADW codebase has been modified for issue 280
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
