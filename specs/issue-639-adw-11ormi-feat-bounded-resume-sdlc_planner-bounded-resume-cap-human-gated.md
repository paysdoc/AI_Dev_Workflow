# Feature: Bounded resume cap with human-gated escalation

## Metadata
issueNumber: `639`
adwId: `11ormi-feat-bounded-resume`
issueJson: `{"number":639,"title":"feat: bounded resume cap with human-gated escalation","body":"## Parent PRD\n\n`specs/prd/stage-recovery-resume-in-place.md`\n\n## What to build\n\nA `resumeAttempts` counter persisted in top-level workflow state, incremented on each resume of a `resumable` stage, plus a pure `nextResumeAction(attempts, max)` returning `resume` or `escalate`. On reaching the bound the workflow transitions to a `human_gated` stage (mirroring `merge_blocked`), recoverable only via the `## Retry` directive. This is the money-fire backstop — same philosophy as `progressGate`'s checkpoint cap, applied across resume attempts. See PRD \"Implementation Decisions\" (resume policy module).\n\n## Acceptance criteria\n\n- [ ] `resumeAttempts` persisted in state and survives across cron ticks\n- [ ] Below the bound → resume; at/above the bound → escalate to `human_gated`\n- [ ] `human_gated` is recoverable via `## Retry` (re-arms the counter)\n- [ ] Pure unit tests for `nextResumeAction` boundary cases\n\n## Blocked by\n\n- Blocked by #637\n\n## User stories addressed\n\n- User story 5\n- User story 6\n- User story 16\n- User story 21","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-19T17:38:13Z","comments":[],"actionableComment":null}`

## Feature Description

When a workflow phase wedges, the per-agent watchdog kills the Claude process tree and `handlePhaseTimeout` writes the top-level stage `phase_timeout` and exits the orchestrator (`process.exit(0)`). Issue #637 (merged, PR #645) wired `phase_timeout` into the cron/takeover recovery path so a stranded run is **automatically recovered** on the next cron tick (reset-from-remote takeover → re-spawn). #637 explicitly **deferred** the failure mode this feature closes:

> *N-cap timeout-loop escalation — a phase that repeatedly times out will repeatedly recover (same characteristic as `abandoned` today); a bounded retry/escalation is deferred.*

That deferred case is a **money fire**: a phase that wedges, gets killed by the watchdog, is auto-recovered, runs again, wedges again, forever — burning tokens on every loop with no human ever notified. This feature adds the backstop, mirroring the philosophy already proven by two sibling mechanisms in this codebase:

1. **`progressGate`** (`adws/phases/progressGate.ts`) — a pure decision function with a hard `checkpointCount >= maxCheckpoints` backstop that aborts a build that keeps churning.
2. **`merge_blocked` escalation** (`adws/adwMerge.tsx`) — a `mergeRetryCount` counter persisted in top-level state that escalates to the human-gated `merge_blocked` stage after `MAX_PR_RESOLUTION_ATTEMPTS`, recoverable only via the `## Retry` directive.

Concretely, the feature introduces:

- A pure policy module `adws/core/resumePolicy.ts` exporting `nextResumeAction(attempts, max): 'resume' | 'escalate'` (same shape as `evaluateProgressGate`) and a `MAX_RESUME_ATTEMPTS` constant.
- A `resumeAttempts?: number` counter on `AgentState`, persisted in the top-level `agents/{adwId}/state.json` (exactly like `mergeRetryCount`) and therefore surviving across cron ticks.
- A new `human_gated` `WorkflowStage` literal (sibling to `merge_blocked`, both in the existing `human_gated` `StageClass`) that the workflow transitions to when the resume bound is reached.
- Wiring at the **single takeover seam** (`evaluateCandidate` in `adws/triggers/takeoverHandler.ts`, the `phase_timeout` branch) so that before each automatic resume the counter is read, the pure policy decides resume-vs-escalate, and the counter is incremented (resume) or the stage is escalated to `human_gated` with a human-facing comment (escalate).
- `## Retry` recovery for `human_gated` (in `adws/triggers/retryHandler.ts`), which re-arms the counter (`resumeAttempts: 0`) and returns the workflow to `phase_timeout` so the next cron tick resumes it afresh.

## User Story

As an **ADW operator running unattended cron/webhook automation**
I want **a hard cap on how many times a wedging workflow is automatically resumed before it is parked in a human-gated stage**
So that **a phase that times out in a loop cannot burn money indefinitely, and a human is explicitly notified and put in control of re-arming it (via `## Retry`) instead of the loop running silently forever** (PRD user stories 5, 6, 16, 21).

## Problem Statement

After #637, `phase_timeout` is a **recoverable** stage: cron marks it eligible (`adws/triggers/cronIssueFilter.ts`) and takeover recovers it (`evaluateCandidate` → `recoverViaResetFromRemote` → `take_over_adwId` → re-spawn `adwSdlc.tsx`). There is **no bound** on this loop. If the underlying phase wedges deterministically (a bad plan, a pathological repo state, an infinite agent loop), every cron tick after the grace window will:

1. See `phase_timeout` with a dead orchestrator → eligible.
2. Take over → reset worktree → re-spawn the orchestrator.
3. The orchestrator re-runs the same phase → wedges → watchdog kills it → `phase_timeout` again.

This repeats indefinitely, consuming Claude tokens on every iteration, with no escalation and no human in the loop. The `progressGate` checkpoint cap solves the analogous problem *within a single build*; the `merge_blocked` cap solves it *for the merge handoff*. The **resume loop across cron ticks** has no equivalent backstop. This feature supplies it.

## Solution Statement

Mirror the proven `merge_blocked` pattern, but factor the decision into a **pure function** like `progressGate`:

1. **Pure policy** — `adws/core/resumePolicy.ts`: `nextResumeAction(attempts, max = MAX_RESUME_ATTEMPTS): ResumeAction` returns `'escalate'` when `attempts >= max`, else `'resume'`. No I/O; trivially unit-testable at the boundary. `MAX_RESUME_ATTEMPTS = 3` (matches `MAX_PR_RESOLUTION_ATTEMPTS` and `MAX_AUTO_MERGE_ATTEMPTS`).

2. **Persisted counter** — add `resumeAttempts?: number` to `AgentState` (`adws/types/agentTypes.ts`), persisted via `AgentStateManager.writeTopLevelState` (shallow-merges, so the counter survives the takeover→spawn→`workflowInit` sequence and across cron ticks), exactly like `mergeRetryCount`.

3. **New human-gated stage** — add the `human_gated` literal to the `WorkflowStage` union (`adws/types/workflowTypes.ts`) and a `case 'human_gated': return 'human_gated'` to `classifyStage` (`adws/core/stageClassifier.ts`). The stage name equalling its `StageClass` name is **already an established pattern** for `awaiting_merge` (`classifyStage('awaiting_merge') === 'awaiting_merge'`); `merge_blocked` remains a descriptively-named sibling in the same `human_gated` class. Adding the literal without the `case` is a deliberate `tsc` error (the #636 `never` guard) — that error is the guard working as designed.

4. **The single takeover seam** — gate the **existing `phase_timeout` branch** of `evaluateCandidate` (`adws/triggers/takeoverHandler.ts`). This is the one gate that **both** cron (`trigger_cron.ts:289`) and webhook (`webhookGatekeeper.ts:100`) route through, and the function already performs I/O via injected `TakeoverDeps` (`resetWorktree`, `killProcess`, `deriveStageFromRemote`), so adding `writeTopLevelState` and `commentOnIssue` deps is consistent with its design. In the `phase_timeout` branch, before recovering:
   - `const attempts = state.resumeAttempts ?? 0;`
   - If `nextResumeAction(attempts, MAX_RESUME_ATTEMPTS) === 'escalate'` → write `{ workflowStage: 'human_gated' }`, post the human-facing escalation comment, release the lock, and return a new `escalate_human_gated` decision (no re-spawn).
   - Else → write `{ resumeAttempts: attempts + 1 }`, then proceed to the existing `recoverViaResetFromRemote(...)` recovery (unchanged).

   The gate is **surgical to the `phase_timeout` branch** — it does **not** touch the `retriable` (`abandoned`), `active` (`*_running`), `terminal`, or `spawn_fresh` branches, so no other stage's behavior changes. It is **orthogonal to the recovery mechanism**: it sits *above* `recoverViaResetFromRemote`, so it composes cleanly with #637's reset-from-remote and with sibling slice #638's conditional worktree-reuse (both keep the `take_over` decision shape; only what "proceed" does below the gate may change).

5. **Two trivial caller branches** — `trigger_cron.ts` and `webhookGatekeeper.ts` each get one `if (decision.kind === 'escalate_human_gated') { log(...); continue|return; }` block, mirroring their existing `skip_terminal` handling (no spawn).

6. **Cron exclusion** — add an inline `human_gated` exclusion to `evaluateIssue` (`adws/triggers/cronIssueFilter.ts`) directly mirroring the `merge_blocked` exclusion, so an escalated issue is never re-made-eligible (it stays parked until `## Retry`).

7. **`## Retry` recovery** — extend `handleRetryDirective` (`adws/triggers/retryHandler.ts`) so a `human_gated` workflow resets to `{ workflowStage: 'phase_timeout', resumeAttempts: 0 }` (re-arm). Resetting to `phase_timeout` (not `abandoned`) is deliberate: it keeps the re-armed workflow **under the resume-cap regime** on the next loop. The existing `merge_blocked → awaiting_merge` path is preserved unchanged.

8. **Human-facing comment** — add an exported `formatHumanGatedComment(adwId, attempts, max)` to `adws/github/workflowCommentsIssue.ts`, modeled on `adwMerge.tsx`'s ctx-free `buildMergeBlockedComment` (the ctx-based `formatWorkflowComment` family needs a `WorkflowContext` the takeover gate does not have). It states the cause and the `## Retry` remedy.

`resumeAttempts` is a **cumulative per-workflow** counter (like `mergeRetryCount`): it counts total automatic resumes and is cleared only on `## Retry`. Per-phase / reset-on-progress tracking is explicitly out of scope for this slice (see Notes).

## Relevant Files

Use these files to implement the feature:

### New Files

- `adws/core/resumePolicy.ts` — the pure policy module: `export type ResumeAction = 'resume' | 'escalate'`, `export const MAX_RESUME_ATTEMPTS = 3`, and `export function nextResumeAction(attempts: number, max?: number): ResumeAction`. Pure, no I/O — mirrors `adws/phases/progressGate.ts` and the other pure decision modules (`adws/core/resolveVerdict.ts`, `adws/core/stageClassifier.ts`). Co-locating `MAX_RESUME_ATTEMPTS` with the policy keeps it self-contained and independently testable.
- `adws/core/__tests__/resumePolicy.test.ts` — pure boundary-case unit tests for `nextResumeAction` (acceptance criterion 4).

### Source — modified

- `adws/types/workflowTypes.ts` — add the `human_gated` literal to the `WorkflowStage` union (after `merge_blocked`, ~line 70), with a doc comment mirroring `merge_blocked`'s ("Escalation target for the bounded resume cap; non-retriable; recoverable only via `## Retry`, which re-arms `resumeAttempts`.").
- `adws/core/stageClassifier.ts` — add `case 'human_gated':` to the `human_gated` arm of `classifyStage` (next to `case 'merge_blocked':`, line 65–66). Required for the exhaustive `switch` to compile (the `never` guard). **This is the only behavioral change to the classifier; every other stage's class is unchanged.**
- `adws/types/agentTypes.ts` — add `resumeAttempts?: number` to `AgentState` (after `mergeRetryCount`, ~line 278), with a doc comment mirroring `mergeRetryCount`'s ("Resume-attempt counter for the bounded resume cap. Incremented on each automatic resume of a `resumable` stage (`phase_timeout`); escalates to `human_gated` at `MAX_RESUME_ATTEMPTS`; cleared (re-armed) on `## Retry`.").
- `adws/triggers/takeoverHandler.ts` — the core wiring:
  - Add `escalate_human_gated` to the `CandidateDecision` union: `| { readonly kind: 'escalate_human_gated'; readonly adwId: string }`.
  - Add two members to `TakeoverDeps`: `writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void` and `commentOnIssue: (issueNumber: number, body: string, repoInfo: RepoInfo) => void`, with real implementations wired in `buildDefaultTakeoverDeps` (`AgentStateManager.writeTopLevelState`, and `commentOnIssue` from `../github/githubApi`).
  - Replace the existing `if (stage === 'phase_timeout') { return recoverViaResetFromRemote(...); }` branch (line 166–168) with the cap-gated version (read `resumeAttempts`, call `nextResumeAction`, escalate-or-increment-and-recover). Import `nextResumeAction`, `MAX_RESUME_ATTEMPTS` from `../core/resumePolicy` and `formatHumanGatedComment` from `../github/workflowCommentsIssue`.
- `adws/triggers/trigger_cron.ts` — add an `if (takeoverDecision.kind === 'escalate_human_gated') { log(...); continue; }` branch next to the `skip_terminal` handling (line 296–299). **Important:** place it **before** `processedSpawns.add(...)` (line 305) so an escalation is not recorded as a spawn (mirror how `defer_live_holder`/`skip_terminal` `continue` before that line).
- `adws/triggers/webhookGatekeeper.ts` — add an `if (decision.kind === 'escalate_human_gated') { log(...); return; }` branch next to its `skip_terminal` handling (line 107–110).
- `adws/triggers/cronIssueFilter.ts` — add an inline `human_gated` exclusion in `evaluateIssue`, immediately after the `merge_blocked` block (line 110–114), mirroring it exactly: `if (resolution.stage === 'human_gated') { return { eligible: false, reason: 'human_gated' }; }`.
- `adws/triggers/retryHandler.ts` — extend `handleRetryDirective` to branch on stage: `merge_blocked → { workflowStage: 'awaiting_merge', mergeRetryCount: 0 }` (unchanged); `human_gated → { workflowStage: 'phase_timeout', resumeAttempts: 0 }` (new); any other stage → no-op `false` (unchanged guarantee). Update the JSDoc accordingly.
- `adws/github/workflowCommentsIssue.ts` — add an exported `formatHumanGatedComment(adwId: string, attempts: number, max: number): string`, modeled on `adwMerge.tsx`'s `buildMergeBlockedComment` (heading, `**Cause:**`, `**Remedy:** ... comment \`## Retry\` ...`, `**ADW ID:**`, `ADW_SIGNATURE`). It must mention the `## Retry` directive as the recovery path.
- `adws/core/workflowCommentParsing.ts` — **comment-only**: update the doc comment on `RETRY_COMMENT_PATTERN` / `isRetryComment` (line ~116) to note it recovers both `merge_blocked` and `human_gated`. No code change.

### Source — read-only reference (do NOT modify)

- `adws/adwMerge.tsx` — `MAX_PR_RESOLUTION_ATTEMPTS` (line 32), the `mergeRetryCount` escalation block (lines 122–141), and `buildMergeBlockedComment` (lines 68–79). The imperative escalation precedent to mirror (but factored into the pure `nextResumeAction`).
- `adws/phases/progressGate.ts` — `evaluateProgressGate` / `describeProgressGateAbort`. The pure-decision-function shape `nextResumeAction` should match (discriminated/union return, `>= max` backstop, exhaustive).
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState` / `writeTopLevelState` (shallow-merge semantics confirm `resumeAttempts` survives partial writes and across ticks). No change.
- `adws/phases/workflowInit.ts` — writes initial `{ workflowStage: 'starting' }` on (re)spawn without touching `resumeAttempts`, and `writeTopLevelState` merges, so the counter is preserved through resume. No change.
- `adws/triggers/scanAuthQueue.ts` — calls `evaluateCandidate` and checks `decision.kind !== 'take_over_adwId'` (line 102); `escalate_human_gated` is naturally treated as "not a takeover" (skip). Confirm no change needed.

### Tests — modified

- `adws/core/__tests__/stageClassifier.test.ts` — add `human_gated: 'human_gated'` to the exhaustive `Record<WorkflowStage, StageClass>` `EXPECTED` map (the `Record` type forces this entry to compile — a second exhaustiveness backstop).
- `adws/triggers/__tests__/takeoverHandler.test.ts` — update the `makeDeps` helper to include `writeTopLevelState: vi.fn()` and `commentOnIssue: vi.fn()`; update the existing `take_over_adwId from phase_timeout` block to assert the `resumeAttempts` increment; add a new `escalate_human_gated from phase_timeout at cap` describe block.
- `adws/triggers/__tests__/cronIssueFilter.test.ts` — add a `human_gated` exclusion test (mirrors the `merge_blocked` test).
- `adws/triggers/__tests__/retryHandler.test.ts` — add a `human_gated → phase_timeout` reset test (mirrors the `merge_blocked → awaiting_merge` test); confirm the existing `merge_blocked` test still passes.
- `adws/triggers/__tests__/webhookGatekeeper.test.ts` and `adws/triggers/__tests__/trigger_cron.test.ts` — **if present**, add/confirm coverage that an `escalate_human_gated` decision does not spawn. Inspect first; only edit if a referenced symbol/branch needs it.

### Conditional documentation (matched conditions — read before implementing)

- `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` — **primary; Owns `stageClassifier.ts`, `cronStageResolver.ts`, `cronIssueFilter.ts`, `takeoverHandler.ts`, `workflowTypes.ts`, `workflowCommentsIssue.ts`, `workflowCompletion.ts`.** Conditions directly matched: "adding a new `WorkflowStage` literal and need to assign it a recovery class", "modifying `evaluateCandidate` in `takeoverHandler.ts` or the stage-dispatch logic", "modifying `evaluateIssue` in `cronIssueFilter.ts` stage eligibility checks", "adding a per-consumer raw-stage recovery branch for a specific stage that diverges from its StageClass default", "the `never` exhaustiveness guard … is relevant". The `/document` phase must update **this** doc (docs-ownership routing), not spawn a new one, for the classifier/takeover/cron/workflowTypes edits.
- `app_docs/feature-9gjajh-types.md` — Owns `adws/types/**` (`AgentState`, the `resumeAttempts` field; `WorkflowStage`). Relevant for the type additions.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — Owns `retryHandler.ts` (the `## Retry` recovery extension).
- `app_docs/feature-9gjajh-cron-triggers.md` / `app_docs/feature-9gjajh-webhook-triggers.md` — Own `trigger_cron.ts` / `webhookGatekeeper.ts` (the new `escalate_human_gated` caller branches).
- `app_docs/feature-bed2tg-orchestrator-watchdog-agent-timeout.md` — `handlePhaseTimeout` and the `phase_timeout` stage (the motivating loop). The new resume-cap conceptually lives near this.
- The new `adws/core/resumePolicy.ts` has **no current owner**; the `/document` phase will route it (novel-only create, or fold into the nearest owning doc per the registry).

## Implementation Plan

### Phase 1: Foundation — the pure policy and the new stage vocabulary

Create the pure `resumePolicy.ts` (`nextResumeAction`, `MAX_RESUME_ATTEMPTS`, `ResumeAction`) and its boundary unit tests first (TDD-friendly; pure function). Add the `human_gated` `WorkflowStage` literal, classify it in `classifyStage`, and add the `resumeAttempts` field to `AgentState`. After this phase, `tsc` is the proof the new stage is exhaustively classified.

### Phase 2: Core implementation — the takeover cap gate

Wire the cap into the `phase_timeout` branch of `evaluateCandidate`: read `resumeAttempts`, decide via `nextResumeAction`, and either increment-and-recover or escalate-to-`human_gated` (write state + post comment + new `escalate_human_gated` decision). Add the `writeTopLevelState`/`commentOnIssue` deps and the escalation comment formatter.

### Phase 3: Integration — callers, cron exclusion, and `## Retry` recovery

Handle the new `escalate_human_gated` decision in the two callers (`trigger_cron.ts`, `webhookGatekeeper.ts`). Add the `human_gated` cron-filter exclusion. Extend `handleRetryDirective` to re-arm `human_gated → phase_timeout` with `resumeAttempts: 0`. Update the affected tests and run the full validation suite to prove zero regressions.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1 — Read references and confirm the contracts
- Read `.adw/coding_guidelines.md` and the matched conditional docs (at minimum `feature-d0hv98`, `feature-9gjajh-types`, `feature-9gjajh-issue-routing-and-eligibility`, `feature-bed2tg`).
- Confirm the precedents you will mirror: `adws/phases/progressGate.ts` (pure decision shape), `adws/adwMerge.tsx` lines 32 & 122–141 & 68–79 (`mergeRetryCount`/`merge_blocked`/`buildMergeBlockedComment`), `adws/triggers/retryHandler.ts` (the `## Retry` handler), and the existing `phase_timeout` branch in `adws/triggers/takeoverHandler.ts` (line 166–168). Confirm `classifyStage('awaiting_merge') === 'awaiting_merge'` (the stage-name==class-name precedent for `human_gated`).

### Step 2 — Create the pure policy module `adws/core/resumePolicy.ts`
- Export `export type ResumeAction = 'resume' | 'escalate';`.
- Export `export const MAX_RESUME_ATTEMPTS = 3;` with a doc comment (the hard cap on automatic resumes of a resumable stage before human gating).
- Export `export function nextResumeAction(attempts: number, max: number = MAX_RESUME_ATTEMPTS): ResumeAction { return attempts >= max ? 'escalate' : 'resume'; }` with a JSDoc block documenting: pure (same inputs → same output, no I/O), `attempts` = resumes already performed, semantics (`attempts < max → resume`; `attempts >= max → escalate`), and that it mirrors the `progressGate` checkpoint backstop applied across resume attempts. Keep the file well under 300 lines.

### Step 3 — Write `adws/core/__tests__/resumePolicy.test.ts` (pure boundary tests)
- Assert the boundary cases for `nextResumeAction(attempts, max)`:
  - `nextResumeAction(0, 3) === 'resume'`, `nextResumeAction(1, 3) === 'resume'`, `nextResumeAction(2, 3) === 'resume'` (below the bound).
  - `nextResumeAction(3, 3) === 'escalate'` (**at** the bound), `nextResumeAction(4, 3) === 'escalate'` (above, defensive).
  - Degenerate caps: `nextResumeAction(0, 0) === 'escalate'`, and `nextResumeAction(0, 1) === 'resume'` / `nextResumeAction(1, 1) === 'escalate'`.
  - Default-param wiring: `nextResumeAction(MAX_RESUME_ATTEMPTS - 1) === 'resume'` and `nextResumeAction(MAX_RESUME_ATTEMPTS) === 'escalate'`.

### Step 4 — Add the `human_gated` stage and classify it
- `adws/types/workflowTypes.ts`: add `| 'human_gated'` to the `WorkflowStage` union after `merge_blocked` (~line 70), with a doc comment describing it as the bounded-resume escalation target, non-retriable, recoverable only via `## Retry` (which re-arms `resumeAttempts`).
- `adws/core/stageClassifier.ts`: add `case 'human_gated':` to the arm that returns `'human_gated'` (alongside `case 'merge_blocked':`, line 65–66). Do **not** change any other case. (Skipping this is a deliberate `tsc` `never`-guard error — confirm it appears if you build before adding the case, then add it.)
- `adws/core/__tests__/stageClassifier.test.ts`: add `human_gated: 'human_gated'` to the `EXPECTED` `Record<WorkflowStage, StageClass>` map.

### Step 5 — Add the `resumeAttempts` field to `AgentState`
- `adws/types/agentTypes.ts`: add `resumeAttempts?: number;` after `mergeRetryCount` (~line 278) with the doc comment described in Relevant Files. No other type changes.

### Step 6 — Add the escalation comment formatter
- `adws/github/workflowCommentsIssue.ts`: add an exported `formatHumanGatedComment(adwId: string, attempts: number, max: number): string` modeled on `buildMergeBlockedComment`. Include a `## :warning: ADW Resume Blocked` (or similar) heading, a `**Cause:**` line stating the run was automatically resumed `attempts` times (cap `max`) without completing, a `**Remedy:**` line instructing the operator to fix the underlying issue and comment `` `## Retry` `` to re-arm and resume, the `**ADW ID:** \`${adwId}\`` line, and the `ADW_SIGNATURE` footer. Keep it ctx-free (no `WorkflowContext`).

### Step 7 — Wire the cap gate into `evaluateCandidate` (`adws/triggers/takeoverHandler.ts`)
- Add to the `CandidateDecision` union: `| { readonly kind: 'escalate_human_gated'; readonly adwId: string }`.
- Add to `TakeoverDeps`: `readonly writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;` and `readonly commentOnIssue: (issueNumber: number, body: string, repoInfo: RepoInfo) => void;`. Wire real implementations in `buildDefaultTakeoverDeps` (`(adwId, s) => AgentStateManager.writeTopLevelState(adwId, s)` and `commentOnIssue` imported from `../github/githubApi`).
- Import `nextResumeAction`, `MAX_RESUME_ATTEMPTS` from `../core/resumePolicy` and `formatHumanGatedComment` from `../github/workflowCommentsIssue`.
- Replace the existing `phase_timeout` branch (line 166–168) with the cap-gated version, e.g.:
  ```ts
  // phase_timeout: the watchdog killed the agent and handlePhaseTimeout exited the
  // orchestrator (dead PID). Recovery is otherwise unbounded — a phase that wedges
  // deterministically would be auto-resumed every tick forever (money fire). Cap the
  // automatic resumes; escalate to human_gated when the bound is reached (issue #639).
  if (stage === 'phase_timeout') {
    const attempts = state.resumeAttempts ?? 0;
    if (nextResumeAction(attempts, MAX_RESUME_ATTEMPTS) === 'escalate') {
      d.writeTopLevelState(adwId, { workflowStage: 'human_gated' });
      d.commentOnIssue(
        input.issueNumber,
        formatHumanGatedComment(adwId, attempts, MAX_RESUME_ATTEMPTS),
        input.repoInfo,
      );
      releaseLock();
      return { kind: 'escalate_human_gated', adwId };
    }
    d.writeTopLevelState(adwId, { resumeAttempts: attempts + 1 });
    return recoverViaResetFromRemote(d, input, adwId, state);
  }
  ```
- Do **not** modify the `retriable` (abandoned), `active`, `terminal`, or final `spawn_fresh` branches. The gate must remain surgical to `phase_timeout`. Keep the gate **above** `recoverViaResetFromRemote` so it composes with the recovery mechanism regardless of whether reset-from-remote (#637) or a future worktree-reuse (#638) is what "proceed" does.

### Step 8 — Handle the new decision in the two callers
- `adws/triggers/trigger_cron.ts`: add, next to the `skip_terminal` branch (line 296–299) and **before** `processedSpawns.add(issue.number)` (line 305):
  ```ts
  if (takeoverDecision.kind === 'escalate_human_gated') {
    log(`Issue #${issue.number}: resume cap reached, escalated adwId=${takeoverDecision.adwId} → human_gated (awaiting ## Retry)`, 'warn');
    continue;
  }
  ```
- `adws/triggers/webhookGatekeeper.ts`: add, next to its `skip_terminal` branch (line 107–110):
  ```ts
  if (decision.kind === 'escalate_human_gated') {
    log(`Issue #${issueNumber}: resume cap reached, escalated adwId=${decision.adwId} → human_gated (awaiting ## Retry)`, 'warn');
    return;
  }
  ```

### Step 9 — Add the cron-filter `human_gated` exclusion (`adws/triggers/cronIssueFilter.ts`)
- Immediately after the `merge_blocked` block (line 110–114), add the mirror:
  ```ts
  // human_gated bypasses grace period — escalated resume awaiting an explicit
  // human `## Retry`. Never auto-spawned; recovery re-arms it to phase_timeout.
  if (resolution.stage === 'human_gated') {
    return { eligible: false, reason: 'human_gated' };
  }
  ```
- Leave all other branches untouched.

### Step 10 — Extend `## Retry` recovery for `human_gated` (`adws/triggers/retryHandler.ts`)
- Refactor `handleRetryDirective` to branch on the resolved stage after the `adwId` guard:
  ```ts
  const state = deps.readTopLevelState(adwId);
  const stage = state?.workflowStage;
  if (stage === 'merge_blocked') {
    deps.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge', mergeRetryCount: 0 });
    log(`Retry #${issueNumber}: reset adwId=${adwId} merge_blocked → awaiting_merge, cleared retry counter`, 'success');
    return true;
  }
  if (stage === 'human_gated') {
    deps.writeTopLevelState(adwId, { workflowStage: 'phase_timeout', resumeAttempts: 0 });
    log(`Retry #${issueNumber}: re-armed adwId=${adwId} human_gated → phase_timeout, cleared resume counter`, 'success');
    return true;
  }
  log(`Retry #${issueNumber}: adwId=${adwId} not human-gated (stage=${stage ?? 'none'}), ignoring`);
  return false;
  ```
- Preserve the early-return `false` when no `adwId` is found. Update the function/module JSDoc to describe both recovery paths and that `## Retry` cannot disturb any non-human-gated stage.

### Step 11 — Update the `## Retry` parser doc comment (`adws/core/workflowCommentParsing.ts`)
- Comment-only: update the JSDoc on `RETRY_COMMENT_PATTERN` / `isRetryComment` to note it recovers both `merge_blocked` and `human_gated`. No code change.

### Step 12 — Update and add tests
- `adws/triggers/__tests__/takeoverHandler.test.ts`:
  - Add `writeTopLevelState: vi.fn()` and `commentOnIssue: vi.fn()` to the `makeDeps` defaults.
  - Update the existing `take_over_adwId from phase_timeout` block: with `makeState({ workflowStage: 'phase_timeout', branchName: '…' })` (no `resumeAttempts`), assert it still returns `take_over_adwId` **and** that `writeTopLevelState` was called with `{ resumeAttempts: 1 }`. Add a case with `resumeAttempts: 2` (below cap of 3) asserting `take_over_adwId` + `{ resumeAttempts: 3 }`.
  - Add `describe('escalate_human_gated from phase_timeout at cap', …)`: with `makeState({ workflowStage: 'phase_timeout', resumeAttempts: 3 })`, assert the decision `kind === 'escalate_human_gated'` carrying `adwId`; `writeTopLevelState` called with `{ workflowStage: 'human_gated' }`; `commentOnIssue` called once; the spawn lock **is released**; and `resetWorktree`/`deriveStageFromRemote` are **not** called (no recovery on escalation).
  - Confirm the `abandoned`, `*_running`, `skip_terminal`, and `spawn_fresh` blocks pass **unchanged** (no other branch touched).
- `adws/core/__tests__/resumePolicy.test.ts`: as specified in Step 3.
- `adws/core/__tests__/stageClassifier.test.ts`: `human_gated: 'human_gated'` added (Step 4).
- `adws/triggers/__tests__/cronIssueFilter.test.ts`: add a test that an injected resolution `{ stage: 'human_gated', adwId }` yields `{ eligible: false, reason: 'human_gated' }`, and that `filterEligibleIssues` lists it under `filteredAnnotations` as `#N(human_gated)`, not in `eligible`.
- `adws/triggers/__tests__/retryHandler.test.ts`: add a test that `makeState({ workflowStage: 'human_gated', resumeAttempts: 3 })` + a `## Retry` (adw-id comment) calls `writeTopLevelState(adwId, { workflowStage: 'phase_timeout', resumeAttempts: 0 })` and returns `true`; confirm the existing `merge_blocked` and other-stage no-op tests still pass.
- Inspect `adws/triggers/__tests__/webhookGatekeeper.test.ts` and `adws/triggers/__tests__/trigger_cron.test.ts`; if they enumerate decision kinds or assert spawn behavior, add a case proving `escalate_human_gated` does not spawn. Otherwise leave unchanged.

### Step 13 — Refactor pass for coding guidelines
- Re-read `.adw/coding_guidelines.md`. Confirm: `resumePolicy.ts` is a pure function (no I/O, explicit types, no `any`); `evaluateCandidate` still reads top-to-bottom as guarded dispatch (≤2 nesting depth — extract a helper if the `phase_timeout` branch grows a nested tree); `handleRetryDirective` uses guard clauses; no unused imports; all touched files stay well under 300 lines. The new `TakeoverDeps` members follow the existing injected-I/O pattern.

### Step 14 — Run the Validation Commands
- Run every command in **Validation Commands**. The `bunx tsc --noEmit -p adws/tsconfig.json` run is the proof the new `human_gated` stage is exhaustively classified (the `never` guard) and that `AgentState.resumeAttempts` typechecks at every write site. The targeted vitest runs prove acceptance criteria 1–4; the full `bun run test:unit` is the zero-regression proof. Fix any failure before considering the task complete.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **`adws/core/__tests__/resumePolicy.test.ts` (new)** — the authoritative boundary proof for `nextResumeAction` (acceptance criterion 4): below the bound → `resume`; at the bound and above → `escalate`; degenerate caps (`max = 0`, `max = 1`); default-`max` wiring. Pure assertions, no mocks.
- **`adws/core/__tests__/stageClassifier.test.ts` (updated)** — `human_gated: 'human_gated'` in the exhaustive `Record<WorkflowStage, StageClass>` map proves the new literal is classified into the `human_gated` class (and the `Record` type forces the entry to exist).
- **`adws/triggers/__tests__/takeoverHandler.test.ts` (updated)** — the takeover seam: below-cap `phase_timeout` increments `resumeAttempts` and still returns `take_over_adwId`; at-cap `phase_timeout` returns `escalate_human_gated`, writes `human_gated`, posts the comment, releases the lock, and performs **no** recovery I/O. The `abandoned`/`*_running`/`terminal`/`spawn_fresh` branches remain green unchanged (surgical-change proof).
- **`adws/triggers/__tests__/cronIssueFilter.test.ts` (updated)** — `human_gated` is excluded (reason `human_gated`), never eligible.
- **`adws/triggers/__tests__/retryHandler.test.ts` (updated)** — `## Retry` re-arms `human_gated → phase_timeout` with `resumeAttempts: 0`, and still resets `merge_blocked → awaiting_merge`; no-op for any other stage.

### Edge Cases

- **At the exact bound** — `resumeAttempts === MAX_RESUME_ATTEMPTS` (3) escalates (not resume). This is the precise boundary the issue calls out ("at/above the bound → escalate").
- **Missing counter** — `state.resumeAttempts === undefined` is treated as `0` (first resume increments to 1). A fresh `phase_timeout` (never resumed) always resumes.
- **Counter survives ticks** — after an increment, `writeTopLevelState` shallow-merges, and `workflowInit`'s `{ workflowStage: 'starting' }` write on re-spawn does not clear `resumeAttempts`; the next tick reads the incremented value (acceptance criterion 1).
- **`## Retry` re-arm loop** — after escalation, `## Retry` sets `{ phase_timeout, resumeAttempts: 0 }`; the next tick resumes (attempts 0 < 3) and can re-escalate after another full cap if the underlying issue is unfixed. Resetting to `phase_timeout` (not `abandoned`) keeps the re-armed run under the cap.
- **`## Retry` on a non-human-gated, non-merge-blocked stage** — no-op `false` (the directive cannot disturb an active/completed/`awaiting_merge` workflow).
- **Other `resumable` stages unaffected** — `plan_created`, `build_completed`, etc. remain `spawn_fresh` in takeover and excluded in cron; the cap touches only the `phase_timeout` recovery branch, so no non-`phase_timeout` stage changes behavior.
- **`escalate_human_gated` never spawns** — both `trigger_cron` and `webhookGatekeeper` skip the spawn (and cron does not add the issue to `processedSpawns`).
- **`scanAuthQueue` interaction** — it only takes over on `take_over_adwId`; `escalate_human_gated` is correctly treated as "not a takeover" and skipped.

## Acceptance Criteria

- `adws/core/resumePolicy.ts` exports a pure `nextResumeAction(attempts, max)` returning `'resume'` below the bound and `'escalate'` at/above it, with `MAX_RESUME_ATTEMPTS = 3`; covered by boundary unit tests.
- `AgentState.resumeAttempts` is persisted via `writeTopLevelState` in the `phase_timeout` takeover branch and survives across cron ticks (read back on the next tick).
- Below the bound, a `phase_timeout` workflow is resumed and the counter is incremented; at/above the bound it escalates to the new `human_gated` stage (state written, human-facing comment posted, no re-spawn).
- `human_gated` is a `WorkflowStage` literal classified into the `human_gated` `StageClass` (exhaustive `classifyStage` compiles), excluded by the cron filter, and recoverable via `## Retry`, which re-arms `resumeAttempts: 0` and returns the workflow to `phase_timeout`.
- No other stage's recovery behavior changes (the existing takeover/cron/retry tests pass unchanged except for the intentional `human_gated` additions).
- `bun run lint`, both `tsc` typechecks, `bun run test:unit`, and `bun run build` all pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — ESLint; no new lint errors (unused vars, `any`, etc.).
- `bunx tsc --noEmit` — root typecheck passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — **ADW typecheck; proof the new `human_gated` stage is exhaustively classified (the #636 `never` guard) and `resumeAttempts` typechecks at every write site.**
- `bunx vitest run adws/core/__tests__/resumePolicy.test.ts` — the pure `nextResumeAction` boundary suite (acceptance criterion 4).
- `bunx vitest run adws/core/__tests__/stageClassifier.test.ts` — `human_gated` classification (RED before the Step 4 `case`, GREEN after).
- `bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts` — the cap gate: increment-on-resume and escalate-at-cap, with the unchanged branches still green (RED before Step 7, GREEN after).
- `bunx vitest run adws/triggers/__tests__/cronIssueFilter.test.ts adws/triggers/__tests__/retryHandler.test.ts` — the `human_gated` cron exclusion and `## Retry` re-arm (RED before Steps 9–10, GREEN after); existing `merge_blocked` cases still pass.
- `bunx vitest run adws/triggers/__tests__/trigger_cron.test.ts adws/triggers/__tests__/webhookGatekeeper.test.ts adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts adws/triggers/__tests__/devServerJanitor.test.ts` — cron/webhook/janitor regression surface (no collateral behavior change).
- `bun run test:unit` — the complete Vitest suite passes (zero regressions).
- `bun run build` — `tsc` build succeeds with no errors.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` applies: `resumePolicy.ts` is a pure function (no I/O, explicit types, no `any`); `evaluateCandidate`/`handleRetryDirective` stay guard-clause dispatch (≤2 nesting depth); the new `TakeoverDeps` members follow the existing injected-I/O pattern (every branch stays unit-testable); no unused imports; all files well under 300 lines.
- **Why the takeover seam, not the orchestrator.** The increment+escalate is placed in `evaluateCandidate`'s `phase_timeout` branch because (a) it is the single mandatory gate **both** cron (`trigger_cron.ts:289`) and webhook (`webhookGatekeeper.ts:100`) route through, so one edit covers both spawn paths; (b) it is the exact point where "we are about to resume a resumable stage" is known with the resting `state` in hand; and (c) `evaluateCandidate` already performs gated I/O via `TakeoverDeps`, so writing state and posting a comment there is consistent (the `merge_blocked` analogue lives in `adwMerge.tsx` because the orchestrator *is* the merge handler; for resume, the takeover gate *is* the resume handler). Pre-spawn gating also avoids paying the re-spawn cost on the escalation tick.
- **Why `human_gated` as a stage literal (name == class name).** This mirrors the existing `awaiting_merge` precedent (`classifyStage('awaiting_merge') === 'awaiting_merge'`) and matches the issue's exact vocabulary and acceptance criteria. `merge_blocked` stays a distinct, descriptively-named sibling in the same `human_gated` `StageClass`, so the merge and resume escalations remain independently recoverable (different `## Retry` reset targets: `awaiting_merge` vs `phase_timeout`). A single shared `merge_blocked` stage was rejected because the `## Retry` handler could not then tell which reset to apply. (`resume_exhausted` was considered as a name but diverges from the issue/AC vocabulary; `human_gated` is preferred.)
- **`escalate_human_gated` decision kind.** A dedicated `CandidateDecision` kind is used rather than overloading `skip_terminal` (whose `terminalStage` union is `completed|discarded|paused|paused_auth` and whose semantics are "terminal, not recoverable"). Widening that union would be a type lie; the explicit kind keeps the taxonomy honest (in keeping with #636) at the cost of two one-line caller branches.
- **Composition with sibling slice #638 (resume-in-place).** #638 (also blocked-by #637, not yet merged) makes the `phase_timeout`/`abandoned` recovery *mechanism* conditional (worktree-reuse vs reset-from-remote) while keeping the `take_over` decision shape unchanged. This feature's cap gate sits **above** `recoverViaResetFromRemote` and only decides escalate-vs-proceed, so it composes with either mechanism. If both land, expect a small merge touchpoint in the same `phase_timeout` branch region — keep the cap check at the top of the branch.
- **Cumulative counter; reset-on-progress is out of scope.** `resumeAttempts` is cumulative per workflow and cleared only on `## Retry` (mirroring `mergeRetryCount`, which is cleared on success and on `## Retry`). Resetting the counter when the workflow makes forward progress (e.g. a tree-hash-novelty signal like `progressGate`, or clearing on reaching `awaiting_merge`/`completed`) is a sensible future enhancement but is **not** required by the acceptance criteria and is deliberately omitted to keep this slice tight. A workflow that genuinely advances but times out at several distinct phases will still escalate after `MAX_RESUME_ATTEMPTS` total resumes — acceptable for a money-fire backstop and consistent with the cumulative `mergeRetryCount` precedent.
- **Parent PRD missing.** `specs/prd/stage-recovery-resume-in-place.md` (referenced by the issue) does not exist in the repo (confirmed; same as the #636/#637/#638 plans). This plan infers the slice boundary from the issue body, the #636/#637 plans, the `mergeRetryCount`/`merge_blocked` and `progressGate` precedents, and the existing stage-routing semantics. If the PRD lands later and defines the resume policy or stage name differently, reconcile before/at review.
- **Worktree hygiene (recurring incident — important).** This fresh worktree already contains out-of-scope working-tree modifications that diverge from `origin/dev`: `.claude/commands/document.md`, `.claude/commands/adw_init.md`, and `README.md` (the recurring "worktree born with dependency reversion" pattern, seen on #612/#636/#637/#641). These are unrelated to #639. The build/commit step must stage **only** the resume-cap source/test/doc files listed above — do **not** `git add -A`/`git commit -am` the reverted command/README files into this PR. Review should use `git diff origin/dev` and blocker any out-of-scope command-file revert of merged work.
- **No new libraries.** Pure TypeScript over existing types and the existing `TakeoverDeps`/`AgentStateManager`/`commentOnIssue` machinery. (`.adw/commands.md` library install command is `bun add <package>` if ever needed — it is not needed here.)
