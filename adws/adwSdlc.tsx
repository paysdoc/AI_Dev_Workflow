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
 * 5. Test Phase: optionally run unit tests (unit only)
 * 6. Review Phase: review implementation + run BDD scenarios, patch blockers, retry
 * 7. Document Phase: generate feature documentation (includes review screenshots)
 * 8. PR Phase: create pull request (only after review passes)
 * 9. KPI Phase: track agentic KPIs (non-fatal)
 * 10. AutoMerge Phase: approve and merge the PR (non-fatal)
 * 11. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import * as path from 'path';
import { OrchestratorId } from './core';
import { defineOrchestrator, runOrchestrator, parallel, optional } from './core/orchestratorRunner';
import {
  executeInstallPhase,
  executePlanPhase,
  executeScenarioPhase,
  executeAlignmentPhase,
  executeBuildPhase,
  executeTestPhase,
  executePRPhase,
  executeReviewPhase,
  executeDocumentPhase,
  executeKpiPhase,
  executeAutoMergePhase,
} from './workflowPhases';

type TestPhaseResult = Awaited<ReturnType<typeof executeTestPhase>>;
type ReviewPhaseResult = Awaited<ReturnType<typeof executeReviewPhase>>;

function getReviewScreenshotsDir(adwId: string): string {
  return path.join('agents', adwId, 'review-agent', 'review_img');
}

runOrchestrator(defineOrchestrator({
  id: OrchestratorId.Sdlc,
  scriptName: 'adwSdlc.tsx',
  usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
  phases: [
    { name: 'install', execute: executeInstallPhase },
    parallel('plan+scenario', [
      { name: 'plan', execute: executePlanPhase },
      { name: 'scenario', execute: executeScenarioPhase },
    ]),
    { name: 'alignment', execute: executeAlignmentPhase },
    { name: 'build', execute: executeBuildPhase },
    { name: 'test', execute: executeTestPhase },
    { name: 'review', execute: executeReviewPhase },
    { name: 'document', execute: (cfg) => executeDocumentPhase(cfg, getReviewScreenshotsDir(cfg.adwId)) },
    { name: 'pr', execute: executePRPhase },
    optional({ name: 'kpi', execute: (cfg, results) => {
      const review = results.get<ReviewPhaseResult>('review');
      return executeKpiPhase(cfg, review?.totalRetries);
    } }),
    optional({ name: 'autoMerge', execute: executeAutoMergePhase }),
  ],
  completionMetadata: (results) => {
    const test = results.get<TestPhaseResult>('test');
    const review = results.get<ReviewPhaseResult>('review');
    return {
      unitTestsPassed: test?.unitTestsPassed ?? false,
      totalTestRetries: test?.totalRetries ?? 0,
      reviewPassed: review?.reviewPassed ?? false,
      totalReviewRetries: review?.totalRetries ?? 0,
    };
  },
}));
