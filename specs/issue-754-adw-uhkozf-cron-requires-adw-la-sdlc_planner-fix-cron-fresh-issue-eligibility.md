# Bug: Cron requires `adw:*` label to spawn fresh issues — #545 inverted the fresh-issue default

## Metadata
issueNumber: `754`
adwId: `uhkozf-cron-requires-adw-la`
issueJson: `{"number":754,"title":"Cron requires `adw:*` label to spawn fresh issues — #545 inverted the fresh-issue default","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-07-10T11:36:23Z"}` (full body in the GitHub issue; summarized in the sections below)

## Bug Description
Since #545 (commit `f7504771`, 2026-06-08), the CRON backlog sweeper **rejects** any fresh
(no-ADW-state) issue that lacks a single `adw:*` classification label, filtering it as
`no_adw_label` instead of spawning it.

- **Expected (pre-#545):** a fresh, unlabeled issue is unconditionally eligible for the backlog
  sweep and is LLM-classified at spawn time (the webhook opened-path and comment-path do the same —
  `adw:*` is a deterministic *override* of AI classification, not a *precondition* for pickup).
- **Actual (post-#545):** a fresh, unlabeled issue is filtered every 20s poll with reason
  `label:no_adw_label` and never spawns. It only becomes eligible once *something else*
  (the webhook's `issues.opened` AI-classifier) applies an `adw:*` label.

**Symptom / incident:** when the webhook process is down, the `issues.opened` classifier never
runs, so unlabeled issues strand indefinitely. On 2026-07-10, vestmatic-research #28 and #29 both
sat at `filtered: #N(label:no_adw_label)` on every poll while the webhook was dead; each needed a
manual hand-run.

## Problem Statement
`decideLabelRecovery` (`adws/triggers/cronLabelEligibility.ts:53`) treats `classification === null`
as a hard rejection (`no_adw_label`). This one guard conflates two genuinely-different cases:

1. **A truly-unlabeled issue** (no `adw:*` label at all) — which *should* be eligible and
   LLM-classified downstream. This is the bug: these issues strand.
2. **An issue carrying a reserved, non-classification `adw:*` label** (`adw:upgrade`,
   `adw:blocked`, `adw:unverified`) — which *should* stay out of the SDLC spawn loop.

The classification labels are only `adw:chore | adw:bug | adw:feature | adw:pr_review`
(`labelManager.ts:44-49`). Every other `adw:*` label reads as `classification === null`, so today
they are *all* filtered by the single `no_adw_label` guard — including `#UPG` tracking issues
(`adw:upgrade`).

The fix must restore eligibility for case (1) **without** regressing case (2).

## Solution Statement
Narrow the `classification === null` rejection in `decideLabelRecovery` so it fires **only when the
issue carries a reserved (non-classification) `adw:*` label**, and let truly-unlabeled fresh issues
fall through to the remaining guards and become eligible (with `classification` omitted → downstream
LLM classification, `labelRouting === undefined`).

Concretely:

- Add a `hasAdwLabel: boolean` signal to `decideLabelRecovery`, derived in `evaluateLabelRecovery`
  from the raw label names (`name.startsWith('adw:')`, matching the documented `adw:` namespace
  semantics — `adw-bug`/`adwesome` are not `adw:*`).
- Replace `if (reading.classification === null) → no_adw_label` with
  `if (reading.classification === null && hasAdwLabel) → reserved_label`. Because `opt_out`
  (`adw:none`) and the classification/`multi_label` guards are checked first, any `adw:*` label
  still present at this point is necessarily a reserved lane label (`adw:upgrade` / `adw:blocked` /
  `adw:unverified`).
- Rename the reason `no_adw_label` → `reserved_label` (the name now describes the surviving case
  accurately; a `#UPG` issue *has* a label). This keeps the code self-documenting and matches the
  established codebase meaning that these labels "are not ADW classification labels."
- Return `classification: reading.classification ?? undefined` on the eligible path (was
  `reading.classification`, which is now nullable and would otherwise violate the
  `classification?: string` result type and the "omit → LLM classifies" contract).

Every other guard is preserved **exactly**: `opt_out` (`adw:none`), `multi_label`/`conflict`,
`in_progress_comment`, `linked_closed_pr`, and the single-`adw:*`-label deterministic-routing path
(`precomputedClassification`, unchanged in `trigger_cron.ts:382-385`).

**No orchestrator wiring changes are needed.** `trigger_cron.ts:382-385` already sets
`labelRouting = undefined` when `classification` is null, so a now-eligible unlabeled issue is
automatically routed through `classifyAndSpawnWorkflow`'s LLM classifier. `evaluateLabelRecovery`'s
public signature `(issue, linkedPrs)` is unchanged, so the injection at `trigger_cron.ts:249` and
the gate at `cronIssueFilter.ts:171-175` are untouched.

## Steps to Reproduce
1. Ensure the webhook process is stopped (so no `issues.opened` AI-classifier runs).
2. Create a fresh GitHub issue in a cron-swept target repo with **no** `adw:*` label (e.g. only
   `bug` / `enhancement`, or no labels at all), no in-progress ADW comment, and no linked PR.
3. Let the cron backlog sweeper poll. Observe the log line:
   `POLL: N open, ... filtered: #<issue>(label:no_adw_label)` — the issue is never spawned.
4. Add any `adw:*` classification label (or restart the webhook so it classifies on open) and
   observe the issue then spawns — proving the label is being (wrongly) treated as a precondition.

**Unit-level reproduction (deterministic, no live cron):**
`evaluateLabelRecovery(makeIssue(['bug','enhancement']), [])` currently returns
`{ eligible: false, reason: 'no_adw_label' }`. Expected after fix:
`{ eligible: true, classification: undefined }`.

## Root Cause Analysis
- **Commit `f7504771` / issue #545 / PR #554** ("CRON recovery layer for label eligibility") was
  scoped in its PRD as an **additive** recovery scan for already-`adw:*`-labeled stranded issues
  (late-applied label, or a multi-label issue cleaned to one label). It was implemented as a
  **replacement** eligibility gate: the fresh-issue default flipped from
  `return { eligible: true, action: 'spawn' }` (pre-#545, unconditional) to
  "require a single `adw:*` label," via `cronLabelEligibility.ts:53`.
- The gate is **redundant with the stage it feeds** for the unlabeled case: the spawn path already
  LLM-classifies unlabeled issues (`trigger_cron.ts:382-385` → `labelRouting = undefined` →
  `classifyAndSpawnWorkflow` runs the classifier). The webhook opened-path/comment-path
  (`trigger_webhook.ts`) do the same. Cron is the only trigger that *requires* a label.
- **Why a blanket "remove line 53" is wrong (verified):** the same `no_adw_label` guard is the
  *sole* mechanism keeping `#UPG` upgrade-tracking issues (`adw:upgrade`) out of the standard
  candidate loop. `upgradeRedrive.ts:8-10` states this explicitly ("`adw:upgrade` is not an ADW
  classification label, so it reads as `no_adw_label` and is filtered out"), and its independent
  redrive scan (`trigger_cron.ts:293-302`) relies on `#UPG` issues *never appearing in
  `candidates`*. `fetchOpenIssues` (`trigger_cron.ts:80-91`) fetches all open issues including
  `adw:upgrade` (the redrive scan iterates that same list), and there is **no** upstream
  `adw:upgrade` exclusion in the cron filter path. Removing the guard unconditionally would make
  `#UPG` (and `adw:blocked`/`adw:unverified`) issues spawn-eligible → the standard loop would
  double-handle them and spawn a full SDLC workflow on an upgrade/terminal tracking issue. The fix
  therefore **narrows** the guard (reserved-label only) rather than deleting it.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/cronLabelEligibility.ts` — **the fix.** `decideLabelRecovery` (line 46) contains
  the inverted guard at line 53 and the eligible-path return at line 56; `evaluateLabelRecovery`
  (line 65) is the sole production caller and is where `hasAdwLabel` is derived. `LabelRecoveryReason`
  (line 17) and the precedence docstring (line 41-45) are updated here.
- `adws/triggers/__tests__/cronLabelEligibility.test.ts` — unit tests for `decideLabelRecovery` /
  `evaluateLabelRecovery`. Lines 54-58 and 152-156 currently encode the inverted (buggy) behavior
  and must be corrected; new tests add the reserved-label (`adw:upgrade`) regression guard and the
  truly-unlabeled → eligible RED→green case. All `decideLabelRecovery(...)` calls gain the new 4th
  argument.
- `adws/triggers/__tests__/cronIssueFilter.test.ts` — uses `no_adw_label` only as an arbitrary mock
  reason (lines 162, 170, 190) to test the `label:${reason}` propagation through `evaluateIssue`.
  These become type errors after the rename and must be updated to `reserved_label`.
- `adws/triggers/cronIssueFilter.ts` — read-only context. The label-recovery gate wiring
  (lines 168-177, fresh path `stage === null && adwId === null`) is **unchanged**; confirms the fix
  is transparent to the filter.
- `adws/triggers/trigger_cron.ts` — read-only context. Confirms: the LLM-classify path
  (lines 382-385, `labelRouting = undefined` when classification is null) needs no change; the
  `#UPG` redrive scan (lines 293-302) depends on the reserved-label filtering; the `fetchOpenIssues`
  fetch (lines 80-91) includes `adw:upgrade`. Line 295 has a comment referencing `no_adw_label`
  that should be updated for accuracy.
- `adws/triggers/upgradeRedrive.ts` — read-only context. Lines 8-10 document the `#UPG` →
  `no_adw_label` → filtered invariant this fix must preserve; the comment should be updated for
  accuracy.
- `adws/github/labelManager.ts` — read-only context. `ADW_CLASSIFICATION_LABELS` (line 44-49),
  `readAdwLabelNames` / `AdwLabelReading` (lines 75-96) define what `classification === null` means.
- `features/per-issue/feature-545.feature` — the #545 regression feature. Its scenario at
  lines 176-183 ("An open issue carrying no adw:* labels is not a recovery candidate") encodes the
  exact behavior #754 reverses and is driven by the function being changed; it must be updated to
  assert the corrected behavior (spawns, deferred to LLM). All other #545 scenarios are unaffected.

### New Files
- `features/per-issue/feature-754.feature` — `@adw-754` BDD scenarios driving the corrected decision
  in-process (per acceptance criteria): truly-unlabeled → eligible/spawns with no precomputed
  classification; `adw:upgrade` (reserved) → filtered (`reserved_label`); `adw:none` → `opt_out`;
  two labels → `multi_label`; in-progress comment → `in_progress_comment`; linked closed/merged PR →
  `linked_closed_pr`; single `adw:*` → routes deterministically.
- `features/per-issue/step_definitions/feature-754.steps.ts` — step definitions that call
  `evaluateLabelRecovery` / `decideLabelRecovery` directly and assert the returned decision
  (a runtime artifact, not source text — rot-prevention compliant). Uses phrasing **unique** to
  `@adw-754` (cucumber loads all per-issue step files globally, so it must not redefine phrases
  already registered by `feature-545.steps.ts`, e.g. "the issue {int} carries the labels {string}").

### Relevant documentation (conditional_docs matches)
- `app_docs/feature-9gjajh-cron-triggers.md` — owns `cronLabelEligibility.ts` / `cronIssueFilter.ts`
  / `trigger_cron.ts`; matched condition: "label eligibility for cron."
- `app_docs/feature-ni6fpk-serialize-overlapping-region-issues.md` — owns `cronIssueFilter.ts` /
  `trigger_cron.ts`; documents `evaluateIssue`/`filterEligibleIssues` (read-only here; the gate wiring
  is untouched).
- `feature-y35zbi-cron-recovery-label-eligibility-scan.md` — the #545 design doc referenced in
  `.adw/conditional_docs.md` (condition: "When working with `cronLabelEligibility.ts`
  (`decideLabelRecovery`, `evaluateLabelRecovery`)"). Physical file not present in this worktree;
  cited for provenance.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the target modules and confirm the current behavior
- Re-read `adws/triggers/cronLabelEligibility.ts` (whole file), the label-recovery gate in
  `adws/triggers/cronIssueFilter.ts` (lines 154-201), and `trigger_cron.ts:382-385` to confirm the
  eligible-with-null-classification path routes to the LLM classifier unchanged.
- Confirm no production caller of `decideLabelRecovery` other than `evaluateLabelRecovery`
  (`grep -rn "decideLabelRecovery" adws/triggers/*.ts` excluding `__tests__` → only line 72).

### 2. Add the failing unit test first (RED)
- In `adws/triggers/__tests__/cronLabelEligibility.test.ts`, add a `decideLabelRecovery` test:
  `classification: null`, clean signals, `hasAdwLabel = false` → `{ eligible: true }`, `reason`
  undefined, `classification` undefined.
- Add an `evaluateLabelRecovery` test: `makeIssue(['bug','enhancement'])` → `{ eligible: true }`,
  `classification` undefined (the incident case).
- Add the reserved-label regression guard: `evaluateLabelRecovery(makeIssue(['adw:upgrade']), [])`
  → `{ eligible: false, reason: 'reserved_label' }`.
- Run `bun run test:unit` and confirm these new assertions FAIL against the current code (the first
  two return `no_adw_label`; the third returns `no_adw_label`, not `reserved_label`). This is the RED.

### 3. Apply the core fix in `cronLabelEligibility.ts` (GREEN)
- Rename the `LabelRecoveryReason` union member `'no_adw_label'` → `'reserved_label'` (line 20).
- In `decideLabelRecovery` (line 46): add a 4th parameter `hasAdwLabel: boolean`.
- Replace line 53:
  `if (reading.classification === null) return { eligible: false, reason: 'no_adw_label' };`
  with:
  `if (reading.classification === null && hasAdwLabel) return { eligible: false, reason: 'reserved_label' };`
- Change the eligible-path return (line 56) to
  `return { eligible: true, classification: reading.classification ?? undefined };`
- In `evaluateLabelRecovery` (line 65-73): derive
  `const names = issue.labels.map((l) => l.name);` (reuse for both `readAdwLabelNames` and the new
  signal), `const hasAdwLabel = names.some((n) => n.startsWith('adw:'));`, and pass it as the 4th
  argument to `decideLabelRecovery`.
- Update the module docstring (lines 1-7) and the precedence docstring (lines 41-45) to read
  `opt_out → multi_label → reserved_label (non-classification adw:* label) → in_progress_comment →
  linked_closed_pr → eligible`, with a comment noting truly-unlabeled fresh issues are eligible and
  LLM-classified downstream (#754), while `adw:upgrade`/`adw:blocked`/`adw:unverified` stay filtered.
- Run `bun run test:unit` — the RED tests from step 2 now pass.

### 4. Correct the pre-existing tests that encoded the inverted behavior
- In `cronLabelEligibility.test.ts`:
  - Update every `decideLabelRecovery(...)` call to pass the new 4th argument `hasAdwLabel`
    (`false` for the classification-set / unlabeled cases; `true` for the reserved case).
  - Replace the old "no classification → no_adw_label" test (lines 54-58) with the reserved-label
    case: `decideLabelRecovery(reading({ classification: null }), false, false, true)` →
    `reserved_label`; keep/relocate the truly-unlabeled → eligible test added in step 2.
  - Replace the old "no adw:* labels → no_adw_label" `evaluateLabelRecovery` test (lines 152-156)
    with the corrected `{ eligible: true }` + `classification` undefined assertion (added in step 2).
- In `adws/triggers/__tests__/cronIssueFilter.test.ts`: replace the mock reason `'no_adw_label'` at
  lines 162 and 190, and the assertion `'label:no_adw_label'` at line 170, with `'reserved_label'` /
  `'label:reserved_label'`. (These tests exercise the `label:${reason}` propagation, not the
  decision logic; the rename keeps them type-correct.)
- Run `bun run test:unit` — all green, zero regressions.

### 5. Update the coupled #545 regression scenario
- In `features/per-issue/feature-545.feature`, update the scenario at lines 176-183 ("An open issue
  carrying no adw:* labels is not a recovery candidate"). It now contradicts #754. Change the
  section header and scenario title to reflect the corrected contract and change the `Then` from
  "spawned no orchestrator" to assert it now spawns deferred to the LLM classifier. Reuse the
  existing step "the cron recovery scan spawned an orchestrator for issue {int} classified as
  {string}" with classification `"unknown"` (the harness's marker for a null/deferred classification,
  set at `feature-545.steps.ts:233-235`). Add a one-line comment referencing #754 explaining the
  reversal. Do **not** touch any other #545 scenario or its step definitions.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-545"` — all #545 scenarios green.

### 6. Author the `@adw-754` BDD scenario + step definitions
- Create `features/per-issue/feature-754.feature` tagged `@adw-754` with scenarios covering the
  acceptance criteria (all asserting the decision output of the pure function — no source-text
  assertions):
  1. A fresh unlabeled issue (no `adw:*`, no `adw:none`, no in-progress comment, no linked PR) is
     eligible and carries no precomputed classification (→ LLM classifies).
  2. An `adw:upgrade` issue is filtered with reason `reserved_label` (the `#UPG` regression guard).
  3. `adw:none` → `opt_out`.
  4. Two `adw:*` classification labels → `multi_label`.
  5. A single `adw:*` label + in-progress ADW comment → `in_progress_comment`.
  6. A single `adw:*` label + linked merged/closed PR → `linked_closed_pr`.
  7. A single `adw:*` label, clean signals → eligible with that deterministic classification.
- Create `features/per-issue/step_definitions/feature-754.steps.ts` modeled on
  `feature-545.steps.ts`: a `@adw-754`-scoped `Before`/`After` resetting a local ctx (and setting a
  synthetic `mockContext` as in `feature-545.steps.ts:77-98` if a shared hook requires it), Given
  steps that seed labels/comments/linked-PRs into the local ctx using **unique** phrasing, a When
  step that calls `evaluateLabelRecovery` (and `decideLabelRecovery` where a scenario drives the
  pure decision directly), and Then steps asserting `eligible`, `reason`, and precomputed-vs-omitted
  `classification`. Do not redefine any Gherkin phrase already registered by `feature-545.steps.ts`.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-754"` — all green.

### 7. Update doc comments for accuracy (consistency)
- Update the comment at `adws/triggers/trigger_cron.ts:295` and the module comment at
  `adws/triggers/upgradeRedrive.ts:8-10` to say `reserved_label` instead of `no_adw_label` (the
  `#UPG`-stays-filtered invariant is unchanged; only the internal reason name changed). Leave
  `features/per-issue/feature-730.feature` prose as-is (a different issue's narrative; its
  conclusion — `#UPG` is filtered — remains true).

### 8. Run the full validation suite
- Execute every command in `## Validation Commands` and confirm all pass with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- **Reproduce (before fix, expect FAIL):** with the new/updated assertions in place but the
  `cronLabelEligibility.ts` fix reverted, `bun run test:unit` fails on the truly-unlabeled →
  eligible and `adw:upgrade` → `reserved_label` tests — demonstrating the RED.
- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Root type-check (catches the `reserved_label` rename ripple in
  `cronIssueFilter.test.ts` and the `classification ?? undefined` type-safety).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW package type-check.
- `bun run test:unit` — Unit tests: `cronLabelEligibility.test.ts` and `cronIssueFilter.test.ts`
  green (the truly-unlabeled → eligible RED→green case and the `adw:upgrade` → `reserved_label`
  regression guard), zero regressions across the suite.
- `bun run build` — Build to verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-754"` — the new per-issue BDD
  scenarios pass (drives the decision in-process).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-545"` — the updated #545 feature passes
  (proves the coupled scenario reversal is consistent and no other #545 scenario regressed).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite passes
  (confirms no broader BDD regression).

## Notes
- `.adw/coding_guidelines.md` was not found in this repo; no guideline-specific refactors are
  required. No new libraries are needed (install command would be `bun add <package>` per
  `.adw/commands.md`).
- **Scope discipline:** the entire behavioral fix is `adws/triggers/cronLabelEligibility.ts`. The
  orchestrator/filter wiring (`trigger_cron.ts`, `cronIssueFilter.ts`) is deliberately untouched —
  the fix is transparent to them because `evaluateLabelRecovery`'s signature is unchanged and
  `trigger_cron.ts:382-385` already handles the null-classification → LLM-classify path.
- **The load-bearing regression guard is `adw:upgrade`.** The single most important non-obvious fact:
  the `no_adw_label` guard doubles as the `#UPG` filter that `upgradeRedrive.ts` depends on. The
  `hasAdwLabel` narrowing preserves it, and the dedicated `adw:upgrade` → `reserved_label` unit test
  and `@adw-754` scenario lock it in. Do not "simplify" the guard back to a bare
  `classification === null` rejection or a bare removal.
- **First post-fix cron cycle (operational note, per issue):** existing unlabeled open issues become
  spawn candidates and get LLM-classified on the next sweep. The backlog is single-digit and this is
  accepted; apply `adw:none` to any existing issue that should not run.
- Out of scope: webhook/tunnel supervisor reliability (separate concern) and the #753
  dependency-unblock path (untouched).
- `reading.classification ?? undefined` is required (not just a removal of line 53): after the
  narrowing, `reading.classification` can be `null` on the eligible path, which would violate the
  `classification?: string` result type and the "omit → LLM classifies" contract.
