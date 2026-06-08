# Feature: CRON Recovery Layer for Label Eligibility

## Metadata
issueNumber: `545`
adwId: `y35zbi-cron-recovery-layer`
issueJson: `{"number":545,"title":"CRON recovery layer for label eligibility","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nExtend `trigger_cron.ts` to periodically scan known target repos for unprocessed `adw:*` issues. Eligibility rule: open issue with exactly one `adw:<type>` label, no `adw:none`, no in-progress ADW workflow comment, no linked merged/closed PR. Inherits the existing cron+webhook dedup primitive (orchestrator-existence check at spawn time).\n\nSee the \"CRON recovery layer\" section of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] Cron scan recognizes single-`adw:<type>` issues without orchestrator state as eligible\n- [ ] Cron scan skips issues with multiple `adw:<type>` labels\n- [ ] Cron scan skips issues with `adw:none`\n- [ ] Cron scan skips issues with an in-progress ADW workflow comment\n- [ ] Cron scan skips issues with a linked merged or closed PR\n- [ ] Dedup against existing orchestrator state prevents double-spawn (cron + webhook race)\n- [ ] Pre-existing stuck issues (multi-label cleaned up to single) auto-recover on next cron tick\n\n## Blocked by\n\n- Blocked by #540\n- Blocked by #542\n\n## User stories addressed\n\n- User story 15\n- User story 28","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:11:44Z","comments":[],"actionableComment":null}`

## Feature Description

This feature extends the CRON backlog sweeper (`adws/triggers/trigger_cron.ts`) with a **label-eligibility recovery layer**. Under the parent PRD (`specs/prd/adw-init-hash-and-label-classification.md`), classification moved from body-slash-commands to GitHub `adw:*` labels, and the webhook subscribes to `issues.opened` only. That leaves a gap: any issue whose classification label is applied *after* creation — or any issue that was refused at creation for having multiple `adw:<type>` labels and later cleaned up to a single label — would never be picked up, because no `issues.labeled` webhook fires.

The CRON recovery layer closes that gap. On each cron tick, the sweeper evaluates open issues that have **no orchestrator state** against a label-eligibility rule and spawns a workflow for those that qualify. A fresh issue (never processed — no ADW workflow comment, no state file, no `adwId`) is recovery-eligible when:

1. It carries **exactly one** `adw:<type>` classification label (`adw:chore`, `adw:bug`, `adw:feature`, `adw:pr_review`).
2. It does **not** carry `adw:none` (opt-out).
3. It has **no in-progress ADW workflow comment**.
4. It has **no linked merged or closed PR** (no `Implements #N` PR that is merged or `CLOSED`).

The recovery layer reuses the framework's existing dedup primitive — the spawn-time orchestrator-existence check (`evaluateCandidate` / `spawnGate`) — so a cron tick that races the webhook (or a previously-spawned orchestrator) can never double-spawn. The label gate is layered *in front of* that primitive and is deliberately scoped so it never interferes with the takeover-of-dead-orchestrator path.

The value: triagers can label an issue after it is opened, or fix a multi-label conflict, and ADW self-recovers on the next 20-second tick with zero manual re-creation of issues.

## User Story

**User story 15** — As the framework operator, I want issues that are stuck due to multi-label conflicts to self-recover when the labels are cleaned up, so that I do not have to delete-and-recreate broken issues.

**User story 28** — As the framework operator, I want the webhook to subscribe to `issues.opened` only and rely on the existing CRON recovery layer for late-applied labels, so that the trigger plumbing is minimal and recovery is unified with existing dependency-closure handling.

As the framework operator,
I want the cron sweeper to periodically scan for `adw:*`-labeled issues that have no orchestrator state and spawn the right workflow for the single-classification ones,
So that late-applied labels and cleaned-up multi-label conflicts are recovered automatically without re-creating issues, and without ever double-spawning against a running orchestrator.

## Problem Statement

After the label-classification cutover (issues #540, #542), the only invocation trigger for a new issue is the `issues.opened` webhook. The webhook reads the labels present *at creation* and routes accordingly (opt-out / classified / conflict / infer). It does **not** subscribe to `issues.labeled`. Consequently:

- An issue created with no `adw:*` label and later labeled `adw:feature` by a triager is never processed.
- An issue created with two `adw:<type>` labels is refused with a cleanup comment; once a human removes one label, nothing re-triggers it.

The cron sweeper (`trigger_cron.ts`) already re-scans open issues every 20 seconds, but its eligibility logic (`cronIssueFilter.evaluateIssue`) is **label-blind**: it treats *any* fresh issue (no `adwId`, no state) as spawn-eligible. Under the new label-based regime that is both too permissive (it would spawn zero-label issues the webhook intentionally left to inference, or opted-out issues) and incomplete (it has no notion of single-vs-multi `adw:<type>` label eligibility, nor of skipping issues whose work is already merged/closed).

## Solution Statement

Make the cron sweeper's **fresh-issue path** label-aware by introducing a small, pure, unit-tested eligibility module and wiring it into the existing filter — without disturbing the resume/takeover/merge paths and without replacing the spawn-time dedup primitive.

1. **Extract a shared linked-PR detector.** The "issue has a linked merged/closed PR" check already exists as a private helper inside `concurrencyGuard.ts`. Lift it (plus its `gh pr list --state all` fetch) into a new shared `adws/github/linkedPrDetector.ts`, refactor `concurrencyGuard.ts` to consume it (DRY), and give it dedicated tests.

2. **Add a pure label-recovery decision module** `adws/triggers/cronLabelEligibility.ts` (mirroring the established "pure decision + DI orchestration" pattern of `issueOpenedRouter.ts` and `cronIssueFilter.ts`). It composes the existing `readAdwLabelNames` (label semantics), `isAdwComment` (in-progress detection), and the new `hasLinkedMergedOrClosedPR` into a single `LabelRecoveryResult`.

3. **Gate the fresh-issue path in `cronIssueFilter.evaluateIssue`.** Add `labels` to `CronIssue` and an *optional, injected* label-recovery evaluator. The gate runs **only** when `resolution.stage === null` **and** `resolution.adwId === null` (i.e. a truly fresh issue with no ADW comment and no prior orchestrator). Issues that already carry an `adwId` skip the gate entirely and continue to the existing takeover machinery — this is what guarantees the dedup criterion and preserves dead-orchestrator reclaim.

4. **Wire it into `trigger_cron.ts`.** Fetch `labels` in the issue query, fetch the linked-PR list once per cycle, build the evaluator, and pass it through `filterEligibleIssues`. Filtered issues are annotated with a `label:<reason>` tag in the existing POLL log line for observability.

The spawn-time `evaluateCandidate` / `spawnGate` chain is left untouched and remains the authoritative double-spawn guard; the label gate is a cheap pre-filter that decides *which fresh, labeled issues are worth handing to that chain*.

## Relevant Files

Use these files to implement the feature:

- `adws/triggers/trigger_cron.ts` — The cron backlog sweeper. `fetchOpenIssues()` must add `labels` and `title` to its `gh issue list --json` query; `RawIssue` gains `labels` + `title`; `checkAndTrigger()` fetches the linked-PR list once per cycle, builds the label-recovery evaluator, threads it into `filterEligibleIssues`, and at the spawn site passes the label's classification to `classifyAndSpawnWorkflow` as `precomputedClassification`. **Primary integration point.**
- `adws/triggers/cronIssueFilter.ts` — Pure eligibility filter. `CronIssue` gains `labels` (and optional `title`); `evaluateIssue` and `filterEligibleIssues` gain an optional injected `labelRecovery` evaluator applied only on the truly-fresh (`stage === null && adwId === null`) branch. Keep under 300 lines.
- `adws/triggers/cronStageResolver.ts` — Already exposes `resolution.adwId` and `resolution.stage`; no change needed, but it is the source of the `adwId === null` signal that scopes the gate. Read for context.
- `adws/triggers/concurrencyGuard.ts` — Owns the private `hasLinkedMergedOrClosedPR` + `fetchPRsForRepo` helpers today. Refactor to import them from the new `linkedPrDetector.ts` (behavior-preserving extraction; removes duplication).
- `adws/github/labelManager.ts` — Source of `readAdwLabelNames(labelNames)` → `AdwLabelReading { optOut, classification, conflict }` and the `ADW_CLASSIFICATION_LABELS` / `ADW_NONE_LABEL` constants. Reused as-is; no change.
- `adws/triggers/issueOpenedRouter.ts` — The sibling webhook handler (issue #542). **Pattern reference** for the pure-decision + DI structure the new module mirrors. No change.
- `adws/triggers/webhookGatekeeper.ts` — Hosts `classifyAndSpawnWorkflow` and the spawn-lock release; the dedup primitive the recovery layer relies on. Read for context; no change.
- `adws/triggers/takeoverHandler.ts` — `evaluateCandidate` decision tree (`spawn_fresh` / `take_over_adwId` / `defer_live_holder` / `skip_terminal`); the authoritative spawn-time dedup. Read for context to confirm the gate must not intercept `adwId !== null` issues. No change.
- `adws/core/workflowCommentParsing.ts` — `isAdwComment(body)` (in-progress ADW comment detector), re-exported from `adws/core` and `adws/github`. Reused as-is; no change.
- `adws/github/index.ts` — Barrel that already re-exports `readAdwLabelNames`, `AdwLabelReading`, `isAdwComment`. Add a re-export for the new `linkedPrDetector` surface.
- `adws/types/issueTypes.ts` — `GitHubLabel`, `IssueClassSlashCommand`. Reused for typing; no change expected.
- `.adw/commands.md` — Source of the validation commands (lint, type-check, unit test, build, BDD).
- `.adw/scenarios.md` — Per-issue BDD scenario directory configuration (`features/per-issue/feature-545.feature`, tag `@adw-545`).

### New Files

- `adws/github/linkedPrDetector.ts` — Shared linked-PR detection. Exports `LinkedPRRef { number; body; state; mergedAt }`, the pure `hasLinkedMergedOrClosedPR(issueNumber, prs)`, and the I/O `fetchLinkedPRs(repoInfo)` (`gh pr list --state all --json number,body,state,mergedAt --limit 200`). Consumed by both `concurrencyGuard.ts` and `cronLabelEligibility.ts`.
- `adws/triggers/cronLabelEligibility.ts` — Pure label-recovery decision module. Exports `LabelRecoveryReason`, `LabelRecoveryResult`, the pure `decideLabelRecovery(reading, hasInProgressComment, hasLinkedClosedPR)`, the `LabelRecoveryIssue` input shape, and the composing `evaluateLabelRecovery(issue, linkedPrs)`.
- `adws/github/__tests__/linkedPrDetector.test.ts` — Vitest unit tests for `hasLinkedMergedOrClosedPR` (merged / closed / open-not-eligible / unlinked / number-boundary cases).
- `adws/triggers/__tests__/cronLabelEligibility.test.ts` — Vitest unit tests for `decideLabelRecovery` (all five ineligible reasons + eligible) and `evaluateLabelRecovery` (composition over a real issue + PR list).
- `features/per-issue/feature-545.feature` — Per-issue BDD scenarios (`@adw-545`) covering the recovery branches. Authored by the scenario phase of the ADW pipeline; listed here so the implementation aligns with it.

### Conditional Docs

Per `.adw/conditional_docs.md`, consult these during implementation:

- `app_docs/feature-25daxp-label-manager-deep-module.md` — `readAdwLabels` / `readAdwLabelNames` semantics and the `adw:*` label model (this feature wires `readAdwLabelNames` into the CRON recovery scan).
- `app_docs/feature-gmfhco-issues-opened-label-routed-handler.md` — The `issues.opened` label router (issue #542); the immediate predecessor and the structural pattern this module mirrors. Explicitly defers "CRON recovery layer for late-applied labels" to this issue.
- `app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md` — The cross-trigger spawn-dedup primitive (`spawnGate`, `classifyAndSpawnWorkflow`) the recovery layer inherits for double-spawn protection.
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` and `app_docs/feature-nq7174-discarded-workflow-stage-foundation.md` — `cronIssueFilter.evaluateIssue` / `cronStageResolver` stage semantics being extended.
- `app_docs/feature-ak5lea-trigger-cron-process-prevent-duplicate-cron.md` — `trigger_cron.ts` structure and lifecycle.

## Implementation Plan

### Phase 1: Foundation — shared linked-PR detector

Extract the "issue has a linked merged/closed PR" logic out of `concurrencyGuard.ts` into a shared, tested module so both the concurrency counter and the new recovery gate use one implementation.

- Create `adws/github/linkedPrDetector.ts` with `LinkedPRRef`, the pure `hasLinkedMergedOrClosedPR`, and the I/O `fetchLinkedPRs`.
- Harden the link match against the latent substring bug (`Implements #1` must not match `Implements #12`) using a digit-boundary regex — a strictly-more-correct, behavior-improving extraction.
- Refactor `concurrencyGuard.ts` to import from the new module and delete its private copies.
- Re-export the new surface from `adws/github/index.ts`.

### Phase 2: Core Implementation — pure label-recovery module + filter gate

- Create `adws/triggers/cronLabelEligibility.ts`: a pure `decideLabelRecovery` that encodes all five rules in precedence order (opt-out → multi-label → no-label → in-progress-comment → linked-closed-PR → eligible), plus a composing `evaluateLabelRecovery` that derives the three signals from an issue + the cycle's PR list using `readAdwLabelNames`, `isAdwComment`, and `hasLinkedMergedOrClosedPR`.
- Extend `cronIssueFilter.ts`: add `labels` to `CronIssue`; add an optional `labelRecovery` evaluator param to `evaluateIssue` and `filterEligibleIssues`; apply it **only** when `stage === null && resolution.adwId === null`, returning `{ eligible: false, reason: 'label:<reason>' }` on rejection. When the evaluator is omitted (e.g. existing unit tests), behavior is unchanged.

### Phase 3: Integration — wire into the cron sweeper

- Extend `fetchOpenIssues()` and `RawIssue` in `trigger_cron.ts` to include `labels` and `title`.
- In `checkAndTrigger()`, fetch the linked-PR list once per cycle via `fetchLinkedPRs(cronRepoInfo)`, build `const labelRecovery = (issue) => evaluateLabelRecovery(issue, linkedPrs)`, and pass it to `filterEligibleIssues`.
- **Route recovered issues deterministically by their label.** At the `spawn_fresh` spawn site, derive the classification from the issue's labels (`readAdwLabelNames(issue.labels.map(l => l.name)).classification`) and pass it to `classifyAndSpawnWorkflow` as the 6th `labelRouting` argument (`{ precomputedClassification, issueTitle }`) when non-null. This matches the webhook's `classified` branch (issue #542) and honors the PRD's label-first principle (user stories 6/19) — a recovered `adw:bug` issue runs the bug workflow, it does not re-enter the LLM classifier. When the label read yields no classification (e.g. a dead-orchestrator `spawn_fresh` with no label), omit `labelRouting` and preserve today's LLM-classify fallback. `persistInferredLabel` is **not** set — the label already exists on a recovery-eligible issue.
- The existing POLL log line already prints `filteredAnnotations`; the new `label:<reason>` tags surface there for observability.
- Confirm the merge / retriable / awaiting_merge / takeover paths are untouched (all have non-null stage or non-null `adwId`; the `take_over_adwId` branch spawns via `spawnDetached`, not `classifyAndSpawnWorkflow`, so it is unaffected by the new `labelRouting` argument).

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1: Create the shared linked-PR detector module

- Create `adws/github/linkedPrDetector.ts`.
- Define `export interface LinkedPRRef { readonly number: number; readonly body: string; readonly state: string; readonly mergedAt: string | null }`.
- Implement `export function hasLinkedMergedOrClosedPR(issueNumber: number, prs: readonly LinkedPRRef[]): boolean` — returns true when any PR's body references `Implements #<issueNumber>` (matched with a trailing non-digit boundary so `#1` does not match `#12`) **and** the PR is merged (`mergedAt != null`) or `state === 'CLOSED'`.
- Implement `export function fetchLinkedPRs(repoInfo: RepoInfo): LinkedPRRef[]` — runs `gh pr list --repo <owner>/<repo> --state all --json number,body,state,mergedAt --limit 200`, parses JSON, and returns `[]` on error (log at `error`), mirroring the current `concurrencyGuard.fetchPRsForRepo`.
- Keep the file focused and well under 300 lines; isolate the `execSync` side effect at the boundary.

### Step 2: Refactor `concurrencyGuard.ts` to consume the shared module

- Remove the private `RawPR` interface, `fetchPRsForRepo`, and `hasLinkedMergedOrClosedPR` from `concurrencyGuard.ts`.
- Import `fetchLinkedPRs` and `hasLinkedMergedOrClosedPR` (and `LinkedPRRef` if needed) from `../github/linkedPrDetector` (or the `../github` barrel).
- Update `getInProgressIssueCount` to call `fetchLinkedPRs(repoInfo)` and the shared predicate. Behavior must be identical (modulo the `#1`/`#12` boundary hardening, which is a correctness improvement).

### Step 3: Export the new surface from the GitHub barrel

- Add `linkedPrDetector` exports (`hasLinkedMergedOrClosedPR`, `fetchLinkedPRs`, `type LinkedPRRef`) to `adws/github/index.ts`, following the existing barrel grouping/style.

### Step 4: Create the pure label-recovery decision module

- Create `adws/triggers/cronLabelEligibility.ts`.
- Define `export type LabelRecoveryReason = 'opt_out' | 'multi_label' | 'no_adw_label' | 'in_progress_comment' | 'linked_closed_pr'`.
- Define `export interface LabelRecoveryResult { readonly eligible: boolean; readonly reason?: LabelRecoveryReason }`.
- Implement the **pure** `export function decideLabelRecovery(reading: AdwLabelReading, hasInProgressComment: boolean, hasLinkedClosedPR: boolean): LabelRecoveryResult` using guard clauses in precedence order: `optOut` → `opt_out`; `conflict` → `multi_label`; `classification === null` → `no_adw_label`; `hasInProgressComment` → `in_progress_comment`; `hasLinkedClosedPR` → `linked_closed_pr`; else `{ eligible: true }`.
- Define `export interface LabelRecoveryIssue { readonly number: number; readonly labels: readonly { name: string }[]; readonly comments: readonly { body: string }[] }`.
- Implement `export function evaluateLabelRecovery(issue: LabelRecoveryIssue, linkedPrs: readonly LinkedPRRef[]): LabelRecoveryResult` that composes: `readAdwLabelNames(issue.labels.map(l => l.name))`, `issue.comments.some(c => isAdwComment(c.body))`, `hasLinkedMergedOrClosedPR(issue.number, linkedPrs)`, then delegates to `decideLabelRecovery`.
- Import `readAdwLabelNames` + `AdwLabelReading` from `../github` (or `../github/labelManager`), `isAdwComment` from `../core`, and `hasLinkedMergedOrClosedPR` + `LinkedPRRef` from `../github/linkedPrDetector`.

### Step 5: Extend `cronIssueFilter.ts` with the label-recovery gate

- Add `readonly labels: readonly { name: string }[]` to the `CronIssue` interface.
- Add a trailing optional parameter `labelRecovery?: (issue: CronIssue) => LabelRecoveryResult` to `evaluateIssue` (after `cancelledThisCycle`).
- In the `stage === null` branch, before returning eligible, apply the gate **only when** `resolution.adwId === null && labelRecovery`: if the result is ineligible, return `{ eligible: false, reason: \`label:${result.reason}\` }`; otherwise fall through to `{ eligible: true, action: 'spawn' }`. Issues with a non-null `adwId` must bypass the gate and reach the existing takeover machinery unchanged.
- Add the same trailing optional `labelRecovery` parameter to `filterEligibleIssues` and thread it into the `evaluateIssue` call.
- Import the `LabelRecoveryResult` type from `./cronLabelEligibility`.
- Keep `cronIssueFilter.ts` under 300 lines.

### Step 6: Wire the gate into the cron sweeper

- In `adws/triggers/trigger_cron.ts`, add `labels: { name: string }[]` and `title: string` to the `RawIssue` interface, and add an optional `title?: string` to `CronIssue` in `cronIssueFilter.ts` (the cron passes its `RawIssue` objects straight through as `CronIssue`).
- Update `fetchOpenIssues()` to request `labels` and `title` in the `--json` field list (`number,title,body,comments,createdAt,updatedAt,labels`).
- In `checkAndTrigger()`, after `fetchOpenIssues()`, fetch the linked-PR list once: `const linkedPrs = fetchLinkedPRs(cronRepoInfo)`.
- Build `const labelRecovery = (issue: CronIssue) => evaluateLabelRecovery(issue, linkedPrs)` and pass it as the new trailing argument to `filterEligibleIssues(...)`.
- At the `spawn_fresh` spawn site, compute `const reading = readAdwLabelNames(issue.labels.map(l => l.name))` and `const labelRouting = reading.classification ? { precomputedClassification: reading.classification, issueTitle: issue.title } : undefined;`, then call `classifyAndSpawnWorkflow(issue.number, repoInfo, targetRepoArgs, adwId, takeoverDecision, labelRouting)`.
- Import `fetchLinkedPRs` from `../github`, `evaluateLabelRecovery` from `./cronLabelEligibility`, `readAdwLabelNames` from `../github`; import the `CronIssue` type where needed for the closure annotation.
- Verify nothing else in the candidate loop needs changes — `merge`, takeover (`take_over_adwId` via `spawnDetached`), and dependency/concurrency checks are unaffected.

### Step 7: Unit tests for the linked-PR detector

- Create `adws/github/__tests__/linkedPrDetector.test.ts`.
- Cover `hasLinkedMergedOrClosedPR`: linked + merged → true; linked + `CLOSED` → true; linked + `OPEN` (not merged) → false; not linked → false; multiple PRs where only an unrelated one is closed → false; number-boundary (`Implements #1` must not match an issue `#12` and vice versa) → correct.

### Step 8: Unit tests for the label-recovery module

- Create `adws/triggers/__tests__/cronLabelEligibility.test.ts`.
- Cover `decideLabelRecovery` precedence: opt-out wins over a classification; conflict → `multi_label`; no classification → `no_adw_label`; single classification + in-progress comment → `in_progress_comment`; single classification + linked closed PR → `linked_closed_pr`; single classification, clean → `{ eligible: true }`.
- Cover `evaluateLabelRecovery` composition: a fresh single-`adw:feature` issue with no ADW comment and an empty/unrelated PR list → eligible; the same issue with an ADW workflow comment → `in_progress_comment`; with `adw:none` added → `opt_out`; with a second `adw:<type>` label → `multi_label`.

### Step 9: Extend `cronIssueFilter` tests for the gate

- In `adws/triggers/__tests__/cronIssueFilter.test.ts`, add a `describe` block for the label-recovery gate.
- Update the local `makeIssue` helper to include a `labels` field (default `[]`).
- Assert: `stage === null` + `adwId === null` + an ineligible evaluator → filtered with `reason` starting `label:` and not in the eligible list; `stage === null` + `adwId === null` + eligible evaluator → `{ eligible: true, action: 'spawn' }`; `stage === null` + **non-null** `adwId` → gate **not** consulted (evaluator is a spy asserted not called) and the issue stays eligible for takeover; omitting the evaluator entirely → legacy behavior preserved (existing tests still green).

### Step 10: Run the validation commands

- Run every command in the `Validation Commands` section below and confirm all pass with zero regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope (Vitest, `bun run test:unit`). Per the parent PRD's testing philosophy, unit tests target the **deep modules** with real inputs and real outputs; `trigger_cron.ts` wiring is validated at the integration/BDD level (unit-testing it would duplicate the deep-module tests).

- **`linkedPrDetector.test.ts`** — pure `hasLinkedMergedOrClosedPR` over a hand-built `LinkedPRRef[]`: merged-link true, closed-link true, open-link false, unlinked false, and the `#1`/`#12` digit-boundary case. The `fetchLinkedPRs` I/O wrapper is not unit-tested in isolation (thin `execSync` shell).
- **`cronLabelEligibility.test.ts`** — pure `decideLabelRecovery` precedence matrix (all five reasons + eligible) and `evaluateLabelRecovery` composition over a real issue object + PR list. No mocking of internals; feed `AdwLabelReading`-producing label arrays and assert the `LabelRecoveryResult`.
- **`cronIssueFilter.test.ts`** (extended) — the gate is applied on the fresh path only when `adwId === null`; a `vi.fn()` evaluator asserts call/no-call per branch and the `label:<reason>` annotation surfaces in `filteredAnnotations`.

### Edge Cases

- **Late-applied single label** — issue opened with no label (left to webhook inference), later labeled `adw:bug`; next cron tick: fresh, single classification, no comment, no PR → eligible → spawn.
- **Multi-label cleaned to single** — issue refused at `issues.opened` for two `adw:<type>` labels; a human removes one; next tick: `conflict` is now false → eligible (acceptance criterion: auto-recover).
- **`adw:none` precedence** — `adw:none` + `adw:feature` together → `opt_out` wins → never spawned.
- **`adw:upgrade` only** — not a classification label → `classification === null` → `no_adw_label` → skipped (upgrade issues are driven by `adwUpgrade`, not the recovery scan).
- **In-progress workflow comment, state unreadable (cron+webhook race window)** — issue has an ADW workflow comment so `resolveIssueWorkflowStage` returns a non-null `adwId`; the label gate is bypassed and the issue flows to `evaluateCandidate`, which defers to the live holder or takes over a dead one — never a fresh double-spawn.
- **Work already merged/closed** — a fresh, labeled issue whose `Implements #N` PR is merged or closed → `linked_closed_pr` → skipped (no redundant re-spawn).
- **Number-substring collision** — `Implements #1` in a closed PR body must not mark issue `#12` ineligible (digit-boundary match).
- **Labels absent on repo** — reading labels that don't exist yields zero matches → `no_adw_label` → skipped (the scan is read-only; provisioning is the webhook's job and out of scope here).
- **Resume/merge paths unaffected** — `abandoned` (retriable), `awaiting_merge` (merge), and active stages all have non-null stage and are never routed through the label gate.

## Acceptance Criteria

- Cron scan recognizes a fresh single-`adw:<type>` issue (no orchestrator state, no `adwId`) as eligible and spawns the workflow mapped to that label deterministically (via `precomputedClassification`), without re-running the LLM classifier.
- Cron scan skips issues with multiple `adw:<type>` labels (`multi_label`).
- Cron scan skips issues with `adw:none` (`opt_out`), even when a classification label is also present.
- Cron scan skips fresh issues with an in-progress ADW workflow comment (`in_progress_comment`), and the dedup is ultimately enforced by the spawn-time `evaluateCandidate` / `spawnGate` primitive for the race window.
- Cron scan skips issues with a linked merged or closed PR (`linked_closed_pr`).
- Dedup against existing orchestrator state prevents double-spawn on the cron + webhook race: issues carrying an `adwId` bypass the label gate and are handled by the takeover machinery; truly-fresh issues that lose the spawn-lock race are deferred.
- A pre-existing stuck issue whose labels are cleaned up from multiple `adw:<type>` to one becomes eligible and is spawned on the next cron tick, with no state surgery.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `bun run build`, and the `@regression` BDD suite all pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun run lint` — ESLint; zero errors.
- `bunx tsc --noEmit` — root type-check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check (catches the new modules, the `CronIssue.labels` change, and the threaded evaluator param); zero errors.
- `bun run test:unit` — Vitest; all suites pass, including the new `linkedPrDetector`, `cronLabelEligibility`, and extended `cronIssueFilter` tests.
- `bun run build` — `tsc` build; succeeds with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-545"` — per-issue BDD scenarios for the recovery branches pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression suite passes (no cron/spawn/dedup regressions).

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): keep modules single-responsibility and under 300 lines; favor guard clauses over nested conditionals (the `decideLabelRecovery` precedence chain is written as sequential guards); isolate `execSync` side effects at module boundaries; prefer pure functions (`decideLabelRecovery`, `hasLinkedMergedOrClosedPR`, `evaluateLabelRecovery` are pure); no decorators. The Phase 1 extraction of `hasLinkedMergedOrClosedPR` from `concurrencyGuard.ts` is an explicit DRY/refactor-as-you-go application of the guidelines.
- **No new libraries.** Everything reuses existing modules (`labelManager`, `workflowCommentParsing`, `cronStageResolver`, `takeoverHandler`) and the `gh` CLI. If a package were ever needed, the install command per `.adw/commands.md` is `bun add <package>` — not required here.
- **Dedup is layered, not replaced.** The label gate is a cheap pre-filter; the authoritative double-spawn guard remains the spawn-time `evaluateCandidate` / `spawnGate` chain. The gate is deliberately scoped to `resolution.adwId === null` so it can never short-circuit the takeover-of-dead-orchestrator path — a subtle but load-bearing constraint that the `cronIssueFilter` tests pin down.
- **Why the gate lives in `evaluateIssue`.** `evaluateIssue` already computes `resolution` (hence `adwId` and `stage`), so it is the single place that can correctly distinguish "truly fresh" from "has prior orchestrator." A separate post-filter pass would have to re-resolve state to recover that signal. Threading an *optional injected* evaluator keeps the function pure and leaves existing call sites/tests untouched.
- **Deterministic label routing at spawn.** The recovery layer reuses the `labelRouting` seam #542 added to `classifyAndSpawnWorkflow`, passing the label's `precomputedClassification` so the recovered issue runs the labeled workflow without an LLM round-trip — the cron recovery path mirrors the webhook's `classified` branch. The label gate (`evaluateLabelRecovery`) and the spawn-site routing both read labels through the same `readAdwLabelNames`, so the eligibility decision and the routing decision can never disagree.
- **One PR fetch per cycle.** `fetchLinkedPRs` is called once per `checkAndTrigger` tick and shared across all candidates, rather than per-issue. (The existing per-candidate `isConcurrencyLimitReached` PR fetch is pre-existing and out of scope; a future cleanup could share one fetch across both, but that is not required here.)
- **Substring hardening.** The original `hasLinkedMergedOrClosedPR` used a bare `body.includes("Implements #N")`, which matches `#1` inside `#12`. The extraction adds a digit-boundary guard — strictly more correct and benefiting `concurrencyGuard` as well. This is an intentional, low-risk behavior improvement noted for the reviewer.
- **Out of scope** (per parent PRD and issue #542 hand-off): `issues.labeled` webhook subscription; bulk `ensureAdwLabelsExist` provisioning from the cron; LLM inference on the cron recovery path (cron recovery is single-explicit-label only — zero-label inference stays at `issues.opened`); migration of pre-existing body-slash-command issues.
- **Known narrow interaction.** A zero-label issue that the webhook deferred for open dependencies (and therefore never had an inferred label persisted) will not be picked up by the label-driven cron recovery until it carries a classification label. This is consistent with the PRD's label-first model and is not addressed here.
