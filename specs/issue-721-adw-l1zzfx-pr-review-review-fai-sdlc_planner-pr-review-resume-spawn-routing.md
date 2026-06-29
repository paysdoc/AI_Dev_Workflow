# Feature: PR-review `review_failed` + per-adwId resume-spawn routing (`orchestratorScript`)

## Metadata
issueNumber: `721`
adwId: `l1zzfx-pr-review-review-fai`
issueJson: `{"number":721,"title":"PR-review review_failed + per-adwId resume routing (orchestratorScript)","body":"## Parent PRD\n\n`specs/prd/pr-review-adwid-consolidation-and-review-failed-gate.md`\n\n## What to build\n\nMake PR-review a first-class resumable orchestrator: it writes `review_failed` on review exhaustion, and `## Retry` re-runs **PR-review** (not SDLC), end-to-end. PR-review persists `orchestratorScript` to top-level state and overwrites it to its own script when it owns an adwId. The takeover / `phase_timeout` spawn path stops hardcoding the SDLC orchestrator and routes via a new `resolveResumeSpawn(state)` module that maps an adwId's state to the correct script + normalized `(issueNumber, adwId)` args. This slice still runs PR-review under its own generated adwId (full consolidation is #4). See PRD §Implementation Decisions \"Resume-spawn routing\" and \"## Retry recovery\". Routing a PR-review failure to SDLC is incorrect — SDLC never reads PR review comments.\n\n## Acceptance criteria\n\n- [ ] `decidePostReviewOutcome` fail-path adopted by PR-review → writes `review_failed`\n- [ ] PR-review persists `orchestratorScript = adws/adwPrReview.tsx` to top-level state\n- [ ] New pure `resolveResumeSpawn(state)` → `{ script, args }`; defaults to SDLC when `orchestratorScript` absent\n- [ ] takeover/`phase_timeout` spawn uses `resolveResumeSpawn` instead of hardcoding adwSdlc.tsx\n- [ ] `## Retry` on a `review_failed` PR-review issue re-runs PR-review under the same adwId\n- [ ] Unit tests for `resolveResumeSpawn` (each orchestratorScript + absent default); regression/BDD green\n\n## Blocked by\n\n- Blocked by #720 (needs the `review_failed` stage); region-overlaps #719 on adwPrReview/prReviewCompletion\n\n## Touched Files\n\n- adws/adwPrReview.tsx\n- adws/phases/prReviewCompletion.ts\n- adws/triggers/trigger_cron.ts\n- adws/core/resolveResumeSpawn.ts\n- adws/core/__tests__/resolveResumeSpawn.test.ts\n\n## User stories addressed\n\n- User story 5\n- User story 10\n- User story 18","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-29T12:34:20Z","comments":[],"actionableComment":null}`

## Feature Description

Today the PR-review orchestrator (`adwPrReview.tsx`) is a dead-end: when its review-retry loop is exhausted with unresolved blockers it neither blocks the issue explicitly nor leaves a recoverable signal, and when the cron *does* find a recoverable adwId it **always** spawns the SDLC orchestrator (`adws/adwSdlc.tsx` is hardcoded in `trigger_cron.ts`). Routing a PR-review failure to SDLC is not merely wasteful — it is **incorrect**: SDLC works from the issue spec and never reads PR review comments, so the human's review-comment intent is silently dropped.

This feature makes PR-review a **first-class resumable orchestrator**:

1. On review exhaustion, PR-review writes the `review_failed` blocking stage (the human-gated stage already introduced by #720) via the shared `decidePostReviewOutcome` gate, instead of silently ending at an inert `pr_review_commit_push_completed` stage.
2. PR-review persists `orchestratorScript = adws/adwPrReview.tsx` to its top-level state, so a later resume knows *which* orchestrator owns this adwId.
3. A new pure module `resolveResumeSpawn(state)` maps an adwId's top-level state to the correct orchestrator **script + normalized `(issueNumber, adwId)` args**, defaulting to SDLC when `orchestratorScript` is absent (back-compat for every pre-existing SDLC adwId).
4. The takeover / `phase_timeout` spawn path in `trigger_cron.ts` consumes `resolveResumeSpawn` instead of hardcoding `adws/adwSdlc.tsx`.
5. Because `resolveResumeSpawn` emits `(issueNumber, adwId)` args, `adwPrReview` is taught to accept that **resume form** (in addition to the legacy `<pr-number>` fresh form), re-resolving its PR from the persisted branch so a `## Retry` re-runs PR-review under the **same adwId**.

The net effect: a `review_failed` PR-review issue recovered with `## Retry` re-runs **PR-review** (the correct orchestrator), preserving the PR review context — closing the `#712 / PR #715` stuck-state class for the PR-review path.

## User Story

As an **ADW operator** (US 5, US 10)
I want **`## Retry` on a `review_failed` PR-review issue to resume the *same* orchestrator that produced the failure (PR-review, not SDLC)**
So that **the human's review-comment intent is not dropped by resuming the wrong workflow, and an exhausted PR review blocks the PR rather than silently shipping it**.

As an **ADW maintainer** (US 18)
I want **the resume-spawn routing (which orchestrator + which args for a given adwId's state) encapsulated in one tested pure function**
So that **the takeover / `phase_timeout` spawn path stops hardcoding the SDLC orchestrator and the routing is verifiable in isolation**.

## Problem Statement

Two concrete defects on the PR-review path:

1. **No explicit block on review exhaustion.** `adwPrReview.tsx` already calls `decidePostReviewOutcome(reviewPassed)` (line 104) and passes the outcome to `completePRReviewWorkflow`, but the completion handler early-returns on the fail-path:
   ```ts
   // prReviewCompletion.ts:80 — current
   if (!outcome.writeAwaitingMerge || !outcome.workflowStage) return;
   ```
   On a failed review `outcome.writeAwaitingMerge === false`, so the function returns **before** writing anything. `review_failed` is *never* written; the issue is left at the inert `pr_review_commit_push_completed` stage (classified `resumable`, which cron excludes). AC1 is unmet.

2. **Resume routing is hardcoded to SDLC.** When the cron takeover decides to recover an adwId, it spawns the SDLC orchestrator unconditionally:
   ```ts
   // trigger_cron.ts:323 — current (take_over_adwId branch)
   spawnDetached('bunx', ['tsx', 'adws/adwSdlc.tsx', String(issue.number), takeoverAdwId, ...targetRepoArgs]);
   ```
   Even though `scanAuthQueue.ts:107` already established the `state.orchestratorScript ?? 'adws/adwSdlc.tsx'` pattern, the takeover/`phase_timeout` path ignores it. A `review_failed` PR-review issue recovered via `## Retry` (which `retryHandler.ts:66` already transitions `review_failed → phase_timeout`) would therefore be re-run as **SDLC**, dropping the PR review comments entirely.

Additionally, PR-review never persists `orchestratorScript` (its `initializePRReviewWorkflow` writes only the per-orchestrator state file, never top-level state), so even a routing function would default it to SDLC.

## Solution Statement

Encapsulate the routing decision in a pure, injected-dependency-free function and wire all the persistence + consumption around it:

- **`resolveResumeSpawn(state: AgentState): ResumeSpawnDescriptor`** — a pure function in `adws/core/` returning `{ script, args }` where `script = state.orchestratorScript ?? 'adws/adwSdlc.tsx'` and `args = [String(state.issueNumber), state.adwId]`. This generalizes the `scanAuthQueue` one-liner into a single tested module. Prior art: `deriveOrchestratorScript` / `orchestratorNamesForScript` (`adws/core/orchestratorNames.ts`), `resumePolicy.nextResumeAction`.
- **PR-review persists `orchestratorScript`** to top-level state at init (`adwPrReview.tsx`, right after `initializePRReviewWorkflow`), mirroring `workflowInit.ts:330`. Because `writeTopLevelState` is a shallow merge (`agentState.ts:298`), this survives every later `runPhase` / completion write. PR-review *overwrites* `orchestratorScript` to its own script whenever it owns the adwId.
- **`completePRReviewWorkflow` writes `review_failed` and co-stamps `orchestratorScript`** on the fail-path by gating the write on `outcome.workflowStage` presence rather than `outcome.writeAwaitingMerge` — `awaiting_merge` on pass, `review_failed` on fail — and includes `orchestratorScript = adws/adwPrReview.tsx` in that same top-level write so the routing tag lands together with the terminal stage. (The terminal handoff is the path that records `orchestratorScript` whenever PR-review reaches completion under its own adwId; the init write below additionally covers a mid-run takeover and persists `branchName`.)
- **`trigger_cron` takeover** reads the top-level state for the taken-over adwId and spawns `resolveResumeSpawn(state).script` with its normalized args (defensive SDLC fallback when the state is unexpectedly absent).
- **`adwPrReview` accepts the `(issueNumber, adwId)` resume form** so the routed spawn actually re-runs PR-review under the same adwId, re-resolving the PR from the persisted branch (`defaultFindPRByBranch`). Fresh runs still self-generate the adwId — adwId *discovery/reuse* from issue comments, trigger delegation, and issue-less-PR skip remain in slice #4.

Routing correctness is the prize: `review_failed` (PR-review) now routes back to PR-review, never to SDLC.

## Relevant Files

Use these files to implement the feature:

### Existing files to modify
- `adws/adwPrReview.tsx` — PR-review orchestrator entry. Already adopts `decidePostReviewOutcome` (line 104). Add: (a) persist `orchestratorScript = adws/adwPrReview.tsx` (+ `branchName`) to top-level state right after `initializePRReviewWorkflow`; (b) accept the normalized `(issueNumber, adwId)` resume form alongside the legacy `<pr-number>` fresh form, resolving the PR from the persisted branch via `defaultFindPRByBranch`.
- `adws/phases/prReviewCompletion.ts` — `completePRReviewWorkflow`. Change the terminal write to gate on `outcome.workflowStage` (writes `review_failed` on fail, keeps `awaiting_merge` on pass) and branch the success/blocked log line.
- `adws/triggers/trigger_cron.ts` — the `take_over_adwId` branch (line 319-326). Replace the hardcoded `adws/adwSdlc.tsx` spawn with `resolveResumeSpawn(readTopLevelState(adwId))`. `AgentStateManager` is already imported (line 15); add the `resolveResumeSpawn` import.
- `adws/phases/prReviewPhase.ts` — `initializePRReviewWorkflow`. **Minimal resumability change**: when invoked in resume mode (an `adwId` is supplied and a prior top-level state exists for it), skip the "no unaddressed review comments → `process.exit(0)`" early-exit (line 57-60) so the resumed review actually re-runs even when the human's fix already cleared the PR comment threads. `config.base.branchName` is `prDetails.headBranch` (line 154) — used to persist branch. *(Extends the issue's Touched Files; see Notes.)*

### New Files
- `adws/core/resolveResumeSpawn.ts` — the pure routing module: `ResumeSpawnDescriptor` interface + `resolveResumeSpawn(state: AgentState): ResumeSpawnDescriptor`.
- `adws/core/__tests__/resolveResumeSpawn.test.ts` — unit tests (each `orchestratorScript` + absent default + args normalization).

### Reference files (read, do not modify)
- `adws/triggers/scanAuthQueue.ts:107` — the canonical `state.orchestratorScript ?? 'adws/adwSdlc.tsx'` spawn pattern `resolveResumeSpawn` generalizes.
- `adws/core/orchestratorNames.ts` — `deriveOrchestratorScript` / `orchestratorNamesForScript`; the script-name registry and the `'adws/adwSdlc.tsx'` default convention.
- `adws/triggers/retryHandler.ts:66-70` — already transitions `review_failed → phase_timeout` (re-arms `resumeAttempts`); the `## Retry` half of AC5 is done (from #720), this slice supplies the routing half.
- `adws/triggers/takeoverHandler.ts` — `evaluateCandidate` / `CandidateDecision` (the `take_over_adwId` decision carries `{ adwId, derivedStage }`; the top-level state is re-read in `trigger_cron`).
- `adws/phases/workflowInit.ts:330-338` — how SDLC writes `orchestratorScript` to top-level state at init (the pattern PR-review mirrors).
- `adws/core/agentState.ts:281-307` — `writeTopLevelState` shallow-merge semantics (guarantees `orchestratorScript` persists across later writes); `readTopLevelState` (line 263).
- `adws/core/phaseRunner.ts:147-187` — `runPhase` writes top-level `workflowStage` (but never `orchestratorScript`), so the top-level state file already exists mid-run.
- `adws/phases/decidePostReviewOutcome.ts` — the shared pure gate; already returns `{ workflowStage: 'review_failed', skipDocAndPR: true }` on fail and `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge' }` on pass (from #719/#720).
- `adws/github/prApi.ts:61` — `defaultFindPRByBranch(branchName, repoInfo): RawPR | null` for resolving the PR on resume.
- `adws/types/agentTypes.ts:252-310` — `AgentState` shape (`adwId: string`, `issueNumber: number | null`, `orchestratorScript?: string`).
- `adws/github/workflowCommentsIssue.ts` (`formatReviewFailedComment`) + `adws/core/workflowCommentParsing.ts:152` (`extractAdwIdFromComment`) — confirm the `review_failed` issue comment carries `**ADW ID:** \`<adwId>\``, so `extractLatestAdwId` over the **issue's** comments discovers the PR-review adwId for `## Retry` and takeover.

### Conditional documentation (per `.adw/conditional_docs.md`)
- `app_docs/feature-s59wpc-adwprreview-phaserunner-migration.md` — **owns** `adwPrReview.tsx`, `prReviewCompletion.ts`, `decidePostReviewOutcome.ts`; covers the PR-review `awaiting_merge` handoff and `reviewPassed` capture.
- `app_docs/feature-ni6fpk-serialize-overlapping-region-issues.md` — covers `trigger_cron.ts` spawn flow, `deriveOrchestratorScript()` / new-orchestrator mappings, and the cron handoff-stage spawn path.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — covers `AgentStateManager` top-level state methods and `workflowStage` transition reads/writes.

## Implementation Plan

### Phase 1: Foundation — the pure routing module
Create `resolveResumeSpawn` first; it has no dependencies beyond the `AgentState` type and is independently testable. This is the keystone every other change wires into. Cover it with unit tests before integrating, so the takeover wiring is built against a proven function.

### Phase 2: PR-review writes `review_failed` and persists `orchestratorScript`
Make PR-review leave the two signals a resume needs: a `review_failed` top-level stage (so cron treats it as human-gated and `## Retry` re-arms it) and a persisted `orchestratorScript = adws/adwPrReview.tsx` (so routing resolves back to PR-review). These are independent of Phase 1 and can be verified by reading the resulting top-level state file.

### Phase 3: Integration — consume routing in the takeover, accept the resume form
Wire `trigger_cron`'s `take_over_adwId` branch onto `resolveResumeSpawn`, and teach `adwPrReview` to accept the `(issueNumber, adwId)` resume args (resolving its PR from the persisted branch, reusing the adwId) plus the resume-mode comment-gate bypass. After this the `review_failed` → `## Retry` → `phase_timeout` → takeover → PR-review loop is closed end-to-end. Finish by running the full validation suite.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Create the pure `resolveResumeSpawn` module
- Create `adws/core/resolveResumeSpawn.ts`.
- Import the `AgentState` type: `import type { AgentState } from '../types/agentTypes';`.
- Define the result shape and the SDLC default:
  ```ts
  export interface ResumeSpawnDescriptor {
    /** Orchestrator script to spawn, e.g. "adws/adwSdlc.tsx" or "adws/adwPrReview.tsx". */
    readonly script: string;
    /** Normalized positional CLI args: [issueNumber, adwId]. */
    readonly args: readonly string[];
  }

  /** The historical default: every pre-`orchestratorScript` adwId resumes as SDLC. */
  export const DEFAULT_RESUME_SCRIPT = 'adws/adwSdlc.tsx';
  ```
- Implement the pure mapping (no I/O, total over a non-null state):
  ```ts
  /**
   * Maps an adwId's persisted top-level state to the orchestrator that owns it,
   * with normalized (issueNumber, adwId) resume args. Defaults to the SDLC
   * orchestrator when `orchestratorScript` is absent (back-compat for every
   * adwId created before PR-review began persisting it).
   */
  export function resolveResumeSpawn(state: AgentState): ResumeSpawnDescriptor {
    const script = state.orchestratorScript ?? DEFAULT_RESUME_SCRIPT;
    const args = [String(state.issueNumber), state.adwId];
    return { script, args };
  }
  ```
- Keep the module free of barrel re-exports that would pull in `gitContextFactory` (it imports a *type* only, so there is no runtime cycle); `trigger_cron` and the test import directly from `../core/resolveResumeSpawn` / `../resolveResumeSpawn`.

### 2. Unit-test `resolveResumeSpawn`
- Create `adws/core/__tests__/resolveResumeSpawn.test.ts` (vitest, mirroring the style of `adws/triggers/__tests__/scanAuthQueue.test.ts` `makeState` helper).
- Add a `makeState(overrides)` helper producing a minimal valid `AgentState` (`adwId`, `issueNumber`, `agentName`, `execution`, optional `orchestratorScript`).
- Cover the AC6 cases (see Testing Strategy → Unit Tests for the full list): PR-review script, SDLC script, a third orchestrator (e.g. `adws/adwChore.tsx`), absent `orchestratorScript` → SDLC default, and args normalization (numeric `issueNumber` → string, `adwId` passthrough).

### 3. Write `review_failed` (and co-stamp `orchestratorScript`) on the PR-review fail-path
- In `adws/phases/prReviewCompletion.ts`, in `completePRReviewWorkflow`, replace the early-return gate at line 80 so the terminal stage is written whenever `outcome.workflowStage` is non-null (both `awaiting_merge` and `review_failed`), and include `orchestratorScript = adws/adwPrReview.tsx` in the same top-level write so the routing tag is co-written with the terminal stage:
  ```ts
  if (!outcome.workflowStage) return;

  AgentStateManager.writeTopLevelState(config.base.adwId, {
    workflowStage: outcome.workflowStage,
    orchestratorScript: 'adws/adwPrReview.tsx',
  });
  AgentStateManager.appendLog(orchestratorStatePath, `PR Review handed off to ${outcome.workflowStage}`);
  if (outcome.writeAwaitingMerge) {
    log('PR Review handed off — awaiting merge via cron', 'success');
  } else {
    log('PR Review blocked — review_failed, awaiting ## Retry', 'warn');
  }
  ```
- Co-stamping `orchestratorScript` here (not only at init, step 4) is load-bearing: the BDD fail-path driver (`the PR-review outcome handoff is executed ... after a failing review`) exercises `completePRReviewWorkflow` directly — it does **not** run `adwPrReview`'s init — so the `review_failed` state must carry `orchestratorScript = adws/adwPrReview.tsx` from *this* write for the resume to route back to PR-review. `writeTopLevelState` shallow-merges, so this coexists with the init write (step 4) and the earlier `${phase}_running/_completed` writes.
- Do not alter `decidePostReviewOutcome` (it already returns `workflowStage: 'review_failed'` on fail). Do not change the `awaiting_merge` pass behavior (regression guard) — the added `orchestratorScript` field does not touch `workflowStage`/error fields, so feature-719 §2/§3 stay green.

### 4. Persist `orchestratorScript` to top-level state at PR-review init
- In `adws/adwPrReview.tsx`, ensure `AgentStateManager` is imported from `./core`.
- Immediately after `const config = await initializePRReviewWorkflow(...)` (before the `CostTracker`), persist the routing identity to top-level state (shallow-merge, so it coexists with `runPhase`'s later `workflowStage` writes and the terminal stage write):
  ```ts
  AgentStateManager.writeTopLevelState(config.base.adwId, {
    adwId: config.base.adwId,
    issueNumber: config.base.issueNumber,
    orchestratorScript: 'adws/adwPrReview.tsx',
    ...(config.base.branchName ? { branchName: config.base.branchName } : {}),
  });
  ```
- This satisfies "persists `orchestratorScript`" **and** "overwrites it to its own script when it owns an adwId" (the merge always sets it, overwriting any prior SDLC value), and — by landing the tag at init — covers a takeover that fires *mid-run* (before completion). The terminal handoff (step 3) writes the same `orchestratorScript` again when the run reaches `review_failed`/`awaiting_merge`; the two writes are idempotent (same value) and together guarantee the tag is present both mid-run and at the completion state the BDD fail-path driver observes. Persisting `branchName` enables the resume-form PR re-resolution in step 6.

### 5. Route the takeover spawn through `resolveResumeSpawn`
- In `adws/triggers/trigger_cron.ts`, add `import { resolveResumeSpawn } from '../core/resolveResumeSpawn';`.
- In the `take_over_adwId` branch (line 319-326), replace the hardcoded SDLC spawn with routing off the taken-over adwId's top-level state, keeping a defensive SDLC fallback for the (decision-guaranteed-impossible) null state:
  ```ts
  if (takeoverDecision.kind === 'take_over_adwId') {
    const { adwId: takeoverAdwId, derivedStage } = takeoverDecision;
    log(`Issue #${issue.number}: taking over adwId=${takeoverAdwId} derivedStage=${derivedStage}`, 'success');
    const takeoverState = AgentStateManager.readTopLevelState(takeoverAdwId);
    if (takeoverState) {
      const { script, args } = resolveResumeSpawn(takeoverState);
      log(`Issue #${issue.number}: resume routing → ${script}`, 'info');
      spawnDetached('bunx', ['tsx', script, ...args, ...targetRepoArgs]);
    } else {
      // Defensive: state vanished between evaluateCandidate and here — preserve the prior SDLC default.
      spawnDetached('bunx', ['tsx', 'adws/adwSdlc.tsx', String(issue.number), takeoverAdwId, ...targetRepoArgs]);
    }
    releaseIssueSpawnLock(repoInfo, issue.number);
    continue;
  }
  ```
- This covers both `abandoned` and `phase_timeout` recoveries (both produce `take_over_adwId`). SDLC adwIds keep routing to `adws/adwSdlc.tsx` because `workflowInit.ts:330` persisted `orchestratorScript = adws/adwSdlc.tsx` for them — the critical regression guard.

### 6. Accept the `(issueNumber, adwId)` resume form in `adwPrReview`
- In `adws/adwPrReview.tsx`, before calling `initializePRReviewWorkflow`, branch on the positional arguments (target-repo `--flags` are already separated by `parseTargetRepoArgs`):
  - **Resume form** — two positionals `(issueNumber, adwId)` (a non-numeric second positional is the adwId): set `adwId = positionals[1]`; read `AgentStateManager.readTopLevelState(adwId)?.branchName`; resolve the PR via `defaultFindPRByBranch(branchName, resolvedRepoInfo)`; set `prNumber = pr.number`. Pass the resolved `adwId` into `initializePRReviewWorkflow(prNumber, adwId, ...)` (its 2nd param already honors a supplied adwId — `prReviewPhase.ts:45`).
  - **Fresh form** — one positional `<pr-number>` (existing behavior): `prNumber = parseInt(positionals[0], 10)`, `adwId = null`.
- Extract the branching into a small named helper (e.g. `resolvePrReviewInvocation(positionals, repoInfo)`) to honor the nesting/guard-clause coding guideline; keep the existing `isNaN`/usage error handling for the fresh form.
- In `adws/phases/prReviewPhase.ts`, in `initializePRReviewWorkflow`, treat a supplied `adwId` whose top-level state already exists as **resume mode** and skip the `unaddressedComments.length === 0 → process.exit(0)` early-exit (line 57-60), so the routed `## Retry` re-runs the review even when the human's fix already cleared the PR comment threads. Keep the early-exit for fresh runs.

### 7. Run the validation commands
- Execute every command in **Validation Commands** and confirm all pass with zero regressions. Fix any lint, type, unit-test, or regression-scenario failures introduced by the change before considering the feature complete.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

New file `adws/core/__tests__/resolveResumeSpawn.test.ts` (vitest) covering `resolveResumeSpawn` external behavior through its interface:
- **PR-review script** — `orchestratorScript: 'adws/adwPrReview.tsx'`, `issueNumber: 721`, `adwId: 'l1zzfx-...'` → `{ script: 'adws/adwPrReview.tsx', args: ['721', 'l1zzfx-...'] }`.
- **SDLC script** — `orchestratorScript: 'adws/adwSdlc.tsx'` → `script: 'adws/adwSdlc.tsx'` with normalized args (the regression guard that SDLC takeovers are unchanged).
- **A third orchestrator** — `orchestratorScript: 'adws/adwChore.tsx'` → routes there (proves "each orchestratorScript", not a hardcoded two-way branch).
- **Absent default** — `orchestratorScript` undefined → `script: 'adws/adwSdlc.tsx'` (the AC's "defaults to SDLC when absent").
- **Args normalization** — numeric `issueNumber` is stringified; `adwId` is passed through verbatim; `args` has exactly two elements `[issueNumber, adwId]` in that order.

Prior art for assertion style: `adws/core/__tests__/resumePolicy.test.ts`, `adws/core/__tests__/stageClassifier.test.ts`, and the `makeState` helper in `adws/triggers/__tests__/scanAuthQueue.test.ts`.

Re-run the existing `adws/triggers/__tests__/retryHandler.test.ts` (the `review_failed → phase_timeout` re-arm assertion from #720) and `scanAuthQueue.test.ts` to confirm no regression from the shared state-shape changes.

### Edge Cases
- **SDLC adwId takeover is unchanged** — a state with `orchestratorScript: 'adws/adwSdlc.tsx'` (written by `workflowInit`) still spawns `adws/adwSdlc.tsx` with `(issueNumber, adwId)` (identical to the pre-change line 323 behavior).
- **Pre-`orchestratorScript` adwId** — an old SDLC state with no `orchestratorScript` field defaults to SDLC (no behavior change for in-flight legacy adwIds).
- **`review_failed` write is not skipped, and carries `orchestratorScript`** — `completePRReviewWorkflow` writes `review_failed` even though `writeAwaitingMerge` is `false` (the bug being fixed) **and** co-stamps `orchestratorScript = adws/adwPrReview.tsx` in the same write; confirm both fields via the resulting top-level `state.json` (this is what the BDD fail-path scenario asserts, since its driver runs only the completion handoff).
- **`orchestratorScript` survives later writes** — the init persistence (step 4) is preserved through `runPhase`'s `${phase}_running/_completed` top-level writes and the terminal `{ workflowStage }` write, because `writeTopLevelState` shallow-merges.
- **Resume vs fresh CLI disambiguation** — `adwPrReview.tsx <pr-number>` (one positional) stays fresh; `adwPrReview.tsx <issueNumber> <adwId>` (two positionals, non-numeric adwId) is resume. Target-repo `--flags` do not affect the positional count.
- **Defensive null state in takeover** — if `readTopLevelState(takeoverAdwId)` returns null (shouldn't, since `evaluateCandidate` just read it), the SDLC fallback preserves the prior behavior rather than crashing.
- **Resume with no unaddressed PR comments** — a `## Retry` after the human pushed a fix that already cleared the PR comment threads still re-runs the review (resume-mode bypass of the empty-comments early-exit).

## Acceptance Criteria
- `decidePostReviewOutcome`'s fail-path is honored by PR-review: `completePRReviewWorkflow` writes `review_failed` to top-level state on review exhaustion (no early-return).
- PR-review persists `orchestratorScript = adws/adwPrReview.tsx` to its top-level state (`agents/<adwId>/state.json`), overwriting any prior value: written at init **and** co-stamped on the terminal handoff (`completePRReviewWorkflow`), so the `review_failed`/`awaiting_merge` completion state carries it even when only the completion handoff runs; it survives subsequent phase/terminal writes (shallow merge).
- `resolveResumeSpawn(state)` exists as a pure function returning `{ script, args }`, mapping each `orchestratorScript` to its script and defaulting to `adws/adwSdlc.tsx` when absent, with normalized `[String(issueNumber), adwId]` args.
- `trigger_cron`'s `take_over_adwId` branch spawns `resolveResumeSpawn(state).script` with its args (no hardcoded `adws/adwSdlc.tsx`), covering both `abandoned` and `phase_timeout` recoveries.
- A `## Retry` on a `review_failed` PR-review issue resumes **PR-review** under the **same adwId** (routing resolves to `adws/adwPrReview.tsx`; `adwPrReview` consumes the `(issueNumber, adwId)` form and re-resolves its PR), never SDLC.
- Unit tests for `resolveResumeSpawn` cover each `orchestratorScript` plus the absent default; the full unit suite, type checks, lint, build, and `@regression` scenarios are green.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions (sourced from `.adw/commands.md`):

- `bun run lint` — ESLint; zero errors.
- `bunx tsc --noEmit` — root type check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type check (the orchestrator/trigger sources); zero errors.
- `bun run test:unit` — full vitest suite (`vitest run`), including the new `resolveResumeSpawn.test.ts`; all pass, zero regressions.
- `bun run build` — `tsc` build; succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression BDD scenarios; all green.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep `resolveResumeSpawn` pure (no I/O — same input, same output); prefer guard clauses / extracted named helpers over nested conditionals (the `adwPrReview` resume-vs-fresh branching → `resolvePrReviewInvocation`); avoid `any` and the `!` non-null assertion (use the explicit `if (takeoverState)` guard, not `takeoverState!`); files under 300 lines.
- **Touched-files extension:** the issue lists `adwPrReview.tsx`, `prReviewCompletion.ts`, `trigger_cron.ts`, and the new `resolveResumeSpawn.ts`/test. This plan additionally makes a **minimal** change to `adws/phases/prReviewPhase.ts` (resume-mode comment-gate bypass) so AC5 ("`## Retry` re-runs PR-review") is genuinely functional rather than spawning a process that exits early. `prReviewPhase.ts` is owned by the same conditional doc (`feature-s59wpc`) as the other PR-review files. If the reviewer prefers to keep the issue's file set exact, this single bypass can be deferred to slice #4, in which case `## Retry` still routes correctly to PR-review (the core AC5 correctness win) but may no-op when the PR comment threads are already resolved.
- **No new libraries** — uses existing `AgentStateManager`, `defaultFindPRByBranch`, and the `AgentState` type. Library install command (if ever needed) per `.adw/commands.md`: `bun add <package>`.
- **Scope boundary vs slice #4 (consolidation):** this slice routes a *resume* to PR-review under the adwId it is handed, and persists `orchestratorScript`. It does **not** yet make *fresh* PR-review spawns discover/reuse the issue's existing adwId (the `extractLatestAdwId`-over-issue-comments resolver), delegate the cron PR-comment poll / webhook to that resolver, or skip issue-less PRs — those remain #4. Fresh runs still self-generate the adwId, exactly as the issue states.
- **Why discovery already works for `## Retry`:** the `review_failed` comment that #720 posts to the **issue** carries `**ADW ID:** \`<prReviewAdwId>\``, and `extractAdwIdFromComment` (`workflowCommentParsing.ts:152`) matches it — so `retryHandler` and `evaluateCandidate` both resolve the PR-review adwId from the issue's comments without needing slice #4's consolidation. The routing this slice adds is what then sends that adwId back to PR-review instead of SDLC.
- **Money-fire safety (unchanged):** `review_failed` is human-gated (cron returns `eligible:false`), so it never consumes the auto-resume counter; `## Retry` re-arms it to `phase_timeout` and the existing `MAX_RESUME_ATTEMPTS` cap still bounds the post-retry hang path. This slice does not touch that classification.
