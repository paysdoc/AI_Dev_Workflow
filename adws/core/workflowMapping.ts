/**
 * Workflow script mapping for ADW orchestrators.
 *
 * Determines which workflow script to spawn based on issue type
 * and optional ADW command, using the centralized mapping constants.
 */

import type { IssueClassSlashCommand, AdwSlashCommand } from '../types/dataTypes';
import { adwCommandToOrchestratorMap, issueTypeToOrchestratorMap } from '../types/dataTypes';
import { log } from './utils';

/**
 * Determines which workflow script to use based on issue type and optional ADW command.
 *
 * Routing priority:
 * 1. If `adwCommand` is provided and exists in `adwCommandToOrchestratorMap`, use the mapped orchestrator.
 * 2. Otherwise, fall back to `issueTypeToOrchestratorMap` for issue-type-based routing.
 *
 * @param issueType - The classified issue type
 * @param adwCommand - Optional ADW command for precise orchestrator routing
 * @returns The workflow script path to spawn
 */
export function getWorkflowScript(issueType: IssueClassSlashCommand, adwCommand?: AdwSlashCommand): string {
  // Route ADW commands to their dedicated orchestrators when mapped
  if (adwCommand) {
    const orchestrator = adwCommandToOrchestratorMap[adwCommand];
    if (orchestrator) {
      log(`getWorkflowScript: routed via adwCommandToOrchestratorMap[${adwCommand}] -> ${orchestrator}`);
      return orchestrator;
    }
  }

  const script = issueTypeToOrchestratorMap[issueType] ?? 'adws/adwPlanBuildTest.tsx';
  log(`getWorkflowScript: routed via issueTypeToOrchestratorMap[${issueType}] -> ${script}`);
  return script;
}
