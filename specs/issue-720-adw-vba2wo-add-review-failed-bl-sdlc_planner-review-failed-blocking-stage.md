# Feature: `review_failed` blocking stage + SDLC blocks on review exhaustion

## Metadata
issueNumber: `720`
adwId: `vba2wo-add-review-failed-bl`
issueJson: `{"number":720,"title":"Add review_failed blocking stage + SDLC blocks on review exhaustion","body":"## Parent PRD\n\n`specs/prd/pr-review-adwid-consolidation-and-review-failed-gate.md`\n\n## What to build\n\nIntroduce an explicit `review_failed` blocking stage and make the SDLC orchestrator use it, end-to-end. When the SDLC review-retry loop is exhausted with unresolved blockers, write `review_failed` and **skip document + PR creation** (the review loop already runs before PR creation), instead of today's unconditional hand-off to `awaiting_merge`. `review_failed` is classified into the cron-excluded human-gated class and is recoverable only via `## Retry`, which re-runs the review. See PRD §Solution item 2 and §Implementation Decisions \"New / changed workflow stage\", \"Post-review outcome gate\", \"## Retry recovery\".\n\n## Acceptance criteria\n\n- [ ] `review_failed` added to the workflow stage taxonomy\n- [ ] `review_failed` classified into the same excluded/human-gated class as `merge_blocked`/`human_gated`; cron issue filter returns `eligible:false` for it (explicit test — the money-fire pin)\n- [ ] `decidePostReviewOutcome` extended: fail → `review_failed` (+ SDLC skip-doc/PR signal)\n- [ ] On exhausted SDLC review, the stage is `review_failed`, no PR is created, and a comment points at the branch\n- [ ] retryHandler: `review_failed → phase_timeout` (re-arm); no-op for unrelated stages\n- [ ] `## Retry` on a `review_failed` SDLC issue re-runs the review (completed plan/build/step-def stay skipped)\n- [ ] Unit tests for the classification, cron-filter exclusion, retry transition, and gate fail-path; regression/BDD green\n\n## Blocked by\n\n- Blocked by #719 (extends the shared `decidePostReviewOutcome` module)\n\n## Touched Files\n\n- adws/types/workflowTypes.ts\n- adws/core/stageClassifier.ts\n- adws/triggers/cronIssueFilter.ts\n- adws/triggers/retryHandler.ts\n- adws/adwSdlc.tsx\n- adws/phases/decidePostReviewOutcome.ts\n\n## User stories addressed\n\n- User story 4\n- User story 6\n- User story 7\n- User story 8\n- User story 9\n- User story 17\n- User story 19\n- User story 20","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-29T12:34:03Z","comments":[{"author":"paysdoc","createdAt":"2026-06-29T17:32:12Z","body":"## continue"}],"actionableComment":null}`

## Feature Description

Today the SDLC orchestrator (`adwSdlc.tsx`) runs its review → patch → retest retry loop, and then — **regardless of whether the review actually passed** — proceeds unconditionally to document creation, PR creation, and the `awaiting_merge` hand-off. When the review-retry budget (`MAX_REVIEW_RETRY_ATTEMPTS`) is exhausted with unresolved blocker issues still present, the orchestrator still ships: it opens a PR and writes `awaiting_merge`. The only thing preventing a bad auto-merge is that the PR is left unapproved (approval is gated on the review passing) plus branch protection / the `hitl` gate. There is no explicit "this review failed, stop and ask a human" workflow state.

This feature introduces an explicit **`review_failed` blocking stage** and wires the SDLC orchestrator to use it end-to-end:

- When the SDLC review loop is exhausted with `reviewPassed === false`, the orchestrator writes the `review_failed` workflow stage and **skips document + PR creation entirely** — no PR exists until the work actually passes review.
- `review_failed` is classified into the same **cron-excluded, human-gated class** as `merge_blocked` / `human_gated`. The cron never auto-spawns or auto-merges it; this is safety-critical, because a failing review landing in the `retriable` (auto-spawn) bucket would re-run a full, expensive orchestrator every cron tick with no human in the loop (the "money-fire" risk).
- `review_failed` is recoverable **only** by a human posting `## Retry`, which re-arms the workflow to `phase_timeout` so the review phase re-runs on the next recovery cycle. Completed plan / build / step-def phases stay skipped; only the (non-skip-tracked) review phase re-executes.
- The `review_failed` issue comment points at the branch and tells the operator to push a fix and post `## Retry`, so the human can inspect and fix the (PR-less) work.

The post-review pass/fail decision lives in one pure, shared function — `decidePostReviewOutcome` — already introduced by #719 and consumed by `adwPrReview`. This feature extends that single function so both orchestrators gate identically, and makes `adwSdlc` consume it.

## User Story

As an **ADW operator**,
I want **an exhausted SDLC review to block the issue in an explicit `review_failed` state that cron never auto-spawns or auto-merges, that creates no PR, and that I recover by pushing a fix and posting `## Retry`**,
So that **broken work is never silently shipped to `awaiting_merge`, no money-burning unattended re-run loop can start, and I have a clear, branch-pointing recovery path**.

(Covers PRD user stories 4, 6, 7, 8, 9, 17, 19, 20.)

## Problem Statement

The SDLC orchestrator's post-review path does not branch on the review verdict. After the review-retry loop, it always runs document → PR → `awaiting_merge`. Consequently:

1. **Broken work is shipped.** An exhausted review with unresolved blockers still creates a PR and hands off to `awaiting_merge`. Only secondary gates (unapproved PR, branch protection, `hitl`) prevent a bad merge — there is no first-class "failed review" state.
2. **No human-gated stop.** There is no workflow stage that says "this failed review, a human must intervene." The closest existing stages (`merge_blocked`, `human_gated`) are for other failure classes.
3. **`review_failed` is mis-classified.** The `review_failed` literal already exists in the `WorkflowStage` union but is currently classified as `resumable` — meaning if any path persisted it, recovery logic would treat it as ordinarily resumable rather than human-gated/excluded. It must move into the human-gated class, with an explicit cron-filter exclusion test so a future refactor cannot silently make it auto-spawnable.
4. **No recovery route.** Even if `review_failed` were written, the `## Retry` directive handler (`handleRetryDirective`) only recognizes `merge_blocked → awaiting_merge` and `human_gated → phase_timeout`. A `review_failed` issue would be un-recoverable via `## Retry`.

## Solution Statement

Follow the established **non-retriable, human-recoverable terminal stage** pattern (the same pattern `merge_blocked` uses: `handleRetryDirective` re-arm + cron ineligibility guard; see `app_docs/feature-22y8n3-merge-blocked-recovery-path.md`):

1. **Stage taxonomy** — confirm the `review_failed` literal in the `WorkflowStage` union (it already exists; no new literal needed) and **reclassify** it from `resumable` to `human_gated` in `classifyStage`. The exhaustive `never`-guarded switch makes this a single-line move that the compiler enforces.
2. **Cron exclusion (money-fire pin)** — add an explicit `review_failed → { eligible: false, reason: 'review_failed' }` branch in `evaluateIssue`, placed **before** the grace-period and processed-spawn checks (mirroring the existing `merge_blocked` / `human_gated` guards), so a `review_failed` issue is never spawned regardless of activity recency or dedup state.
3. **Post-review gate (shared, pure)** — extend `decidePostReviewOutcome(reviewPassed)`: a failing review now returns `{ writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true }` (was `workflowStage: null`); a passing review returns `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge', skipDocAndPR: false }`. The new `skipDocAndPR` flag tells SDLC callers to exit before document + PR phases.
4. **SDLC wiring** — in `adwSdlc.tsx`, after the review loop, call `decidePostReviewOutcome(reviewPassed)`. When `skipDocAndPR` is true: write `review_failed` to top-level state, persist orchestrator metadata + token counts, **post the branch-pointing `review_failed` comment to the issue** (the operator-facing recovery signal AC4 / User Story 20 require), log the branch, and `return` (skipping document, PR, proof-publish, and the `awaiting_merge` hand-off). Otherwise proceed exactly as today.
5. **`## Retry` recovery** — add a `review_failed → phase_timeout` (with `resumeAttempts: 0`) transition to `handleRetryDirective`, mirroring the existing `human_gated → phase_timeout` path. On resume the review phase re-runs because it is not skip-tracked; completed plan / build / step-def phases stay skipped.
6. **Branch-pointing comment** — the `review_failed` issue comment (built by `formatReviewFailedComment`, posted per-attempt from `reviewPhase.ts` **and** deterministically by the SDLC review-failure handoff — the latter is what scenario §2 asserts and what makes the comment observable at the `review_failed` outcome) gains a `**Branch:** \`<branch>\`` line plus a "push a fix then post `## Retry`" instruction, so the operator can find and fix the PR-less work.

The pass/fail policy stays in **one** tested pure function shared by both orchestrators (PRD user story 17), and the safety-critical classification + routing decisions are pure functions tested in isolation.

## Relevant Files

Use these files to implement the feature:

### Production files (touched)
- `adws/types/workflowTypes.ts` — Defines the `WorkflowStage` union. The `review_failed` literal **already exists** here (currently grouped under the review workflow stages). No new literal is required; this file is touched only to confirm/keep the literal and update its adjacent doc-comment if helpful. (The issue lists it as touched; the substantive taxonomy change is the *classification* in `stageClassifier.ts`.)
- `adws/core/stageClassifier.ts` — `classifyStage` exhaustive switch over the closed `WorkflowStage` union. Move `case 'review_failed'` out of the `resumable` group into the `human_gated` group (next to `merge_blocked` / `human_gated`). The `never` exhaustiveness guard enforces total coverage at compile time.
- `adws/triggers/cronIssueFilter.ts` — `evaluateIssue` decides per-issue cron eligibility. Add the `review_failed` ineligibility guard before the grace-period check, returning `{ eligible: false, reason: 'review_failed' }` (the money-fire pin), mirroring the existing `merge_blocked` / `human_gated` early returns.
- `adws/triggers/retryHandler.ts` — `handleRetryDirective` maps a `## Retry` on a human-gated stage to a recovery transition. Add the `review_failed → phase_timeout` (re-arm `resumeAttempts: 0`) branch alongside the existing `merge_blocked` and `human_gated` branches; remains a no-op for any other stage.
- `adws/phases/decidePostReviewOutcome.ts` — The pure, shared post-review gate (introduced by #719). Add the `skipDocAndPR: boolean` field to `PostReviewOutcome`; change the fail branch to return `review_failed` + `skipDocAndPR: true`; the pass branch returns `awaiting_merge` + `skipDocAndPR: false`. No I/O — total function over a boolean.
- `adws/adwSdlc.tsx` — The SDLC orchestrator `main()`. After the review-retry loop (`reviewPassed` captured), call `decidePostReviewOutcome(reviewPassed)`. On `skipDocAndPR`: write `review_failed` top-level state, persist `orchestratorStatePath` metadata + token counts, log the branch via `config.ctx.branchName`, and `return` before the document/PR/proof-publish/`awaiting_merge` block. Import `decidePostReviewOutcome` from `./phases/decidePostReviewOutcome`.
- `adws/github/workflowCommentsIssue.ts` — `formatReviewFailedComment(ctx)` builds the `## :x: Review Failed` issue comment (both the scenario-proof and fallback variants). Append a `**Branch:** \`<branchName>\`` line (guarded on `ctx.branchName`) and a "push a fix to the branch, then post `## Retry`" instruction, so the comment points the operator at the (PR-less) branch. This file is also owned by the stage-classifier doc.

### Test files (touched)
- `adws/core/__tests__/stageClassifier.test.ts` — The `EXPECTED: Record<WorkflowStage, StageClass>` exhaustive map plus the `classifyStageString` literal-delegation block. Move `review_failed` to `'human_gated'` in `EXPECTED`; add a `classifyStageString('review_failed') === 'human_gated'` case.
- `adws/phases/__tests__/decidePostReviewOutcome.test.ts` — Update the pass/fail expectations to include `skipDocAndPR` and the `review_failed` workflowStage on fail; keep the purity (referential-equality) check.
- `adws/triggers/__tests__/cronIssueFilter.test.ts` — Add a `review_failed` skip-terminal describe block: ineligible with `reason === 'review_failed'`, and precedence over both the grace-period check (recent activity) and processed-spawn dedup (the money-fire pin).
- `adws/triggers/__tests__/retryHandler.test.ts` — Add a `review_failed → phase_timeout` (`resumeAttempts: 0`, returns `true`) case plus a negative case (e.g. `review_passed` → no write, returns `false`).

### Reference files (read-only — patterns and contracts)
- `adws/phases/reviewPhase.ts` — Posts a `review_failed` issue comment via `postIssueStageComment(repoContext, issueNumber, 'review_failed', ctx)` (around line 125) on **each** review-loop fail, with `branchName` populated in `ctx`. These are the per-attempt informational comments; the file itself needs no change. The **terminal** operator-facing branch comment that AC4 / scenario §2 assert is posted by the SDLC review-failure handoff (Step 10) using this same `postIssueStageComment` + `formatReviewFailedComment` path, so the deterministic comment is present and observable at the `review_failed` outcome — not only as an intermediate loop artefact (which the isolated §2 handoff driver never triggers).
- `adws/core/resumePolicy.ts` — Prior art for the `human_gated` stage and the `phase_timeout` re-arm semantics (`nextResumeAction`, `MAX_RESUME_ATTEMPTS`); confirms `review_failed` does not consume the resume counter (it is written directly, not via the cap).
- `adws/triggers/cronStageResolver.ts` — Supplies the `resolution.stage` that `evaluateIssue` switches on; `review_failed` must surface as the resolved stage for the cron guard to fire.
- `adws/adwPrReview.tsx` / `adws/phases/prReviewCompletion.ts` — The other consumer of `decidePostReviewOutcome` (#719). The gate change must remain correct for the PR-review path (it already routes through the shared function); SDLC is the new consumer this feature adds.

### Conditional documentation (must read — matched conditions)
- `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` — **Owns** `stageClassifier.ts`, its test, `resumePolicy.ts`, `cronStageResolver.ts`, `cronIssueFilter.ts`, `takeoverHandler.ts`, `workflowTypes.ts`, and `workflowCommentsIssue.ts`. Matched conditions: "adding a new `WorkflowStage` literal and need to assign it a recovery class", "modifying `evaluateIssue` in `cronIssueFilter.ts` stage eligibility checks", "the bounded resume cap, `human_gated` stage … is relevant", "the `never` exhaustiveness guard or compile-time classification check is relevant". This is the primary doc for this feature.
- `app_docs/feature-22y8n3-merge-blocked-recovery-path.md` — Matched condition: "adding a new non-retriable, human-recoverable terminal stage to the workflow (pattern: `handleRetryDirective` + cron ineligibility guard)" and "wiring a new comment directive (mirror of `## Retry`)". `review_failed` follows this exact pattern; use it as the template.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — **Owns** `adws/triggers/retryHandler.ts` (and the other trigger handlers). Matched condition: working on the retry handler / issue eligibility.
- `app_docs/feature-s59wpc-adwprreview-phaserunner-migration.md` — **Owns** `decidePostReviewOutcome.ts` and its test (the #719 module). Matched conditions: "working with `adws/phases/decidePostReviewOutcome.ts` or `PostReviewOutcome`", "the PR-review orchestrator should write `awaiting_merge` to hand off to cron merge dispatch".
- `app_docs/feature-ni6fpk-serialize-overlapping-region-issues.md` — **Owns** `cronIssueFilter.ts`. Matched conditions: "adding a new handoff stage that bypasses the cron grace period", "working with `filterEligibleIssues` / `evaluateIssue` in `cronIssueFilter.ts`". `review_failed` bypasses the grace period (early return) exactly like the existing handoff guards.
- `app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md` — Matched conditions: "orchestrator phase ordering in `adwSdlc.tsx`", "modifying post-PR logic (approve, `awaiting_merge` write) in an orchestrator", "`workflowStage: 'awaiting_merge'` transitions". This feature inserts the review-outcome gate immediately before this hand-off block.
- `app_docs/feature-bed2tg-orchestrator-watchdog-agent-timeout.md` — Matched condition: "implementing or troubleshooting agent wedge recovery (`AgentTimeoutError`, `handlePhaseTimeout`, `phase_timeout` stage)". Context for the `review_failed → phase_timeout` re-arm target.

## Implementation Plan

### Phase 1: Foundation — stage taxonomy + classification
The blocking stage must exist and be correctly classified before any consumer can rely on it. The `review_failed` literal already exists in `WorkflowStage`; the foundational change is reclassifying it into the `human_gated` class and pinning that with the exhaustive-map test. This is the safety floor: every downstream behaviour (cron exclusion, retry recovery) keys off this classification.

### Phase 2: Core Implementation — cron exclusion, retry recovery, and the shared gate
With the stage classified human-gated, add the two recovery-routing behaviours that the classification implies — the cron money-fire exclusion (`evaluateIssue`) and the `## Retry` re-arm (`handleRetryDirective`) — and extend the shared pure gate (`decidePostReviewOutcome`) so a failed review maps to `review_failed` + the skip-doc/PR signal. Each is a small, independently-tested unit (pure function or injected-deps handler).

### Phase 3: Integration — SDLC orchestrator wiring + operator comment
Wire `adwSdlc.tsx` to consume the extended gate: branch on `skipDocAndPR` to write `review_failed` and skip document/PR/`awaiting_merge`, or proceed as today. Make the `review_failed` issue comment point at the branch so the operator can fix the PR-less work and post `## Retry`. End-to-end: an exhausted SDLC review now blocks instead of shipping, and is recoverable by a human.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Confirm the `review_failed` literal in the stage taxonomy
- Open `adws/types/workflowTypes.ts` and confirm `'review_failed'` is present in the `WorkflowStage` union (it is, under the "Review workflow stages" group). Keep it. Optionally tighten its adjacent comment to note it is a human-gated blocking stage recoverable only via `## Retry`.
- No new literal is added; this satisfies the "added to the workflow stage taxonomy" criterion via the pre-existing literal plus the Phase-1 classification below.

### 2. Reclassify `review_failed` as human-gated in `classifyStage`
- In `adws/core/stageClassifier.ts`, remove `case 'review_failed':` from the `resumable` group and add it to the `human_gated` group (alongside `case 'merge_blocked':` / `case 'human_gated':`, returning `'human_gated'`).
- Verify the `never` exhaustiveness guard still compiles (no stage uncovered, none double-covered).

### 3. Update the stage-classifier unit tests
- In `adws/core/__tests__/stageClassifier.test.ts`, in the `EXPECTED: Record<WorkflowStage, StageClass>` map, move `review_failed` from `'resumable'` to `'human_gated'`.
- Add a `classifyStageString` case asserting `classifyStageString('review_failed')` returns `'human_gated'`.
- Run `bunx vitest run adws/core/__tests__/stageClassifier.test.ts` — green.

### 4. Add the cron money-fire exclusion in `evaluateIssue`
- In `adws/triggers/cronIssueFilter.ts`, add a guard immediately after the existing `human_gated` guard and **before** the grace-period / processed-spawn checks:
  - `if (resolution.stage === 'review_failed') return { eligible: false, reason: 'review_failed' };`
  - Add a short comment: review exhausted with unresolved blockers; never auto-spawned; `## Retry` re-arms to `phase_timeout`.

### 5. Add the cron-filter exclusion unit tests (money-fire pin)
- In `adws/triggers/__tests__/cronIssueFilter.test.ts`, add a `describe('evaluateIssue — review_failed skip-terminal')` block with three cases:
  1. Old activity → `eligible: false`, `reason === 'review_failed'`, `action` undefined.
  2. Recent activity (within grace period) → still `eligible: false` (precedence over grace period).
  3. Issue number already in `processed.spawns` → still `eligible: false` (precedence over processed-spawn dedup).
- Run `bunx vitest run adws/triggers/__tests__/cronIssueFilter.test.ts` — green.

### 6. Add the `review_failed → phase_timeout` retry transition
- In `adws/triggers/retryHandler.ts`, add a branch in `handleRetryDirective` (after the `human_gated` branch):
  - `if (stage === 'review_failed') { deps.writeTopLevelState(adwId, { workflowStage: 'phase_timeout', resumeAttempts: 0 }); log(...re-armed review_failed → phase_timeout...); return true; }`
- Update the module doc-comment's "recovery paths" list to include `review_failed → phase_timeout`.
- Keep the final no-op return for any other stage.

### 7. Update the retry-handler unit tests
- In `adws/triggers/__tests__/retryHandler.test.ts`, add:
  1. A `review_failed` state → `writeTopLevelState(adwId, { workflowStage: 'phase_timeout', resumeAttempts: 0 })` called, returns `true`.
  2. A negative case (e.g. `review_passed`) → no `writeTopLevelState`, returns `false`.
- Run `bunx vitest run adws/triggers/__tests__/retryHandler.test.ts` — green.

### 8. Extend the shared post-review gate
- In `adws/phases/decidePostReviewOutcome.ts`, add `skipDocAndPR: boolean` to the `PostReviewOutcome` interface (documented: "when true, the caller must skip document + PR creation").
- Change the fail branch to `return { writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true };`.
- Keep the pass branch as `return { writeAwaitingMerge: true, workflowStage: 'awaiting_merge', skipDocAndPR: false };`.
- Update the function doc-comment to describe the pass/fail behaviour and the SDLC skip-doc/PR obligation.

### 9. Update the post-review-gate unit tests
- In `adws/phases/__tests__/decidePostReviewOutcome.test.ts`, update the pass expectation to include `skipDocAndPR: false`, and the fail expectation to `{ writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true }`.
- Keep the purity / repeated-call-equality test.
- Run `bunx vitest run adws/phases/__tests__/decidePostReviewOutcome.test.ts` — green.

### 10. Wire the gate into the SDLC orchestrator
- In `adws/adwSdlc.tsx`, import `decidePostReviewOutcome` from `./phases/decidePostReviewOutcome`.
- Immediately after the review-retry loop (where `reviewPassed`, `reviewRetries`, `scenarioRetries`, `unitTestResult` are in scope and before the document phase), add `const outcome = decidePostReviewOutcome(reviewPassed);`.
- When `outcome.skipDocAndPR` is true:
  - `AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'review_failed' });`
  - `AgentStateManager.writeState(config.orchestratorStatePath, { metadata: { totalCostUsd, unitTestsPassed, totalTestRetries, scenarioRetries, reviewPassed: false, totalReviewRetries: reviewRetries } });`
  - `persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);`
  - **Post the branch-pointing `review_failed` issue comment** (the operator-facing recovery signal AC4 / User Story 20 require) via the same recorded comment path `reviewPhase` uses — `postIssueStageComment(config.repoContext, config.issueNumber, 'review_failed', config.ctx)` with `config.ctx.branchName` populated — so the blocked issue **carries** a comment pointing at the branch. STDOUT logging alone does **not** satisfy AC4 (the issue must carry the comment), and this is exactly the comment scenario §2 (T2/T3) asserts.
  - Log a clear warning that the review was exhausted, the stage is `review_failed`, no PR was created, and `## Retry` is the recovery path; log `config.ctx.branchName` if present.
  - `return;` (skipping document, PR, proof-publish, and the `awaiting_merge` hand-off).
- **Extract this skip-doc/PR segment into a thin, importable handoff function** (mirroring #719's `completePRReviewWorkflow` driver) so the BDD `@adw-720` §2 scenario — *"the SDLC post-review handoff is executed for adwId … after a failing review"* — can phase-import and drive it in isolation over a mocked `WorkflowConfig`; the inline-in-`main()` form cannot be exercised by the scenario.
- Otherwise leave the existing document → PR → proof-publish → `awaiting_merge` path unchanged (add a clarifying "review passed — proceed" comment).

### 11. Point the `review_failed` comment at the branch
- In `adws/github/workflowCommentsIssue.ts`, in `formatReviewFailedComment(ctx)`, build a `branchLine` = `ctx.branchName ? \`\n**Branch:** \`${ctx.branchName}\`\` : ''` and a `retryLine` instructing the operator to push a fix to that branch and post `## Retry`.
- Append both `branchLine` and `retryLine` to **both** comment variants (the `scenarioProof` proof-comment path and the fallback simple path), before the `**ADW ID:**` footer.
- This formatter is consumed by **both** the per-attempt loop comments (`reviewPhase`) and the terminal review-failure handoff (Step 10); the `branchLine` guard keeps it safe when `ctx.branchName` is absent.

### 12. BDD / regression scenarios for `@adw-720`
- Ensure the per-issue BDD scenarios tagged `@adw-720` (authored by the alignment/scenario phase) cover: the gate's fail→`review_failed`+skip-doc/PR and pass→proceed dispositions; an exhausted SDLC review writes `review_failed`, creates no PR, **and posts a branch-pointing comment on the issue**; cron treats a `review_failed` issue as ineligible; `## Retry` re-arms `review_failed → phase_timeout` (and is a no-op on a non-human-gated stage such as `build_completed`). Do not author structurally-asserting scenarios (assert external behaviour through module interfaces).
- Keep the `@regression` suite green (no behavioural regression to the pass path / `awaiting_merge` hand-off).

### 13. Run the full validation suite
- Execute every command in **Validation Commands** below. All must pass with zero regressions.

## Testing Strategy

### Unit Tests
Unit tests are enabled (`.adw/project.md` → `## Unit Tests: enabled`). Tests assert external behaviour through each module's interface (given inputs → asserted decision/output), per the PRD Testing Decisions and the project's rot-prevention rule — never assert against source-file structure.

- **`decidePostReviewOutcome` (`adws/phases/__tests__/decidePostReviewOutcome.test.ts`)** — pass → `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge', skipDocAndPR: false }`; fail → `{ writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true }`; purity (repeated calls with the same arg return equal results). Prior art: existing `decidePostReviewOutcome` tests and `resumePolicy` (`nextResumeAction`) tests.
- **`classifyStage` / `classifyStageString` (`adws/core/__tests__/stageClassifier.test.ts`)** — the exhaustive `EXPECTED` map asserts `review_failed → 'human_gated'`; `classifyStageString('review_failed') === 'human_gated'`. The compile-time `never` guard plus the exhaustive map prevent silent misclassification.
- **`evaluateIssue` cron exclusion (`adws/triggers/__tests__/cronIssueFilter.test.ts`)** — the money-fire pin: `review_failed` → `eligible: false`, `reason: 'review_failed'`, and that this verdict takes precedence over both the grace-period (recent activity) and processed-spawn dedup checks.
- **`handleRetryDirective` (`adws/triggers/__tests__/retryHandler.test.ts`)** — `review_failed → phase_timeout` with `resumeAttempts: 0` (returns `true`); no-op (no write, returns `false`) for an unrelated stage such as `review_passed`.

### Edge Cases
- **Recent activity on a `review_failed` issue** — the cron exclusion must take precedence over the grace-period check (a just-failed review must not become eligible because it was "recently active").
- **Processed-spawn dedup interaction** — a `review_failed` issue already in `processed.spawns` must still report `eligible: false` with `reason: 'review_failed'`, not the generic `'processed'` reason.
- **`## Retry` on a non-`review_failed` stage** — must remain a no-op (e.g. `review_passed`, `phase_timeout`, active stages), so a stray `## Retry` cannot disturb a live or completed workflow.
- **Pass path unchanged** — a passing review must still produce `awaiting_merge` with `skipDocAndPR: false` and run document → PR → proof-publish → hand-off, so the gate is purely additive on the fail branch.
- **Branch-line guard** — `formatReviewFailedComment` must not emit a dangling `**Branch:**` line when `ctx.branchName` is absent (the `branchLine` is conditional).
- **PR-review path unaffected** — `adwPrReview` already consumes `decidePostReviewOutcome`; the new `skipDocAndPR` field must not change its existing behaviour (it does not create a doc/PR on the SDLC path; its own completion logic keys off `writeAwaitingMerge` / `workflowStage`).
- **Resume after `## Retry`** — re-arming to `phase_timeout` must re-run only the (non-skip-tracked) review phase; completed plan/build/step-def phases stay skipped.
- **Intermediate retry-loop comments** — each failed attempt inside the review loop posts a `review_failed` comment carrying the branch + `## Retry` instruction. Only the final exhausted attempt leads to the terminal `review_failed` stage, at which the handoff (Step 10) posts the deterministic operator-facing branch comment; the earlier per-attempt informational comments are acceptable (the loop continues to patch/retest automatically). The resulting one-or-more branch-pointing comments are acceptable known behaviour, not a defect.

## Acceptance Criteria
- [ ] `review_failed` is present in the `WorkflowStage` taxonomy (pre-existing literal, confirmed) and is no longer classified `resumable`.
- [ ] `classifyStage('review_failed') === 'human_gated'` and `classifyStageString('review_failed') === 'human_gated'`, pinned by the exhaustive `EXPECTED` map.
- [ ] `evaluateIssue` returns `{ eligible: false, reason: 'review_failed' }` for a `review_failed` issue, with explicit precedence over grace-period and processed-spawn checks (the money-fire pin).
- [ ] `decidePostReviewOutcome(false)` returns `{ writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true }`; `decidePostReviewOutcome(true)` returns `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge', skipDocAndPR: false }`.
- [ ] On an exhausted SDLC review, `adwSdlc` writes `review_failed`, creates **no** PR (document/PR/proof-publish/`awaiting_merge` skipped), and a `review_failed` issue comment points at the branch with `## Retry` recovery instructions.
- [ ] `handleRetryDirective` performs `review_failed → phase_timeout` (`resumeAttempts: 0`, returns `true`) and is a no-op for unrelated stages.
- [ ] A `## Retry` on a `review_failed` SDLC issue re-runs the review (completed plan/build/step-def stay skipped) via the `phase_timeout` recovery path.
- [ ] Unit tests for classification, cron exclusion, retry transition, and the gate fail-path are present and green; the regression/BDD suite is green; `tsc`, lint, and build pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint passes with no new issues.
- `bunx tsc --noEmit` — Root type-check passes (the `never` exhaustiveness guard in `classifyStage` proves full stage coverage).
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check passes.
- `bun run test:unit` — Full unit suite passes with zero regressions. (Targeted: `bunx vitest run adws/core/__tests__/stageClassifier.test.ts adws/phases/__tests__/decidePostReviewOutcome.test.ts adws/triggers/__tests__/cronIssueFilter.test.ts adws/triggers/__tests__/retryHandler.test.ts`.)
- `bun run build` — Build completes with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-720"` — Per-issue BDD scenarios for this feature pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Regression scenario suite is green (no behavioural regression).

## Notes

- **Current working-tree state (faithful report):** As of this planning run, the `feature-issue-720-review-failed-blocking-stage` worktree **already contains a near-complete, green implementation** of this feature (uncommitted, diffed against `dev`): all six production files plus `workflowCommentsIssue.ts`, and all four test files, match the design above. `bunx tsc --noEmit -p adws/tsconfig.json` exits 0 and the four affected test files pass (106 tests). **One BDD-driven gap remains (see Step 10 / scenario §2):** the SDLC review-failure handoff currently only `log()`s the branch to STDOUT and does **not** yet post the operator-facing branch-pointing comment that AC4 / User Story 20 require; closing scenario `@adw-720` §2 (T2/T3) means adding that comment post (via the existing `postIssueStageComment` / `formatReviewFailedComment` path) and extracting the handoff into an importable function. The build/implement phase should therefore **verify and reconcile** against this plan (confirm green, close that gap, fill any remaining BDD `@adw-720` gaps) rather than re-implement from scratch. If the working-tree changes are absent or reverted when build runs, implement exactly as specified in the Step by Step Tasks.
- **`review_failed` literal pre-exists.** The issue lists `adws/types/workflowTypes.ts` as a touched file, but `'review_failed'` is already a `WorkflowStage` literal (it was classified `resumable`). The substantive taxonomy change is the *reclassification* in `stageClassifier.ts`. No new union member is required; if the implementation does not need to edit `workflowTypes.ts` at all, that is correct and the touched-files list is satisfied by the classifier change.
- **#719 dependency is satisfied.** This feature extends `decidePostReviewOutcome`, introduced by #719 (PR #723), which is already merged into `dev`. The shared gate is consumed by `adwPrReview` today; this feature adds `adwSdlc` as the second consumer (PRD user story 17 — one tested gate, both orchestrators).
- **Safety-critical classification.** Keeping `review_failed` in the `human_gated` class (not `retriable`) is the money-fire backstop: a failing review must never auto-spawn a full orchestrator each cron tick. The explicit cron-filter exclusion test exists precisely so a future refactor cannot silently move it into an auto-spawnable bucket (PRD user story 19).
- **Resume counter untouched.** `review_failed` is written directly (human-gated), so it never consumes the auto-resume counter; the existing `MAX_RESUME_ATTEMPTS` cap still bounds the *hang* path after a `## Retry` re-arms to `phase_timeout`.
- **Pattern source.** This follows the `merge_blocked` template (`app_docs/feature-22y8n3-merge-blocked-recovery-path.md`): a non-retriable, human-recoverable terminal stage = `handleRetryDirective` re-arm + cron ineligibility guard + stage classification. Mirror it precisely for consistency.
- **Out of scope (per PRD):** the adwId-consolidation slice and the PR-review `review_failed` path are separate slices; this feature is the SDLC `review_failed` slice plus the shared classification/cron/retry foundation. Do not change the merge orchestrator, the `hitl` gate, branch-protection requirements, or how the review agent decides pass/fail.
- **Coding guidelines:** `.adw/coding_guidelines.md` was not found in this repository (and no `guidelines/coding_guidelines.md` fallback). Follow the existing in-file conventions (pure functions for decisions, injected deps for handlers, exhaustive `never`-guarded switches, behaviour-asserting tests) demonstrated by the surrounding modules.
- **Library install:** No new libraries required. (If one were needed, `.adw/commands.md` specifies `bun add <package>`.)
