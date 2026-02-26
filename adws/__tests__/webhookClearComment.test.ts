import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

import { execSync } from 'child_process';
import { isClearComment } from '../github/workflowCommentsBase';
import { clearIssueComments } from '../adwClearComments';

/**
 * Tests for the webhook clear-comment handler logic.
 *
 * The webhook's issue_comment handler checks `isClearComment` before
 * `isActionableComment`. When a clear directive is detected, it calls
 * `clearIssueComments` and responds with `{ status: 'cleared' }`.
 *
 * These tests validate the integration between the detection function
 * and the clear action, replicating the webhook's branching logic.
 */

function mockRepoInfo(): void {
  vi.mocked(execSync).mockReturnValueOnce('https://github.com/test-owner/test-repo.git\n');
}

function makeRawComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    body: 'some comment',
    user: { login: 'testuser' },
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Replicates the webhook handler's clear-comment branch for testing. */
function handleIssueComment(commentBody: string, issueNumber: number): { status: string; issue?: number; deleted?: number } | null {
  if (isClearComment(commentBody)) {
    const result = clearIssueComments(issueNumber);
    return { status: 'cleared', issue: issueNumber, deleted: result.deleted };
  }
  return null;
}

describe('webhook clear-comment handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggers clearIssueComments for ## Clear comment', () => {
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([]));

    const result = handleIssueComment('## Clear', 42);

    expect(result).toEqual({ status: 'cleared', issue: 42, deleted: 0 });
  });

  it('triggers clearIssueComments for lowercase ## clear comment', () => {
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([]));

    const result = handleIssueComment('## clear', 42);

    expect(result).toEqual({ status: 'cleared', issue: 42, deleted: 0 });
  });

  it('returns deleted count from clearIssueComments', () => {
    // getRepoInfo for fetchIssueCommentsRest
    mockRepoInfo();
    // fetch comments
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([
      makeRawComment({ id: 1 }),
      makeRawComment({ id: 2 }),
      makeRawComment({ id: 3 }),
    ]));
    // getRepoInfo + delete for each comment
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce('');
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce('');
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce('');

    const result = handleIssueComment('## Clear', 10);

    expect(result).toEqual({ status: 'cleared', issue: 10, deleted: 3 });
  });

  it('does not trigger clear logic for ## Take action comment', () => {
    const result = handleIssueComment('## Take action\n\nPlease fix the bug', 42);

    expect(result).toBeNull();
  });

  it('does not trigger clear logic for plain text comment', () => {
    const result = handleIssueComment('Please clear the comments', 42);

    expect(result).toBeNull();
  });

  it('does not trigger clear logic for ADW system comment', () => {
    const result = handleIssueComment('## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`', 42);

    expect(result).toBeNull();
  });
});
