import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', () => ({
  AgentStateManager: { isAgentProcessRunning: vi.fn() },
}));

import { isAdwRunningForIssue } from '../workflowCommentsBase';
import { AgentStateManager } from '../../core';
import type { Issue, IssueComment, IssueTracker } from '../../providers/types';

const isAgentProcessRunning = vi.mocked(AgentStateManager.isAgentProcessRunning);

function comment(body: string, createdAt: string): IssueComment {
  return { id: '1', body, author: 'a', createdAt };
}

function makeTracker(comments: IssueComment[]): Pick<IssueTracker, 'fetchIssue'> {
  return {
    fetchIssue: async () => ({ id: '1', number: 1, title: '', body: '', state: 'open', author: '', labels: [], comments } as Issue),
  };
}

const RUNNING_HEADER = '## :hammer_and_wrench: Running Build';
const COMPLETED_HEADER = '## :tada: ADW Workflow Completed';
const ERROR_HEADER = '## :x: ADW Workflow Error';

describe('isAdwRunningForIssue', () => {
  beforeEach(() => {
    isAgentProcessRunning.mockReset();
  });

  it('returns false when there is no stage comment', async () => {
    const tracker = makeTracker([comment('just a note', '2026-01-01T00:00:00Z')]);
    expect(await isAdwRunningForIssue(1, tracker)).toBe(false);
  });

  it.each([
    ['completed', COMPLETED_HEADER],
    ['error', ERROR_HEADER],
  ])('returns false when the latest stage is terminal (%s)', async (_name, header) => {
    const tracker = makeTracker([comment(`${header}\n\nADW ID:\n\n**ADW ID:** \`abc123\``, '2026-01-01T00:00:00Z')]);
    expect(await isAdwRunningForIssue(1, tracker)).toBe(false);
  });

  it('returns the answer of AgentStateManager.isAgentProcessRunning when the latest non-terminal stage carries an ADW ID', async () => {
    const tracker = makeTracker([comment(`${RUNNING_HEADER}\n\nADW ID:\n\n**ADW ID:** \`abc123\``, '2026-01-01T00:00:00Z')]);
    isAgentProcessRunning.mockReturnValue(true);
    expect(await isAdwRunningForIssue(1, tracker)).toBe(true);
    expect(isAgentProcessRunning).toHaveBeenCalledWith('abc123');

    isAgentProcessRunning.mockReturnValue(false);
    expect(await isAdwRunningForIssue(1, tracker)).toBe(false);
  });

  it('returns true when the latest non-terminal stage carries no ADW ID (cannot verify)', async () => {
    const tracker = makeTracker([comment(`${RUNNING_HEADER}\n\nADW ID: unknown`, '2026-01-01T00:00:00Z')]);
    expect(await isAdwRunningForIssue(1, tracker)).toBe(true);
    expect(isAgentProcessRunning).not.toHaveBeenCalled();
  });

  it('orders comments by createdAt, not array order', async () => {
    const tracker = makeTracker([
      comment(`${COMPLETED_HEADER}\n\n**ADW ID:** \`old-id\``, '2026-01-01T00:00:00Z'),
      comment(`${RUNNING_HEADER}\n\nADW ID: unknown`, '2026-02-01T00:00:00Z'),
    ]);
    expect(await isAdwRunningForIssue(1, tracker)).toBe(true);
  });
});
