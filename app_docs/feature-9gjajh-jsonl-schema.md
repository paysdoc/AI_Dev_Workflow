# JSONL Schema

## Overview

The JSONL schema module captures and validates the envelope format emitted by the Claude CLI in `--output-format stream-json` mode. It provides a probe that generates a `schema.json` from a live CLI run, a conformance checker that validates fixture files against that schema and through ADW's parsers, and a fixture updater for keeping test fixtures current.

## Responsibilities

- Define typed schema structures: `SchemaField`, `EnvelopeSchema` (timestamped map of message type to field list), `ConformanceResult` (per-fixture pass/fail with missing/extra fields and parser/extractor errors), and `UpdateResult`.
- Probe the live Claude CLI by spawning it with `--print --output-format stream-json 'say hello'` and extracting field schemas from the first occurrence of each message type via `probeClaudeJsonlSchema`; write the result to `adws/jsonl/schema.json`.
- Validate fixture `.jsonl` files against `schema.json` via `checkConformance`, running four checks per fixture: JSON parse, schema field presence (required fields only, dot-path notation), `parseJsonlOutput` parser acceptance, and `AnthropicTokenUsageExtractor` acceptance.
- Report conformance results as human-readable text via `formatConformanceReport`; exit non-zero when any fixture fails (standalone entry point).
- Update fixture files to match current schema field structure via `fixtureUpdater.ts`.

## Contracts & Invariants

- `probeClaudeJsonlSchema` marks all observed fields as `required: true` (probe sees only one live example); the schema is therefore a minimum-required-fields snapshot, not a complete schema.
- First occurrence of each message type wins in the probe; subsequent messages of the same type are ignored.
- `checkConformance` treats an unknown message type (not in `schema.json`) as a pass with an informational `extraFields` entry, not a failure.
- Extra fields in fixtures (present in data but absent from schema) are informational only and do not cause a failure.
- The conformance check uses `adws/jsonl/fixtures/` as the default fixtures directory and `adws/jsonl/schema.json` as the default schema path; both are overridable via arguments.
- The `assistant` message type is expected to increment `turnCount` through `parseJsonlOutput`; the `result` type is expected to set `lastResult` and finalize `AnthropicTokenUsageExtractor`.

## Configuration

`CLAUDE_CODE_PATH` environment variable (or `claude` on PATH) determines which CLI binary the probe spawns. Schema and fixtures paths default to sibling directories of the module files; both are overridable at call time.

## Gotchas

- `schema.json` is generated from a single live run and only captures message types that appear in a minimal `say hello` response. Message types that only appear in longer or tool-using conversations are absent from the schema.
- Running the conformance check requires `schema.json` to exist; it throws if the file is missing rather than falling back to a default schema.
- The probe requires a valid Claude CLI authentication session; it fails with a descriptive error if the CLI produces no output.
- `schemaProbe.ts` can be run standalone via `bun run jsonl:probe`; `conformanceCheck.ts` via `bun run jsonl:check`; `fixtureUpdater.ts` via `bun run jsonl:update`.
