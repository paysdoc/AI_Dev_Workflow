# Feature: JSONL Schema Probe + CI Conformance Check

## Metadata
issueNumber: `280`
adwId: `02r4w9-jsonl-schema-probe-c`
issueJson: `{"number":280,"title":"JSONL schema probe + CI conformance check","body":"## Parent PRD\n\n`specs/prd/prd-review-revamp.md`\n\n## What to build\n\nCreate an automated mechanism to keep JSONL fixture envelopes in sync with the real Claude CLI output schema.\n\n**Schema probe:**\n- A minimal Claude CLI call (e.g., `\"say hello\"`) that captures the current JSONL output envelope structure\n- Extracts the message types, field names, and nesting from the real output\n- Runs cheaply (minimal tokens)\n\n**CI conformance check:**\n- Validates that all canned JSONL fixture files still parse correctly through `jsonlParser.ts` and `claudeStreamParser.ts`\n- Compares fixture envelope structure against the probed schema\n- Fails CI when the Claude CLI schema has drifted and fixtures need updating\n- Provides clear error messages indicating which fixtures need updates and what changed\n\n**Programmatic fixture update:**\n- When envelope drift is detected, programmatically update the envelope structure of all fixture files while preserving the hand-maintained payload content\n\nSee PRD sections: \"JSONL Fixture Management\", \"Claude CLI Stub\".\n\n## Acceptance criteria\n\n- [ ] Schema probe script exists and captures current JSONL envelope from a real Claude CLI call\n- [ ] CI check validates fixture envelopes against the probed schema\n- [ ] CI check fails with clear error messages when fixtures are out of date\n- [ ] Programmatic update script rewrites fixture envelopes while preserving payload\n- [ ] Envelope/payload split is clearly documented in fixture files\n- [ ] Probe cost is minimal (single short prompt)\n\n## Blocked by\n\n- Blocked by #275 (mock infrastructure: Claude CLI stub, GitHub API mock, git remote mock)\n\n## User stories addressed\n\n- User story 23\n- User story 24","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-23T17:01:54Z","comments":[{"author":"paysdoc","createdAt":"2026-03-24T18:54:56Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Create an automated mechanism to keep JSONL fixture envelopes in sync with the real Claude CLI output schema. This feature adds three capabilities: (1) a schema probe that makes a minimal Claude CLI call to capture the current JSONL envelope structure, (2) a CI conformance check that validates canned JSONL fixture files against the probed schema and fails when drift is detected, and (3) a programmatic fixture updater that rewrites fixture envelopes while preserving hand-maintained payload content.

The JSONL output from the Claude CLI is the foundation of ADW's agent communication — `claudeStreamParser.ts` and `agentProcessHandler.ts` parse it to extract text, tool usage, cost data, and result messages. When the Claude CLI changes its output envelope (e.g., adding/removing/renaming fields), ADW's parsers silently break or lose data. This feature makes that breakage loud, early, and automatically fixable.

## User Story
As an ADW maintainer
I want automated detection when Claude CLI JSONL output structure changes
So that I can quickly update fixtures and parsers before silent data loss reaches production

## Problem Statement
ADW's JSONL parsers (`claudeStreamParser.ts`, `AnthropicTokenUsageExtractor`) are hand-coded against an implicit schema derived from observing Claude CLI output. There are no canned fixture files today, and no CI check to detect when the CLI's output envelope drifts. This means schema changes are only discovered when workflows break in production, leading to silent cost-tracking errors, missed tool calls, or failed agent runs.

## Solution Statement
Introduce a three-layer defense:

1. **Schema probe** (`adws/jsonl/schemaProbe.ts`): A standalone script that spawns the Claude CLI with a minimal prompt (`"say hello"`), captures the JSONL output, and extracts the envelope schema (message types, field names, nesting structure) into a canonical `adws/jsonl/schema.json` file. Runs cheaply (~100 tokens).

2. **Fixture files** (`adws/jsonl/fixtures/`): Canned `.jsonl` fixture files representing each known message type (`assistant`, `result`, `system`). Each fixture uses a structured format with a `__meta__` section documenting envelope vs. payload fields.

3. **Conformance checker** (`adws/jsonl/conformanceCheck.ts`): A script that loads the probed schema and validates all fixture files against it — checking that envelope fields match the expected structure. Also validates that fixtures parse correctly through `parseJsonlOutput()` and `AnthropicTokenUsageExtractor.onChunk()`. Exits non-zero with clear error messages on drift.

4. **Fixture updater** (`adws/jsonl/fixtureUpdater.ts`): When drift is detected, programmatically updates envelope fields in all fixture files while preserving the hand-maintained payload content (text strings, tool inputs, cost values).

## Relevant Files
Use these files to implement the feature:

- `adws/core/claudeStreamParser.ts` — The primary JSONL parser. Defines `JsonlMessage`, `JsonlAssistantMessage`, `JsonlResultMessage`, `ContentBlock` types. The conformance checker must validate fixtures parse through `parseJsonlOutput()`.
- `adws/agents/jsonlParser.ts` — Re-export barrel for backward compatibility. No changes needed but referenced by the issue.
- `adws/agents/agentProcessHandler.ts` — Shows how JSONL is consumed in practice: stdout → `extractor.onChunk()` + `parseJsonlOutput()`. The probe script follows the same pattern.
- `adws/cost/providers/anthropic/extractor.ts` — `AnthropicTokenUsageExtractor` parses `assistant` and `result` messages for token usage. Conformance check must validate fixtures parse through this too.
- `adws/cost/__tests__/extractor.test.ts` — Existing Vitest tests with inline JSONL fixtures. Shows the current envelope shapes for `result` and `assistant` messages. The new fixture files should be consistent with these shapes.
- `adws/types/agentTypes.ts` — `ClaudeCodeResultMessage` type definition. The `result` message fixture must match this shape.
- `adws/core/environment.ts` — `resolveClaudeCodePath()` and `getSafeSubprocessEnv()` needed by the probe script to spawn the Claude CLI.
- `adws/agents/claudeAgent.ts` — `runClaudeAgentWithCommand()` shows the CLI spawn pattern. The probe script can follow a simpler version of this.
- `guidelines/coding_guidelines.md` — Coding standards to follow.
- `package.json` — Script entries for the new commands.
- `vitest.config.ts` — May need to include the new test directory.

### New Files
- `adws/jsonl/schemaProbe.ts` — Schema probe: spawns Claude CLI, captures JSONL, extracts envelope schema.
- `adws/jsonl/schema.json` — Canonical envelope schema extracted by the probe (committed to repo, updated by probe runs).
- `adws/jsonl/conformanceCheck.ts` — CI conformance checker: validates fixtures against probed schema.
- `adws/jsonl/fixtureUpdater.ts` — Programmatic fixture envelope updater.
- `adws/jsonl/types.ts` — Shared types for the JSONL schema/fixture system.
- `adws/jsonl/index.ts` — Barrel exports.
- `adws/jsonl/fixtures/assistant-text.jsonl` — Fixture: assistant message with text content blocks.
- `adws/jsonl/fixtures/assistant-tool-use.jsonl` — Fixture: assistant message with tool_use content blocks.
- `adws/jsonl/fixtures/result-success.jsonl` — Fixture: successful result message with modelUsage.
- `adws/jsonl/fixtures/result-error.jsonl` — Fixture: error result message.
- `adws/jsonl/fixtures/README.md` — Documents the envelope/payload split convention for fixture files.

## Implementation Plan
### Phase 1: Foundation — Types and Schema Definition
Define the canonical envelope schema format and shared types. Establish the `adws/jsonl/` module structure. Create the schema representation that captures message types, required/optional field names, and nesting. This phase builds the vocabulary the rest of the feature uses.

### Phase 2: Core Implementation — Probe, Fixtures, and Conformance
1. Implement the schema probe that spawns the Claude CLI with a minimal prompt and extracts the envelope schema from the real JSONL output.
2. Create the initial set of fixture files covering the known message types (`assistant` with text/tool_use content, `result` success/error).
3. Implement the conformance checker that validates fixtures against the probed schema and through the existing parsers.
4. Implement the fixture updater that rewrites envelope fields while preserving payload content.

### Phase 3: Integration — Scripts and CI
Wire the new tools into the project's script infrastructure (`package.json` scripts). Create a `bun run jsonl:check` command that CI can invoke. Document the envelope/payload convention in fixture files.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Create the `adws/jsonl/` module structure and shared types
- Create `adws/jsonl/types.ts` with:
  - `EnvelopeSchema` interface: represents the canonical field structure per message type (type name → set of expected top-level field names, nested field schemas for `message.content`, `message.usage`, `modelUsage`).
  - `FixtureMeta` interface: metadata embedded in fixture files documenting which fields are envelope (schema-controlled) vs. payload (hand-maintained).
  - `ConformanceResult` interface: per-fixture validation result (pass/fail, missing fields, extra fields, parse errors).
  - `SchemaField` interface: field name, required flag, expected type (string/number/boolean/object/array), and optional nested `SchemaField[]` for objects.
- Create `adws/jsonl/index.ts` barrel exporting all public types and functions.

### Step 2: Implement the schema probe (`adws/jsonl/schemaProbe.ts`)
- Import `resolveClaudeCodePath` and `getSafeSubprocessEnv` from `adws/core/environment.ts`.
- Implement `probeClaudeJsonlSchema()` function:
  - Spawns the Claude CLI with `--output-format json --print "say hello"` (the `--print` flag runs a single prompt without interactive mode, producing minimal JSONL output).
  - Captures stdout, splits into JSONL lines, parses each as JSON.
  - For each message type encountered (`assistant`, `result`, `system`, etc.), extracts the field structure recursively (field names, types, nesting).
  - Builds an `EnvelopeSchema` object representing the canonical envelope.
  - Writes the schema to `adws/jsonl/schema.json`.
- Implement `extractFieldSchema(obj: unknown): SchemaField[]` helper that recursively walks an object and returns its field structure.
- Make the script executable standalone: `bunx tsx adws/jsonl/schemaProbe.ts` should run the probe and write `schema.json`.
- Keep cost minimal — the `--print "say hello"` invocation uses ~100 tokens.

### Step 3: Create initial fixture files
- Create `adws/jsonl/fixtures/` directory.
- Create `adws/jsonl/fixtures/assistant-text.jsonl` — An assistant message with text content blocks. Structure based on the shapes observed in `extractor.test.ts` and `claudeStreamParser.ts`:
  ```jsonl
  {"type":"assistant","message":{"id":"msg_fixture_text","model":"claude-sonnet-4-6","usage":{"input_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"Hello! How can I help you today?"}]}}
  ```
- Create `adws/jsonl/fixtures/assistant-tool-use.jsonl` — An assistant message with tool_use content:
  ```jsonl
  {"type":"assistant","message":{"id":"msg_fixture_tool","model":"claude-sonnet-4-6","usage":{"input_tokens":200,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"Let me read that file."},{"type":"tool_use","id":"toolu_fixture_1","name":"Read","input":{"file_path":"/tmp/test.txt"}}]}}
  ```
- Create `adws/jsonl/fixtures/result-success.jsonl` — A successful result message:
  ```jsonl
  {"type":"result","subtype":"success","isError":false,"durationMs":5000,"durationApiMs":3000,"numTurns":1,"result":"Done.","sessionId":"session_fixture_1","total_cost_usd":0.001,"modelUsage":{"claude-sonnet-4-6":{"inputTokens":100,"outputTokens":50,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"costUSD":0.001}}}
  ```
- Create `adws/jsonl/fixtures/result-error.jsonl` — An error result message:
  ```jsonl
  {"type":"result","subtype":"error","isError":true,"durationMs":2000,"durationApiMs":1000,"numTurns":0,"result":"Error: something went wrong","sessionId":"session_fixture_2"}
  ```
- Each fixture file contains a single JSONL line representing one message.
- Create `adws/jsonl/fixtures/README.md` documenting:
  - The envelope/payload convention: envelope fields are controlled by the schema probe and updated programmatically; payload fields contain hand-maintained test content.
  - Which fields are envelope vs. payload for each message type.
  - How to add new fixture files.

### Step 4: Implement the conformance checker (`adws/jsonl/conformanceCheck.ts`)
- Implement `checkConformance(schemaPath: string, fixturesDir: string): ConformanceResult[]` function:
  - Loads the probed schema from `schema.json`.
  - Discovers all `.jsonl` files in the fixtures directory.
  - For each fixture file:
    1. **Parse check**: Verifies the JSONL line parses as valid JSON.
    2. **Schema check**: Compares the fixture's top-level and nested field names against the probed schema. Reports missing required fields and unexpected extra fields.
    3. **Parser check**: Feeds the fixture line through `parseJsonlOutput()` and verifies it produces expected state changes (e.g., `assistant` message increments `turnCount`, `result` message sets `lastResult`).
    4. **Extractor check**: Feeds the fixture line through `AnthropicTokenUsageExtractor.onChunk()` and verifies it extracts usage data without errors.
  - Returns a `ConformanceResult` per fixture.
- Implement `formatConformanceReport(results: ConformanceResult[]): string` that produces a human-readable report:
  - For passing fixtures: one-line summary.
  - For failing fixtures: detailed diff showing which fields are missing/extra/changed, with the fixture filename and field path.
- Make standalone executable: `bunx tsx adws/jsonl/conformanceCheck.ts` exits 0 on pass, 1 on failure, with the report on stdout.

### Step 5: Implement the fixture updater (`adws/jsonl/fixtureUpdater.ts`)
- Implement `updateFixtureEnvelopes(schemaPath: string, fixturesDir: string): UpdateResult[]` function:
  - Loads the probed schema.
  - For each fixture file:
    1. Parses the existing JSONL line.
    2. Identifies envelope fields (from the schema) and payload fields (everything else, plus content text/input values).
    3. Merges: takes envelope field structure from the probed schema, preserves payload values from the existing fixture.
    4. Writes the updated fixture back to disk.
  - Returns an `UpdateResult` per fixture listing what changed.
- Define the envelope/payload boundary clearly:
  - **Envelope fields** (updated by the updater): `type`, `subtype`, `isError`, `durationMs`, `durationApiMs`, `numTurns`, `sessionId` (result); `type`, `message.id`, `message.model`, `message.usage` structure (assistant); content block `type` field.
  - **Payload fields** (preserved by the updater): `result` text, `total_cost_usd` and `modelUsage` values (result); `message.content[].text`, `message.content[].input`, `message.content[].name` (assistant).
- Make standalone executable: `bunx tsx adws/jsonl/fixtureUpdater.ts` updates fixtures in place and reports changes.

### Step 6: Wire scripts into `package.json`
- Add the following npm scripts to `package.json`:
  - `"jsonl:probe"`: `"bunx tsx adws/jsonl/schemaProbe.ts"` — Run the schema probe against the real Claude CLI.
  - `"jsonl:check"`: `"bunx tsx adws/jsonl/conformanceCheck.ts"` — Run the conformance check (CI entry point).
  - `"jsonl:update"`: `"bunx tsx adws/jsonl/fixtureUpdater.ts"` — Programmatically update fixture envelopes.

### Step 7: Run validation commands
- Run `bun run lint` to verify no linting errors.
- Run `bun run build` to verify TypeScript compilation.
- Run `bun run jsonl:check` to verify conformance check passes with the initial fixtures and schema.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for additional type checking.

## Testing Strategy
### Edge Cases
- **No `schema.json` exists yet**: The conformance checker should print a clear error directing the user to run `bun run jsonl:probe` first, rather than crashing.
- **Claude CLI not available**: The probe script should catch `resolveClaudeCodePath()` errors and exit with a clear message (e.g., "Claude CLI not found — set CLAUDE_CODE_PATH or ensure 'claude' is in PATH").
- **Empty JSONL output**: If the CLI produces no JSONL (e.g., auth error), the probe should detect this and exit with a descriptive error rather than writing an empty schema.
- **New message type in CLI output**: The conformance checker should warn about message types present in the probed schema but missing from fixtures (no fixture coverage), without failing.
- **Fixture with extra payload fields**: The updater should preserve all payload fields even if they are not in the schema — only envelope fields are rewritten.
- **Malformed fixture file**: The conformance checker should report a parse error for that fixture and continue checking others.
- **Result message with optional fields missing**: Fixtures should cover both the full result message (with `modelUsage`, `total_cost_usd`) and the minimal result message (just `type`, `subtype`, `isError`, `result`).

## Acceptance Criteria
- [ ] `adws/jsonl/schemaProbe.ts` exists and captures current JSONL envelope from a real Claude CLI call via `bun run jsonl:probe`
- [ ] `adws/jsonl/schema.json` is generated by the probe and committed to the repo
- [ ] Fixture files exist in `adws/jsonl/fixtures/` covering `assistant` (text, tool_use) and `result` (success, error) message types
- [ ] `adws/jsonl/fixtures/README.md` documents the envelope/payload split convention
- [ ] `bun run jsonl:check` validates fixture envelopes against the probed schema and through `parseJsonlOutput()` and `AnthropicTokenUsageExtractor`
- [ ] `bun run jsonl:check` exits non-zero with clear, actionable error messages when fixtures are out of date
- [ ] `bun run jsonl:update` programmatically rewrites fixture envelopes while preserving payload content
- [ ] Schema probe cost is minimal (single short `--print "say hello"` invocation, ~100 tokens)
- [ ] All new code follows `guidelines/coding_guidelines.md` (strict TypeScript, no `any`, functional style, immutability, <300 line files)
- [ ] `bun run lint` passes with zero errors
- [ ] `bun run build` passes with zero errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type check for the adws module
- `bun run jsonl:check` — Run the conformance check to validate fixtures against the schema (should exit 0 with all fixtures passing)

## Notes
- This feature is blocked by #275 (mock infrastructure). However, the implementation can proceed with the real Claude CLI for the probe — the mock infrastructure from #275 will be used for CI environments where the real CLI is not available. The conformance check itself does not require the CLI (it only reads `schema.json` and fixture files), so it runs in CI without needing the mock.
- The `--print` flag on the Claude CLI runs a single prompt and exits, producing minimal JSONL output. This is the cheapest possible probe call.
- The probed `schema.json` should be committed to the repo so that the conformance check can run in CI without needing to re-probe. The probe is only re-run when maintainers want to check for schema drift.
- The envelope/payload split is inspired by the existing pattern in `extractor.test.ts`, where inline JSONL objects have a known structure (envelope) with substituted values (payload).
- Follow `guidelines/coding_guidelines.md`: strict TypeScript, no `any`, prefer pure functions, keep files under 300 lines, use declarative style (map/filter/reduce).
- No new libraries needed.
