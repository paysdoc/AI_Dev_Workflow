# Fix: `adw:*` Label Override Enforced at Classifier Chokepoint

**ADW ID:** la04ed-fix-adw-label-overri
**Date:** 2026-06-17
**Specification:** specs/issue-618-adw-la04ed-fix-adw-label-overri-sdlc_planner-fix-label-override-chokepoint.md

## Overview

The documented `adw:*` label override contract — *"a single `adw:<type>` label deterministically selects the workflow type, bypassing AI classification entirely"* — was only honored on 2 of the 4 orchestrator spawn paths. The `issue_comment` webhook and dependency-closure paths bypassed the label check entirely, falling through to the LLM classifier and producing misclassifications (observed: `adw:bug`-labeled issue classified as `/feature`, costing $0.59). This fix pushes the override down into `classifyIssueForTrigger` — the single chokepoint all four paths share — making it an enforced invariant rather than a per-caller convention.

## What Was Built

- **Chokepoint guard in `classifyIssueForTrigger`** — reads `adw:*` labels from the already-fetched issue object and short-circuits before any LLM call when exactly one classification label is present
- **Injectable deps interface (`ClassifyIssueForTriggerDeps`)** — enables pure unit testing of the new guard without process-level mocking of the LLM agent
- **Three regression tests** — cover single-label override (no LLM call), conflict fall-through (LLM called), and no-label fall-through (LLM called)

## Technical Implementation

### Files Modified

- `adws/core/issueClassifier.ts`: Added `readAdwLabels` import; added `ClassifyIssueForTriggerDeps` injectable interface; inserted deterministic label guard in `classifyIssueForTrigger` before `classifyWithIssueCommand`; wired deps injection for testability
- `adws/core/__tests__/issueClassifier.test.ts`: Added `classifyIssueForTrigger` import and `GitHubLabel` type; added `label()` fixture helper; added `describe('classifyIssueForTrigger — adw:* label override', ...)` with three tests

### Key Changes

- The override is now enforced in `classifyIssueForTrigger` (`adws/core/issueClassifier.ts:126-130`), which is reached by both previously-broken callers (`trigger_webhook.ts:188` and `webhookGatekeeper.ts:190`)
- `readAdwLabels(issue)` runs against the already-fetched issue object — zero extra API calls
- Single `adw:<type>` label → early return with `{ issueType, success: true, issueTitle }`, no LLM invocation
- Conflicting `adw:*` labels (`conflict === true`) fall through to the LLM heuristic, unchanged
- No caller signatures changed; the existing `labelRouting` pre-computation in cron and `issues.opened` paths remains the earlier short-circuit and is unaffected
- The `adwId` comment-scan recovery block (previously below the label check in `classifyIssueForTrigger`) is skipped for label-routed issues — consistent with how cron and `issues.opened` already behave, and safe because genuine takeover is resolved earlier by `evaluateCandidate`

## How to Use

No operator action required. The fix is transparent:

1. Apply exactly one `adw:<type>` label (`adw:bug`, `adw:feature`, `adw:chore`, or `adw:pr_review`) to a GitHub issue
2. Any trigger path — cron, `issues.opened`, `issue_comment`, or dependency-closure — will now deterministically route to the matching orchestrator without invoking the LLM classifier
3. To force LLM classification despite a label, apply two conflicting `adw:*` classification labels (e.g. `adw:bug` + `adw:feature`) — the conflict path falls through to the LLM as before

## Configuration

No configuration changes. The label names are defined in `adws/github/labelManager.ts` under `ADW_CLASSIFICATION_LABELS`:

| Label | Resolves to |
|---|---|
| `adw:chore` | `/chore` |
| `adw:bug` | `/bug` |
| `adw:feature` | `/feature` |
| `adw:pr_review` | `/pr_review` |

## Testing

```bash
# Unit regression tests for the chokepoint guard
bunx vitest run adws/core/__tests__/issueClassifier.test.ts

# Full suite
bun run test:unit

# Type-check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint
```

## Notes

- **`adw:none` opt-out is intentionally not handled here.** This fix targets the classification override only. Adding opt-out enforcement at this chokepoint would change behavior on paths that currently do process `adw:none` issues and is out of scope for #618.
- **Incident that motivated this fix:** Issue #614 (`adw:bug` + `hitl` labels) was routed via `issue_comment` webhook, bypassed the label override, and was classified as `/feature` by Sonnet — $0.59 wasted.
- **Why the chokepoint, not the call sites:** Fixing the two broken callers individually would recreate the same per-caller convention that caused the bug. The single chokepoint makes the override a real invariant across all four paths.
