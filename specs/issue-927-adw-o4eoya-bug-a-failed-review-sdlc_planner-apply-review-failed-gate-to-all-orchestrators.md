# Bug: A failed review must stop every orchestrator that has a review loop

## Metadata
issueNumber: `927`
adwId: `o4eoya-bug-a-failed-review`
issueJson: `{"number":927,"title":"bug: a failed review must stop every orchestrator that has a review loop","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision record\n\nADR-0048 (`## Divergence`).\n\n## What to build\n\nAfter an exhausted review loop with blockers left, an orchestrator must write `review_failed` and stop. Today three orchestrators go on to open the pull request and write `awaiting_merge`:\n\n- `adwChore` (when the diff judge has escalated it into a review loop; it also pre-approves the PR)\n- `adwPlanBuildReview`\n- `adwPlanBuildTestReview`\n\nApply the same gate that `adwSdlc` uses to all three. A chore that the diff judge did not escalate has no review loop and is unaffected.\n\n## Acceptance criteria\n\n- [ ] In each of the three orchestrators, a review that ends with blockers writes `review_failed`, opens no pull request, approves nothing and does not write `awaiting_merge`.\n- [ ] A review that passes behaves as today.\n- [ ] Unit tests cover the failed and the passed path for each orchestrator.\n- [ ] The Divergence section of ADR-0048 is removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:19:53Z","comments":[],"actionableComment":null}`

## Bug Description
ADR-0048 decided that an orchestrator which exhausts its review retries with blockers left must write the `review_failed` stage and stop. `review_failed` is human-gated: the cron neither spawns nor merges it, and a human recovers it with `## Retry`. `adws/adwSdlc.tsx` and `adws/adwPrReview.tsx` follow this rule through the shared pure gate `decidePostReviewOutcome(reviewPassed)`.

Three other orchestrators run the same review → patch → retest loop but never look at `reviewPassed` afterwards:

- **`adws/adwChore.tsx`** runs a review loop only when the diff judge returns something other than `safe`. After the loop it runs the document phase, opens the PR, pre-approves it when the issue has no `hitl` label, and writes `awaiting_merge`. `reviewPassed` is only stored in metadata.
- **`adws/adwPlanBuildReview.tsx`** opens the PR and writes `awaiting_merge` after the loop.
- **`adws/adwPlanBuildTestReview.tsx`** opens the PR, publishes the scenario proof and writes `awaiting_merge` after the loop.

**Actual behaviour:** a review that still has blockers after `MAX_REVIEW_RETRY_ATTEMPTS` ends in an open PR and the `awaiting_merge` stage. The cron then dispatches `adwMerge`. For a chore without `hitl`, ADW has also approved the PR, and the stateless merge gate is open (no `hitl` label; ADR-0038 rule 1), so broken work merges unattended. The false green on #840 (2026-09-22) was a run of this kind.

**Expected behaviour:** the same as `adwSdlc`. Write `review_failed` to top-level state, post the `review_failed` issue comment (branch name plus the `## Retry` instruction), persist cost and metadata with `reviewPassed: false`, and stop cleanly. That means no document phase, no PR, no proof publish, no approval, no `awaiting_merge`, no error path and no non-zero exit. A review that passes, on its first attempt or after a patch, behaves as today. A chore the diff judge classes `safe` has no review loop and is unaffected.

## Problem Statement
Each orchestrator writes its own copy of the review loop and of the code that runs after it. Three of the five orchestrators with a review loop never consult `decidePostReviewOutcome`, so a failed review falls through to PR creation and `awaiting_merge`. None of the three can be driven by a test either: each calls `main()` when the module loads, and reaches its phases through static imports. Neither a unit test nor a BDD step could exercise it without starting real agents.

## Solution Statement
1. **Apply the gate `adwSdlc` uses (`adws/adwSdlc.tsx:91-112`) to the three orchestrators**, straight after each review loop:
   ```ts
   const outcome = decidePostReviewOutcome(reviewPassed);
   if (outcome.skipDocAndPR) {
     executeSdlcReviewFailedHandoff({ adwId: config.adwId, issueNumber: config.issueNumber, repoContext: config.repoContext, ctx: config.ctx });
     AgentStateManager.writeState(config.orchestratorStatePath, { metadata: { /* the orchestrator's own fields */, reviewPassed: false, totalReviewRetries: reviewRetries } });
     persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
     return;
   }
   ```
   In `adwChore.tsx` the gate goes inside the escalation branch, before the document phase. The `safe` path never reaches it.
2. **Add a seam to each orchestrator that tests can drive**, modelled on `adwMerge.tsx` (`executeMerge` with injectable `MergeDeps`, and `main()` behind an `import.meta.url` guard). It is also the shape the step-definition notes of `features/per-issue/feature-927.feature` require. Each orchestrator gets:
   - **An exported entry point** that runs what `main()` runs today inside `runWithOrchestratorLifecycle`: it creates the `CostTracker`, runs the phases, and catches errors with `handleAuthRequiredPause`/`handleWorkflowError`. Its inputs are the `WorkflowConfig` and the phase functions, with the real phases as the default:
     - `executeChore(config, phases = CHORE_PHASES)`
     - `executePlanBuildReview(config, phases = PLAN_BUILD_REVIEW_PHASES)`
     - `executePlanBuildTestReview(config, phases = PLAN_BUILD_TEST_REVIEW_PHASES)`
   - **An exported phases interface**: `ChorePhases`, `PlanBuildReviewPhases` or `PlanBuildTestReviewPhases`. It has one `readonly` field per phase function the script imports from `./workflowPhases` today, typed `typeof <phase>`.
   - **A private phase-sequence function** that holds today's `try` body and reaches every phase through `phases.<name>`.
   - **A `main()` that runs only when the file is executed directly**, through the same guard as `adwMerge`. It calls `runWithOrchestratorLifecycle(config, () => executeChore(config))`.
3. **Add unit tests** for the failed and the passed path of each orchestrator, plus the unescalated chore. They inject fake phases through the new parameter.
4. **Remove the `## Divergence` section of ADR-0048.** Then fix the comments and living docs that name `adwSdlc` as the only caller of the gate.

These parts need no change because they already work for any orchestrator:
- `decidePostReviewOutcome` and `executeSdlcReviewFailedHandoff`.
- The stage classifier: `review_failed` is classed `human_gated`.
- The cron filter.
- The `## Retry` handler: it re-arms `review_failed` to `phase_timeout`.
- Resume routing: `resolveResumeSpawn` reads the `orchestratorScript` that `initializeWorkflow` persists through `deriveOrchestratorScript`. That is `adws/adwChore.tsx`, `adws/adwPlanBuildReview.tsx` or `adws/adwPlanBuildTestReview.tsx`, and the stop path does not overwrite it.

## Steps to Reproduce
1. **Read the code.** Run `grep -c "decidePostReviewOutcome(" adws/adwSdlc.tsx adws/adwChore.tsx adws/adwPlanBuildReview.tsx adws/adwPlanBuildTestReview.tsx`. It prints `1`, `0`, `0`, `0`: only `adwSdlc` applies the gate.
2. **Show the behaviour with the new unit tests.**
   - Do step 1 of the tasks (the seam, with no behaviour change), then step 2 (the tests).
   - Run `bunx vitest run adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts`.
   - Every failed-path case fails with `AssertionError: expected [ 'awaiting_merge' ] to deeply equal [ 'review_failed' ]`. The PR phase is called, and for the chore so are the document phase and `codeHost.approvePullRequest`.
   - The passed-path cases and the `safe`-chore case pass.
   - This was checked during planning in a scratch copy outside the worktree, for all three orchestrators.
3. **Show it with the issue's BDD scenarios.** Once the step definitions exist, `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-927"` fails in §1 and §2 before the fix. §3, §4 and §5 pass.
4. **The production path (described, not run).** Take a `/chore` issue with no `hitl` label and a diff the judge classes `regression_possible`, whose review returns a blocker on all `MAX_REVIEW_RETRY_ATTEMPTS` attempts.
   - Today: an escalation comment, three review comments, a PR approved by ADW and the `awaiting_merge` stage; the next cron tick merges it.
   - After the fix: the `review_failed` stage and a comment naming the branch with `## Retry` instructions. No PR is opened.

## Root Cause Analysis
- **Only two orchestrators were wired to the gate.** ADR-0048's gate went into `adwSdlc.tsx` (#720) and `adwPrReview.tsx` (#719, #721). The orchestrators that carry their own copy of the review loop were not touched: `adwChore.tsx` (escalation branch), `adwPlanBuildReview.tsx` and `adwPlanBuildTestReview.tsx`.
- **Nothing makes a caller apply the gate.** The loop and the code after it are inlined in each orchestrator. The doc comment of `decidePostReviewOutcome` addresses only "SDLC callers". No test or CI check verifies that every orchestrator with a review loop applies the gate; ADR-0048's Confirmation says "No CI gate checks that every orchestrator uses the gate".
- **In `adwChore.tsx` the verdict is only recorded.** `reviewPassed` is `boolean | undefined` and feeds only the metadata (`diffVerdict`, `reviewPassed`). The pre-approval that follows makes the omission dangerous: with no `hitl` label, the merge gate is open.
- **No test could catch it.** The three orchestrators call `main()` unconditionally at module load and import their phases statically, so no test could drive them past the review loop.

## Relevant Files
Use these files to fix the bug:

- **`adws/adwChore.tsx`**
  - Lines 89-114: the escalation branch runs the review loop, then always runs the document phase.
  - Lines 116-134: open the PR, pre-approve it when there is no `hitl` label, write `awaiting_merge`.
  - Changes: the seam, and the gate after the loop and before the document phase.
- **`adws/adwPlanBuildReview.tsx`**
  - The review loop is at lines 63-80, followed by `executePRPhase` (line 82) and `awaiting_merge` (line 84).
  - Changes: the seam, and the gate between the loop and the PR phase.
- **`adws/adwPlanBuildTestReview.tsx`**
  - The review loop is at lines 67-85, followed by `executePRPhase` (line 87), `executeProofPublishPhase` (line 88) and `awaiting_merge` (line 90).
  - Changes: the seam, and the gate before the PR phase.
- **`adws/adwSdlc.tsx`**: the reference implementation of the gate (lines 91-112). Read only; not changed.
- **`adws/adwMerge.tsx`**: the precedent for the seam. It has the injectable `MergeDeps` interface (`readonly` fields, some typed `typeof <fn>`), the exported `executeMerge`, and `main()` behind the guard at lines 271-274. `adws/adwUpgrade.tsx` (lines 501-504) has the same guard.
- **`adws/phases/decidePostReviewOutcome.ts`**: the shared pure gate. Its logic is unchanged. The doc comment at line 13 ("SDLC callers must honour skipDocAndPR…") is widened to every orchestrator with a review loop.
- **`adws/phases/sdlcReviewHandoff.ts`**
  - `executeSdlcReviewFailedHandoff` writes only `{ workflowStage: 'review_failed' }` to top-level state, posts the `review_failed` comment (branch plus `## Retry`) and logs.
  - The three orchestrators reuse it unchanged. Its doc comment at line 20 ("Called by adwSdlc.tsx…") is widened.
- **`adws/__tests__/adwMerge.test.ts`**: the location and naming convention for orchestrator unit tests.
- **`adws/phases/__tests__/scenarioTestFixLoop.test.ts`**: the existing pattern for `vi.mock` of `core/phaseRunner` (`runPhase` passthrough) and of the `core` barrel (constants, `AgentStateManager`, `log`).
- **`adws/core/phaseRunner.ts`**: `runPhase`, `runPhasesParallel` and `CostTracker`. The real `runPhase` writes top-level state for named phases through `./agentState`, so the unit tests replace it with a passthrough.
- **`adws/workflowPhases.ts`**: the barrel each orchestrator imports its phases from. The default phase objects are built from these imports.
- **`adws/agents/reviewAgent.ts`**: the `ReviewIssue` shape (`reviewIssueNumber`, `issueDescription`, `issueResolution`, `issueSeverity`, optional `remediationStrategy`), used by the test fixtures.
- **`adws/phases/reviewPhase.ts`**: the shape of `executeReviewPhase`'s result (`reviewPassed`, `reviewIssues`).
- **`adws/forge/workflowCommentsIssue.ts`**: `formatReviewFailedComment` produces the comment naming the branch and the `## Retry` instruction, which both the tests and the scenarios assert on.
- **`adws/adwBuildHelpers.ts`**: `extractPrNumber`, used by the chore pre-approval.
- **`adws/core/orchestratorNames.ts`**, **`adws/core/resolveResumeSpawn.ts`**, **`adws/triggers/retryHandler.ts`**, **`adws/core/stageClassifier.ts`**, **`adws/triggers/cronIssueFilter.ts`**: confirm that `review_failed` handling and `## Retry` routing already work for all three orchestrators. No change.
- **`features/per-issue/feature-927.feature`**: this issue's BDD scenarios, written by the scenario writer. Its step-definition notes fix the seam:
  - The entry point takes the `WorkflowConfig` and the phase functions, with the real phases as defaults.
  - `main()` sits behind an `import.meta.url` guard.
  - The scenarios fake only the phases and run the real review loop, gate and stop path.
  - The scenarios require a clean ending with no non-zero exit, the comment naming the branch with `## Retry`, a resume through the real `resolveResumeSpawn` that launches the same orchestrator, and the gate fed the loop's final verdict.
  - Read only; the step definitions are generated in a later phase.
- **`specs/adr/0048-one-adwid-per-issue-and-review-failed-gate.md`**: the specification. Its `## Divergence` section (lines 65-73) is removed.
- **`.claude/skills/write-an-adr/SKILL.md`**: "What may change after an ADR is accepted" allows edits only to `status`, `superseded-by`, `## Divergence` and the supersession note. This limits the ADR edit to the Divergence section.
- **`specs/adr/0027-llm-diff-gate-for-chores.md`**: the chore escalation decision. Context only; not edited (see Notes).
- **`README.md`**: the `adws/__tests__/` tree, which gains three test files.
- **`adws/README.md`**: the `adwChore.tsx` section says `regression_possible` → review → document → auto-merge (line 297). It must mention the `review_failed` stop.
- **`app_docs/feature-9gjajh-pr-and-merge-phases.md`**: conditional doc. It owns `decidePostReviewOutcome.ts`; its condition is post-review-outcome routing and `executeSdlcReviewFailedHandoff`. It says the handoff is "called by `adwSdlc.tsx`".
- **`app_docs/feature-9gjajh-takeover-and-coordination.md`**: conditional doc. It owns `sdlcReviewHandoff.ts`; its condition is `review_failed` / SDLC review-handoff recovery. It says "`adwSdlc.tsx` then persists cost/metadata and returns".
- **`app_docs/feature-9gjajh-feature-orchestrators.md`**: conditional doc that owns `adwChore.tsx`.
- **`app_docs/feature-9gjajh-sdlc-orchestrators.md`**: conditional doc that owns `adwPlanBuildReview.tsx` and `adwPlanBuildTestReview.tsx`.
- **`features/regression/smoke/adw_chore_diff_verdicts.feature`**: its escalated-chore scenario expects `awaiting_merge`. Its When step returns `pending` (`features/regression/step_definitions/whenSteps.ts`), so it never runs the orchestrator. No change.

### New Files
- `adws/__tests__/adwChore.test.ts`: unit tests for `executeChore` on the escalated failed, escalated passed and `safe` paths.
- `adws/__tests__/adwPlanBuildReview.test.ts`: unit tests for `executePlanBuildReview` on the failed and passed paths.
- `adws/__tests__/adwPlanBuildTestReview.test.ts`: unit tests for `executePlanBuildTestReview` on the failed and passed paths.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Give the three orchestrators an injectable seam (no behaviour change)
Do this for each orchestrator, modelled on `adwMerge.tsx`. The chore names are used below; the other two follow the same pattern.
- **The phases interface and its default.** Export `interface ChorePhases` with one `readonly` field per phase function the script imports from `./workflowPhases` today, typed `typeof <that function>`. Add `const CHORE_PHASES: ChorePhases = { … }`, built from the existing named imports. The sets are:
  - `ChorePhases`: `executeInstallPhase`, `executePlanPhase`, `executeBuildPhase`, `executeStepDefPhase`, `executeUnitTestPhase`, `runScenarioTestFixLoop`, `executeDiffEvaluationPhase`, `executeReviewPhase`, `executeReviewPatchCycle`, `executeScenarioTestPhase`, `executeDocumentPhase`, `executePRPhase`.
  - `PlanBuildReviewPhases`: `executeInstallPhase`, `executePlanPhase`, `executeScenarioPhase`, `executeAlignmentPhase`, `executeBuildPhase`, `executeUnitTestPhase`, `executeScenarioTestPhase`, `executeReviewPhase`, `executeReviewPatchCycle`, `executePRPhase`. Its default is `PLAN_BUILD_REVIEW_PHASES`.
  - `PlanBuildTestReviewPhases`: `executeInstallPhase`, `executePlanPhase`, `executeScenarioPhase`, `executeAlignmentPhase`, `executeBuildPhase`, `executeStepDefPhase`, `executeUnitTestPhase`, `runScenarioTestFixLoop`, `executeScenarioTestPhase`, `executeReviewPhase`, `executeReviewPatchCycle`, `executePRPhase`, `executeProofPublishPhase`. Its default is `PLAN_BUILD_TEST_REVIEW_PHASES`.
  - `initializeWorkflow` and `handleWorkflowError` stay direct imports and are not injected.
- **The phase sequence.** Move the statements inside today's `try { … }`, from the install phase through the closing `log('===================================', 'info');`, into a private function:
  - `async function runChorePhases(config: WorkflowConfig, tracker: CostTracker, phases: ChorePhases): Promise<void>`, or `runPlanBuildReviewPhases` / `runPlanBuildTestReviewPhases`.
  - Change each phase reference to `phases.<name>`, for example `runPhase(config, tracker, phases.executeInstallPhase)`, `runPhasesParallel(config, tracker, [phases.executePlanPhase, phases.executeScenarioPhase])`, `phases.runScenarioTestFixLoop(config, tracker)` and `(cfg: WorkflowConfig) => phases.executeReviewPhase(cfg, proofPath)`.
  - Change nothing else.
  - `adwChore.tsx` uses `issueNumber` for `fetchLabels` and in log lines. Inside `runChorePhases`, take it from the config (`const { issueNumber } = config;`).
- **The exported entry point.** It is today's lifecycle callback body:
  ```ts
  export async function executeChore(config: WorkflowConfig, phases: ChorePhases = CHORE_PHASES): Promise<void> {
    const tracker = new CostTracker();
    try {
      await runChorePhases(config, tracker, phases);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        handleAuthRequiredPause(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
      }
      handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
    }
  }
  ```
  `executePlanBuildReview(config, phases = PLAN_BUILD_REVIEW_PHASES)` and `executePlanBuildTestReview(config, phases = PLAN_BUILD_TEST_REVIEW_PHASES)` follow the same shape.
- **`main()`.** Keep argument parsing, `buildRepoIdentifier` and `initializeWorkflow`. The lifecycle call becomes `if (!await runWithOrchestratorLifecycle(config, () => executeChore(config))) { … }`, with the existing lock-held log and `process.exit(0)`.
- **The guard.** Replace the trailing `main();` with the guard used by `adwMerge.tsx` and `adwUpgrade.tsx`:
  ```ts
  // Only run when executed directly — not when imported as a module (e.g. in tests).
  if (import.meta.url === `file://${process.argv[1]}`) {
    main();
  }
  ```
- Leave `postEscalationComment`, the usage headers and every log message unchanged.
- **Check.**
  - `bunx tsc --noEmit -p adws/tsconfig.json` is clean.
  - From the repository root, `bunx tsx adws/adwChore.tsx 2>&1 | grep -q "Usage: bunx tsx adws/adwChore.tsx"` succeeds, which proves the guarded `main()` still runs when the file is executed directly.
  - Repeat that check for `adwPlanBuildReview.tsx` and `adwPlanBuildTestReview.tsx`.

### 2. Write the unit tests (the failed-path cases go RED)
Create the three test files in `adws/__tests__/`. Planning checked this setup in a scratch copy: vitest, both `tsc` configurations and eslint all passed.
- **Fake the phases through the new parameter.** Do not `vi.mock('../workflowPhases')`. Build a fresh fake-phases object per test with a `vi.fn()` per field, and pass it as `executeChore(config, phases as unknown as ChorePhases)` (or the PlanBuild equivalents).
  - Every phase resolves `{ costUsd: 0, modelUsage: {}, phaseCostRecords: [] }`, except these:
    - `executeUnitTestPhase` adds `unitTestsPassed: true, totalRetries: 0`.
    - `runScenarioTestFixLoop` resolves `{ scenarioProofPath: '/proof.md', scenarioRetries: 0 }`.
    - `executeScenarioTestPhase` adds `scenarioProof: undefined`.
    - The chore's `executeDiffEvaluationPhase` adds `verdict` (`'regression_possible'` or `'safe'`) and `reason`.
    - `executeReviewPhase` returns the scripted verdict.
  - In the chore test, `executePRPhase` sets `cfg.ctx.prUrl = 'https://github.com/acme/widget/pull/77'`, so the pre-approval has a PR number.
- **Module mocks.** `vi.mock` factories are hoisted, so they must not reference module-level variables.
  ```ts
  vi.mock('../core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../core')>();
    return {
      ...actual,
      MAX_REVIEW_RETRY_ATTEMPTS: 3,
      AgentStateManager: { writeTopLevelState: vi.fn(), writeState: vi.fn() },
      log: vi.fn(),
    };
  });
  vi.mock('../core/phaseRunner', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../core/phaseRunner')>();
    return {
      ...actual, // keeps the real CostTracker
      runPhase: vi.fn(async (config, _tracker, fn) => fn(config)),
      // PlanBuild*Review only:
      runPhasesParallel: vi.fn(async (config, _tracker, fns: Array<(c: unknown) => Promise<unknown>>) => Promise.all(fns.map(fn => fn(config)))),
    };
  });
  vi.mock('../cost', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../cost')>();
    return { ...actual, persistTokenCounts: vi.fn() };
  });
  ```
  - `runPhase` is replaced because the real one writes top-level state for named phases (`stepDef`) through `./agentState`, which bypasses the mocked barrel.
  - Do not mock `decidePostReviewOutcome` or `executeSdlcReviewFailedHandoff`; the tests prove the gate's effect. The handoff imports `AgentStateManager` and `log` from the `adws/core` barrel, so its writes land in the mocked `AgentStateManager`.
- **Config.** Use a minimal object cast `as unknown as WorkflowConfig`, built fresh per test:
  - `issueNumber: 42`, `adwId`, `orchestratorStatePath`, and `ctx: { issueNumber: 42, adwId, branchName }`.
  - `repoContext: { issueTracker: { commentOnIssue: vi.fn(), fetchLabels: vi.fn(() => [] as string[]) }, codeHost: { approvePullRequest: vi.fn(() => ({ success: true })) } }`.
- **Review results.**
  - Failed, returned on every attempt: `reviewPassed: false` with `reviewIssues: [{ reviewIssueNumber: 1, issueDescription: 'broken', issueResolution: 'fix it', issueSeverity: 'blocker' }]` (a `ReviewIssue` has no `screenshotPath`).
  - Passed: `reviewPassed: true, reviewIssues: []`.
- **Helper.** Collect the `workflowStage` of each `AgentStateManager.writeTopLevelState` call, so a test can assert the exact sequence (for example `['review_failed']`).
- `beforeEach(() => vi.clearAllMocks())`.

Cases:
- **`adwChore.test.ts`**
  1. *Escalated, review ends with blockers.* The verdict is `regression_possible` and the review always fails.
     - The review is called 3 times and the patch cycle 2 times.
     - The stages written are exactly `['review_failed']`.
     - The document phase, the PR phase and `repoContext.codeHost.approvePullRequest` are not called.
     - `AgentStateManager.writeState` is called with `('<statePath>', { metadata: expect.objectContaining({ reviewPassed: false, totalReviewRetries: 3, diffVerdict: 'regression_possible' }) })`.
     - `persistTokenCounts` is called.
     - `repoContext.issueTracker.commentOnIssue` is called with `(42, expect.stringContaining('## Retry'))`.
  2. *Escalated, review passes.*
     - The review is called once and the document phase once.
     - The PR phase is called once and `approvePullRequest` with `77`.
     - The stages written are exactly `['awaiting_merge']`.
     - The metadata contains `reviewPassed: true`.
  3. *Not escalated (`safe`).*
     - Neither the review nor the document phase is called.
     - The PR phase is called once and `approvePullRequest` with `77`.
     - The stages written are exactly `['awaiting_merge']`. This is the unaffected path.
- **`adwPlanBuildReview.test.ts`**
  1. *Failed.*
     - The review is called 3 times and the patch cycle 2 times.
     - The stages written are exactly `['review_failed']` and the PR phase is not called.
     - The metadata contains `reviewPassed: false, totalReviewRetries: 3`.
     - `persistTokenCounts` is called and a comment containing `## Retry` is posted.
  2. *Passed.* The PR phase is called once and the stages written are exactly `['awaiting_merge']`.
- **`adwPlanBuildTestReview.test.ts`**
  1. *Failed.*
     - Everything asserted in the `adwPlanBuildReview` failed case.
     - The proof-publish phase is not called.
     - The metadata contains `scenarioRetries`.
  2. *Passed.* The PR and proof-publish phases are each called once, and the stages written are exactly `['awaiting_merge']`.

Run `bunx vitest run adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts`. The failed-path cases fail with `expected [ 'awaiting_merge' ] to deeply equal [ 'review_failed' ]`, which reproduces the bug. All other cases pass.

### 3. Apply the gate in `adws/adwPlanBuildReview.tsx`
- Add `import { decidePostReviewOutcome } from './phases/decidePostReviewOutcome';` and `import { executeSdlcReviewFailedHandoff } from './phases/sdlcReviewHandoff';` (the same imports as `adwSdlc.tsx`).
- In `runPlanBuildReviewPhases`, between the end of the review loop and `await runPhase(config, tracker, phases.executePRPhase);`, insert:
  ```ts
  const outcome = decidePostReviewOutcome(reviewPassed);
  if (outcome.skipDocAndPR) {
    executeSdlcReviewFailedHandoff({
      adwId: config.adwId,
      issueNumber: config.issueNumber,
      repoContext: config.repoContext,
      ctx: config.ctx,
    });
    AgentStateManager.writeState(config.orchestratorStatePath, {
      metadata: {
        totalCostUsd: tracker.totalCostUsd,
        unitTestsPassed: testResult.unitTestsPassed,
        totalTestRetries: testResult.totalRetries,
        reviewPassed: false,
        totalReviewRetries: reviewRetries,
      },
    });
    persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
    return;
  }
  ```
- The gate reads `reviewPassed` after the loop, so it sees the final verdict. A review that fails once and then passes still reaches the PR.
- The metadata has no `scenarioRetries`, because this orchestrator does not run the scenario fix loop. That matches its success-path metadata.

### 4. Apply the gate in `adws/adwPlanBuildTestReview.tsx`
- Add the same two imports.
- In `runPlanBuildTestReviewPhases`, insert the same block between the end of the review loop and `await runPhase(config, tracker, phases.executePRPhase);`, with `scenarioRetries,` added after `totalTestRetries`. Because the block sits before the PR phase, the proof publish is skipped too.

### 5. Apply the gate in `adws/adwChore.tsx` (escalated branch only)
- Add the same two imports.
- In `runChorePhases`, inside `if (diffResult.verdict !== 'safe') { … }`, insert the block after the review loop and before the document phase. The block must stay inside the escalation branch: the `safe` chore never runs a review and must never reach the gate.
  - Call `decidePostReviewOutcome(reviewPassed ?? false)`. Inside the branch, `reviewPassed` is typed `boolean | undefined`, and a loop that recorded no verdict must count as failed, as in `adwSdlc`, where `reviewPassed` starts at `false`.
  - Pass `issueNumber` (from `config`) to the handoff.
  - The metadata is `totalCostUsd`, `unitTestsPassed: testResult.unitTestsPassed`, `totalTestRetries: testResult.totalRetries`, `scenarioRetries`, `diffVerdict: 'regression_possible'`, `reviewPassed: false` and `totalReviewRetries: reviewRetries`.
  - The `return` skips the document phase, the PR, the pre-approval and `awaiting_merge`.
- Leave the `safe` path, the pre-approval block and the success metadata unchanged.

### 6. Update the doc comments of the shared gate modules
- `adws/phases/decidePostReviewOutcome.ts`: replace "SDLC callers must honour skipDocAndPR by exiting before doc+PR phases." with "Every orchestrator with a review loop must honour skipDocAndPR by stopping before its document and PR phases."
- `adws/phases/sdlcReviewHandoff.ts`: replace "Called by adwSdlc.tsx when decidePostReviewOutcome returns skipDocAndPR:true." with "Called by every orchestrator with a review loop when decidePostReviewOutcome returns skipDocAndPR: true." Keep the next sentence.
- Do not rename the function or the file (see Notes). No other change to these two modules.

### 7. Remove the Divergence section of ADR-0048
- In `specs/adr/0048-one-adwid-per-issue-and-review-failed-gate.md`, delete everything from the `## Divergence` heading (line 65) through the owner's ruling paragraph that ends "The false green on #840 (2026-09-22) was a chore run." (line 72), plus the blank line after it.
- One blank line must remain between the last Confirmation paragraph ("Unit tests also cover … No CI gate checks that every orchestrator uses the gate.") and `## More Information`.
- Change nothing else in the record: not the front matter, `### Confirmation` or `## More Information`. The write-an-adr rule allows only these edits to an accepted record.
- `specs/adr/README.md` needs no change; its index has no divergence column.

### 8. Bring the docs in line with the new callers and the new seam
- **`adws/README.md`** (line 297, `adwChore.tsx` section): change "`regression_possible` → review → document → auto-merge" to "`regression_possible` → review → document → auto-merge; a review that still has blockers after its retries stops at `review_failed` instead (no document, no PR, no approval)".
- **`README.md`**:
  - In the `adws/__tests__/` tree, add `adwChore.test.ts` before `adwMerge.test.ts`, and `adwPlanBuildReview.test.ts` and `adwPlanBuildTestReview.test.ts` after it, keeping alphabetical order.
  - Change nothing else in `README.md`, apart from the line-break repair described in Notes, if it applies.
- **`app_docs/feature-9gjajh-pr-and-merge-phases.md`**:
  - In the `decidePostReviewOutcome` bullet, say the gate is consumed by `completePRReviewWorkflow` and by `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview` and an escalated `adwChore`.
  - In the `executeSdlcReviewFailedHandoff` bullet, replace "the SDLC-side mirror — called by `adwSdlc.tsx` when …" so that it names all four callers. The chore calls it only after a diff-judge escalation.
  - In the invariant that ends "SDLC doesn't need it there because SDLC's own init already persists `orchestratorScript: 'adws/adwSdlc.tsx'`", say that each caller's `initializeWorkflow` persists its own `orchestratorScript`, so `## Retry` resumes the orchestrator that failed.
- **`app_docs/feature-9gjajh-takeover-and-coordination.md`**: in the `executeSdlcReviewFailedHandoff` bullet, replace "`adwSdlc.tsx` then persists cost/metadata and returns before the doc/PR phases run" with a clause naming the calling orchestrator: `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview` or an escalated `adwChore`.
- **`app_docs/feature-9gjajh-sdlc-orchestrators.md`**: add two bullets under `## Contracts & Invariants`:
  - `adwSdlc`, `adwPlanBuildReview` and `adwPlanBuildTestReview` pass the review loop's final `reviewPassed` to `decidePostReviewOutcome`. On `skipDocAndPR` they call `executeSdlcReviewFailedHandoff`, persist metadata with `reviewPassed: false` and return normally before any document, PR or proof-publish phase, so `awaiting_merge` is never written.
  - `adwPlanBuildReview` and `adwPlanBuildTestReview` export `executePlanBuildReview(config, phases?)` / `executePlanBuildTestReview(config, phases?)`. These run what `main()` runs inside `runWithOrchestratorLifecycle`, with the phase functions injectable (`PlanBuildReviewPhases` / `PlanBuildTestReviewPhases`, real phases by default). `main()` runs only when the file is executed directly.
- **`app_docs/feature-9gjajh-feature-orchestrators.md`**: add one bullet under `## Contracts & Invariants`.
  - `adwChore` runs a review loop only when the diff judge does not return `safe`.
  - An escalated chore whose review still has blockers after `MAX_REVIEW_RETRY_ATTEMPTS` applies `adwSdlc`'s gate: it writes `review_failed` and stops, with no document phase, no PR, no pre-approval and no `awaiting_merge`.
  - The orchestrator's entry point is `executeChore(config, phases?)`, with `ChorePhases` injectable and the real phases by default. `main()` runs only when the file is executed directly.
- **Do not edit `.adw/conditional_docs.md`.** No file is renamed, and `adws/__tests__/*.test.ts` files are not indexed (compare `adwMerge.test.ts`).

### 9. Run the validation commands
Run every command in `Validation Commands` below and confirm each passes.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- **Reproduce, then confirm the fix:** `grep -c "decidePostReviewOutcome(" adws/adwSdlc.tsx adws/adwChore.tsx adws/adwPlanBuildReview.tsx adws/adwPlanBuildTestReview.tsx`. Before the fix it prints `1 / 0 / 0 / 0`; after it, `1` for every file.
- **Targeted tests:** `bunx vitest run adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts adws/phases/__tests__/decidePostReviewOutcome.test.ts`. All pass. Before steps 3-5 the failed-path cases fail with `expected [ 'awaiting_merge' ] to deeply equal [ 'review_failed' ]`.
- **Guarded `main()` still runs when executed directly:**
  - `bunx tsx adws/adwChore.tsx 2>&1 | grep -q "Usage: bunx tsx adws/adwChore.tsx"`
  - `bunx tsx adws/adwPlanBuildReview.tsx 2>&1 | grep -q "Usage: bunx tsx adws/adwPlanBuildReview.tsx"`
  - `bunx tsx adws/adwPlanBuildTestReview.tsx 2>&1 | grep -q "Usage: bunx tsx adws/adwPlanBuildTestReview.tsx"`
  - Run all three from the repository root.
- **Lint:** `bun run lint`
- **Type checks:** `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`
- **Build:** `bun run build`
- **Full unit suite:** `bun run test:unit`. The planning baseline was 155 files and 2,635 tests passing; it must stay green, plus the new tests.
- **Docs index gate:** `bun run lint:docs-index`
- **ADR check:** `grep -c "^## Divergence" specs/adr/0048-one-adwid-per-issue-and-review-failed-gate.md` prints `0`.
- **This issue's BDD scenarios:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-927"`. All scenarios pass.
- **Regression suite:** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly.
  - The gate is a guard clause with an early `return`, as in `adwSdlc`.
  - The entry point owns error handling and the private sequence function owns the phases, one reason per function. This removes three levels of nesting compared with today's `main()`.
  - Each orchestrator stays well under 300 lines.
  - Comments say only why. Do not cite issue numbers in code comments.
  - The unit tests live in the co-located `adws/__tests__/`. They fake the agent-running phases through the public `phases` parameter and mock only the state, cost and log writes, never the gate.
- **No new libraries.**
- **Why this seam.**
  - It mirrors `adwMerge.tsx`: an injectable dependencies interface with real defaults, an exported entry point, and `main()` behind a guard.
  - It is what `features/per-issue/feature-927.feature`'s step-definition notes require. Cucumber cannot `vi.mock`, so the scenarios need the phases injectable, and they call the entry point with only a `WorkflowConfig` and fake phases.
  - The same seam serves the unit tests, so the issue's unit-test criterion and its scenarios exercise one code path.
- **Guard caveat seen during planning.** The guard compares `import.meta.url`, which is symlink-resolved, with the unresolved `process.argv[1]`.
  - Running a script through a symlinked absolute path skips `main()` silently. Example: `/tmp/...` on macOS, where `/tmp` is a link to `/private/tmp`.
  - The triggers spawn `${REPO_ROOT}/adws/...` (and resolve relative script paths against `REPO_ROOT` in `spawnDetached`). `REPO_ROOT` is derived from `import.meta.url`, and relative invocations resolve against the physical working directory. So no launch path is affected, and the same guard already launches `adwMerge` in production.
  - Keep the guard identical to `adwMerge`'s. The direct-execution check in Validation Commands confirms `main()` still runs.
- **`reviewPassed ?? false` in the chore.** It types the escalated branch's final verdict. It is harmless only because the gate sits inside the escalation branch. Feature-927 §4 fails for a chore gate placed where a `safe` chore, which has no verdict, would reach it.
- **`executeSdlcReviewFailedHandoff` keeps its name** to keep the diff surgical; only its doc comment changes. A rename to an orchestrator-neutral name (with `.adw/conditional_docs.md`, `README.md` and the app_docs updated in step) would be a separate follow-up.
- **Recovery is unchanged.**
  - The handoff writes only the stage, never `orchestratorScript`. A `## Retry` on `review_failed` re-arms it to `phase_timeout`, and the resume launches the orchestrator that stopped; feature-927 §2 checks this.
  - `reviewPhase.ts` still posts its own `review_failed` comment on each failed attempt; the handoff posts the terminal comment that names the branch. Several such comments on one issue are known, accepted behaviour (see `app_docs/feature-9gjajh-takeover-and-coordination.md`).
- **Not in scope:**
  - `adwSdlc.tsx` and `adwPrReview.tsx` already apply the gate and keep their current structure.
  - The review loop copied across the orchestrators is left as it is.
  - The pending escalated-chore smoke scenario keeps its expectation, which still holds for a passing review.
  - The step definitions for `feature-927.feature` are generated by their own phase.
- **ADR text deliberately left alone; raise it with the owner in the PR description.** The write-an-adr rule allows edits only to `status`, `superseded-by`, `## Divergence` and the supersession note, and the issue limits the ADR change to removing ADR-0048's Divergence. These statements become stale but are not edited:
  - ADR-0027, `## More Information` → "Related", first bullet ("`adwChore.tsx` does not test `reviewPassed` after the loop. That divergence is recorded in ADR-0048").
  - ADR-0048, `## More Information`, last bullet ("Whether an issue has been filed for the divergence was not checked").
  - ADR-0048's dated `### Confirmation`, which names only `adwSdlc` and `adwPrReview` as callers.
- **`README.md` edit that predates this plan.** `README.md` arrived in this worktree with an uncommitted edit that is not part of this issue. In the `adws/core/` tree, the `adwLabels.ts` entry and the `│   ├── adwVersion.ts …` entry are joined on one line. The plan commit stages every file (ADR-0056 Divergence), so this may already be on the branch. If it is, put the `adwVersion.ts` entry back on its own line when you edit `README.md` in step 8, and change nothing else in that part of the tree.
- **Checked during planning, in a scratch copy outside the worktree** (nothing in the worktree was changed):
  - With the injectable seam and the gate, every planned case passed under vitest with the real `./workflowPhases` imported.
  - Without the gate, each failed-path case failed with `expected [ 'awaiting_merge' ] to deeply equal [ 'review_failed' ]`.
  - `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json` and eslint were clean.
  - The guarded scripts still printed their usage when run directly from the repository root.
