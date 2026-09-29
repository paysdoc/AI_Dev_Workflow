---
status: superseded
date: 2026-05-21
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/scenario-rot-prevention-and-promotion.md
  - kind: contemporaneous
    source: specs/issue-509-*.md, specs/issue-510-*.md, specs/issue-511-*.md, specs/issue-512-*.md
supersedes: []
superseded-by: ["0049"]
---

# Scenario promotion by tag edit on the per-issue PR

## Context and Problem Statement

[ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md) split scenarios into a permanent regression suite and per-issue scenarios that a sweep deletes 14 days after their PR merges. Nothing told the team which per-issue scenarios were worth keeping before the sweep removed them. The PRD states the answer at the time was "humans read PR diffs", which had no mechanism for suggesting a promotion.

This ADR covers the promotion half of the PRD. The rot prohibition in the `scenario_writer` prompt and the vocabulary template for target repos are part of ADR-0037.

## Decision Drivers

* A scenario worth keeping had to be noticed before the 14-day sweep deleted it.
* No scenario was to enter the regression suite without a human decision.
* Suggestions were not to nag: no escalation, no background noise on dormant PRs.
* No per-repo tuning knobs, to avoid drift and bikeshedding.

## Considered Options

The PRD records these choices, each with the alternative it rejected:

* Approval by editing the tag to `@promotion`, versus approval by deleting the suggestion tag.
* Suggestion state held in the `.feature` file as a dated tag, versus an external state file.
* Scoring on per-issue PR events only, versus a cron reminder sweep.
* A framework-owned, auto-ramping threshold, versus a per-repo override of the threshold or the scoring weights.
* A human gate on every promotion, versus automatic promotion.

## Decision Outcome

Chosen: score each per-issue scenario on PR events, mark high scorers with a tag, and promote only after a human edits that tag.

* **Scoring.** A deterministic scorer combined surface match against the vocabulary registry (weight 3) with blast radius: subprocess 3, phase-import 2, each extra phase 1, mock-query 0.
* **Threshold.** A scenario scoring at or above N received `@promotion-suggested-<date>` and a comment on the per-issue PR. N started at 3 and ramped to 7 with the repo's ratio of promoted to written scenarios over a rolling 90 days, saturating at a ratio of 0.5 (#512).
* **Human gate.** Posting the comment applied the `hitl` label to the issue, so the merge gate of [ADR-0038](0038-stateless-merge-gate.md) held the PR (#510).
* **Approval.** A human changed `@promotion-suggested-<date>` to `@promotion`. The PRD chose an edit because it is "hard to do accidentally"; a deletion could happen during formatting or refactoring.
* **Move.** On the next run `promotionMover` opened a separate PR labelled `regression-promotion` that moved the scenario block into the regression directory (#511).
* **No follow-up.** Ignored suggestions died at the 14-day sweep. A suggestion whose score later fell below N was withdrawn silently.

The pure parts lived in `adws/promotion/` (`vocabularyParser`, `scenarioParser`, `promotionScorer`, `promotionThreshold`, `promotionTagWriter`). `promotionCommenter` and `promotionMover` were thin shells run by `adws/adwPromotionSweep.tsx`.

### Consequences

* Good, because suggestion state travelled with the scenario and needed no separate store; the PRD notes that any past commit shows the suggestion state at that point.
* Good, because the scoring rules and the threshold curve were pure functions with unit tests.
* Bad, because a suggestion on a dormant PR went stale with nobody prompted to act; the PRD accepted this as a human responsibility.
* Bad, because a repo that disagreed with the threshold or the weights had no way to change them short of a framework change.

### Confirmation

Not in force. Checked on 2026-09-29: `adws/adwPromotionSweep.tsx` does not exist, and a grep for `promotionCommenter`, `promotionMover`, `promotionApprovalDetector` and `promotionTagWriter` under `adws/` finds only one comment in `adws/core/promotionTagState.ts`. Commit b221fac7 (2026-07-08) deleted the modules.

## More Information

* Replaced by [ADR-0049](0049-promotion-sweep-files-human-gated-issue.md), which records why.
* Carried over unchanged into the successor: the scorer, the threshold, both parsers, the stats loader, the `@promotion-suggested-<date>` marker and the `regression-promotion` label.
* #509 shipped the scorer and commenter with a fixed N of 3; #510 added the `hitl` label and the tag lifecycle; #511 added the mover; #512 added the ramp.
