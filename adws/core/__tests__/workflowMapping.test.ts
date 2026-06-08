import { describe, it, expect } from 'vitest';
import { getWorkflowScript } from '../workflowMapping';
import { issueTypeToOrchestratorMap } from '../../types/issueRouting';
import type { IssueClassSlashCommand } from '../../types/issueTypes';

describe('getWorkflowScript', () => {
  const knownTypes: IssueClassSlashCommand[] = ['/bug', '/chore', '/feature', '/pr_review', '/adw_init'];

  it.each(knownTypes)('maps %s to its orchestrator from issueTypeToOrchestratorMap', (issueType) => {
    expect(getWorkflowScript(issueType)).toBe(issueTypeToOrchestratorMap[issueType]);
  });

  it('falls back to adwPlanBuildTest.tsx for an unmapped value', () => {
    expect(getWorkflowScript('/unknown' as IssueClassSlashCommand)).toBe('adws/adwPlanBuildTest.tsx');
  });
});
