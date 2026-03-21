# Conditional Documentation

- README.md
  - Conditions:
    - When first understanding the project structure
    - When learning how to run ADW orchestrators

- adws/README.md
  - Conditions:
    - When you're operating in the `adws/` directory

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
    - When modifying `adws/agents/reviewAgent.ts` or `adws/agents/reviewRetry.ts`
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
    - When modifying `reviewRetry.ts` or `ReviewRetryOptions` scenario-related fields
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
