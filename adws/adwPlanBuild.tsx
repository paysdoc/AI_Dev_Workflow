#!/usr/bin/env bunx tsx
/**
 * ADW Plan & Build - Plan+Build+Test+PR Orchestrator (no review)
 *
 * Usage: bunx tsx adws/adwPlanBuild.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 */

import { defineOrchestrator, runOrchestrator, OrchestratorId } from './core';
import { executeInstallPhase, executePlanPhase, executeBuildPhase, executeTestPhase, executePRPhase } from './workflowPhases';

runOrchestrator(defineOrchestrator({
  id: OrchestratorId.PlanBuild,
  scriptName: 'adwPlanBuild.tsx',
  usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
  phases: [
    { name: 'install', execute: executeInstallPhase },
    { name: 'plan', execute: executePlanPhase },
    { name: 'build', execute: executeBuildPhase },
    { name: 'test', execute: executeTestPhase, completionMetadata: (r) => ({ unitTestsPassed: (r as unknown as { unitTestsPassed: boolean }).unitTestsPassed, totalTestRetries: (r as unknown as { totalRetries: number }).totalRetries }) },
    { name: 'pr', execute: executePRPhase },
  ],
}));
