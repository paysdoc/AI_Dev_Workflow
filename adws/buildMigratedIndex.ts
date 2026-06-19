/**
 * buildMigratedIndex.ts — one-off migration helper (throwaway script)
 *
 * Rewrites .adw/conditional_docs.md using the registry module's canonical
 * serialization from the hardcoded ~40-module seed taxonomy. Run AFTER the
 * module docs have been written to app_docs/feature-9gjajh-*.md.
 *
 * Run via: bunx tsx adws/buildMigratedIndex.ts
 */

import * as fs from 'fs';
import {
  serializeConditionalDocs,
  type ConditionalDocEntry,
  type ConditionalDocsRegistry,
} from './core/conditionalDocsRegistry.ts';

const INDEX_PATH = '.adw/conditional_docs.md';
const PREAMBLE = '# Conditional Documentation\n\n';

const entries: ConditionalDocEntry[] = [
  // ── PRESERVED (carry verbatim from feature-o4qdu5) ──────────────────────
  {
    docPath: 'app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md',
    ownedGlobs: [
      'adws/core/conditionalDocsRegistry.ts',
      'adws/core/__tests__/conditionalDocsRegistry.test.ts',
      '.adw/conditional_docs.md',
      '.claude/commands/document.md',
      'features/per-issue/feature-609.feature',
      'features/per-issue/feature-610.feature',
      'features/per-issue/step_definitions/feature-609.steps.ts',
      'features/per-issue/step_definitions/feature-610.steps.ts',
    ],
    conditions: [
      'When working with `parseConditionalDocs`, `serializeConditionalDocs`, `findOwningEntry`, `findOwningEntries`, `collapseEntries`, or `upsertEntry` in `adws/core/conditionalDocsRegistry.ts`',
      'When implementing or troubleshooting the `/document` routing path: semantic-first ownership judgment, rewrite-in-place, sibling collapse-and-prune, or novel-only create',
      'When collapsing multiple sibling entries for the same area into one doc + one entry (prune redundant docs and index entries)',
      "When regenerating an entry's `Conditions:` block and doc Overview after a rewrite so the semantic matcher stays accurate",
      'When adding or updating `Owns:` glob blocks in `.adw/conditional_docs.md` for routing',
      'When the `conditionalDocs` structured field on `ProjectConfig` (vs. the raw `conditionalDocsMd` string) is relevant',
      'When troubleshooting legacy entries (no `Owns:` block) that cannot be routed by glob but may still be matched semantically',
      'When extending the glob matcher (`**` vs `*` vs `?` boundary behavior)',
      'When working on the `@adw-609` or `@adw-610` BDD content-assertion scenarios for convergence registry behavior',
    ],
  },

  // ── adws/core/ — split into 10 focused modules ───────────────────────────
  {
    docPath: 'app_docs/feature-9gjajh-coordination-kernel.md',
    ownedGlobs: [
      'adws/core/processLiveness.ts',
      'adws/core/heartbeat.ts',
      'adws/core/hungOrchestratorDetector.ts',
      'adws/core/agentTimeouts.ts',
      'adws/core/retryOrchestrator.ts',
      'adws/core/processKill.ts',
      'adws/core/__tests__/heartbeat.test.ts',
      'adws/core/__tests__/processLiveness.test.ts',
      'adws/core/__tests__/hungOrchestratorDetector.test.ts',
    ],
    conditions: [
      'When working on process liveness, heartbeat signals, hung orchestrator detection, or agent timeout enforcement in `adws/core/`',
      'When debugging a stuck or zombie orchestrator process',
      'When working on `processLiveness.ts`, `heartbeat.ts`, `hungOrchestratorDetector.ts`, `agentTimeouts.ts`, `retryOrchestrator.ts`, or `processKill.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-state-and-config.md',
    ownedGlobs: [
      'adws/core/agentState.ts',
      'adws/core/stateHelpers.ts',
      'adws/core/projectConfig.ts',
      'adws/core/adwYmlConfig.ts',
      'adws/core/config.ts',
      'adws/core/constants.ts',
      'adws/core/environment.ts',
      'adws/core/index.ts',
      'adws/core/__tests__/agentState.test.ts',
      'adws/core/__tests__/stateHelpers.test.ts',
      'adws/core/__tests__/projectConfig.test.ts',
      'adws/core/__tests__/adwYmlConfig.test.ts',
      'adws/core/__tests__/environment.test.ts',
      'adws/core/__tests__/topLevelState.test.ts',
    ],
    conditions: [
      'When working on ADW agent state persistence, top-level state helpers, project config loading, `.adw/adw.yml` configuration, or environment resolution',
      'When working on `agentState.ts`, `stateHelpers.ts`, `projectConfig.ts`, `adwYmlConfig.ts`, `config.ts`, `constants.ts`, or `environment.ts`',
      'When the `ProjectConfig` structured fields (`conditionalDocs`, `conditionalDocsMd`, etc.) or the `.adw/` directory parsing is involved',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-claude-stream-parser.md',
    ownedGlobs: [
      'adws/core/claudeStreamParser.ts',
      'adws/core/jsonParser.ts',
      'adws/core/orchestratorCli.ts',
      'adws/core/orchestratorLib.ts',
      'adws/core/phaseRunner.ts',
      'adws/core/__tests__/claudeStreamParser.test.ts',
      'adws/core/__tests__/phaseRunner.test.ts',
    ],
    conditions: [
      "When working on the Claude JSONL/streaming output parser, JSON line parser, orchestrator CLI entry points, or the phase runner loop",
      'When working on `claudeStreamParser.ts`, `jsonParser.ts`, `orchestratorCli.ts`, `orchestratorLib.ts`, or `phaseRunner.ts`',
      "When debugging how ADW reads Claude Code's stdout/stderr or how phases are sequenced by the runner",
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-hash-and-versioning.md',
    ownedGlobs: [
      'adws/core/hashComputer.ts',
      'adws/core/adwVersion.ts',
      'adws/core/adwId.ts',
      'adws/core/upgradeClaim.ts',
      'adws/core/__tests__/adwVersion.test.ts',
      'adws/core/__tests__/hashComputer.test.ts',
      'adws/core/__tests__/upgradeClaim.test.ts',
      'adws/core/__tests__/upgradeClaim.integration.test.ts',
    ],
    conditions: [
      'When working on ADW hash computation (input hash, regen verification), ADW version strings, ADW IDs, or upgrade claims',
      'When working on `hashComputer.ts`, `adwVersion.ts`, `adwId.ts`, or `upgradeClaim.ts`',
      'When the `adwUpgrade` self-upgrade loop or hash-based regen guard is involved',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-pause-and-auth-queues.md',
    ownedGlobs: [
      'adws/core/pauseQueue.ts',
      'adws/core/authGate.ts',
      'adws/core/__tests__/authGate.test.ts',
    ],
    conditions: [
      'When working on the ADW pause queue (orchestrators waiting for a resume signal) or the auth gate (401/auth-failure classification and Slack notification)',
      'When working on `pauseQueue.ts` or `authGate.ts`',
      'When debugging a stuck pause or an auth failure that killed in-flight agents',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-test-report-and-verdict.md',
    ownedGlobs: [
      'adws/core/testReportParser.ts',
      'adws/core/testVerdict.ts',
      'adws/core/resolveVerdict.ts',
      'adws/core/__tests__/testReportParser.test.ts',
      'adws/core/__tests__/testVerdict.test.ts',
      'adws/core/__tests__/resolveVerdict.test.ts',
    ],
    conditions: [
      'When working on JUnit XML parsing, test verdict derivation, or scenario proof pass/fail resolution',
      'When working on `testReportParser.ts`, `testVerdict.ts`, or `resolveVerdict.ts`',
      'When debugging why a test phase verdict is wrong or how JUnit reports are aggregated',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-classifier-and-routing.md',
    ownedGlobs: [
      'adws/core/issueClassifier.ts',
      'adws/core/modelRouting.ts',
      'adws/core/workflowMapping.ts',
      'adws/core/workflowCommentParsing.ts',
      'adws/core/__tests__/issueClassifier.test.ts',
      'adws/core/__tests__/workflowCommentParsing.test.ts',
      'adws/core/__tests__/workflowMapping.test.ts',
    ],
    conditions: [
      'When working on issue classification (feature/bug/chore/etc.), model routing decisions, workflow-type-to-phase mapping, or workflow comment parsing',
      'When working on `issueClassifier.ts`, `modelRouting.ts`, `workflowMapping.ts`, or `workflowCommentParsing.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-slack-and-logging.md',
    ownedGlobs: [
      'adws/core/slackNotifier.ts',
      'adws/core/logger.ts',
      'adws/core/utils.ts',
      'adws/core/__tests__/slackNotifier.test.ts',
    ],
    conditions: [
      'When working on Slack notifications, the ADW structured logger, or shared utility functions in `adws/core/`',
      'When working on `slackNotifier.ts`, `logger.ts`, or `utils.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-freeze-and-coherence.md',
    ownedGlobs: [
      'adws/core/stackCoherenceCheck.ts',
      'adws/core/resolveFreezeGuard.ts',
      'adws/core/stepDefDetection.ts',
      'adws/core/__tests__/stackCoherenceCheck.test.ts',
      'adws/core/__tests__/resolveFreezeGuard.test.ts',
      'adws/core/__tests__/stepDefDetection.test.ts',
    ],
    conditions: [
      'When working on scenario freeze guards, stack coherence checking (conflicting merge candidates), or step definition auto-detection',
      'When working on `stackCoherenceCheck.ts`, `resolveFreezeGuard.ts`, or `stepDefDetection.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-dev-server-and-ports.md',
    ownedGlobs: [
      'adws/core/devServerLifecycle.ts',
      'adws/core/portAllocator.ts',
      'adws/core/remoteReconcile.ts',
      'adws/core/targetRepoManager.ts',
      'adws/core/__tests__/devServerLifecycle.test.ts',
      'adws/core/__tests__/remoteReconcile.test.ts',
    ],
    conditions: [
      'When working on dev server lifecycle management, dynamic port allocation, remote repo reconciliation, or target repo cloning/updating',
      'When working on `devServerLifecycle.ts`, `portAllocator.ts`, `remoteReconcile.ts`, or `targetRepoManager.ts`',
    ],
  },

  // ── Top-level orchestrators ───────────────────────────────────────────────
  {
    docPath: 'app_docs/feature-9gjajh-sdlc-orchestrators.md',
    ownedGlobs: [
      'adws/adwSdlc.tsx',
      'adws/adwPlanBuild.tsx',
      'adws/adwPlanBuildDocument.tsx',
      'adws/adwPlanBuildReview.tsx',
      'adws/adwPlanBuildTest.tsx',
      'adws/adwPlanBuildTestReview.tsx',
      'adws/workflowPhases.ts',
    ],
    conditions: [
      'When working on the top-level SDLC workflow orchestrators: `adwSdlc`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview`',
      'When working on workflow-level phase sequencing in `workflowPhases.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-feature-orchestrators.md',
    ownedGlobs: [
      'adws/adwBuild.tsx',
      'adws/adwPlan.tsx',
      'adws/adwTest.tsx',
      'adws/adwMerge.tsx',
      'adws/adwChore.tsx',
      'adws/adwPatch.tsx',
      'adws/adwPrReview.tsx',
      'adws/adwDocument.tsx',
      'adws/adwPromotionSweep.tsx',
      'adws/adwUpgrade.tsx',
      'adws/adwClearComments.tsx',
      'adws/adwBuildHelpers.ts',
      'adws/index.ts',
    ],
    conditions: [
      'When working on single-issue orchestrators: `adwBuild`, `adwPlan`, `adwTest`, `adwMerge`, `adwChore`, `adwPatch`, `adwPrReview`, `adwDocument`, `adwPromotionSweep`, `adwUpgrade`, `adwClearComments`',
      'When working on top-level `adws/index.ts` exports or `adwBuildHelpers.ts`',
    ],
  },

  // ── adws/agents/ ─────────────────────────────────────────────────────────
  {
    docPath: 'app_docs/feature-9gjajh-claude-agents-core.md',
    ownedGlobs: [
      'adws/agents/claudeAgent.ts',
      'adws/agents/commandAgent.ts',
      'adws/agents/gitAgent.ts',
      'adws/agents/agentProcessHandler.ts',
      'adws/agents/jsonlParser.ts',
      'adws/agents/index.ts',
    ],
    conditions: [
      'When working on the low-level Claude agent runner, command agents, git agents, agent process lifecycle, or the JSONL output parser in `adws/agents/`',
      'When working on `claudeAgent.ts`, `commandAgent.ts`, `gitAgent.ts`, `agentProcessHandler.ts`, or `jsonlParser.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-plan-and-build-agents.md',
    ownedGlobs: [
      'adws/agents/planAgent.ts',
      'adws/agents/alignmentAgent.ts',
      'adws/agents/buildAgent.ts',
      'adws/agents/installAgent.ts',
    ],
    conditions: [
      'When working on the plan agent, alignment agent, build agent, or install agent in `adws/agents/`',
      'When working on `planAgent.ts`, `alignmentAgent.ts`, `buildAgent.ts`, or `installAgent.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-review-and-patch-agents.md',
    ownedGlobs: [
      'adws/agents/reviewAgent.ts',
      'adws/agents/diffEvaluatorAgent.ts',
      'adws/agents/patchAgent.ts',
      'adws/agents/refactorAgent.ts',
      'adws/agents/resolutionAgent.ts',
      'adws/agents/validationAgent.ts',
    ],
    conditions: [
      'When working on review, diff evaluation, patch, refactor, resolution, or validation agents in `adws/agents/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-scenario-and-stepdef-agents.md',
    ownedGlobs: [
      'adws/agents/bddScenarioRunner.ts',
      'adws/agents/scenarioAgent.ts',
      'adws/agents/scenarioFidelityAgent.ts',
      'adws/agents/stepDefAgent.ts',
      'adws/agents/testAgent.ts',
      'adws/agents/testRetry.ts',
    ],
    conditions: [
      'When working on BDD scenario runner, scenario writer agent, scenario fidelity agent, step def generation agent, test agent, or test retry in `adws/agents/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-pr-and-document-agents.md',
    ownedGlobs: [
      'adws/agents/prAgent.ts',
      'adws/agents/documentAgent.ts',
      'adws/agents/dependencyExtractionAgent.ts',
    ],
    conditions: [
      'When working on the PR creation agent, document agent (runs `/document`), or dependency extraction agent in `adws/agents/`',
    ],
  },

  // ── adws/phases/ ─────────────────────────────────────────────────────────
  {
    docPath: 'app_docs/feature-9gjajh-build-and-plan-phases.md',
    ownedGlobs: [
      'adws/phases/buildPhase.ts',
      'adws/phases/planPhase.ts',
      'adws/phases/planValidationPhase.ts',
      'adws/phases/installPhase.ts',
      'adws/phases/alignmentPhase.ts',
    ],
    conditions: [
      'When working on build, plan, plan-validation, install, or alignment phases in `adws/phases/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-test-and-scenario-phases.md',
    ownedGlobs: [
      'adws/phases/scenarioPhase.ts',
      'adws/phases/scenarioTestPhase.ts',
      'adws/phases/scenarioTestFixLoop.ts',
      'adws/phases/scenarioFixPhase.ts',
      'adws/phases/unitTestPhase.ts',
      'adws/phases/stepDefPhase.ts',
    ],
    conditions: [
      'When working on scenario writing, scenario test execution, scenario fix loop, unit test, or step def phases in `adws/phases/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-review-and-diff-phases.md',
    ownedGlobs: [
      'adws/phases/reviewPhase.ts',
      'adws/phases/diffEvaluationPhase.ts',
      'adws/phases/reviewPatchHelpers.ts',
    ],
    conditions: [
      'When working on the review phase, diff evaluation phase, or review patch helpers in `adws/phases/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-pr-and-merge-phases.md',
    ownedGlobs: [
      'adws/phases/prPhase.ts',
      'adws/phases/prReviewPhase.ts',
      'adws/phases/prReviewCompletion.ts',
      'adws/phases/autoMergePhase.ts',
    ],
    conditions: [
      'When working on PR creation, PR review, PR review completion, or auto-merge phases in `adws/phases/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-document-phase.md',
    ownedGlobs: [
      'adws/phases/documentPhase.ts',
    ],
    conditions: [
      'When working on the document phase in `adws/phases/` (the thin wrapper that invokes the `/document` agent)',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-workflow-lifecycle-phases.md',
    ownedGlobs: [
      'adws/phases/workflowInit.ts',
      'adws/phases/workflowCompletion.ts',
      'adws/phases/upgradeGate.ts',
      'adws/phases/orchestratorLock.ts',
      'adws/phases/progressGate.ts',
      'adws/phases/branchNameResolution.ts',
      'adws/phases/authPause.ts',
      'adws/phases/depauditSetup.ts',
      'adws/phases/gherkinFreeze.ts',
      'adws/phases/phaseCommentHelpers.ts',
      'adws/phases/index.ts',
    ],
    conditions: [
      'When working on workflow initialization, completion, upgrade gating, orchestrator locking, progress gating, branch name resolution, auth pause, depaudit setup, Gherkin freeze, or phase comment helpers in `adws/phases/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-proof-and-scenario-proof.md',
    ownedGlobs: [
      'adws/phases/proofPublishPhase.ts',
      'adws/phases/scenarioProof.ts',
      'adws/phases/stackCoherenceReporter.ts',
      'adws/proof/**',
    ],
    conditions: [
      'When working on proof artifact harvesting, PR proof publishing, scenario proof attachment, stack coherence reporting, or the `adws/proof/` module',
    ],
  },

  // ── Other adws/ subsystems ────────────────────────────────────────────────
  {
    docPath: 'app_docs/feature-9gjajh-worktree-and-vcs.md',
    ownedGlobs: [
      'adws/vcs/**',
      'adws/phases/worktreeSetup.ts',
    ],
    conditions: [
      'When working on worktree creation, cleanup, operations, VCS branch operations, commit operations, or worktree setup phase',
      'When working on any file in `adws/vcs/` or `adws/phases/worktreeSetup.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-github-api.md',
    ownedGlobs: [
      'adws/github/**',
    ],
    conditions: [
      'When working on GitHub REST/GraphQL API calls, GitHub App authentication, issue/PR APIs, project board API, workflow comments, HITL board notifier, label manager, PR comment detection, or linked PR detection',
      'When working on any file in `adws/github/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-cron-triggers.md',
    ownedGlobs: [
      'adws/triggers/trigger_cron.ts',
      'adws/triggers/cronIssueFilter.ts',
      'adws/triggers/cronLabelEligibility.ts',
      'adws/triggers/cronProcessGuard.ts',
      'adws/triggers/cronRepoResolver.ts',
      'adws/triggers/cronStageResolver.ts',
    ],
    conditions: [
      'When working on the cron trigger loop, cron issue filtering, label eligibility for cron, cron process guard, repo resolver, or stage resolver',
      'When working on `trigger_cron.ts`, `cronIssueFilter.ts`, `cronLabelEligibility.ts`, `cronProcessGuard.ts`, `cronRepoResolver.ts`, or `cronStageResolver.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-webhook-triggers.md',
    ownedGlobs: [
      'adws/triggers/trigger_webhook.ts',
      'adws/triggers/webhookGatekeeper.ts',
      'adws/triggers/webhookHandlers.ts',
      'adws/triggers/webhookSignature.ts',
    ],
    conditions: [
      'When working on the webhook trigger server, webhook gatekeeper, webhook event handlers, or webhook HMAC signature verification',
      'When working on `trigger_webhook.ts`, `webhookGatekeeper.ts`, `webhookHandlers.ts`, or `webhookSignature.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-takeover-and-coordination.md',
    ownedGlobs: [
      'adws/triggers/takeoverHandler.ts',
      'adws/triggers/concurrencyGuard.ts',
      'adws/triggers/spawnGate.ts',
      'adws/triggers/pauseQueueScanner.ts',
      'adws/triggers/mergeDispatchGate.ts',
    ],
    conditions: [
      'When working on orchestrator takeover, cross-trigger concurrency guards, spawn gating, pause queue scanning, or merge dispatch gating',
      'When working on `takeoverHandler.ts`, `concurrencyGuard.ts`, `spawnGate.ts`, `pauseQueueScanner.ts`, or `mergeDispatchGate.ts`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-issue-routing-and-eligibility.md',
    ownedGlobs: [
      'adws/triggers/issueDependencies.ts',
      'adws/triggers/issueEligibility.ts',
      'adws/triggers/issueOpenedRouter.ts',
      'adws/triggers/autoMergeHandler.ts',
      'adws/triggers/cancelHandler.ts',
      'adws/triggers/retryHandler.ts',
      'adws/triggers/perIssueScenarioSweep.ts',
      'adws/triggers/scanAuthQueue.ts',
      'adws/triggers/devServerJanitor.ts',
      'adws/triggers/cloudflareTunnel.tsx',
      'adws/triggers/trigger_shutdown.ts',
    ],
    conditions: [
      'When working on issue dependency checks, issue eligibility for ADW, issue-opened routing, auto-merge/cancel/retry handlers, per-issue scenario sweep, auth queue scanning, dev server janitor, Cloudflare tunnel, or shutdown trigger',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-providers.md',
    ownedGlobs: [
      'adws/providers/**',
    ],
    conditions: [
      'When working on multi-provider repo context, GitHub provider, GitLab provider, or Jira provider integration in `adws/providers/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-cost-tracking.md',
    ownedGlobs: [
      'adws/cost/**',
    ],
    conditions: [
      'When working on LLM cost computation, cost reporting, D1 cost storage, exchange rate fetching, or cost helpers in `adws/cost/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-promotion-system.md',
    ownedGlobs: [
      'adws/promotion/**',
    ],
    conditions: [
      'When working on scenario promotion scoring, approval detection, promotion commenting, promotion tagging, vocabulary parsing, or promotion threshold in `adws/promotion/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-r2-storage.md',
    ownedGlobs: [
      'adws/r2/**',
    ],
    conditions: [
      'When working on Cloudflare R2 bucket management, R2 upload service, or R2 client in `adws/r2/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-jsonl-schema.md',
    ownedGlobs: [
      'adws/jsonl/**',
    ],
    conditions: [
      'When working on the ADW JSONL event schema, conformance checking, fixture management, or schema probe in `adws/jsonl/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-types.md',
    ownedGlobs: [
      'adws/types/**',
    ],
    conditions: [
      'When working on shared ADW type definitions: `AgentState`, workflow types, issue types, data types, issue routing, or the types module in `adws/types/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-health-check.md',
    ownedGlobs: [
      'adws/healthCheck.tsx',
      'adws/healthCheckChecks.ts',
    ],
    conditions: [
      'When working on the ADW health check orchestrator or health check predicates in `adws/healthCheck.tsx` and `adws/healthCheckChecks.ts`',
    ],
  },

  // ── Workers ───────────────────────────────────────────────────────────────
  {
    docPath: 'app_docs/feature-9gjajh-cost-api-worker.md',
    ownedGlobs: [
      'workers/cost-api/**',
    ],
    conditions: [
      'When working on the Cloudflare Worker that exposes cost data via API, its routes, D1 queries, or wrangler configuration in `workers/cost-api/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-screenshot-router-worker.md',
    ownedGlobs: [
      'workers/screenshot-router/**',
    ],
    conditions: [
      'When working on the Cloudflare Worker that routes screenshot requests in `workers/screenshot-router/`',
    ],
  },

  // ── .claude/ commands & skills ────────────────────────────────────────────
  {
    docPath: 'app_docs/feature-9gjajh-commands-and-skills.md',
    ownedGlobs: [
      '.claude/commands/adw_init.md',
      '.claude/commands/align_plan_scenarios.md',
      '.claude/commands/bug.md',
      '.claude/commands/chore.md',
      '.claude/commands/classify_issue.md',
      '.claude/commands/clean_local_repo.md',
      '.claude/commands/commit.md',
      '.claude/commands/conditional_docs.md',
      '.claude/commands/diff_evaluator.md',
      '.claude/commands/extract_dependencies.md',
      '.claude/commands/feature.md',
      '.claude/commands/find_issue_dependencies.md',
      '.claude/commands/generate_branch_name.md',
      '.claude/commands/generate_step_definitions.md',
      '.claude/commands/implement.md',
      '.claude/commands/install.md',
      '.claude/commands/patch.md',
      '.claude/commands/pr_review.md',
      '.claude/commands/prime.md',
      '.claude/commands/pull_request.md',
      '.claude/commands/resolve_conflict.md',
      '.claude/commands/resolve_failed_scenario.md',
      '.claude/commands/resolve_failed_test.md',
      '.claude/commands/resolve_plan_scenarios.md',
      '.claude/commands/review.md',
      '.claude/commands/scenario_writer.md',
      '.claude/commands/test.md',
      '.claude/commands/tools.md',
      '.claude/skills/**',
      '.claude/hooks/**',
    ],
    conditions: [
      'When working on any Claude Code slash command in `.claude/commands/` (except `/document` which is owned by the registry module doc) or any skill in `.claude/skills/` or hook in `.claude/hooks/`',
    ],
  },

  // ── features/ ─────────────────────────────────────────────────────────────
  {
    docPath: 'app_docs/feature-9gjajh-bdd-regression-suite.md',
    ownedGlobs: [
      'features/regression/**',
    ],
    conditions: [
      'When working on the BDD regression scenario suite, vocabulary registry, step definition registry, or promotion rules in `features/regression/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-bdd-per-issue.md',
    ownedGlobs: [
      'features/per-issue/feature-612.feature',
      'features/per-issue/step_definitions/feature-612.steps.ts',
    ],
    conditions: [
      'When working on BDD per-issue scenario files or step definitions in `features/per-issue/` (for issues other than #609 and #610 which are owned by the registry module doc)',
    ],
  },

  // ── specs/ & root config ───────────────────────────────────────────────────
  {
    docPath: 'app_docs/feature-9gjajh-specs-and-prd.md',
    ownedGlobs: [
      'specs/**',
    ],
    conditions: [
      'When working on product requirements documents, ADW specs, or feature PRDs in `specs/`',
    ],
  },
  {
    docPath: 'app_docs/feature-9gjajh-root-config.md',
    ownedGlobs: [
      'README.md',
      'package.json',
      '.github/**',
      'UBIQUITOUS_LANGUAGE.md',
      'known_issues.md',
      'tsconfig.json',
      'biome.json',
      'vitest.config.ts',
      'bun.lockb',
      '.adw/project.md',
      '.adw/commands.md',
      '.adw/coding_guidelines.md',
      '.adw/scenarios.md',
    ],
    conditions: [
      'When working on root-level configuration: `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `README.md`, `.github/` workflows, `UBIQUITOUS_LANGUAGE.md`, `known_issues.md`, or `.adw/` project metadata files',
    ],
  },
];

const registry: ConditionalDocsRegistry = { preamble: PREAMBLE, entries };
const content = serializeConditionalDocs(registry);
fs.writeFileSync(INDEX_PATH, content, 'utf-8');
console.log(`Wrote ${entries.length} entries to ${INDEX_PATH} (${content.length} chars)`);
