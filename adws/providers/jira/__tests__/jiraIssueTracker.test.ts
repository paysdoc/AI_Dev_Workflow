import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../../core/config', () => ({
  JIRA_EMAIL: '',
  JIRA_API_TOKEN: '',
  JIRA_PAT: '',
}));

import { JiraIssueTracker } from '../jiraIssueTracker';
import type { JiraApiClient } from '../jiraApiClient';
import type { JiraIssueResponse, JiraTransition } from '../jiraTypes';
import { log } from '../../../core/utils';

function makeJiraIssue(overrides: Record<string, unknown> = {}): JiraIssueResponse {
  return {
    id: '10001',
    key: 'PROJ-42',
    fields: {
      summary: 'Test issue title',
      description: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Issue description' }] }],
      },
      status: {
        name: 'To Do',
        statusCategory: { id: 2, key: 'new', name: 'To Do' },
      },
      creator: { displayName: 'Alice' },
      labels: ['bug', 'priority'],
      comment: {
        comments: [
          {
            id: '200',
            author: { displayName: 'Bob' },
            body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A comment' }] }] },
            created: '2026-01-01T00:00:00Z',
          },
        ],
        startAt: 0,
        maxResults: 50,
        total: 1,
      },
    },
    ...overrides,
  } as JiraIssueResponse;
}

function makeTransitions(): readonly JiraTransition[] {
  return [
    { id: '11', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } } },
    { id: '21', name: 'In Review', to: { name: 'In Review', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } } },
    { id: '31', name: 'Done', to: { name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } } },
  ];
}

function makeMockClient(): JiraApiClient {
  return {
    getIssue: vi.fn(),
    addComment: vi.fn(),
    deleteComment: vi.fn(),
    getComments: vi.fn(),
    getTransitions: vi.fn(),
    doTransition: vi.fn(),
  } as unknown as JiraApiClient;
}

describe('JiraIssueTracker', () => {
  let client: ReturnType<typeof makeMockClient>;
  let tracker: JiraIssueTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    client = makeMockClient();
    tracker = new JiraIssueTracker(client, 'PROJ');
  });

  describe('fetchIssue', () => {
    it('maps issue number to Jira key', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());

      await tracker.fetchIssue(42);

      expect(client.getIssue).toHaveBeenCalledWith('PROJ-42');
    });

    it('transforms Jira issue to WorkItem', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());

      const result = await tracker.fetchIssue(42);

      expect(result.id).toBe('PROJ-42');
      expect(result.number).toBe(42);
      expect(result.title).toBe('Test issue title');
      expect(result.body).toBe('Issue description');
      expect(result.state).toBe('OPEN');
      expect(result.author).toBe('Alice');
      expect(result.labels).toEqual(['bug', 'priority']);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].body).toBe('A comment');
    });

    it('maps status category "new" to "OPEN"', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());
      const result = await tracker.fetchIssue(42);
      expect(result.state).toBe('OPEN');
    });

    it('maps status category "indeterminate" to "IN_PROGRESS"', async () => {
      const issue = makeJiraIssue({
        fields: {
          ...makeJiraIssue().fields,
          status: { name: 'In Progress', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
        },
      });
      vi.mocked(client.getIssue).mockResolvedValue(issue);
      const result = await tracker.fetchIssue(42);
      expect(result.state).toBe('IN_PROGRESS');
    });

    it('maps status category "done" to "CLOSED"', async () => {
      const issue = makeJiraIssue({
        fields: {
          ...makeJiraIssue().fields,
          status: { name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } },
        },
      });
      vi.mocked(client.getIssue).mockResolvedValue(issue);
      const result = await tracker.fetchIssue(42);
      expect(result.state).toBe('CLOSED');
    });

    it('handles null description', async () => {
      const issue = makeJiraIssue({
        fields: { ...makeJiraIssue().fields, description: null },
      });
      vi.mocked(client.getIssue).mockResolvedValue(issue);
      const result = await tracker.fetchIssue(42);
      expect(result.body).toBe('');
    });

    it('handles issue with no comments', async () => {
      const issue = makeJiraIssue({
        fields: { ...makeJiraIssue().fields, comment: undefined },
      });
      vi.mocked(client.getIssue).mockResolvedValue(issue);
      const result = await tracker.fetchIssue(42);
      expect(result.comments).toEqual([]);
    });

    it('handles issue number 0', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue({ key: 'PROJ-0' }));
      await tracker.fetchIssue(0);
      expect(client.getIssue).toHaveBeenCalledWith('PROJ-0');
    });
  });

  describe('commentOnIssue', () => {
    it('converts markdown to ADF and posts comment', async () => {
      vi.mocked(client.addComment).mockResolvedValue({
        id: '300', author: { displayName: 'Bot' }, body: {}, created: '2026-01-01T00:00:00Z',
      });

      tracker.commentOnIssue(42, '**bold** comment');

      // Wait for async operation
      await vi.waitFor(() => {
        expect(client.addComment).toHaveBeenCalledWith('PROJ-42', expect.objectContaining({ version: 1, type: 'doc' }));
      });
    });
  });

  describe('deleteComment', () => {
    it('deletes comment when issue key is in cache', async () => {
      // First fetch comments to populate the cache
      vi.mocked(client.getComments).mockResolvedValue([
        { id: '200', author: { displayName: 'Bob' }, body: {}, created: '2026-01-01T00:00:00Z' },
      ]);
      tracker.fetchComments(42);

      await vi.waitFor(() => {
        expect(client.getComments).toHaveBeenCalled();
      });

      vi.mocked(client.deleteComment).mockResolvedValue(undefined);
      tracker.deleteComment('200');

      await vi.waitFor(() => {
        expect(client.deleteComment).toHaveBeenCalledWith('PROJ-42', '200');
      });
    });

    it('logs warning when issue key is not in cache', () => {
      tracker.deleteComment('999');

      expect(log).toHaveBeenCalledWith(expect.stringContaining('issue key not found in cache'), 'warn');
      expect(client.deleteComment).not.toHaveBeenCalled();
    });
  });

  describe('closeIssue', () => {
    it('finds Done transition and executes it', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());
      vi.mocked(client.getTransitions).mockResolvedValue(makeTransitions());
      vi.mocked(client.doTransition).mockResolvedValue(undefined);

      const result = await tracker.closeIssue(42);

      expect(result).toBe(true);
      expect(client.doTransition).toHaveBeenCalledWith('PROJ-42', '31');
    });

    it('posts comment before closing when provided', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());
      vi.mocked(client.getTransitions).mockResolvedValue(makeTransitions());
      vi.mocked(client.addComment).mockResolvedValue({
        id: '300', author: { displayName: 'Bot' }, body: {}, created: '2026-01-01T00:00:00Z',
      });
      vi.mocked(client.doTransition).mockResolvedValue(undefined);

      await tracker.closeIssue(42, 'Closing this issue');

      expect(client.addComment).toHaveBeenCalled();
      expect(client.doTransition).toHaveBeenCalledWith('PROJ-42', '31');
    });

    it('returns false when issue is already done', async () => {
      const issue = makeJiraIssue({
        fields: {
          ...makeJiraIssue().fields,
          status: { name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } },
        },
      });
      vi.mocked(client.getIssue).mockResolvedValue(issue);

      const result = await tracker.closeIssue(42);

      expect(result).toBe(false);
      expect(client.doTransition).not.toHaveBeenCalled();
    });

    it('returns false when no Done transition exists', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());
      vi.mocked(client.getTransitions).mockResolvedValue([
        { id: '11', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } } },
      ]);

      const result = await tracker.closeIssue(42);

      expect(result).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('No "Done" transition'), 'warn');
    });

    it('returns false on API error', async () => {
      vi.mocked(client.getIssue).mockRejectedValue(new Error('Network error'));

      const result = await tracker.closeIssue(42);

      expect(result).toBe(false);
    });
  });

  describe('getIssueState', () => {
    it('returns UNKNOWN synchronously (async limitation)', () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());
      const result = tracker.getIssueState(42);
      expect(result).toBe('UNKNOWN');
    });
  });

  describe('fetchComments', () => {
    it('triggers async comment fetch', async () => {
      vi.mocked(client.getComments).mockResolvedValue([
        { id: '1', author: { displayName: 'Alice' }, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }, created: '2026-01-01T00:00:00Z' },
      ]);

      tracker.fetchComments(42);

      await vi.waitFor(() => {
        expect(client.getComments).toHaveBeenCalledWith('PROJ-42');
      });
    });
  });

  describe('moveToStatus', () => {
    it('finds matching transition via exact match and executes it', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());
      vi.mocked(client.getTransitions).mockResolvedValue(makeTransitions());
      vi.mocked(client.doTransition).mockResolvedValue(undefined);

      await tracker.moveToStatus(42, 'Done');

      expect(client.doTransition).toHaveBeenCalledWith('PROJ-42', '31');
    });

    it('finds matching transition via fuzzy match', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());
      vi.mocked(client.getTransitions).mockResolvedValue(makeTransitions());
      vi.mocked(client.doTransition).mockResolvedValue(undefined);

      await tracker.moveToStatus(42, 'Review');

      expect(client.doTransition).toHaveBeenCalledWith('PROJ-42', '21');
    });

    it('skips when issue is already in target status', async () => {
      const issue = makeJiraIssue({
        fields: {
          ...makeJiraIssue().fields,
          status: { name: 'In Review', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
        },
      });
      vi.mocked(client.getIssue).mockResolvedValue(issue);

      await tracker.moveToStatus(42, 'In Review');

      expect(client.doTransition).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('already in'), 'info');
    });

    it('logs warning when no matching transition found', async () => {
      vi.mocked(client.getIssue).mockResolvedValue(makeJiraIssue());
      vi.mocked(client.getTransitions).mockResolvedValue(makeTransitions());

      await tracker.moveToStatus(42, 'Nonexistent');

      expect(client.doTransition).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('not found in available transitions'), 'warn');
    });
  });
});

describe('createJiraIssueTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates tracker with Cloud auth when email + apiToken are set', async () => {
    const configModule = await import('../../../core/config');
    Object.defineProperty(configModule, 'JIRA_EMAIL', { value: 'user@example.com', writable: true });
    Object.defineProperty(configModule, 'JIRA_API_TOKEN', { value: 'token123', writable: true });
    Object.defineProperty(configModule, 'JIRA_PAT', { value: '', writable: true });

    // Re-import to pick up the mocked values
    const { createJiraIssueTracker: create } = await import('../jiraIssueTracker');
    const tracker = create('https://acme.atlassian.net', 'PROJ');
    expect(tracker).toBeDefined();
  });

  it('creates tracker with PAT when only PAT is set', async () => {
    const configModule = await import('../../../core/config');
    Object.defineProperty(configModule, 'JIRA_EMAIL', { value: '', writable: true });
    Object.defineProperty(configModule, 'JIRA_API_TOKEN', { value: '', writable: true });
    Object.defineProperty(configModule, 'JIRA_PAT', { value: 'my-pat', writable: true });

    const { createJiraIssueTracker: create } = await import('../jiraIssueTracker');
    const tracker = create('https://jira.company.com', 'DEV');
    expect(tracker).toBeDefined();
  });

  it('throws when no auth credentials are configured', async () => {
    const configModule = await import('../../../core/config');
    Object.defineProperty(configModule, 'JIRA_EMAIL', { value: '', writable: true });
    Object.defineProperty(configModule, 'JIRA_API_TOKEN', { value: '', writable: true });
    Object.defineProperty(configModule, 'JIRA_PAT', { value: '', writable: true });

    const { createJiraIssueTracker: create } = await import('../jiraIssueTracker');
    expect(() => create('https://acme.atlassian.net', 'PROJ')).toThrow('Jira authentication not configured');
  });
});
