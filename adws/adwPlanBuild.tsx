#!/usr/bin/env bunx tsx
/**
 * ADW Plan & Build — Plan+Build+Test+PR Orchestrator (no review)
 *
 * Usage: bunx tsx adws/adwPlanBuild.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 */

import { OrchestratorId } from './core';
import { defineOrchestrator, runOrchestrator } from './core/orchestratorRunner';
import { executeInstallPhase, executePlanPhase, executeBuildPhase, buildPhaseOnTokenLimit, executeTestPhase, executePRPhase } from './workflowPhases';

type TestPhaseResult = Awaited<ReturnType<typeof executeTestPhase>>;

runOrchestrator(defineOrchestrator({
  id: OrchestratorId.PlanBuild,
  scriptName: 'adwPlanBuild.tsx',
  usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
  phases: [
    { name: 'install', execute: executeInstallPhase },
    { name: 'plan', execute: executePlanPhase },
    { name: 'build', execute: executeBuildPhase, onTokenLimit: buildPhaseOnTokenLimit },
    { name: 'test', execute: executeTestPhase },
    { name: 'pr', execute: executePRPhase },
  ],
  completionMetadata: (results) => {
    const test = results.get<TestPhaseResult>('test');
    return { unitTestsPassed: test?.unitTestsPassed ?? false, totalTestRetries: test?.totalRetries ?? 0 };
  },
}));
