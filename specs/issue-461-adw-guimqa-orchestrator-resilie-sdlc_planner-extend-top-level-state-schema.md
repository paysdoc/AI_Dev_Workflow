# Feature: Extend top-level state schema with owner/progress/branch fields and atomic writer

## Metadata
issueNumber: `461`
adwId: `guimqa-orchestrator-resilie`
issueJson: `{"number":461,"title":"orchestrator-resilience: extend top-level state schema","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nExtend the top-level state file schema with four new fields so an operator can see at a glance who owns an orchestrator, when it last made progress, and what branch it's on — without spelunking into phase subdirectories. This slice only adds the schema and the atomic writer — consumers (heartbeat, takeover) are wired in later slices. See \"Schema changes\" in the PRD.\n\n## Acceptance criteria\n\n- [ ] `adws/core/agentState.ts` top-level state gains: `pid: number`, `pidStartedAt: string`, `lastSeenAt: string`, `branchName: string`\n- [ ] `pidStartedAt` is ISO 8601 when possible, platform string otherwise (per `processLiveness` contract)\n- [ ] Existing state files without these fields continue to load (forward-compatible read)\n- [ ] `writeTopLevelState` writes are atomic and preserve existing fields when callers supply a partial patch\n- [ ] Unit tests in `adws/core/__tests__/topLevelState.test.ts` cover: write new-schema file, read old-schema file with missing fields, partial-patch write preserves unmodified fields\n\n## Blocked by\n\n- Blocked by #456\n\n## User stories addressed\n\n- User story 5\n- User story 12","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:04:53Z","comments":[],"actionableComment":null}`

## Feature Description

Extend the top-level workflow state file (`agents/<adwId>/state.json`) so that an operator — or a future coordination module — can see at a glance who owns a given orchestrator, when it last made progress, and what branch it is working on. Today the top-level state file records lifecycle fields (`workflowStage`, `phases`, `adwId`, `issueNumber`) but no owning-process identity and no progress heartbeat. An operator triaging a stuck issue has to dig into per-phase subdirectories to piece those together.

After issue #456, three of the four fields (`pid`, `pidStartedAt`, `branchName`) are already defined as optional properties on the `AgentState` interface because `processLiveness` needed them for spawn-lock liveness. The fourth field, `lastSeenAt`, is genuinely new — it will be written by the heartbeat side-tick (built in a later slice). This slice stops short of wiring consumers: it declares the schema, adds the new `lastSeenAt` field, documents the per-field format contracts, and hardens `writeTopLevelState` so every future writer gets atomic replacement semantics for free. The heartbeat module (PRD section `heartbeat`) and the takeover handler (PRD section `takeoverHandler`) are explicit non-goals of this issue.

The writer change is motivated by the PRD's "Schema changes" section, which calls out that the heartbeat write must be atomic via the existing `AgentStateManager.writeTopLevelState` pattern. Today's writer is a read-modify-write sequence against the canonical file path; a crash between `writeFileSync` beginning and finishing can leave a truncated or zero-byte state file. Switching to a tmp-file + `fs.renameSync` pattern makes the replacement atomic on POSIX and removes that hazard before heartbeat starts calling it every 30 seconds.

## User Story

As an ADW operator, I want to see at a glance from the top-level state file whether an orchestrator is currently live, who owns it (pid, start-time), and when it last made progress (`lastSeenAt`), so that I can debug without spelunking into phase subdirectories. (User story 5)

As an ADW developer, I want PID reuse across process restarts to be impossible to mistake for liveness, so that an orchestrator that died after a reboot doesn't look alive just because some unrelated process inherited its PID. (User story 12 — this slice contributes by making `pidStartedAt` a first-class top-level field so the heartbeat and takeover slices can rely on it.)

## Problem Statement

Today `AgentState` (`adws/types/agentTypes.ts`) exposes `pid?: number`, `pidStartedAt?: string`, and `branchName?: string` as optional fields, but there is no top-level `lastSeenAt` field and no formally-documented contract that these four fields belong on the top-level state file (as opposed to per-agent subdirectory state). Operators reading `agents/<adwId>/state.json` cannot reliably answer "is this orchestrator alive?" or "when did it last make progress?" without cross-referencing per-agent state or issuing platform-specific `ps` commands.

`AgentStateManager.writeTopLevelState` (`adws/core/agentState.ts:275-306`) already shallow-merges top-level fields and deep-merges the `phases` map, so partial-patch calls (e.g., a heartbeat writing only `lastSeenAt`) would preserve existing fields. However, the final write uses `fs.writeFileSync` directly against the canonical path. If the process is killed mid-write, the file can be left truncated or empty. That risk is acceptable today because writes happen infrequently (phase boundaries, workflow stage transitions); it will stop being acceptable once the heartbeat side-tick starts firing every 30 seconds. A torn-file recovery path is explicitly out of scope (`readTopLevelState` already returns `null` on parse failure); this slice removes the ability to produce a torn file in the first place.

## Solution Statement

Narrow, targeted slice with two code changes and one test change:

1. **Schema extension.** Add `lastSeenAt?: string` to the `AgentState` interface alongside the existing `pid`, `pidStartedAt`, `branchName` optional fields. Update the JSDoc for the four fields so the per-field contracts are documented in one place:
   - `pid: number` — OS process ID of the orchestrator process.
   - `pidStartedAt: string` — platform start-time token (ISO 8601 when possible, platform string otherwise, per `processLiveness` contract). Linux returns clock ticks as a string; macOS/BSD returns `ps -o lstart=` output.
   - `lastSeenAt: string` — ISO 8601 timestamp of the most recent heartbeat or phase-boundary write.
   - `branchName: string` — the git branch the orchestrator is operating on.

   All four remain `?: optional` on the TypeScript interface so existing state files that predate each field continue to deserialize. Forward-compatible read is free: `readTopLevelState` already does `JSON.parse(...) as AgentState` with no field-level validation, so missing fields surface as `undefined`.

2. **Atomic writer.** Refactor `writeTopLevelState` so the on-disk replacement is atomic:
   - Keep the existing read-merge-serialize sequence unchanged.
   - Replace the single `fs.writeFileSync(filePath, ...)` call with a write to `filePath + '.tmp'` followed by `fs.renameSync(filePath + '.tmp', filePath)`. `renameSync` is atomic on the same POSIX filesystem.
   - Extract the atomic-write behavior into a small private helper (e.g., `atomicWriteJson(filePath, data)`) to keep `writeTopLevelState` focused on merge logic.
   - On a mid-write crash, the `.tmp` file may be left behind. The next `writeTopLevelState` call will simply overwrite it before renaming, so no cleanup logic is required.

3. **Unit tests** (`adws/core/__tests__/topLevelState.test.ts`) for the three scenarios the acceptance criteria call out:
   - Write new-schema file: `writeTopLevelState` with all four new fields (`pid`, `pidStartedAt`, `lastSeenAt`, `branchName`) and assert the file round-trips via `readTopLevelState`.
   - Read old-schema file with missing fields: manually write a pre-461 shape (`{adwId, workflowStage}`) to disk, then assert `readTopLevelState` returns a non-null object with `pid`/`pidStartedAt`/`lastSeenAt`/`branchName` all `undefined` (i.e., forward-compatible read).
   - Partial-patch write preserves unmodified fields: write the full four-field record, then call `writeTopLevelState` with only `{lastSeenAt: newValue}`, then assert the other three fields are unchanged.

Explicitly out of scope:

- `heartbeat` module (PRD, "New modules to build") — a separate issue will build `startHeartbeat(adwId, intervalMs)` and call `writeTopLevelState({lastSeenAt})` on a `setInterval`.
- `takeoverHandler` module (PRD, "New modules to build") — a separate issue will read `pid`/`pidStartedAt`/`lastSeenAt`/`branchName` to decide `spawn_fresh` / `take_over_adwId` / `defer_live_holder` / `skip_terminal`.
- Migration of existing in-flight state files — existing fields remain optional and absent fields deserialize as `undefined`; no rewrite of on-disk state is performed.
- Wiring any orchestrator entrypoint to populate `pid`/`pidStartedAt`/`branchName` at launch — this is the heartbeat/takeover wrapper's responsibility in subsequent slices.

## Relevant Files

Use these files to implement the feature:

- `adws/types/agentTypes.ts` — declaration site for `AgentState`. Add `lastSeenAt?: string` and document the four-field contract via JSDoc. `pid?`, `pidStartedAt?`, `branchName?` already exist (added by #378 / #456).
- `adws/core/agentState.ts` — `AgentStateManager.writeTopLevelState` at `agentState.ts:275-306`. Convert the final `fs.writeFileSync` to the tmp-file + rename atomic pattern. `readTopLevelState` (`agentState.ts:257-265`) already parses with no schema validation — no change needed for forward-compatible read.
- `adws/core/__tests__/topLevelState.test.ts` — existing suite covering `getTopLevelStatePath`, `writeTopLevelState`, `readTopLevelState`, phase deep-merge, corrupted-JSON handling. Extend with the three new test cases above.
- `specs/prd/orchestrator-coordination-resilience.md` — parent PRD. Defines the four-field schema contract ("Schema changes"), the heartbeat/takeover slices that will consume the fields, and the user stories (5, 12) this slice addresses.
- `app_docs/feature-xlv8zk-process-liveness-module.md` — documents the `pidStartedAt` contract. Read before writing the JSDoc so the documented format matches the value `processLiveness.getProcessStartTime` actually produces on each platform.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — documents the existing top-level state file, `AgentStateManager` methods, and the phase deep-merge invariant that must not regress.
- `adws/core/processLiveness.ts` — read-only reference. `getProcessStartTime` is the only producer of `pidStartedAt` values and its return shape (Linux: jiffies string; macOS/BSD: `ps -o lstart=` output; Windows: `null`) is the contract the new JSDoc must match.
- `adws/core/stateHelpers.ts` — `isAgentProcessRunning` already reads `pid` and `pidStartedAt` from state via `isProcessLive` (`stateHelpers.ts:124-132`). No code change here, but verify the existing behavior is compatible with the new schema documentation.
- `guidelines/coding_guidelines.md` — project coding guidelines; the implementation must adhere to these (strict TS, pure functions, side effects at the edges, clarity over cleverness, files under 300 lines).

### New Files

None. All changes are in-place extensions of existing files.

## Implementation Plan

### Phase 1: Foundation

Re-read the parent PRD's "Schema changes" and "Notes" sections and the two conditional docs (`feature-xlv8zk-process-liveness-module.md`, `feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md`) so the JSDoc contract for `pidStartedAt` exactly matches the `processLiveness.getProcessStartTime` return-value format. Confirm the four fields already present in `AgentState` and that only `lastSeenAt` is genuinely new.

### Phase 2: Core Implementation

Add `lastSeenAt?: string` to `AgentState` and update JSDoc for the four-field schema contract. Refactor `writeTopLevelState` to atomic tmp-file + rename semantics via a private `atomicWriteJson` helper. Keep the existing merge logic and phase deep-merge behavior unchanged.

### Phase 3: Integration

No orchestrator entrypoint or consumer wiring happens in this slice. The heartbeat and takeover slices will consume the schema in follow-up issues. The existing `writeTopLevelState` callers (phase transitions, workflow-stage writes) automatically pick up atomic replacement semantics without code changes.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Extend the `AgentState` interface with `lastSeenAt` and document the four-field contract

- Edit `adws/types/agentTypes.ts`.
- Add `lastSeenAt?: string` directly after `pidStartedAt?: string` in the `AgentState` interface.
- Update JSDoc for the four fields so each documents its intended semantics:
  - `pid` — OS process ID of the orchestrator process (for liveness checks); paired with `pidStartedAt` for PID-reuse-safe liveness via `processLiveness.isProcessLive`. (Keep the existing JSDoc text; no rewrite needed.)
  - `pidStartedAt` — platform start-time token recorded at orchestrator launch. ISO 8601 when the platform supplies it; otherwise the platform-native token (Linux: `/proc/<pid>/stat` field 22 as a jiffies string; macOS/BSD: `ps -o lstart=` output). Produced by `processLiveness.getProcessStartTime`.
  - `lastSeenAt` — ISO 8601 timestamp of the most recent heartbeat or phase-boundary write. Populated by the heartbeat module (future slice) and optionally by phase transitions.
  - `branchName` — the git branch the orchestrator is operating on, assembled in code from the LLM-produced slug (per PRD "Branch-name generation").
- Do not widen these to required fields; keep them all optional.

### 2. Extract an `atomicWriteJson` private helper

- Edit `adws/core/agentState.ts`.
- Above the `AgentStateManager` class (file-scope), add a small private helper:

```ts
function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}
```

- The helper is internal to the module; do not export it.

### 3. Refactor `writeTopLevelState` to use `atomicWriteJson`

- In `adws/core/agentState.ts`, inside `AgentStateManager.writeTopLevelState`, replace the final line:

```ts
fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
```

  with:

```ts
atomicWriteJson(filePath, merged);
```

- Leave the rest of `writeTopLevelState` unchanged: directory creation, existing-state read, shallow merge, phase deep-merge.

### 4. Add unit test: write new-schema file round-trips all four fields

- Edit `adws/core/__tests__/topLevelState.test.ts`.
- Inside the existing `describe('AgentStateManager.writeTopLevelState() and readTopLevelState()', ...)` block, add:

```ts
it('writes and reads the full new-schema top-level state (pid, pidStartedAt, lastSeenAt, branchName)', () => {
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    pid: 4242,
    pidStartedAt: 'Sun Apr 20 10:15:23 2026',
    lastSeenAt: '2026-04-20T10:15:23.000Z',
    branchName: 'feature-issue-461-extend-top-level-state-schema',
  });
  const state = AgentStateManager.readTopLevelState(adwId);
  expect(state!.pid).toBe(4242);
  expect(state!.pidStartedAt).toBe('Sun Apr 20 10:15:23 2026');
  expect(state!.lastSeenAt).toBe('2026-04-20T10:15:23.000Z');
  expect(state!.branchName).toBe('feature-issue-461-extend-top-level-state-schema');
});
```

### 5. Add unit test: forward-compatible read of pre-461 state files

- In the same file, add:

```ts
it('reads a pre-461 state file missing pid/pidStartedAt/lastSeenAt/branchName without error', () => {
  const filePath = AgentStateManager.getTopLevelStatePath(adwId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ adwId, issueNumber: 1, workflowStage: 'starting' }, null, 2),
    'utf-8',
  );
  const state = AgentStateManager.readTopLevelState(adwId);
  expect(state).not.toBeNull();
  expect(state!.adwId).toBe(adwId);
  expect(state!.workflowStage).toBe('starting');
  expect(state!.pid).toBeUndefined();
  expect(state!.pidStartedAt).toBeUndefined();
  expect(state!.lastSeenAt).toBeUndefined();
  expect(state!.branchName).toBeUndefined();
});
```

### 6. Add unit test: partial-patch write preserves unmodified fields

- In the same file, add:

```ts
it('partial-patch write preserves unmodified new-schema fields', () => {
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    pid: 7777,
    pidStartedAt: 'Sun Apr 20 09:00:00 2026',
    branchName: 'feature-x',
  });
  AgentStateManager.writeTopLevelState(adwId, {
    lastSeenAt: '2026-04-20T09:00:30.000Z',
  });
  const state = AgentStateManager.readTopLevelState(adwId);
  expect(state!.pid).toBe(7777);
  expect(state!.pidStartedAt).toBe('Sun Apr 20 09:00:00 2026');
  expect(state!.branchName).toBe('feature-x');
  expect(state!.lastSeenAt).toBe('2026-04-20T09:00:30.000Z');
});
```

### 7. Run the validation suite

- Run the commands in the `Validation Commands` section below and resolve any lint, type, or test failures before completing the task.

## Testing Strategy

### Unit Tests

The following unit tests cover the acceptance criteria and live in `adws/core/__tests__/topLevelState.test.ts`:

- **New-schema write + read round-trip**: confirms `writeTopLevelState` persists all four fields (`pid`, `pidStartedAt`, `lastSeenAt`, `branchName`) and `readTopLevelState` deserializes them without loss.
- **Forward-compatible read**: confirms a pre-461 state file containing only legacy fields (`adwId`, `issueNumber`, `workflowStage`) deserializes successfully with the four new fields surfacing as `undefined` rather than throwing.
- **Partial-patch preservation**: confirms writing `{lastSeenAt}` on top of a state file containing `{pid, pidStartedAt, branchName}` leaves the three existing fields intact (regression guard for the atomic-write refactor; if the tmp-file pattern accidentally truncates or clobbers, this test fails).

Existing tests in the same file (shallow-field merge, phase deep-merge, corrupted-JSON graceful handling, phase running→completed transition, workflowStage-independent-of-phases-map) must continue to pass unchanged. These verify that the atomic-writer refactor does not regress the existing merge semantics that `runPhase`, `handleWorkflowError`, `handleRateLimitPause`, and `completeWorkflow` depend on.

### Edge Cases

- **Pre-existing `.tmp` file on disk** — if a prior crash left `state.json.tmp` behind, the next `writeTopLevelState` call writes it (overwriting), then renames it atomically into place. No cleanup branch is required; asserting this explicitly in a test is optional but low-value (covered indirectly by back-to-back writes in existing tests).
- **Corrupted pre-existing `state.json`** — already covered by the existing `'handles corrupted state.json gracefully — starts fresh'` test; must continue to pass because the read path in `writeTopLevelState` still does a try/parse/fall-back-to-empty.
- **Concurrent writes across orchestrators** — out of scope for this slice. Atomic rename covers the single-writer crash hazard; multi-writer races are addressed by spawn-lock coordination in other PRD slices.
- **Cross-filesystem `renameSync`** — Node raises `EXDEV` when renaming across filesystems. The `.tmp` file and the final file both live under `AGENTS_STATE_DIR` (same filesystem by design), so this is not a supported failure mode and no fallback is implemented.

## Acceptance Criteria

- [ ] `adws/types/agentTypes.ts` `AgentState` interface has `pid?: number`, `pidStartedAt?: string`, `lastSeenAt?: string`, and `branchName?: string` with JSDoc that documents each field's format and ownership.
- [ ] `pidStartedAt` JSDoc documents "ISO 8601 when possible, platform string otherwise" and references the `processLiveness` contract.
- [ ] `adws/core/agentState.ts` `writeTopLevelState` uses a tmp-file + `fs.renameSync` pattern for atomic replacement.
- [ ] Existing state files lacking `pid`/`pidStartedAt`/`lastSeenAt`/`branchName` continue to deserialize via `readTopLevelState` without error; missing fields surface as `undefined`.
- [ ] Partial-patch calls to `writeTopLevelState` preserve existing fields across all four new fields (not just the previously-tested shallow-merge fields).
- [ ] Three new unit tests added in `adws/core/__tests__/topLevelState.test.ts` — new-schema round-trip, pre-461 forward-compatible read, and partial-patch preservation of the new fields.
- [ ] All validation commands in the next section exit with code 0.
- [ ] Code adheres to `guidelines/coding_guidelines.md` (strict TS, explicit types, side effects at boundaries, files under 300 lines — the agentState.ts file will remain under 330 lines after the edit).

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — confirms no new lint violations are introduced.
- `bunx tsc --noEmit` — confirms the schema extension type-checks at the repo level.
- `bunx tsc --noEmit -p adws/tsconfig.json` — confirms the schema extension type-checks under the stricter ADW config.
- `bun run test:unit -- topLevelState` — runs the targeted unit suite for top-level state (new and existing cases must all pass).
- `bun run test:unit` — runs the full unit test suite to confirm no regressions in other modules that touch `AgentState` or `writeTopLevelState` (notably `phaseRunner.test.ts`, `remoteReconcile.test.ts`, `processLiveness.test.ts`).
- `bun run build` — confirms the production build still succeeds after the type and writer changes.

## Notes

- Adhere strictly to `guidelines/coding_guidelines.md`: TypeScript strict mode, no `any`, explicit types, isolate side effects (the new `atomicWriteJson` is the only side-effect site touched; the merge logic above it stays pure).
- No new libraries or dependencies are introduced. The atomic writer uses `fs.writeFileSync` + `fs.renameSync` from Node's built-in `fs` module, already imported at the top of `agentState.ts`.
- This slice intentionally does not populate `pid`/`pidStartedAt`/`branchName` at orchestrator launch or write `lastSeenAt` on any schedule. Those writers are the responsibility of the heartbeat and shared-entrypoint-wrapper slices elsewhere in the PRD ("heartbeat", "Shared entrypoint wiring"). Premature wiring here would couple this issue to orchestrator lifecycle work and risk landing half-finished behavior.
- `readTopLevelState` currently parses JSON with no field-level validation. Forward-compatible read is therefore automatic — adding fields to the interface does not change read behavior for files that predate those fields. No migration or backfill script is needed.
- The `.tmp` suffix convention matches common POSIX practice and does not clash with existing file patterns under `AGENTS_STATE_DIR` (no code reads or writes `state.json.tmp` today; a repo-wide grep confirms this before the change lands).
- Once heartbeat lands in a later slice, it will call `writeTopLevelState({lastSeenAt: new Date().toISOString()})` every 30 seconds. The atomic writer here is sized for that cadence: a tmp-file write is ~1KB of I/O and a rename is a single inode update, well under any realistic heartbeat budget.
- BDD feature coverage is out of scope for this issue. The existing BDD suite (`features/top_level_workflow_state_file.feature` per `feature-z16ycm`) continues to validate behavioral contracts around `workflowStage` and the `phases` map. Scenario coverage for the new fields will accompany the heartbeat/takeover slices where those fields are actually read and acted on by the system.
