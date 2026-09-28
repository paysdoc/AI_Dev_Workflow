import { describe, it, expect } from 'vitest';
import { buildPausedWorkflowEntry, describeRateLimitPauseReason } from '../workflowCompletion';
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

describe('describeRateLimitPauseReason', () => {
  it('keeps today\'s text, byte-identical, when the facts carry neither a type nor a reset time', () => {
    expect(describeRateLimitPauseReason({})).toBe('Rate limit or API outage detected');
  });

  it('names the limit type when only the type is known', () => {
    expect(describeRateLimitPauseReason({ rateLimitType: 'seven_day' })).toBe(
      '`seven_day` rate limit detected (no reset time reported)',
    );
  });

  it('names the limit type and the reset time (UTC) when both are known', () => {
    expect(describeRateLimitPauseReason({ rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT })).toBe(
      '`five_hour` rate limit detected — resets at 2026-09-22T12:50:00.000Z (UTC)',
    );
  });

  it('names the reset time (UTC) alone when only the reset time is known', () => {
    expect(describeRateLimitPauseReason({ resetsAt: INCIDENT_RESETS_AT })).toBe(
      'Rate limit detected — resets at 2026-09-22T12:50:00.000Z (UTC)',
    );
  });
});
