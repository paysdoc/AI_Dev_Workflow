# Bug: cron `processedSpawns` permanently blocks abandoned-issue recovery (retriable check unreachable)

## Metadata
issueNumber: `653`
adwId: `nj6fsh-fix-cron-processedsp`
issueJson: `{"number":653,"title":"fix: cron processedSpawns permanently blocks abandoned-issue recovery (retriable check unreachable)","state":"OPEN","author":"paysdoc","labels":[]}`

## Bug Description

The cron backlog sweeper (`adws/triggers/trigger_cron.ts`) maintains a module-scope, never-cleared, no-TTL `processedSpawns` set:

```ts
// adws/triggers/trigger_cron.ts:44
const processedSpawns = new Set<number>();
```

An issue number is added to this set when the cron spawns *any* workflow for it (`trigger_cron.ts:318`, just before both the takeover spawn and the fresh-classify spawn). The eligibility filter `evaluateIssue` (`adws/triggers/cronIssueFilter.ts`) consults this set:

```ts
// adws/triggers/cronIssueFilter.ts:130-132
if (processed.spawns.has(issue.number)) {
  return { eligible: false, reason: 'processed' };
}
```

This `processed` short-circuit sits **before** the recovery branches:
- the `retriable` branch (`cronIssueFilter.ts:163-165`) — where `abandoned` lands (`abandoned` → `classifyStageString` → `retriable`, see `adws/core/stageClassifier.ts:56-57`), and
- the `phase_timeout` branch (`cronIssueFilter.ts:170-172`).

**Expected behavior:** an issue the live cron previously spawned that later ends in `abandoned` (crash, watchdog SIGKILL, or the #648 push-deadlock) is re-evaluated, classified `retriable`, and routed to the takeover path (`evaluateCandidate` → reset/reconcile → resume) on a subsequent poll — *without restarting the cron*. The "abandoned is retriable" design (`stageClassifier`) exists precisely for this.

**Actual behavior:** because the issue number is permanently in `processedSpawns`, `evaluateIssue` returns `eligible:false reason:'processed'` and never reaches the `retriable` (or `phase_timeout`) branch. The same cron process can therefore **never** re-spawn it. Recovery is possible only by restarting the cron (which clears the in-memory set) or by a separate process (the webhook, which has no `processedSpawns`). The recovery path is unreachable for exactly the issues that need it: the ones the cron ran and that then crashed.

**Live incident:** #638 sat `abandoned` for ~2 days with a clean, pushable branch. The long-lived cron (alive since before #638 ran) kept filtering it as `processed`. A clean force-push did not help. It recovered only after a manual cron restart cleared `processedSpawns`, after which `abandoned → retriable → takeover` fired immediately. This also explains the broader "abandoned strands" pattern.

## Problem Statement

`processedSpawns` conflates two responsibilities:
1. **Boot-window dedup (legitimate):** stop the cron from re-spawning a workflow it *just* spawned, during the brief window before the child posts its adw-id comment / writes its state file (during which the issue still reads as a fresh candidate). The cron re-polls every `POLL_INTERVAL_MS = 20s`, so without this guard a fresh issue would be spawned repeatedly until its child boots.
2. **Permanent exclusion (the bug):** because the set is never cleared and has no TTL, it *also* permanently excludes the issue from the `retriable`/`phase_timeout` recovery branches for the cron's entire lifetime.

The fix must remove responsibility (2) while preserving responsibility (1), and must not regress the duplicate-spawn protection (`spawnGate` must remain the authoritative concurrency guard).

## Solution Statement

Adopt the issue's option **(a)**: relocate the `processed.spawns` short-circuit so it gates **only the fresh-spawn path** (`stage === null`) — the single path where boot-window dedup is actually needed — and stop letting it short-circuit the stage-class recovery branches.

Concretely, in `cronIssueFilter.ts:evaluateIssue`:
- **Remove** the `processed.spawns.has(...)` check from its current position (lines 130-132, before the grace-period check and before the stage-class branches).
- **Re-add** it as a guard clause at the **top of the `stage === null` (fresh) branch**, before the label-recovery gate.

After this change:
- `stage === null` (truly fresh, or boot window before state/comment is written) → still gated by `processedSpawns` → boot-window dedup **preserved**.
- `abandoned` (→ `retriable`) → reaches the `retriable` branch → `eligible: true, action: 'spawn'` → routed through `evaluateCandidate` (takeover) → **recovers without a cron restart**. **Bug fixed.**
- `phase_timeout` → reaches the `phase_timeout` branch → eligible (and remains bounded by the `resumeAttempts` cap + `escalate_human_gated` in `takeoverHandler.ts`). The same latent defect on this stage is fixed too.
- `active` / `completed` / `paused` / `awaiting_merge` / `discarded` / `merge_blocked` / `human_gated` → unchanged (each is handled by its own dedicated branch).

**Why not drop the set entirely (option c):** the set still earns its keep on the fresh path (the 20s re-poll would otherwise double-spawn a just-spawned issue before its child boots). Keep it, but scope it to the path that needs it.

**Why this preserves AC #2 (no duplicate concurrent spawn):** the on-disk `spawnGate` is the authoritative concurrency guard, independent of `processedSpawns`. Every spawned orchestrator acquires the per-issue spawn lock for its entire lifetime via `runWithOrchestratorLifecycle` (`adws/phases/orchestratorLock.ts:46-61`); if two children ever race, `acquireIssueSpawnLock` lets exactly one win and the loser's `runWithOrchestratorLifecycle` returns `false`, causing it to `process.exit(0)` (`adwSdlc.tsx:138-141`). Two orchestrators never *run* concurrently for one issue.

The change is localized to `cronIssueFilter.ts` (plus its unit tests). `trigger_cron.ts:318` (`processedSpawns.add`), the `ProcessedSets` interface, `handleCancelDirective`'s set mutation, and the region-overlap pass are all untouched and behavior-compatible.

## Steps to Reproduce

### Operational (the live incident)
1. Start a single long-lived cron against a repo.
2. Let the cron spawn an SDLC workflow for issue #N (adds #N to `processedSpawns`).
3. Have that workflow end in `abandoned` (e.g. watchdog SIGKILL via the hung-orchestrator sweep, which writes `workflowStage: 'abandoned'`; see `trigger_cron.ts:110`), leaving a clean resumable branch.
4. Observe subsequent cron polls: #N is logged as `#N(processed)` in the `filtered:` list and is never taken over. It strands until the cron is restarted.

### Deterministic (failing unit test — RED before the fix)
Add to `adws/triggers/__tests__/cronIssueFilter.test.ts`:
```ts
it('abandoned issue already in processedSpawns stays eligible for takeover (#653)', () => {
  const issue = makeIssue({ number: 638, updatedAt: OLD_DATE });
  const resolveStage = () => makeResolution('abandoned', 'adw-638', NOW - 200_000);
  const result = evaluateIssue(issue, NOW, { spawns: new Set([638]) }, GRACE_PERIOD_MS, resolveStage);
  expect(result.eligible).toBe(true);   // FAILS today: returns false, reason 'processed'
  expect(result.action).toBe('spawn');
  expect(result.adwId).toBe('adw-638');
});
```
Before the fix this fails (`eligible:false, reason:'processed'`); after the fix it passes.

## Root Cause Analysis

`evaluateIssue` evaluates checks in a fixed order. The relevant prefix today is:

1. `cancelledThisCycle` → ineligible
2. resolve stage
3. `awaiting_merge` → eligible (merge) — bypasses `processed`
4. `discarded` → ineligible
5. `merge_blocked` → ineligible
6. `human_gated` → ineligible
7. **`processed.spawns.has(n)` → ineligible `'processed'`**  ← line 130 (the defect's location)
8. grace-period check
9. `stage === null` → fresh → eligible (spawn)
10. `completed` → ineligible
11. `paused` → ineligible
12. `active` → ineligible
13. **`retriable` → eligible (spawn)**  ← line 163 (where `abandoned` *should* land)
14. **`phase_timeout` → eligible (spawn)**  ← line 170
15. unknown → ineligible

Because step 7 runs before steps 13 and 14, any issue whose number is in `processedSpawns` is short-circuited as `'processed'` and never reaches the recovery branches. Combined with the set being module-scope, never cleared, and TTL-less (`trigger_cron.ts:44`, added at `:318`), this makes recovery permanently unreachable for any issue the live cron previously spawned — defeating the `stageClassifier`'s "abandoned is retriable" contract for exactly the issues that ran and crashed.

The deeper cause is responsibility conflation: `processedSpawns` is a *boot-window* dedup (bounded, fresh-path concern) being used as a *global, permanent* exclusion gate placed ahead of stage-class routing. Relocating it to the fresh-path branch restores the correct scope.

### Residual analysis (must-not-regress)
After the fix, the **takeover boot window** ("W1") — between the cron releasing the spawn lock right after a takeover spawn (`trigger_cron.ts:325`) and the spawned child re-acquiring it via `runWithOrchestratorLifecycle` — is no longer covered by `processedSpawns` for `retriable` issues (whose stage is non-null, so they never consult the relocated fresh-path check). This is acceptable and **not** a concurrency regression:
- The on-disk `spawnGate` serializes execution: if the next poll lands inside W1 and re-spawns, `acquireIssueSpawnLock` admits exactly one orchestrator; the other exits immediately (`adwSdlc.tsx:138-141`). No split-brain.
- Worst case is one wasted child process and a possibly-redundant `resetWorktreeToRemote` — and for the abandoned-recovery path the worktree is reset to clean remote state anyway, so the reset is idempotent in intent.
- This is the same residual already accepted in the webhook path (`classifyAndSpawnWorkflow`), which has no `processedSpawns` and relies solely on `spawnGate`.
- W1 is bounded by child boot time (seconds: process fork + tsx start + the first `workflowStage` write inside `initializeWorkflow`, which flips the stage off `abandoned` to an `active` value the next poll's `active` branch excludes), which is far below the 20s poll interval in the common case.

An optional future hardening (out of scope here, noted in Notes) would have the cron write an `active`/`resuming` stage before releasing the lock on takeover, closing W1 deterministically.

## Relevant Files

Use these files to fix the bug:

- `adws/triggers/cronIssueFilter.ts` — **primary fix.** `evaluateIssue` holds the mis-ordered `processed.spawns.has` short-circuit (lines 130-132). Relocate it into the `stage === null` branch and update the surrounding documentation comments (the dedup-ordering comment at lines 97-110, the `ProcessedSets` interface doc at lines 52-59, and the `@param processed` doc) to state that the dedup is fresh-path-scoped and must not short-circuit the recovery stages.
- `adws/triggers/__tests__/cronIssueFilter.test.ts` — **regression tests** (AC #3). Add the abandoned-in-`processedSpawns` eligibility test, the parallel `phase_timeout` test, and the fresh-path boot-window-dedup-preserved tests. Mirrors the existing `evaluateIssue` test style (`makeIssue`/`makeResolution`/local `GRACE_PERIOD_MS = 60_000`).
- `adws/triggers/cronStageResolver.ts` — read-only context. `resolveIssueWorkflowStage` produces the `StageResolution` (stage/adwId/lastActivityMs) that `evaluateIssue` routes on; confirms `abandoned` is read from `state.json` `workflowStage`.
- `adws/core/stageClassifier.ts` — read-only context. Confirms `abandoned` → `retriable` (lines 56-57) and `phase_timeout` → `resumable` (the `phase_timeout` literal is routed by its own explicit branch in `evaluateIssue`, not by class). Defines `classifyStageString`.
- `adws/triggers/takeoverHandler.ts` — read-only context. `evaluateCandidate` is the spawn-lock-guarded takeover path the recovered `retriable`/`phase_timeout` issues reach; confirms `spawnGate` is the authoritative concurrency guard and that `phase_timeout` resumes are capped (`nextResumeAction` / `escalate_human_gated`).
- `adws/triggers/spawnGate.ts` — read-only context. `acquireIssueSpawnLock` / `releaseIssueSpawnLock` provide on-disk, cross-cycle/cross-process dedup (AC #2).
- `adws/triggers/trigger_cron.ts` — read-only context. Owns the module-scope `processedSpawns` (line 44), the `.add` site (line 318), the takeover spawn + lock release (lines 320-327), and the `{ spawns: processedSpawns }` wiring. No change required, but confirms call-site compatibility.
- `adws/phases/orchestratorLock.ts` — read-only context. `runWithOrchestratorLifecycle` holds the per-issue spawn lock for the orchestrator's whole lifetime; the loser of a lock race returns `false`. This is what makes the relocation safe (no concurrent execution).
- `adws/triggers/cancelHandler.ts` — read-only context. `handleCancelDirective` mutates `processedSets.spawns` (delete on cancel). The `ProcessedSets`/`MutableProcessedSets` shape is unchanged by this fix, so cancel behavior is unaffected.

### Conditional Documentation (matched via `.adw/conditional_docs.md`)
These docs' conditions match "modifying `evaluateIssue` in `cronIssueFilter.ts` stage eligibility checks" and the `processedSpawns` semantics; consult them while implementing:
- `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` — six-class taxonomy; owns `cronIssueFilter.ts` + `takeoverHandler.ts` + `stageClassifier.ts`; conditions explicitly cover modifying `evaluateIssue` stage-eligibility checks and `classifyStageString`.
- `app_docs/feature-yipjb0-fix-cancel-per-cycle-skip.md` — documents the semantic difference between `processedSpawns` (in-process spawn dedup) and `cancelledThisCycle` (one-cycle skip); directly relevant to scoping the dedup correctly.
- `app_docs/feature-9gjajh-cron-triggers.md` — owns `trigger_cron.ts` / `cronIssueFilter.ts` / `cronStageResolver.ts`.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — owns `takeoverHandler.ts` + `spawnGate.ts` (the recovery path the fix unblocks).
- `app_docs/feature-nq7174-discarded-workflow-stage-foundation.md` — `cronIssueFilter.evaluateIssue` / retriable-vs-terminal stage semantics.
- `app_docs/feature-ni6fpk-serialize-overlapping-region-issues.md` — owns `cronIssueFilter.ts` (the region-overlap pass over spawn candidates; confirm recovered `retriable` issues, which carry `action:'spawn'`, still flow through it unchanged).
- `app_docs/feature-i4m1uk-orchestrator-resilie-takeover-handler-integration.md` — `evaluateCandidate` / `CandidateDecision` takeover behavior.
- `app_docs/feature-y35zbi-cron-recovery-label-eligibility-scan.md` — the label-recovery gate inside the `stage === null` branch (the relocated `processed` check must sit before it).

### New Files
None.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the failing regression tests (RED)
- In `adws/triggers/__tests__/cronIssueFilter.test.ts`, add a new `describe('evaluateIssue — processedSpawns must not block recovery (#653)')` block with:
  - **abandoned + in `processedSpawns` → eligible:** `resolveStage` returns `makeResolution('abandoned', 'adw-638', NOW - 200_000)`, `processed = { spawns: new Set([638]) }`; assert `eligible === true`, `action === 'spawn'`, `adwId === 'adw-638'`.
  - **phase_timeout + in `processedSpawns` → eligible:** `makeResolution('phase_timeout', 'tg4om4', NOW - 200_000)`, `processed` contains the issue number; assert `eligible === true`, `action === 'spawn'`, `adwId === 'tg4om4'`.
  - **fresh (`stage === null`) + in `processedSpawns` → ineligible `'processed'`** (boot-window dedup preserved): `makeResolution(null)`, `processed` contains the number; assert `eligible === false`, `reason === 'processed'`.
  - **fresh (`stage === null`) + NOT in `processedSpawns` → eligible** (unchanged): assert `eligible === true`, `action === 'spawn'`.
- Add a `filterEligibleIssues` test: an `abandoned` issue whose number is in `processedSpawns` appears in `eligible` (with `action:'spawn'`) and is NOT present in `filteredAnnotations` as `(processed)`.
- Run `bunx vitest run adws/triggers/__tests__/cronIssueFilter.test.ts` and confirm the new abandoned/phase_timeout/filter tests FAIL (RED) while the existing suite still passes.

### 2. Relocate the `processed.spawns` short-circuit (GREEN)
- In `adws/triggers/cronIssueFilter.ts:evaluateIssue`, delete the existing check:
  ```ts
  if (processed.spawns.has(issue.number)) {
    return { eligible: false, reason: 'processed' };
  }
  ```
  (currently lines 130-132, between the `human_gated` branch and the grace-period check).
- Add it as the **first guard clause inside the `stage === null` branch**, before the label-recovery gate:
  ```ts
  const { stage } = resolution;
  if (stage === null) {
    // processedSpawns dedups the FRESH first spawn only: it guards the boot window
    // between this cron spawning a workflow and the child writing its state /
    // posting its adw-id comment (during which the issue still reads as fresh and
    // would be re-spawned every poll). It must NOT gate the recovery branches
    // below (retriable / phase_timeout): an abandoned issue this cron already
    // spawned must remain eligible for takeover, or it strands for the cron's
    // entire lifetime (issue #653). The on-disk spawnGate (acquired in
    // evaluateCandidate / runWithOrchestratorLifecycle) is the authoritative
    // concurrency guard for in-progress work.
    if (processed.spawns.has(issue.number)) {
      return { eligible: false, reason: 'processed' };
    }
    if (resolution.adwId === null && labelRecovery) {
      const labelResult = labelRecovery(issue);
      if (!labelResult.eligible) {
        return { eligible: false, reason: `label:${labelResult.reason}` };
      }
    }
    return { eligible: true, action: 'spawn' };
  }
  ```
- Do not change the `ProcessedSets` interface, `filterEligibleIssues`, `trigger_cron.ts`, or `cancelHandler.ts`.

### 3. Update the explanatory comments
- Update the dedup-ordering comment block above `const resolution = resolveStage(issue.comments);` (currently lines 97-110) so it states that the spawn dedup is applied **only on the fresh `stage === null` path** and must not short-circuit `awaiting_merge` **or** the recovery stages (`retriable`/`phase_timeout`).
- Update the `ProcessedSets` interface doc (lines 52-59) and the `@param processed` line in the `evaluateIssue` JSDoc to describe `spawns` as a **fresh-spawn boot-window** dedup set (not a permanent global exclusion).

### 4. Verify GREEN and zero regressions
- Re-run `bunx vitest run adws/triggers/__tests__/cronIssueFilter.test.ts`; confirm all new tests pass and every pre-existing test in the file still passes (notably `merge_blocked takes precedence over processed-spawn dedup`, the `phase_timeout eligibility` block, and the label-recovery block).

### 5. Run the full Validation Commands
- Execute every command in the `Validation Commands` section below and confirm each exits clean.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bunx vitest run adws/triggers/__tests__/cronIssueFilter.test.ts` — targeted: the new #653 tests pass; pre-existing `evaluateIssue`/`filterEligibleIssues` tests still pass (reproduces the bug RED before the fix, GREEN after).
- `bun run lint` — ESLint clean (`eslint .`).
- `bunx tsc --noEmit` — root type-check passes (no type regressions).
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check passes.
- `bun run test:unit` — full vitest suite passes (`vitest run`), confirming no cross-module regression (cron triggers, takeover, stage classifier).
- `bun run build` — `tsc` build succeeds with no errors.

## Notes
- Coding guidelines (`.adw/coding_guidelines.md`) apply: the fix uses a guard clause (early return) inside the fresh branch, keeps `evaluateIssue` flat (no added nesting depth), preserves immutability (read-only `ReadonlySet`), and changes no public types. No new library is required (`bun add <package>` would be the install command if one were).
- This bug is **independent of #648**: #648's push-deadlock was merely one *cause* of #638's `abandoned` state. The `processedSpawns` defect blocks recovery from *any* abandoned cause (crash, watchdog kill, push-deadlock).
- The fix also silently repairs the same latent defect for `phase_timeout` recovery (issue #637's stage), which was equally downstream of the mis-ordered `processed` check. `phase_timeout` re-spawns remain bounded by the `resumeAttempts` cap + `escalate_human_gated` in `takeoverHandler.ts` (issue #639), so this does not introduce a money-fire loop.
- Behavior-precedence note (cosmetic, no test depends on it): moving the `processed` check to after the grace-period check means a fresh, already-spawned issue with *recent* activity is now annotated `(grace_period)` instead of `(processed)` in the `filtered:` log line. Both outcomes are ineligible; eligibility is unchanged.
- `GRACE_PERIOD_MS = 300_000` (5 min, `adws/core/config.ts:79`) still applies before the recovery branches, so a recovered `abandoned` issue becomes eligible ~5 min after its last phase activity — the same grace a fresh cron (or a restarted cron) already imposes. The unit tests use the file's local `GRACE_PERIOD_MS = 60_000` with `lastActivityMs = NOW - 200_000`, matching the existing `phase_timeout` tests.
- Optional future hardening (out of scope; do **not** implement here): have the cron write an `active`/`resuming` `workflowStage` before `releaseIssueSpawnLock` on the takeover path (`trigger_cron.ts:320-327`) to deterministically close the takeover boot window ("W1") described in Root Cause Analysis. Not required for this fix — `spawnGate` already prevents concurrent execution, satisfying AC #2.
