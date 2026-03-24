# JSONL Fixture Files

Canned JSONL fixtures representing known Claude CLI message types. Used by the CI conformance check (`bun run jsonl:check`) to verify that ADW's parsers remain compatible with the Claude CLI's output envelope.

## Envelope vs. Payload Convention

Each fixture line is a JSON object with two logical layers:

**Envelope fields** — structural fields controlled by the Claude CLI's output schema. These are updated programmatically by `bun run jsonl:update` when schema drift is detected. Do not hand-edit these for content changes.

**Payload fields** — hand-maintained content values (text strings, tool inputs, cost figures). These are preserved by `jsonl:update` and should represent realistic but minimal test data.

### `assistant` messages

| Field | Layer | Notes |
|-------|-------|-------|
| `type` | Envelope | Always `"assistant"` |
| `message.id` | Envelope | Message ID format may change |
| `message.model` | Envelope | Model identifier |
| `message.usage` | Envelope | Token counts (field names may change) |
| `message.content[].type` | Envelope | Content block type discriminator |
| `message.content[].text` | Payload | Hand-maintained text content |
| `message.content[].name` | Payload | Tool name (tool_use blocks) |
| `message.content[].input` | Payload | Tool input (tool_use blocks) |
| `message.content[].id` | Payload | Tool call ID (tool_use blocks) |

### `result` messages

| Field | Layer | Notes |
|-------|-------|-------|
| `type` | Envelope | Always `"result"` |
| `subtype` | Envelope | `"success"` or `"error"` |
| `isError` | Envelope | Boolean error flag |
| `durationMs` | Envelope | Wall-clock duration |
| `durationApiMs` | Envelope | API-only duration |
| `numTurns` | Envelope | Turn count |
| `sessionId` | Envelope | Session identifier |
| `result` | Payload | Hand-maintained result text |
| `total_cost_usd` | Payload | Cost figure (success only) |
| `modelUsage` | Payload | Per-model token usage (success only) |

## Fixture Files

| File | Message type | Subtype | Purpose |
|------|-------------|---------|---------|
| `assistant-text.jsonl` | `assistant` | — | Text-only content block |
| `assistant-tool-use.jsonl` | `assistant` | — | Mixed text + tool_use content |
| `result-success.jsonl` | `result` | `success` | Successful result with cost data |
| `result-error.jsonl` | `result` | `error` | Error result without cost data |

## Adding New Fixtures

1. Create a new `.jsonl` file with a single JSON line per message.
2. Name it `{type}-{description}.jsonl` (e.g., `system-init.jsonl`).
3. Run `bun run jsonl:check` to verify it parses correctly.
4. Document the envelope/payload split in this README if introducing a new message type.

## Workflow

```bash
# Update schema.json from the real Claude CLI (re-probe)
bun run jsonl:probe

# Check all fixtures against the schema
bun run jsonl:check

# Auto-update fixture envelopes when drift is detected
bun run jsonl:update
```
