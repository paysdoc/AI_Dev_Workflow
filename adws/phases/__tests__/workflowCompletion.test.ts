import { describe, it, expect } from 'vitest';
import { buildPausedWorkflowEntry } from '../workflowCompletion';
import type { WorkflowConfig } from '../workflowInit';
import { INCIDENT_RESETS_AT, INCIDENT_RATE_LIMIT_TYPE } from '../../core/__tests__/fixtures/rateLimitIncident';

type EntryConfig = Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorName' | 'worktreePath' | 'branchName' | 'targetRepo'>;

function makeConfig(overrides: Partial<EntryConfig> = {}): EntryConfig {
  return {
    adwId: 'test-adw-910',
    issueNumber: 910,
    orchestratorName: 'orchestrator',
    worktreePath: '/tmp/fake-worktree',
    branchName: 'feature-issue-910',
    ...overrides,
  } as EntryConfig;
}

const NOW = new Date('2026-09-25T09:00:00Z');

describe('buildPausedWorkflowEntry', () => {
  it('writes resetsAt (as ISO) and rateLimitType when the facts carry both', () => {
    const entry = buildPausedWorkflowEntry(
      makeConfig(),
      'build',
      'rate_limited',
      { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT },
      NOW,
    );

    expect(entry.resetsAt).toBe('2026-09-22T12:50:00.000Z');
    expect(entry.rateLimitType).toBe('five_hour');
  });

  it('omits resetsAt and rateLimitType entirely when facts are empty, matching the pre-#910 shape', () => {
    const entry = buildPausedWorkflowEntry(makeConfig(), 'build', 'rate_limited', {}, NOW);

    expect(entry).not.toHaveProperty('resetsAt');
    expect(entry).not.toHaveProperty('rateLimitType');
    expect(Object.keys(JSON.parse(JSON.stringify(entry))).sort()).toEqual(
      ['adwId', 'branchName', 'issueNumber', 'orchestratorScript', 'pauseReason', 'pausedAt', 'pausedAtPhase', 'worktreePath'].sort(),
    );
  });

  it('writes rateLimitType alone when the facts carry a type but no reset time', () => {
    const entry = buildPausedWorkflowEntry(
      makeConfig(),
      'build',
      'rate_limited',
      { rateLimitType: 'seven_day' },
      NOW,
    );

    expect(entry.rateLimitType).toBe('seven_day');
    expect(entry).not.toHaveProperty('resetsAt');
  });

  it('keeps the untouched extraArgs behaviour: set when targetRepo is present, absent otherwise', () => {
    const withTarget = buildPausedWorkflowEntry(
      makeConfig({ targetRepo: { owner: 'acme', repo: 'widgets', cloneUrl: 'https://example.invalid/acme/widgets.git' } }),
      'build',
      'rate_limited',
      {},
      NOW,
    );
    expect(withTarget.extraArgs).toEqual(['--target-repo', 'acme/widgets']);

    const withoutTarget = buildPausedWorkflowEntry(makeConfig(), 'build', 'rate_limited', {}, NOW);
    expect(withoutTarget).not.toHaveProperty('extraArgs');
  });

  it('stamps pausedAt from the injected now', () => {
    const entry = buildPausedWorkflowEntry(makeConfig(), 'build', 'rate_limited', {}, NOW);
    expect(entry.pausedAt).toBe(NOW.toISOString());
  });
});
