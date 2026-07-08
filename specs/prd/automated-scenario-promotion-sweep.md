# PRD: Automated Scenario Promotion Sweep

> Status: draft (design grilled 2026-07-08). Supersedes the "no automated promotion"
> governance stance by moving human curation from *candidate discovery* to a `hitl`
> PR **merge gate** — candidates are found and prepared automatically; a human still
> approves every promotion.

## Problem Statement

As an ADW maintainer, per-issue BDD scenarios that would make good permanent regression
tests get **silently lost**. A scenario authored under `features/per-issue/feature-N.feature`
is input-only and never executed. If it scores well and receives a `@promotion-suggested-<date>`
tag, nothing ever moves it into the executed `@regression` suite — and the live 14-day
per-issue sweep deletes it purely on age, tag or no tag. So a scenario I was invited to promote
disappears 14 days after its issue's PR merged, and I never get a reviewable moment to say
"yes, keep this."

The documented promotion pipeline that was supposed to prevent this does not run: the
`adwPromotionSweep` orchestrator (commenter + mover) is wired into no trigger, and even when
invoked by hand it produces a broken regression test — it moves only the `.feature` scenario
block, not the backing step-definitions, never adds the `@regression` tag, and never registers
vocabulary. The one successful promotion to date (#734, promoting #729) was done entirely by
hand through a bespoke `/feature` issue.

## Solution

As a maintainer, I want a periodic cron sweep that finds high-scoring per-issue scenarios,
records them as in-flight, and files a self-contained `adw:feature` promotion issue that the
**existing SDLC pipeline** turns into a `hitl`-gated PR — one that moves the whole feature file
plus its step-definitions into `features/regression/`, adds `@regression`, registers rubric-
compliant vocabulary, and proves the `@regression` suite green before asking for my approval.
I review the PR (with an advisory rot/reuse analysis posted as a comment), and merging it
promotes the scenario. If I close it without merging, the sweep records a declined marker and
lets the file age out normally. Until I decide, the source file is protected from the 14-day
deletion.

Crucially, this reuses ADW's normal plan → build → test → PR pipeline (proven viable by #734)
rather than building a dedicated promotion orchestrator. The sweep's only jobs are: **score,
reconcile, originate**.

## User Stories

1. As a maintainer, I want the cron loop to periodically score tracked per-issue scenarios against the regression vocabulary registry, so that promotion candidates are found without me running anything.
2. As a maintainer, I want scoring to be deterministic and cheap (no LLM), so that running it on every eligible cron cycle costs nothing.
3. As a maintainer, I want a high-scoring candidate to receive a durable `@promotion-suggested-<date>` marker committed to the per-issue file on the default branch, so that the candidate's in-flight status survives across cron cycles and process restarts.
4. As a maintainer, I want a candidate's `@promotion-suggested-*` marker to exempt its file from the 14-day per-issue deletion sweep, so that a scenario under active promotion consideration is never deleted out from under me.
5. As a maintainer, I want the sweep to file a single `adw:feature` promotion issue per qualifying per-issue **file** (whole-file granularity, matching #734), so that all of a file's scenarios move as a coherent unit.
6. As a maintainer, I want the promotion issue body to be a precise, #734-shaped instruction (source feature + step-def paths, the scenario's phrases, destination regression directory, vocabulary registry path, and an explicit "prove `@regression` green" acceptance), so that the normal build agent performs a correct relocation without wandering.
7. As a maintainer, I want the promotion issue labelled `adw:feature` (routing), `regression-promotion` (reconciliation key + authoring skip-flag), and `hitl` (merge gate), so that it routes through the normal pipeline but never merges without my approval.
8. As a maintainer, I want the promotion issue body to carry a `Promotes: feature-N` marker, so that the sweep can durably link a tagged per-issue file back to its tracking issue.
9. As a maintainer, I want the existing SDLC pipeline to move the whole feature file and its step-definitions into `features/regression/`, add a feature-level `@regression` tag, and register vocabulary, so that the promoted scenario is actually executed by the regression runner.
10. As a maintainer, I want the pipeline's `@regression` test pass to serve as the green-proof for the moved scenarios, so that a broken promotion fails the workflow and drops into the normal fix-loop / human-gated state instead of opening a red PR.
11. As a maintainer, I want the scenario-authoring phase to be skipped for promotion issues, so that the pipeline never invents junk `feature-<promotionIssueN>.feature` scenarios that would redden the run or become their own future promotion candidates.
12. As a maintainer, I want an advisory rot/reuse analysis of the promoted scenario's phrases posted as a comment on the promotion PR, so that I review the vocabulary changes with per-phrase verdicts in hand rather than eyeballing raw Gherkin.
13. As a maintainer, I want the rot analysis to be non-blocking, so that a fallible automated rot verdict cannot block a legitimate promotion — the decision stays mine.
14. As a maintainer, I want each cron sweep to reconcile the in-flight set (files tagged `@promotion-suggested-*`) against their tracking issues, so that the sweep is idempotent and self-healing.
15. As a maintainer, when a promotion PR merges, I want the sweep to recognise the candidate as done (its file has left `features/per-issue/`), so that it is no longer re-processed.
16. As a maintainer, when I close a promotion issue/PR without merging (rejection), I want the sweep to write a terminal `@promotion-declined` marker to the source file and let the 14-day TTL resume, so that the rejected candidate is not re-suggested every cycle and is eventually swept normally.
17. As a maintainer, I want `@promotion-declined` to suppress all future re-suggestion of that file, so that rejecting a promotion is durable and I am not asked twice.
18. As a maintainer, when a tracking issue exists but its promotion workflow died before opening a healthy PR (stranded), I want the sweep to re-file/re-drive it, so that a crash between tagging and PR-open does not permanently strand a tagged, TTL-exempt, unpromoted file.
19. As a maintainer, when re-driving a stranded candidate, I want the sweep to re-score it first and withdraw (strip the tag, resume TTL) if it no longer meets threshold, so that stale candidates whose scores have drifted below the bar are not promoted.
20. As a maintainer, when a promotion workflow exhausts its retries and escalates to `adw:blocked`, I want the sweep to treat that as a decline for the *source* file (write `@promotion-declined`, resume TTL) while leaving the blocked tracking issue as the normal human-escalation artifact, so that an un-promotable candidate does not sit TTL-exempt and unpromoted forever.
21. As a maintainer, on the first run I want the existing backlog of `@promotion-suggested-*` files (whose PRs merged long ago) to be re-scored and promotion issues filed for those still above threshold, so that the stranded backlog is either promoted or cleanly withdrawn rather than lost.
22. As a maintainer, I want promotion issues to inherit ADW's existing resilience (takeover, hung-detector, `## Retry`, the stateless `(no hitl) OR (approved)` merge gate), so that no promotion-specific recovery machinery is built.
23. As a maintainer, I want the dead promotion modules (commenter, mover, approval-detector, `adwPromotionSweep.tsx`) deleted and the README's "Scenario Promotion" section rewritten, so that the documentation stops describing a flow that never worked.
24. As a maintainer, I want the sweep to be non-fatal (a transient git/gh error is logged and swallowed), so that a promotion-sweep failure can never crash the cron loop.
25. As a maintainer, I want the sweep interval-gated (like the per-issue sweep), so that the git/gh *actions* (commit-to-default, issue creation, reconciliation queries) run on a generous cadence rather than every 20-second tick.

## Implementation Decisions

**Architecture: reuse the SDLC pipeline (Architecture Y), not a dedicated orchestrator.**
#734 demonstrated that a promotion is just a precise `adw:feature` issue run through the normal
plan → build → test → PR pipeline. Therefore no promotion orchestrator, no new green-proof phase,
no promotion-specific redrive/claim primitive. The sweep files an issue; the pipeline does the rest.

**New deep modules (pure — no I/O, unit-testable in isolation):**

- **`promotionSweepDecider`** — the lifecycle decision function. For each per-issue file, given its promotion tag state, whether it currently scores ≥ threshold, and a reconciliation fact (`no-issue | open | merged | closed-unmerged | blocked`), it returns exactly one action: `originate | leave | done | decline | redrive | withdraw`. All rules from the design live here (see User Stories 14-20). No git/gh access.
- **`promotionTagState`** — pure parse/serialize of the on-file markers `@promotion-suggested-<date>` and `@promotion-declined`, modelling the state machine `none → suggested → declined`. Reuses the pure marker logic salvaged from `promotionTagWriter`.
- **`promotionReconcileLink`** — pure matcher mapping tagged per-issue files to open promotion issues via the `Promotes: feature-N` body marker; the `gh issue list --label regression-promotion` call is injected by the shell.
- **`isPromotionExempt`** — pure predicate composed into the per-issue TTL sweep: a file is exempt while `@promotion-suggested-*`; `@promotion-declined` and untagged files are not.
- **`promotionIssueBody`** — pure builder producing the #734-shaped issue title/body (including the `Promotes: feature-N` marker) and the label set `[adw:feature, regression-promotion, hitl]`.
- **`shouldSkipScenarioAuthoring(labels)`** — trivial pure gate: true when `regression-promotion` is present.

**Imperative shell (dependency-injected, non-fatal — mirrors `runPerIssueScenarioSweep`):**

- **`runPromotionSweep(deps)`** — lists tracked `features/per-issue/feature-N.feature` on the default branch; scores them via the retained deterministic scorer; runs the injected reconciliation query; calls `promotionSweepDecider`; executes each action (write/strip marker + commit-scoped-to-those-paths to default, file the issue). Scoped commits only (never `git add -A`). Persists via `GitContext`, only when on the default branch, swallowing transient failures.

**Reused (not rewritten):** `promotionScorer` (pure regex phrase-match, no LLM), `promotionThreshold` (auto-ramping), `scenarioParser`, `vocabularyParser`, `promotionStatsLoader`.

**Deleted:** `promotionCommenter`, `promotionMover`, `promotionApprovalDetector`, `adwPromotionSweep.tsx`, plus their tests and JSONL/feature fixtures. The README "Scenario Promotion" section is rewritten to describe the sweep.

**Pipeline modifications (minimal):**

- `scenarioPhase` gains a guard: if `shouldSkipScenarioAuthoring(issueLabels)`, the scenario-authoring phases (scenario_writer and the dependent alignment / validation / gherkin-freeze / fidelity steps) no-op. This removes the reliance on LLM discretion that #734 got away with (n=1).
- A rot-comment step runs the `promote-regression-vocabulary` analysis on the promoted scenario's phrases and posts the per-phrase reuse/rot verdicts as a PR comment. Advisory, non-blocking.

**Trigger wiring:** `runPromotionSweep()` is invoked from `trigger_cron` under a new interval gate `cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0`, adjacent to the existing per-issue sweep.

**TTL sweep change:** `perIssueScenarioSweep` composes `isPromotionExempt(promotionTagState(fileContent))` into its staleness decision. `isScenarioStale` stays a pure age predicate; exemption is a separate composed predicate.

**Labels / classification (verified):** `regression-promotion` is not an `adw:*` label, so it is invisible to `LABEL_TO_COMMAND`; `adw:feature` deterministically routes the issue and bypasses AI classification. The `regression-promotion` label already exists in the repo (legacy from the deleted mover).

**Green-proof (verified):** `scenarioTestPhase` runs both `@adw-{issueNumber}` and the full `@regression` pass. After the build moves the scenario into `features/regression/` with `@regression`, the regression pass executes it; a red result flows into the normal scenario fix-loop and, on exhaustion, a human-gated state.

**Empty-target-tag invariant (verified, must preserve):** a promotion issue has zero
`@adw-{promotionIssueN}` scenarios. Because `.adw/review_proof.md` has no `## Tags` table,
`parseReviewProofMd` falls back to defaults where `@adw-{issueNumber}` is `severity: blocker,
optional: true`. A zero-scenario run of an optional tag is classified `{passed:true, skipped:true}`,
so it does not contribute to `hasBlockerFailures` and the workflow does not redden. **Invariant:**
`@adw-{issueNumber}` must remain optional (or promotion issues must be explicitly exempted); a
future `## Tags` table marking it non-optional would hard-fail every promotion.

**Merge:** the stateless `gate_open = (no hitl) OR (PR approved)` gate applies unchanged. `hitl`
defers the merge until the maintainer approves the promotion PR, at which point the existing
`adwMerge` path merges it.

## Testing Decisions

**What makes a good test here:** exercise externally-observable behaviour, not implementation
detail. For the pure deciders that means: given an input state, assert the returned decision/marker
— never assert on internal control flow, private helpers, or the shape of intermediate values.
For markers, assert on the resulting file content string, not on the parsing internals. The shells
and pipeline wiring are validated behaviourally (BDD), not unit-tested against mocks of git/gh
internals.

**Modules to unit-test (selected):**

- **`promotionSweepDecider`** — the highest-value target. Table-driven tests over the full cross
  product of `{tag state} × {score ≥ threshold?} × {reconciliation fact}` asserting the single
  correct action, including every lifecycle edge: originate on fresh high-scorer, leave while open,
  done on merged, decline on closed-unmerged, decline on `adw:blocked`, redrive on stranded-missing,
  and withdraw on stranded-missing-below-threshold (score drop).
- **`promotionTagState`** — parse and serialize round-trips for `none → suggested → declined`;
  date-format handling; idempotent re-tagging; correct stripping on withdraw/decline.
- **`promotionReconcileLink` + `isPromotionExempt`** — the linkage matcher (`Promotes: feature-N`
  across a set of open issues, including no-match and multi-candidate cases) and the TTL exemption
  predicate (exempt while suggested; not exempt when declined or untagged). This is the direct test
  of the root-cause fix — the previously tag-blind sweep.

**Not unit-tested (integration-covered):** `promotionIssueBody`, `shouldSkipScenarioAuthoring`,
and the `runPromotionSweep` shell — exercised via BDD/pipeline behaviour rather than isolated units.

**Prior art:** the pure-decider-with-table-tests pattern is well established — `worktreeReuseGate`,
`resolveResumeSpawn`, `decideUpgradeRedrive`/`upgradeFailureCap`, `resumePolicy`/`nextResumeAction`,
`resolveVerdict`, and `stageClassifier` are all pure functions with exhaustive case tests. The
dependency-injected, non-fatal shell pattern mirrors `runPerIssueScenarioSweep`
(`perIssueScenarioSweep.ts`) and its tests.

## Out of Scope

- **Per-scenario (sub-file) promotion.** Granularity is whole-file; splitting a feature file and its
  shared step-definitions is explicitly not built.
- **A dedicated promotion orchestrator, green-proof phase, redrive cron, or claim primitive** — the
  design deliberately reuses the SDLC pipeline and inherits existing resilience.
- **Automated authoring of rot-compliant vocabulary as a *gate*.** The build agent authors vocabulary;
  rot is surfaced advisorily on the PR and judged by the human. No blocking rot check.
- **Cross-host coordination.** Inherits the single-host constraint; the sweep runs only in cron.
- **Auto-merge of promotion PRs without human approval.** `hitl` is always applied; a maintainer
  approves every promotion.
- **Changing the deterministic scorer or the auto-ramping threshold logic.** Reused as-is.
- **Investigating or fixing the pre-existing red per-issue scenarios** surfaced by the earlier
  green-run sweep (504/524/565/572/577/614) — unrelated to this feature.

## Further Notes

- **Root cause restated:** "files with `@promotion-suggested-*` get lost" = (1) nothing ever moved a
  suggested candidate into the executed suite, and (2) `perIssueScenarioSweep.isScenarioStale` is
  age-only and tag-blind, so it deletes candidates on the 14-day TTL. This PRD fixes both: the sweep
  moves them (via the pipeline) and the TTL sweep becomes promotion-aware.
- **Idempotency of record:** the `@promotion-suggested-<date>` marker on the default branch is the
  durable in-flight marker (chosen over an open-PR check). The reconciliation query over the small
  tagged set resolves redrive vs decline vs done each cycle — a single cheap pass that unifies
  re-drive and rejection detection.
- **Residual to finalise during implementation:** the exact skip-gate cascade scope (confirm that
  suppressing scenario_writer cleanly no-ops the dependent alignment/validation/gherkin-freeze/
  fidelity steps), the rot-comment's wiring point in the pipeline, and the value of
  `PROMOTION_SWEEP_INTERVAL_CYCLES`.
- **Reference implementation:** `specs/issue-734-...promote-729-regression-scenario.md` is the
  hand-done promotion this automates; its glob-neutrality, import-depth, and `@regression` mock-infra
  observations are the concrete gotchas the build agent must handle per candidate (a candidate can
  score high yet be un-promotable without adaptation — which is why the `@regression` green-proof gate
  is non-negotiable).
- **Governance shift:** this reverses the "no automated promotion" stance to "automated discovery +
  preparation, human-gated merge." Human curation is preserved at the `hitl` PR gate.
