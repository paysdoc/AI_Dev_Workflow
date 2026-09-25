# Feature: Stream-json envelope conformance gate in CI with a rate-limited fixture

## Metadata
issueNumber: `909`
adwId: `uk9ams-stream-json-envelope`
issueJson: `{"number":909,"title":"Stream-json envelope conformance gate in CI with a rate-limited fixture","body":"## Parent PRD\n\n`specs/prd/rate-limit-indefinite-retry.md`\n\n## What to build\n\nRevive the dead stream-json envelope conformance machinery and put it in CI, so a change in the Claude CLI's output fails a pull request instead of stranding workflows. See PRD section \"Envelope conformance gate\".\n\nCurrent state (verified 2026-09-25): `bun run jsonl:probe` / `jsonl:check` / `jsonl:update` exist but nothing runs them; the schema was last probed 2026-03-24; it knows only `assistant`, `result`, `system`; it has no `rate_limit_event` and no `api_error_status` / `terminal_reason` on `result`; and the error fixture uses `isError` / `sessionId` where the CLI emits `is_error` / `session_id`. Anthropic has declined to publish a stable schema (claude-code#53516), so this gate is our only contract.\n\nScope:\n\n- Re-probe the schema with the current CLI and extend it to cover `rate_limit_event` (with `rate_limit_info`) and the `result` error fields (`is_error`, `api_error_status`, `terminal_reason`, `subtype`) and `system`/`api_retry`.\n- Capture a rate-limited fixture from a genuine limit (the 2026-09-22 `q7t0yb` patch-agent JSONL on the cron host has one; the human supplies it).\n- Correct the stale error fixture to the real field names.\n- Wire `jsonl:check` into a CI workflow against a **pinned** Claude CLI version (human chooses the pin and the bump policy).\n- Give the regression suite's Claude CLI stub a rate-limited response that emits a `rate_limit_event` with `resetsAt` and a `result` with `api_error_status: 429`, so later slices can drive pause/wait/resume hermetically.\n- Record which `api_retry` `error` value the CLI actually emits for overloaded (`overloaded` per docs vs `overloaded_error` in the parser). Do not change the parser here; report the finding on this issue.\n\nThis slice must not touch the stream parser or the probe module.\n\n## Acceptance criteria\n\n- [ ] `adws/jsonl/schema.json` covers `rate_limit_event`, `system`/`api_retry`, and the `result` error fields, with a fresh `probedAt`\n- [ ] A rate-limited fixture captured from a real limit lives under the JSONL fixtures and passes conformance\n- [ ] The error fixture uses `is_error` / `session_id` and passes conformance\n- [ ] A CI workflow runs `bun run jsonl:check` against a pinned CLI version and is green on this PR\n- [ ] The CLI stub can emit the rate-limited response on demand and the existing pause/resume smoke scenario still passes\n- [ ] A comment on this issue states the observed overloaded enum value (or that it could not be observed)\n- [ ] `bun run test`, `bun run test:unit`, and `bun run lint:git-guard` pass\n\n## Blocked by\n\nNone - can start immediately\n\n## Touched Files\n\n- adws/jsonl/schema.json\n- adws/jsonl/schemaProbe.ts\n- adws/jsonl/conformanceCheck.ts\n- adws/jsonl/fixtureUpdater.ts\n- adws/jsonl/fixtures/\n- .github/workflows/\n- package.json\n- test/mocks/claude-cli-stub.ts\n\n## User stories addressed\n\n- User story 36\n- User story 37\n- User story 38\n- User story 39\n- User story 41\n","state":"OPEN","author":"paysdoc","labels":["hitl","adw:feature"],"createdAt":"2026-09-25T08:25:24Z","comments":[],"actionableComment":null}`

## Feature Description

ADW reads the Claude CLI's `--output-format stream-json` envelope in three places: the stream parser (`adws/core/claudeStreamParser.ts`) that pauses a workflow on a `rate_limit_event` or a `system`/`api_retry`, the token-usage extractor (`adws/cost/providers/anthropic/extractor.ts`) that bills each run from `assistant` and `result` lines, and the pause-queue probe (`adws/triggers/rateLimitProbe.ts`) that decides when a paused workflow may resume. Anthropic will not publish a stable schema for this envelope (claude-code#53516), so the repo's own probed schema plus its conformance checker is the only contract ADW has.

That machinery exists (`bun run jsonl:probe` / `jsonl:check` / `jsonl:update`) but is dead. Verified at plan time on 2026-09-25:

- Nothing runs `jsonl:check`. Run by hand it fails on all four fixtures ("assistant message did not increment turnCount", "result message did not set lastResult") because the checker feeds each fixture line to `parseJsonlOutput` without a trailing newline, and the parser holds back a final segment that lacks `\n` instead of parsing it.
- `schema.json` (`probedAt` 2026-03-24) is a hand-trimmed snapshot keyed by bare `type`. Its `result` entry requires `isError`, `durationMs`, `durationApiMs`, `numTurns`, `sessionId`; the CLI emits `is_error`, `duration_ms`, `duration_api_ms`, `num_turns`, `session_id`. The `system` entry has the shape of `init`, so a `system`/`api_retry` line could never conform. There is no `rate_limit_event` entry and no `api_error_status` / `terminal_reason` on `result`.
- The probe spawns `claude --print --output-format stream-json 'say hello'` without `--verbose`; the current CLI (2.1.282 locally, equal to the latest npm release) rejects `stream-json` in print mode without `--verbose`. The probe also overwrites the whole schema file on every run, so any hand-added entry for an event a "say hello" run never produces (a rejected rate limit) would be lost on the next probe.
- The fixture updater's envelope allowlists carry the same stale camelCase names.
- The regression suite's CLI stub (`test/mocks/claude-cli-stub.ts`) can only answer with an `assistant` line and a `result` line whose envelope also uses `isError` / `sessionId`, and it has no way to simulate a rate limit.

This feature revives the machinery, extends the schema to the fields the parent PRD's pause path reads, adds fixtures captured from real CLI output (including a real five-hour session limit hit by the `q7t0yb` patch agent on 2026-09-22/23, whose output.jsonl is present on this host), and wires the check into a GitHub Actions workflow that installs a **pinned** Claude CLI version and proves, on every pull request, that (a) every fixture and the stub's envelopes conform to the committed schema and pass through ADW's parsers with the expected effect, and (b) once an API-key secret is configured, that the pinned CLI still emits every field ADW reads. The stub gains an on-demand rate-limited response (a `rate_limit_event` with `resetsAt`, then a `result` with `api_error_status: 429`) for later slices to drive pause/wait/resume hermetically. Finally, the observed `api_retry` `error` value for an overloaded API is recorded on the issue: the CLI emits `overloaded` (as documented); the parser matches `overloaded_error`, which never fires. The parser and the pause-queue probe are deliberately not changed in this slice.

## User Story
As an ADW maintainer
I want a CI gate that checks the Claude CLI's stream-json envelope, on a pinned CLI version, against the fields ADW reads, using fixtures captured from real runs including a real rate limit
So that a change in the CLI's output fails a pull request instead of silently stranding rate-limited workflows

## Problem Statement

The pause path the parent PRD builds (`rate_limit_event.rate_limit_info.status/resetsAt/rateLimitType`, `system`/`api_retry` `error`/`error_status`, and `result.is_error/api_error_status/terminal_reason`) depends on an undocumented envelope that Anthropic reserves the right to change. Today no test, no CI job and no fixture reflects what the CLI actually emits: the fixtures and schema use field names the CLI stopped emitting, the checker is broken in a way that hides that, and the schema does not even know the events the pause path keys on. A rename of `is_error`, `resetsAt` or the `api_retry` error enum would ship silently, exactly as the `overloaded` / `overloaded_error` mismatch already has. The hermetic regression suite cannot exercise the rate-limit path at all because its CLI stub cannot produce one.

## Solution Statement

Revive rather than replace, keeping the module's shape (`types.ts`, `schemaProbe.ts`, `conformanceCheck.ts`, `fixtureUpdater.ts`, `fixtures/`):

1. **Schema semantics.** `schema.json` is the contract of what ADW reads, validated against real CLI output. Entries are keyed `type` or `type/subtype` when the envelope carries a string `subtype` (`system/init`, `system/api_retry`, `result/success`, `result/error_during_execution`, `assistant`, `rate_limit_event`), plus one bare-`type` fallback, `result`, which requires the fields every result subtype carries (`type`, `subtype`, `is_error`, `session_id`, `uuid`). Lookup is `type/subtype` first, then bare `type`, else "no coverage (informational)". Without the `result` fallback, a `result` line that lost its `subtype` (one of the `result` error fields the issue names) would resolve to no entry and pass as "no coverage". With it, that line fails naming `subtype`, and a subtype that has no keyed entry (`error_max_turns`) is still checked against the common fields. `required: true` marks the fields ADW reads plus the envelope identity fields; `required: false` documents observed-but-unread fields so additive CLI changes never fail the gate. Presence, not value type, is enforced (a `null` counts as present: `api_error_status` is `null` on a healthy result, `parent_tool_use_id` is `null` on main-conversation messages).
2. **Two owners of schema entries.** *Probe-owned* entries (`system/init`, `assistant`, `result/success`) are what a one-turn `say hello` run deterministically produces; the probe reconciles them against the pinned CLI (preserving hand-set `required` flags, dropping fields the CLI no longer emits, adding new fields as optional) and stamps `probedAt` and `cliVersion`. *Capture-owned* entries (`rate_limit_event`, `system/api_retry`, `result/error_during_execution`) come from real captures the probe cannot trigger; the probe never touches them. The bare `result` fallback is written by hand, and the probe never touches it either: the CLI always emits a `subtype`, so the probe never observes a bare `result` key.
3. **Probe modes.** `bun run jsonl:probe` refreshes the probe-owned entries (writes `schema.json`). New `bun run jsonl:probe:check` runs the same live probe read-only and fails when a probe-owned type is missing from the live output or lacks a required field. It never fails on new fields. This is the CI's live leg.
4. **Checker.** Fix the trailing-newline bug, accept multi-line fixtures (a whole session excerpt per file), resolve the schema entry per line, and report each missing or unknown field with the line and schema key it belongs to. Assert parser behaviour per event type present: `assistant` → `turnCount`; any `result` line → `lastResult`; `rate_limit_event` with `status: "rejected"` → `rateLimitRejected`; `system/api_retry` → parses without throwing, with no flag asserted because the enum alignment belongs to the detection slice. Assert extractor behaviour: `assistant` → a non-empty per-turn estimate read through `getEstimatedUsage()`; any `result` → finalized. The estimate is read through `getEstimatedUsage()` because a `result` in the same fixture switches `getCurrentUsage()` to that result's `modelUsage`, which is `{}` when the very first call is rejected (as in the stub's rate-limited response). Check the stub's envelope directory as well as `adws/jsonl/fixtures/`.
5. **Fixtures.** Real captures: the rate-limited session excerpt (`session-rate-limited.jsonl`, multi-line: `system/init` → `rate_limit_event` rejected → `assistant` limit text → `result` with `is_error: true`, `api_error_status: 429`, `terminal_reason: "api_error"`), `system-api-retry-overloaded.jsonl` (529, `error: "overloaded"`), `system-api-retry-rate-limit.jsonl` (429, `error: "rate_limit"`), the stale `result-error.jsonl` corrected to the real field names, a new `result-error-during-execution.jsonl` (a real `error_during_execution` result, which carries `errors` and no `result`), and a snake_case `result-success.jsonl`. The corrected `result-error.jsonl` is a real API-error result that keeps its `result` payload (`subtype: "success"`, `is_error: true`, `api_error_status: 500`, `result: "API Error: 500 …"`). The two `assistant` fixtures are backfilled with the fields now required.
6. **Updater.** Simplify to "add missing required fields with type defaults, per line; never delete, never overwrite", which is all a hand-maintained fixture ever needs and can never damage a real capture. It walks the same default directories as the checker, so the `bun run jsonl:update` hint in a failing report covers every fixture the gate checked.
7. **CI.** New `.github/workflows/envelope-conformance.yml`: install the pinned CLI (`CLAUDE_CLI_VERSION`, proposed `2.1.282`, the version installed on this host and the latest npm release; the human confirms the pin and the bump policy), assert `claude --version` matches, run `bun run jsonl:check`, then run `bun run jsonl:probe:check` when an `ANTHROPIC_API_KEY` secret is present and emit a workflow warning when it is not (the repo has no such secret today, so the PR is green and the live leg activates the moment the human adds it).
8. **Stub.** Correct the stub's envelopes to the real field names so they pass the same gate, and add an on-demand rate-limited response selected through the manifest (`"response": { "kind": "rate-limited", ... }`, which reaches the stub through the existing cwd marker-file path that production spawns use) or through `MOCK_RESPONSE=rate-limited` for direct spawns, with `resetsAt`, `rateLimitType` and an optional `limitedInvocations` count so the first N calls are rejected and the next succeeds (the shape the pause → wait → resume loop needs). `resetsAt` defaults to now + 300 s, so the rejected event always names a reset that has not yet passed, as a real one does. Each line of the response (`rate_limit_event`, the `assistant` limit message, the `result`) is built from a template under `test/fixtures/jsonl/envelopes/`, so the emitted response passes the same gate as the real capture it stands in for.
9. **Finding.** Post a comment on issue #909 with the observed overloaded value and its evidence.

## Relevant Files

Use these files to implement the feature:

- `adws/jsonl/types.ts` — `SchemaField`, `EnvelopeSchema`, `ConformanceResult`, `UpdateResult`. Gains `cliVersion?` on the schema, a `lineCount` on the result, and the `LiveDriftReport` type.
- `adws/jsonl/schema.json` — the contract. Rewritten with `type/subtype` keys, curated `required` flags, the three capture-owned entries, then reconciled and time-stamped by `bun run jsonl:probe` against the pinned CLI.
- `adws/jsonl/schemaProbe.ts` — the live probe. Args gain `--verbose --max-turns 1 --model haiku`; spawns in a throwaway temp cwd so the repo's `.claude/settings.json` hooks and CLAUDE.md are not loaded; gains merge-preserving refresh and the read-only `--check` mode; records `cliVersion` from `system/init.claude_code_version`; takes the schema path as an optional parameter so a test can point a refresh at a throwaway copy instead of the committed file. Keep under 300 lines by moving pure helpers into the two new modules below.
- `adws/jsonl/conformanceCheck.ts` — the checker. Trailing-newline fix, multi-line fixtures, per-line schema resolution, per-event parser assertions, multiple fixture directories.
- `adws/jsonl/fixtureUpdater.ts` — simplified to add-missing-required-fields per line, over the same default directories as the checker.
- `adws/jsonl/index.ts` — re-exports; add the new helpers and `LiveDriftReport`.
- `adws/jsonl/fixtures/README.md` — rewritten: keying, owners, provenance and redaction rules for captures, multi-line convention, the fixture table.
- `adws/jsonl/fixtures/assistant-text.jsonl`, `assistant-tool-use.jsonl` — backfilled with the required fields (`session_id`, `uuid`, `parent_tool_use_id`, `message.type`, `message.role`, `message.stop_reason`, `message.usage.output_tokens`).
- `adws/jsonl/fixtures/result-success.jsonl` — rewritten with the real snake_case shape (`is_error`, `api_error_status: null`, `terminal_reason: "completed"`, `duration_ms`, `duration_api_ms`, `num_turns`, `stop_reason`, `session_id`, `uuid`, `usage`, `modelUsage`, `permission_denials`).
- `adws/jsonl/fixtures/result-error.jsonl` — same file name (the acceptance criterion names "the error fixture"). Corrected to the real field names (`is_error`, `session_id`, `duration_ms`, `duration_api_ms`, `num_turns`) as a real API-error result that still carries a `result` payload, as the stale fixture did: `subtype: "success"`, `is_error: true`, `api_error_status: 500`, `terminal_reason`, `result: "API Error: 500 Internal server error. …"`. It must keep a `result` field because the per-issue scenarios rename fields in a copy of this fixture, run the updater over it, and assert that its `result` value survives. An `error_during_execution` result has no `result` field, so that shape gets its own fixture (see New Files).
- `package.json` — adds the `jsonl:probe:check` script.
- `test/mocks/claude-cli-stub.ts` — rate-limited response, response-mode resolution, invocation counter. Stays under 300 lines by keeping pure helpers in `test/mocks/stubResponse.ts`.
- `test/mocks/manifestInterpreter.ts` — optional `response` block in the manifest schema, validated and passed through in `ApplyManifestResult`.
- `test/mocks/__tests__/manifestInterpreter.test.ts` — extend for the `response` block.
- `test/fixtures/jsonl/envelopes/assistant-message.jsonl`, `result-message.jsonl`, `system-message.jsonl` — corrected to the real field names and brought under the conformance check.
- `test/fixtures/jsonl/manifests/rate-limit-pause-resume.json` — gains a `response` block (`limitedInvocations: 1`, with no fixed `resetsAt`, so the rejected event names a reset that has not yet passed) so the scenario's first agent call is rejected and the retry succeeds once its `When` step is cut over. The scenario is `pending` at that step today (cutover stub in `whenSteps.ts`) and must stay non-failing.
- `.github/workflows/git-cli-guard.yml`, `.github/workflows/regression.yml` — read-only precedents for checkout/setup-bun/`bun install` steps and `timeout-minutes`.
- `README.md` — the JSONL bullet (line 19) describes the revived gate; the directory tree gains the new files (`adws/jsonl/` block near line 700, `test/fixtures/jsonl/envelopes/` near line 966, `.github/workflows/` near line 919).
- `app_docs/feature-9gjajh-jsonl-schema.md` — owning doc for `adws/jsonl/**`; Responsibilities, Contracts and Gotchas must describe the new keying, owners, `--check` mode and multi-line fixtures.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — owning doc for `test/mocks/**`; document the stub's rate-limited response, the manifest `response` block, `MOCK_RESPONSE` / `MOCK_RATE_LIMIT_RESETS_AT` / `MOCK_RATE_LIMIT_TYPE`, and the `.adw-stub-invocations` counter file.
- `app_docs/feature-9gjajh-root-config.md` — owning doc for `.github/**` and `package.json`; list the new workflow and script.
- `.adw/conditional_docs.md` — the `adws/jsonl/**` entry's conditions should mention the CI envelope gate and the stub's rate-limited response lives under the regression-suite doc; no new `Owns:` globs are needed (`adws/jsonl/**`, `test/mocks/**`, `.github/**` already cover every new file; `test/fixtures/**` is unowned today and unowned files are not a docs-index violation).
- Read-only references (do not modify in this slice):
  - `adws/core/claudeStreamParser.ts` — `parseJsonlOutput`, `JsonlParserState`; note the trailing-`\n` buffering and that `overloadedErrorDetected` matches `error === 'overloaded_error'`.
  - `adws/triggers/rateLimitProbe.ts` — `classifyProbeResult`, `PROBE_ARGS` (`--print --verbose --output-format stream-json --model haiku --max-turns 1`); the stub test reuses the classifier read-only to prove the rate-limited response classifies as `limited`.
  - `adws/agents/agentProcessHandler.ts` — kills the agent on `rateLimitRejected || serverErrorDetected || overloadedErrorDetected`; reads `lastResult.isError` / `lastResult.sessionId` (stale names; a finding to report, not fix).
  - `adws/agents/claudeAgent.ts` — the agents' CLI args, mirrored by the probe.
  - `adws/cost/providers/anthropic/extractor.ts` — `AnthropicTokenUsageExtractor`; appends `\n` itself; finalizes on any `result`.
  - `adws/core/environment.ts` — `resolveClaudeCodePath()` (`CLAUDE_CODE_PATH` or `claude` on PATH), `getSafeSubprocessEnv()` (forwards `ANTHROPIC_API_KEY`, `PATH`, `HOME`; does not forward `CLAUDE_CODE_OAUTH_TOKEN` or any `MOCK_*` name). `dotenv.config()` is a no-op without a dotenv file; `bun run jsonl:check` was verified to run under `env -i PATH=… HOME=…`.
  - `adws/types/agentTypes.ts` — `ClaudeCodeResultMessage` still declares `isError` / `durationMs` / `sessionId`.
  - `features/regression/smoke/pause_resume_rate_limit.feature`, `features/regression/step_definitions/whenSteps.ts` — the smoke scenario and its pending cutover step.
  - `test/mocks/test-harness.ts`, `features/regression/support/hooks.ts` — how `CLAUDE_CODE_PATH` is pointed at the stub for `@regression`.
  - `adws/triggers/__tests__/rateLimitProbe.test.ts`, `test/mocks/__tests__/manifestInterpreter.test.ts` — test style precedents (temp dirs, injected results, no real CLI).
- Conditional docs to read (matched conditions in `.adw/conditional_docs.md`): `app_docs/feature-9gjajh-jsonl-schema.md`, `app_docs/feature-9gjajh-bdd-regression-suite.md`, `app_docs/feature-9gjajh-root-config.md`, `app_docs/feature-9gjajh-claude-stream-parser.md` (read-only parser), `app_docs/feature-9gjajh-claude-agents-core.md` (read-only agent handler), `app_docs/feature-9gjajh-takeover-and-coordination.md` (read-only `rateLimitProbe.ts`).
- Source captures on this host (read-only; outside the repo, never committed as-is):
  - `/Users/martin/projects/paysdoc/AI_Dev_Workflow/agents/q7t0yb-adw-switchover-to-pa/chore-orchestrator/patch-agent/output.jsonl` — 2,503 lines, four sessions. Session `5cfcc639-a6f3-4825-a97b-838bb8b98bc3` (CLI 2.1.278) is the real limit: line 1 is its `system/init`; lines 362–364 (1-based) are `rate_limit_event` (`status: "rejected"`, `resetsAt: 1790081400`, `rateLimitType: "five_hour"`), an `assistant` line whose text is `You've hit your session limit · resets 2:50pm (Europe/Amsterdam)`, and the `result` (`subtype: "success"`, `is_error: true`, `api_error_status: 429`, `terminal_reason: "api_error"`, same text in `result`).
  - `/Users/martin/projects/paysdoc/AI_Dev_Workflow/agents/qfsbjl-intake-leg-infinite/sdlc-orchestrator/scenario-agent/output.jsonl` (and others found with `grep -rl '"error":"overloaded"' agents --include=output.jsonl`) — real `system/api_retry` lines with `error: "overloaded"`, `error_status: 529`; `grep -rl '"error":"rate_limit"'` finds the 429 ones.
  - Any capture with `"subtype":"error_during_execution"` (e.g. `grep -rl '"subtype":"error_during_execution"' agents --include=output.jsonl | head -1`) — a real error result with `errors` and `terminal_reason: "aborted_streaming"` or `"aborted_tools"`. Source of `result-error-during-execution.jsonl`.
  - `/Users/martin/projects/paysdoc/AI_Dev_Workflow/agents/gb7bw3-safety-net-6-flask-9/sdlc-orchestrator/build-agent/output.jsonl` line 671 (1-based), found with `grep -rl '"api_error_status":500' agents --include=output.jsonl`. It is a real API-error result (`subtype: "success"`, `is_error: true`, `api_error_status: 500`, `terminal_reason: "completed"`, `result: "API Error: 500 Internal server error. …"`) and carries every field `result/success` requires. Source of the corrected `result-error.jsonl`.

### New Files

- `adws/jsonl/schemaFields.ts` — pure field helpers: `extractFieldSchema` (moved from the probe, with the opaque-object rule), `findMissingFields`, `findExtraFields` (moved from the checker), `schemaKeyFor(msg)`, `resolveSchemaFields(schema, msg)`.
- `adws/jsonl/schemaMerge.ts` — pure probe helpers: `PROBE_OWNED_TYPES`, `extractObservedSchema(lines)`, `mergeObservedSchema(committed, observed, now, cliVersion)`, `findLiveDrift(committed, observed)`.
- `adws/jsonl/__tests__/schemaFields.test.ts`, `adws/jsonl/__tests__/schemaMerge.test.ts`, `adws/jsonl/__tests__/conformanceCheck.test.ts`, `adws/jsonl/__tests__/fixtureUpdater.test.ts` — unit tests (vitest picks up `adws/**/__tests__/**/*.test.ts`).
- `adws/jsonl/fixtures/session-rate-limited.jsonl` — the multi-line real rate-limited session excerpt.
- `adws/jsonl/fixtures/system-api-retry-overloaded.jsonl`, `adws/jsonl/fixtures/system-api-retry-rate-limit.jsonl` — real single-line `api_retry` captures.
- `adws/jsonl/fixtures/result-error-during-execution.jsonl` — a real single-line `error_during_execution` result (`errors`, no `result`), backing the capture-owned `result/error_during_execution` entry.
- `test/mocks/stubResponse.ts` — pure stub helpers: `resolveResponseMode`, `buildRateLimitedLines`, `shouldRateLimit`.
- `test/mocks/__tests__/claude-cli-stub.test.ts` — spawns the stub and parses its output through the real parser and classifier.
- `test/fixtures/jsonl/envelopes/rate-limit-event-rejected.jsonl`, `test/fixtures/jsonl/envelopes/assistant-rate-limited.jsonl`, `test/fixtures/jsonl/envelopes/result-rate-limited.jsonl` — stub envelope templates for the three lines of the rate-limited response.
- `.github/workflows/envelope-conformance.yml` — the CI gate.

## Implementation Plan

### Phase 1: Foundation
Settle the schema semantics and extract the pure helpers before touching behaviour: `type/subtype` keying with fallback lookup, the opaque-object rule (`modelUsage` and `rate_limit_info.unifiedWindows` are recorded as `object` without nested fields because their keys are model ids and window names), the probe-owned / capture-owned split, and the two pure operations the probe needs (merge-preserving refresh, live-drift report). Write `schema.json` by hand from the real captures with curated `required` flags. Unit-test the helpers first; they are pure and cheap.

### Phase 2: Core Implementation
Revive the three tools on top of the helpers: the checker (newline fix, multi-line, per-event assertions, two fixture directories), the updater (add-only), and the probe (`--verbose`, temp cwd, merge refresh, `--check`, `cliVersion`). Build the fixture set from real captures with documented redactions, run `bun run jsonl:probe` once on this host against CLI 2.1.282 to reconcile the probe-owned entries and stamp `probedAt`, and get `bun run jsonl:check` green over both fixture directories.

### Phase 3: Integration
Wire the gate into CI with the pinned CLI, extend the regression stub with the rate-limited response and correct its envelopes, prove the `@regression` suite still has zero failures and the pause/resume smoke scenario is unchanged (pending at its cutover step), update the living docs and README, post the overloaded-enum finding on the issue, and run every validation command.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Types and pure schema helpers (`adws/jsonl/types.ts`, new `adws/jsonl/schemaFields.ts`)

- `types.ts`: add `cliVersion?: string` to `EnvelopeSchema` ("Claude CLI version the probe-owned entries were last reconciled against"); add `lineCount: number` to `ConformanceResult`; add
  ```ts
  export interface LiveDriftReport {
    /** Probe-owned types the live run did not produce at all. */
    unobservedTypes: string[];
    /** Dot-paths (prefixed with the schema key) of required fields absent from the live envelope. */
    missingRequired: string[];
    /** Dot-paths of live fields the schema does not know (informational). */
    newFields: string[];
    /** Every schema key seen in the live run, including capture-owned and unknown ones. */
    observedTypes: string[];
  }
  ```
- `schemaFields.ts`:
  - `export const OPAQUE_OBJECT_FIELDS: ReadonlySet<string> = new Set(['modelUsage', 'unifiedWindows'])` — objects whose keys are data (model ids, window names), never recursed into.
  - `export function schemaKeyFor(msg: Record<string, unknown>): string | null` — `null` when `type` is not a string; `${type}/${subtype}` when `subtype` is a string; else `type`.
  - `export function resolveSchemaFields(schema: EnvelopeSchema, msg): { key: string; fields: SchemaField[] } | null` — exact `type/subtype` key first, then bare `type`, else `null`.
  - Move `extractFieldSchema` here from `schemaProbe.ts` unchanged except: when a field name is in `OPAQUE_OBJECT_FIELDS`, record `type: 'object'` without `fields`. Keep the existing "all observed fields required" rule; it only applies to brand-new entries (see step 3).
  - Move `findMissingFields` and `findExtraFields` here from `conformanceCheck.ts` unchanged. Presence is the only check (`field.name in data`); a `null` value is present.
- `index.ts`: export the new helpers and `LiveDriftReport`; keep `extractFieldSchema` exported (now from `schemaFields`).
- Unit tests in `adws/jsonl/__tests__/schemaFields.test.ts`: `schemaKeyFor` (system/init, assistant, no type, non-string subtype), `resolveSchemaFields` (subtype hit, bare-type fallback for an unknown subtype and for a `result` with no `subtype`, miss), `extractFieldSchema` (nested object recursion, opaque `modelUsage` has no `fields`, `null` typed as `'null'`), `findMissingFields` (nested dot-path, optional absent is not missing, `null` present).

### 2. Hand-write the new `adws/jsonl/schema.json`

Rewrite the file completely. `probedAt` and `cliVersion` get placeholders that step 7 replaces by running the probe (never hand-type a timestamp). Keys and `required` flags:

- **`system/init`** (probe-owned). Required: `type`, `subtype`, `session_id`, `uuid`, `cwd`, `model`, `claude_code_version`, `permissionMode`, `apiKeySource`, `tools`, `mcp_servers`. Optional: `slash_commands`, `terminal_slash_commands`, `agents`, `skills`, `plugins`, `capabilities`, `output_style`, `analytics_disabled`, `product_feedback_disabled`, `messaging_socket_path`, `fast_mode_state`, `fast_mode_disabled_reason`. (Everything environment-dependent is optional: the CLI omits `plugin_errors`/`mcp_server_errors` when empty and `fast_mode_disabled_reason` when fast mode is on.)
- **`assistant`** (probe-owned). Required: `type`, `message` with nested required `id`, `type`, `role`, `model`, `content`, `stop_reason`, `usage` with nested required `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`; `parent_tool_use_id`, `session_id`, `uuid`. Optional: `request_id`, `message.stop_sequence`, `message.stop_details`, `message.context_management`, `message.diagnostics`, `message.usage.cache_creation`, `message.usage.service_tier`, `message.usage.inference_geo`.
- **`result/success`** (probe-owned; note the CLI reports an API error, including a rate limit, as `subtype: "success"` with `is_error: true` — the SDK's `SDKResultSuccess` type documents `api_error_status` and `terminal_reason` on this variant). Required: `type`, `subtype`, `is_error`, `api_error_status`, `terminal_reason`, `result`, `stop_reason`, `duration_ms`, `duration_api_ms`, `num_turns`, `total_cost_usd`, `usage` (nested required `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`), `modelUsage` (opaque object), `permission_denials`, `session_id`, `uuid`. Optional: `ttft_ms`, `ttft_stream_ms`, `time_to_request_ms`, `first_content_frame_ms`, `queued_turn_count`, `result_index`, `fast_mode_state`, `fast_mode_disabled_reason`, `subagent_stats`, `origin`.
- **`result/error_during_execution`** (capture-owned). Required: `type`, `subtype`, `is_error`, `errors` (array), `terminal_reason`, `stop_reason`, `duration_ms`, `duration_api_ms`, `num_turns`, `total_cost_usd`, `usage` (same four nested), `modelUsage` (opaque), `permission_denials`, `session_id`, `uuid`. Optional: `fast_mode_state`, `fast_mode_disabled_reason`.
- **`system/api_retry`** (capture-owned):
  ```json
  "system/api_retry": [
    { "name": "type", "required": true, "type": "string" },
    { "name": "subtype", "required": true, "type": "string" },
    { "name": "attempt", "required": true, "type": "number" },
    { "name": "max_retries", "required": true, "type": "number" },
    { "name": "retry_delay_ms", "required": true, "type": "number" },
    { "name": "error_status", "required": true, "type": "number" },
    { "name": "error", "required": true, "type": "string" },
    { "name": "no_response", "required": false, "type": "object" },
    { "name": "session_id", "required": true, "type": "string" },
    { "name": "uuid", "required": true, "type": "string" }
  ]
  ```
- **`rate_limit_event`** (capture-owned):
  ```json
  "rate_limit_event": [
    { "name": "type", "required": true, "type": "string" },
    { "name": "rate_limit_info", "required": true, "type": "object", "fields": [
      { "name": "status", "required": true, "type": "string" },
      { "name": "resetsAt", "required": true, "type": "number" },
      { "name": "rateLimitType", "required": true, "type": "string" },
      { "name": "utilization", "required": false, "type": "number" },
      { "name": "isUsingOverage", "required": false, "type": "boolean" },
      { "name": "overageStatus", "required": false, "type": "string" },
      { "name": "overageResetsAt", "required": false, "type": "number" },
      { "name": "overageDisabledReason", "required": false, "type": "string" },
      { "name": "overageInUse", "required": false, "type": "boolean" },
      { "name": "surpassedThreshold", "required": false, "type": "number" },
      { "name": "unifiedWindows", "required": false, "type": "object" }
    ]},
    { "name": "uuid", "required": true, "type": "string" },
    { "name": "session_id", "required": true, "type": "string" }
  ]
  ```
  (`resetsAt` and `rateLimitType` are optional in the SDK's `SDKRateLimitInfo` and one captured `allowed` event carried neither, but every rejected event ADW pauses on carries both and the pause path reads both; the fixtures are rejected events, and the probe never compares this entry.)
- **`result`** (bare-type fallback, written by hand; the probe never touches it). It replaces the old bare `result` entry. Required: `type`, `subtype`, `is_error`, `session_id`, `uuid`, the fields every result subtype carries. Optional: `api_error_status`, `terminal_reason`, `result`, `errors`, `stop_reason`, `duration_ms`, `duration_api_ms`, `num_turns`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, all without nested `fields`. A `result` line whose `subtype` is missing resolves here and fails naming `subtype`; a per-issue drift row removes `subtype` from the real capture's `result` and expects exactly that failure. A result subtype with no keyed entry (`error_max_turns`) is checked against these common fields.
- Remove the old bare `system` entry. Keep field `type` values honest to the captures (`api_error_status` is `null` in a healthy `result/success`, so its type there is `"null"`; type is informational).

### 3. Pure probe helpers (new `adws/jsonl/schemaMerge.ts`)

- `export const PROBE_OWNED_TYPES: readonly string[] = ['system/init', 'assistant', 'result/success']`.
- `export function extractObservedSchema(lines: readonly string[]): Record<string, SchemaField[]>` — parse each line, skip non-objects and lines without a string `type`, key with `schemaKeyFor`, first occurrence wins, fields via `extractFieldSchema`.
- `export function mergeObservedSchema(committed: EnvelopeSchema, observed: Record<string, SchemaField[]>, probedAt: string, cliVersion: string | undefined): EnvelopeSchema` — immutable; for each probe-owned key present in `observed`:
  - not in `committed` → take the observed fields as-is (all required, the existing first-probe rule);
  - in `committed` → keep every committed field that is still observed, with its committed `required` flag and its committed nested `fields` merged the same way; drop committed fields absent from the live envelope; append observed fields the committed entry lacks as `required: false`.
  Every other committed key (capture-owned or otherwise) is copied untouched. Observed keys that are not probe-owned are not written. Sets `probedAt` and `cliVersion`.
- `export function findLiveDrift(committed: EnvelopeSchema, observed: Record<string, SchemaField[]>): LiveDriftReport` — for each probe-owned key: absent from `observed` → `unobservedTypes`; else compare presence over the observed field tree (a required committed field, at any depth, with no observed counterpart → `missingRequired` as `key.dot.path`); observed fields with no committed counterpart → `newFields`. `observedTypes` lists every observed key.
- Unit tests in `adws/jsonl/__tests__/schemaMerge.test.ts`: new type all-required; existing type preserves `required: false` and drops vanished fields and appends new optional fields; nested merge under `message.usage`; capture-owned entry untouched even when observed live (an `allowed` `rate_limit_event` must not rewrite the committed rejected shape); the bare `result` fallback copied untouched; non-owned observed types not written; `findLiveDrift` reports a renamed required field (`is_error` → `isError`), reports an unobserved owned type, lists an added field as new only, ignores an absent optional field.

### 4. Revive the conformance checker (`adws/jsonl/conformanceCheck.ts`)

- Fixture reading: `readFixtureLines(path)` → non-empty trimmed lines. A fixture is a JSON object per line; one or many lines.
- Per line: parse (a parse error fails the fixture with the 1-based line number in `parseError`), `resolveSchemaFields`; unknown key → push `line N: type "<key>" has no schema coverage (informational)` into `extraFields`; known key → `findMissingFields`/`findExtraFields`. When the fixture has more than one line, prefix each result with `line N (<resolved key>): `, for example `line 4 (result/success): is_error`, so the report names the message a field is missing from.
- Parser check, once per fixture: build a fresh `JsonlParserState` (same literal as today), call `parseJsonlOutput(lines.join('\n') + '\n', state)` — the trailing newline is the bug fix; then assert from the keys present in the fixture:
  - any `assistant` line → `state.turnCount` equals the number of assistant lines;
  - any `result` line (any subtype, or none) → `state.lastResult !== null`;
  - any `rate_limit_event` line whose `rate_limit_info.status === 'rejected'` → `state.rateLimitRejected === true`;
  - any `system/api_retry` line → no assertion beyond "did not throw" (the enum alignment is the detection slice's job; asserting `overloadedErrorDetected` here would fail on the real `overloaded` capture and would couple this slice to the parser).
- Extractor check, once per fixture: `extractor.onChunk(lines.join('\n') + '\n')`; any `assistant` → non-empty `getEstimatedUsage()`; any `result` line → `isFinalized()`. Use `getEstimatedUsage()`, not `getCurrentUsage()`. Once a `result` line finalizes the extractor, `getCurrentUsage()` returns that result's `modelUsage`, and that is `{}` when the very first call is rejected (the stub's rate-limited response, or a probe run during an active limit). `getEstimatedUsage()` keeps the per-turn estimate that the `assistant` lines produced.
- `checkConformance(schemaPath = DEFAULT_SCHEMA_PATH, fixturesDirs: string | readonly string[] = DEFAULT_FIXTURE_DIRS)` where `DEFAULT_FIXTURE_DIRS = [adws/jsonl/fixtures, test/fixtures/jsonl/envelopes]` (resolve the second as `path.join(__dirname, '..', '..', 'test', 'fixtures', 'jsonl', 'envelopes')`). Results keep `fixturePath` relative to `process.cwd()`; add `lineCount`.
- `formatConformanceReport` unchanged in spirit; keep the `jsonl:update` hint.
- Keep the file under 300 lines (moving the two field helpers out in step 1 pays for the multi-line logic); extract `runParserCheck(lines, keys)` and `runExtractorCheck(lines, keys)` as named functions, no nesting beyond two levels.
- Unit tests in `adws/jsonl/__tests__/conformanceCheck.test.ts` using temp dirs (`mkdtempSync(join(tmpdir(), 'jsonl-check-'))`) with a minimal schema: a single-line fixture with no trailing newline passes the parser check (regression for the baseline bug); a multi-line fixture (`system/init`, rejected `rate_limit_event`, `assistant`, `result/success`) passes, and a variant whose `rate_limit_event` has `status: "rejected"` but is fed through a parser state that fails to set the flag is not needed — instead assert that a fixture with `status: "allowed"` passes without the flag and a rejected one requires it; a fixture missing a required nested field fails with `message.usage.output_tokens`; an unknown subtype falls back to the bare `type` entry; a `result` line with its `subtype` removed fails with `subtype` missing; a multi-line fixture whose `result` carries `modelUsage: {}` after an `assistant` line passes the extractor check; an unknown type passes informationally; a second fixture directory is included; and one test runs `checkConformance()` with defaults and expects every real fixture and stub envelope to pass (this is the test that pins the repository's fixtures to the schema in `bun run test:unit`).

### 5. Simplify the fixture updater (`adws/jsonl/fixtureUpdater.ts`)

- New behaviour: for every line of every fixture whose schema entry resolves, add each missing **required** field (recursively for object fields with nested `fields`) with the type default (`''`, `0`, `false`, `{}`, `[]`, `null`); never delete a field, never overwrite a value. Lines with no schema entry are reported as skipped. Rewrite the file only when something changed, one JSON object per line plus a trailing newline.
- Delete `ENVELOPE_FIELDS`, `ASSISTANT_MESSAGE_ENVELOPE_FIELDS`, `mergeResultEnvelope`, `mergeUsageEnvelope`, `mergeAssistantEnvelope`. Keep `UpdateResult`, the CLI entry point and the exported `updateFixtureEnvelopes(schemaPath = DEFAULT_SCHEMA_PATH, fixturesDirs: string | readonly string[] = DEFAULT_FIXTURE_DIRS)`; the per-issue scenarios call it on a throwaway directory. Share `DEFAULT_FIXTURE_DIRS` with the checker so the report's `jsonl:update` hint also covers the stub envelopes.
- Unit tests in `adws/jsonl/__tests__/fixtureUpdater.test.ts`: adds a missing top-level and a missing nested required field (a `result` with `session_id` removed gets it back and keeps its `result` value); leaves optional fields absent; never removes an unknown field; never overwrites an existing value; multi-line fixture updated per line; no-change fixture is not rewritten (compare content and mtime).

### 6. Revive the probe (`adws/jsonl/schemaProbe.ts`, `package.json`)

- CLI args: `['--print', '--verbose', '--output-format', 'stream-json', '--max-turns', '1', '--model', 'haiku', 'say hello']` (the same output mode `claudeAgent.ts` and `rateLimitProbe.ts` use; `--verbose` is mandatory for stream-json in print mode on the current CLI).
- Spawn with `cwd` set to a fresh `mkdtempSync(join(tmpdir(), 'adw-jsonl-probe-'))` (removed in `finally`) so the repo's `.claude/settings.json` hooks, CLAUDE.md and project memory are never loaded into the probe; `env: getSafeSubprocessEnv()` (already forwards `ANTHROPIC_API_KEY`, `PATH`, `HOME`); `stdio: ['ignore', 'pipe', 'pipe']`.
- Read the committed schema first (throw a clear error if missing — the probe now reconciles, it does not bootstrap from nothing).
- `--check` mode (`process.argv.includes('--check')`): run the probe, `extractObservedSchema`, `findLiveDrift`, print a report (observed types; new fields as informational; missing required and unobserved owned types as failures), exit 1 on any failure, never write. Also print `cliVersion` observed vs committed and warn (not fail) when they differ.
- Refresh mode (default): `mergeObservedSchema(committed, observed, new Date().toISOString(), observedCliVersion)`, write `schema.json` with two-space indent and trailing newline, print which probe-owned entries changed, exit 1 when a probe-owned type was not observed (a run that hits a rate limit produces only a rejected `rate_limit_event` and an error result; say so in the message and tell the operator to retry after the reset).
- `observedCliVersion` = `claude_code_version` from the observed `system/init` line when it is a string.
- `package.json`: add `"jsonl:probe:check": "bunx tsx adws/jsonl/schemaProbe.ts --check"`. Leave the other three scripts as they are.
- Keep `probeClaudeJsonlSchema(schemaPath = SCHEMA_PATH)` exported (it now returns the merged schema and writes it to `schemaPath`) and add `checkClaudeJsonlSchema(schemaPath = SCHEMA_PATH): Promise<LiveDriftReport>`. Both are thin shells over `runProbe` plus the pure helpers. One per-issue scenario points `CLAUDE_CODE_PATH` at a throwaway CLI script; the optional path lets it refresh a throwaway copy of the schema instead of the committed file. Keep resolving the CLI through `resolveClaudeCodePath()`, which that scenario relies on. Because the probe runs in a temp cwd, such a script must record its argv to an absolute path, not to its cwd.
- No unit test spawns the real CLI; the shells are covered by the pure-helper tests plus the validation commands below.

### 7. Build the fixture set from real captures (`adws/jsonl/fixtures/`)

Redaction rules for every capture (apply consistently, document them in the fixtures README): replace `cwd` with `/redacted/worktree` and `messaging_socket_path` with `/redacted/cc.sock`; trim `tools`, `mcp_servers`, `slash_commands`, `terminal_slash_commands`, `agents`, `skills`, `plugins`, `capabilities`, `permission_denials`, `usage.iterations` and `errors` entries to `[]` or to a single short placeholder string; keep every key; keep `session_id` and `uuid` values (random ids that tie a session's lines together); keep numeric fields as captured; keep the limit text verbatim. Never hand-write a capture-owned fixture from memory; if the source file is not present at build time, stop and ask for it.

- `session-rate-limited.jsonl` (new, multi-line, 4 lines): from `agents/q7t0yb-adw-switchover-to-pa/chore-orchestrator/patch-agent/output.jsonl`, session `5cfcc639-a6f3-4825-a97b-838bb8b98bc3`: line 1 (`system/init`, `claude_code_version` `2.1.278`), then lines 362, 363, 364 (`rate_limit_event` rejected, `assistant` limit text, `result` with `is_error: true`, `api_error_status: 429`, `terminal_reason: "api_error"`). The rejected event, verbatim from the capture:
  ```json
  {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790081400,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":1,"resetsAt":1790081400},"seven_day":{"utilization":0.08,"resetsAt":1790676000},"seven_day_overage_included":{"utilization":0.14,"resetsAt":1790676000}}},"uuid":"cf04fb5e-136e-47d3-9172-acb37a76cbc8","session_id":"5cfcc639-a6f3-4825-a97b-838bb8b98bc3"}
  ```
  Extract the lines with a small script (for example `sed -n '1p;362,364p'`) and apply the redactions with a JSON-aware transform (bun script), not by hand-editing inside long lines.
- `system-api-retry-overloaded.jsonl` (new): one real line with `"error":"overloaded"`, `"error_status":529` (shape: `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error`, `session_id`, `uuid`).
- `system-api-retry-rate-limit.jsonl` (new): one real line with `"error":"rate_limit"`, `"error_status":429`.
- `result-error.jsonl` (correct to the real field names, keep name): one real API-error result line, line 671 of `agents/gb7bw3-safety-net-6-flask-9/sdlc-orchestrator/build-agent/output.jsonl` (`subtype: "success"`, `is_error: true`, `api_error_status: 500`, `terminal_reason`, `result: "API Error: 500 Internal server error. …"`), redacted. It keeps a `result` payload, as the stale fixture had; the per-issue updater scenario asserts that this payload survives `jsonl:update`.
- `result-error-during-execution.jsonl` (new): one real `error_during_execution` line (`is_error: true`, `errors`, `terminal_reason`, no `result`), redacted.
- `result-success.jsonl` (replace content): a real short `result/success` line (`is_error: false`, `api_error_status: null`, `terminal_reason: "completed"`), redacted; keep `modelUsage` with one model entry so the extractor finalizes with usage.
- `assistant-text.jsonl`, `assistant-tool-use.jsonl`: keep the hand-maintained payloads; run `bun run jsonl:update` to backfill the newly required envelope fields, then hand-set realistic values (`parent_tool_use_id: null`, `message.type: "message"`, `message.role: "assistant"`, `message.stop_reason: "end_turn"`, a `session_id`/`uuid`).
- Run `bun run jsonl:probe` once on this host (CLI 2.1.282, the operator's session). It reconciles the three probe-owned entries and stamps `probedAt` / `cliVersion`. Review `git diff adws/jsonl/schema.json`: only probe-owned entries may change, only by dropped-vanished / added-optional fields and the two stamps. If the run reports a rejected rate limit, wait for the reset and rerun; do not hand-edit the stamps.
- `bun run jsonl:check` must now pass for every fixture in both directories (the stub envelopes are fixed in step 8; run the check again after step 8).
- Rewrite `adws/jsonl/fixtures/README.md`: keying and lookup order; probe-owned vs capture-owned entries and what each script may change; the redaction rules; the multi-line convention; the fixture table (file, key(s), provenance: source capture, session id, capture date, CLI version); the updater's add-only semantics; the workflow section listing all four scripts.

### 8. The regression CLI stub: real envelopes and a rate-limited response (`test/mocks/`, `test/fixtures/jsonl/`)

- Correct the existing envelope templates so they pass `jsonl:check`:
  - `result-message.jsonl`: `is_error: false`, `api_error_status: null`, `terminal_reason: "completed"`, `duration_ms`, `duration_api_ms`, `num_turns`, `stop_reason: "end_turn"`, `session_id: "stub-session-001"`, `uuid`, `usage` (four fields), `permission_denials: []`, keep `total_cost_usd` and `modelUsage`. Drop `isError`, `durationMs`, `durationApiMs`, `numTurns`, `sessionId`. (Nothing in `features/` or `test/` reads the old names; `agentProcessHandler` reads `lastResult.isError`, which was `false` and is now `undefined`, so `success` stays `true`.)
  - `assistant-message.jsonl`: add `parent_tool_use_id: null`, `session_id`, `uuid`, `message.usage.output_tokens`.
  - `system-message.jsonl`: add `cwd`, `session_id`, `uuid`, `claude_code_version` (this template is not streamed by the stub today; it is kept conformant so the envelopes directory is a valid fixture set).
- New templates:
  - `rate-limit-event-rejected.jsonl`: the captured rejected event above, with `session_id`/`uuid` set to stub ids and `unifiedWindows` dropped.
  - `assistant-rate-limited.jsonl`: the captured synthetic limit message (line 363 of the q7t0yb capture) with stub ids. It has `message.model: "<synthetic>"`, `message.type: "message"`, `message.role: "assistant"`, `message.stop_reason: "stop_sequence"`, the four `message.usage` token fields at 0, `parent_tool_use_id: null`, and as `content` one text block reading `You've hit your session limit · resets 2:50pm (Europe/Amsterdam)`.
  - `result-rate-limited.jsonl`: `subtype: "success"`, `is_error: true`, `api_error_status: 429`, `terminal_reason: "api_error"`, `result` and the `assistant` text `You've hit your session limit · resets 2:50pm (Europe/Amsterdam)`, `stop_reason: "stop_sequence"`, `usage` with the four required token fields at 0, `modelUsage: {}`, `permission_denials: []`, `total_cost_usd: 0`, `num_turns: 1`, durations, `session_id`, `uuid`).
- `manifestInterpreter.ts`: extend `Manifest` with an optional `response?: ManifestResponse` where
  ```ts
  interface ManifestResponse {
    kind: 'rate-limited';
    /** Epoch seconds; defaults to now + 300 when absent. */
    resetsAt?: number;
    /** Defaults to 'five_hour'. */
    rateLimitType?: string;
    /** Reject only the first N invocations counted per worktree; absent means every invocation. */
    limitedInvocations?: number;
  }
  ```
  Validate it in `isManifest` (unknown `kind` or non-numeric numbers → the existing `manifestInterpreter: malformed manifest` error) and pass it through as `ApplyManifestResult.response`.
- New `test/mocks/stubResponse.ts` (pure): `resolveResponseMode(manifestResponse, env)` → `{ kind: 'default' } | { kind: 'rate-limited'; resetsAt: number; rateLimitType: string; limitedInvocations?: number }` with precedence manifest → `MOCK_RESPONSE=rate-limited` (+ `MOCK_RATE_LIMIT_RESETS_AT`, `MOCK_RATE_LIMIT_TYPE`) → default; `buildRateLimitedLines({ event, assistant, result }, opts)` → the three JSON strings built from the three templates (`rate_limit_event` with `resetsAt`/`rateLimitType` applied, the `assistant` limit message, the `result` line) mirroring the real sequence; `shouldRateLimit(mode, invocationCount)`.
- `claude-cli-stub.ts`: after `recordInvocation`, resolve the manifest (existing path), resolve the response mode; when `limitedInvocations` is set, read-increment-write the counter file `<cwd>/.adw-stub-invocations` (best-effort; missing or corrupt file counts as 0); when rate-limited, stream the three lines and `process.exit(1)` (the real CLI exits non-zero on an error result; `agentProcessHandler` kills the agent on the event anyway); otherwise the existing behaviour is unchanged. Keep the top-of-file env-var comment current.
- `test/fixtures/jsonl/manifests/rate-limit-pause-resume.json`: add `"response": { "kind": "rate-limited", "rateLimitType": "five_hour", "limitedInvocations": 1 }`. Leave `resetsAt` out. The capture's `1790081400` is already in the past (2026-09-23), and a rejected event whose reset has passed gives the pause → wait → resume loop nothing to wait for. The default (now + 300 s) names a reset that has not yet passed.
- Unit tests in `test/mocks/__tests__/claude-cli-stub.test.ts` (spawn with `spawnSync('bun', [stubPath, '--print', '--verbose', '--output-format', 'stream-json', 'ping'], { env: {...process.env, MOCK_STREAM_DELAY_MS: '0', ...} })`): `MOCK_RESPONSE=rate-limited` → exit status 1, three JSON lines, `parseJsonlOutput` over stdout sets `rateLimitRejected` and a `lastResult` whose `is_error` is `true` and `api_error_status` is `429`, and `classifyProbeResult` from `adws/triggers/rateLimitProbe.ts` (read-only import) returns `'limited'`; with no override, `rate_limit_info.resetsAt` is later than `Date.now() / 1000` (epoch seconds, the unit the real capture uses); that stdout, written to a temp dir as one `.jsonl` fixture, passes `checkConformance(<committed schema>, tmpDir)`; `MOCK_RATE_LIMIT_RESETS_AT=1790081400` is echoed in `rate_limit_info.resetsAt`; a temp cwd holding `.adw-stub-manifest.json` with `limitedInvocations: 1` → first spawn rejected, second spawn exits 0 with a normal `result`; no env and no manifest → unchanged default output; `resolveResponseMode` precedence and defaults (pure). Extend `manifestInterpreter.test.ts` with a valid `response` block passing through and a malformed one throwing.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: baseline at plan time is 53 scenarios, 11 passed, 42 pending, 0 failed; the pause/resume smoke scenario is pending at its `When` step. The result must still show 0 failed and the smoke scenario unchanged.

### 9. CI workflow (`.github/workflows/envelope-conformance.yml`)

Create:

```yaml
name: Stream-json Envelope Conformance

on:
  pull_request:
  push:
    branches: [dev, main]
  workflow_dispatch:

env:
  # The Claude CLI version adws/jsonl/schema.json was reconciled against (see schema.json cliVersion).
  # Bump policy (owner: repo maintainer): bump deliberately, in its own PR, after running
  # `bun run jsonl:probe` locally with the same version and committing the resulting schema.json.
  # A bump PR whose live check fails is the gate doing its job: ADW reads a field that changed.
  CLAUDE_CLI_VERSION: '2.1.282'

jobs:
  envelope-conformance:
    name: Fixtures and parsers conform to the envelope of the pinned Claude CLI
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      HAS_ANTHROPIC_KEY: ${{ secrets.ANTHROPIC_API_KEY != '' }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2

      - name: Set up Node (the Claude CLI npm package requires Node 22)
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: bun install

      - name: Install the pinned Claude CLI
        run: npm install -g "@anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}"

      - name: Assert the installed CLI is the pinned version
        run: claude --version | grep -F "${CLAUDE_CLI_VERSION}"

      - name: Fixtures and stub envelopes conform to the committed schema and parsers
        run: bun run jsonl:check

      - name: Live envelope check against the pinned CLI
        if: env.HAS_ANTHROPIC_KEY == 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: bun run jsonl:probe:check

      - name: Live envelope check skipped
        if: env.HAS_ANTHROPIC_KEY != 'true'
        run: echo "::warning title=Envelope conformance::ANTHROPIC_API_KEY secret is not set, so the live probe of Claude CLI ${CLAUDE_CLI_VERSION} was skipped. Only the committed schema, fixtures and parsers were checked."
```

- The pin value and the bump policy text are proposals for the human to confirm (the issue is `hitl`); leave both in this one place so a bump is a one-line change plus a re-probe.
- Do not add the job to `git-cli-guard.yml`; a separate workflow keeps the CLI install and the secret out of the credential-free guard job.

### 10. Living docs and README

- `README.md`: rewrite the line-19 JSONL bullet to describe the revived gate (`type/subtype` keying, probe-owned vs capture-owned entries, `jsonl:probe:check`, the CI workflow and pin, the stub envelopes under the same check); add the new files to the directory tree (`adws/jsonl/` block: `schemaFields.ts`, `schemaMerge.ts`, `__tests__/`, the four new fixtures; `test/fixtures/jsonl/envelopes/` block: the three new templates; `test/mocks/`: `stubResponse.ts` and the new test; `.github/workflows/`: `envelope-conformance.yml`).
- `app_docs/feature-9gjajh-jsonl-schema.md`: update Overview, Responsibilities (the two new modules, `--check`, multi-line fixtures, two fixture directories), Contracts & Invariants (keying and lookup order, the bare `result` fallback, presence-only checks, probe-owned vs capture-owned, the merge rules, `required` means "ADW reads it"), Configuration (`jsonl:probe:check`, `ANTHROPIC_API_KEY` in CI, temp cwd), Gotchas (the trailing-newline history, a probe run during an active limit fails with a clear message, `rate_limit_event` is a subscription-only event the API-key CI probe never sees, `result/success` carries API errors with `is_error: true`).
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: the stub's rate-limited response, manifest `response` block, `MOCK_RESPONSE` / `MOCK_RATE_LIMIT_RESETS_AT` / `MOCK_RATE_LIMIT_TYPE`, the `.adw-stub-invocations` counter file, and that `test/fixtures/jsonl/envelopes/` is checked by `bun run jsonl:check`.
- `app_docs/feature-9gjajh-root-config.md`: the new workflow, the `jsonl:probe:check` script, the pin location.
- `.adw/conditional_docs.md`: extend the `adws/jsonl/**` entry's Conditions with "When working on the CI envelope conformance gate (`.github/workflows/envelope-conformance.yml`, the pinned Claude CLI version, or `bun run jsonl:probe:check`)" and the regression-suite entry's Conditions with the stub's rate-limited response. Do not add `Owns:` globs. Run `bun run lint:docs-index`.
- Comments in code follow `.adw/coding_guidelines.md`: explain invariants and non-obvious choices only (why the newline is appended, why `modelUsage` is opaque, why the probe uses a temp cwd, why `api_retry` asserts no parser flag), no issue numbers, no name-echoing JSDoc.

### 11. Report the overloaded enum finding on issue #909

After the validation commands pass, post one comment (`gh issue comment 909 --repo paysdoc/AI_Dev_Workflow --body-file <tmp file>`) with this content, adjusting only the counts if the captures on the host differ:

> **Finding: `api_retry` overloaded enum value**
>
> Observed value: the Claude CLI emits `"error":"overloaded"` with `"error_status":529` for an overloaded API retry. Evidence: 30 `system`/`api_retry` lines across captured agent runs on the cron host (files dated 2026-06-12 to 2026-07-08, e.g. `agents/qfsbjl-intake-leg-infinite/sdlc-orchestrator/scenario-agent/output.jsonl`). No capture contains `overloaded_error` (3,165 `output.jsonl` files scanned). Other values observed: `rate_limit` (`error_status` 429, once 529), `server_error` (503), `unknown` (`error_status: null`).
>
> Documented enum (code.claude.com/docs/en/headless, "Handle API retries"; Agent SDK type `SDKAssistantMessageError`): `authentication_failed | oauth_org_not_allowed | account_on_hold | verification_required | billing_error | rate_limit | overloaded | invalid_request | model_not_found | server_error | unknown | max_output_tokens | cloud_credential_error`.
>
> Consequence: `adws/core/claudeStreamParser.ts` matches `error === 'overloaded_error'`, so `overloadedErrorDetected` never fires on real output; an overload is caught only by the `attempt >= 2` server-error branch. Not changed in this slice (parser out of scope); the detection slice should match `overloaded` and `error_status === 529`. A real `overloaded` capture now lives at `adws/jsonl/fixtures/system-api-retry-overloaded.jsonl` under the conformance gate.
>
> Related stale names, also left for the detection slice: `ClaudeCodeResultMessage` (`adws/types/agentTypes.ts`) and `agentProcessHandler.ts` read `isError` / `sessionId` from the result envelope; the CLI emits `is_error` / `session_id`, so both reads are always `undefined` today.

### 12. Run the validation commands

- Execute every command in `Validation Commands` below; all must succeed. Record the `@regression` totals and the smoke scenario's status in the PR body.

## Testing Strategy

### Unit Tests
`.adw/project.md` has `## Unit Tests: enabled`; the PRD asks for unit tests on pure modules only, with behaviour observed through outputs, not internals.

- `adws/jsonl/__tests__/schemaFields.test.ts` — keying, lookup fallback, opaque objects, presence-only missing-field detection, `null` present.
- `adws/jsonl/__tests__/schemaMerge.test.ts` — first-probe all-required, flag-preserving merge, vanished/added fields, nested merge, capture-owned untouched, non-owned not written, drift report for a rename / an unobserved type / an added field / an absent optional field.
- `adws/jsonl/__tests__/conformanceCheck.test.ts` — temp-dir schema and fixtures: newline regression, multi-line session fixture, rejected event requires `rateLimitRejected`, missing nested required field named by dot-path, unknown subtype fallback, `result` without `subtype` fails naming `subtype`, `modelUsage: {}` result after an `assistant` passes the extractor check, unknown type informational, multiple directories, and the real-fixtures smoke (`checkConformance()` with defaults passes).
- `adws/jsonl/__tests__/fixtureUpdater.test.ts` — add-only semantics per line (restoring `session_id` keeps the `result` payload), no delete, no overwrite, no rewrite when unchanged.
- `test/mocks/__tests__/claude-cli-stub.test.ts` — spawns the stub: rate-limited via env, via manifest marker with `limitedInvocations`, a default `resetsAt` that has not yet passed, `resetsAt` override, the emitted response passing `checkConformance`, default unchanged; output verified through `parseJsonlOutput` and `classifyProbeResult`.
- `test/mocks/__tests__/manifestInterpreter.test.ts` — `response` block validation and pass-through.

### Edge Cases
- A fixture line with no trailing newline (the baseline bug) and a fixture with blank lines between JSON lines.
- `api_error_status: null` and `parent_tool_use_id: null` count as present; a missing key does not.
- A `result` with an unknown subtype (`error_max_turns`) falls back to the bare `result` entry and passes when it carries the common fields (`type`, `subtype`, `is_error`, `session_id`, `uuid`). A `result` whose `subtype` is missing falls back to the same entry and fails naming `subtype`.
- A rate-limited first call: the `result` carries `modelUsage: {}`. The extractor check still passes because it reads the per-turn estimate (`getEstimatedUsage()`), not the finalized `modelUsage`.
- The live probe is run during an active rate limit: refresh mode exits 1 with a clear message and writes nothing; `--check` reports `unobservedTypes` for all three probe-owned types.
- The live probe (OAuth on the host) emits an `allowed` `rate_limit_event`: it is listed in `observedTypes` only; the committed rejected shape is never overwritten or compared.
- `modelUsage` keys are model ids and vary by run; they never enter the schema.
- The CLI adds a field: `--check` lists it as new and exits 0; refresh appends it as optional. The CLI renames or drops a required field: `--check` exits 1 naming `result/success.is_error` style paths.
- `claude --version` does not match the pin in CI: the job fails before any check runs.
- `ANTHROPIC_API_KEY` secret absent: the live step is skipped with a workflow warning; the job is green.
- The stub's counter file is missing, unreadable or corrupt: treated as 0 (first call rejected); `limitedInvocations` absent: every call rejected; `MOCK_RESPONSE` set to an unknown value: default response.
- `jsonl:update` run against a capture-owned fixture: never deletes or rewrites captured values.
- `bun run jsonl:check` in a bare environment without a dotenv file (CI): runs, because nothing in the checker's import graph requires environment values at load time (verified at plan time with `env -i`).

## Acceptance Criteria
- `adws/jsonl/schema.json` is keyed `type` / `type/subtype`, contains `rate_limit_event` (with `rate_limit_info.status/resetsAt/rateLimitType` required), `system/api_retry`, `result/success` with `is_error`, `api_error_status`, `terminal_reason`, `subtype` required, `result/error_during_execution`, and the bare `result` fallback requiring `type`, `subtype`, `is_error`, `session_id`, `uuid`; `probedAt` and `cliVersion` were written by `bun run jsonl:probe` against CLI 2.1.282 on this host (no hand-typed timestamp).
- `adws/jsonl/fixtures/session-rate-limited.jsonl` is derived from the `q7t0yb` patch-agent capture (provenance in the fixtures README), keeps every key of the four lines, and passes `bun run jsonl:check`, including the parser assertion that the rejected event sets `rateLimitRejected`.
- `adws/jsonl/fixtures/result-error.jsonl` uses `is_error` and `session_id`, is a real API-error result that keeps its `result` payload, and passes conformance; `result-error-during-execution.jsonl` carries a real `error_during_execution` shape and passes conformance; `result-success.jsonl` uses the snake_case names; no fixture or stub envelope contains `isError`, `durationMs`, `durationApiMs`, `numTurns` or `sessionId`.
- `bun run jsonl:check` exits 0 over `adws/jsonl/fixtures/` and `test/fixtures/jsonl/envelopes/`; `bun run jsonl:probe:check` exits 0 on this host against CLI 2.1.282.
- `.github/workflows/envelope-conformance.yml` exists, pins `CLAUDE_CLI_VERSION`, asserts `claude --version`, runs `bun run jsonl:check`, runs the live check only when the secret exists, and the run on this PR is green.
- The stub emits `rate_limit_event` (with `resetsAt`) + `assistant` + `result` (`api_error_status: 429`, `is_error: true`) and exits 1 when asked through the manifest `response` block or `MOCK_RESPONSE=rate-limited`; unless overridden, `resetsAt` names a time that has not yet passed; the emitted response passes `checkConformance` against the committed schema; with `limitedInvocations: 1` the second invocation is normal; the `@regression` suite reports 0 failed and the pause/resume smoke scenario keeps its baseline status.
- Issue #909 carries the overloaded-enum comment.
- `bun run test`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run test:unit`, `bun run lint:git-guard`, `bun run lint:docs-index` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run jsonl:check` — exit 0; the report lists every fixture in both directories with ✓ and no "Missing required field", "Parser:" or "Extractor:" lines.
- `bun run jsonl:probe:check` — exit 0 on this host (CLI 2.1.282, operator session); the report shows `system/init`, `assistant`, `result/success` observed, no missing required fields. If a rate limit is active, wait for the reset and rerun.
- `bun run jsonl:probe && git diff --stat adws/jsonl/schema.json` — a second refresh right after the first changes only the `probedAt` line (deterministic reconcile); keep or discard that second stamp deliberately (`git checkout adws/jsonl/schema.json` discards it).
- `grep -rE 'isError|durationMs|durationApiMs|numTurns|sessionId' adws/jsonl/fixtures test/fixtures/jsonl/envelopes; test $? -eq 1` — no stale field names remain in any fixture.
- `bunx tsx -e "import {checkConformance} from './adws/jsonl/conformanceCheck'; const r=checkConformance(); const s=r.find(x=>x.fixturePath.endsWith('session-rate-limited.jsonl')); console.log(JSON.stringify({passed:s?.passed,lines:s?.lineCount,parser:s?.parserErrors}))"` — prints `{"passed":true,"lines":4,"parser":[]}`.
- `MOCK_RESPONSE=rate-limited MOCK_STREAM_DELAY_MS=0 bun test/mocks/claude-cli-stub.ts --print --verbose --output-format stream-json ping; echo "exit=$?"` — three JSON lines (`rate_limit_event` with `"status":"rejected"` and a `resetsAt` later than now, an `assistant` line, a `result` with `"api_error_status":429` and `"is_error":true`) then `exit=1`.
- `MOCK_STREAM_DELAY_MS=0 bun test/mocks/claude-cli-stub.ts --print --verbose --output-format stream-json ping; echo "exit=$?"` — the unchanged default two-line response and `exit=0`.
- `bun run test` — `tsc --noEmit` clean.
- `bunx tsc --noEmit -p adws/tsconfig.json` — clean.
- `bun run lint` — zero errors and warnings.
- `bun run test:unit` — all tests pass, including the new `adws/jsonl/__tests__/*` and `test/mocks/__tests__/claude-cli-stub.test.ts`.
- `bun run lint:git-guard` — PASS.
- `bun run lint:docs-index` — clean.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — 0 failed (baseline: 53 scenarios, 11 passed, 42 pending); `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --name "paused stage on rate-limit detection"` — 1 scenario, still pending at the `When` step, no failure.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-909"` — all scenarios pass (run only if per-issue scenarios were authored for this issue).
- `gh run list --repo paysdoc/AI_Dev_Workflow --workflow envelope-conformance.yml --branch feature-issue-909-stream-json-envelope-conformance-gate --limit 1` — after the branch is pushed: conclusion `success`, and the run log shows the "Live envelope check skipped" warning until the secret exists (or the live step green once it does).
- `gh issue view 909 --repo paysdoc/AI_Dev_Workflow --comments | grep -F '"error":"overloaded"'` — the finding comment is present.

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature. In particular: files under 300 lines (hence `schemaFields.ts`, `schemaMerge.ts`, `stubResponse.ts`), guard clauses over nesting, pure helpers with I/O at the edges, no `any`, no issue numbers in code comments.
- **Interpretation of "must not touch the stream parser or the probe module."** The parser is `adws/core/claudeStreamParser.ts`; "the probe" throughout the parent PRD is the pause-queue rate-limit probe `adws/triggers/rateLimitProbe.ts` (the detection slice changes both). The issue's own Touched Files list includes `adws/jsonl/schemaProbe.ts`, and "re-probe the schema" is impossible without fixing its `--verbose` argument, so the schema probe is in scope. Neither `claudeStreamParser.ts` nor `rateLimitProbe.ts` is modified; the stub test imports `classifyProbeResult` read-only.
- **HITL decisions the human must confirm (the issue is labelled `hitl`):** (1) the pin: `2.1.282` is proposed because it is the version installed on this host and the latest npm release; the cron-host captures in `agents/` show `2.1.281` and `2.1.278` for the most recent runs; (2) the bump policy text in the workflow; (3) creating the `ANTHROPIC_API_KEY` repository secret (the repo has none today: `gh secret list` shows only `CLOUDFLARE_*`, `SLACK_WEBHOOK_URL`, `SOCKET_API_TOKEN`). Without it the live leg is skipped with a warning and the PR is still green. A `CLAUDE_CODE_OAUTH_TOKEN` alternative would additionally require adding that name to `SAFE_ENV_VARS` in `adws/core/environment.ts`, which this slice does not do.
- **Why the live leg compares only required fields of probe-owned types.** The CLI adds fields often (`ttft_ms`, `result_index`, `subagent_stats`, ... appeared across 2.1.1xx–2.1.28x captures); failing on additions would make the gate cry wolf. Failing on a missing required field is exactly the "ADW reads a field that changed" signal the PRD wants. `rate_limit_event` is documented by the SDK as "Rate limit information for claude.ai subscription users"; an API-key probe in CI never sees it, which is why it is capture-owned and hand-curated.
- **Observed CLI facts the plan relies on** (from 3,165 captured `output.jsonl` files on this host and the Agent SDK's `sdk.d.ts`): a rate-limited turn ends with `subtype: "success"`, `is_error: true`, `api_error_status: 429`, `terminal_reason: "api_error"`; other API errors are also reported as `subtype: "success"`, `is_error: true`, with the error text in `result` (a 500 on this host, `terminal_reason: "completed"`); `error_during_execution` results carry `errors` and no `result`; `api_retry` `error` values seen are `overloaded` (529), `rate_limit` (429 and 529), `server_error` (503), `unknown` (null); `system/init` carries `claude_code_version`. The SDK marks `api_error_status` and `terminal_reason` optional on `SDKResultSuccess` (a zero-turn "Unknown command" result on 2.1.281 lacked both), but a real one-turn probe always has them and the pause path needs them, so they are required in the schema.
- **Stub exit code.** The real CLI exits non-zero when the result is an error; `agentProcessHandler` sends SIGTERM as soon as it sees the rejected event, so the code is rarely observed in production. The stub uses 1.
- **Out of scope, reported only:** the stale `isError` / `sessionId` reads in `ClaudeCodeResultMessage` and `agentProcessHandler.ts` (parser/agent territory, detection slice); aligning the parser's `overloaded_error` match; a cron-startup probe (rejected by the PRD).
- No new libraries are needed (`ajv` is already a dependency but the checker's presence-only rules do not need it). If one were needed, the install command is `bun add <package>` per `.adw/commands.md`.
- Baselines recorded at plan time on 2026-09-25: `bun run jsonl:check` fails 4 of 4 (parser newline bug); `@regression` 53 scenarios, 11 passed, 42 pending, 0 failed; the pause/resume smoke scenario is pending at its cutover `When` step; `bun run jsonl:check` runs under `env -i PATH=… HOME=…`, so the CI job needs no dotenv file.
