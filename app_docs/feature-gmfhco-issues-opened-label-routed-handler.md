# Label-Routed `issues.opened` Handler

**ADW ID:** gmfhco-issues-opened-label
**Date:** 2026-06-08
**Specification:** specs/issue-542-adw-gmfhco-issues-opened-label-sdlc_planner-label-routed-handler.md

## Overview

This feature wires the `labelManager` deep module (issue #540) into the `issues.opened` webhook path so that GitHub `adw:*` labels drive classification deterministically. Issues with a pre-applied label bypass LLM inference entirely; the LLM is used only as a fallback when no label is present, and the inferred classification is persisted back to the issue as a label.

## What Was Built

- **`adws/triggers/issueOpenedRouter.ts`** — new pure routing module with four-branch decision logic, defensive payload label extraction, DI orchestration, and the marker-free refusal comment constant
- **`readAdwLabelNames(names)`** added to `adws/github/labelManager.ts` — reads ADW classification state from a plain `string[]`, with `readAdwLabels` delegating to it
- **`LabelRouting` seam** added to `classifyAndSpawnWorkflow` in `webhookGatekeeper.ts` — supports pre-computed classification (skip LLM) and best-effort inferred-label persistence
- **Integration** in `trigger_webhook.ts` `action === 'opened'` block — replaced inline eligibility+spawn with `routeIssueOpened`
- **Unit tests** for all four routing branches, `extractPayloadLabelNames` edge cases, refusal-comment marker guards, and the `issues.labeled` non-subscription guard

## Technical Implementation

### Files Modified

- `adws/triggers/issueOpenedRouter.ts` *(new)* — pure `decideIssueOpenedRoute`, `extractPayloadLabelNames`, DI interface `IssueOpenedRouterDeps`, `buildDefaultIssueOpenedRouterDeps`, and `routeIssueOpened`
- `adws/triggers/__tests__/issueOpenedRouter.test.ts` *(new)* — Vitest unit tests covering all four branches plus precedence, edge cases, and marker guards
- `adws/github/labelManager.ts` — extracted `readAdwLabelNames(labelNames: readonly string[])` as the primary implementation; `readAdwLabels` now delegates to it
- `adws/github/index.ts` — added `readAdwLabelNames` to barrel re-exports
- `adws/triggers/webhookGatekeeper.ts` — added optional `labelRouting?: LabelRouting` param to `classifyAndSpawnWorkflow`; skip-LLM path when `precomputedClassification` is set; best-effort `applyLabel` on `persistInferredLabel` path
- `adws/triggers/trigger_webhook.ts` — replaced inline eligibility + spawn with `extractPayloadLabelNames` + `routeIssueOpened`; `AuthRequiredError` catch moved to outer try/catch
- `adws/__tests__/triggerWebhook.test.ts` — added `issues.labeled` non-subscription guard test
- `adws/github/__tests__/labelManager.test.ts` — added `readAdwLabelNames` parity tests
- `features/per-issue/feature-542.feature` — BDD scenarios for all four routing branches
- `features/per-issue/step_definitions/feature-542.steps.ts` — step definitions

### Key Changes

- **Four-branch routing**: `adw:none` → opt out (no spawn, no comment); exactly one `adw:<type>` → classified spawn (no LLM); multiple `adw:<type>` → refusal comment, no spawn; zero `adw:*` → LLM infer + persist label + spawn.
- **`adw:none` takes unconditional precedence**: `decideIssueOpenedRoute` checks `optOut` first, so `adw:none` + any classification label → `opt_out`.
- **Refusal comment is marker-free**: `MULTI_LABEL_REFUSAL_COMMENT` uses `**bold**` lead text and contains no `## :emoji:` heading or `<!-- adw-bot -->` marker, so `concurrencyGuard`'s `isAdwComment` never counts it.
- **`classifyAndSpawnWorkflow` is unchanged at existing call sites**: `labelRouting` is an optional trailing argument omitted by the four existing callers (cron, two webhook, dependency-unblock).
- **Best-effort label persistence**: `applyLabel` on the `infer` path is wrapped in its own try/catch (`warn`-log on failure); spawn and spawn-lock release are never blocked.

## How to Use

Label routing is automatic for any `issues.opened` webhook event. Triagers control classification by applying GitHub labels before or at issue creation:

1. **Opt out of ADW automation** — apply `adw:none` to the issue. No orchestrator will be spawned and no comment will be posted.
2. **Force a specific orchestrator** — apply exactly one of `adw:feature`, `adw:bug`, `adw:chore`, or `adw:pr_review`. The mapped orchestrator spawns immediately without an LLM call.
3. **Conflicting labels** — if multiple `adw:<type>` labels are present, ADW posts a plain cleanup comment and does not spawn. Remove all but one label; the CRON recovery layer will pick up the issue once it has a single classification label.
4. **No label** — leave all `adw:*` labels off. The existing LLM classifier runs, applies the inferred `adw:<type>` label back to the issue, and spawns the orchestrator.

Late-applied labels (added after the `issues.opened` event) have no immediate effect — they are handled by the CRON recovery layer.

## Configuration

No new configuration required. The routing logic uses the existing `ADW_CLASSIFICATION_LABELS` and `ADW_NONE_LABEL` constants from `labelManager.ts`. Ensure the `adw:*` labels exist in the target repository (the `applyLabel` function lazy-creates a missing label on the `infer` path).

## Testing

```bash
# Unit tests (includes issueOpenedRouter, labelManager, triggerWebhook guard)
bun run test:unit

# BDD regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Per-issue scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-542"

# Type-check
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- **`issues.labeled` is deliberately not subscribed.** The webhook has no `labeled` action branch; a source-scan guard test in `triggerWebhook.test.ts` asserts `action === 'labeled'` never appears.
- **Known race context**: the cron+webhook duplicate-spawn race on dependency-closure transitions is unchanged — label routing sits in front of the same `classifyAndSpawnWorkflow` spawn gate, and `opt_out`/`conflict` branches never spawn.
- **Out of scope**: CRON recovery layer for late-applied labels; deletion of `extractAdwCommandFromText`/`classifyWithAdwCommand`; hash-based auto-(re)init; bulk `ensureAdwLabelsExist` provisioning.
- **`adw:upgrade` is not a classification label** — it is treated as zero classification labels and falls through to the `infer` branch.
- **Near-miss labels** (`adw-bug`, `adwesome`, `adw:Bug`) are ignored — exact match only, delegated to `labelManager` semantics from issue #540.
