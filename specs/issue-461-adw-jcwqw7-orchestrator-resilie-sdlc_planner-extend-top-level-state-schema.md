# Feature: Extend top-level state schema with `lastSeenAt` and atomic `writeTopLevelState`

## Metadata
issueNumber: `461`
adwId: `jcwqw7-orchestrator-resilie`
issueJson: `{"number":461,"title":"orchestrator-resilience: extend top-level state schema","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nExtend the top-level state file schema with four new fields so an operator can see at a glance who owns an orchestrator, when it last made progress, and what branch it's on — without spelunking into phase subdirectories. This slice only adds the schema and the atomic writer — consumers (heartbeat, takeover) are wired in later slices. See \"Schema changes\" in the PRD.\n\n## Acceptance criteria\n\n- [ ] `adws/core/agentState.ts` top-level state gains: `pid: number`, `pidStartedAt: string`, `lastSeenAt: string`, `branchName: string`\n- [ ] `pidStartedAt` is ISO 8601 when possible, platform string otherwise (per `processLiveness` contract)\n- [ ] Existing state files without these fields continue to load (forward-compatible read)\n- [ ] `writeTopLevelState` writes are atomic and preserve existing fields when callers supply a partial patch\n- [ ] Unit tests in `adws/core/__tests__/topLevelState.test.ts` cover: write new-schema file, read old-schema file with missing fields, partial-patch write preserves unmodified fields\n\n## Blocked by\n\n- Blocked by #456\n\n## User stories addressed\n\n- User story 5\n- User story 12","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:04:53Z","comments":[],"actionableComment":null}`

## Feature Description

Extend the top-level workflow state file at `agents/<adwId>/state.json` so that an operator can see — without spelunking into phase subdirectories — who owns an orchestrator, when it last made progress, and which git branch it is operating on. Four fields are declared on `AgentState`:

- `pid: number` — OS process id of the orchestrator (already present from PRD slice #456).
- `pidStartedAt: string` — platform start-time token paired with `pid` for PID-reuse-safe liveness (already present from #456). This slice only refreshes its JSDoc to match the PRD's "ISO 8601 when possible, platform string otherwise" wording.
- `lastSeenAt: string` — ISO 8601 timestamp written by the forthcoming heartbeat tick. **This is the only genuinely new schema field.** Its consumers (heartbeat, hung-orchestrator detector, takeover) are deferred to later PRD slices; this slice only defines the field and exposes it to writers.
- `branchName: string` — git branch name (already present).

At the same time, `AgentStateManager.writeTopLevelState()` is upgraded from a plain `fs.writeFileSync` to an atomic write-temp-then-rename. Today a crash or SIGKILL mid-write can leave the state file truncated or half-written — a hazard that becomes load-bearing once the heartbeat ticker writes every 30 seconds while orchestrator phases race their own writes through the same file. The atomic-write pattern is already in use in `adws/core/pauseQueue.ts`; this slice lifts the same pattern into `agentState.ts` so every top-level state write is all-or-nothing.

Consumers of these new fields (heartbeat module, hung-orchestrator detector, takeover handler) are explicitly out of scope. This issue only lands the schema extension and the atomic writer so later slices can rely on both.

## User Story

As an ADW operator, I want to see at a glance from the top-level state file whether an orchestrator is currently live, who owns it (pid, start-time), and when it last made progress (`lastSeenAt`), so that I can debug without spelunking into phase subdirectories. (User story 5)

As an ADW developer, I want PID reuse across process restarts to be impossible to mistake for liveness, so that an orchestrator that died after a reboot doesn't look alive just because some unrelated process inherited its PID. (User story 12)

## Problem Statement

The top-level state file currently carries `pid?: number`, `pidStartedAt?: string`, and `branchName?: string` — the first two added in PRD slice #456, the third present since the original top-level state file work (#378). What it does **not** carry is a `lastSeenAt` heartbeat field, which means there is no way for an external observer (cron sweeper, operator eyeballing the file) to distinguish "orchestrator is alive and making progress" from "orchestrator is alive but event-loop-wedged" from "orchestrator died between phase writes". The PRD's hung-orchestrator recovery path depends on this field; without it the heartbeat slice (later issue) has nothing to write into.

Separately, `AgentStateManager.writeTopLevelState()` at `adws/core/agentState.ts:275-306` writes via `fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8')`. This is a single syscall at the OS level but it is not atomic from the filesystem's perspective — a `SIGKILL` or power loss between the open, the writes, and the close can leave the file truncated, zero-length, or with partial JSON. Today this risk is small because writes are bursty around phase boundaries. Once the heartbeat ticker adds a background write every 30 seconds (and can race a phase-boundary write), the risk becomes material. Corrupted state blocks resume, breaks takeover decisions, and forces operator intervention. The fix is well understood: write to `state.json.tmp` then `rename()` into place. `rename()` within the same directory is atomic on POSIX, so any reader sees either the old complete file or the new complete file — never a half-written one.

The third problem is purely documentary: the existing `pidStartedAt` JSDoc says "Platform start-time token" without the PRD's "ISO 8601 when possible, platform string otherwise" framing. The underlying value is unchanged — `processLiveness.getProcessStartTime()` still returns whatever the OS gives (Linux `/proc` ticks, macOS `ps -o lstart=` string) — but the JSDoc should reflect the schema contract callers will read so there is no ambiguity about what the field holds.

## Solution Statement

1. Add `lastSeenAt?: string` to `AgentState` in `adws/types/agentTypes.ts`, placed alongside `pid` / `pidStartedAt`. JSDoc documents it as an ISO 8601 timestamp written by the heartbeat ticker (forward reference to the module landing in a later slice; no import dependency introduced here).

2. Refresh the existing `pidStartedAt` JSDoc on `AgentState` so it reads "ISO 8601 when possible, platform start-time string otherwise (per `processLiveness` contract)". The field's value is unchanged; only the documentation catches up with the PRD language.

3. Refresh the existing `branchName` JSDoc so it explicitly documents that this is the top-level state's view of the orchestrator's git branch, so operators reading the file know which branch to inspect.

4. Upgrade `AgentStateManager.writeTopLevelState()` to the atomic write-temp-then-rename pattern used by `writePauseQueue()`:
   - Write the serialized JSON to `<filePath>.tmp` with `fs.writeFileSync`.
   - `fs.renameSync(tmpPath, filePath)` to atomically replace the target.
   - On any error, attempt to clean up the temp file (`fs.unlinkSync`, ignore ENOENT).
   - Preserves existing shallow-merge and deep-merge-phases semantics unchanged; only the tail `writeFileSync` step is rewritten.

5. Extend `adws/core/__tests__/topLevelState.test.ts` with five new test cases (matrix specified in the Implementation Plan). Use the same `TEST_ADW_ID` per-describe pattern as the existing suite — real filesystem, unique adwId per run, `afterEach` cleanup.

6. Everything in this slice is read-only to existing writers. Forward-compatibility of the read path is already a given: `readTopLevelState` does a bare `JSON.parse` and the new fields are optional, so pre-existing files without any of `pid`/`pidStartedAt`/`lastSeenAt`/`branchName` continue to parse into a valid (partial) `AgentState`. No migration script is introduced; the self-heal is "next write populates what's missing" and that's the responsibility of later slices.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/orchestrator-coordination-resilience.md` — Parent PRD. "Schema changes" section specifies the four-field extension; "Heartbeat parameters" section references `lastSeenAt` as the heartbeat target; "Modules to extend → agentState" documents the exact schema addition this slice lands.
- `adws/types/agentTypes.ts` — Home of the `AgentState` interface. Already carries `pid?: number` (line 214), `pidStartedAt?: string` (line 216), and `branchName?: string` (line 208). Will add `lastSeenAt?: string` and refresh the JSDocs on the two existing liveness fields plus `branchName`.
- `adws/core/agentState.ts` — Home of `AgentStateManager.writeTopLevelState()` (lines 275–306). Current implementation uses plain `fs.writeFileSync`; will be upgraded to write-temp-then-rename using the pattern from `adws/core/pauseQueue.ts:54-60`. Merge semantics (shallow top-level, deep `phases`) are preserved without change.
- `adws/core/__tests__/topLevelState.test.ts` — Existing Vitest suite (lines 1–208). Will be extended with the five new cases listed in Step 5 below. No existing test should fail — all current assertions remain valid after the atomic-write rewrite.
- `adws/core/pauseQueue.ts` — Reference implementation for the atomic-write pattern (lines 54–60: `fs.writeFileSync(tmp, ...)` followed by `fs.renameSync(tmp, target)`). This slice lifts the same two-step pattern into `agentState.ts`.
- `adws/core/processLiveness.ts` — Read-only. Defines the contract that `pidStartedAt` holds a platform-specific start-time token. The updated JSDoc on `AgentState.pidStartedAt` cites this module as the source of the format contract.
- `adws/core/stateHelpers.ts` — Read-only. `isAgentProcessRunning` at line 124 already reads `state.pid` and `state.pidStartedAt` and delegates to `processLiveness.isProcessLive`. Unchanged by this slice.
- `app_docs/feature-xlv8zk-process-liveness-module.md` — Context for the `pid` / `pidStartedAt` field contract. Read-only — no changes expected.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — Original top-level state file feature doc. Context for how the state file is used today and the deep-merge semantics this slice must preserve. Read-only.
- `guidelines/coding_guidelines.md` — TypeScript strict mode, interfaces for data shapes, pure functions with side effects at boundaries. The schema extension and atomic-write refactor respect these rules.

### New Files

No new source files. The feature is a schema extension on an existing interface plus an atomic-write refactor on an existing method. The existing test file receives additional cases — no new test file is needed.

## Implementation Plan

### Phase 1: Foundation

Land the schema extension on `AgentState`:

- Add `lastSeenAt?: string` alongside the existing `pid` / `pidStartedAt` / `branchName` fields.
- Refresh JSDocs on `pid`, `pidStartedAt`, `branchName`, and the new `lastSeenAt` so each field's purpose, format, and writer are explicit. Keep wording aligned with the PRD's "Schema changes" section so future grep-for-docs works.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to confirm the addition compiles cleanly — all four fields are optional, so no existing writer breaks.

### Phase 2: Core Implementation

Rewrite `AgentStateManager.writeTopLevelState()` to write atomically, preserving all existing merge semantics:

- Compute the `merged` payload exactly as today (shallow-merge shallow fields, deep-merge `phases`).
- Serialize to JSON once.
- Write to `<filePath>.tmp` via `fs.writeFileSync`.
- `fs.renameSync(tmp, filePath)` to atomically replace the old file.
- On any throw from the temp write or the rename, attempt `fs.unlinkSync(tmp)` to clean up (silently swallow ENOENT). Re-throw the original error so callers still see failures.

The behavior observable to callers is identical except for the atomicity guarantee; no callers need to change. The `readTopLevelState` side already handles missing and corrupted files gracefully (`readTopLevelState` returns `null` on parse failure) so the atomic-write upgrade cannot break readers.

### Phase 3: Integration

Extend `adws/core/__tests__/topLevelState.test.ts` with five new cases covering the PRD's acceptance matrix. Each case uses the same unique-adwId pattern as the existing suite so the new cases compose with the existing ones:

1. **Write new-schema file**: call `writeTopLevelState` with `{ adwId, pid, pidStartedAt, lastSeenAt, branchName }` and assert all four fields round-trip through `readTopLevelState`.
2. **Read old-schema file with missing fields**: write raw JSON to disk containing only `{ adwId, issueNumber, workflowStage, phases }` (no `pid` / `pidStartedAt` / `lastSeenAt` / `branchName`), then `readTopLevelState` returns a valid state object with the four fields undefined (not null, not throwing).
3. **Partial-patch write preserves unmodified fields**: seed a state file with all four new fields populated, call `writeTopLevelState(adwId, { lastSeenAt: 'later' })`, then read and assert `pid`, `pidStartedAt`, `branchName` are unchanged and `lastSeenAt` is updated.
4. **Partial-patch write only touching `lastSeenAt` preserves `phases`**: seed a state file with populated `phases` map, call `writeTopLevelState(adwId, { lastSeenAt: '…' })`, read and assert the `phases` map is still intact (tightens the coverage of the deep-merge interaction with the new field).
5. **Atomic write: tmp file is not left behind on success**: call `writeTopLevelState`, read back the target file, and assert `<filePath>.tmp` does not exist on disk afterwards. (Sanity check that the rename completed; no try-catch-throwing injection needed — filesystem-layer atomicity is trusted and tested elsewhere.)

After the tests are green, run the full validation suite to confirm no regressions anywhere else. Since the behavior observable to existing callers is unchanged, no other test file needs updates.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add `lastSeenAt?: string` to `AgentState` and refresh related JSDocs
- Open `adws/types/agentTypes.ts`.
- Locate the `AgentState` interface (line 202).
- Insert `lastSeenAt?: string` immediately after `pidStartedAt?: string` (line 216). The field is optional.
- Add JSDoc on the new field: `/** ISO 8601 timestamp of the most recent heartbeat tick. Written by the heartbeat ticker (landing in a later slice) as an independent signal of orchestrator liveness, separate from phase progress. A stale `lastSeenAt` with a live PID indicates a wedged event loop. */`
- Refresh the JSDoc on `pid` (line 213): `/** OS process id of the orchestrator process. Paired with `pidStartedAt` for PID-reuse-safe liveness checks via `processLiveness.isProcessLive`. */`
- Refresh the JSDoc on `pidStartedAt` (line 215): `/** Platform start-time token for the orchestrator process — ISO 8601 when possible, platform start-time string otherwise (per `processLiveness` contract). Paired with `pid` so PID reuse after a reboot cannot be mistaken for liveness. */`
- Refresh the JSDoc on `branchName` (line 207): `/** Git branch the orchestrator is operating on (e.g. `feature-issue-42-my-slug`). Recorded in the top-level state so operators can inspect the branch without spelunking into phase subdirectories. */`
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — expect zero errors (all additions are optional).

### 2. Rewrite `writeTopLevelState` to use atomic write-temp-then-rename
- Open `adws/core/agentState.ts`.
- Locate `writeTopLevelState` (starts at line 275).
- Preserve the existing body through the construction of `merged` (up to and including the deep-merge of `phases`).
- Replace the final line `fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');` with:
  - `const tmpPath = `${filePath}.tmp`;`
  - `try {`
  - `  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');`
  - `  fs.renameSync(tmpPath, filePath);`
  - `} catch (err) {`
  - `  try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }`
  - `  throw err;`
  - `}`
- Add a one-line comment above the try block: `// Atomic write: write to temp file then rename so readers never see a half-written state.json.`
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — expect zero errors.
- Run the existing `topLevelState.test.ts` suite (`bun run test:unit -- topLevelState`) — expect all existing tests to continue passing.

### 3. Add the five new test cases to `topLevelState.test.ts`
- Open `adws/core/__tests__/topLevelState.test.ts`.
- Add a new `describe` block near the end of the file (after the existing `describe('Phase status transitions via writeTopLevelState', ...)` block): `describe('Extended state schema: pid / pidStartedAt / lastSeenAt / branchName', () => { ... })`.
- Inside, use the same `adwId = `${TEST_ADW_ID}-schema`` + `afterEach` cleanup pattern as the existing suites.
- Test A — "writes and reads a new-schema file with all four fields":
  - Call `writeTopLevelState(adwId, { adwId, pid: 12345, pidStartedAt: 'start-token', lastSeenAt: '2026-04-20T12:00:00.000Z', branchName: 'feature-issue-461-extend-state' })`.
  - Read and assert each of the four fields round-trips exactly.
- Test B — "reads an old-schema file missing the four fields without error":
  - Use `fs.mkdirSync` + `fs.writeFileSync` to create the state file manually with only `{ adwId, issueNumber: 5, workflowStage: 'starting', phases: {} }`.
  - Call `readTopLevelState(adwId)`.
  - Assert `state` is not null, `state.adwId === adwId`, and `state.pid === undefined`, `state.pidStartedAt === undefined`, `state.lastSeenAt === undefined`, `state.branchName === undefined`.
- Test C — "partial-patch write preserves the other three new fields":
  - Seed via `writeTopLevelState(adwId, { adwId, pid: 42, pidStartedAt: 'tok', lastSeenAt: '2026-04-20T12:00:00Z', branchName: 'branch-a' })`.
  - Patch via `writeTopLevelState(adwId, { lastSeenAt: '2026-04-20T12:00:30Z' })`.
  - Assert `pid === 42`, `pidStartedAt === 'tok'`, `branchName === 'branch-a'`, `lastSeenAt === '2026-04-20T12:00:30Z'`.
- Test D — "partial-patch write touching only `lastSeenAt` preserves `phases`":
  - Seed via two writes: one with `{ adwId, phases: { install: { status: 'completed', startedAt: '...' } } }` and another with `{ pid: 1, pidStartedAt: 'x', branchName: 'b' }`.
  - Patch via `writeTopLevelState(adwId, { lastSeenAt: '…' })`.
  - Read and assert `phases.install.status === 'completed'`, `pid === 1`, `pidStartedAt === 'x'`, `branchName === 'b'`, `lastSeenAt === '…'`.
- Test E — "atomic write leaves no tmp file on disk after success":
  - Call `writeTopLevelState(adwId, { adwId, lastSeenAt: 'now' })`.
  - Compute `tmpPath = `${filePath}.tmp``.
  - Assert `fs.existsSync(tmpPath) === false`.
- Run `bun run test:unit -- topLevelState` — expect all new and existing tests to pass.

### 4. Run the full validation suite
- Run every command listed under `## Validation Commands` below, in order.
- Fix any regressions surfaced by type-check, lint, or unit tests before considering this issue complete.
- Confirm no test file beyond `adws/core/__tests__/topLevelState.test.ts` is affected (all existing callers of `writeTopLevelState` see identical observable behavior; no test update is expected outside the topLevelState suite).

## Testing Strategy

### Unit Tests

`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are required.

Five new cases are added to the existing `adws/core/__tests__/topLevelState.test.ts` Vitest suite:

- **Write new-schema file** — exercises the write path for all four fields end-to-end.
- **Read old-schema file** — exercises the forward-compatible read path for state files that predate the extension.
- **Partial-patch preserves new fields** — proves that writing only `{ lastSeenAt: ... }` does not clobber `pid`, `pidStartedAt`, or `branchName`.
- **Partial-patch preserves `phases`** — proves that the new field does not interact badly with the existing deep-merge of the phases map.
- **Atomic write: tmp file cleaned up** — proves the atomic-write path completes the rename and does not leave `<filePath>.tmp` orphaned.

Existing test cases remain valid and continue to pass — they exercise the unchanged merge semantics and the (still-identical) observable write behavior. No test file outside `topLevelState.test.ts` is modified.

### Edge Cases

- **Corrupted state file on write** — `readTopLevelState` already handles corrupted JSON by returning `null`; `writeTopLevelState` starts from empty state on parse failure. The atomic rename does not change this — only the write-to-tmp step can fail, and the try/catch cleans up the tmp file.
- **Missing `lastSeenAt` in a state file that has `pid` / `pidStartedAt` / `branchName`** — consumers (heartbeat, hung-orchestrator detector) land in later slices and will treat missing `lastSeenAt` as "never seen" (safe default). This issue does not gate on that behavior; the field is documented as heartbeat-written.
- **`pidStartedAt` containing a platform string (macOS `lstart`) rather than ISO 8601** — already the observable reality; the JSDoc refresh documents this explicitly. No runtime change.
- **`branchName` containing the old slash-separated format (`feature/issue-N-slug`)** — out of scope here; branch-name normalization landed in PRD slice #455. The schema only types the field; its format is the responsibility of the writer.
- **Concurrent writes from two processes** — out of scope (single-host constraint documented in the PRD and README). Atomic rename protects against the intra-process crash window, not against cross-process racing writes.
- **Non-existent parent directory** — `writeTopLevelState` already runs `fs.mkdirSync(dir, { recursive: true })` before writing (line 280), so the atomic-write upgrade inherits that behavior.
- **`state.json.tmp` pre-existing on disk** — `fs.writeFileSync` overwrites, and `fs.renameSync` overwrites the target. The write-then-rename is idempotent against leftover tmp files from prior crashes.
- **`renameSync` across filesystems** — within `agents/<adwId>/` there is no cross-filesystem concern; the tmp file sits in the same directory as the target, so rename is always atomic.

## Acceptance Criteria

- [ ] `AgentState` in `adws/types/agentTypes.ts` declares all four fields: `pid?: number`, `pidStartedAt?: string`, `lastSeenAt?: string`, `branchName?: string`.
- [ ] `AgentState.pidStartedAt` JSDoc explicitly says "ISO 8601 when possible, platform start-time string otherwise (per `processLiveness` contract)".
- [ ] `AgentState.lastSeenAt` JSDoc names it as the heartbeat target and documents its independence from phase progress.
- [ ] `AgentState.branchName` JSDoc documents it as the operator-visible branch name recorded at the top-level state.
- [ ] `readTopLevelState` returns a valid (partial) `AgentState` for files that predate the schema extension — no throws, no nulls, missing fields surface as `undefined`.
- [ ] `writeTopLevelState` writes to `<filePath>.tmp` then atomically renames into place. On write failure, the temp file is cleaned up.
- [ ] `writeTopLevelState` preserves existing shallow-merge (top-level fields) and deep-merge (`phases`) semantics.
- [ ] `adws/core/__tests__/topLevelState.test.ts` has new cases for: write-new-schema, read-old-schema, partial-patch-preserves-new-fields, partial-patch-preserves-phases, atomic-write-leaves-no-tmp.
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` report zero errors.
- [ ] `bun run lint` reports zero errors.
- [ ] `bun run test:unit -- topLevelState` passes (both the existing and the new cases).
- [ ] `bun run test:unit` passes with zero regressions anywhere in the unit suite.
- [ ] `bun run build` succeeds with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — Ensure dependencies are fresh.
- `bun run lint` — Lint the repo; expect zero errors.
- `bunx tsc --noEmit` — Root type check; expect zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check; expect zero errors.
- `bun run test:unit -- topLevelState` — Run the extended `topLevelState` suite; expect all existing and five new cases to pass.
- `bun run test:unit` — Full unit-test suite; expect zero regressions (no other test file is modified, but phaseRunner / adwMerge / webhookHandlers all call `writeTopLevelState` and must continue to pass).
- `bun run build` — Expect zero build errors.

## Notes

- **Guidelines**: The change respects `guidelines/coding_guidelines.md` — strict TypeScript (no `any`), optional fields for forward compatibility, JSDoc on each new and refreshed field, pure merging in memory with a single atomic-write boundary. The module stays well under the 300-line soft cap.
- **Library install command**: None — only built-in Node APIs (`fs`) are used. No `bun add` needed.
- **Scope boundary**: The heartbeat writer, hung-orchestrator detector, and takeover handler that consume `lastSeenAt` are explicitly deferred to later PRD slices (issues following #461 in the orchestrator-coordination-resilience sequence). This issue only lands the schema and the atomic writer.
- **Why `pid` / `pidStartedAt` / `branchName` are listed on the acceptance criteria despite already existing**: The acceptance criteria in the issue treat the schema as a four-field set. Three of those four fields already landed in earlier PRD slices (#456 for `pid` / `pidStartedAt`, #378 for `branchName`). This slice consolidates by (a) adding the genuinely new `lastSeenAt`, (b) refreshing JSDocs on the three existing fields so they match the PRD language, and (c) confirming via new tests that all four fields participate correctly in the partial-patch merge semantics. No duplicate-declaration work occurs.
- **Atomic-write precedent**: The two-step `writeFileSync(tmp, ...)` + `renameSync(tmp, target)` pattern already lives in `adws/core/pauseQueue.ts:54-60`. This slice lifts the same pattern rather than introducing a new shared helper, keeping the diff minimal. If a third caller adopts it later, extraction to `adws/core/atomicWrite.ts` is a trivial follow-up.
- **Readers outside `readTopLevelState`**: `adws/core/stateHelpers.ts:124` (`isAgentProcessRunning`) reads `state.pid` and `state.pidStartedAt` via a direct JSON parse in `readStateFile`. It is already robust to missing fields (line 129: `if (!state?.pid || !state?.pidStartedAt) return false`). No change needed.
- **No BDD scenario added**: The PRD's testing section lists BDD scenarios for `takeoverHandler`, `remoteReconcile`, and `worktreeReset` — not for the schema extension itself. This slice's observable behavior is the four-field round-trip covered by the unit tests. A BDD scenario would duplicate the test matrix without exercising new user-visible behavior until the heartbeat consumer lands.
- **Forward reference in `lastSeenAt` JSDoc**: The JSDoc says "written by the heartbeat ticker (landing in a later slice)". This is intentional — the reader of the type today should understand what the field is for, even though no writer populates it yet in this slice. Once the heartbeat module lands, its JSDoc can tighten to a concrete module reference.
