#!/usr/bin/env bunx tsx
/**
 * ADW SDLC - Full Software Development Life Cycle Orchestrator
 *
 * Usage: bunx tsx adws/adwSdlc.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Plan Phase + Scenario Phase (parallel): run plan agent, write BDD scenarios
 * 3. Alignment Phase: single-pass alignment of plan against scenarios
 * 4. Build Phase: run build agent, commit implementation
 * 5. Step Def Phase: generate BDD step definitions
 * 6. Unit Test Phase: optionally run unit tests (unit only)
 * 7. Scenario Test Phase [→ Scenario Fix Phase → retry]: run BDD scenarios, fix failures
 * 8. Review Phase: review implementation (reads scenario proof, does not run scenarios)
 * 9. Document Phase: generate feature documentation (includes review screenshots)
 * 10. KPI Phase: track agentic KPIs (non-fatal, worktree-dependent — runs before PR)
 * 11. PR Phase: create pull request (only after review passes)
 * 12. Approve PR + write awaiting_merge to state, then exit (merge handled by adwMerge.tsx via cron)
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import * as path from 'path';
import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, AgentStateManager, log, MAX_TEST_RETRY_ATTEMPTS } from './core';
import { CostTracker, runPhase, runPhasesParallel } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executePlanPhase,
  executeScenarioPhase,
  executeAlignmentPhase,
  executeBuildPhase,
  executeStepDefPhase,
  executeUnitTestPhase,
  executeScenarioTestPhase,
  executeScenarioFixPhase,
  executePRPhase,
  executeReviewPhase,
  executeDocumentPhase,
  executeKpiPhase,
  handleWorkflowError,
} from './workflowPhases';
import { persistTokenCounts } from './cost';
import type { WorkflowConfig } from './phases';
import type { ScenarioProofResult } from './phases/scenarioProof';
import { approvePR, isGitHubAppConfigured, issueHasLabel, commentOnIssue, type RepoInfo } from './github';
import { extractPrNumber } from './adwBuildHelpers';

/**
 * Derives the review screenshots directory from the review result.
 * Review screenshots are stored in the agent state directory.
 */
function getReviewScreenshotsDir(adwId: string): string {
  return path.join('agents', adwId, 'review-agent', 'review_img');
}

/**
 * Main orchestrator workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'adwSdlc.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
    supportsCwd: false,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Sdlc, {
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
    repoId,
  });

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInstallPhase);
    await runPhasesParallel(config, tracker, [executePlanPhase, executeScenarioPhase]);
    await runPhase(config, tracker, executeAlignmentPhase);
    await runPhase(config, tracker, executeBuildPhase);
    await runPhase(config, tracker, executeStepDefPhase, 'stepDef');
    const unitTestResult = await runPhase(config, tracker, executeUnitTestPhase);

    // Scenario test → fix retry loop (orchestrator-level, bounded by MAX_TEST_RETRY_ATTEMPTS)
    let _scenarioProof: ScenarioProofResult | undefined;
    let scenarioRetries = 0;
    for (let attempt = 0; attempt < MAX_TEST_RETRY_ATTEMPTS; attempt++) {
      const scenarioResult = await runPhase(config, tracker, executeScenarioTestPhase);
      _scenarioProof = scenarioResult.scenarioProof;
      if (!scenarioResult.scenarioProof?.hasBlockerFailures) break;
      scenarioRetries++;
      if (attempt < MAX_TEST_RETRY_ATTEMPTS - 1) {
        const fixWrapper = (cfg: WorkflowConfig) =>
          executeScenarioFixPhase(cfg, scenarioResult.scenarioProof!);
        await runPhase(config, tracker, fixWrapper);
      }
    }

    // Pass empty scenariosMd to review so Review does not run scenarios itself.
    // Review reads the scenario_proof.md written by scenarioTestPhase instead.
    const executeReviewWithoutScenarios = (cfg: WorkflowConfig) => {
      const patchedConfig = { ...cfg, projectConfig: { ...cfg.projectConfig, scenariosMd: '' } };
      return executeReviewPhase(patchedConfig);
    };
    const reviewResult = await runPhase(config, tracker, executeReviewWithoutScenarios);

    // Document phase uses review screenshots: bind screenshotsDir via wrapper.
    const screenshotsDir = getReviewScreenshotsDir(config.adwId);
    const executeDocumentWithScreenshots = (cfg: WorkflowConfig) =>
      executeDocumentPhase(cfg, screenshotsDir);
    await runPhase(config, tracker, executeDocumentWithScreenshots);

    // KPI phase takes an extra argument: bind reviewRetries via wrapper.
    // Runs before PR because it does git commit/push (worktree-dependent).
    const executeKpiWithRetries = (cfg: WorkflowConfig) =>
      executeKpiPhase(cfg, reviewResult.totalRetries);
    await runPhase(config, tracker, executeKpiWithRetries);

    await runPhase(config, tracker, executePRPhase);

    // Post-PR: approve and write awaiting_merge (API calls only — no worktree required).
    const prNumber = extractPrNumber(config.ctx.prUrl);
    const owner = config.repoContext?.repoId.owner ?? '';
    const repo = config.repoContext?.repoId.repo ?? '';
    if (prNumber && owner && repo) {
      const repoInfo: RepoInfo = { owner, repo };
      if (issueHasLabel(issueNumber, 'hitl', repoInfo)) {
        log(`hitl label detected on issue #${issueNumber}, skipping auto-approval`, 'info');
        commentOnIssue(issueNumber, `## ✋ Awaiting human approval — PR #${prNumber} ready for review`, repoInfo);
      } else if (isGitHubAppConfigured()) {
        log(`Approving PR #${prNumber} with personal gh auth login identity...`, 'info');
        const approveResult = approvePR(prNumber, repoInfo);
        if (!approveResult.success) log(`PR approval failed (non-fatal): ${approveResult.error}`, 'warn');
      } else {
        log('No GitHub App configured — skipping PR approval', 'info');
      }
    }
    // Write awaiting_merge and persist costs. Do NOT call completeWorkflow —
    // that overwrites the stage with 'completed'. adwMerge.tsx handles completion after merge.
    AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' });
    AgentStateManager.writeState(config.orchestratorStatePath, {
      metadata: {
        totalCostUsd: tracker.totalCostUsd,
        unitTestsPassed: unitTestResult.unitTestsPassed,
        totalTestRetries: unitTestResult.totalRetries,
        scenarioRetries,
        reviewPassed: reviewResult.reviewPassed,
        totalReviewRetries: reviewResult.totalRetries,
      },
    });
    persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
    log('===================================', 'info');
    log('Orchestrator finished — PR approved, awaiting merge via cron', 'success');
    if (config.ctx.prUrl) log(`PR: ${config.ctx.prUrl}`, 'info');
    log('===================================', 'info');
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
