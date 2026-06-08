import { describe, it, expect } from 'vitest';
import { getWorkflowScript } from '../workflowMapping';
import { issueTypeToOrchestratorMap } from '../../types/issueRouting';
import type { IssueClassSlashCommand } from '../../types/issueTypes';

describe('getWorkflowScript', () => {
  const knownTypes: IssueClassSlashCommand[] = ['/bug', '/chore', '/feature', '/pr_review'];

  it.each(knownTypes)('maps %s to its orchestrator from issueTypeToOrchestratorMap', (issueType) => {
    expect(getWorkflowScript(issueType)).toBe(issueTypeToOrchestratorMap[issueType]);
  });

  it('falls back to adwPlanBuildTest.tsx for an unmapped value', () => {
    expect(getWorkflowScript('/unknown' as IssueClassSlashCommand)).toBe('adws/adwPlanBuildTest.tsx');
  });

  // /adw_init lost its dedicated orchestrator when adwInit.tsx was deleted (#547),
  // so it is no longer in issueTypeToOrchestratorMap and now falls back.
  it('falls back to adwPlanBuildTest.tsx for /adw_init (orchestrator removed in #547)', () => {
    expect(getWorkflowScript('/adw_init')).toBe('adws/adwPlanBuildTest.tsx');
  });
});
