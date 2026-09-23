# Bug: Review phase approves PRs without consulting the `hitl` label, defeating the human merge gate

## Metadata
issueNumber: `848`
adwId: `izqk31-review-phase-approve`
issueJson: `{"number":848,"title":"Review phase approves PRs without consulting the hitl label, defeating the human merge gate","body":"**What's wrong:** the review phase approves a PR without consulting the `hitl` label, which silently defeats the human merge gate.\n\n**Observed, 2026-09-23, issue #840 / PR #843:**\n\n```\n14:11:46  [q7t0yb-adw-switchover-to-pa] Review passed!\n14:11:49  [q7t0yb-adw-switchover-to-pa] Approved PR #843        <- 3s later\n14:16:50  [q7t0yb-adw-switchover-to-pa] Chore: skipping pre-approval — issue #840 has hitl label\n```\n\nIssue #840 carries `hitl`. The chore path honoured it. The review phase had already approved.\n\n**Root cause — two approval call sites, only one checks the label:**\n\n```ts\n// adws/adwChore.tsx:148 — checks\nif (prNumber && \\!issueTracker.fetchLabels(issueNumber).includes('hitl')) {\n  codeHost.approvePullRequest(prNumber);\n\n// adws/phases/reviewPhase.ts:121 — does not\nif (ctx.prUrl && repoContext && canApprove(repoContext.codeHost)) {\n  const prNumber = extractPrNumber(ctx.prUrl);\n  if (prNumber) { repoContext.codeHost.approvePullRequest(prNumber); }\n```\n\n**Why it matters more than one stray approval.** The merge gate is `(no hitl label) OR (PR approved)`. An automated approval satisfies the second clause permanently, so once review passes, `hitl` stops gating merges at all — on every issue, in every registered repo.\n\nIt is also unauditable after the fact. PR approval is an `alternateIdentity` operation (`adws/providers/github/ghPrApi.ts:53`), served `GITHUB_PAT` because GitHub forbids App self-approval. GitHub therefore records ADW's approval as the human operator, `author_association: OWNER`, with no field distinguishing it from an approval a human typed. The merge gate cannot tell them apart, so the fix must be at the approval site, not the gate.\n\n**What to build:** `executeReviewPhase` consults the issue's labels before approving and skips approval when `hitl` is present, logging the skip the way `adwChore.tsx:150` does. The review still counts as passed — this changes only whether the PR is approved.\n\n**Acceptance criteria:**\n- [ ] Review passes on a `hitl`-labelled issue → PR is not approved; a skip is logged naming the issue\n- [ ] Review passes on an unlabelled issue → PR is approved exactly as today\n- [ ] Approval failure and a refused `canApprove` capability probe stay non-fatal, as now\n- [ ] Unit tests cover both branches by asserting the `approvePullRequest` call, not internal state\n- [ ] A regression scenario proves the `hitl` gate survives a review pass\n\n**Out of scope:** the label check in `adwChore.tsx` (already correct), the credential design (`alternateIdentity` → PAT is deliberate and correct), and the merge gate's own rule.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-09-23T16:45:21Z","comments":[],"actionableComment":null}`

## Bug Description

`executeReviewPhase` (`adws/phases/reviewPhase.ts:117-131`) approves the pull request on every review pass whenever the code host reports it can approve. It never reads the issue's labels. The chore orchestrator's own pre-approval (`adws/adwChore.tsx:146-158`) does read them and skips when `hitl` is present, so a `hitl`-labelled issue that reaches the review phase gets approved anyway, three seconds after "Review passed!", and the chore path's later "skipping pre-approval" log line is moot.

Observed on issue #840 / PR #843 (2026-09-23):

```
14:11:46  [q7t0yb-adw-switchover-to-pa] Review passed!
14:11:49  [q7t0yb-adw-switchover-to-pa] Approved PR #843        <- 3s later
14:16:50  [q7t0yb-adw-switchover-to-pa] Chore: skipping pre-approval — issue #840 has hitl label
```

**Expected:** with `hitl` on the issue, a passing review leaves the PR unapproved and logs a skip that names the issue. The review still counts as passed. Without `hitl`, the PR is approved exactly as today.

**Actual:** the PR is approved regardless of the label. Because the merge gate (`adws/adwMerge.tsx:171-179`, README "Auto-merge gate") is `(no hitl on issue) OR (PR is approved)`, that approval satisfies the second clause permanently, and `hitl` stops gating the merge for that issue. The approval is served under the `alternateIdentity` credential (`GITHUB_PAT`, `adws/providers/github/ghPrApi.ts:52-54`) because GitHub forbids App self-approval, so GitHub records it as the human operator (`author_association: OWNER`). Nothing downstream can distinguish it from a human approval, which is why the fix belongs at the approval site.

Every orchestrator that runs the review phase is affected: `adwSdlc.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPrReview.tsx`, and `adwChore.tsx` on its `regression_possible` escalation path.

## Problem Statement

`executeReviewPhase` has an approval call site that does not consult the `hitl` label, so an automated review pass silently defeats the human merge gate on any `hitl`-labelled issue, in every registered repo, and leaves no auditable trace that the approval was automated.

## Solution Statement

Gate the review phase's approval on the issue's **live** labels, mirroring the chore path:

1. In `adws/phases/reviewPhase.ts`, extract the approval block into a named helper (guard clauses, no nesting deeper than two) that runs, in order: capability probe (`canApprove`, unchanged) → PR number → **live** `issueTracker.fetchLabels(issueNumber)` → `hitl` present ? log skip naming the issue and return : approve as today. Labels are read live from the tracker, not from the `config.issue.labels` snapshot taken at workflow start, because the documented gate semantics (UBIQUITOUS_LANGUAGE.md "HITL", README "Auto-merge gate") are "checked in real time, not cached from workflow start" and a human may add `hitl` while the build is running.
2. Keep every existing non-fatal path exactly as it is (approval failure → warn; refused capability probe → no approval), and treat a tracker that refuses the label read by name (`JiraIssueTracker.fetchLabels` throws) the same way `canApprove` treats a refused probe: non-fatal, and fail-closed (a gate that cannot be consulted holds, so no approval), with a warn log.
3. Add unit tests (new file, so `reviewPhase.test.ts` stays under 300 lines) that assert the `approvePullRequest` call itself for both branches plus the non-fatal paths.
4. Make the six per-issue BDD rows the scenario-writer phase has already put in `features/per-issue/feature-848.feature` executable on the existing #796/#820 recording-provider harness (three fixture flags, seven step phrases): the hitl skip (with the log line), the live-label read, the unlabelled approval, the two non-fatal paths, and a regression row that runs the review phase and then the real merge orchestrator against the same recording boundary, proving the gate still defers with `hitl_blocked_unapproved` after a review pass.
5. Refresh the two stale approval bullets in the review phase's living doc.

Nothing changes in `adwChore.tsx`, the credential design, or the merge gate's rule (all explicitly out of scope).

## Steps to Reproduce

**In production (as observed):**
1. Add the `hitl` label to an issue before ADW opens its PR (the README's "disciplined pre-add workflow").
2. Let any review-running orchestrator (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwPrReview`, or `adwChore` after a `regression_possible` diff verdict) reach a review pass with `ctx.prUrl` set and a GitHub App + `GITHUB_PAT` configured (so `canApprovePullRequests()` is true).
3. Observe `Review passed!` followed by `Approving PR after review pass...` / `Approved PR #N`, and `gh pr view N --json reviews` showing an APPROVED review by the PAT identity. On the next cron tick `adwMerge` evaluates `hitl && !approved` → false and merges.

**Locally, deterministic (before the fix, once Steps 3 and 5 have made every phrase of `features/per-issue/feature-848.feature` resolvable):**
1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-848"` → the two §1 rows fail on `the boundary's code host recorded no approval` (an `approvePullRequest` call for PR 7 is recorded), and the §4 regression row fails because the merge orchestrator does not report `hitl_blocked_unapproved`; the §2/§3 rows already pass.
2. `bunx vitest run adws/phases/__tests__/reviewPhaseApprovalGate.test.ts` → the "hitl present → approvePullRequest not called" case fails.

Sanity check that the harness is live on this machine (already verified while planning): `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-820" --name "A passing review"` → 2 scenarios passed.

## Root Cause Analysis

Three changes, each correct on its own, composed into the bypass:

1. **#434 moved approval into the review phase** (`97304bb2`): `executeReviewPhase` gained an unconditional `approvePR` on review pass. The spec said "no `hitl` manipulation here" — the phase neither reads nor writes the label. At that time this was safe: `autoMergePhase.ts` checked `hitl` *first* and silently skipped, so an approval could not bypass the label.
2. **#496 unified the merge gate** as `(no hitl on issue) OR (PR is approved)` in `adwMerge.tsx` and added a `hitl`-aware pre-approval to `adwChore.tsx`. Under this rule an approval is a *satisfier* of the gate, so an approval made without consulting `hitl` is a bypass. The #496 spec explicitly left the review-phase approval "untouched (idempotent against the chore-level approval)" — the one place that needed the same label check did not get it.
3. **#820 made the approval forge-neutral**: the GitHub-specific `isGitHubAppConfigured() && GITHUB_PAT` probe became `codeHost.canApprovePullRequests()`, and the block kept the same shape: capability → PR number → approve, still no label read.

So today (`reviewPhase.ts:117-131`) there are two approval call sites and only the chore one checks the label. The review one fires first, and because the approval is served by `GITHUB_PAT` (`ghPrApi.ts:53`, `purpose: 'alternateIdentity'`), GitHub records it as the operator's own approval; the merge gate has no way to tell it apart from a human approval, so the label check must happen before the approval is submitted.

## Relevant Files

Use these files to fix the bug:

- `adws/phases/reviewPhase.ts` — the bug. `executeReviewPhase` lines 117-131 approve without reading labels; `canApprove` (lines 37-44) is the precedent for a non-fatal, refuse-by-name-tolerant probe. The fix lands here and only here in production code.
- `adws/adwChore.tsx` — lines 143-158: the reference implementation of the label-aware approval and the skip log line to mirror (`Chore: skipping pre-approval — issue #N has hitl label`). Do **not** modify (out of scope).
- `adws/adwMerge.tsx` — lines 171-179 and `buildDefaultDeps` (line 235): the unified gate `hitl && !approved → defer` and how it reads `fetchLabels` / `isPullRequestApproved` through the boundary's providers. Read-only context; the regression scenario drives `executeMerge` through `buildDefaultDeps`.
- `adws/phases/autoMergePhase.ts` — lines 68-72: sibling precedent for `repoContext.issueTracker.fetchLabels(issueNumber).includes('hitl')` inside a phase. Read-only.
- `adws/providers/types.ts` — `IssueTracker.fetchLabels` contract (line 171-172: "empty on any error (fail-open)"), `CodeHost.approvePullRequest` / `canApprovePullRequests` (lines 272-291), `RepoContext` (line 309). Types to import in the fix.
- `adws/providers/jira/jiraIssueTracker.ts` — line 227-229: `fetchLabels` is a refuse-by-name stub that throws; the reason the label read in the phase must be non-fatal.
- `adws/providers/github/ghPrApi.ts` — line 52-54: approval is an `alternateIdentity` operation (why the fix cannot live in the gate). Read-only.
- `adws/adwBuildHelpers.ts` — `extractPrNumber` (line 19), already used by the phase.
- `adws/core/logger.ts` — `log(message, level)` writes to `console.log`; the BDD log-capture step relies on this.
- `adws/phases/__tests__/reviewPhase.test.ts` — existing Vitest suite for the file (covers `executeReviewPatchCycle` only). Its mock layout (`../../core`, `../../cost`, `../../agents/planAgent`, `../../agents/gitAgent`) is the template for the new test file. Leave as is.
- `features/per-issue/feature-848.feature` — **already written by the scenario-writer phase** (six `@adw-848` rows, see Step 4). It is the acceptance contract for the build and the scenario proof; do not rewrite it. Every phrase it uses must resolve to a step definition after Steps 3 and 5.
- `features/per-issue/step_definitions/feature-796.steps.ts` — the recording-provider world (`world796`, `resetWorld`, `Fixture.issueLabels`, `Fixture.canApprove`, `Fixture.prApproval`, `activeCallLog`, `makeFixture`, `makeRecordingProviders`) and the merge-gate steps the regression row reuses: `the merge orchestrator's production dependencies are built from that boundary`, `the branch {string} has a pull request numbered {int} in state {string}`, `issue {int} carries the label {string}`, `issue {int} carries no labels`, `pull request {int} has no approving review`, `the merge orchestrator runs for issue {int} under adw id {string}`, `the merge orchestrator reports the outcome {string} for reason {string}`. Gains three `Fixture` flags (Step 3) with behaviour-preserving defaults.
- `features/per-issue/step_definitions/feature-820.steps.ts` — §6 review-phase steps reused verbatim: `the recording code host reports that it can approve pull requests`, `a workflow configuration bound to that boundary whose pull request url names pull request {int}` (builds the config for issue 42 on branch `feature-issue-42-void`), `the review phase completes with no blocker issues for that configuration`, `the boundary's code host recorded an approval of pull request {int}`, `the boundary's code host recorded no approval`, `the review phase reported the review as passed`. Gains two small exports (cross-file precedent: `setReconciledStage` etc. at lines 177-185) so the #848 step file can reset its state and reach the built configuration.
- `features/per-issue/step_definitions/feature-821.steps.ts` — lines 142-160 and 165-175: the `Before/After({ tags })` hook pattern over the shared 796 world, and the `captureConsoleLogs` helper shape the log-capture steps follow.
- `features/step_definitions/ensureCronOnEveryEventSteps.ts` — registers the `Background` phrase `the ADW codebase is checked out` (regression vocabulary G18, a no-op). Read-only.
- `features/per-issue/feature-820.feature` — §6 (lines 368-397): the two existing approval-gate scenarios that must stay green.
- `test/mocks/claude-cli-stub.ts` — the stubbed Claude CLI the 820 review step drives (`writeReviewPassManifest` + `activateClaudeCliStub`). Read-only.
- `app_docs/feature-9gjajh-review-and-diff-phases.md` — living doc for `reviewPhase.ts`; its approval bullets (Responsibilities line 9, Contracts line 18) are stale (`isGitHubAppConfigured() && GITHUB_PAT`) and must describe the `hitl` rule.
- `.adw/coding_guidelines.md` — nesting discipline (guard clauses, max depth ~2, extract named functions), no magic strings, files under 300 lines.
- `.adw/commands.md` / `.adw/scenarios.md` — validation and scenario commands used below.
- Conditional docs matched for this task: `app_docs/feature-9gjajh-review-and-diff-phases.md` (owns `reviewPhase.ts`), `app_docs/feature-9gjajh-bdd-per-issue.md` (per-issue scenario conventions: `features/per-issue/feature-{N}.feature` tagged `@adw-{N}`, paired `feature-{N}.steps.ts`), `app_docs/feature-9gjajh-pr-and-merge-phases.md` (owns `autoMergePhase.ts`, the sibling hitl read), `app_docs/feature-9gjajh-feature-orchestrators.md` (owns `adwChore.tsx` / `adwMerge.tsx`), `app_docs/feature-9gjajh-providers.md` (the `IssueTracker.fetchLabels` / `CodeHost.approvePullRequest` port contracts).

### New Files

- `adws/phases/__tests__/reviewPhaseApprovalGate.test.ts` — Vitest suite for `executeReviewPhase`'s approval gate (kept separate so `reviewPhase.test.ts` stays under 300 lines).
- `features/per-issue/step_definitions/feature-848.steps.ts` — `@adw-848` hooks plus the seven phrases `feature-848.feature` introduces (issue-record labels ×2, logger capture, three recording-code-host flags, captured-log assertion).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Gate the review-phase approval on the live `hitl` label (`adws/phases/reviewPhase.ts`)

- Import the two extra port types: `import type { CodeHost, IssueTracker, RepoContext } from '../providers/types';`.
- Add a module constant next to `canApprove` (no magic string): `const HITL_LABEL = 'hitl';` with a one-line JSDoc ("the issue label a human applies to hold a merge for review — read live, never from the workflow-start snapshot").
- Add a helper directly below `canApprove`, same shape as `canApprove` (try/catch, refuse-by-name tolerant):
  ```ts
  /**
   * True when the issue currently carries `hitl`. A tracker that refuses the
   * label read by name answers `true`: a gate that cannot be consulted is a
   * gate that holds, so the review never approves past a human it cannot see.
   */
  function issueHasHitlLabel(issueTracker: IssueTracker, issueNumber: number): boolean {
    try {
      return issueTracker.fetchLabels(issueNumber).includes(HITL_LABEL);
    } catch (error) {
      log(`Could not read labels on issue #${issueNumber} (non-fatal to review); not approving: ${error}`, 'warn');
      return true;
    }
  }
  ```
- Extract the current approval block (lines 117-131) into a named function with guard clauses, so `executeReviewPhase` loses one nesting level and the intent is named:
  ```ts
  /**
   * Approves the pull request after a review pass unless a human has signalled
   * `hitl` on the issue. Mirrors adwChore's pre-approval: the label is read live
   * from the tracker at approval time. Approval failure is non-fatal — the review
   * still counts as passed — and so is a refused capability probe (a forge that
   * cannot express approval cannot approve).
   */
  function approvePullRequestAfterReviewPass(repoContext: RepoContext, issueNumber: number, prUrl: string): void {
    if (!canApprove(repoContext.codeHost)) return;
    const prNumber = extractPrNumber(prUrl);
    if (!prNumber) return;
    if (issueHasHitlLabel(repoContext.issueTracker, issueNumber)) {
      log(`Review: skipping approval of PR #${prNumber} — issue #${issueNumber} has hitl label`, 'info');
      return;
    }
    log('Approving PR after review pass...', 'info');
    const approveResult = repoContext.codeHost.approvePullRequest(prNumber);
    if (!approveResult.success) {
      log(`PR approval failed (non-fatal to review): ${approveResult.error}`, 'warn');
      return;
    }
    log(`PR #${prNumber} approved`, 'success');
  }
  ```
- Replace lines 117-131 inside the `if (reviewPassed)` branch with:
  ```ts
  if (ctx.prUrl && repoContext) {
    approvePullRequestAfterReviewPass(repoContext, issueNumber, ctx.prUrl);
  }
  ```
- Keep the three existing log strings (`Approving PR after review pass...`, `PR approval failed (non-fatal to review): …`, `PR #N approved`) byte-for-byte; only the skip line and the label-read warn are new. The skip line must name both the PR and the issue (`PR #7`, `issue #42`) and contain `hitl`, because the unit test and the BDD step match on those tokens.
- Order is deliberate and must stay: capability probe → PR number → label → approve. The probe is a local configuration read; the label read is a forge call and must not be spent on a host that cannot approve.
- Keep the file under 300 lines (it is 258 today; the change adds roughly 30 net lines). Do not touch `executeReviewPatchCycle`.

### Step 2: Unit tests asserting the `approvePullRequest` call (`adws/phases/__tests__/reviewPhaseApprovalGate.test.ts`)

- New file. Reuse the mock layout of `reviewPhase.test.ts` for `../../core` (`log: vi.fn()`, `AgentStateManager.appendLog/initializeState`, `emptyModelUsageMap`, `mergeModelUsageMaps`), `../../cost` (`createPhaseCostRecords: vi.fn(() => [])`, `PhaseCostStatus: { Success: 'success', Failed: 'failed' }`), `../../agents/planAgent` (`getPlanFilePath`), and additionally mock:
  - `../../agents/reviewAgent` → `runReviewAgent: vi.fn()`; default resolved value `{ success: true, output: '', sessionId: 's', totalCostUsd: 0.01, modelUsage: {}, passed: true, blockerIssues: [], reviewResult: { success: true, reviewSummary: 'LGTM', reviewIssues: [], screenshots: [] } }`.
  - `../phaseCommentHelpers` → `postIssueStageComment: vi.fn()`.
- Build the config with a small factory `makeConfig({ labels, canApprove, approveResult, prUrl })` that returns `{ ...base, ctx: { prUrl }, repoContext: { issueTracker: { fetchLabels }, codeHost: { canApprovePullRequests, approvePullRequest }, cwd: '/tmp', repoId: {...} } } as unknown as WorkflowConfig`, where `fetchLabels`, `canApprovePullRequests`, `approvePullRequest` are `vi.fn()` instances the tests assert on. Default `prUrl` = `https://github.com/test/repo/pull/7`, `issueNumber` = 42.
- Cases (each asserts the call, not internal state):
  1. **hitl present** (`fetchLabels → ['hitl']`) → `approvePullRequest` not called; `fetchLabels` called with `42`; result `reviewPassed === true`; `log` called with a string containing `PR #7`, `issue #42` and `hitl` at level `'info'`.
  2. **no labels** (`[]`) → `approvePullRequest` called exactly once with `7`; `reviewPassed === true`.
  3. **other labels only** (`['adw:bug']`) → approved once (guards `.includes` semantics, not "any label").
  4. **approval failure** (`approvePullRequest → { success: false, error: 'boom' }`, no labels) → resolves, `reviewPassed === true`, `log` called with a `'warn'` line containing `non-fatal`.
  5. **refused capability probe** (`canApprovePullRequests` throws) → `approvePullRequest` not called, `fetchLabels` not called, `reviewPassed === true`.
  6. **refused label read** (`fetchLabels` throws) → `approvePullRequest` not called, `reviewPassed === true`, a `'warn'` log naming `issue #42`.
  7. **review failed** (`runReviewAgent → passed: false, blockerIssues: [one blocker]`) → neither `fetchLabels` nor `approvePullRequest` called; `reviewPassed === false`.
  8. **no PR url** (`ctx: {}`) → nothing consulted, nothing approved.
- Use `beforeEach` with `mockReset()` on every mock and re-apply defaults, mirroring the existing file.

### Step 3: Extend the shared recording fixture with three behaviour flags (`features/per-issue/step_definitions/feature-796.steps.ts`)

The `@adw-848` scenarios (already written, see Step 4) need the recording code host to (a) fail every approval, (b) refuse the capability probe by name, and (c) count its own approvals as approving reviews. The recording providers close over `Fixture`, so the flags live there (precedent: #844 added `refuseIssueFetch`, `refuseListPullRequests`, `refuseAuthenticatedUser`).

- `Fixture` interface (line 80): add
  ```ts
  /** #848: when true, approvePullRequest records the call but reports { success: false }. */
  approveFails: boolean;
  /** #848: when true, canApprovePullRequests records the call then refuses by name (throws). */
  refuseCanApprove: boolean;
  /** #848: when true, every recorded approval also flips prApproval for that PR — as GitHub does with ADW's PAT-served approval. */
  approvalsCountAsReviews: boolean;
  ```
- `makeFixture()` (line 246): default all three to `false`.
- `makeRecordingProviders` code host:
  - `approvePullRequest(prNumber)` (line 440): keep `record(callLog, 'approvePullRequest', prNumber)` first; then `if (fixture.approvalsCountAsReviews) fixture.prApproval.set(prNumber, true);` then `return fixture.approveFails ? { success: false, error: 'simulated approval failure' } : { success: true };`.
  - `canApprovePullRequests()` (line 458): keep the `record` first; then `if (fixture.refuseCanApprove) throw new Error('CodeHost.canApprovePullRequests is not implemented');` (same wording as the `refuseAuthenticatedUser` precedent at lines 452-455); then `return fixture.canApprove;`.
- No phrase changes in this file; the Given steps that set the flags live in the #848 step file (Step 5). `@adw-796`-derived suites (`@adw-820`, `@adw-821`, `@adw-844`) must stay green — defaults preserve today's behaviour exactly.

### Step 4: The per-issue BDD scenarios already exist (`features/per-issue/feature-848.feature`) — do not rewrite them

- The scenario-writer phase has already produced `features/per-issue/feature-848.feature` (tags `@adw-848 @adw-izqk31-review-phase-approve`, fixture repo `adw-fixture/void-848`, issue 42 / pull request 7, a `Background` of `the ADW codebase is checked out` (G18 no-op, registered in `features/step_definitions/ensureCronOnEveryEventSteps.ts`) plus the 796 recording-boundary phrase). Treat it as the contract; it is frozen by `gherkinFreeze` during the fix loop. Its six rows and what each proves:
  1. **§1 "A passing review on an issue carrying hitl leaves the pull request unapproved and logs the skip naming the issue"** (AC1) — code host can approve; config built; `the issue record in that configuration carries the label "hitl"`; `issue 42 carries the label "hitl"`; `the ADW logger's output is captured`; review passes → `recorded no approval`, `reported the review as passed`, `the captured log reports pull request approval skipped because issue 42 carries the "hitl" label`.
  2. **§1 "A hitl label a human added after the workflow started still stops the review phase approving"** — `the issue record in that configuration carries no labels` but `issue 42 carries the label "hitl"` in the tracker → no approval. This row is RED for a fix that reads `config.issue.labels` instead of the live tracker (exactly why Step 1 calls `fetchLabels`).
  3. **§2 "A passing review on an unlabelled issue approves the pull request exactly as before"** (AC2) — `issue 42 carries no labels` → `recorded an approval of pull request 7`.
  4. **§3 "A failed approval on an unlabelled issue does not fail the passing review"** (AC3) — `the recording code host reports every pull request approval as failed` → the approval call is still recorded, review still passed.
  5. **§3 "A code host that refuses the approval capability probe by name neither approves nor fails the passing review"** (AC3) — `the recording code host refuses the approval capability probe by name` → no approval, review passed.
  6. **§4 "The hitl merge gate still defers the unapproved pull request after the review phase passes"** (AC5, regression proof) — `the recording code host counts the approvals it submits as approving reviews`; `issue 42 carries the label "hitl"`; branch `feature-issue-42-void` has open PR 7 with no approving review; merge deps built from the same boundary; review passes; `the merge orchestrator runs for issue 42 under adw id "izqk31-void-merge"` → `reports the outcome "abandoned" for reason "hitl_blocked_unapproved"` and `recorded no approval`. Before the fix the review pass approves PR 7, the flag turns that into an approving review, and `executeMerge` walks past the gate (any outcome other than `hitl_blocked_unapproved`), so the row is RED for the exact production reason.
- Rows 3-6 use only phrases that already exist in `feature-796.steps.ts` / `feature-820.steps.ts` plus the three flag-setting Givens from Step 5; rows 1-2 additionally use the issue-record and log-capture phrases from Step 5.

### Step 5: Step definitions for the new phrases (`features/per-issue/step_definitions/feature-848.steps.ts`)

- Header comment listing which phrases are reused from `feature-796.steps.ts` / `feature-820.steps.ts` / `ensureCronOnEveryEventSteps.ts` (the repo convention, see `feature-812.steps.ts:1-30`). Never re-register any of those phrases (an `AmbiguousStepDefinition` would break both suites).
- Imports: `Before, After, Given, Then` from `@cucumber/cucumber`; `assert`; `fs`/`path`; `world796, resetWorld` from `./feature-796.steps.ts`; `resetFeature820State, currentWorkflowConfig` from `./feature-820.steps.ts` (two new exports, below); `AGENTS_STATE_DIR, LOGS_DIR` from `../../../adws/core/config.ts`.
- In `feature-820.steps.ts`, next to the existing cross-file setters (`setReconciledStage`, … lines 177-185), add the two exports; no phrase or behaviour changes there:
  ```ts
  /** #848: lets a sibling step file reset this file's local state and stub from its own hooks. */
  export function resetFeature820State(): void {
    restoreClaudeCliStub();
    resetLocalState();
  }
  /** #848: the configuration the last "a workflow configuration bound to that boundary …" step built. */
  export function currentWorkflowConfig(): WorkflowConfig {
    return requireConfig();
  }
  ```
- Local module state: `capturedLog: string[] | null` and `originalConsoleLog: typeof console.log | null`; a `stopLogCapture()` helper that restores `console.log` if a capture is active (idempotent).
- Hooks, following `feature-821.steps.ts:142-160`:
  - `Before({ tags: '@adw-848' })`: `resetWorld()`, `resetFeature820State()`, `stopLogCapture()`, `capturedLog = null`.
  - `After({ tags: '@adw-848' })`: `stopLogCapture()`, `resetFeature820State()` (restores `CLAUDE_CODE_PATH` if a stub is still active), then remove every directory in `world796().tempDirs` and, for every adw id in `world796().usedAdwIds`, the `AGENTS_STATE_DIR/<adwId>` and `LOGS_DIR/<adwId>` directories when present (recursive, force, same as the 820/821 After hooks), then `resetWorld()`.
- New steps (all phrases exactly as they appear in `feature-848.feature`):
  - `Given('the issue record in that configuration carries the label {string}')` → `currentWorkflowConfig().issue.labels = [label]` (the workflow-start snapshot; `Issue.labels` is a mutable `string[]`).
  - `Given('the issue record in that configuration carries no labels')` → `currentWorkflowConfig().issue.labels = []`.
  - `Given('the ADW logger's output is captured')` → save `console.log`, replace it with a function that pushes `args.map(String).join(' ')` into `capturedLog` (the ADW `log()` helper's only sink is `console.log`, `adws/core/logger.ts:62-71`). Same shape as `captureConsoleLogs` in `feature-821.steps.ts:165-175`, split into start/stop because the review run is the unchanged 820 When step.
  - `Given('the recording code host reports every pull request approval as failed')` → `world796().activeFixture.approveFails = true`.
  - `Given('the recording code host refuses the approval capability probe by name')` → `world796().activeFixture.refuseCanApprove = true`.
  - `Given('the recording code host counts the approvals it submits as approving reviews')` → `world796().activeFixture.approvalsCountAsReviews = true`.
  - `Then('the captured log reports pull request approval skipped because issue {int} carries the {string} label')` → `stopLogCapture()`, then assert `capturedLog` is non-null and some line contains all of `skipping`, `PR #`, `issue #${issueNumber}` and the label text (the Step 1 skip line `Review: skipping approval of PR #7 — issue #42 has hitl label` satisfies this; a line that names only the PR fails it).
- Each fixture-flag Given asserts `w.activeFixture` exists first (`'Expected provider fixtures to have been set up first'`, the 796 convention).

### Step 6: Refresh the review-phase living doc (`app_docs/feature-9gjajh-review-and-diff-phases.md`)

- Responsibilities bullet for `executeReviewPhase`: replace "when review passes and a GitHub App is configured, approves the PR using a PAT" with "when review passes, `ctx.prUrl` is set, the code host reports `canApprovePullRequests()`, and the issue does **not** currently carry the `hitl` label (read live via `IssueTracker.fetchLabels`), approves the PR; otherwise logs a skip naming the issue".
- Contracts bullet: replace the `isGitHubAppConfigured() && GITHUB_PAT` sentence with the same rule and state that approval failure, a refused capability probe, and a refused label read are all non-fatal (a refused label read does not approve). Add one line: the review-phase approval is the second of the two approval sites (`adwChore.tsx` pre-approval is the other) and both honour `hitl` so the merge gate `(no hitl) OR approved` cannot be satisfied by automation on a `hitl` issue (#848).
- Leave `Configuration` (`GITHUB_PAT`) as is.

### Step 7: Run the `Validation Commands`

- Run every command in the section below, in order. All must exit 0. Compare the `@adw-848` run before and after Step 1 (RED → GREEN) as the reproduction.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

From `.adw/commands.md` (package manager `bun`, test framework `vitest`, BDD `cucumber-js`):

- `bun install` — dependencies (no new libraries are needed).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-848"` — **reproduction**: run once after Steps 3 and 5 but before Step 1 → the two §1 rows and the §4 regression row fail (an approval of PR 7 is recorded; the merge orchestrator does not report `hitl_blocked_unapproved`). Run again after Step 1 → 6 scenarios passed, 0 undefined, 0 pending.
- `bunx vitest run adws/phases/__tests__/reviewPhaseApprovalGate.test.ts` — the new approval-gate suite (RED before Step 1 on cases 1 and 6, GREEN after).
- `bunx tsc --noEmit` — type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — auxiliary type check.
- `bun run lint` — ESLint, zero errors/warnings.
- `bun run build` — build.
- `bun run test:unit` — full Vitest suite (includes `adwMerge.test.ts`'s hitl × approved matrix and the existing `reviewPhase.test.ts`).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-820"` — the sibling suite whose step file gained the two exports and the shared recording harness; must stay fully green (its §6 rows "A passing review approves the pull request when the code host reports it can" and "…cannot approve neither approves nor fails" are the AC2/AC3 guards).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression suite, zero failures.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"` — review-proof tag required by `.adw/review_proof.md`.

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of fixing the bug.
- **Read labels live, not from the snapshot.** `config.issue.labels` is the issue as fetched at workflow start; the documented gate semantics (UBIQUITOUS_LANGUAGE.md "HITL", README "Auto-merge gate": "checked in real time, not cached from workflow start") and the chore precedent both use `issueTracker.fetchLabels(issueNumber)` at decision time. A human who adds `hitl` during a long build must still be honoured.
- **Fail-open vs fail-closed.** `GitHubIssueTracker.fetchLabels` is fail-open by contract (empty list on error), so a transient GitHub error still approves — identical to the chore path today and deliberately unchanged. Only a tracker that *refuses the read by name* (throws, e.g. the Jira stub) is treated as fail-closed (no approval, review still passes). Without that try/catch a passing review on such a tracker would become a thrown phase, which is exactly what #820 §6 forbids for the capability probe.
- **Nothing else approves.** After this fix the only two approval sites (`reviewPhase.ts`, `adwChore.tsx`) both honour `hitl`; `autoMergePhase.ts` and `adwMerge.tsx` only *read* approval. Do not add label logic to the gate (out of scope and unauditable there).
- **Race accepted, as in the chore path**: a human adding `hitl` between the review-phase approval and the next cron tick is not caught; the README's "disciplined pre-add workflow" (add `hitl` before the PR opens) becomes true again with this fix — no README change is needed.
- **Shared BDD harness lifetime.** The #848 scenarios reuse `feature-796.steps.ts` / `feature-820.steps.ts` (the repo's precedent for #821 and #844). Per-issue files are swept 14 days after their PR merges, so this coupling is bounded and accepted; keep the log-capture helpers local to `feature-848.steps.ts` for the same reason (do not import them from `feature-821.steps.ts`).
- **The feature file predates this plan.** `features/per-issue/feature-848.feature` was produced by the scenario-writer phase in parallel with planning; Steps 3-5 are written against its exact phrases. If `validate_plan_scenarios` reports a mismatch, reconcile the plan to the feature, not the other way round (the feature is frozen by `gherkinFreeze` during the fix loop).
- Do not change the `PhaseCostStatus`, `createPhaseCostRecords` or return shape of `executeReviewPhase`; orchestrators depend on `reviewPassed` and `reviewIssues` only.
- No new library is required; the install command in `.adw/commands.md` is `bun add <package>` should one ever be needed.
