# JSONL Fixture Files

Canned JSONL fixtures representing known Claude CLI message types. Used by the CI conformance check (`bun run jsonl:check`) to verify that `adws/jsonl/schema.json` — ADW's only contract with the Claude CLI's undocumented `--output-format stream-json` envelope — still matches what the CLI emits, and that ADW's own parsers (`claudeStreamParser.ts`, `AnthropicTokenUsageExtractor`) still react to it correctly. The same check also covers the regression stub's envelope templates under `test/fixtures/jsonl/envelopes/`.

## Keying and lookup

A schema entry is keyed `type`, or `type/subtype` when the envelope carries a string `subtype`. The checker resolves the exact `type/subtype` key first, then falls back to the bare `type` key, else the message has no schema coverage (reported informationally, never a failure). The bare `result` entry exists for exactly this fallback: a `result` subtype with no keyed entry of its own (e.g. `error_max_turns`) is still checked against the fields every result subtype carries, and a `result` line that has lost its `subtype` also resolves here — failing by naming `subtype` missing, because `subtype` is one of this entry's required fields.

## Probe-owned vs. capture-owned entries

- **Probe-owned** (`system/init`, `assistant`, `result/success`): what a one-turn `say hello` run deterministically produces. `bun run jsonl:probe` reconciles these against the pinned CLI — keeping every hand-set `required` flag for a field still observed live, dropping a field the CLI no longer emits, adding a new field as optional — and stamps `probedAt`/`cliVersion`. Never hand-edit these three entries' `required` flags without also re-running the probe; the next refresh will only add to what you set, never remove.
- **Capture-owned** (`rate_limit_event`, `system/api_retry`, `result/error_during_execution`) and the bare `result` fallback: shapes the probe can never trigger on demand (a genuine rate limit, a documented retry message). These come from real CLI captures and are hand-curated. `bun run jsonl:probe` never touches them, even if a live run happens to observe one (e.g. an `allowed` `rate_limit_event` on an OAuth session) — it does not know how to merge a shape it wasn't looking for.

`bun run jsonl:update` (the fixture updater) only ever **adds** a field the schema marks `required: true` but a fixture is missing, using a type default (`""`, `0`, `false`, `{}`, `[]`, `null`). It never deletes a field and never overwrites a value already present — so running it over a capture-owned fixture can backfill a field that fell off during a hand-edit, but can never damage the real values a capture carries.

## Redaction rules for real captures

A capture-owned fixture is never hand-written from memory — it is extracted from a real `output.jsonl` line and redacted, never invented. Apply consistently:

- Replace `cwd` with `/redacted/worktree` and `messaging_socket_path` with `/redacted/cc.sock`.
- Trim `tools`, `mcp_servers`, `slash_commands`, `terminal_slash_commands`, `agents`, `skills`, `plugins`, `capabilities` to a single short placeholder entry (or `[]`); trim `permission_denials` and `usage.iterations` to `[]`; trim `errors` entries to one short placeholder string.
- Keep every key the capture has — redaction never deletes a field.
- Keep `session_id` and `uuid` values as captured (random ids that tie a session's lines together) and every numeric field as captured.
- Keep limit/error text (e.g. the session-limit message, `"API Error: 500 …"`) verbatim.

## Multi-line convention

A fixture is one JSON object per line. Most fixtures are a single line; a fixture capturing a real session excerpt (e.g. `session-rate-limited.jsonl`) is several consecutive lines from one real capture, in original order. The checker resolves each line against the schema independently, but runs the stream parser and the token-usage extractor exactly once per fixture, over the whole file — this is why a trailing newline is always required after the last line (the parser buffers back a final segment that lacks one instead of parsing it).

## Fixture table

| File | Key(s) | Provenance |
|------|--------|------------|
| `assistant-text.jsonl` | `assistant` | Hand-maintained; envelope fields backfilled by `jsonl:update` against the probed schema |
| `assistant-tool-use.jsonl` | `assistant` | Hand-maintained; envelope fields backfilled by `jsonl:update` against the probed schema |
| `result-success.jsonl` | `result/success` | Real capture, `gb7bw3-safety-net-6-flask-9/sdlc-orchestrator/build-agent`, redacted |
| `result-error.jsonl` | `result/success` (an API error, `is_error: true`) | Real capture, `gb7bw3-safety-net-6-flask-9/sdlc-orchestrator/build-agent` (`api_error_status: 500`), redacted |
| `result-error-during-execution.jsonl` | `result/error_during_execution` | Real capture, `2e1mv7-trustworthy-restart/sdlc-orchestrator/step-def-agent`, redacted |
| `system-api-retry-overloaded.jsonl` | `system/api_retry` | Real capture, `qfsbjl-intake-leg-infinite/sdlc-orchestrator/scenario-agent` (`error: "overloaded"`, `error_status: 529`), redacted |
| `system-api-retry-rate-limit.jsonl` | `system/api_retry` | Real capture, `l5p91e-chore-comment-sweep/chore-orchestrator/build-agent` (`error: "rate_limit"`, `error_status: 429`), redacted |
| `session-rate-limited.jsonl` (multi-line: `system/init` → `rate_limit_event` → `assistant` → `result`) | `system/init`, `rate_limit_event`, `assistant`, `result/success` | Real capture, `q7t0yb-adw-switchover-to-pa/chore-orchestrator/patch-agent`, session `5cfcc639-a6f3-4825-a97b-838bb8b98bc3` (CLI 2.1.278, captured 2026-09-22/23), a genuine five-hour session limit, redacted |

## Workflow

```bash
# Refresh the probe-owned entries from the pinned CLI (writes adws/jsonl/schema.json)
bun run jsonl:probe

# Read-only: report drift between the committed schema and a fresh live probe (CI's live leg)
bun run jsonl:probe:check

# Check all fixtures (adws/jsonl/fixtures/ and test/fixtures/jsonl/envelopes/) against the schema
bun run jsonl:check

# Add missing required envelope fields to fixtures whose schema entry resolves (never deletes, never overwrites)
bun run jsonl:update
```

## Adding a new fixture

1. Create a new `.jsonl` file with one JSON object per line.
2. Name it `{type}-{description}.jsonl` (or `{type}-{subtype}-{description}.jsonl` when the type has more than one keyed subtype).
3. If it represents a shape the probe cannot trigger on demand, extract and redact it from a real capture — never hand-write one from memory.
4. Run `bun run jsonl:check` to verify it parses and conforms; run `bun run jsonl:update` first if it's a hand-maintained fixture missing required fields.
5. Add a row to the fixture table above.
