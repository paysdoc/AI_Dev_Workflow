# BDD Rewrite — Surface Matrix

This document is the planning input for **Issue #2** (scenario authoring). Each row in the matrix
below maps to a top-level `@regression` scenario that will be written in Issue #2. The "Composing
vocabulary phrases" column cross-references the canonical phrases registered in
`features/regression/vocabulary.md` — if a row cannot be expressed in registered phrases, either
the row is not `@regression` material or the vocabulary needs extending.

The matrix covers the 11 SDLC orchestrators (`adwSdlc`, `adwPlan`, `adwBuild`, `adwTest`,
`adwReview`, `adwMerge`, `adwChore`, `adwPatch`, `adwInit`, `adwPrReview`, `adwDocument`) × their
key phases, with happy / error / edge variants marked only where they meaningfully differ.

---

## Surface Matrix

| # | Orchestrator | Phase | Variant | Composing vocabulary phrases | Notes / preconditions |
|---|-------------|-------|---------|------------------------------|-----------------------|
| 1 | adwPlan | workflowInit | happy | G4, G11, W9, T1, T5 | Issue exists; clean worktree; state file written at `initialized` stage |
| 2 | adwPlan | planPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Stub returns plan payload; state advances to `plan_complete` |
| 3 | adwPlan | planPhase | error — stub failure | G4, G11, W1, T5, T9 | Stub exits non-zero; orchestrator captures error; state records no partial stage |
| 4 | adwBuild | buildPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Stub returns build payload; state advances to `build_complete` |
| 5 | adwBuild | buildPhase | edge — missing lock | G4, G5, G11, W1, T5, T6 | No prior lock; orchestrator acquires and releases lock; exit 0 |
| 6 | adwBuild | unitTestPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Unit test phase runs after build; state advances |
| 7 | adwReview | reviewPhase | happy | G3, G4, G8, G9, G11, W1, T2, T5 | Stub returns review payload; orchestrator posts comment to mock API |
| 8 | adwReview | reviewPhase | error — review rejected | G3, G4, G9, G11, W1, T5, T9 | Stub returns rejection; state records error stage without comment |
| 9 | adwReview | diffEvaluationPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Diff evaluation phase invoked post-review; state updated |
| 10 | adwMerge | autoMergePhase | happy | G4, G8, G10, G11, W1, T5, T7 | PR already merged in mock; auto-merge phase detects it; zero merge calls |
| 11 | adwMerge | autoMergePhase | edge — PR not yet merged | G4, G8, G11, W1, T5 | PR still open; phase polls; records at least one GET /pulls call |
| 12 | adwMerge | prPhase | happy | G3, G4, G9, G11, W1, T8, T5 | Stub returns PR payload; PR creation recorded in mock |
| 13 | adwChore | workflowInit + planPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Chore orchestrator: init + plan in one run; state at `plan_complete` |
| 14 | adwChore | buildPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Build phase within chore flow |
| 15 | adwChore | reviewPhase | happy | G3, G4, G8, G9, G11, W1, T2, T5 | Review phase posts comment |
| 16 | adwPatch | planPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Patch orchestrator drives plan phase |
| 17 | adwPatch | buildPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Patch orchestrator drives build phase |
| 18 | adwInit | installPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Init orchestrator runs install phase; state advances |
| 19 | adwInit | workflowInit | edge — already initialised | G4, G6, G11, W1, T5 | State file pre-exists at `initialized`; orchestrator should not reinitialize |
| 20 | adwTest | unitTestPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Test orchestrator drives unit test phase |
| 21 | adwTest | scenarioTestPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Scenario test phase runs; state advances |
| 22 | adwTest | scenarioProof | happy | G3, G4, G9, G11, W1, T1, T5 | Scenario proof phase validates passing tag set |
| 23 | adwTest | scenarioFixPhase | error path | G3, G4, G9, G11, W1, T5, T9 | Failing scenario triggers fix phase; error recorded if unresolvable |
| 24 | adwPrReview | prReviewPlanPhase | happy | G3, G4, G8, G9, G11, W1, T2, T5 | PR-review orchestrator posts a review comment |
| 25 | adwPrReview | prReviewBuildPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Build phase within PR-review flow |
| 26 | adwPrReview | commitPushPhase | happy | G3, G4, G9, G11, G2, W1, T11, T5 | PR-review orchestrator pushes amended commit; git-mock records push |
| 27 | adwDocument | documentPhase | happy | G3, G4, G8, G9, G11, W1, T2, T5 | Document orchestrator posts documentation comment |
| 28 | adwDocument | kpiPhase | happy | G3, G4, G9, G11, W1, T1, T5 | KPI phase runs after documentation; artefact written |
| 29 | adwSdlc | cron probe — empty queue | edge | G7, W10, T10, T5 | Cron sweep with no issues; zero GitHub API calls beyond the list request |
| 30 | adwSdlc | cron probe — dispatch | happy | G4, G7, W10, T2, T5 | Cron sweep finds one eligible issue and dispatches; comment posted |
| 31 | adwPlan | orchestratorLock — acquired | happy | G4, G5, G11, W1, T6, T5 | Lock acquired at start, released on success; exit 0 |
| 32 | adwBuild | orchestratorLock — re-entry | edge | G4, G6, G11, W1, T5 | Lock already held; orchestrator detects concurrent execution and exits non-zero |
| 33 | adwReview | planValidationPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Plan validation phase runs before review; state updated |
| 34 | adwReview | alignmentPhase | happy | G3, G4, G9, G11, W1, T1, T5 | Alignment phase ensures plan / implementation agreement |
| 35 | adwMerge | depauditSetup | happy | G3, G4, G9, G11, W1, T1, T5 | Dep-audit setup phase runs as precursor to merge checks |

---

## Gaps and Open Questions for Issue #2

1. **Git-mock invocation logging.** Steps T4 and T11 currently validate branch-name agreement via
   `World.targetBranch` only. Full git-mock invocation recording (storing the full argv of every
   intercepted `git` call) would allow stricter assertions. This can be added in Issue #2 as an
   extension to `git-remote-mock.ts` and `RegressionWorld`.

2. **Webhook handler surface.** Step W11 uses a synthetic POST to `/_mock/webhook`. The ADW
   orchestrators do not expose an HTTP webhook endpoint directly — this path may need a thin
   adapter or may be replaced by a direct SDLC subprocess invocation in Issue #2.

3. **scenarioPhase / stepDefPhase.** The `executeScenarioPhase` and `executeStepDefPhase` exports
   in `adws/phases/index.ts` are not covered by matrix rows above. They are candidates for
   `adwTest` surface cells but require vocabulary extensions (Given: a `.feature` file exists in
   the target worktree; Then: a step-definition file was written). Defer to Issue #2 discovery.

4. **prReviewCompletion.** `completePRReviewWorkflow` and `handlePRReviewWorkflowError` are
   exported phase helpers. No matrix row covers the completion path for PR-review yet — add in
   Issue #2 if coverage is needed.

5. **Rate-limit pause.** `handleRateLimitPause` is exported from `workflowCompletion`. An edge
   variant (orchestrator pauses on rate-limit response from mock API) is a known ADW failure mode
   (see `project_adw_issue6_rate_limit.md`). Add as a high-priority edge row in Issue #2.

6. **Vocabulary gap — `no pending review blocks merge`.** The auto-merge surface (rows 10–11)
   needs a Then phrase asserting the mock server recorded zero review-request calls. Add to
   vocabulary before Issue #2 scenario authoring.
