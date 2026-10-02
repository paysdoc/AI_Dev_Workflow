---
status: accepted
date: 2026-07-08
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/automated-scenario-promotion-sweep.md
  - kind: contemporaneous
    source: specs/issue-739-*.md to specs/issue-745-*.md
  - kind: recalled
    source: "Martin Koster, 2026-10-01"
supersedes: ["0040"]
superseded-by: []
---

# Promotion sweep files a human-gated issue for the normal pipeline

## Context and Problem Statement

Under [ADR-0040](0040-scenario-promotion-by-tag-edit.md) a per-issue scenario could be tagged `@promotion-suggested-<date>`, but promotion candidates were still lost. The PRD names two causes. First, `adwPromotionSweep.tsx` was wired into no trigger, and when run by hand it moved only the scenario block: no step definitions, no `@regression` tag, no vocabulary entry. Second, the 14-day per-issue sweep judged files on age alone and deleted tagged candidates. The one promotion that had succeeded (#734, promoting #729) was done by hand through an ordinary feature issue.

## Decision Drivers

* A candidate must not be deleted while a promotion decision is pending.
* A human approves every promotion.
* #734 showed that the normal plan, build, test and PR pipeline can carry out a promotion.
* No promotion-specific recovery machinery.

## Considered Options

* Repair and wire the dedicated promotion orchestrator of ADR-0040.
* Reuse the SDLC pipeline: a cron sweep files a precise promotion issue (the PRD's "Architecture Y").

## Decision Outcome

Chosen option: "Reuse the SDLC pipeline", because #734 demonstrated that a promotion is "just a precise `adw:feature` issue" run through the normal pipeline. The sweep has three jobs: score, reconcile, originate.

* `runPromotionSweep` (`adws/triggers/promotionSweep.ts`) runs from the cron every `PROMOTION_SWEEP_INTERVAL_CYCLES` cycles (default 4320). It scores `features/per-issue/feature-N.feature` files with the scorer and threshold kept from ADR-0040. No LLM is involved.
* The pure `promotionSweepDecider` returns one action per file: `originate`, `leave`, `done`, `decline`, `redrive` or `withdraw`.
* On `originate` the sweep stamps `@promotion-suggested-<date>` on the file and files one issue labelled `adw:feature`, `regression-promotion` and `hitl`. The body carries `Promotes: feature-N`, the `git mv` instructions, the phrases to register and the acceptance that `@regression` runs green.
* Granularity is the whole file with its step definitions.
* The per-issue sweep exempts a file while it carries `@promotion-suggested-*`. `@promotion-declined` is terminal and lets the 14-day limit resume.
* A tracking issue closed without merging, or labelled `adw:blocked`, is a decline of the source file.
* Scenario authoring is skipped for issues labelled `regression-promotion`.
* A rot and reuse analysis is posted on the promotion PR as an advisory comment and never blocks.
* `hitl` holds the PR at the merge gate of [ADR-0038](0038-stateless-merge-gate.md) until a maintainer approves.

### Consequences

* Good, because promotion inherits takeover, the hung detector, `## Retry` and the merge gate; the sweep adds no orchestrator of its own.
* Good, because a broken promotion fails the `@regression` pass and enters the normal fix loop instead of opening a red PR.
* Good, because rejecting a promotion is durable: a declined file is never suggested again.
* Bad, because the rule that a promotion issue passes with no `@adw-{N}` scenarios depends on that tag staying optional in `.adw/review_proof.md`. The PRD records this as an invariant to preserve.
* Bad, because a candidate can score high and still need adaptation before it runs in the regression suite, which is why the green proof is mandatory.

### Confirmation

Checked on 2026-09-29 by reading the code:

* `adws/triggers/trigger_cron.ts` exports `runPromotionSweepTick`, gated on `PROMOTION_SWEEP_INTERVAL_CYCLES` (`adws/core/config.ts`).
* `adws/core/promotionIssueBody.ts` returns the three labels and the `Promotes:` marker.
* `adws/triggers/perIssueScenarioSweep.ts` calls `isPromotionExempt`.
* `adws/phases/scenarioPhase.ts` consults `scenarioAuthoringSkipReason` (`adws/core/adwLabels.ts`).
* `adws/adwSdlc.tsx` runs `executePromotionRotAdvisory` after the PR phase.
* The modules of ADR-0040 are gone (commit b221fac7).

Unit tests cover the decider, the tag state, the reconcile link and the cron tick (`adws/core/__tests__/promotionSweepDecider.test.ts`, `promotionTagState.test.ts`, `promotionReconcileLink.test.ts`, `adws/triggers/__tests__/trigger_cron.test.ts`). No CI gate enforces the decision. One promotion issue exists on GitHub, #760 (promoting #537), merged through PR #761.

## More Information

* The PRD and the generated issue body describe per-issue scenarios as "input-only, never executed". That wording is wrong; see the first divergence in [ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md).
* README.md describes the filed issue as a relocation "for a human to execute". The issue carries `adw:feature`, which routes it to the pipeline ([ADR-0041](0041-label-based-classification.md)); the human's part is approving the PR.
* Found on 2026-10-01, a defect with no ruling: the body of #923 has an HTML comment from the configuration file spliced into its `git mv` command. The regression directory value is read with its trailing comment attached.
