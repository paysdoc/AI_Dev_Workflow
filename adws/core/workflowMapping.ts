/**
 * Workflow script mapping for ADW orchestrators.
 *
 * Determines which workflow script to spawn based on issue type,
 * using the centralized `issueTypeToOrchestratorMap`. Unmapped values
 * fall back to `adws/adwPlanBuildTest.tsx`.
 */

import type { IssueClassSlashCommand } from '../types/issueTypes';
import { issueTypeToOrchestratorMap } from '../types/issueRouting';
import { log } from './utils';

/**
 * Determines which workflow script to use based on issue type.
 *
 * @param issueType - The classified issue type
 * @returns The workflow script path to spawn
 */
export function getWorkflowScript(issueType: IssueClassSlashCommand): string {
  const script = issueTypeToOrchestratorMap[issueType] ?? 'adws/adwPlanBuildTest.tsx';
  log(`getWorkflowScript: routed via issueTypeToOrchestratorMap[${issueType}] -> ${script}`);
  return script;
}
