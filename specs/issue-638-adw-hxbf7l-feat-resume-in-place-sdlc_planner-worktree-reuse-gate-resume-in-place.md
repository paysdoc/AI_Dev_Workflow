# Feature: Resume-in-place via a worktree-reuse gate for recoverable stages

## Metadata
issueNumber: `638`
adwId: `hxbf7l-feat-resume-in-place`
issueJson: `{"number":638,"title":"feat: resume-in-place via worktreeReuseGate for recoverable stages","body":"## Parent PRD\n\n`specs/prd/stage-recovery-resume-in-place.md`\n\n## What to build\n\nA pure `decideWorktreeReuse(probe)` over a `WorktreeProbe` capturing Class-A git-operability signals (orphaned vs live-held `index.lock`, interrupted rebase/merge/cherry-pick, HEAD vs expected branch, locked/prunable, live owner). A thin probing shell gathers the signals. Takeover reuses a healthy worktree in place instead of resetting — for **both** `abandoned` and `phase_timeout` (unified) — and resets to remote only when the gate fails. Class-B content health is explicitly not assessed here; existing blocking end-verification + HITL on destructive diffs remain the junk gate. See PRD \"Solution\" and \"Implementation Decisions\" (worktree-reuse gate, unified resume-in-place, recovery ordering).\n\n## Acceptance criteria\n\n- [ ] Healthy worktree (gate passes) is reused in place; uncommitted work preserved\n- [ ] Unhealthy worktree (lock held by live PID, interrupted rebase/merge, wrong HEAD, locked/prunable, live owner) → reset-from-remote\n- [ ] Applies to both `abandoned` and `phase_timeout`\n- [ ] Recovery only reuses a confirmed-dead run's worktree (kill → confirm dead → probe → decide)\n- [ ] Destructive diffs remain HITL-gated through resume\n- [ ] Table-style unit tests over `WorktreeProbe` permutations\n\n## Blocked by\n\n- Blocked by #637\n\n## User stories addressed\n\n- User story 3\n- User story 9\n- User story 10\n- User story 11\n- User story 12\n- User story 15\n- User story 20","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-19T17:38:12Z","comments":[],"actionableComment":null}`

## Feature Description

When a workflow's orchestrator dies — either marked `abandoned` (heartbeat/liveness reclaim) or rested at `phase_timeout` (the per-phase watchdog killed the wedged Claude process tree and `handlePhaseTimeout` called `process.exit(0)`) — the next cron tick or webhook event reclaims the issue through the takeover gate (`evaluateCandidate` in `adws/triggers/takeoverHandler.ts`). As shipped in #637, that takeover **always** runs `recoverViaResetFromRemote`: it hard-resets the worktree to `origin/<branch>` (`git fetch` + `git reset --hard` + `git clean -fdx`), discarding **every** piece of unpushed local work — staged, unstaged, untracked, and unpushed commits — before resuming.

For a worktree that died mid-phase but is still **git-operable** (no interrupted rebase/merge, HEAD on the right branch, no live process holding it), that reset is wasteful and destructive: it throws away exactly the in-progress work the resumed phase would otherwise continue from. The watchdog firing during a long build, for example, leaves a perfectly valid working tree full of uncommitted progress — and #637 nukes it on every recovery.

This feature introduces a **worktree-reuse gate**: a pure `decideWorktreeReuse(probe: WorktreeProbe)` over a small set of **Class-A git-operability signals**, fed by a thin probing shell that reads the real worktree. When the gate passes (the worktree is healthy and its owner is confirmed dead), takeover **resumes in place** — it preserves the worktree (uncommitted work intact), clears only an orphaned `index.lock`, and derives the resume stage from remote exactly as before. When the gate fails (lock held by a live PID, interrupted rebase/merge/cherry-pick, wrong HEAD, the worktree is `locked`/`prunable`, or a live owner is detected), takeover falls back to the existing reset-from-remote path. This applies uniformly to **both** `abandoned` and `phase_timeout` (the two recoverable, confirmed-dead resting stages are unified onto one resume-in-place-capable recovery path).

Crucially, the gate assesses **only git-operability (Class-A)** — *can git safely continue working in this directory?* It deliberately does **not** assess **content health (Class-B)** — *is the work any good?* Content quality remains the responsibility of the existing blocking end-verification (scenario tests, passive review) and the human-in-the-loop gate on destructive diffs, which continue to run unchanged after a resume. The reuse gate never lets unreviewed or junk work bypass those gates; it only decides whether to keep or discard the working directory.

## User Story

As an ADW operator
I want a timed-out or abandoned workflow whose worktree is still git-healthy to resume in place — keeping its uncommitted work — instead of being hard-reset to the remote on every takeover
So that recoverable in-progress work survives a watchdog kill or liveness reclaim, while genuinely corrupted or still-live worktrees are detected and cleanly reset, and the content-quality gates (end-verification + HITL on destructive diffs) still run before anything merges.

## Problem Statement

`evaluateCandidate` currently routes both recoverable confirmed-dead stages — `abandoned` (the `retriable` class) and `phase_timeout` (a per-consumer raw-stage branch added in #637) — straight through `recoverViaResetFromRemote`, which **unconditionally** hard-resets the worktree to `origin/<branch>` before deriving the resume stage. The takeoverHandler's own inline comment and the `feature-d0hv98-exhaustive-stage-classifier.md` living doc both flag this as a deliberate placeholder:

> *"Resume-in-place is out of scope. The current `phase_timeout` recovery is reset-from-remote takeover (same path as `abandoned`). Actual in-place phase re-entry is a later PRD slice."*

The consequences of always-reset:

1. **Recoverable work is destroyed.** A worktree that died mid-build/mid-test with a clean git state and valid uncommitted progress is reset to the last pushed commit on every takeover. The resumed phase restarts from remote instead of continuing local progress — wasted agent time and tokens, and lost work that was never the problem.
2. **No distinction between "git-corrupted" and "git-healthy".** The reset path is a sledgehammer that's only *necessary* when the worktree is actually unusable (interrupted rebase/merge, a live process still holding it, a stale lock from a live owner, wrong HEAD, an unregistered/prunable worktree). For every other case it is pure loss.
3. **`abandoned` and `phase_timeout` are not unified.** They are two separate branches that happen to call the same helper; there is no single seam where the reuse-vs-reset decision lives, so future recovery work has to touch both.

There is no mechanism to inspect a worktree's git-operability and decide, deterministically and testably, whether it is safe to reuse. That decision must be a **pure function** (table-testable over signal permutations, per the acceptance criteria) with all I/O isolated in a thin probing shell — matching the codebase's established pattern (`stageClassifier`, `resolveVerdict`, `progressGate`, `hungOrchestratorDetector`: pure cores, injected I/O).

## Solution Statement

Add a pure **worktree-reuse gate** and a thin **probing shell**, then route the two recoverable stages through the gate inside `evaluateCandidate`:

1. **`adws/vcs/worktreeReuseGate.ts` (new, pure).** Define `WorktreeProbe` — a small readonly record of Class-A signals — and `decideWorktreeReuse(probe): WorktreeReuseDecision`, a guard-clause function returning `{ reuse: true }` only when **all** health conditions hold, else `{ reuse: false, reason }` with a typed reset reason. No I/O, no imports beyond types. This is the headline table-tested unit.

2. **`adws/vcs/worktreeProbe.ts` (new, thin shell).** `probeWorktree(input, deps?)` gathers the signals from a real worktree — `git worktree list --porcelain` (registration: healthy/locked/prunable/missing), `<gitdir>/index.lock` presence combined with recorded-owner liveness (`absent`/`orphaned`/`live_held`), interrupted-op markers (`rebase-merge`/`rebase-apply` → rebase, `MERGE_HEAD` → merge, `CHERRY_PICK_HEAD` → cherry_pick), `git symbolic-ref --short HEAD` vs the expected branch, and the live-owner check (recorded `pid`+`pidStartedAt` via `isProcessLive`). All I/O is injected via a `ProbeDeps` interface (default deps wire `execSync`/`fs`/`isProcessLive`), so the shell is unit-testable without real git. A small `clearOrphanedIndexLock(worktreePath, deps?)` removes a stale `index.lock` so the resumed orchestrator's first git op doesn't fail with "File exists".

3. **`adws/triggers/takeoverHandler.ts` (modify).** Extend `TakeoverDeps` with `probeWorktree` and `clearOrphanedIndexLock`. Refactor the existing reset tail so the shared step is `takeOverWithDerivedStage` (derive stage → `take_over_adwId`); `recoverViaResetFromRemote` resets, then calls it. Add `recoverViaResumeInPlaceOrReset(d, input, adwId, state)`:
   - No `branchName` → nothing to probe or reset → `takeOverWithDerivedStage` (unchanged semantics).
   - Else probe the worktree, run `decideWorktreeReuse`:
     - **reuse** → clear an orphaned lock if present, **skip the reset** (uncommitted work preserved), `takeOverWithDerivedStage`.
     - **reset** → `recoverViaResetFromRemote` (existing behavior).
   - Route **both** the `retriable` (abandoned) branch and the `phase_timeout` raw-stage branch through this one dispatcher — unifying them onto a single resume-in-place-capable seam. The `active` (`*_running`) branch keeps its current SIGKILL-if-live → reset behavior (out of scope here; see Notes).

4. **Recovery ordering — "kill → confirm dead → probe → decide."** For `abandoned`/`phase_timeout` the orchestrator is already dead (abandoned = liveness-reclaimed; `phase_timeout` already `process.exit(0)`'d), and #637 deliberately issues **no** SIGKILL on these branches. The "confirmed dead" precondition is enforced two ways: the spawn-lock acquisition at the top of `evaluateCandidate` guarantees no live holder, and the probe's **`liveOwner`** signal (recorded PID still live) forces `reset` — so a surprise-live owner is **never** reused in place. The decision shape returned to cron/webhook is **unchanged** (`{ kind: 'take_over_adwId', adwId, derivedStage }`), so every downstream consumer — including the blocking end-verification, passive review, and the HITL-on-destructive-diffs gate — runs exactly as before. Resume-in-place changes *only* whether the working directory is kept or wiped; it never bypasses a content-quality gate.

5. **Truthful comments.** Update the takeoverHandler decision-tree header and the `phase_timeout` inline comment (which currently says resume-in-place is "a later slice") to describe the now-implemented gate.

**Class-B is explicitly out of scope.** `decideWorktreeReuse` never inspects diff content, test results, or work quality. The junk gate stays where it is: blocking end-verification + HITL on destructive diffs.

## Relevant Files

Use these files to implement the feature:

### Source — the change
- `adws/triggers/takeoverHandler.ts` — **the integration point.** `evaluateCandidate` (decision tree), `recoverViaResetFromRemote` (lines ~99–111), the `retriable` branch (lines ~158–160), and the `phase_timeout` raw-stage branch (lines ~162–168). Extend `TakeoverDeps`/`buildDefaultTakeoverDeps`, extract `takeOverWithDerivedStage`, add `recoverViaResumeInPlaceOrReset`, and route the two recoverable stages through it. Update the header comment (lines 1–18) and the `phase_timeout` inline comment. Keep the file <300 lines (coding guideline); it is ~189 lines today.

### Source — read-only reference (do NOT modify)
- `adws/vcs/worktreeReset.ts` — `resetWorktreeToRemote(worktreePath, branch)`: the existing reset primitive reused on the gate's reset branch. Already aborts in-progress merge/rebase, then `fetch`/`reset --hard`/`clean -fdx`. Mirror its `resolveGitDir` + interrupted-op-marker detection patterns (`MERGE_HEAD`, `rebase-apply`/`rebase-merge`) in the probe. No change.
- `adws/vcs/worktreeOperations.ts` — `getWorktreePath(branchName, baseRepoPath?)` (used to locate the worktree) and the `git worktree list --porcelain` parsing patterns (`getMainRepoPath`, `worktreeExists`) the probe's registration check mirrors. No change.
- `adws/core/remoteReconcile.ts` — `deriveStageFromRemote(issueNumber, adwId, repoInfo)`: read-only stage derivation (branch existence + PR state → stage) reused on **both** the reuse and reset branches. It does not touch the worktree, so it composes cleanly with resume-in-place. No change.
- `adws/core/processLiveness.ts` — `isProcessLive(pid, pidStartedAt)`: PID-reuse-safe liveness, the basis of the probe's `liveOwner` signal and the orphaned-vs-live-held lock distinction. No change.
- `adws/core/stageClassifier.ts` — `classifyStage`/`classifyStageString`. `phase_timeout` stays `resumable`; `abandoned` stays `retriable`. **No reclassification** — recovery stays pinned per-consumer (the cron/takeover stage-predicate divergence lesson). Confirm unchanged.
- `adws/triggers/cronIssueFilter.ts` — `evaluateIssue` already makes `abandoned` (line ~149–150) and `phase_timeout` (line ~156–158) eligible (#637). **This feature is takeover-only; do not modify the cron filter.** Read to confirm the eligibility branches are intact (regression).
- `adws/triggers/trigger_cron.ts` / `adws/triggers/webhookGatekeeper.ts` — the two consumers of `evaluateCandidate`. They spawn `adwSdlc.tsx` with the existing `adwId` + `derivedStage` on `take_over_adwId`. The decision shape is unchanged, so both paths get resume-in-place for free. No change.
- `adws/types/agentTypes.ts` — `AgentState` fields the probe reads: `branchName?`, `pid?`, `pidStartedAt?`, `workflowStage?` (all optional). No change.
- `adws/types/workflowTypes.ts` — the `WorkflowStage` union (`abandoned`, `phase_timeout`). No change.

### New Files
- `adws/vcs/worktreeReuseGate.ts` — pure gate. Exports `WorktreeProbe`, `WorktreeReuseDecision`, `WorktreeResetReason`, and `decideWorktreeReuse(probe): WorktreeReuseDecision`. No I/O.
- `adws/vcs/worktreeProbe.ts` — thin probing shell. Exports `ProbeInput`, `ProbeDeps`, `probeWorktree(input, deps?): WorktreeProbe`, `clearOrphanedIndexLock(worktreePath, deps?)`, and `buildDefaultProbeDeps()`. All git/fs/liveness I/O injected.
- `adws/vcs/__tests__/worktreeReuseGate.test.ts` — **table-style** unit tests over `WorktreeProbe` permutations (the primary acceptance proof).
- `adws/vcs/__tests__/worktreeProbe.test.ts` — probe signal-gathering tests with injected `ProbeDeps` (orphaned-vs-live-held combination, interrupted-op detection, head comparison, registration parse, orphaned-lock clearing).

### Tests — modify
- `adws/triggers/__tests__/takeoverHandler.test.ts` — add `probeWorktree`/`clearOrphanedIndexLock` to `makeDeps`; **update** the existing `take_over_adwId from abandoned` and `take_over_adwId from phase_timeout` blocks so the reset assertions are gated on an **unhealthy** probe, and add **reuse** cases (healthy probe → no `resetWorktree`, `deriveStageFromRemote` still called, orphaned lock cleared). Keep the `*_running`/`skip_terminal`/`spawn_fresh`/`defer_live_holder` blocks unchanged (regression — the `active` path is not modified).

### Conditional documentation (matched conditions in `.adw/conditional_docs.md` — read before implementing; the document phase updates these, does not create new docs)
- `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` — **primary; `Owns` `takeoverHandler.ts`.** Matched conditions: "modifying `evaluateCandidate`… or the stage-dispatch logic, including `recoverViaResetFromRemote`", "adding a per-consumer raw-stage recovery branch", and "understanding how `phase_timeout` recovery works (reset-from-remote takeover, **not** resume-in-place)" — this feature changes that recovery from reset-always to gated reuse. The doc's "Resume-in-place is out of scope" gotcha and the `phase_timeout` routing rows must be updated to describe the gate.
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — `Owns adws/vcs/**`; the new `worktreeReuseGate.ts` + `worktreeProbe.ts` modules and their responsibilities/invariants belong here.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — `Owns takeoverHandler.ts`; the takeover decision tree and `TakeoverDeps` surface. Background for the recovery-ordering change.

## Implementation Plan

### Phase 1: Foundation
Build the pure decision core and its probing shell as standalone `adws/vcs/` modules with no dependency on takeover. Define `WorktreeProbe` to capture exactly the Class-A signals named in the acceptance criteria (orphaned-vs-live-held lock, interrupted rebase/merge/cherry-pick, HEAD vs expected branch, locked/prunable registration, live owner). Write the table-style gate tests first (red), then implement `decideWorktreeReuse` to green. Implement the probe shell with injected `ProbeDeps` and test the signal gathering (including the orphaned-vs-live-held combination and orphaned-lock clearing).

### Phase 2: Core Implementation
Wire the gate into `evaluateCandidate`. Extend `TakeoverDeps` with `probeWorktree` + `clearOrphanedIndexLock`; refactor the reset tail into `takeOverWithDerivedStage`; add `recoverViaResumeInPlaceOrReset`; route the `retriable` (abandoned) and `phase_timeout` branches through it (unified). Preserve the `active` branch and the `take_over_adwId` decision shape exactly.

### Phase 3: Integration
Update the existing takeoverHandler tests to the new gated behavior and add reuse cases. Correct the truthful comments (header + `phase_timeout` inline + the living docs the document phase will route to). Confirm the consumers (`trigger_cron`, `webhookGatekeeper`) and the HITL/end-verification pipeline are untouched, then run the full validation suite for zero regressions.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1 — Read references and confirm the contract
- Read `.adw/coding_guidelines.md` and the three matched conditional docs above (at minimum `feature-d0hv98`, `feature-9gjajh-worktree-and-vcs`).
- Confirm in `adws/triggers/takeoverHandler.ts` the current shape of `recoverViaResetFromRemote`, the `retriable` branch, and the `phase_timeout` branch, and that both call `recoverViaResetFromRemote`.
- Confirm in `adws/triggers/cronIssueFilter.ts` that `abandoned` and `phase_timeout` are already eligible (#637) — **do not modify the cron filter.**
- Confirm `adws/core/remoteReconcile.ts` `deriveStageFromRemote` performs no worktree I/O (so it is safe to call on the reuse branch), and `adws/core/processLiveness.ts` `isProcessLive(pid, pidStartedAt)` signature.
- Confirm `adws/core/stageClassifier.ts` keeps `abandoned: retriable` and `phase_timeout: resumable` (no reclassification in this slice).

### Step 2 — Write the gate's table tests (red) — `adws/vcs/__tests__/worktreeReuseGate.test.ts`
- Build a `healthyProbe()` factory returning an all-clear `WorktreeProbe`, plus per-test overrides (mirrors the `makeState`/`makeDeps` factory pattern in `takeoverHandler.test.ts`).
- Add a **table** of cases asserting `decideWorktreeReuse`:
  - all-clear (lock `absent`, op `none`, head on branch, registration `healthy`, no live owner) → `{ reuse: true }`.
  - lock `orphaned` (otherwise healthy) → `{ reuse: true }` (uncommitted work preserved; lock cleared on reuse).
  - lock `live_held` → `{ reuse: false, reason: 'index_lock_live_held' }`.
  - `liveOwner: true` → `{ reuse: false, reason: 'live_owner' }`.
  - interrupted `rebase`/`merge`/`cherry_pick` → `{ reuse: false, reason: 'interrupted_rebase'|'interrupted_merge'|'interrupted_cherry_pick' }`.
  - `headOnExpectedBranch: false` → `{ reuse: false, reason: 'wrong_head' }`.
  - registration `locked`/`prunable`/`missing` → `{ reuse: false, reason: 'worktree_locked'|'worktree_prunable'|'worktree_missing' }`.
  - **precedence**: a probe that is simultaneously `liveOwner: true` and `headOnExpectedBranch: false` → `live_owner` (the confirmed-dead precondition is checked first).

### Step 3 — Implement the pure gate — `adws/vcs/worktreeReuseGate.ts`
- Define the types (readonly, no `any`):
  ```ts
  export interface WorktreeProbe {
    readonly registration: 'healthy' | 'locked' | 'prunable' | 'missing';
    readonly indexLock: 'absent' | 'orphaned' | 'live_held';
    readonly interruptedOp: 'none' | 'rebase' | 'merge' | 'cherry_pick';
    readonly headOnExpectedBranch: boolean;
    readonly liveOwner: boolean;
  }
  export type WorktreeResetReason =
    | 'live_owner' | 'index_lock_live_held'
    | 'interrupted_rebase' | 'interrupted_merge' | 'interrupted_cherry_pick'
    | 'wrong_head' | 'worktree_locked' | 'worktree_prunable' | 'worktree_missing';
  export type WorktreeReuseDecision =
    | { readonly reuse: true }
    | { readonly reuse: false; readonly reason: WorktreeResetReason };
  ```
- Implement `decideWorktreeReuse` as guard clauses in this order (confirmed-dead precondition first, then operability, then registration; an orphaned/absent lock never blocks reuse):
  ```ts
  export function decideWorktreeReuse(probe: WorktreeProbe): WorktreeReuseDecision {
    if (probe.liveOwner) return { reuse: false, reason: 'live_owner' };
    if (probe.indexLock === 'live_held') return { reuse: false, reason: 'index_lock_live_held' };
    if (probe.interruptedOp === 'rebase') return { reuse: false, reason: 'interrupted_rebase' };
    if (probe.interruptedOp === 'merge') return { reuse: false, reason: 'interrupted_merge' };
    if (probe.interruptedOp === 'cherry_pick') return { reuse: false, reason: 'interrupted_cherry_pick' };
    if (!probe.headOnExpectedBranch) return { reuse: false, reason: 'wrong_head' };
    if (probe.registration === 'locked') return { reuse: false, reason: 'worktree_locked' };
    if (probe.registration === 'prunable') return { reuse: false, reason: 'worktree_prunable' };
    if (probe.registration === 'missing') return { reuse: false, reason: 'worktree_missing' };
    return { reuse: true };
  }
  ```
- Run `bunx vitest run adws/vcs/__tests__/worktreeReuseGate.test.ts` → green.

### Step 4 — Implement the probing shell — `adws/vcs/worktreeProbe.ts`
- Define injected I/O and inputs:
  ```ts
  export interface ProbeInput {
    readonly worktreePath: string;
    readonly expectedBranch: string;
    readonly recordedPid?: number;
    readonly recordedPidStartedAt?: string;
  }
  export interface ProbeDeps {
    readonly existsSync: (p: string) => boolean;
    readonly resolveGitDir: (worktreePath: string) => string | null;   // null when not a worktree (→ 'missing')
    readonly currentBranch: (worktreePath: string) => string | null;   // git symbolic-ref --short HEAD
    readonly worktreeRegistration: (worktreePath: string) => 'healthy' | 'locked' | 'prunable' | 'missing';
    readonly isProcessLive: (pid: number, pidStartedAt: string) => boolean;
  }
  ```
- `probeWorktree(input, deps = buildDefaultProbeDeps())` computes, with guard clauses (≤2 nesting):
  - `ownerLive = recordedPid !== undefined && !!recordedPidStartedAt && deps.isProcessLive(recordedPid, recordedPidStartedAt)`.
  - `registration = deps.worktreeRegistration(worktreePath)`; resolve `gitDir = deps.resolveGitDir(worktreePath)`. If `gitDir === null` → return a probe with `registration: 'missing'` (and benign defaults) so the gate resets without the shell throwing.
  - `indexLock`: `deps.existsSync(join(gitDir,'index.lock'))` → `ownerLive ? 'live_held' : 'orphaned'`, else `'absent'`.
  - `interruptedOp`: `rebase-merge`/`rebase-apply` → `'rebase'`; else `MERGE_HEAD` → `'merge'`; else `CHERRY_PICK_HEAD` → `'cherry_pick'`; else `'none'` (extract a small `detectInterruptedOp(gitDir, deps)` helper).
  - `headOnExpectedBranch`: `deps.currentBranch(worktreePath) === expectedBranch`.
  - `liveOwner`: `ownerLive`.
- `clearOrphanedIndexLock(worktreePath, deps = buildDefaultProbeDeps())`: resolve git dir, `rmSync(join(gitDir,'index.lock'), { force: true })` only if present. (Reuse-side effect; safe no-op when absent.)
- `buildDefaultProbeDeps()` wires real I/O: `fs.existsSync`/`fs.rmSync`, a `resolveGitDir` mirroring `worktreeReset.ts` (`git rev-parse --git-dir`, absolutize, return `null` on failure), `git symbolic-ref --short HEAD` (return `null` on failure), a `git worktree list --porcelain` parser keyed on the worktree path detecting `locked`/`prunable` annotations (`missing` when the path is absent from the list), and `isProcessLive` from `processLiveness`.
- Keep the file <300 lines; isolate every `execSync`/`fs` call inside `buildDefaultProbeDeps` so the exported functions stay testable.

### Step 5 — Write probe tests — `adws/vcs/__tests__/worktreeProbe.test.ts`
- Inject a fake `ProbeDeps` (plain object of `vi.fn()`s — no `vi.mock` needed since I/O is a parameter). Assert:
  - lock present + dead owner → `indexLock: 'orphaned'`; lock present + live owner → `indexLock: 'live_held'`; lock absent → `'absent'`.
  - `liveOwner` true only when `recordedPid` + `recordedPidStartedAt` present and `isProcessLive` true; missing pid/startedAt → `false`.
  - interrupted-op precedence: rebase markers win over `MERGE_HEAD`; `MERGE_HEAD` over `CHERRY_PICK_HEAD`.
  - `headOnExpectedBranch` reflects `currentBranch === expectedBranch` (and `false` when `currentBranch` is `null`).
  - `resolveGitDir` returning `null` → `registration: 'missing'` and no throw.
  - `clearOrphanedIndexLock` removes the lock only when present; no-throw when absent.

### Step 6 — Extend `TakeoverDeps` and refactor the reset tail — `adws/triggers/takeoverHandler.ts`
- Import `decideWorktreeReuse` (and the `WorktreeProbe` type) from `../vcs/worktreeReuseGate`, and `probeWorktree`/`clearOrphanedIndexLock` from `../vcs/worktreeProbe`.
- Add to `TakeoverDeps`:
  ```ts
  readonly probeWorktree: (worktreePath: string, expectedBranch: string, recordedPid?: number, recordedPidStartedAt?: string) => WorktreeProbe;
  readonly clearOrphanedIndexLock: (worktreePath: string) => void;
  ```
  and wire them in `buildDefaultTakeoverDeps` (call `probeWorktree(...)` / `clearOrphanedIndexLock(...)` with default probe deps).
- Extract the shared tail:
  ```ts
  function takeOverWithDerivedStage(d, input, adwId): CandidateDecision {
    const derivedStage = d.deriveStageFromRemote(input.issueNumber, adwId, input.repoInfo);
    return { kind: 'take_over_adwId', adwId, derivedStage };
  }
  ```
  and rewrite `recoverViaResetFromRemote` to reset (when `branchName` is set) then `return takeOverWithDerivedStage(d, input, adwId)` — behavior-preserving for the `active` branch.

### Step 7 — Add the resume-in-place dispatcher and route the two recoverable stages
- Add:
  ```ts
  function recoverViaResumeInPlaceOrReset(d, input, adwId, state): CandidateDecision {
    if (!state.branchName) return takeOverWithDerivedStage(d, input, adwId); // nothing to probe/reset
    const wtPath = d.getWorktreePath(state.branchName);
    const probe = d.probeWorktree(wtPath, state.branchName, state.pid, state.pidStartedAt);
    const decision = decideWorktreeReuse(probe);
    if (!decision.reuse) return recoverViaResetFromRemote(d, input, adwId, state); // unhealthy → reset
    if (probe.indexLock === 'orphaned') d.clearOrphanedIndexLock(wtPath);          // healthy → resume in place
    return takeOverWithDerivedStage(d, input, adwId);
  }
  ```
- In `evaluateCandidate`, change the `retriable` branch and the `phase_timeout` branch to both `return recoverViaResumeInPlaceOrReset(d, input, adwId, state)` (the **unified** seam). Leave the `active` (`*_running`) branch calling `recoverViaResetFromRemote` after SIGKILL-if-live (unchanged), and leave the `terminal`/`spawn_fresh` branches untouched.
- Do **not** change the `CandidateDecision` union or the returned object shape — cron/webhook consumers and their tests must see an identical `take_over_adwId` payload.

### Step 8 — Correct the comments (truthfulness)
- Update the `evaluateCandidate` header comment (decision-tree block, lines ~1–18) so the `abandoned` and `phase_timeout` rows read "probe worktree → reuse-in-place if healthy, else reset-from-remote → reconcile → take_over".
- Replace the `phase_timeout` inline comment that says *"(Resume-in-place is a later slice …)"* with one describing the implemented gate (healthy worktree resumes in place preserving uncommitted work; unhealthy resets), noting no SIGKILL (orchestrator already exited) and that the `liveOwner` probe signal is the confirmed-dead safety net.

### Step 9 — Update takeover tests for the gated behavior — `adws/triggers/__tests__/takeoverHandler.test.ts`
- Add `probeWorktree` and `clearOrphanedIndexLock` to `makeDeps` (default `probeWorktree` returns a **healthy** probe → reuse; tests that want reset override it with an unhealthy probe). Add a `healthyProbe()`/`unhealthyProbe(reason)` helper.
- **Update** `take_over_adwId from abandoned`:
  - healthy probe → `kind: 'take_over_adwId'`, `resetWorktree` **not** called, `deriveStageFromRemote` called once, `probeWorktree` called with the branch worktree path + `branchName`, `clearOrphanedIndexLock` called iff the probe reports an orphaned lock, lock **not** released.
  - unhealthy probe (e.g. interrupted rebase) → `resetWorktree` called **before** `deriveStageFromRemote` (the prior assertion, now gated on unhealthy).
  - no `branchName` → neither `probeWorktree` nor `resetWorktree` called; `deriveStageFromRemote` still called.
- **Update** `take_over_adwId from phase_timeout` with the same healthy/unhealthy/no-branch cases, plus the existing defensive check that a live `pid` does **not** trigger `killProcess` on this branch.
- Add a focused reuse assertion: healthy probe with `indexLock: 'orphaned'` → `clearOrphanedIndexLock(wtPath)` called and `resetWorktree` **not** called (uncommitted work preserved).
- Leave `*_running`/`skip_terminal`/`spawn_fresh`/`defer_live_holder`/`paused` blocks unchanged (the `active` path still resets; regression proof).

### Step 10 — Refactor pass for coding guidelines
- Re-read `.adw/coding_guidelines.md`. Confirm: new modules are pure / injected-I/O, explicitly typed (no `any`), guard-clause style (≤2 nesting; extract `detectInterruptedOp`), declarative; `evaluateCandidate` still reads top-to-bottom as guarded dispatch; no unused imports; every new file and `takeoverHandler.ts` stay well under 300 lines. Isolate all side effects in `buildDefaultProbeDeps`/`buildDefaultTakeoverDeps`.

### Step 11 — Run the Validation Commands
- Run every command in **Validation Commands** below. The two `tsc` typechecks must pass. The gate table tests are the acceptance proof for criteria 1, 2, and 6; the takeover tests prove criteria 3, 4, and 5; the full `bun run test:unit` is the zero-regression proof. Fix any failure before considering the task complete.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope. The framework is Vitest (`bunx vitest run <file>`); follow the established DI-and-table patterns (`takeoverHandler.test.ts`, `worktreeReset.test.ts`).

- **`adws/vcs/__tests__/worktreeReuseGate.test.ts` (headline, table-style).** A `healthyProbe()` factory plus per-test overrides drive `decideWorktreeReuse` across every `WorktreeProbe` permutation: all-clear → reuse; orphaned/absent lock → reuse; and each unhealthy signal (live-held lock, live owner, interrupted rebase/merge/cherry-pick, wrong HEAD, locked/prunable/missing registration) → reset with the exact typed reason. Includes a precedence case (`liveOwner` wins over `wrong_head`). Pure — no mocks.
- **`adws/vcs/__tests__/worktreeProbe.test.ts`.** Injected `ProbeDeps` (plain `vi.fn()` object). Verifies signal gathering: orphaned-vs-live-held derivation from lock presence × owner liveness; `liveOwner` only when pid+startedAt present and `isProcessLive` true; interrupted-op precedence; head comparison (including `null` current branch); `resolveGitDir === null` → `missing` with no throw; `clearOrphanedIndexLock` removes the lock only when present.
- **`adws/triggers/__tests__/takeoverHandler.test.ts` (updated).** `makeDeps` gains a default healthy `probeWorktree` + `clearOrphanedIndexLock`. The `abandoned` and `phase_timeout` blocks gain reuse cases (healthy → no reset, derive still called, orphaned lock cleared) and keep reset cases (now gated on an unhealthy probe, asserting `reset` before `reconcile`). Proves criteria 3 (both stages), 4 (confirmed-dead via `liveOwner` → reset; no SIGKILL on these branches), and 5 (the `take_over_adwId` shape is unchanged, so the downstream HITL/end-verification pipeline is untouched).

### Edge Cases
- **Orphaned `index.lock`, otherwise healthy** → reuse **and** clear the lock, so the resumed orchestrator's first git op doesn't fail with "Unable to create '…/index.lock': File exists". (The distinguishing case vs. `live_held`.)
- **`index.lock` held by a live PID** → `live_held` → reset; typically coincident with `liveOwner: true` (precedence makes the reason `live_owner`).
- **Multiple unhealthy signals at once** (e.g. interrupted rebase + wrong HEAD) → deterministic first-match reason; always resets.
- **No `branchName` in state** → take over without probing or resetting (derive stage only) — matches today's no-branch handling.
- **Worktree directory missing / unregistered** → `registration: 'missing'` → reset path (same as today when `branchName` is set but the worktree is gone; the probe reports `missing` rather than throwing). Recreating a truly-absent worktree is pre-existing behavior and out of scope.
- **`abandoned`/`phase_timeout` with a surprise-live recorded PID** → `liveOwner: true` → reset (never reuse a worktree a live process may still be writing); parity with today's reset-always for these stages (no SIGKILL added here).
- **Regression — `active` (`*_running`) stages** → unchanged: SIGKILL-if-live → reset-from-remote (this slice does not gate the active path).

## Acceptance Criteria
- A healthy worktree (gate passes: no live owner, lock absent/orphaned, no interrupted op, HEAD on the expected branch, registration healthy) is **reused in place** — `resetWorktree` is not called and uncommitted work is preserved; an orphaned `index.lock` is cleared.
- An unhealthy worktree — lock held by a live PID, interrupted rebase/merge/cherry-pick, wrong HEAD, `locked`/`prunable`/`missing` registration, or a live owner — falls back to **reset-from-remote**.
- The gate applies to **both** `abandoned` and `phase_timeout`, routed through one unified `recoverViaResumeInPlaceOrReset` seam in `evaluateCandidate`.
- Recovery reuses **only a confirmed-dead** run's worktree: the spawn-lock guarantees no live holder and the `liveOwner` probe signal forces reset, so a live owner is never reused in place (kill → confirm-dead → probe → decide).
- The `take_over_adwId` decision shape is unchanged, so **destructive diffs remain HITL-gated through resume** — blocking end-verification and the HITL-on-destructive-diffs gate run after a resume exactly as before; `decideWorktreeReuse` assesses Class-A git-operability only, never Class-B content health.
- **Table-style unit tests** cover the `WorktreeProbe` permutations, and the full unit suite passes with zero regressions.
- `phase_timeout` stays `resumable` and `abandoned` stays `retriable` in `stageClassifier.ts` (no reclassification); the cron filter is unmodified.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — ESLint; no new lint errors (unused vars, `any`, etc.).
- `bunx tsc --noEmit` — root typecheck passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW typecheck passes (the exhaustive `classifyStage` `never` guard still holds; no stage reclassified).
- `bunx vitest run adws/vcs/__tests__/worktreeReuseGate.test.ts` — the table-style gate tests pass (acceptance criteria 1, 2, 6).
- `bunx vitest run adws/vcs/__tests__/worktreeProbe.test.ts` — the probe signal-gathering tests pass.
- `bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts` — the updated reuse/reset cases pass for both `abandoned` and `phase_timeout`, and the `*_running`/`skip_terminal`/`spawn_fresh` blocks pass unchanged (criteria 3, 4, 5).
- `bunx vitest run adws/triggers/__tests__/cronIssueFilter.test.ts` — cron eligibility for `abandoned`/`phase_timeout` is unchanged (this feature is takeover-only).
- `bunx vitest run adws/vcs/__tests__/worktreeReset.test.ts adws/core/__tests__/stageClassifier.test.ts adws/core/__tests__/remoteReconcile.test.ts` — the reused/read-only primitives are not regressed and no stage is reclassified.
- `bun run test:unit` — the complete Vitest suite passes (zero regressions).
- `bun run build` — `tsc` build succeeds with no errors.

## Notes
- **Coding guidelines.** `.adw/coding_guidelines.md` applies: pure functions (`decideWorktreeReuse` is total and I/O-free), explicit readonly types (no `any`), guard clauses (≤2 nesting; extract `detectInterruptedOp`), side effects isolated in `buildDefaultProbeDeps`/`buildDefaultTakeoverDeps`, no unused imports, every file <300 lines. The new modules mirror the existing pure-core + injected-I/O pattern (`stageClassifier`, `progressGate`, `resolveVerdict`, `hungOrchestratorDetector`, `remoteReconcile`).
- **Why pin recovery per-consumer, not reclassify.** `phase_timeout` stays `resumable` and `abandoned` stays `retriable`; the reuse-vs-reset decision lives in `evaluateCandidate`, not in `classifyStage`. This honors the recurring "cron/takeover stage-predicate divergence" lesson — the cron filter and takeover already disagree on membership, so pinning the StageClass would risk collateral changes to other `resumable` stages. The unified seam is `recoverViaResumeInPlaceOrReset`.
- **Class-A vs Class-B boundary (the junk-gate invariant).** The gate answers *"can git safely keep working here?"* only. It never inspects diff content or work quality. The content junk-gate stays exactly where it is: blocking end-verification (scenario tests + passive review) and the HITL-on-destructive-diffs gate. Because `take_over_adwId` is returned unchanged, resume-in-place cannot route work around those gates.
- **`active` path is out of scope.** Extending the gate to `*_running` stages (SIGKILL → confirm-dead → probe → decide) is a natural follow-up but is not part of "both `abandoned` and `phase_timeout`." This slice leaves the `active` branch on reset-always so its tests and behavior are unchanged. Hardening the live-owner case to SIGKILL-before-reset on the recoverable branches is likewise deferred (today's behavior for those stages is reset-without-kill; this slice preserves that).
- **Takeover-only.** The cron pre-filter (`evaluateIssue`) already makes `abandoned` and `phase_timeout` eligible (#637); the webhook path has no pre-filter. Both route through `evaluateCandidate`, so landing the gate there covers cron and webhook in one place. Do not modify `cronIssueFilter.ts`.
- **No new libraries.** Pure TypeScript over `execSync`/`fs` and the existing `TakeoverDeps`/`deriveStageFromRemote`/`isProcessLive`/`getWorktreePath` machinery. (`.adw/commands.md` library install command is `bun add <package>` if ever needed — it is not needed here.)
- **Worktree hygiene (recurring incident — important).** This fresh worktree already carries out-of-scope working-tree modifications that diverge from `origin/dev`: `.claude/commands/document.md` (~120 lines changed), `.claude/commands/adw_init.md` (~11 lines removed), and `README.md` (~5 lines). These are unrelated to #638 and are the "worktree born with dependency reversion" pattern that has been accidentally swept into prior PRs (#612/#636/#637/#641). The build/commit step must stage **only** the stage-recovery source/test/doc files for #638 — never `git add -A`/`git commit -am` these reverted command files into this PR. If review uses `git diff origin/dev`, blocker any out-of-scope command-file revert.
- **Parent PRD missing.** `specs/prd/stage-recovery-resume-in-place.md` (referenced by the issue, and the source of "User stories 3, 9, 10, 11, 12, 15, 20") does **not** exist in the repo on any branch — already noted in the #636 and #637 plans. This plan infers the slice boundary from the issue body, the #637 plan (`specs/issue-637-…-recover-phase-timeout-stage.md`), the takeoverHandler `phase_timeout` comment that names resume-in-place as the next slice, and the `feature-d0hv98` living doc's "Resume-in-place is out of scope" gotcha. If the PRD lands later and defines the recovery contract (e.g. the Class-A signal set or recovery ordering) differently, reconcile before/at review.
- **Document phase routing.** Per `.adw/conditional_docs.md`, the takeover-routing change updates `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` (it `Owns takeoverHandler.ts`; its "Resume-in-place is out of scope" gotcha and the `phase_timeout` routing rows are now stale) and the new `adws/vcs/` modules update `app_docs/feature-9gjajh-worktree-and-vcs.md`. Update existing docs in place; do not spawn new ones.
