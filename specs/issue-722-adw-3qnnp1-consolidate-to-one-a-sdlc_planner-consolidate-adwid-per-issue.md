# Feature: Consolidate to one adwId per issue (`adwPrReview` reuses the issue's adwId)

## Metadata
issueNumber: `722`
adwId: `3qnnp1-consolidate-to-one-a`
issueJson: `{"number":722,"title":"Consolidate to one adwId per issue (adwPrReview reuses issue adwId)","body":"## Parent PRD\n\n`specs/prd/pr-review-adwid-consolidation-and-review-failed-gate.md`\n\n## What to build\n\nConsolidate to one adwId per issue, end-to-end. Normalize the `adwPrReview` CLI to `(issueNumber, adwId)` (today it is PR-number-keyed and self-generates an adwId), resolving its PR from the reused adwId's persisted branch name. Add a pure `resolvePrReviewTarget` that takes PR details + an injected issue-comment fetcher + an adwId generator and returns either the reused identity (issue number + existing adwId discovered via the latest adwId in the **issue's** comments) or a freshly generated one — or a skip signal when the PR is not issue-linked. Triggers that spawn PR-review by PR number (cron PR-comment poll, webhook) delegate to the resolver and skip issue-less PRs. See PRD §Solution item 3 and §Implementation Decisions \"adwId consolidation\".\n\n## Acceptance criteria\n\n- [ ] `adwPrReview` CLI accepts `(issueNumber, adwId)` and resolves its PR via the adwId's persisted branch name\n- [ ] New pure `resolvePrReviewTarget` with injected comment-fetcher + generator: reuse path, fresh-generate path, and skip (issue-less) path\n- [ ] PR-review discovers + reuses the issue's existing adwId via the same resolver cron uses (latest adwId in issue comments)\n- [ ] Issue-less PRs are skipped (no ADW review/auto-merge); issue-linked PRs proceed\n- [ ] cron `checkPRsForReviewComments` + webhook delegate to `resolvePrReviewTarget` and pass `(issueNumber, adwId)`\n- [ ] A single issue accumulates one adwId across SDLC + PR-review runs\n- [ ] Unit tests for `resolvePrReviewTarget` (all three paths); regression/BDD green\n\n## Blocked by\n\n- Blocked by #721 (builds on the normalized adwPrReview CLI + resume routing); region-overlaps #719/#721 on adwPrReview and trigger_cron\n\n## Touched Files\n\n- adws/adwPrReview.tsx\n- adws/phases/prReviewPhase.ts\n- adws/triggers/trigger_cron.ts\n- adws/triggers/webhookHandlers.ts\n- adws/core/resolvePrReviewTarget.ts\n- adws/core/__tests__/resolvePrReviewTarget.test.ts\n\n## User stories addressed\n\n- User story 11\n- User story 12\n- User story 13\n- User story 14\n- User story 15\n- User story 16","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-29T12:34:39Z","comments":[],"actionableComment":null}`

## Feature Description

This is slice 4 (the final slice) of the `pr-review-adwid-consolidation-and-review-failed-gate` PRD. It closes the **fragmented-identity** half of the `#712 / PR #715` stuck-state class.

Today every PR-review run mints its **own** new adwId (`initializePRReviewWorkflow` calls `generateAdwId(prDetails.title)` when no adwId is provided — `prReviewPhase.ts:45`), so a single issue accumulates multiple adwIds with scattered state, logs, and comment threads. Because cron resolves "which adwId owns this issue" from the **newest** adwId in the issue's comments (`extractLatestAdwId`), a PR-review adwId can **shadow** the SDLC adwId that holds `awaiting_merge`, and cron stops dispatching the merge entirely. Slices #719–#721 fixed the hand-off and the resume-routing; this slice removes the shadowing root cause by making **one adwId own an entire issue** across SDLC *and* PR-review.

The feature delivers three things:

1. **A pure `resolvePrReviewTarget` resolver** that, given a PR's linked-issue facts plus an injected issue-comment fetcher and an adwId generator, returns one of three outcomes:
   - **reuse** — the PR is issue-linked and the issue already has an adwId (the latest adwId in the **issue's** comments, via the same `extractLatestAdwId` resolver cron uses) → reuse it.
   - **fresh** — the PR is issue-linked but the issue has no adwId yet → generate one (genuinely new work still gets an identity).
   - **skip** — the PR is not issue-linked → ADW does not review or auto-merge it.

2. **`adwPrReview` CLI normalized to `(issueNumber, adwId)`** as its canonical form. It resolves its PR from the adwId's **persisted branch name** (`defaultFindPRByBranch`), reusing the resume-form path that slice #721 already added. The legacy single `<pr-number>` form is retained as a manual escape hatch but is **routed through the resolver** so even a hand-invoked review consolidates instead of self-generating a new adwId.

3. **Trigger delegation** — the two entry points that spawn PR-review by PR number (cron's `checkPRsForReviewComments`, the webhook's `pull_request_review_comment` / `pull_request_review` handlers) call a shared delegation helper that runs the resolver, **skips issue-less PRs before spawning**, and spawns `adwPrReview <issueNumber> <adwId>`.

Net effect: a single issue accumulates exactly one adwId. The PR-review's work lands under the issue's existing adwId, so its `awaiting_merge` / `review_failed` signal can never be shadowed by a newer adwId, and resume-routing (slice #721's `resolveResumeSpawn`) keeps working because `orchestratorScript` is co-stamped onto that one adwId.

## User Story

As an **ADW operator** (US 11, US 12, US 13, US 14)
I want **PR-review to reuse the issue's existing adwId — discovered via the same "latest adwId in the issue's comments" resolver cron uses — and to fall back to a freshly generated adwId only when none exists**
So that **all work for one issue lives under a single adwId with one state/log/comment home, the merge signal can never be shadowed by a newer adwId, and genuinely new work still gets an identity**.

As an **ADW operator** (US 15, US 16)
I want **PR-review to operate only on issue-linked PRs and to leave issue-less human PRs alone**
So that **the `(issueNumber, adwId)` identity contract always holds and ADW never acts on a PR it cannot key to an issue**.

## Problem Statement

`adwPrReview` is **PR-number-keyed and self-generating**:

- The triggers spawn it by PR number only:
  ```ts
  // trigger_cron.ts:371 — current
  spawn('bunx', ['tsx', `${REPO_ROOT}/adws/adwPrReview.tsx`, String(pr.number), ...targetRepoArgs], {...});
  // trigger_webhook.ts:137 and :154 — current
  spawnDetached('bunx', ['tsx', 'adws/adwPrReview.tsx', String(prNumber), ...webhookTargetRepoArgs]);
  ```
- The orchestrator then mints a brand-new adwId from the PR title:
  ```ts
  // prReviewPhase.ts:45 — current
  const resolvedAdwId = adwId ?? generateAdwId(prDetails.title);
  ```

So each PR-review run produces a **new** adwId. That fresh adwId becomes the newest in the issue's comment thread, shadowing the SDLC adwId that holds `awaiting_merge` — exactly the `#712 / PR #715` incident. None of the triggers check whether the PR is even issue-linked before spawning, so ADW will also spin up a full review workflow on a purely human, issue-less PR.

Slice #721 already taught `adwPrReview` the **resume form** `(issueNumber, adwId)` (`adwPrReview.tsx:54-79`, `resolvePrReviewInvocation`), which re-resolves the PR from the persisted `branchName` via `defaultFindPRByBranch`. What is missing is (a) the discovery/reuse decision that picks the issue's existing adwId, (b) the issue-less skip, and (c) the trigger delegation that produces `(issueNumber, adwId)` instead of a bare PR number.

## Solution Statement

Encapsulate the identity decision in a pure, injected-dependency function and wire persistence + delegation around it — mirroring slice #721's `resolveResumeSpawn` shape and the `cronStageResolver` injected-deps style.

- **`resolvePrReviewTarget(pr, deps): PrReviewTarget`** — a pure function in `adws/core/resolvePrReviewTarget.ts`. Input `pr = { issueNumber: number | null; title: string }` (the linked-issue facts already derived by `fetchPRDetails`); deps `{ fetchIssueComments: (issueNumber) => { body: string }[]; generateAdwId: (summary?) => string }`. Returns a discriminated union:
  - `issueNumber === null` → `{ kind: 'skip', reason: 'not-issue-linked' }`
  - else discover `extractLatestAdwId(fetchIssueComments(issueNumber))`:
    - found → `{ kind: 'reuse', issueNumber, adwId }`
    - none → `{ kind: 'fresh', issueNumber, adwId: generateAdwId(title) }`

  The skip decision lives in the resolver (testable with `issueNumber: null`); the **derivation** of `issueNumber` (PR body `Implements #N` → branch `issue-(\d+)` fallback) stays in `fetchPRDetails` (`prApi.ts:124-128`), its single existing home.

- **Reuse `extractLatestAdwId` — "the same resolver cron uses."** That function currently lives in `adws/triggers/cronStageResolver.ts:32`, but its only dependency is `extractAdwIdFromComment` from `adws/core/workflowCommentParsing.ts`. **Relocate `extractLatestAdwId` into `adws/core/workflowCommentParsing.ts`** (next to its dependency) and **re-export it from `cronStageResolver.ts`** for back-compat, so `resolvePrReviewTarget` (core) imports it without a `core → triggers` layering inversion, and cron + the resolver share one literal implementation.

- **Impure delegation helper `resolvePrReviewSpawn(prNumber, repoInfo)`** in `adws/triggers/webhookHandlers.ts` (the existing home of shared trigger helpers — `extractIssueNumberFromBranch` already lives there and is imported by `prApi.ts`). It does the I/O around the pure resolver: `fetchPRDetails` → `resolvePrReviewTarget` → returns `{ issueNumber, adwId } | null` (null = skip). On the **fresh** path it seeds the new adwId's top-level state with the PR's head branch so the orchestrator can resolve the PR from the persisted branch name uniformly:
  ```ts
  AgentStateManager.writeTopLevelState(target.adwId, {
    adwId: target.adwId,
    issueNumber: target.issueNumber,
    branchName: prDetails.headBranch,
    orchestratorScript: 'adws/adwPrReview.tsx',
  });
  ```
  `writeTopLevelState` is a shallow merge (`agentState.ts:281`), so this is safe. On the **reuse** path no seed is needed — the SDLC adwId's state already carries `branchName` (slice `sh8m9r`), and `adwPrReview` itself co-stamps `orchestratorScript = adws/adwPrReview.tsx` on init (`adwPrReview.tsx:96-101`), which is the "overwrite on takeover" the PRD calls for.

- **Cron + webhook delegate.** `checkPRsForReviewComments` and the two webhook spawn sites call `resolvePrReviewSpawn`, `continue`/return-`ignored` on `null` (issue-less), and spawn `adwPrReview <issueNumber> <adwId>` on a target.

- **`adwPrReview` CLI normalized.** `resolvePrReviewInvocation` keeps the `(issueNumber, adwId)` resume form (resolve PR from `state.branchName` — covers both the reused SDLC branch and the seeded fresh branch) and changes the legacy single `<pr-number>` form to route through `resolvePrReviewSpawn` (skip → `process.exit(0)`; otherwise proceed under the resolved adwId). The PR number is already known in that path, so it calls `initializePRReviewWorkflow` directly.

- **`initializePRReviewWorkflow` stops self-generating.** Change `adwId: string | null` → `adwId: string` (required) and drop the `?? generateAdwId(prDetails.title)` fallback (`prReviewPhase.ts:45`); the adwId is now always resolved by `resolvePrReviewTarget` upstream. Refine the `isResumeMode` empty-comments bypass (`prReviewPhase.ts:59`) so a fresh trigger-seed (which has `branchName` but no recorded `phases`) is **not** treated as a resume.

## Relevant Files
Use these files to implement the feature:

### Existing files to modify
- `adws/core/resolvePrReviewTarget.ts` — **new**, see New Files.
- `adws/core/workflowCommentParsing.ts` — relocate `extractLatestAdwId` here (alongside its dependency `extractAdwIdFromComment`, `:151`); it becomes the shared home imported by both `cronStageResolver` and `resolvePrReviewTarget`.
- `adws/triggers/cronStageResolver.ts` — `extractLatestAdwId` currently lives here (`:32`); after the relocation, re-export it from core for back-compat so all existing importers (`retryHandler`, `takeoverHandler`, `webhookHandlers`, `cronStageResolver.test.ts`) keep working unchanged.
- `adws/triggers/webhookHandlers.ts` — add the impure `resolvePrReviewSpawn(prNumber, repoInfo)` delegation helper (consistent with the existing injected-deps trigger helpers and `extractIssueNumberFromBranch`, `:25`).
- `adws/triggers/trigger_cron.ts` — `checkPRsForReviewComments` (`:360-382`) delegates to `resolvePrReviewSpawn`, skips `null`, spawns `adwPrReview <issueNumber> <adwId>`.
- `adws/triggers/trigger_webhook.ts` — the two spawn sites (`:128-140` `pull_request_review_comment`, `:142-157` `pull_request_review`) delegate to `resolvePrReviewSpawn`, return `{status:'ignored', reason:'not_issue_linked'}` on `null`, spawn `adwPrReview <issueNumber> <adwId>`. (The issue's Touched-Files list names `webhookHandlers.ts`; the actual `adwPrReview` spawn is in `trigger_webhook.ts`, which imports its handlers from `webhookHandlers.ts` — `:22`. The shared helper lands in `webhookHandlers.ts`; the call sites are in `trigger_webhook.ts`.)
- `adws/adwPrReview.tsx` — normalize the CLI: `resolvePrReviewInvocation` (`:54-79`) keeps the `(issueNumber, adwId)` resume form and routes the legacy `<pr-number>` form through `resolvePrReviewSpawn`; update the usage strings (`:5`, `:88`); pass the always-non-null adwId into `initializePRReviewWorkflow` (`:94`).
- `adws/phases/prReviewPhase.ts` — `initializePRReviewWorkflow` (`:40`): `adwId` becomes required `string`, drop the `generateAdwId` self-generation (`:45`), refine `isResumeMode` (`:59`) so a fresh trigger-seed is not a resume.

### Read-only references (patterns to mirror — do not modify)
- `adws/core/resolveResumeSpawn.ts` + `adws/core/__tests__/resolveResumeSpawn.test.ts` — the pure-resolver + injected-deps test pattern to mirror exactly (discriminated/normalized output, `makeState` helper style).
- `adws/triggers/cronStageResolver.ts` `extractLatestAdwId` (`:32`) — the "latest adwId in the issue's comments" newest-to-oldest scan that the resolver reuses.
- `adws/github/issueLinkMarker.ts` (`bodyLinksIssue`, `issueLinkPattern`) and `adws/github/prApi.ts` `fetchPRDetails` (`:119-144`) — the canonical PR→issue linkage (`Implements #N` / `issue-(\d+)`) already producing `PRDetails.issueNumber`.
- `adws/github/prApi.ts` `defaultFindPRByBranch` (`:61`) — branch → open PR resolution used by the resume form.
- `adws/core/agentState.ts` `writeTopLevelState` (`:281`) — confirms the shallow-merge semantics that make seeding `branchName` safe.
- `adws/core/adwId.ts` `generateAdwId` (`:36`) — the generator injected into the resolver.
- `adws/types/agentTypes.ts` — `AgentState` (`branchName?` `:258`, `phases?` `:300`, `orchestratorScript?` `:309`).

### Conditional docs (per `.adw/conditional_docs.md` — read before implementing)
- `app_docs/feature-s59wpc-adwprreview-phaserunner-migration.md` — Owns `adwPrReview.tsx`, `prReviewPhase.ts`, `decidePostReviewOutcome.ts`; covers the `(issueNumber, adwId)` resume form, `branchName` re-resolution, `orchestratorScript` co-stamp, and the `isResumeMode` bypass — all directly touched here.
- `app_docs/feature-ni6fpk-serialize-overlapping-region-issues.md` — Owns `trigger_cron.ts`, `resolveResumeSpawn.ts`, `cronStageResolver.ts`; covers the cron spawn flow and `orchestratorScript` persistence this slice consumes.
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — Owns `branchNameResolution.ts`; covers the persisted-`branchName`-per-adwId contract the reuse path depends on.

### New Files
- `adws/core/resolvePrReviewTarget.ts` — the pure resolver: `PrReviewTargetInput`, `PrReviewTargetDeps`, the `PrReviewTarget` discriminated union (`reuse | fresh | skip`), and `resolvePrReviewTarget`.
- `adws/core/__tests__/resolvePrReviewTarget.test.ts` — unit tests for all three paths with injected deps.

## Implementation Plan
### Phase 1: Foundation
Make the shared "latest adwId in the issue's comments" resolver importable from core without a layering inversion, then build the pure target resolver and its tests. This phase is self-contained and introduces no behavior change to the running system.

### Phase 2: Core Implementation
Build the impure delegation helper (`resolvePrReviewSpawn`) that wraps the pure resolver with I/O (fetch PR details, fetch issue comments, seed fresh-adwId branch state) and returns `(issueNumber, adwId)` or a skip. Normalize the `adwPrReview` CLI and stop the orchestrator from self-generating adwIds.

### Phase 3: Integration
Wire the cron PR-comment poll and the two webhook PR-review handlers to delegate to `resolvePrReviewSpawn`, skip issue-less PRs before spawning, and pass `(issueNumber, adwId)`. Validate end-to-end that a single issue accumulates one adwId and that regression/BDD stay green.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1 — Relocate `extractLatestAdwId` into core (shared resolver home)
- Move the `extractLatestAdwId(comments: { body: string }[]): string | null` function from `adws/triggers/cronStageResolver.ts:32` into `adws/core/workflowCommentParsing.ts`, immediately adjacent to `extractAdwIdFromComment` (its sole dependency). Keep the implementation byte-for-byte (newest-to-oldest scan).
- In `cronStageResolver.ts`, replace the moved definition with a re-export: `export { extractLatestAdwId } from '../core/workflowCommentParsing';` so every existing importer (`retryHandler.ts`, `takeoverHandler.ts`, `webhookHandlers.ts`, `cronStageResolver.test.ts`) compiles unchanged.
- Verify the move via `bunx tsc --noEmit -p adws/tsconfig.json` and that `adws/core/__tests__/` + `adws/triggers/__tests__/cronStageResolver.test.ts` still pass.

### Task 2 — Create the pure `resolvePrReviewTarget` module
- Create `adws/core/resolvePrReviewTarget.ts`. Define:
  - `export interface PrReviewTargetInput { readonly issueNumber: number | null; readonly title: string; }`
  - `export interface PrReviewTargetDeps { readonly fetchIssueComments: (issueNumber: number) => { body: string }[]; readonly generateAdwId: (summary?: string) => string; }`
  - `export type PrReviewTarget = { readonly kind: 'reuse'; readonly issueNumber: number; readonly adwId: string } | { readonly kind: 'fresh'; readonly issueNumber: number; readonly adwId: string } | { readonly kind: 'skip'; readonly reason: string };`
  - `export function resolvePrReviewTarget(pr: PrReviewTargetInput, deps: PrReviewTargetDeps): PrReviewTarget` — guard `pr.issueNumber === null` → skip; else `const existing = extractLatestAdwId(deps.fetchIssueComments(pr.issueNumber));` → reuse if `existing !== null`, else fresh via `deps.generateAdwId(pr.title)`.
- Import `extractLatestAdwId` from `./workflowCommentParsing` (core → core, clean). Keep the function pure (no imports with side effects); use guard clauses (no nested conditionals) per the coding guidelines.

### Task 3 — Unit-test `resolvePrReviewTarget` (all three paths)
- Create `adws/core/__tests__/resolvePrReviewTarget.test.ts` mirroring `resolveResumeSpawn.test.ts` (vitest, injected deps, no fs/network).
- Cover:
  - **reuse** — `issueNumber` set, injected `fetchIssueComments` returns comments whose newest ADW comment carries an adwId → result `{ kind:'reuse', issueNumber, adwId }` equals that adwId; assert `generateAdwId` was **not** called (inject a spy that throws/records).
  - **fresh** — `issueNumber` set, injected `fetchIssueComments` returns `[]` (or comments with no ADW id) → result `{ kind:'fresh', issueNumber, adwId }` equals the injected generator's return; assert the generator received `title` as its summary argument.
  - **skip** — `issueNumber: null` → `{ kind:'skip', reason:'not-issue-linked' }`; assert neither `fetchIssueComments` nor `generateAdwId` is called.
  - Edge: multiple ADW comments → newest (last) adwId wins (proves it uses `extractLatestAdwId` newest-to-oldest).

### Task 4 — Add the `resolvePrReviewSpawn` delegation helper
- In `adws/triggers/webhookHandlers.ts`, add `export function resolvePrReviewSpawn(prNumber: number, repoInfo: RepoInfo): { issueNumber: number; adwId: string } | null`.
- Implementation: `const prDetails = fetchPRDetails(prNumber, repoInfo);` → `const target = resolvePrReviewTarget({ issueNumber: prDetails.issueNumber, title: prDetails.title }, { fetchIssueComments: (n) => fetchIssueCommentsRest(n, repoInfo), generateAdwId });`
  - `target.kind === 'skip'` → `log('PR #'+prNumber+' is not issue-linked — skipping PR-review (no ADW review/auto-merge)');` return `null`.
  - `target.kind === 'fresh'` → seed top-level state for `target.adwId` with `{ adwId, issueNumber: target.issueNumber, branchName: prDetails.headBranch, orchestratorScript: 'adws/adwPrReview.tsx' }` (so the orchestrator resolves the PR from the persisted branch and resume-routing tags the adwId).
  - return `{ issueNumber: target.issueNumber, adwId: target.adwId }`.
- Use the existing imports already available in the triggers layer (`fetchPRDetails`, `fetchIssueCommentsRest`, `generateAdwId`, `AgentStateManager`); add only what is missing. Keep it a thin wrapper (one reason per function).

### Task 5 — Normalize the `adwPrReview` CLI
- In `adws/adwPrReview.tsx`, update `resolvePrReviewInvocation` so:
  - The `(issueNumber, adwId)` resume form (two positionals, second non-numeric) is unchanged in spirit — read top-level state, resolve the PR from `state.branchName` via `defaultFindPRByBranch`. This now serves **both** the reused SDLC branch and the seeded fresh branch.
  - The single numeric `<pr-number>` form routes through the resolver: `const target = resolvePrReviewSpawn(prNumber, resolvedRepoInfo);` → if `target === null` log + `process.exit(0)` (issue-less skip); else return `{ prNumber, adwId: target.adwId }` (PR number already known from the arg).
- Update the usage banner (`:5`) and the error usage string (`:88`) to document `bunx tsx adws/adwPrReview.tsx <issueNumber> <adwId>` as the canonical form (with the `<pr-number>` manual fallback noted).
- Ensure the value passed to `initializePRReviewWorkflow` (`:94`) is always a non-null adwId.

### Task 6 — Stop `initializePRReviewWorkflow` self-generating
- In `adws/phases/prReviewPhase.ts`, change the signature to `initializePRReviewWorkflow(prNumber: number, adwId: string, ...)` (required, non-null) and replace `const resolvedAdwId = adwId ?? generateAdwId(prDetails.title);` (`:45`) with `const resolvedAdwId = adwId;` (and drop the now-unused `generateAdwId` import if nothing else uses it).
- Refine `isResumeMode` (`:59`): a genuine resume means a prior PR-review run exists for this adwId, not merely that a top-level state record exists (a fresh trigger-seed writes `branchName` but records no `phases`). Compute resume from prior-run evidence, e.g. `const existingState = AgentStateManager.readTopLevelState(resolvedAdwId); const isResumeMode = !!existingState?.phases && Object.keys(existingState.phases).length > 0;` so the empty-unaddressed-comments early-exit (`:60`) still fires correctly for fresh runs and is bypassed only for true resumes.

### Task 7 — Delegate from the cron PR-comment poll
- In `adws/triggers/trigger_cron.ts` `checkPRsForReviewComments` (`:360-382`), after `hasUnaddressedComments(pr.number, cronRepoInfo)` and `processedPRs.add(pr.number)`:
  - `const target = resolvePrReviewSpawn(pr.number, cronRepoInfo);`
  - `if (target === null) { log('Skipping issue-less PR #'+pr.number+' (no ADW review)'); continue; }`
  - spawn `adwPrReview` with `String(target.issueNumber), target.adwId` (replacing `String(pr.number)`), preserving `...targetRepoArgs` and the existing detached spawn options.

### Task 8 — Delegate from the webhook PR-review handlers
- In `adws/triggers/trigger_webhook.ts`, in both `pull_request_review_comment` (`:128-140`) and `pull_request_review` (`:142-157`) handlers, after the existing `shouldTriggerPrReview(prNumber)` dedup gate:
  - `const target = resolvePrReviewSpawn(prNumber, resolution.repoInfo);`
  - `if (target === null) { jsonResponse(res, 200, { status: 'ignored', reason: 'not_issue_linked' }); return; }`
  - replace the spawn arg `String(prNumber)` with `String(target.issueNumber), target.adwId`; keep `...webhookTargetRepoArgs`.
  - Keep `jsonResponse(res, 200, { status: 'triggered', pr: prNumber })` (or include `adwId`), preserving the existing `auth_gate_set` / `action` / `approved`-review early returns.

### Task 9 — Validate
- Run every command in the Validation Commands section. All must pass with zero regressions.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so this slice adds unit tests.

- **`adws/core/__tests__/resolvePrReviewTarget.test.ts`** (new) — the safety-critical resolver, tested in isolation with injected `fetchIssueComments` + `generateAdwId`:
  - reuse path (issue-linked, existing adwId is the latest in the issue's comments),
  - fresh-generate path (issue-linked, no adwId in comments → generator invoked with the PR title),
  - skip path (`issueNumber: null` → neither dep invoked),
  - newest-adwId-wins ordering edge.
- **Existing suites stay green** — the `extractLatestAdwId` relocation is covered by the back-compat re-export, so `adws/triggers/__tests__/cronStageResolver.test.ts` and the takeover/retry suites pass unchanged. `resolveResumeSpawn.test.ts` is unaffected.

Per the PRD's Testing Decisions, the **thin wiring** (CLI normalization, `resolvePrReviewSpawn` delegation, fresh-adwId branch seeding, trigger arg changes) is covered by the extracted pure resolver plus the existing BDD/regression harness rather than dedicated unit tests.

### Edge Cases
- **Issue-less PR** — `prDetails.issueNumber === null` (no `Implements #N` in the body and no `issue-(\d+)` in the branch) → resolver returns `skip`; cron `continue`s and webhook returns `ignored` **before** any spawn, worktree, or log directory is created.
- **Issue with no prior adwId (fresh path)** — a human-opened issue-linked PR whose issue has no ADW comments → `fresh` adwId generated; trigger seeds `branchName`; `isResumeMode` stays `false` (no recorded phases) so the empty-comments early-exit still applies normally.
- **Issue with an existing SDLC adwId (reuse path)** — the latest adwId in the issue's comments is reused; PR-review's `awaiting_merge` / `review_failed` lands on the **same** adwId; `orchestratorScript` is co-stamped to `adws/adwPrReview.tsx` (so a later `## Retry` routes back to PR-review via `resolveResumeSpawn`).
- **Multiple pre-existing adwIds on an issue** (legacy, pre-change) — `extractLatestAdwId` picks the newest; the issue self-heals to a single adwId after one PR-review cycle (consistent with the PRD's Out-of-Scope note on retroactive consolidation).
- **Resume form with a missing/blank `branchName`** — `defaultFindPRByBranch` returns `null` → the existing `resolvePrReviewInvocation` error-exit path fires (unchanged from slice #721); no silent misroute.
- **Manual `adwPrReview <pr-number>` on an issue-less PR** — routed through the resolver → `skip` → clean `process.exit(0)` instead of self-generating an adwId.
- **Closed/merged PR** — the existing `prDetails.state` guard in `initializePRReviewWorkflow` (`:52-55`) still exits cleanly.

## Acceptance Criteria
- [ ] `adwPrReview` CLI accepts `(issueNumber, adwId)` as its canonical form and resolves its PR via the adwId's persisted `branchName` (`defaultFindPRByBranch`); the legacy `<pr-number>` form is routed through the resolver.
- [ ] New pure `resolvePrReviewTarget(pr, deps)` in `adws/core/` returns `reuse` / `fresh` / `skip` using an injected comment-fetcher and adwId generator; no side effects.
- [ ] PR-review discovers + reuses the issue's existing adwId via `extractLatestAdwId` (the same "latest adwId in the issue's comments" resolver cron uses).
- [ ] Issue-less PRs (`issueNumber === null`) are skipped before any spawn — no ADW review/auto-merge; issue-linked PRs proceed.
- [ ] cron `checkPRsForReviewComments` and both webhook PR-review handlers delegate to `resolvePrReviewSpawn` and spawn `adwPrReview <issueNumber> <adwId>`.
- [ ] A single issue accumulates exactly one adwId across SDLC + PR-review runs (`initializePRReviewWorkflow` no longer self-generates).
- [ ] Unit tests for `resolvePrReviewTarget` cover all three paths and pass; full regression/BDD suite is green with zero regressions.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, and `bun run build` succeed.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — Lint for code-quality issues.
- `bunx tsc --noEmit` — Type-check the repository.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` project (catches the relocation re-export, the new resolver, and the trigger/CLI changes).
- `bun run test:unit` — Run the vitest unit suite, including the new `resolvePrReviewTarget.test.ts` and the unchanged `cronStageResolver` / `resolveResumeSpawn` suites.
- `bun run build` — Build to verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the regression BDD suite to confirm zero behavioral regressions across the cron/webhook/PR-review paths.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-722"` — Run this issue's per-issue scenarios (once generated by the scenario phase) covering reuse / fresh / skip resolution.

## Notes
- `.adw/coding_guidelines.md` applies. Keep `resolvePrReviewTarget` pure and use guard clauses (no nested conditionals — "sideways christmas tree"); keep `resolvePrReviewSpawn` a thin single-responsibility wrapper; files stay well under the 300-line ceiling.
- **No new libraries.** If one were needed, the install command from `.adw/commands.md` is `bun add <package>`.
- **Touched-Files reconciliation:** the issue lists `adws/triggers/webhookHandlers.ts`, but the live PR-review spawn sites are in `adws/triggers/trigger_webhook.ts`. The shared delegation helper (`resolvePrReviewSpawn`) lands in `webhookHandlers.ts` (matching the list and the existing `extractIssueNumberFromBranch` precedent); the spawn-site edits are in `trigger_webhook.ts`. The slice also touches `adws/core/workflowCommentParsing.ts` and `adws/triggers/cronStageResolver.ts` (the `extractLatestAdwId` relocation + re-export) — a small, behavior-preserving move that keeps `core → core` import hygiene.
- **Consolidation self-heals.** Retroactively collapsing issues that already carry multiple pre-change adwIds is explicitly out of scope (PRD §Out of Scope); discovery picks the latest and converges after one cycle.
- **Dependency:** builds directly on slice #721 (merged) — the `(issueNumber, adwId)` resume form, `resolveResumeSpawn`, and the `orchestratorScript` co-stamp. Do not re-introduce the hardcoded SDLC spawn or PR-number-keyed identity those slices removed.
- **Region overlap** with #719/#721 on `adwPrReview.tsx` and `trigger_cron.ts`: this slice only *normalizes identity* and *adds delegation*; it must not alter the `decidePostReviewOutcome` gate or the resume-routing those slices own.
