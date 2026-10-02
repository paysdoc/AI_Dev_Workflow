#!/usr/bin/env bunx tsx
/**
 * Runs `initializeWorkflow` for one orchestrator and stops there, as `adwPlan.tsx` starts and before
 * its first phase: the workspace, the issue fetch, the upgrade gate, the branch and worktree, the
 * repository identity cross-check, the `starting` state write and the workflow-started comment.
 *
 * Usage: bunx tsx workflowInitDriver.ts <orchestratorId> <issueNumber> <adw-id> --issue-type <type>
 *          --target-repo <owner/repo> --clone-url <url>
 *
 * It lives outside features/regression/support and features/regression/step_definitions, which
 * cucumber.js imports: a driver in either would run at import, inside the Cucumber process.
 */

import { OrchestratorId, buildRepoIdentifier, parseOrchestratorArguments, parseTargetRepoArgs, type OrchestratorIdType } from '../../../adws/core/index.ts';
import { initializeWorkflow } from '../../../adws/phases/workflowInit.ts';

const ORCHESTRATOR_IDS: readonly string[] = Object.values(OrchestratorId);

function isOrchestratorId(value: string | undefined): value is OrchestratorIdType {
  return value !== undefined && ORCHESTRATOR_IDS.includes(value);
}

async function main(): Promise<void> {
  const [orchestratorId, ...args] = process.argv.slice(2);
  if (!isOrchestratorId(orchestratorId)) {
    throw new Error(`Unknown orchestrator id "${orchestratorId}". Known ids: ${ORCHESTRATOR_IDS.join(', ')}`);
  }

  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'workflowInitDriver.ts',
    usagePattern: '<orchestratorId> <issueNumber> <adw-id> --issue-type <type> --target-repo <owner/repo> --clone-url <url>',
    supportsCwd: false,
  });

  await initializeWorkflow(issueNumber, adwId, orchestratorId, {
    issueType: providedIssueType ?? undefined,
    targetRepo: targetRepo ?? undefined,
    repoId: buildRepoIdentifier(targetRepo),
  });
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
