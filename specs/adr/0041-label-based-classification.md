---
status: accepted
date: 2026-06-08
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/adw-init-hash-and-label-classification.md
  - kind: contemporaneous
    source: specs/issue-542-adw-gmfhco-issues-opened-label-sdlc_planner-label-routed-handler.md
  - kind: contemporaneous
    source: specs/issue-545-adw-y35zbi-cron-recovery-layer-sdlc_planner-label-eligibility-scan.md
  - kind: contemporaneous
    source: specs/issue-546-adw-d6rky0-delete-extractadwcom-sdlc_planner-remove-regex-classification-path.md
  - kind: contemporaneous
    source: "specs/issue-618-adw-la04ed-*.md and specs/issue-754-adw-uhkozf-*.md (later corrections)"
  - kind: recalled
    source: "Martin Koster, 2026-10-01"
supersedes: ["0007"]
superseded-by: []
---

# Issues are classified by `adw:*` labels; issue text never triggers a workflow

## Context and Problem Statement

Under [ADR-0007](0007-regex-only-issue-classification.md) a slash command found anywhere in an issue body or comment selected the workflow. The PRD names the failure: "Any issue author who writes `/adw_init` in prose without backticking it accidentally triggers an init workflow on a target repo", and `/feature` in unrelated prose "can produce misclassification". There was also no way to force a classification without the LLM reading the body, and no way to tell ADW to leave an issue alone.

## Decision Drivers

* Remove the whole class of triggers that match a substring of free text.
* A triager can override the classifier, and can opt an issue out.
* Every issue's classification is visible on the board.
* Minimal trigger plumbing: reuse the cron sweeper for anything the webhook misses ([ADR-0012](0012-webhook-gatekeeper-cron-sweeper.md)).

## Considered Options

For the mechanism itself, none recorded besides labels. The PRD records these as weighed and excluded:

* Subscribing the webhook to `issues.labeled`
* A migration shim, or a bot that converts body slash commands to labels
* A confidence threshold or pre-filter on the LLM classifier
* A label prefix configurable per target repo

## Decision Outcome

Classification is read from labels in the `adw:` namespace.

* **Labels.** `adw:chore`, `adw:bug`, `adw:feature` and `adw:pr_review` classify. `adw:none` opts out. `adw:upgrade` marks upgrade tracking issues ([ADR-0042](0042-hash-versioned-self-upgrade.md)).
* **Every new issue is processed.** There is no per-issue opt-in; `adw:none` is the opt-out. The PRD calls this "a real behavior change".
* **Routing on `issues.opened`**, in this order: `adw:none` present, ignore. More than one classification label, refuse with a plain comment that carries no ADW marker. Exactly one, use it and skip the LLM. None, run `/classify_issue` and write the inferred label back to the issue.
* **Late labels.** The webhook does not subscribe to `issues.labeled`; the cron picks up issues whose labels changed after creation.
* **No text triggers.** `extractAdwCommandFromText` and `classifyWithAdwCommand` were deleted (#546). Orchestrator-level commands run from the CLI only. The heading directives of [ADR-0032](0032-explicit-cancel-and-retry-directives.md) are unchanged.
* **Clean cutover.** No migration; the PRD accepts that issues opened before the change must be closed and recreated.

Two corrections followed and are part of the decision as it stands:

* #618 (2026-06-17): the single-label override is enforced inside `classifyIssueForTrigger`, the one function all four spawn paths share, after issue #614 carrying `adw:bug` was sent to the LLM from the comment path and classified as a feature.
* #754 (2026-07-10): a fresh issue with no `adw:*` label is eligible for the cron sweep and is LLM-classified at spawn. #545 had required exactly one label, which stranded unlabelled issues while the webhook was down. "`adw:*` is a deterministic *override* of AI classification, not a *precondition* for pickup."

### Consequences

* Good, because a label is an exact match; prose cannot trigger or misroute a workflow.
* Good, because a labelled issue costs no classification call.
* Bad, because ADW acts on every new issue in every registered repository unless it is labelled `adw:none`.
* Bad, because a label applied after creation takes effect only on the next cron sweep.
* Bad, because an unlabelled issue still depends on the LLM classifier, which defaults to `/feature` when it fails or cannot be parsed.

### Confirmation

Checked against the code on 2026-09-29:

* `grep -rn "extractAdwCommandFromText\|classifyWithAdwCommand" adws README.md` returns nothing.
* `decideIssueOpenedRoute` in `adws/triggers/issueOpenedRouter.ts` has the four routes in the order above; `trigger_webhook.ts` has no `labeled` branch.
* `classifyIssueForTrigger` in `adws/core/issueClassifier.ts` returns the label's classification before any agent call.
* `bunx vitest run` on `adws/core/__tests__/adwLabels.test.ts` (26 tests) passed. `issueClassifier.test.ts`, `issueOpenedRouter.test.ts` and `cronLabelEligibility.test.ts` could not be loaded in this checkout because `@paysdoc/devplatform` is not installed; they were not run.

## Divergence

1. **`adw:none` is not honoured on every path.** The PRD says `adw:none` opts an issue out "entirely". The opt-out is checked on `issues.opened` and in the cron's fresh-issue path only. The `issue_comment` path calls `classifyAndSpawnWorkflow` with no opt-out check; #618 notes that these paths "currently do process `adw:none` issues" and put the question out of scope. Checked on 2026-10-01: the opt-out is read only in `adws/triggers/issueOpenedRouter.ts` and `adws/triggers/cronLabelEligibility.ts`; the dependency-closure path (`adws/triggers/issueClosedUnblockRouter.ts`) does not check it either. Ruling (owner, 2026-10-01): `adw:none` always wins, on every path. A bug.
2. **Labels are not provisioned up front.** The PRD wants all labels created on the first webhook from a target repo. `ensureAdwLabelsExist` exists in `adws/forge/adwLabelProvisioning.ts` but `grep` finds no caller outside tests. #542 deferred bulk provisioning as "a separate concern". On 2026-10-01 the ADW repository had five `adw:*` labels and no `adw:none` (`gh label list`), so a person cannot pick the opt-out label from the menu. Ruling (owner, 2026-10-01): provisioning up front is the decision. The missing call is a bug.

## More Information

* `ADW_LABEL_DEFINITIONS` now holds eight labels; `adw:unverified` and `adw:blocked` were added after the PRD, which lists six.
* Settled (owner, 2026-10-01): conflicting classification labels are refused on `issues.opened` and by the cron, and nowhere else. On every other spawn path (a comment on the issue, a dependency closing) `classifyIssueForTrigger` lets the conflict fall through to the LLM, and that is accepted: a comment is an explicit request, and the owner ruled the dependency-closure path the same way. This narrows the PRD, which refused such an issue everywhere. One effect is known: the cron refuses an issue that a closing dependency will spawn. `adw:none` overrides on every path; see Divergence.
