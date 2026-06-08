# Feature: Label-routed `issues.opened` handler

## Metadata
issueNumber: `542`
adwId: `gmfhco-issues-opened-label`
issueJson: `{"number":542,"title":"issues.opened label-routed handler","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nModify `trigger_webhook.ts` to handle `issues.opened` events with label-based routing. Read `labels[]` from the payload. Behavior:\n\n- `adw:none` present → ignore (no orchestrator spawned)\n- Exactly one `adw:<type>` label → use as classification, skip LLM inference, spawn orchestrator\n- Multiple `adw:<type>` labels → refuse, post non-workflow comment requesting label cleanup, do not spawn\n- Zero `adw:<type>` labels → run LLM classifier (existing `classifyGitHubIssue`), apply inferred label to the issue, spawn orchestrator\n\nDo NOT subscribe to `issues.labeled` — late-added labels rely on the CRON recovery layer.\n\nSee \"Label-based classification\" and \"Trigger plumbing\" sections of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] Issue with `adw:none` → no orchestrator spawned, no comment posted\n- [ ] Issue with exactly one `adw:<type>` label → routes to that orchestrator without an LLM call\n- [ ] Issue with multiple `adw:<type>` labels → non-workflow refusal comment posted, no orchestrator spawned\n- [ ] Issue with no `adw:*` labels → LLM infers, applies the label, orchestrator spawned\n- [ ] `issues.labeled` events are NOT subscribed — late labels have no immediate effect\n- [ ] Tests cover all four routing branches\n\n## Blocked by\n\n- Blocked by #540\n\n## User stories addressed\n\n- User story 4\n- User story 5\n- User story 6\n- User story 19\n- User story 20\n- User story 21","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:11:15Z","comments":[],"actionableComment":null}`

## Feature Description

Today, an `issues.opened` webhook event is processed by `trigger_webhook.ts`, which checks auth/cooldown/eligibility and then calls `classifyAndSpawnWorkflow`. Classification always runs the two-step classifier (regex command extraction → LLM `/classify_issue` fallback). This means every new issue depends on an LLM read of the body, which is the root of the regex-misfire / misclassification failure class described in the parent PRD.

This feature wires the already-merged `labelManager` deep module (issue #540) into the `issues.opened` path so that **GitHub `adw:*` labels drive classification deterministically**, with the LLM used only as a fallback when no label is present. The handler reads `labels[]` directly from the webhook payload and routes on four mutually exclusive branches:

- **`adw:none` present** → opt out entirely. No orchestrator spawned, no comment posted.
- **Exactly one `adw:<type>` label** (`adw:chore` / `adw:bug` / `adw:feature` / `adw:pr_review`) → use it as the classification, **skip the LLM**, spawn the mapped orchestrator.
- **Multiple `adw:<type>` labels** → refuse. Post a plain (non-workflow) comment asking the team to remove all but one label, and do not spawn. The issue stays eligible for CRON rescan; once it drops to ≤1 classification label it becomes processable again.
- **Zero `adw:<type>` labels** → run the existing LLM classifier, **persist the inferred classification back to the issue as an `adw:<type>` label**, then spawn.

`issues.labeled` is deliberately **not** subscribed. Late-applied labels are handled by the existing CRON recovery layer (out of scope here); the webhook continues to ignore every `issues` action other than `opened`/`closed`.

The value: classification intent expressed via labels is honored without LLM intermediation; every issue's classification becomes visible on the board (humans-labeled or LLM-inferred-then-persisted); the body-regex misfire class is eliminated for the label-present cases; and triagers gain an explicit opt-out (`adw:none`) and override (`adw:<type>`).

## User Story

As a triager / issue author on a target repo
I want ADW to classify my issue from its `adw:*` GitHub labels (opting out with `adw:none`, overriding with `adw:bug`/`adw:feature`/etc., and refusing politely when I apply conflicting labels)
So that classification is deterministic and visible, I can override or skip the LLM when I know better, and I never trigger a misclassification by mentioning a slash command in prose.

## Problem Statement

The `issues.opened` handler unconditionally routes new issues through the LLM classifier. There is:

- **No deterministic override** — a triager who knows an issue is a bug cannot force `/bug` without relying on the LLM reading body text.
- **No opt-out** — every new issue is processed; there is no way to mark an issue "do not automate."
- **No conflict handling** — there is no concept of label-driven classification at all, so there is nothing to detect or refuse when intent is ambiguous.
- **No persisted classification** — when the LLM does classify, the result is not written back to the issue, so the board never reflects the chosen type unless a human labeled it.

The `labelManager` module (#540) supplies all the label primitives needed to fix this, but it is currently **dead code in production** — imported only by feature-540 BDD step definitions, wired into no trigger.

## Solution Statement

Integrate `labelManager` into the `issues.opened` path via a small, pure, testable routing layer, and teach the shared spawn function to (a) accept a pre-decided classification (skip the LLM) and (b) persist an LLM-inferred classification as a label.

1. **Add a names-based reader to `labelManager`** — `readAdwLabelNames(names: readonly string[])` — so the webhook payload's `labels[].name` array can be read without fabricating full `GitHubLabel` objects. `readAdwLabels` delegates to it (no behavior change; all #540 tests stay green).

2. **New pure + DI module `adws/triggers/issueOpenedRouter.ts`** (mirrors the `cronIssueFilter.ts` "testable logic extracted from a trigger" precedent):
   - `decideIssueOpenedRoute(reading: AdwLabelReading): IssueOpenedRoute` — pure decision over the four branches, with `adw:none` taking precedence over conflict/classification.
   - `extractPayloadLabelNames(issue): string[]` — pure, defensive extraction of label names from the raw webhook `issue` object.
   - `routeIssueOpened(params, deps)` — DI-injected orchestration that performs the side effects per branch (post refusal comment / eligibility-gated spawn) and returns a structured outcome.
   - A `MULTI_LABEL_REFUSAL_COMMENT` constant whose text contains **no** ADW comment marker (no `## :emoji:` heading, no `<!-- adw-bot -->`) so `concurrencyGuard`'s `isAdwComment` never counts it.

3. **Extend `classifyAndSpawnWorkflow`** (in `webhookGatekeeper.ts`) with one optional trailing `labelRouting` argument:
   - `precomputedClassification` → skip `classifyIssueForTrigger` (no LLM); spawn using the supplied type.
   - `persistInferredLabel` → after a successful LLM classification, best-effort `applyLabel(issueNumber, issueTypeToAdwLabel(type), repoInfo)`.
   - `issueTitle` → seed `generateAdwId` for a readable adwId on the precomputed path.
   - All four existing call sites are unaffected (the argument is optional and omitted).

4. **Wire the router into `trigger_webhook.ts`** — the `action === 'opened'` block extracts payload label names, calls `routeIssueOpened`, and keeps the existing `AuthRequiredError` → `writeAuthGate` handling. Auth-gate and cooldown checks remain ahead of routing. Eligibility (dependencies/concurrency) continues to gate the spawn branches only.

5. **`issues.labeled` stays unsubscribed** — no `labeled` action branch is added; the existing fall-through `ignored` response covers it. A guard test asserts the source never reacts to `'labeled'`.

This keeps the deterministic label semantics in the well-tested `labelManager`, the routing decision pure and trivially unit-testable, and the side effects behind a DI seam — while reusing all of `classifyAndSpawnWorkflow`'s existing auth/takeover/lock machinery rather than duplicating it.

## Relevant Files

Use these files to implement the feature:

- `adws/triggers/trigger_webhook.ts` — **(modify)** Webhook HTTP server. The `action === 'opened'` block (currently ~lines 230–262) is the integration point. Extract payload label names, call the router, preserve `AuthRequiredError`/`writeAuthGate` handling. File is ~290 lines (near the 300-line guideline cap), which is why routing logic is extracted rather than inlined.
- `adws/github/labelManager.ts` — **(modify)** Deep module from #540. Add `readAdwLabelNames(names)` and have `readAdwLabels` delegate to it. Already exports `readAdwLabels`, `applyLabel`, `issueTypeToAdwLabel`, `AdwLabelReading`, `ADW_CLASSIFICATION_LABELS`, `ADW_NONE_LABEL`.
- `adws/triggers/webhookGatekeeper.ts` — **(modify)** Home of `classifyAndSpawnWorkflow`. Add the optional `labelRouting` argument and the skip-LLM / persist-label behavior in the `spawn_fresh` path. Imports `applyLabel`/`issueTypeToAdwLabel` from `../github/labelManager`.
- `adws/github/issueApi.ts` — **(read)** `commentOnIssue(issueNumber, body, repoInfo): void` is the plain, marker-free comment poster used for the refusal comment. Barrel-exported from `../github`.
- `adws/github/index.ts` — **(modify)** Barrel; add `readAdwLabelNames` to the `labelManager` re-export block. Already re-exports `commentOnIssue`, `readAdwLabels`, `applyLabel`, `issueTypeToAdwLabel`, `isAdwRunningForIssue`.
- `adws/core/issueClassifier.ts` — **(read, do not modify)** `classifyIssueForTrigger` is the existing LLM classification path reused by the `infer` branch. (The PRD's eventual deletion of `extractAdwCommandFromText`/`classifyWithAdwCommand` is a separate slice — out of scope here.)
- `adws/core/workflowMapping.ts` — **(read)** `getWorkflowScript(issueType, adwCommand?)` maps a classification to an orchestrator script. Confirms `/bug`→`adwSdlc.tsx`, `/chore`→`adwChore.tsx`, `/feature`→`adwSdlc.tsx`, `/pr_review`→`adwPlanBuild.tsx`.
- `adws/types/issueRouting.ts` — **(read)** `issueTypeToOrchestratorMap` — the source of the type→script mapping above.
- `adws/types/issueTypes.ts` — **(read)** `GitHubLabel`, `GitHubIssue`, `IssueClassSlashCommand` types.
- `adws/triggers/issueEligibility.ts` — **(read)** `checkIssueEligibility(issueNumber, body, repoInfo)` → `{ eligible, reason?, blockingIssues? }`. Reused to gate the spawn branches; does no label checking (correct — labels are the router's job).
- `adws/triggers/webhookGatekeeper.ts` `logDeferral` — **(read)** existing deferral logger reused when a spawn branch is ineligible.
- `adws/core/workflowCommentParsing.ts` — **(read)** `isAdwComment` (`/^## :[a-z_]+: /m` OR `<!-- adw-bot -->`). The refusal comment must avoid both markers.
- `adws/__tests__/triggerWebhook.test.ts` — **(modify)** Existing source-scan tests for the opened/comment catch blocks. Extend with an `issues.labeled`-not-handled guard.
- `.adw/scenarios.md` — **(read)** Per-issue scenarios live in `features/per-issue/feature-{N}.feature`; vocabulary registry at `features/regression/vocabulary.md`.
- `specs/prd/adw-init-hash-and-label-classification.md` — **(read)** Parent PRD; see "Label-based classification" and "Trigger plumbing" sections.
- `app_docs/feature-n9880l-adwversion-read-write-module.md` — **(read, background)** Conditional doc for the same parent PRD family (versioned auto-(re)init). Not modified by this issue, but included per `.adw/conditional_docs.md` since the task is part of the `adw-init-hash-and-label-classification.md` system; useful context only.

### New Files

- `adws/triggers/issueOpenedRouter.ts` — Pure routing decision + payload label extraction + DI-injected orchestration for the `issues.opened` label-routing branches. Exports `IssueOpenedRoute`, `decideIssueOpenedRoute`, `extractPayloadLabelNames`, `routeIssueOpened`, `IssueOpenedRouterDeps`, `buildDefaultIssueOpenedRouterDeps`, `MULTI_LABEL_REFUSAL_COMMENT`, and an `IssueOpenedOutcome` result type.
- `adws/triggers/__tests__/issueOpenedRouter.test.ts` — Vitest unit tests covering `decideIssueOpenedRoute` (all four branches + precedence), `extractPayloadLabelNames` (defensive cases), and `routeIssueOpened` (behavioral: which dep fires / what opts are passed per branch).
- `features/per-issue/feature-542.feature` — Per-issue BDD scenarios for the four routing branches (generated by the scenario phase; agent-input only, never executed by the runner).

## Implementation Plan

### Phase 1: Foundation
Make label readings available from a plain string-name array, and add the spawn-side seam that lets a caller (a) supply a known classification to skip the LLM and (b) request that an inferred classification be persisted as a label. These are the two primitives the router composes; doing them first keeps the router and trigger changes thin.

### Phase 2: Core Implementation
Create the pure routing module (`issueOpenedRouter.ts`): the four-branch decision, defensive payload-label extraction, the marker-free refusal comment, and the DI orchestration that maps each route to its side effect. Cover it with unit tests for all four branches.

### Phase 3: Integration
Wire the router into the `trigger_webhook.ts` `action === 'opened'` block, preserving auth-gate, cooldown, eligibility, and `AuthRequiredError` handling. Confirm `issues.labeled` remains unsubscribed (no new action branch; add a guard test). Validate the whole change with lint, type-check, unit tests, and the regression suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add a names-based reader to `labelManager`
- In `adws/github/labelManager.ts`, add an exported pure function `readAdwLabelNames(labelNames: readonly string[]): AdwLabelReading` containing the existing matching logic (opt-out detection, classification match, conflict when >1 classification label).
- Refactor `readAdwLabels(issue: Pick<GitHubIssue, 'labels'>)` to delegate: `return readAdwLabelNames(issue.labels.map(l => l.name));`. This must not change any existing observable behavior.
- In `adws/github/index.ts`, add `readAdwLabelNames` to the `from './labelManager'` re-export block.

### 2. Unit-test `readAdwLabelNames`
- In `adws/github/__tests__/labelManager.test.ts`, add a focused `describe('readAdwLabelNames')` block asserting parity with `readAdwLabels` for the key cases: zero labels, `adw:none` only, exactly one `adw:<type>`, two `adw:<type>` (conflict), `adw:<type>` + `adw:none` (opt-out wins), and non-adw labels ignored / exact-match only. Confirm existing `readAdwLabels` tests still pass.

### 3. Extend `classifyAndSpawnWorkflow` with a `labelRouting` seam
- In `adws/triggers/webhookGatekeeper.ts`, add an optional trailing parameter to `classifyAndSpawnWorkflow`:
  - `labelRouting?: { precomputedClassification?: IssueClassSlashCommand; issueTitle?: string; persistInferredLabel?: boolean }`.
- In the `spawn_fresh` path:
  - If `labelRouting?.precomputedClassification` is set, **skip** `classifyIssueForTrigger` and build the classification locally: `{ issueType: labelRouting.precomputedClassification, success: true, issueTitle: labelRouting.issueTitle }`. Otherwise call `classifyIssueForTrigger` as today.
  - Keep the existing "another ADW workflow started during classification" guard and the spawn-lock release semantics for both paths.
  - After spawning, if `labelRouting?.persistInferredLabel` is true **and** `classification.success` is true, resolve `issueTypeToAdwLabel(classification.issueType)` and, when non-null, call `applyLabel(issueNumber, label, resolvedRepoInfo)`. Wrap this in its own try/catch that logs at `warn` and never aborts — label persistence is best-effort and must not prevent the spawn-lock release or surface as a spawn failure.
- Import `applyLabel` and `issueTypeToAdwLabel` from `../github/labelManager` (or the `../github` barrel, consistent with existing imports), and `IssueClassSlashCommand` from `../types/issueTypes`.
- Do not change any of the four existing call sites (cron, two webhook, dependency-unblock) — the new argument is optional and omitted there.

### 4. Create the pure routing module `issueOpenedRouter.ts`
- Create `adws/triggers/issueOpenedRouter.ts`.
- Define the route type:
  - `export type IssueOpenedRoute = { kind: 'opt_out' } | { kind: 'conflict' } | { kind: 'classified'; classification: IssueClassSlashCommand } | { kind: 'infer' };`
- Implement `export function decideIssueOpenedRoute(reading: AdwLabelReading): IssueOpenedRoute` as a pure function with **opt-out precedence**:
  1. `reading.optOut` → `{ kind: 'opt_out' }` (wins even when a classification or conflict is also present).
  2. `reading.conflict` → `{ kind: 'conflict' }`.
  3. `reading.classification` (non-null) → `{ kind: 'classified', classification: reading.classification }`.
  4. otherwise → `{ kind: 'infer' }`.
- Implement `export function extractPayloadLabelNames(issue: Record<string, unknown> | undefined): string[]` — defensively read `issue?.labels`, accept only array entries that are objects with a string `name`, and return the names (drop anything malformed). Pure, no I/O.
- Add `export const MULTI_LABEL_REFUSAL_COMMENT: string` — a plain message asking the team to remove all but one `adw:<type>` label. It must NOT begin a line with `## :emoji:` and must NOT contain `<!-- adw-bot -->` (so `isAdwComment` returns false and `concurrencyGuard` does not count it). Use a `**bold**` lead line instead of an emoji heading.

### 5. Add the DI orchestration `routeIssueOpened`
- In `adws/triggers/issueOpenedRouter.ts`, define:
  - `export interface IssueOpenedRouterDeps { checkEligibility: (issueNumber, issueBody, repoInfo) => Promise<EligibilityResult>; classifyAndSpawn: (issueNumber, repoInfo, targetRepoArgs, labelRouting?) => Promise<void>; postComment: (issueNumber, body, repoInfo) => void; logger: (message, level?) => void; }`
  - `export type IssueOpenedOutcome = { status: 'opted_out' | 'refused_multi_label' | 'deferred' | 'spawned_classified' | 'spawned_inferred'; reason?: string };`
  - `export function buildDefaultIssueOpenedRouterDeps(): IssueOpenedRouterDeps` wiring `checkIssueEligibility`, a thin adapter `(n, r, a, lr) => classifyAndSpawnWorkflow(n, r, a, undefined, undefined, lr)`, `commentOnIssue`, and `log`. (The adapter hides the two unused positional `undefined`s behind the seam.)
  - `export async function routeIssueOpened(params: { issueNumber, issueBody, labelNames, repoInfo, targetRepoArgs }, deps = buildDefaultIssueOpenedRouterDeps()): Promise<IssueOpenedOutcome>`.
- `routeIssueOpened` logic:
  1. `const route = decideIssueOpenedRoute(readAdwLabelNames(labelNames));`
  2. `opt_out` → log "opted out via adw:none", return `{ status: 'opted_out' }`. No eligibility, no spawn, no comment.
  3. `conflict` → `deps.postComment(issueNumber, MULTI_LABEL_REFUSAL_COMMENT, repoInfo)`, log, return `{ status: 'refused_multi_label' }`. No spawn.
  4. `classified` / `infer` → run `deps.checkEligibility(...)`; if ineligible, log deferral and return `{ status: 'deferred', reason }`. If eligible:
     - `classified` → `deps.classifyAndSpawn(issueNumber, repoInfo, targetRepoArgs, { precomputedClassification: route.classification, issueTitle })`, return `{ status: 'spawned_classified' }`.
     - `infer` → `deps.classifyAndSpawn(issueNumber, repoInfo, targetRepoArgs, { persistInferredLabel: true })`, return `{ status: 'spawned_inferred' }`.
- Keep the function flat (guard-clause/early-return per branch, max ~2 nesting levels) per the coding guidelines. Thread `issueBody` through for the eligibility call and `issueTitle` (from the payload) for the classified adwId seed.

### 6. Unit-test the router module
- Create `adws/triggers/__tests__/issueOpenedRouter.test.ts`.
- `decideIssueOpenedRoute`: assert all four branch outputs, plus precedence — `adw:none`+`adw:bug` → `opt_out`; `adw:none`+`adw:bug`+`adw:feature` → `opt_out`; `adw:bug`+`adw:feature` → `conflict`.
- `extractPayloadLabelNames`: `undefined` issue → `[]`; missing/`null` `labels` → `[]`; mixed array with valid `{name}`, missing `name`, and non-object entries → only valid names returned.
- `routeIssueOpened` (inject `vi.fn()` deps):
  - **AC1** opt_out (`['adw:none']`): `classifyAndSpawn` not called, `postComment` not called, `checkEligibility` not called; status `opted_out`.
  - **AC3** conflict (`['adw:bug','adw:feature']`): `postComment` called once with `MULTI_LABEL_REFUSAL_COMMENT`; `classifyAndSpawn` not called; status `refused_multi_label`.
  - **AC2** classified (`['adw:bug']`, eligible): `classifyAndSpawn` called once with `labelRouting.precomputedClassification === '/bug'` and `issueTitle` set; `postComment` not called; status `spawned_classified`. Assert no LLM/classify dep is involved (the precomputed flag is the contract that skips it).
  - **AC4** infer (`[]`, eligible): `classifyAndSpawn` called once with `labelRouting.persistInferredLabel === true`; status `spawned_inferred`.
  - ineligible (classified or infer, `checkEligibility` → `{ eligible:false }`): `classifyAndSpawn` not called; status `deferred`.
- Assert `MULTI_LABEL_REFUSAL_COMMENT` does not match `/^## :[a-z_]+: /m` and does not contain `<!-- adw-bot -->` (guards the concurrency-count contract).

### 7. Wire the router into `trigger_webhook.ts`
- In the `action === 'opened'` block of `adws/triggers/trigger_webhook.ts`:
  - Keep the existing auth-gate check and `shouldTriggerIssueWorkflow` cooldown ahead of routing.
  - Inside the existing async IIFE, replace the direct eligibility-then-`classifyAndSpawnWorkflow` body with:
    - `const labelNames = extractPayloadLabelNames(issue);`
    - `await routeIssueOpened({ issueNumber, issueBody: (issue?.body as string) || '', labelNames, repoInfo: webhookRepoInfo, targetRepoArgs: webhookTargetRepoArgs });`
  - Preserve the surrounding `try/catch` that maps `AuthRequiredError` → `writeAuthGate(...)` and otherwise logs `"... Cron will retry."` at `error`. (`routeIssueOpened` calls `classifyAndSpawn`, which can throw `AuthRequiredError`; that must continue to set the auth gate.)
  - The synchronous `jsonResponse(res, 200, { status: 'processing', issue: issueNumber })` stays as the immediate HTTP response (routing remains fire-and-forget, matching today's behavior).
- Import `extractPayloadLabelNames` and `routeIssueOpened` from `./issueOpenedRouter`.
- Note: the `routeIssueOpened` default deps already run `checkIssueEligibility`, so remove the now-duplicated inline eligibility call from the opened block to avoid checking eligibility twice.

### 8. Confirm `issues.labeled` is not subscribed and guard it
- Verify the `event === 'issues'` block still handles only `action === 'closed'` and `action === 'opened'`, with every other action (including `'labeled'`) hitting the final `jsonResponse(res, 200, { status: 'ignored' })`. Do not add a `labeled` branch.
- In `adws/__tests__/triggerWebhook.test.ts`, add a guard test asserting the webhook source contains no handler keyed on `'labeled'` (e.g., `expect(source).not.toMatch(/action === ['"]labeled['"]/)`), documenting AC5 at the code level. (Webhook event subscription itself is configured on the GitHub side and is out of code scope.)

### 9. Generate / update BDD per-issue scenarios
- Ensure `features/per-issue/feature-542.feature` (created by the scenario phase) covers the four routing branches as agent-input scenarios tagged `@adw-542`: `adw:none` → no spawn/no comment; single `adw:bug` → routed without LLM; multiple `adw:*` → refusal comment, no spawn; no `adw:*` → LLM infers + label applied + spawn. Use phrases from `features/regression/vocabulary.md` where available.

### 10. Run the validation commands
- Run every command in the **Validation Commands** section and ensure each passes with zero errors and zero regressions. Fix any lint/type/test failures before considering the feature complete.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are part of this feature.

- **`readAdwLabelNames`** (`adws/github/__tests__/labelManager.test.ts`): parity with `readAdwLabels` across zero / `adw:none` / single / conflict / opt-out-wins / non-adw-ignored / exact-match-only. Existing `readAdwLabels` and `applyLabel`/`ensureAdwLabelsExist` tests must remain green (delegation is behavior-preserving).
- **`decideIssueOpenedRoute`** (`adws/triggers/__tests__/issueOpenedRouter.test.ts`): the four branches plus precedence ordering (`opt_out` over `conflict`/`classified`; `conflict` over `classified`).
- **`extractPayloadLabelNames`**: `undefined` issue, missing/`null`/non-array `labels`, and arrays with malformed entries all degrade to a clean `string[]`.
- **`routeIssueOpened`** (DI with `vi.fn()` stubs): one test per acceptance branch asserting which dependency fires and the exact `labelRouting` opts passed — covering AC1 (opt-out: nothing fires), AC2 (classified: `precomputedClassification` set, no comment, no LLM), AC3 (conflict: refusal comment, no spawn), AC4 (infer: `persistInferredLabel: true`), plus the ineligible → `deferred` case.
- **Refusal-comment marker guard**: assert `MULTI_LABEL_REFUSAL_COMMENT` is not detected by the `isAdwComment` patterns.
- **`issues.labeled` guard** (`adws/__tests__/triggerWebhook.test.ts`): source-scan assertion that no `action === 'labeled'` handler exists.
- Per the PRD testing decisions, changes to `trigger_webhook.ts`, `classifyAndSpawnWorkflow`, and `issueClassifier` are otherwise covered at the integration/BDD level rather than by isolating these I/O-bound modules (the deep-module/router unit tests above carry the branch-coverage contract).

### Edge Cases
- `adw:none` combined with a classification label (`adw:none` + `adw:bug`) → opt-out wins (no spawn, no comment).
- `adw:none` combined with conflicting labels (`adw:none` + `adw:bug` + `adw:feature`) → opt-out wins.
- `adw:upgrade` present alone (no classification label) → treated as zero classification labels → `infer` branch (it is not a classification label).
- Near-miss labels (`adw-bug`, `adwesome`, `adw:Bug` wrong case) → ignored; exact match only (delegated to #540 semantics).
- Payload with `labels` absent, `null`, empty, or containing malformed entries → treated as zero labels → `infer`.
- LLM classification returns `success: false` (defaults to `/feature`) on the `infer` path → label is **not** persisted (only persist on `success: true`), so a fallback default is not written back as if it were inferred.
- `applyLabel` throws on the `infer` path (e.g., persistent "not found") → logged at `warn`, spawn already launched, spawn-lock still released; no crash.
- A classified/infer issue that is ineligible (open dependencies or concurrency limit) → deferred, no spawn; refusal/opt-out branches are unaffected by eligibility.
- `classifyAndSpawn` throws `AuthRequiredError` during routing → auth gate is written and the handler exits cleanly (no spawn).
- `issues.labeled` event delivered (if ever configured upstream) → ignored by the fall-through; no spawn, no comment.

## Acceptance Criteria
- Issue opened with `adw:none` → no orchestrator spawned and no comment posted (`routeIssueOpened` returns `opted_out`; neither `classifyAndSpawn` nor `postComment` is called).
- Issue opened with exactly one `adw:<type>` label → the mapped orchestrator is spawned with `--issue-type` and **no LLM classification call is made** (`precomputedClassification` causes `classifyAndSpawnWorkflow` to skip `classifyIssueForTrigger`).
- Issue opened with multiple `adw:<type>` labels → a plain, marker-free refusal comment is posted asking for label cleanup and no orchestrator is spawned; the issue remains eligible for later CRON rescan.
- Issue opened with zero `adw:<type>` labels → the existing LLM classifier runs, the inferred `adw:<type>` label is persisted to the issue (on classification success), and the orchestrator is spawned.
- `issues.labeled` is not subscribed/handled — the webhook has no `labeled` action branch and late-added labels have no immediate effect (the source-scan guard test passes).
- Unit tests cover all four routing branches (opt-out, classified, conflict, infer) and pass.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and the `@regression` BDD suite all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — ensure dependencies are present.
- `bun run lint` — ESLint must pass with no errors.
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check passes (catches router/gatekeeper/labelManager type errors).
- `bun run test:unit` — full Vitest unit suite passes, including the new `issueOpenedRouter.test.ts`, the `readAdwLabelNames` additions to `labelManager.test.ts`, and the updated `triggerWebhook.test.ts`.
- `bun run build` — application builds with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression BDD suite passes (no regressions to trigger/webhook behavior).

## Notes
- **Coding guidelines**: `.adw/coding_guidelines.md` applies. Keep `issueOpenedRouter.ts` and the touched files under 300 lines, prefer pure functions (the decision and extraction are pure), isolate side effects behind the DI deps, and use guard clauses to keep nesting ≤2. The DI pattern intentionally mirrors `labelManager`'s `LabelManagerDeps` and the `cronIssueFilter.ts` extraction precedent.
- **No new dependencies** — this feature is pure composition of existing modules. (Library install command, if ever needed: `bun add <package>` per `.adw/commands.md`.)
- **Reuse, don't duplicate** — the spawn path deliberately routes through `classifyAndSpawnWorkflow` so the auth-gate / `evaluateCandidate` takeover / spawn-lock-release / "another ADW started" guards are exercised identically for label-routed and LLM-routed spawns.
- **Out of scope (separate PRD slices)**:
  - Deleting `extractAdwCommandFromText` / `classifyWithAdwCommand` and the `/adw_init` entries in the routing maps (PRD "Trigger plumbing" / "Files to delete"). This issue only *adds* label routing to `issues.opened`; the classifier internals are reused unchanged.
  - The CRON recovery layer scanning target repos for `adw:*`-labeled issues (PRD "CRON recovery layer"). Late-applied labels rely on it, but it is a different issue. This plan only ensures the refused/late-label issues *remain eligible* for that future scan.
  - Hash-based auto-(re)init (`hashComputer`, `adwVersion`, `upgradeClaim`, `adwUpgrade.tsx`) — other slices of the same parent PRD.
  - `ensureAdwLabelsExist` "on first webhook from any target repo" provisioning (PRD "Label lifecycle management") — `applyLabel` already lazy-creates a missing label on the `infer` path, which covers this issue's needs; bulk pre-provisioning is a separate concern.
- **Known race context** (memory): the cron+webhook duplicate-spawn race on transitions is an existing condition; this change does not worsen it — label routing sits in front of the same `classifyAndSpawnWorkflow` spawn gate, and the refusal/opt-out branches never spawn.
- **`adw:none` precedence** is a deliberate design choice: if a human applies both `adw:none` and a classification label, the explicit opt-out wins (the issue is skipped entirely), consistent with `readAdwLabels` returning `optOut: true` regardless of a co-present classification.
