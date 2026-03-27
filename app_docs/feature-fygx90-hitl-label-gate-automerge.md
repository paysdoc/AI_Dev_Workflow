# HITL Label Gate for Auto-Merge

**ADW ID:** fygx90-add-hitl-label-gate
**Date:** 2026-03-27
**Specification:** specs/issue-329-adw-fygx90-add-hitl-label-gate-sdlc_planner-hitl-label-gate.md

## Overview

Adds a `hitl` (human-in-the-loop) GitHub label gate to `executeAutoMergePhase`. When the `hitl` label is present on an issue at auto-merge time, the orchestrator skips both PR approval and merge, posts a human-readable comment on the issue, and exits cleanly — leaving the PR open for manual review. This provides a lightweight, opt-in mechanism for issues that require human oversight before code lands on the default branch.

## What Was Built

- `issueHasLabel()` — a reusable, real-time label check helper in `issueApi.ts`
- HITL gate in `executeAutoMergePhase` that fires before PR approval
- Issue comment posted when HITL is detected: `## ✋ Awaiting human approval — PR #N ready for review`
- `HITL` term added to `UBIQUITOUS_LANGUAGE.md`
- `execSync` → `execWithRetry` migration across all `issueApi.ts` GitHub CLI calls
- Skip reason log file written to `logsDir/skip_reason.txt` on all early-exit paths
- `continuationCount` renamed to `contextResetCount` in `PhaseCostRecord` (ubiquitous language alignment)

## Technical Implementation

### Files Modified

- `adws/github/issueApi.ts`: Added `issueHasLabel()` helper; migrated all `execSync` calls to `execWithRetry`
- `adws/github/githubApi.ts`: Re-exported `issueHasLabel`; updated `getRepoInfo()` to accept optional `cwd`; migrated `getAuthenticatedUser` to `execWithRetry`
- `adws/github/index.ts`: Added `issueHasLabel` to barrel export; removed `createPullRequest` re-export (moved elsewhere)
- `adws/phases/autoMergePhase.ts`: Added HITL label gate block; added `skip_reason.txt` writes on early exits; renamed `continuationCount` → `contextResetCount`
- `UBIQUITOUS_LANGUAGE.md`: Added HITL term to the "Issue lifecycle" table (new file on this branch)

### Key Changes

- **Real-time label check**: `issueHasLabel()` performs a fresh `gh issue view --json labels` call at auto-merge time, not cached from workflow start. Label can be added/removed any time during the workflow and will be respected.
- **Fail-open design**: if the `gh issue view` call throws (network error, rate limit), `issueHasLabel` logs a warning and returns `false` — auto-merge proceeds normally. Absence of confirmation does not block.
- **Gate placement**: the HITL check runs after `repoInfo` construction (after the existing "no PR URL" and "no repo context" guards) and before any approval or merge logic — no side effects occur when skipping.
- **Webhook path unaffected**: `autoMergeHandler.ts` is not modified. Since the bot never approves HITL issues, any `pull_request_review` approved event is by definition human-initiated and the webhook merge flow proceeds normally.
- **`execWithRetry` migration**: all `execSync` calls in `issueApi.ts` were replaced with `execWithRetry` as part of the robustness improvements, aligning with the project's retry-resilience pattern.

## How to Use

1. Identify an issue that requires human review before the PR is merged.
2. Add the `hitl` label to the GitHub issue (via the GitHub UI, `gh issue edit`, or any automation).
3. Run the ADW workflow as usual (`adwSdlc`, `adwPlanBuildReview`, etc.).
4. When the workflow reaches the auto-merge phase, it detects the label in real time and skips approval and merge.
5. A comment is posted on the issue: `## ✋ Awaiting human approval — PR #N ready for review`.
6. Review and merge the PR manually. The webhook auto-merge path will fire normally once you approve.

## Configuration

No configuration required. The gate is triggered solely by the presence of the `hitl` label on the issue.

The label name `hitl` is hardcoded in `autoMergePhase.ts`:

```ts
if (issueHasLabel(issueNumber, 'hitl', repoInfo)) { ... }
```

`issueHasLabel()` itself is generic and accepts any `labelName`, making it reusable for future label-based gates.

## Testing

**Edge cases covered by design:**

| Scenario | Behavior |
|---|---|
| Issue has no labels | `issueHasLabel` returns `false`; auto-merge proceeds |
| Issue has other labels but not `hitl` | auto-merge proceeds |
| `gh issue view` call fails | `issueHasLabel` returns `false`; auto-merge proceeds (fail-open) |
| `hitl` label added after workflow starts | detected because check is real-time |
| `hitl` label removed after skip | no retry; human merges manually |
| No PR URL found | existing guard fires before label check |
| No repo context | existing guard fires before label check |

To manually verify: add the `hitl` label to a test issue, run an orchestrator that includes `executeAutoMergePhase`, and confirm the PR is left open with the awaiting-human comment on the issue.

## Notes

- The `issueHasLabel()` function is intentionally generic rather than hardcoded to `hitl`, enabling reuse for future label gates (e.g., `hold`, `do-not-merge`).
- The completion comment (`## ✅ Workflow completed`) is still posted — it signals that ADW's work is done, not that the PR was merged.
- After a HITL skip, the human approves the PR manually and the existing webhook auto-merge (`autoMergeHandler.ts`) fires as normal — no special handling needed.
- `contextResetCount` replaces `continuationCount` in `PhaseCostRecord` to align with the ubiquitous language definition of **Context Reset**.
