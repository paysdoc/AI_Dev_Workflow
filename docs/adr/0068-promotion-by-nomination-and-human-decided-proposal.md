---
status: accepted
date: 2026-11-27
recorded: 2026-11-27
provenance:
  - kind: transcript
    source: "Claude Code session a2ef503a, grill of 2026-11-27"
  - kind: contemporaneous
    source: "Handoff note of 2026-11-27 from a session in vestmatic/deckerly, holding the line counts quoted here; read in the session and not kept in the repository"
  - kind: contemporaneous
    source: "Sample of vestmatic/deckerly at origin/dev 42cbe6b and `gh issue list --label regression-promotion` on both repositories, read in the same session"
supersedes: ["0049", "0037"]
superseded-by: []
---

# Promotion by nomination and a human-decided proposal; the scorer and the promotion sweep are removed

## Context and Problem Statement

[ADR-0049](0049-promotion-sweep-files-human-gated-issue.md) has a cron sweep score per-issue scenarios and file a `regression-promotion` issue that the pipeline builds, with a human approving the pull request. The owner found promotion far too eager. The code and the history show why.

* The bootstrap threshold is 3, and `promotionScorer.ts` counts When steps whether or not they are registered: a scenario with one When and three Ands scores 3 with no step in the vocabulary.
* A whole feature file qualifies when its best scenario does.
* Nothing looks at age or merge state.
* In target repositories the vocabulary template has 3 columns and `vocabularyParser.ts` needs 5, so the registry parses empty and promotion rests on the When-step count.
* The human gate does not filter. In ADW 21 promotion issues were filed and 21 completed, eight of them filed within 40 seconds on 2026-10-04. In deckerly 27 were filed and all closed, and some of the promotion pull requests were merged by the bot.

deckerly's regression suite held 213 scenarios against 169 per-issue ones on 2026-11-27, and one regression file held 40 scenarios. The `@regression` tag runs as a blocking tag in every workflow, so the suite is a cost on every issue.

The per-issue sweep of [ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md) works and stays. It has one gap: it deletes step code only under `features/per-issue/step_definitions`, while targets keep theirs in the configured step-definition directory. In deckerly 657 step definitions, about 5,700 lines, were used by no feature file.

## Decision Drivers

* A gate on machine proposals that costs nothing to pass approved everything put to it.
* The regression suite runs on every workflow, so each promoted scenario is paid for on every later issue.
* Per-issue scenarios are acceptance evidence for one change; unit tests are the durable guard.
* The owner wants promotion to stay possible without having to hunt for candidates.

## Considered Options

For who originates a promotion: the human only, with the scorer deleted; automatic origination with a repaired scorer and a monthly budget; the scenario agent nominates at most one scenario per issue.

For what the human decides on: a finished promotion pull request, as today; a written proposal, with the work done only after approval.

For how nominations reach the human: one proposal per nominated issue; one proposal per repository on a fixed cadence.

For what counts as approval: ticking a checkbox and adding a label; the proposal's card reaching the Done column of the project board; closing the proposal as completed, with the ticked boxes as the approved set.

For granularity: the whole feature file; the single scenario.

## Decision Outcome

Chosen: the scenario agent nominates; the human decides a written proposal; one proposal per repository per week; closing as completed approves the ticked candidates; promotion is per scenario.

* **Purpose of the regression suite.** A small, curated set. A scenario belongs in it only when it guards a behaviour whose breakage would be expensive and that no other regression scenario already guards. Existing and passing is no argument. Deletion 14 days after merge stays the default fate of a per-issue scenario.
* **Nomination.** The scenario agent may nominate at most one of the scenarios it writes for an issue, by that same criterion. Nominating nothing is the stated default.
* **Promotion proposal.** Once a week per repository, ADW gathers the open nominations into one issue labelled `adw:none`, so the pipeline does not work it. For each candidate it says why it qualifies and how it fits the existing regression suite, and gives it a checkbox. The advisory `promote-regression-vocabulary` skill becomes the analysis that writes the fit section.
* **Approval.** The proposal is decided when the owner closes it as completed; the boxes ticked at that moment are the approved set. Closed as not planned, closed as completed with nothing ticked, or unanswered after 30 days, it counts as declined. A checkbox and a label alone were rejected by the owner as too flimsy: a box can be ticked halfway through reading.
* **Implementation issue.** On approval ADW files a second issue that the pipeline builds unattended. It moves the approved scenarios into the regression suite one scenario at a time, rewords them to the vocabulary, and merges without a second human gate. The normal test and review phases run.
* **Sweep.** Nominated scenarios are exempt from the per-issue sweep while their proposal is open. Declined ones are swept. The sweep also deletes, in the target's configured step-definition directory, every step definition that no remaining feature file uses.
* **Removed.** The scorer, the threshold ramp, the statistics loader, the cron origination and the `@promotion-suggested` tagging.
* **Audit.** Each repository gets a one-off audit of its existing regression suite, deckerly first, through the same proposal mechanism. It lists every regression scenario with its execution level, any unit test that already covers it, and a recommendation to keep or remove. Its implementation issue removes what the owner rejects and prunes the vocabulary to the phrases still in use.

The owner preferred nomination over human-only origination. The objection to nomination, that proposals a machine originates are approved by default, is answered by changing what is approved: a reasoned proposal before any work, instead of a finished pull request.

### Consequences

* Good, because nothing is built until the owner has decided, and the decision is a deliberate act every repository supports.
* Good, because candidates are judged side by side, so two nominations guarding the same behaviour are seen together.
* Good, because the stream is capped at one issue a week per repository.
* Good, because the scorer's defects, including the column mismatch in the vocabulary parser, go away with the scorer.
* Bad, because the regression suite no longer grows unless the owner acts; a proposal ignored for 30 days loses its candidates.
* Bad, because nominations still come from an agent on every issue. The default of nominating nothing is prompt text.
* Bad, because the implementation pull request merges without a human reading it.

### Confirmation

No check exists yet. Once built: the proposal issue carries `adw:none`; `grep -rn promotionScorer adws` finds nothing; the regression suite of a repository changes only in pull requests that trace back to a proposal closed as completed.

Checked against the code on 2026-11-27, before anything was changed:

* `adws/promotion/promotionThreshold.ts:3-15` sets `BOOTSTRAP_THRESHOLD = 3`; `promotionScorer.ts:62-84` adds `whenStepCount - 1` without consulting the registry.
* `adws/triggers/promotionSweep.ts:86-89` takes the maximum score over a file's scenarios; `planCandidate` (lines 144-182) reads no merge date.
* `adws/triggers/perIssueScenarioSweep.ts:32-36` hard-codes `features/per-issue/step_definitions`.
* `adws/triggers/trigger_cron.ts:189` runs the promotion sweep every `PROMOTION_SWEEP_INTERVAL_CYCLES` cycles. There is no switch to turn it off.

## Divergence

The code does not yet follow this decision; the promotion sweep of ADR-0049 is still what runs. The difference is deliberate until the work is specified in a PRD and built through issues. Until then the owner pauses the sweep by setting `PROMOTION_SWEEP_INTERVAL_CYCLES` on the pipeline host to a value the cron never reaches. Whether that has been done was not checked.

## More Information

* Supersedes [ADR-0049](0049-promotion-sweep-files-human-gated-issue.md) in whole.
* Supersedes, in part, [ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md): promotion is per scenario and follows a decided proposal; the per-issue sweep also removes unused step definitions and exempts nominated scenarios for up to 30 days. The two folders and the 14-day deletion stand.
* [ADR-0067](0067-scenarios-prove-only-behaviour-at-a-declared-real-boundary.md) decides which scenarios exist to be nominated at all.
* The handoff note states that deckerly's PR #271 removed seven per-issue feature files in a manual sweep. The history shows the bot sweep removed them (commit 6a200c8, 2026-11-24).
* The terms Nomination, Promotion Proposal, Promotion and Per-Issue Sweep are defined in `UBIQUITOUS_LANGUAGE.md`.
