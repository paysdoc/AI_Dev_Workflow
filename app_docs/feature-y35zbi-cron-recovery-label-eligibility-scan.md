# CRON Recovery Layer: Label Eligibility Scan

**ADW ID:** y35zbi-cron-recovery-layer
**Date:** 2026-06-08
**Specification:** specs/issue-545-adw-y35zbi-cron-recovery-layer-sdlc_planner-label-eligibility-scan.md

## Overview

Extends the CRON backlog sweeper (`trigger_cron.ts`) with a label-eligibility recovery layer that closes the gap left by the `issues.opened`-only webhook. Issues that receive an `adw:<type>` classification label after creation — or multi-label conflicts cleaned up to a single label — are now automatically picked up on the next 20-second cron tick without manual intervention.

## What Was Built

- **`adws/github/linkedPrDetector.ts`** — Shared module for detecting whether an issue has a linked merged or closed PR. Extracted from `concurrencyGuard.ts` with a digit-boundary fix (`#1` no longer matches `#12`).
- **`adws/triggers/cronLabelEligibility.ts`** — Pure label-recovery decision module. Evaluates five eligibility rules in precedence order and returns a typed `LabelRecoveryResult`.
- **Extended `adws/triggers/cronIssueFilter.ts`** — Added `labels` field to `CronIssue` and an optional injected `labelRecovery` evaluator, applied only on the truly-fresh path (`stage === null && adwId === null`).
- **Extended `adws/triggers/trigger_cron.ts`** — Fetches `labels`/`title` per issue, fetches linked PRs once per cycle, builds and passes the label-recovery evaluator, and routes recovered issues via `precomputedClassification` (skipping the LLM classifier).
- **`adws/github/linkedPrDetector.test.ts`** — Unit tests for `hasLinkedMergedOrClosedPR` including the digit-boundary case.
- **`adws/triggers/__tests__/cronLabelEligibility.test.ts`** — Unit tests for `decideLabelRecovery` precedence matrix and `evaluateLabelRecovery` composition.
- **Extended `adws/triggers/__tests__/cronIssueFilter.test.ts`** — Tests for the label-recovery gate: ineligible evaluator filters, eligible pass-through, `adwId !== null` bypass, and legacy-mode (no evaluator) preservation.
- **`features/per-issue/feature-545.feature`** and **`features/per-issue/step_definitions/feature-545.steps.ts`** — BDD scenarios and step definitions for the recovery branches.

## Technical Implementation

### Files Modified

- `adws/github/linkedPrDetector.ts` *(new)* — `LinkedPRRef` interface, pure `hasLinkedMergedOrClosedPR` (digit-boundary regex), I/O `fetchLinkedPRs` (execSync wrapper)
- `adws/github/index.ts` — Added re-exports for the new `linkedPrDetector` surface
- `adws/triggers/cronLabelEligibility.ts` *(new)* — `LabelRecoveryReason`, `LabelRecoveryResult`, `LabelRecoveryIssue`, pure `decideLabelRecovery`, composing `evaluateLabelRecovery`
- `adws/triggers/cronIssueFilter.ts` — Added `labels`/`title` to `CronIssue`; threaded optional `labelRecovery` param into `evaluateIssue` and `filterEligibleIssues`
- `adws/triggers/trigger_cron.ts` — Added `labels`/`title` to `RawIssue`; extended `--json` query; added `fetchLinkedPRs` call + `labelRecovery` closure per cycle; `precomputedClassification` routing at the `spawn_fresh` site
- `adws/triggers/concurrencyGuard.ts` — Refactored to import `fetchLinkedPRs`/`hasLinkedMergedOrClosedPR` from `linkedPrDetector` (DRY, removes duplicated private helpers)

### Key Changes

- **Five-rule eligibility gate** in `decideLabelRecovery`, evaluated in strict precedence: `opt_out` → `multi_label` → `no_adw_label` → `in_progress_comment` → `linked_closed_pr` → eligible.
- **Gate scoped to truly-fresh issues only** (`resolution.adwId === null`). Issues with a prior `adwId` bypass the gate entirely and proceed to the existing `evaluateCandidate` takeover machinery — the double-spawn guard is preserved.
- **One PR list fetch per cron cycle** (`fetchLinkedPRs(cronRepoInfo)` called once in `checkAndTrigger`), shared across all candidates.
- **Deterministic label routing at spawn** — `readAdwLabelNames` derives the classification from issue labels; when non-null, it is passed as `precomputedClassification` to `classifyAndSpawnWorkflow`, bypassing the LLM classifier.
- **Digit-boundary hardening** — `hasLinkedMergedOrClosedPR` uses `/Implements #N(?!\d)/` so `Implements #1` does not match issue `#12`. This improvement also benefits `concurrencyGuard` via the shared module.

## How to Use

The recovery layer is fully automatic — no configuration is required.

1. Open a GitHub issue in the target repo. If it has no `adw:<type>` label at creation, the webhook leaves it for inference (existing behaviour unchanged).
2. A triager (or automation) applies a single `adw:<type>` label (e.g. `adw:feature`) after creation.
3. Within 20 seconds, the next cron tick evaluates the issue via `evaluateLabelRecovery`. If it passes all five rules, `filterEligibleIssues` marks it eligible with `action: 'spawn'`.
4. The cron sweeper spawns the correct orchestrator (bug, feature, chore, pr_review) determined by the label — no LLM classification round-trip.
5. Multi-label conflicts: once a human removes duplicate `adw:<type>` labels down to one, the issue auto-recovers on the next tick.

## Configuration

No new configuration is required. The feature inherits all existing cron settings (`POLL_INTERVAL_MS = 20_000`, `cronRepoInfo`, etc.) and the `adw:*` label model defined in `adws/github/labelManager.ts`.

## Testing

```bash
# Unit tests (linkedPrDetector, cronLabelEligibility, cronIssueFilter gate)
bun run test:unit

# Per-issue BDD scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-545"

# Full regression suite (no cron/spawn/dedup regressions)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Type-check
bunx tsc --noEmit -p adws/tsconfig.json
```

Key unit test cases:
- `hasLinkedMergedOrClosedPR`: merged-link → true; closed-link → true; open-link → false; unlinked → false; `#1` vs `#12` boundary → correct
- `decideLabelRecovery` precedence: each of the five ineligible reasons + eligible path
- `evaluateLabelRecovery`: single `adw:feature` + no ADW comment + empty PRs → eligible; same + ADW comment → `in_progress_comment`; with `adw:none` → `opt_out`; two `adw:<type>` labels → `multi_label`
- `evaluateIssue` gate: `adwId === null` + ineligible evaluator → `reason: 'label:<reason>'`; `adwId !== null` → gate not consulted (spy assertion)

## Notes

- **Dedup is layered, not replaced.** The label gate is a cheap pre-filter; the authoritative double-spawn guard remains the `evaluateCandidate` / `spawnGate` chain. The `adwId === null` scope of the gate ensures the takeover-of-dead-orchestrator path is never short-circuited.
- **Resume/merge/takeover paths unaffected.** All non-fresh stages have a non-null stage or non-null `adwId` and are never routed through the label gate.
- **`adw:upgrade` issues** carry no classification label → `no_adw_label` → skipped (upgrade issues are driven by `adwUpgrade`, not the recovery scan).
- **Zero-label issues** that the webhook deferred for open dependencies remain unaffected until a classification label is applied.
- **Out of scope:** `issues.labeled` webhook subscription; bulk label provisioning from the cron; LLM inference on the cron recovery path.
