import { describe, it, expect } from 'vitest';
import {
  extractLatestAdwId,
  getLastActivityFromState,
  isActiveStage,
  isRetriableStage,
  resolveIssueWorkflowStage,
} from '../cronStageResolver';
import type { AgentState } from '../../types/agentTypes';

// ── extractLatestAdwId ──────────────────────────────────────────────────────

describe('extractLatestAdwId', () => {
  it('returns adw-id from the latest comment with an ADW ID', () => {
    const comments = [
      { body: '**ADW ID:** `abc12345-slug-a`' },
      { body: '**ADW ID:** `def67890-slug-b`' },
    ];
    expect(extractLatestAdwId(comments)).toBe('def67890-slug-b');
  });

  it('returns null when no comments exist', () => {
    expect(extractLatestAdwId([])).toBeNull();
  });

  it('returns null when no comment contains an ADW ID', () => {
    const comments = [
      { body: 'This is a regular comment' },
      { body: 'Another comment without ADW ID' },
    ];
    expect(extractLatestAdwId(comments)).toBeNull();
  });

  it('returns the latest adw-id when comments are mixed ADW and non-ADW', () => {
    const comments = [
      { body: '**ADW ID:** `first-adw-id`' },
      { body: 'A regular comment in between' },
      { body: '**ADW ID:** `latest-adw-id`' },
      { body: 'Another regular comment after' },
    ];
    // Newest-to-oldest scan: last regular comment has no id, so it finds latest-adw-id
    expect(extractLatestAdwId(comments)).toBe('latest-adw-id');
  });

  it('returns the single adw-id from a single ADW comment', () => {
    const comments = [{ body: '**ADW ID:** `only-id-here`' }];
    expect(extractLatestAdwId(comments)).toBe('only-id-here');
  });
});

// ── getLastActivityFromState ────────────────────────────────────────────────

function makeState(phases: AgentState['phases']): AgentState {
  return {
    adwId: 'test',
    issueNumber: 1,
    agentName: 'orchestrator',
    execution: { status: 'running', startedAt: '2024-01-01T00:00:00Z' },
    phases,
  };
}

describe('getLastActivityFromState', () => {
  it('returns null when state has no phases', () => {
    expect(getLastActivityFromState(makeState(undefined))).toBeNull();
  });

  it('returns null when phases is an empty object', () => {
    expect(getLastActivityFromState(makeState({}))).toBeNull();
  });

  it('returns startedAt timestamp when only startedAt is set', () => {
    const startedAt = '2024-06-01T12:00:00Z';
    const state = makeState({ install: { status: 'running', startedAt } });
    expect(getLastActivityFromState(state)).toBe(Date.parse(startedAt));
  });

  it('returns completedAt when it is more recent than startedAt', () => {
    const startedAt = '2024-06-01T12:00:00Z';
    const completedAt = '2024-06-01T12:05:00Z';
    const state = makeState({ install: { status: 'completed', startedAt, completedAt } });
    expect(getLastActivityFromState(state)).toBe(Date.parse(completedAt));
  });

  it('returns the most recent timestamp across multiple phases', () => {
    const timestamps = {
      install: { startedAt: '2024-06-01T10:00:00Z', completedAt: '2024-06-01T10:05:00Z' },
      plan:    { startedAt: '2024-06-01T11:00:00Z', completedAt: '2024-06-01T11:30:00Z' },
      build:   { startedAt: '2024-06-01T12:00:00Z' },
    };
    const state = makeState({
      install: { status: 'completed', ...timestamps.install },
      plan:    { status: 'completed', ...timestamps.plan },
      build:   { status: 'running',  startedAt: timestamps.build.startedAt },
    });
    expect(getLastActivityFromState(state)).toBe(Date.parse(timestamps.build.startedAt));
  });
});

// ── isActiveStage ───────────────────────────────────────────────────────────

describe('isActiveStage', () => {
  it('recognises "starting" as active', () => {
    expect(isActiveStage('starting')).toBe(true);
  });

  it('recognises "*_running" stages as active', () => {
    expect(isActiveStage('build_running')).toBe(true);
    expect(isActiveStage('install_running')).toBe(true);
    expect(isActiveStage('review_running')).toBe(true);
    expect(isActiveStage('plan_running')).toBe(true);
  });

  it('recognises intermediate "*_completed" stages as active', () => {
    expect(isActiveStage('install_completed')).toBe(true);
    expect(isActiveStage('plan_completed')).toBe(true);
    expect(isActiveStage('build_completed')).toBe(true);
  });

  it('rejects the terminal "completed" stage', () => {
    expect(isActiveStage('completed')).toBe(false);
  });

  it('rejects "paused"', () => {
    expect(isActiveStage('paused')).toBe(false);
  });

  it('rejects "abandoned"', () => {
    expect(isActiveStage('abandoned')).toBe(false);
  });

  it('rejects "discarded"', () => {
    expect(isActiveStage('discarded')).toBe(false);
  });

  it('rejects unknown stages', () => {
    expect(isActiveStage('some_unknown_stage')).toBe(false);
  });
});

// ── awaiting_merge is NOT active or retriable ───────────────────────────────

describe('isActiveStage — awaiting_merge', () => {
  it('does NOT classify "awaiting_merge" as active', () => {
    expect(isActiveStage('awaiting_merge')).toBe(false);
  });
});

describe('isRetriableStage — awaiting_merge', () => {
  it('does NOT classify "awaiting_merge" as retriable', () => {
    expect(isRetriableStage('awaiting_merge')).toBe(false);
  });
});

// ── isRetriableStage ────────────────────────────────────────────────────────

describe('isRetriableStage', () => {
  it('recognises "abandoned" as retriable', () => {
    expect(isRetriableStage('abandoned')).toBe(true);
  });

  it('rejects active stages', () => {
    expect(isRetriableStage('build_running')).toBe(false);
    expect(isRetriableStage('starting')).toBe(false);
    expect(isRetriableStage('install_completed')).toBe(false);
  });

  it('rejects terminal "completed"', () => {
    expect(isRetriableStage('completed')).toBe(false);
  });

  it('rejects "paused"', () => {
    expect(isRetriableStage('paused')).toBe(false);
  });

  it('rejects "discarded" (terminal, non-retriable — parity with completed)', () => {
    expect(isRetriableStage('discarded')).toBe(false);
  });

  it('rejects unknown stages', () => {
    expect(isRetriableStage('error')).toBe(false);
    expect(isRetriableStage('unknown_stage')).toBe(false);
  });
});

// ── resolveIssueWorkflowStage ───────────────────────────────────────────────

describe('resolveIssueWorkflowStage', () => {
  it('returns null stage and null adwId when no comments exist', () => {
    const readState = (_adwId: string): AgentState | null => null;
    const result = resolveIssueWorkflowStage([], readState);
    expect(result).toEqual({ stage: null, adwId: null, lastActivityMs: null });
  });

  it('returns null stage and null adwId when no comment has an ADW ID', () => {
    const readState = (_adwId: string): AgentState | null => null;
    const result = resolveIssueWorkflowStage([{ body: 'regular comment' }], readState);
    expect(result).toEqual({ stage: null, adwId: null, lastActivityMs: null });
  });

  it('returns null stage (with adwId) when adw-id found but state file missing', () => {
    const readState = (_adwId: string): AgentState | null => null;
    const comments = [{ body: '**ADW ID:** `orphan-id-x`' }];
    const result = resolveIssueWorkflowStage(comments, readState);
    expect(result).toEqual({ stage: null, adwId: 'orphan-id-x', lastActivityMs: null });
  });

  it('returns correct stage from state file', () => {
    const completedAt = '2024-06-01T12:00:00Z';
    const stateWithStage: (adwId: string) => AgentState | null = (_adwId) => ({
      ...makeState({ build: { status: 'completed', startedAt: '2024-06-01T11:00:00Z', completedAt } }),
      workflowStage: 'build_completed',
    });
    const comments = [{ body: '**ADW ID:** `my-adw-id`' }];
    const result = resolveIssueWorkflowStage(comments, stateWithStage);
    expect(result.stage).toBe('build_completed');
    expect(result.adwId).toBe('my-adw-id');
    expect(result.lastActivityMs).toBe(Date.parse(completedAt));
  });

  it('returns null stage when state file exists but has no workflowStage field', () => {
    const stateWithoutStage: (adwId: string) => AgentState | null = (_adwId) => makeState({});
    const comments = [{ body: '**ADW ID:** `my-adw-id`' }];
    const result = resolveIssueWorkflowStage(comments, stateWithoutStage);
    expect(result.stage).toBeNull();
    expect(result.adwId).toBe('my-adw-id');
  });

  it('returns null lastActivityMs when state file has no phases', () => {
    const stateWithStage: (adwId: string) => AgentState | null = (_adwId) => ({
      ...makeState({}),
      workflowStage: 'build_running',
    });
    const comments = [{ body: '**ADW ID:** `my-adw-id`' }];
    const result = resolveIssueWorkflowStage(comments, stateWithStage);
    expect(result.lastActivityMs).toBeNull();
  });

  it('uses the newest comment when multiple comments have adw-ids', () => {
    const stateMap: Record<string, AgentState> = {
      'old-adw-id': { ...makeState({}), workflowStage: 'old_stage' },
      'new-adw-id': { ...makeState({}), workflowStage: 'build_running' },
    };
    const readState = (adwId: string): AgentState | null => stateMap[adwId] ?? null;
    const comments = [
      { body: '**ADW ID:** `old-adw-id`' },
      { body: '**ADW ID:** `new-adw-id`' },
    ];
    const result = resolveIssueWorkflowStage(comments, readState);
    expect(result.stage).toBe('build_running');
    expect(result.adwId).toBe('new-adw-id');
  });
});
