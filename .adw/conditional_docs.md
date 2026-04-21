# Conditional Documentation

- app_docs/feature-hk12ct-kpi-commits-land-on-default-branch.md
  - Conditions:
    - When working with `commitAndPushKpiFile()` in `adws/vcs/commitOperations.ts`
    - When KPI commits are appearing on feature branches or open PRs instead of the default branch
    - When implementing any VCS operation that must commit to the default branch without mutating the active worktree
    - When troubleshooting temp worktree cleanup (`adw-kpi-*` entries in `git worktree list`)
    - When adding tests for command-sequence correctness in `adws/vcs/__tests__/`

- app_docs/feature-nrr167-hitl-label-gate-adwmerge.md
  - Conditions:
    - When working with the `hitl` label gate in `adwMerge.tsx` or `autoMergePhase.ts`
    - When implementing or troubleshooting merge-blocking behavior on the `awaiting_merge` cron path
    - When a PR labeled `hitl` is being merged unexpectedly by the cron sweep
    - When extending `MergeDeps` with new injectable dependencies in `adwMerge.tsx`
    - When adding regression coverage for the `@adw-329-hitl-label-gate` BDD feature

- app_docs/feature-6wnymj-shared-orchestrator-lifecycle-wrapper.md
  - Conditions:
    - When adding a new orchestrator entrypoint that needs lock, heartbeat, and cleanup wiring
    - When troubleshooting an orchestrator that appears hung but is not detected by the staleness checker (`adwChore`, `adwInit`, `adwPatch`, `adwMerge` now covered)
    - When working with `runWithOrchestratorLifecycle` or `runWithRawOrchestratorLifecycle` in `adws/phases/orchestratorLock.ts`
    - When investigating why a lock file was not released (process.exit inside fn skips finally)
    - When writing unit tests for orchestrator lifecycle call-order assertions

- app_docs/feature-29w5wf-reclassify-abandoned-discarded-call-sites.md
  - Conditions:
    - When working with `adwMerge.tsx` exit paths and their `workflowStage` writes (`pr_closed`, `merge_failed`)
    - When working with `handlePullRequestEvent` PR-closed state write in `webhookHandlers.ts`
    - When troubleshooting issues that were operator-closed or merge-failed but are still being respawned
    - When extending `handleIssueClosedEvent` dependency-cascade logic for new terminal stages
    - When understanding the distinction between `MergeRunResult.outcome` (dispatcher label) and `workflowStage` (cron-sweeper classification)

- app_docs/feature-nq7174-discarded-workflow-stage-foundation.md
  - Conditions:
    - When adding new `WorkflowStage` values and need to understand terminal vs. retriable stage semantics
    - When working with `handleWorkflowDiscarded` or the `discarded` stage write path
    - When troubleshooting issues that are still being re-spawned despite being intentionally terminated
    - When implementing slice #2 reclassification of deliberate-terminal exit sites in `adwMerge.tsx` or `webhookHandlers.ts`
    - When working with `cronIssueFilter.evaluateIssue` or `cronStageResolver.isRetriableStage`

- app_docs/feature-djtyv4-remote-reconcile-module.md
  - Conditions:
    - When working with `deriveStageFromRemote`, `mapArtifactsToStage`, or `ReconcileDeps` in `adws/core/remoteReconcile.ts`
    - When implementing or troubleshooting stage reconciliation between local state files and remote GitHub artifacts
    - When wiring `deriveStageFromRemote` into `takeoverHandler` (slice #11 per orchestrator-coordination-resilience PRD)
    - When investigating GitHub API read-your-write lag affecting WorkflowStage derivation
    - When working with the `'discarded'` WorkflowStage literal or the `defaultFindPRByBranch`/`RawPR` shared helpers in `adws/github/prApi.ts`

- app_docs/feature-elre2t-fix-board-column-order-ids.md
  - Conditions:
    - When working with `ensureColumns`, `mergeStatusOptions`, or `updateStatusFieldOptions` in `githubBoardManager.ts`
    - When troubleshooting blank Status cells on GitHub Projects V2 boards after ADW programmatically adds a column
    - When investigating column ordering bugs (new columns appearing to the right of Done instead of in canonical position)
    - When extending the board column merge logic or adding new ADW columns to `BOARD_COLUMNS`
    - When writing or updating unit tests for `mergeStatusOptions` (ordering and ID-preservation contracts)

- app_docs/feature-xlv8zk-process-liveness-module.md
  - Conditions:
    - When working with `isProcessLive`, `getProcessStartTime`, or `processLiveness.ts`
    - When implementing or debugging PID-reuse-safe liveness checks in ADW
    - When working with `spawnGate.ts` spawn lock acquisition or stale-lock reclaim logic
    - When `isAgentProcessRunning` or `AgentState.pidStartedAt` is relevant
    - When migrating remaining `isProcessAlive` call sites to the new `processLiveness` module

- app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md
  - Conditions:
    - When working with `classifyAndSpawnWorkflow` in `webhookGatekeeper.ts` or the cron/webhook trigger paths
    - When implementing or troubleshooting cross-process spawn deduplication for SDLC orchestrators
    - When investigating duplicate orchestrator spawns for the same (repo, issue) pair
    - When working with `adws/triggers/spawnGate.ts` or the `agents/spawn_locks/` directory
    - When a dependent issue has two `## :rocket: ADW Workflow Started` comments with different adw-ids

- app_docs/feature-oev65s-depaudit-triage-issue-filing.md
  - Conditions:
    - When working with the major-bump issue filing path in `/depaudit-triage` (Action 1, major case)
    - When working with the upstream-issue filing path in `/depaudit-triage` (Action 3)
    - When troubleshooting `gh issue create` failures in the triage skill (major-bump or upstream paths)
    - When the OSV `upstreamIssue` convention (URL embedded in `reason`) is relevant
    - When implementing or extending the idempotency guard for issue-filing actions

- app_docs/feature-o28sw7-depaudit-triage-issue-filing.md
  - Conditions:
    - When working with Action 1 major-bump filing flow or Action 3 upstream-issue filing flow in `/depaudit-triage`
    - When modifying the `gh issue create` invocations or issue title/body format in `SKILL.md`
    - When troubleshooting idempotency re-checks inside Action 1 or Action 3 (belt-and-braces guard)
    - When the OSV-scanner TOML `upstreamIssue` embedding convention (`reason` field URL format) needs to be understood
    - When adding new filing paths or expiry-cap logic to the triage skill

- app_docs/feature-1w5uz8-depaudit-triage-skill.md
  - Conditions:
    - When working with or invoking the `/depaudit-triage` Claude Code skill
    - When modifying `.claude/skills/depaudit-triage/SKILL.md` or the triage workflow prompt
    - When writing accept entries to `.depaudit.yml` (`supplyChainAccepts`) or `osv-scanner.toml` (`[[IgnoredVulns]]`)
    - When troubleshooting idempotency behavior (in-flight findings with `upstreamIssue`)

- app_docs/feature-yx99nx-depaudit-minor-patch-upgrade.md
  - Conditions:
    - When working with the `upgrade parent` action in `/depaudit-triage` (Action 1 in SKILL.md)
    - When troubleshooting the minor/patch autonomous upgrade flow (manifest edit, cancel revert, install failure revert)
    - When understanding major-bump refusal behavior and the no-partial-bump guarantee
    - When adding new ecosystems to the manifest detection or install command resolution table

- app_docs/feature-4r5z44-depaudit-triage-minor-patch-upgrade.md
  - Conditions:
    - When working with the `upgrade parent` action in `/depaudit-triage` (Action 1 in SKILL.md) for issue #437
    - When implementing or extending the autonomous minor/patch upgrade flow (semver parsing, manifest edit, install, revert)
    - When troubleshooting the cancel-before-install prompt or manifest revert on install failure
    - When the skill refuses a major bump and you need context on what lands in the follow-up issue
    - When configuring `## Install Dependencies` in `.adw/commands.md` for a target repo

- app_docs/feature-670i6z-dead-schema-cleanup.md
  - Conditions:
    - When working with `adws/core/projectConfig.ts` and the `CommandsConfig` interface or `HEADING_TO_KEY` map
    - When adding or removing a schema field from `CommandsConfig` and need to know all three touch-points
    - When troubleshooting unexpected fields (or missing fields) in `.adw/commands.md` parsing
    - When working with `AgentIdentifier` union type in `adws/types/agentTypes.ts`
    - When wondering why `REVIEW_AGENT_COUNT` is not a valid env var (review parallelism was removed in #401)

- app_docs/feature-s59wpc-adwprreview-phaserunner-migration.md
  - Conditions:
    - When working with `adws/adwPrReview.tsx` or the PR review orchestrator
    - When working with `adws/phases/prReviewPhase.ts` or `prReviewCompletion.ts`
    - When adding a new phase to the PR review workflow (follow closure-wrapper pattern)
    - When troubleshooting rate-limit pause/resume for PR review workflows
    - When debugging D1 cost posting or `phaseCostRecords` in PR review phases

- app_docs/feature-1bg58c-scenario-test-fix-phases.md
  - Conditions:
    - When working with `adws/phases/scenarioTestPhase.ts` or `adws/phases/scenarioFixPhase.ts`
    - When adding or modifying the scenario test/fix retry loop in any orchestrator
    - When understanding how `adwSdlc.tsx` decouples scenario execution from the review phase
    - When troubleshooting `runResolveScenarioAgent` or the `/resolve_failed_scenario` command
    - When configuring `## Run Scenarios by Tag`, `## Start Dev Server`, or `## Health Check Path` in `.adw/commands.md`

- app_docs/feature-8ogjrg-scenario-test-fix-phases.md
  - Conditions:
    - When working with `features/scenario_test_fix_phases.feature` or `features/step_definitions/scenarioTestFixPhasesSteps.ts`
    - When writing or updating BDD acceptance scenarios for scenario test/fix phases
    - When understanding the full SDLC phase sequence after scenario test/fix wiring
    - When reviewing `ScenarioProofResult` shape and how it flows between `scenarioTestPhase` and `scenarioFixPhase`

- app_docs/feature-4jvczx-adw-init-schema-updates.md
  - Conditions:
    - When running `/adw_init` and need to understand `## Start Dev Server` detection logic
    - When a newly initialized `.adw/commands.md` is missing `## Health Check Path` or has `## Run E2E Tests`
    - When adding a new project type and need to determine the correct `## Start Dev Server` value
    - When troubleshooting `{PORT}` substitution failures in `devServerLifecycle.ts`
    - When updating `adw_init.md` to support a new test runner or web framework

- app_docs/feature-dd5jfe-dev-server-lifecycle.md
  - Conditions:
    - When working with `adws/core/devServerLifecycle.ts` or integrating `withDevServer` into a test/scenario phase
    - When implementing dev server startup, health probing, retry, or cleanup in any orchestrator
    - When adding or modifying `healthCheckPath` in `.adw/commands.md` for a target repo
    - When troubleshooting leaked dev server processes or stale `next dev` / `bun dev` workers
    - When working with `adws/triggers/devServerJanitor.ts` or extending the janitor pass

- app_docs/feature-f704s2-dev-server-janitor-cron.md
  - Conditions:
    - When working with `adws/triggers/devServerJanitor.ts` or the janitor probe
    - When adding or modifying cron probes in `adws/triggers/trigger_cron.ts`
    - When troubleshooting orphaned dev server processes in target repo worktrees
    - When working with `shouldCleanWorktree` kill decision logic or grace period tuning
    - When writing tests that inject `JanitorDeps` or mock worktree fs operations

- app_docs/feature-zqb2k1-wire-stepdefphase-into-orchestrators.md
  - Conditions:
    - When working with any orchestrator (`adwSdlc`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`, `adwPrReview`) and adding or modifying phase order
    - When implementing a new orchestrator that should run BDD step definition generation
    - When troubleshooting step definitions not being present before the test phase runs
    - When working with `adws/phases/stepDefPhase.ts` or `executeStepDefPhase`
    - When understanding how `adwPrReview.tsx` adapts `PRReviewWorkflowConfig` to call `WorkflowConfig`-typed phases

- app_docs/feature-cudwfe-passive-judge-review-phase.md
  - Conditions:
    - When working with `adws/phases/reviewPhase.ts` or the passive judge review implementation
    - When adding a review retry loop to a new orchestrator (follow the `adwPlanBuildReview.tsx` pattern)
    - When working with `adws/agents/reviewAgent.ts` or the `/review` slash command
    - When troubleshooting why review no longer starts a dev server or captures screenshots
    - When understanding `executeReviewPatchCycle` and how it differs from `scenarioFixPhase`

- app_docs/feature-o1w8wg-wire-scenarios-remaining-orchestrators.md
  - Conditions:
    - When working with `adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`, `adwChore.tsx`, or `adwPrReview.tsx` and the scenario test/fix retry loop
    - When adding or extending the scenario test/fix pattern to a new orchestrator
    - When understanding why `adwPlanBuildTestReview` patches `scenariosMd` to empty before calling review
    - When troubleshooting `adwPrReview` scenario phases running through `config.base` vs the full `PRReviewWorkflowConfig`
    - When understanding the diff evaluator ordering in `adwChore` relative to scenario testing

- app_docs/feature-8zhro4-prreviewworkflowconfig-composition.md
  - Conditions:
    - When working with `PRReviewWorkflowConfig` or `adws/phases/prReviewPhase.ts`
    - When adding a new field to `PRReviewWorkflowConfig` (decide: top-level PR-specific, or `base`)
    - When troubleshooting field-access patterns in PR review phase functions

- app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md
  - Conditions:
    - When working with `adws/adwMerge.tsx` or the merge orchestrator spawn flow
    - When working with `adws/triggers/cronIssueFilter.ts` or `cronStageResolver.ts`
    - When adding a new handoff stage that bypasses the cron grace period
    - When troubleshooting `awaiting_merge` issues not being picked up by the cron
    - When working with `deriveOrchestratorScript()` and adding a new orchestrator mapping

- app_docs/feature-01s6z7-delete-legacy-e2e-machinery.md
  - Conditions:
    - When looking for `runE2ETestsWithRetry`, `runBddScenariosWithRetry`, `discoverE2ETestFiles`, or `runPlaywrightE2ETests` (all deleted)
    - When looking for `executePRReviewTestPhase` (deleted — use `executeScenarioTestPhase` + `executeScenarioFixPhase`)
    - When importing `ScenarioProofResult`, `TagProofResult`, `shouldRunScenarioProof`, or `runScenarioProof` (now in `adws/phases/scenarioProof.ts`)
    - When troubleshooting a missing `runE2ETests` field in `CommandsConfig` or `.adw/commands.md`
    - When understanding why `agents/regressionScenarioProof.ts` and `agents/testDiscovery.ts` no longer exist

- app_docs/feature-643xf3-fix-retry-and-commit-leak.md
  - Conditions:
    - When working with `adws/core/utils.ts` `execWithRetry` or adding non-retryable error patterns
    - When troubleshooting `gh pr merge` retrying on "is not mergeable" conflicts
    - When working with `adws/agents/gitAgent.ts` `runCommitAgent` or commit message extraction
    - When troubleshooting garbage commit messages containing ENOENT or spawn error strings
    - When extending `NON_RETRYABLE_PATTERNS` with new non-retryable error classes

- app_docs/feature-2sqt1r-fix-rate-limit-plan-phase.md
  - Conditions:
    - When working with `adws/adwPlan.tsx` or adding rate limit handling to an orchestrator
    - When troubleshooting plan workflows that exit 1 instead of pausing on rate limits
    - When implementing a new orchestrator and ensuring it uses `CostTracker` + `runPhase()`
    - When debugging `deriveOrchestratorScript()` mapping (wrong resume script selected from pause queue)
    - When working with `adws/core/phaseRunner.ts` `runPhase()` or `runPhasesParallel()` error handling

- app_docs/feature-u8xr9v-output-validation-retry-loop.md
  - Conditions:
    - When working with `adws/agents/commandAgent.ts` or adding structured output to a new agent
    - When implementing or troubleshooting `ExtractionResult<T>` or `OutputValidationError`
    - When adding `outputSchema` to a `CommandAgentConfig` to enable retry on malformed LLM output
    - When migrating an agent from direct `runClaudeAgentWithCommand` to `commandAgent`
    - When debugging retry loop behavior (consecutive error early exit, Haiku retry invocations)

- app_docs/feature-avb4f5-deploy-workers-github-actions.md
  - Conditions:
    - When working with `.github/workflows/deploy-workers.yml`
    - When adding a new Cloudflare Worker under `workers/` that needs CI deployment
    - When troubleshooting GitHub Actions deploy jobs for `screenshot-router` or `cost-api`
    - When configuring `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` secrets for Worker CI

- app_docs/feature-efcqzc-deploy-workers-github-actions.md
  - Conditions:
    - When working with `.github/workflows/deploy-workers.yml` and the per-worker job structure
    - When adding a new Cloudflare Worker under `workers/` that needs CI auto-deployment
    - When troubleshooting `dorny/paths-filter@v3` change detection or `cloudflare/wrangler-action@v3` deploy jobs
    - When configuring `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` secrets for Worker CI

- app_docs/feature-92py6q-d1-client-dual-write.md
  - Conditions:
    - When working with `adws/cost/d1Client.ts` or the D1 dual-write pipeline
    - When configuring `COST_API_URL` or `COST_API_TOKEN` in ADW
    - When modifying `adws/phases/phaseCostCommit.ts` or the phase cost commit flow
    - When troubleshooting D1 write failures or missing cost records in the D1 database
    - When implementing future changes to the `PhaseCostRecord` → `IngestPayload` transformation

- app_docs/feature-a72ezx-deploy-cost-api-worker.md
  - Conditions:
    - When deploying or re-deploying the `cost-api` Cloudflare Worker to production
    - When troubleshooting the `adw-costs` D1 database connection or `database_id` in `wrangler.toml`
    - When configuring `COST_API_TOKEN` or rotating the bearer secret on the Worker
    - When adding a new Worker to `workers/` and relying on the CI auto-deploy workflow
    - When verifying `costs.paysdoc.nl` is live and responding correctly

- app_docs/feature-viahyb-cost-api-worker-d1-s-cost-api-worker.md
  - Conditions:
    - When working with the `workers/cost-api/` Cloudflare Worker
    - When implementing or modifying the `POST /api/cost` ingest endpoint
    - When working with the `adw-costs` D1 database schema (projects, cost_records, token_usage)
    - When troubleshooting bearer token auth or cost record ingestion failures
    - When wiring ADW phases to post cost data to the Cost API Worker

- app_docs/feature-e5wrpe-csv-migration-script-migrate-csv-to-d1.md
  - Conditions:
    - When running or modifying the one-time CSV migration script (`workers/cost-api/migrate.ts`)
    - When parsing old-format or new-format cost CSV files for D1 ingestion
    - When working with the `migrated` field on `IngestRecord` or `cost_records` in D1
    - When troubleshooting historical cost data upload failures or duplicate records

- app_docs/feature-g2u55r-d1-client-dual-write.md
  - Conditions:
    - When working with `adws/cost/d1Client.ts` or the `postCostRecordsToD1` function
    - When modifying phase cost commit logic (`phaseCostCommit.ts`) or the dual-write path
    - When configuring `COST_API_URL` or `COST_API_TOKEN` for D1 cost writes
    - When troubleshooting D1 write failures or silent-skip behavior
    - When extending the `PhaseCostRecord` → ingest payload transformation

- README.md
  - Conditions:
    - When first understanding the project structure
    - When learning how to run ADW orchestrators

- adws/README.md
  - Conditions:
    - When you're operating in the `adws/` directory

- app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md
  - Conditions:
    - When working with `agents/<adwId>/state.json` or querying workflow status/phase timing
    - When modifying `runPhase()`, skip-on-resume logic, or phase status tracking in `adws/core/phaseRunner.ts`
    - When modifying `AgentStateManager` in `adws/core/agentState.ts` (top-level state methods)
    - When implementing or troubleshooting workflow resume/pause and `completedPhases` recovery
    - When reading or writing `workflowStage` transitions (`starting`, `completed`, `paused`, `abandoned`)
    - When working with `PhaseExecutionState` or the `phases` map on `AgentState`

- app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md
  - Conditions:
    - When working with `.adw/` project configuration files
    - When implementing support for new target repository types
    - When troubleshooting ADW command generalization or project config loading
    - When modifying `adws/core/projectConfig.ts` or `.claude/commands/*.md` templates

- app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md
  - Conditions:
    - When working with cost CSV tracking or cost file commit/push logic
    - When modifying `adws/github/gitOperations.ts` commit or push functions
    - When working on `handlePullRequestEvent()` in `adws/triggers/webhookHandlers.ts`
    - When using or modifying the `/commit_cost` slash command
    - When troubleshooting missing or uncommitted cost data after PR close

- app_docs/feature-ak03s5-remove-csv-cost-pipeline.md
  - Conditions:
    - When working with cost tracking and wondering why there are no CSV files or `projects/` directory
    - When modifying `adws/cost/d1Client.ts` or `postCostRecordsToD1` and needing context on the D1-only migration
    - When troubleshooting `CostTracker.commit()` in `phaseRunner.ts` or cost writes in `prReviewCompletion.ts`
    - When looking for `commitAndPushCostFiles`, `pullLatestCostBranch`, or `CostCommitQueue` and finding them absent
    - When modifying `adws/cost/reporting/commentFormatter.ts` and wondering where `FIXED_TOKEN_COLUMNS` came from

- app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md
  - Conditions:
    - When working with `SLASH_COMMAND_EFFORT_MAP` or reasoning effort configuration
    - When modifying `runClaudeAgent()` or `runClaudeAgentWithCommand()` signatures
    - When adding a new slash command that needs an effort level assigned
    - When troubleshooting `--effort` flag not being passed to Claude CLI
    - When implementing fast/cheap mode effort overrides

- app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md
  - Conditions:
    - When working with cost CSV rebuild or commit logic
    - When modifying `rebuildProjectCostCsv` in `adws/core/costCsvWriter.ts`
    - When working on PR close or issue close webhook handlers
    - When troubleshooting cost CSVs that were not rebuilt after a PR was rejected or closed
    - When implementing cost tracking changes that affect the merged vs closed-without-merge flow

- app_docs/feature-fix-review-process-8aatht-multi-agent-review-external-proof.md
  - Conditions:
    - When working with the review process or multi-agent review
    - When modifying `adws/agents/reviewAgent.ts` or `adws/phases/reviewPhase.ts`
    - When troubleshooting review proof generation or review failures

- app_docs/feature-8ar0fo-user-story-integrate-kpi-tracking.md
  - Conditions:
    - When working with KPI tracking or agentic metrics
    - When modifying workflow completion or reporting logic

- app_docs/feature-1773072529842-bmkqrg-jira-issue-tracker-provider.md
  - Conditions:
    - When working with Jira integration or issue tracker providers
    - When modifying `adws/providers/` provider types or interfaces

- app_docs/feature-1773073910340-o5ncqk-repo-context-factory.md
  - Conditions:
    - When working with the RepoContext factory or repo context abstraction
    - When modifying how agents interact with code host or issue tracker providers

- app_docs/feature-1773312009789-vruh95-migrate-phases-to-repo-context.md
  - Conditions:
    - When working with phase implementations in `adws/phases/`
    - When migrating phases to use RepoContext instead of direct GitHub calls

- app_docs/feature-1773328453611-p5xexp-running-token-totals.md
  - Conditions:
    - When working with token counting or cost tracking
    - When modifying `adws/core/tokenManager.ts` or cost reporting logic

- app_docs/feature-1773341233172-9jw507-gitlab-codehost-provider.md
  - Conditions:
    - When working with GitLab integration or CodeHost providers
    - When adding or modifying provider implementations in `adws/providers/`

- app_docs/feature-1773073902212-9l2nv9-repo-context-factory.md
  - Conditions:
    - When working with `RepoContext`, `createRepoContext`, or `adws/providers/repoContext.ts`
    - When implementing workflow entry points that need validated repo context
    - When adding support for new provider platforms (IssueTracker or CodeHost)
    - When troubleshooting git remote validation or working directory validation errors
    - When configuring `.adw/providers.md` for a target repository

- app_docs/feature-sinbtg-plan-scenario-validation-resolution.md
  - Conditions:
    - When working with `planValidationPhase`, `validationAgent`, or `resolutionAgent`
    - When implementing or modifying the plan-scenario alignment gate between planning and build
    - When adding new workflow stages related to BDD scenario validation
    - When troubleshooting plan-scenario mismatch failures or resolution loop exhaustion
    - When integrating the validation phase into a new orchestrator

- app_docs/feature-hx6dg4-robustness-hardening-retry-logic-resilience.md
  - Conditions:
    - When working with `execWithRetry` or adding retry logic to `gh` CLI calls
    - When modifying `claudeAgent.ts` ENOENT handling or Claude CLI path resolution
    - When implementing pre-flight checks in `initializeWorkflow()`
    - When working on `createWorktree()` or `createWorktreeForNewBranch()` base ref logic
    - When modifying `createMergeRequest()` or PR creation/duplicate handling
    - When troubleshooting `resolutionAgent` or `validationAgent` JSON parse failures
    - When adding or modifying auto-merge early-exit paths in `autoMergeHandler.ts` or `autoMergePhase.ts`
    - When troubleshooting empty log directories from skipped auto-merge runs

- app_docs/feature-kbzbn6-fix-git-repo-context.md
  - Conditions:
    - When working with VCS functions (`copyEnvToWorktree`, `ensureWorktree`, `getRepoInfo`)
    - When adding new git operations that must target an external target repository
    - When troubleshooting worktree creation, `.env` copy, or git remote errors in target repo workflows
    - When modifying `autoMergeHandler.ts`, `workflowInit.ts`, or `targetRepoManager.ts`
    - When cloning new target repositories (SSH vs HTTPS URL handling)

- app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md
  - Conditions:
    - When working with orchestrator phase ordering in `adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, or `adwPlanBuildTestReview.tsx`
    - When adding or modifying post-PR logic (approve, `awaiting_merge` write) in an orchestrator
    - When troubleshooting why `executeAutoMergePhase` is absent from orchestrators (it was replaced by inline approve + handoff)
    - When implementing a new orchestrator that should follow the approve-and-handoff exit pattern
    - When working with `workflowStage: 'awaiting_merge'` transitions or the `extractPrNumber()` helper

- app_docs/feature-74itmf-dependency-logging.md
  - Conditions:
    - When working with `findOpenDependencies()` or `checkIssueEligibility()` in `adws/triggers/`
    - When adding or modifying logging in the dependency resolution pipeline
    - When troubleshooting why an issue was deferred due to blocking dependencies
    - When diagnosing silent failures in `getIssueState()` dependency lookups

- app_docs/feature-q9kms5-bdd-scenarios-before-pr.md
  - Conditions:
    - When working with `testPhase.ts` or the test phase execution order
    - When adding or modifying BDD scenario execution in workflows (`bddScenarioRunner.ts`, `runBddScenariosWithRetry`)
    - When configuring `## Run Scenarios by Tag` in `.adw/commands.md` or `## Unit Tests` in `.adw/project.md`
    - When troubleshooting BDD scenario failures, retries, or the PR gate being blocked
    - When updating orchestrators to include or reorder the test phase relative to PR creation

- app_docs/feature-ak5lea-trigger-cron-process-prevent-duplicate-cron.md
  - Conditions:
    - When working with `trigger_cron.ts`, `webhookGatekeeper.ts`, or `cronProcessGuard.ts`
    - When troubleshooting duplicate cron processes running for the same repository
    - When implementing or modifying cron process lifecycle management in ADW
    - When the webhook server restarts and cron processes behave unexpectedly
    - When adding PID-file-based process deduplication to new trigger types

- app_docs/feature-hpq6cn-implement-scenario-p-scenario-planner-agent.md
  - Conditions:
    - When working with BDD scenario generation or the scenario agent
    - When modifying `adws/agents/scenarioAgent.ts` or `adws/phases/scenarioPhase.ts`
    - When working with `.adw/scenarios.md` configuration
    - When adding or modifying `@regression` tag maintenance logic

- app_docs/feature-9emriw-bdd-scenario-review-proof.md
  - Conditions:
    - When working with the review proof mechanism or `regressionScenarioProof.ts`
    - When modifying `reviewPhase.ts` or review phase scenario-related fields
    - When adding or changing `@regression` / `@adw-{issueNumber}` scenario classification in review
    - When configuring `runRegressionScenarios` or `runScenariosByTag` commands in `.adw/commands.md`
    - When troubleshooting review proof fallback behaviour for repos without `.adw/scenarios.md`

- app_docs/feature-91v6qi-llm-dependency-extraction.md
  - Conditions:
    - When working with `findOpenDependencies()`, `extractDependencies()`, or `parseDependencies()` in `adws/triggers/issueDependencies.ts`
    - When adding or modifying dependency extraction logic or the `/extract_dependencies` command
    - When implementing a new agent that calls `runClaudeAgentWithCommand` with a slash command
    - When troubleshooting why an issue with natural-language dependencies was not deferred
    - When working with `dependencyExtractionAgent.ts` or `parseDependencyArray`

- app_docs/feature-jjxkk9-conditional-unit-tests-plan-template.md
  - Conditions:
    - When working with `.claude/commands/feature.md` plan template
    - When the `## Unit Tests` setting in `.adw/project.md` should affect plan generation
    - When troubleshooting plans that include unit test tasks despite unit tests being disabled
    - When modifying `regressionScenarioProof.ts` or the `@regression` tag convention in review proof
    - When auditing plan templates (`bug.md`, `chore.md`, `patch.md`) for unit-test awareness

- app_docs/feature-20eum6-replace-crucial-with-regression.md
  - Conditions:
    - When working with `@regression` tag or `regressionScenarioProof.ts`
    - When configuring `## Run Regression Scenarios` in `.adw/commands.md` or `.adw/scenarios.md`
    - When modifying `ReviewRetryOptions.runRegressionCommand` or scenario proof identifiers
    - When troubleshooting regression scenario proof failures during the review phase
    - When adding new BDD scenarios to the regression safety net

- app_docs/feature-u8okxe-bug-sdlc-chore-classifier.md
  - Conditions:
    - When working with `issueTypeToOrchestratorMap` in `adws/types/issueTypes.ts`
    - When modifying issue classification logic or the `/classify_issue` command
    - When troubleshooting bug issues that are not receiving review or documentation phases
    - When investigating why an issue was classified as `/chore` and skipped quality gates
    - When updating orchestrator routing for any issue type

- app_docs/agentic_kpis.md
  - Conditions:
    - When working with KPI metrics, streak tracking, or ADW run statistics
    - When querying or interpreting historical ADW workflow performance data
    - When troubleshooting KPI reporting or the `/track_agentic_kpis` command

- app_docs/feature-fla3u2-1773754088098-cucumber-step-definitions.md
  - Conditions:
    - When adding or modifying Cucumber step definitions in `features/step_definitions/`
    - When a `bunx cucumber-js --dry-run` reports undefined steps
    - When implementing steps that scan source files with `findFiles()` or execute commands via `spawnSync`
    - When working with `removeRunBddScenariosSteps.ts` or `removeUnitTestsSteps.ts`

- app_docs/feature-8w4fep-adw-init-commands-md-scenario-sections.md
  - Conditions:
    - When modifying `.claude/commands/adw_init.md` or the sections it generates in `.adw/commands.md`
    - When troubleshooting missing `## Run Scenarios by Tag` or `## Run Regression Scenarios` in generated `commands.md`
    - When working with `/adw_init` and E2E tool detection in step 7
    - When `projectConfig.ts` `runScenariosByTag` or `runRegressionScenarios` are falling back to defaults unexpectedly

- app_docs/feature-ie8l08-fix-pr-review-target-repo.md
  - Conditions:
    - When working with `initializePRReviewWorkflow` in `adws/phases/prReviewPhase.ts`
    - When troubleshooting PR review workflows targeting the wrong repository (ADW repo instead of target repo)
    - When modifying `adwPrReview.tsx` target-repo argument handling
    - When `ensureWorktree` is called without `baseRepoPath` in the PR review path
    - When investigating the "wrong repository" class of bugs (#23, #33, #52, #56, #62, #119, #217, #223)

- app_docs/feature-wrzj5j-harden-project-board-status.md
  - Conditions:
    - When working with `moveIssueToStatus` or `moveToStatus` in `adws/github/projectBoardApi.ts`
    - When modifying `IssueTracker.moveToStatus` in `adws/providers/types.ts` or provider implementations
    - When adding intermediate project board status transitions to workflow phases
    - When troubleshooting project board status updates that fail silently or with stale tokens
    - When implementing GitHub App token refresh before GraphQL calls in `projectBoardApi.ts`

- app_docs/feature-cwiuik-1773818764164-auto-merge-approved-pr.md
  - Conditions:
    - When working with the `pull_request_review` webhook event handler in `trigger_webhook.ts`
    - When modifying auto-merge logic in `adws/triggers/autoMergeHandler.ts`
    - When adding or changing merge conflict detection or resolution via the `/resolve_conflict` agent
    - When troubleshooting approved PRs that were not automatically merged
    - When adjusting `MAX_AUTO_MERGE_ATTEMPTS` or the retry loop behavior

- app_docs/feature-fvzdz7-auto-approve-merge-after-review.md
  - Conditions:
    - When working with `executeAutoMergePhase` in `adws/phases/autoMergePhase.ts`
    - When modifying `mergeWithConflictResolution()` in `adws/triggers/autoMergeHandler.ts`
    - When working with `approvePR()` in `adws/github/prApi.ts` or the `GH_TOKEN` identity swap
    - When adding the auto-merge phase to a new orchestrator
    - When troubleshooting PRs that were not merged after the review phase passed

- app_docs/feature-tepq39-scenario-writer-opus-model.md
  - Conditions:
    - When working with `SLASH_COMMAND_MODEL_MAP` or `SLASH_COMMAND_MODEL_MAP_FAST` in `adws/core/config.ts`
    - When modifying or reviewing the model tier assigned to `/scenario_writer`
    - When adding a new slash command and deciding which model tier to assign
    - When troubleshooting scenario writer producing lower-quality output or using unexpected model

- app_docs/feature-2umujr-fix-pr-auth-token-override.md
  - Conditions:
    - When working with the `/pull_request` slash command in `.claude/commands/pull_request.md`
    - When troubleshooting PRs authored by the personal user instead of the GitHub App bot
    - When modifying auth token handling in the PR creation flow
    - When investigating `GH_TOKEN` vs `GITHUB_PAT` conflicts in subprocess environments

- app_docs/feature-9tknkw-project-board-pat-fallback.md
  - Conditions:
    - When working with `moveIssueToStatus()` or `findRepoProjectId()` in `adws/github/projectBoardApi.ts`
    - When troubleshooting project board status updates that silently skip on user-owned repositories

- app_docs/feature-fygx90-hitl-label-gate-automerge.md
  - Conditions:
    - When working with `executeAutoMergePhase` in `adws/phases/autoMergePhase.ts`
    - When adding or modifying label-based gates in the auto-merge flow
    - When troubleshooting PRs that were intentionally skipped by the HITL gate
    - When implementing `issueHasLabel()` or other real-time label checks in `adws/github/issueApi.ts`
    - When the `hitl` label is present on an issue and auto-merge is expected to be skipped
    - When the GitHub App token cannot access Projects V2 (user-owned repos like `paysdoc/AI_Dev_Workflow`)
    - When configuring `GITHUB_PAT` as a fallback for project board GraphQL calls
    - When investigating why issues remain in "Todo" despite workflow phases completing

- app_docs/feature-y000tl-fix-issue-number-res-pr-review-issue-number.md
  - Conditions:
    - When working with `fetchPRDetails()` or issue number extraction in `adws/github/prApi.ts`
    - When modifying `extractIssueNumberFromBranch()` in `adws/triggers/webhookHandlers.ts`
    - When working with `PRReviewWorkflowConfig` or `initializePRReviewWorkflow()` in `adws/phases/prReviewPhase.ts`
    - When modifying cost CSV writing in `completePRReviewWorkflow()` or `adws/core/costCsvWriter.ts`
    - When troubleshooting `Could not resolve to an Issue with the number of 0` errors in PR review workflows
    - When investigating `0-*.csv` cost files or serialised PR review CSV naming

- app_docs/feature-6ukg3s-1773849789984-fix-pr-default-branch-linking.md
  - Conditions:
    - When working with cross-repo PR creation or `runPullRequestAgent()` in `adws/agents/prAgent.ts`
    - When troubleshooting PRs targeting `main` instead of the repo's actual default branch
    - When modifying issue reference format (`#N` vs `owner/repo#N`) in `pullRequestCreator.ts` or `pull_request.md`
    - When adding `repoOwner`/`repoName` context to the PR creation chain
    - When investigating cross-repo GitHub issue linking failures in PR bodies

- app_docs/feature-h01a4p-cost-revamp-phasecos-phase-cost-record-csv.md
  - Conditions:
    - When working with `PhaseCostRecord`, `PhaseCostStatus`, or `createPhaseCostRecords()` in `adws/cost/`
    - When modifying or extending the per-issue or project total CSV format
    - When adding a new phase that needs to produce cost records
    - When troubleshooting missing cost data after a workflow crash mid-execution
    - When working with `appendIssueCostCsv`, `rebuildProjectTotalCsv`, or `commitPhasesCostData`
    - When adding support for new token types or providers in cost tracking

- app_docs/feature-ku956a-cost-revamp-core-com-cost-module-core-vitest.md
  - Conditions:
    - When working with `adws/cost/` module types, computation, or the Anthropic extractor
    - When implementing or extending `TokenUsageExtractor` for a new provider
    - When modifying `computeCost()`, `checkDivergence()`, or Anthropic pricing tables
    - When adding Vitest unit tests for cost-related code
    - When troubleshooting the snake_case/camelCase mismatch in CLI `result` message parsing
    - When wiring the cost module into workflow phases or agents

- app_docs/feature-ex60ng-step-def-gen-review-gating.md
  - Conditions:
    - When working with `/generate_step_definitions`, `stepDefAgent.ts`, or `stepDefPhase.ts`
    - When modifying the phase ordering in any orchestrator (`adwSdlc`, `adwPlanBuildTestReview`, `adwPlanBuildReview`, `adwPlanBuild`, `adwPlanBuildTest`, `adwPlanBuildDocument`)
    - When troubleshooting review phase hard failures or PR-gating behaviour
    - When adding or changing the coding guidelines check in `review.md`
    - When investigating ungeneratable scenario removal or the warning comment posted on the issue

- app_docs/feature-tgs1li-cost-revamp-wire-ext-wire-extractor-agent-handler.md
  - Conditions:
    - When working with real-time token tracking in `agentProcessHandler.ts`
    - When modifying `AnthropicTokenUsageExtractor` streaming or deduplication logic
    - When troubleshooting cost fields missing for failed or token-limit-terminated agent runs
    - When implementing estimate-vs-actual logging or interpreting its output
    - When modifying `formatRunningTokenFooter` or the `isEstimated` display format
    - When adding `tokenEstimate` to `ProgressInfo` or the progress callback chain

- app_docs/feature-7nl59l-fix-cron-respawn-cache.md
  - Conditions:
    - When working with `ensureCronProcess` or `cronSpawnedForRepo` in `adws/triggers/webhookGatekeeper.ts`
    - When modifying the in-memory cron process cache or the PID-file liveness check (`isCronAliveForRepo`)
    - When troubleshooting cron processes that die mid-session and are never respawned
    - When adding regression tests for the two-layer cron guard (in-memory Set + PID file)

- app_docs/feature-71pdjz-cache-install-context.md
  - Conditions:
    - When working with `installPhase.ts`, `installAgent.ts`, or `extractInstallContext()`
    - When modifying `runClaudeAgentWithCommand()` signature or the `contextPreamble` injection mechanism
    - When adding a new orchestrator that needs to run the install phase
    - When troubleshooting agents that are re-reading files despite the install cache being present
    - When working with `WorkflowConfig.installContext` or `PRReviewWorkflowConfig.installContext`
    - When modifying how `/install` is registered in model/effort maps in `adws/core/config.ts`

- app_docs/feature-1vil1v-skip-scenario-writer-on-resume.md
  - Conditions:
    - When working with `executeScenarioPhase` or `executePlanValidationPhase` in `adws/phases/`
    - When modifying `STAGE_ORDER` or `STAGE_HEADER_MAP` in `adws/core/workflowCommentParsing.ts`
    - When adding recovery guards to new phases using `shouldExecuteStage`
    - When troubleshooting the scenario writer or plan validation phase running unnecessarily on workflow resume
    - When investigating why `plan_validating` was not detected as a completed stage during recovery

- app_docs/feature-j2ydkj-cost-comment-formatter.md
  - Conditions:
    - When working with `formatCostCommentSection`, `formatCostTable`, `formatDivergenceWarning`, or `formatEstimateVsActual` in `adws/cost/reporting/commentFormatter.ts`
    - When implementing or modifying cost section rendering in GitHub issue or PR comments
    - When adding the `SHOW_COST_IN_COMMENTS` env var toggle or changing cost comment visibility
    - When troubleshooting divergence warnings not appearing or cost sections showing when they should be hidden
    - When extending `WorkflowContext` with new cost-related fields (`costSection`, `phaseCostRecords`)

- app_docs/feature-sgdfol-cost-revamp-orchestr-cost-orchestrator-migration-cleanup.md
  - Conditions:
    - When working with `adws/cost/` as the authoritative cost module
    - When importing cost types (`ModelUsageMap`, `ModelUsage`, `CostBreakdown`) or helpers (`mergeModelUsageMaps`, `persistTokenCounts`, `buildCostBreakdown`, etc.)
    - When adding a new orchestrator that needs cost tracking
    - When troubleshooting imports that previously came from `core/costReport`, `core/tokenManager`, or `types/costTypes`
    - When modifying `ClaudeCodeResultMessage` or cost extraction in `jsonlParser.ts`

- app_docs/feature-btrko8-codebase-architecture-improvements.md
  - Conditions:
    - When adding a new orchestrator and need to understand the PhaseRunner / CostTracker composition pattern
    - When implementing a new thin-wrapper agent and want to use `runCommandAgent<T>()`
    - When looking for model routing utilities (`getModelForCommand`, `isFastMode`) or environment constants after the `config.ts` split
    - When troubleshooting import errors after module relocations (`claudeStreamParser`, `issueRouting`, `cost/commitQueue`)
    - When working with `adws/core/logger.ts`, `adws/core/adwId.ts`, or `adws/core/environment.ts` to understand what was extracted from `utils.ts` / `config.ts`

- app_docs/feature-2gp7qi-architectural-improv-codebase-architecture.md
  - Conditions:
    - When adding a new orchestrator and need to understand the PhaseRunner / CostTracker composition pattern
    - When implementing a new thin-wrapper agent and want to use `runCommandAgent<T>()`
    - When looking for model routing utilities (`getModelForCommand`, `isFastMode`) or environment constants after the `config.ts` split
    - When troubleshooting import errors after module relocations (`claudeStreamParser`, `issueRouting`, `cost/commitQueue`)
    - When working with `adws/core/logger.ts`, `adws/core/adwId.ts`, or `adws/core/environment.ts` to understand what was extracted from `utils.ts` / `config.ts`

- app_docs/feature-hm6br4-adw-init-depaudit-setup.md
  - Conditions:
    - When working with `executeDepauditSetup` or `adws/phases/depauditSetup.ts`
    - When implementing or extending `adw_init` secret propagation (`SOCKET_API_TOKEN`, `SLACK_WEBHOOK_URL`)
    - When troubleshooting `depaudit setup` failures or skipped secrets during `adw_init`
    - When adding new secrets to propagate during target repo bootstrap

- app_docs/feature-fgef3i-adw-init-call-depaud-depaudit-setup-secret-propagation.md
  - Conditions:
    - When working with `executeDepauditSetup` or `adws/phases/depauditSetup.ts`
    - When implementing or extending `adw_init` secret propagation (`SOCKET_API_TOKEN`, `SLACK_WEBHOOK_URL`)
    - When troubleshooting `depaudit setup` failures or skipped secrets during `adw_init`
    - When adding new secrets to propagate during target repo bootstrap

- app_docs/feature-sgud8b-copy-target-skills-adw-init.md
  - Conditions:
    - When working with `copyTargetSkillsAndCommands()` or `parseFrontmatterTarget()` in `adws/phases/worktreeSetup.ts`
    - When adding a new skill or command and need to decide whether to set `target: true` or `target: false`
    - When modifying `adwInit.tsx` to change what is committed during `adw_init`
    - When troubleshooting skills or commands that are missing in a target repo after `adw_init`
    - When investigating why `workflowInit` is gitignoring commands that were already committed

- app_docs/feature-nnn7js-r2-upload-screenshot-router.md
  - Conditions:
    - When working with `adws/r2/` module (uploadToR2, ensureBucket, createR2Client)
    - When implementing screenshot upload from any ADW phase
    - When modifying or deploying `workers/screenshot-router/`
    - When troubleshooting R2 bucket creation, lifecycle rules, or public URL construction
    - When configuring `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, or `R2_SECRET_ACCESS_KEY`

- app_docs/feature-9k4ut2-machine-readable-review-proof.md
  - Conditions:
    - When working with `.adw/review_proof.md` configuration format or `ReviewProofConfig` types
    - When modifying `regressionScenarioProof.ts`, `runScenarioProof()`, or `TagProofResult`
    - When changing which BDD tags run during the review phase or their severity classification
    - When troubleshooting optional tag skipping or `{issueNumber}` substitution in tag patterns
    - When updating the `/review` slash command's severity reading logic

- app_docs/feature-8fns89-fix-bdd-scenarios-failure.md
  - Conditions:
    - When troubleshooting BDD scenarios failing immediately in the review phase with "undefined steps"
    - When `regressionScenarioProof.ts` or `runScenarioProof()` exits early before step definitions exist
    - When the "Unit tests passed!" message appears despite unit tests being disabled
    - When diagnosing stale-code issues from orchestrator startup logs (ADW version hash)
    - When working with `ReviewRetryResult` or `MergedReviewResult` interface shapes

- app_docs/feature-x4wwk7-app-type-screenshot-upload.md
  - Conditions:
    - When working with `applicationType` in `ProjectConfig` or `parseApplicationType()` in `projectConfig.ts`
    - When implementing screenshot upload from the review phase to Cloudflare R2
    - When modifying `WorkflowContext.screenshotUrls` or the screenshot section in review comments
    - When adding a new target repo and need to set `## Application Type` in `.adw/project.md`
    - When troubleshooting screenshots not appearing in issue comments for web-type applications

- app_docs/feature-wqzfqj-ensure-cron-before-webhook-gates.md
  - Conditions:
    - When working with `ensureCronProcess` placement in `trigger_webhook.ts`
    - When troubleshooting the cron poller dying and not being respawned after non-actionable webhook events
    - When modifying the `issue_comment` or `issues.opened` handler gate ordering in `trigger_webhook.ts`
    - When adding new webhook event gates that could prevent `ensureCronProcess` from being reached

- app_docs/feature-ekd5o1-wire-proof-comment-formatter.md
  - Conditions:
    - When working with `proofCommentFormatter.ts` or `formatReviewProofComment()`
    - When modifying `formatReviewPassedComment()` or `formatReviewFailedComment()` in `workflowCommentsIssue.ts`
    - When extending `WorkflowContext` with new proof-related fields
    - When adding new sections to review proof GitHub comments (verification, screenshots, etc.)
    - When troubleshooting proof data not appearing in `review_passed` or `review_failed` issue comments
    - When wiring `nonBlockerIssues`, `scenarioProof`, or `allSummaries` through the review phase pipeline

- app_docs/feature-02r4w9-jsonl-schema-probe-ci-check.md
  - Conditions:
    - When working with `adws/jsonl/` module (schemaProbe, conformanceCheck, fixtureUpdater)
    - When adding or modifying JSONL fixture files in `adws/jsonl/fixtures/`
    - When running or troubleshooting `bun run jsonl:check` in CI
    - When the Claude CLI JSONL output schema changes and fixtures need updating
    - When implementing new parsers that depend on the JSONL envelope structure

- app_docs/feature-lnef5d-mock-infrastructure-layer.md
  - Conditions:
    - When working with `test/mocks/` (Claude CLI stub, GitHub API mock server, git remote mock, test harness)
    - When writing or modifying Cucumber BDD scenarios that require mocked external services
    - When adding new GitHub API endpoints to the mock server route table
    - When troubleshooting `@mock-infrastructure` or `@regression` scenario failures
    - When configuring `MOCK_FIXTURE_PATH`, `MOCK_STREAM_DELAY_MS`, `GH_HOST`, or `CLAUDE_CODE_PATH` for test runs
    - When extending mock fixtures in `test/fixtures/jsonl/` or `test/fixtures/github/`

- app_docs/feature-tdlgz7-fix-boardstatus-invalid-values.md
  - Conditions:
    - When working with `BoardStatus` enum in `adws/providers/types.ts`
    - When adding or removing project board status transitions in `buildPhase.ts` or `testPhase.ts`
    - When troubleshooting `moveToStatus()` calls that silently fail due to unmatched board column names
    - When the GitHub project board columns change and enum values need to stay in sync

- app_docs/feature-7sunv4-fix-pr-routing-and-status.md
  - Conditions:
    - When working with `prPhase.ts`, `prAgent.ts`, or `CodeHost.createMergeRequest()`
    - When the `/pull_request` slash command or PR creation flow needs to be modified
    - When troubleshooting PRs targeting the wrong base branch (e.g., `main` instead of `dev`)
    - When issues are not transitioning to "Review" status after PR creation
    - When modifying `extractIssueNumberFromBranch()` or webhook PR-to-issue linking in `webhookHandlers.ts`
    - When implementing or updating `MergeRequestResult` in provider implementations

- app_docs/feature-6bi1qq-fixture-repo-test-harness.md
  - Conditions:
    - When working with `test/fixtures/cli-tool/` or the fixture target repo structure
    - When using or extending `setupFixtureRepo()` / `teardownFixtureRepo()` in test harness setup
    - When writing BDD scenarios that need a real git-initialized working directory
    - When troubleshooting `@review-harness` or `@adw-6bi1qq-fixture-target-repo` scenario failures
    - When adding new fixture repos under `test/fixtures/` for behavioral testing

- app_docs/feature-78celh-docker-behavioral-test-isolation.md
  - Conditions:
    - When working with `test/Dockerfile`, `test/docker-run.sh`, or `test/.dockerignore`
    - When running or troubleshooting BDD tests inside a Docker container (`bun run test:docker`)
    - When modifying the `test:docker` or `test:docker:build` scripts in `package.json`
    - When adding the Docker runtime path to CI (`regression.yml` `runtime` input)
    - When troubleshooting `@docker-isolation` scenarios or the `adw-bdd-runner` image

- app_docs/feature-9zcqhw-detect-compaction-restart-build-agent.md
  - Conditions:
    - When working with `agentProcessHandler.ts` stdout detection logic (auth errors, token limit, compaction)
    - When the build agent is restarting unexpectedly or posting `compaction_recovery` comments
    - When modifying `buildContinuationPrompt()` or the `buildPhase.ts` continuation while loop
    - When adding a new `WorkflowStage` type or `STAGE_HEADER_MAP` entry in `workflowCommentParsing.ts`
    - When troubleshooting `MAX_TOKEN_CONTINUATIONS` being exhausted due to repeated context compaction

- app_docs/feature-u7lut9-compaction-recovery-test-review-phases.md
  - Conditions:
    - When working with `testRetry.ts`, `reviewPhase.ts`, or `retryOrchestrator.ts` compaction handling
    - When modifying `onCompactionDetected` callbacks in `testPhase.ts`, `workflowCompletion.ts`, or `prReviewCompletion.ts`
    - When adding `test_compaction_recovery` or `review_compaction_recovery` stage comments
    - When troubleshooting test or review agents restarting due to context compaction
    - When extending `RetryConfig` or `RetryResult` with new continuation-tracking fields

- app_docs/feature-x2q5aa-review-step-def-independence-check.md
  - Conditions:
    - When working with `.claude/commands/review.md` Step 5 or the step definition independence check
    - When adding or modifying the anti-pattern detection logic in the review slash command
    - When troubleshooting review issues classified as `blocker` or `tech-debt` due to tautological/internal step definitions
    - When writing BDD scenarios that exercise the independence check in `features/review_step_def_independence.feature`
    - When the review agent skips or incorrectly applies the independence check guard clauses

- app_docs/feature-irs6vj-single-pass-alignment-phase.md
  - Conditions:
    - When working with `executeAlignmentPhase` in `adws/phases/alignmentPhase.ts`
    - When modifying `runAlignmentAgent` or `parseAlignmentResult` in `adws/agents/alignmentAgent.ts`
    - When implementing or modifying the plan-scenario alignment gate between planning and build
    - When troubleshooting the `/align_plan_scenarios` slash command or its JSON output parsing
    - When adding new workflow stages related to plan-scenario alignment

- app_docs/feature-aym0n5-create-implement-tdd.md
  - Conditions:
    - When working with the `/implement_tdd` skill or `.claude/skills/implement-tdd/`
    - When wiring the TDD build agent into an orchestrator (replacing `/implement` with `/implement_tdd`)
    - When adding or modifying the red-green-refactor loop in autonomous build workflows
    - When troubleshooting step definition generation during the TDD build phase
    - When deciding whether to set `target: true` on a new skill for `adw_init` deployment

- app_docs/feature-0s1m68-build-agent-routing-pipeline.md
  - Conditions:
    - When working with `buildAgent.ts` routing logic or `findScenarioFiles` integration
    - When adding a new slash command that needs model/effort routing entries
    - When modifying any scenario-aware orchestrator (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`) pipeline order
    - When troubleshooting why the build agent is using `/implement` instead of `/implement_tdd` (or vice versa)
    - When `executeStepDefPhase` or `executePlanValidationPhase` are referenced but not found in orchestrators

- app_docs/feature-y55dlm-remove-ungeneratable-step-def-classification.md
  - Conditions:
    - When working with the `/generate_step_definitions` command
    - When modifying or extending step definition generation behavior
    - When a scenario requires runtime infrastructure (mock servers, LLM stubs, git remotes) and you need to generate step definitions for it
    - When troubleshooting why `removedScenarios` is always empty in step def agent output
    - When modifying `adws/phases/stepDefPhase.ts` or `adws/agents/stepDefAgent.ts`

- app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md
  - Conditions:
    - When working with rate limit handling, pause/resume mechanics, or `agents/paused_queue.json`
    - When modifying `adws/core/phaseRunner.ts` (`runPhase`) or adding new phase names for skip-on-resume support
    - When implementing or debugging the cron probe loop (`pauseQueueScanner.ts`)
    - When adding new orchestrators that should benefit from pause/resume (must use `initializeWorkflow + CostTracker + runPhase()`)
    - When troubleshooting why a `⏸️ Paused` or `▶️ Resumed` comment is not appearing on a GitHub issue
    - When modifying cron trigger issue eligibility logic (`trigger_cron.ts` `evaluateIssue`)
    - When changing dependency extraction behavior in `issueDependencies.ts`

- app_docs/feature-6w7p98-unit-test-tdd-integration.md
  - Conditions:
    - When working with the `/implement_tdd` skill (`SKILL.md`) and unit test integration
    - When a target repo has `## Unit Tests: enabled` in `.adw/project.md`
    - When implementing or extending the red-green-refactor loop in the TDD skill
    - When troubleshooting why unit tests are not being written during the TDD loop
    - When adding or modifying `@adw-308` BDD scenarios or their step definitions

- app_docs/feature-wc1uva-auto-approve-and-mer-chore-llm-diff-gate.md
  - Conditions:
    - When working with `adwChore.tsx` or the chore orchestrator pipeline
    - When modifying `diffEvaluatorAgent.ts`, `diffEvaluationPhase.ts`, or `.claude/commands/diff_evaluator.md`
    - When changing the routing of `/chore` issues in `adws/types/issueRouting.ts`
    - When adding a new issue type that should auto-approve and auto-merge after an LLM diff gate
    - When troubleshooting why a chore PR was not auto-merged or was unexpectedly escalated to review

- app_docs/feature-es3uts-cost-api-worker-d1-ingest.md
  - Conditions:
    - When working with the `workers/cost-api/` Cloudflare Worker
    - When implementing the D1 cost database schema (`projects`, `cost_records`, `token_usage`)
    - When wiring ADW phases to POST cost records to `costs.paysdoc.nl/api/cost`
    - When troubleshooting bearer token auth, project auto-creation, or token usage fan-out in the cost API
    - When deploying or migrating the `adw-costs` D1 database

- app_docs/feature-zt8gjc-fix-divergent-branch-pull.md
  - Conditions:
    - When working with `adws/core/targetRepoManager.ts` or `adws/vcs/branchOperations.ts`
    - When troubleshooting `fatal: Need to specify how to reconcile divergent branches` errors
    - When adding or modifying `git pull` calls anywhere in the VCS layer
    - When ADW crashes during `pullLatestDefaultBranch` or `checkoutBranch` in CI/automation environments

- app_docs/feature-qr9z6g-fix-worktree-path-rewriting.md
  - Conditions:
    - When working with `.claude/hooks/pre-tool-use.ts` or the pre-tool-use hook
    - When Claude agents write files to the wrong directory (main repo root instead of worktree)
    - When modifying `claudeAgent.ts` spawn env or `getSafeSubprocessEnv()` / `SAFE_ENV_VARS` in `environment.ts`
    - When adding new env vars that must propagate from ADW orchestrator to spawned Claude CLI subprocesses
    - When working with `fetchLatestRefs` or `pullLatestDefaultBranch` in `targetRepoManager.ts`
    - When troubleshooting worktree contamination or dangerous `git pull` crashes in the main repo root


- app_docs/feature-48ki7w-cost-api-get-endpoints.md
  - Conditions:
    - When working with the `workers/cost-api/` Cloudflare Worker GET endpoints
    - When implementing or consuming `/api/projects`, `/api/projects/:id/costs/breakdown`, or `/api/projects/:id/costs/issues`
    - When configuring CORS for the cost-api Worker (`ALLOWED_ORIGINS` env var)
    - When troubleshooting 404 responses for project ID lookups or phase ordering in cost issues
    - When adding new read endpoints to the cost-api Worker

- app_docs/feature-gq51dc-migrate-cron-stage-from-state-file.md
  - Conditions:
    - When working with `trigger_cron.ts` stage resolution or `evaluateIssue()` eligibility logic
    - When modifying or extending `adws/triggers/cronStageResolver.ts` (stage classification, adw-id extraction)
    - When adding new `workflowStage` values and need to understand how `isActiveStage()` / `isRetriableStage()` classify them
    - When troubleshooting cron filters incorrectly including or excluding issues (grace period, active, retriable, paused)
    - When implementing a new trigger that needs to read workflow stage from the state file

- app_docs/feature-i4m1uk-orchestrator-resilie-takeover-handler-integration.md
  - Conditions:
    - When working with `evaluateCandidate`, `CandidateDecision`, `TakeoverDeps`, or `buildDefaultTakeoverDeps` in `adws/triggers/takeoverHandler.ts`
    - When modifying the cron or webhook spawn path and need to understand the mandatory takeover gate
    - When troubleshooting why an issue was deferred, skipped, or taken over instead of spawning fresh
    - When implementing a new trigger entry point that spawns orchestrators (must route through `evaluateCandidate`)
    - When working with the `take_over_adwId` decision and the `worktreeReset → remoteReconcile` sequence
    - When investigating SIGKILL behavior for live-but-unlocked PIDs in `*_running` stages

- app_docs/feature-yxo18t-spawngate-lifetime-pid-liveness.md
  - Conditions:
    - When working with `acquireOrchestratorLock` or `releaseOrchestratorLock` in `adws/phases/orchestratorLock.ts`
    - When adding a new orchestrator and need to wire the spawn lock for its full lifetime
    - When troubleshooting contention between two orchestrators for the same issue (one exits 0 on acquire failure)
    - When understanding why the lock file persists after a crash and how staleness reclaim works
    - When working with `adwMerge.tsx` acquire/release wiring (uses raw spawnGate primitives, not the helper)

- app_docs/feature-7fy9ry-simplify-webhook-handlers.md
  - Conditions:
    - When working with `handlePullRequestEvent()` or `handleIssueClosedEvent()` in `adws/triggers/webhookHandlers.ts`
    - When modifying the `pull_request.closed` or `issues.closed` webhook handler dispatch in `trigger_webhook.ts`
    - When troubleshooting abandoned PR flows (state write, issue close cascade, dependent closing)
    - When implementing or changing the grace period guard for active orchestrators in `handleIssueClosedEvent()`
    - When working with `closeAbandonedDependents()` in `adws/triggers/webhookGatekeeper.ts`
    - When wondering why `handleApprovedReview()` is absent from `autoMergeHandler.ts` (removed in this feature)

- app_docs/feature-fequcj-fix-fail-open-dependency-check.md
  - Conditions:
    - When working with `findOpenDependencies()` in `adws/triggers/issueDependencies.ts`
    - When modifying error handling in `trigger_webhook.ts` (`issues.opened` or `issue_comment` handlers)
    - When troubleshooting issues with open dependencies being started prematurely or duplicate orchestrators
    - When the GitHub API is under contention and dependency checks may fail silently
    - When adding new catch blocks in webhook handlers that involve eligibility checks

- app_docs/feature-b0y6j4-fix-token-limit-comment.md
  - Conditions:
    - When working with `formatTokenLimitRecoveryComment()` in `adws/github/workflowCommentsIssue.ts`
    - When modifying `TokenUsageSnapshot` fields in `adws/types/agentTypes.ts`
    - When troubleshooting token limit recovery comments on GitHub issues showing incorrect or inflated token counts
    - When the token limit comment numerator exceeds the denominator (total vs output-only mismatch)

- app_docs/feature-vv4ie0-relocate-test-phase-extract-commit-push.md
  - Conditions:
    - When working with `adws/phases/prReviewPhase.ts` and adding or relocating PR review phases
    - When working with `adws/phases/prReviewCompletion.ts` and expecting it to contain phase-execution logic (it no longer does — it is terminal-only)
    - When wiring a new commit+push step in the PR review orchestrator (`adwPrReview.tsx`)
    - When troubleshooting why `completePRReviewWorkflow` no longer calls `runCommitAgent` or `pushBranch`
    - When understanding the anti-pattern resolution described in `specs/prd/test-review-refactor.md`

- app_docs/feature-f1f94g-pr-review-distribute-board-move.md
  - Conditions:
    - When working with `completePRReviewWorkflow` in `adws/phases/prReviewCompletion.ts` and expecting it to move the board status (it no longer does)
    - When working with `executePRReviewCommitPushPhase` in `adws/phases/prReviewPhase.ts` and the board move timing
    - When troubleshooting why the issue does not move to `Review` status until the commit+push phase (not the completion phase)
    - When adding a new board status transition to the PR review workflow and choosing which phase owns it

- app_docs/feature-9jpn7u-replace-clear-with-cancel.md
  - Conditions:
    - When working with `isCancelComment` or `CANCEL_COMMENT_PATTERN` in `adws/core/workflowCommentParsing.ts`
    - When working with `handleCancelDirective` or `MutableProcessedSets` in `adws/triggers/cancelHandler.ts`
    - When modifying cancel/clear directive handling in `trigger_cron.ts` or `trigger_webhook.ts`
    - When troubleshooting why `## Cancel` does not kill processes, remove worktrees, or clean state dirs
    - When adding a new cleanup step to the cancel sequence (process kill → worktree removal → state dir deletion → comment clearing)

- app_docs/feature-yipjb0-fix-cancel-per-cycle-skip.md
  - Conditions:
    - When working with `evaluateIssue` or `filterEligibleIssues` in `adws/triggers/cronIssueFilter.ts` and the `cancelledThisCycle` parameter
    - When troubleshooting cancelled issues showing as `#N(processed)` instead of `#N(cancelled)` across cron cycles
    - When modifying the cancel-scan loop in `trigger_cron.ts` (the `handleCancelDirective` + per-cycle set pattern)
    - When understanding the semantic difference between `processedSpawns` (permanent in-process dedup) and `cancelledThisCycle` (one-cycle skip)
    - When adding regression tests for the two-cycle cancel re-eligibility behavior

- app_docs/feature-qm6gwx-board-manager-provider.md
  - Conditions:
    - When working with `BoardManager`, `BoardStatus`, `BOARD_COLUMNS`, or `BoardColumnDefinition` in `adws/providers/types.ts`
    - When adding or modifying board setup logic in `adws/phases/workflowInit.ts`
    - When changing how terminal workflow errors move issues on the board (`handleWorkflowError`, `handlePRReviewWorkflowError`)
    - When implementing `BoardManager` for a new platform (GitLab, Jira stubs exist)
    - When troubleshooting why a project board was not created or columns are missing after a workflow run

- app_docs/feature-zyjh0z-move-pr-approval-int.md
  - Conditions:
    - When working with `approvePR()` in `adws/github/prApi.ts` or the PAT-swap approval pattern
    - When working with `executeAutoMergePhase` and understanding why it no longer calls `approvePR`
    - When troubleshooting PRs blocked at the `hitl` gate due to missing approved review
    - When modifying `reviewPhase.ts` approval logic or `fetchPRApprovalState` in `prApi.ts`
    - When adding `NON_RETRYABLE_PATTERNS` for auth errors in `adws/core/utils.ts`
    - When implementing a new orchestrator and wondering where approval responsibility lives

- app_docs/feature-w12d7t-fix-board-update-mutation.md
  - Conditions:
    - When working with `GitHubBoardManager.ensureColumns` or the board column setup path in `githubBoardManager.ts`
    - When troubleshooting `UpdateProjectV2FieldInput doesn't accept argument 'projectId'` GraphQL errors
    - When modifying the `updateProjectV2Field` mutation or the `mergeStatusOptions` helper
    - When board column setup silently skips because all ADW columns are already present
    - When using `gh api graphql --input -` (stdin JSON) to pass array arguments to the GitHub GraphQL API

- app_docs/feature-hjcays-fix-board-pat-auth.md
  - Conditions:
    - When working with `GitHubBoardManager` auth handling in `adws/providers/github/githubBoardManager.ts`
    - When troubleshooting `gh: Resource not accessible by integration` during board initialization on user-owned repos
    - When modifying `findBoard`, `createBoard`, or `ensureColumns` and need to understand the `withProjectBoardAuth` wrapper
    - When `GITHUB_PAT` is configured but board columns are still not being created
    - When adding a new public method to `GitHubBoardManager` that issues GraphQL calls (must route through `withProjectBoardAuth`)

- app_docs/feature-ope038-pause-queue-resume-spawn-hardening.md
  - Conditions:
    - When working with `adws/triggers/pauseQueueScanner.ts` or the `resumeWorkflow()` function
    - When troubleshooting paused workflows that appear resumed (▶️ comment posted) but never actually started
    - When modifying the pause-queue resume path, spawn options, or side-effect ordering
    - When inspecting `agents/paused_queue_logs/{adwId}.resume.log` to diagnose a stranded workflow
    - When the `probeFailures` escalation path or `MAX_UNKNOWN_PROBE_FAILURES` abandonment logic is relevant to resume failures

- app_docs/feature-7dp24s-deterministic-branch-name-assembly.md
  - Conditions:
    - When working with `generateBranchName()` or `validateSlug()` in `adws/vcs/branchOperations.ts`
    - When modifying `runGenerateBranchNameAgent()` or `extractSlugFromOutput()` in `adws/agents/gitAgent.ts`
    - When updating the `/generate_branch_name` LLM prompt or its expected output shape
    - When troubleshooting ghost branches or mismatched branch names between state files and on-disk worktrees
    - When adding a new branch prefix type and need to understand the assembly contract

- app_docs/feature-eantbn-orchestrator-resilie-worktree-reset-module.md
  - Conditions:
    - When working with `adws/vcs/worktreeReset.ts` or `resetWorktreeToRemote()`
    - When implementing the takeover handler (PRD slice #11) that calls `resetWorktreeToRemote` before resuming a dead orchestrator's work
    - When troubleshooting mid-merge, mid-rebase, or dirty-worktree state left by a crashed orchestrator
    - When adding worktree reset logic that must handle linked worktrees (git-dir indirection via `rev-parse --git-dir`)
    - When writing unit tests for VCS functions that mix `execSync` and `fs` calls (follow the `worktreeReset.test.ts` mocking pattern)

- app_docs/feature-guimqa-extend-top-level-state-schema.md
  - Conditions:
    - When working with `AgentState.lastSeenAt`, `AgentState.pid`, `AgentState.pidStartedAt`, or `AgentState.branchName` in `adws/types/agentTypes.ts`
    - When implementing the heartbeat module (future slice) that writes `lastSeenAt` every 30 seconds
    - When implementing the takeover handler that reads liveness fields (`pid`, `pidStartedAt`, `lastSeenAt`) to decide spawn strategy
    - When troubleshooting a torn or zero-byte `state.json` (atomic writer protects against this)
    - When writing tests for `writeTopLevelState` partial-patch or forward-compatible read behavior

- app_docs/feature-jcwqw7-extend-top-level-state-schema.md
  - Conditions:
    - When working with `AgentState.lastSeenAt`, `AgentState.pid`, `AgentState.pidStartedAt`, or `AgentState.branchName` in `adws/types/agentTypes.ts`
    - When implementing the heartbeat module (future slice) that writes `lastSeenAt` every 30 seconds
    - When implementing the takeover handler that reads liveness fields to decide spawn strategy
    - When troubleshooting atomic write behavior in `writeTopLevelState` or a torn `state.json`
    - When writing or extending `adws/core/__tests__/topLevelState.test.ts` for partial-patch or forward-compatible read scenarios

- app_docs/feature-zy5s32-heartbeat-module-tracer-integration.md
  - Conditions:
    - When working with `adws/core/heartbeat.ts`, `startHeartbeat`, `stopHeartbeat`, or `HeartbeatHandle`
    - When implementing the hung-orchestrator detector that consumes `lastSeenAt` and `HEARTBEAT_STALE_THRESHOLD_MS`
    - When wiring heartbeat lifecycle (start/stop) into additional orchestrators beyond `adwSdlc` (PRD slice #8)
    - When troubleshooting `lastSeenAt` not updating in the state file while a workflow is running
    - When modifying `HEARTBEAT_TICK_INTERVAL_MS` or `HEARTBEAT_STALE_THRESHOLD_MS` constants in `adws/core/config.ts`

- app_docs/feature-bzlaaq-resume-verify-canonical-claim.md
  - Conditions:
    - When working with `resumeWorkflow()` in `adws/triggers/pauseQueueScanner.ts` or the pause-queue resume path
    - When troubleshooting a paused workflow that aborts on resume with "canonical claim diverged" or "spawn lock held" log lines
    - When implementing or modifying the per-issue spawn lock (spawnGate) interaction in the pause-queue scanner
    - When a paused workflow's `agents/{adwId}/state.json` has been manually edited or replaced and the scanner stops retrying
    - When understanding the asymmetric abort behavior: lock-held leaves the queue entry, claim-diverged removes it and posts an error comment

- app_docs/feature-xruqv8-hung-orchestrator-detector.md
  - Conditions:
    - When working with `adws/core/hungOrchestratorDetector.ts`, `findHungOrchestrators`, or `HungDetectorDeps`
    - When modifying or extending the hung-orchestrator sweep block in `adws/triggers/trigger_cron.ts`
    - When troubleshooting orchestrators that are alive but wedged and not being automatically abandoned
    - When tuning `HUNG_DETECTOR_INTERVAL_CYCLES` or `HEARTBEAT_STALE_THRESHOLD_MS` for detection latency
    - When implementing the takeover handler (PRD slice #11) that consumes the `abandoned` state written by this sweep
