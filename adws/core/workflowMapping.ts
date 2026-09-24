import type { IssueClassSlashCommand } from '../types/issueTypes';
import { issueTypeToOrchestratorMap } from '../types/issueRouting';
import { log } from './utils';

export function getWorkflowScript(issueType: IssueClassSlashCommand): string {
  const script = issueTypeToOrchestratorMap[issueType] ?? 'adws/adwPlanBuildTest.tsx';
  log(`getWorkflowScript: routed via issueTypeToOrchestratorMap[${issueType}] -> ${script}`);
  return script;
}
