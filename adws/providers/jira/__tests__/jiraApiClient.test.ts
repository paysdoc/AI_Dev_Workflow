import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/utils', () => ({
  log: vi.fn(),
}));

import { JiraApiClient } from '../jiraApiClient';

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('JiraApiClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
  });

  describe('authentication', () => {
    it('uses Basic auth for Cloud credentials', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', {
        email: 'user@example.com',
        apiToken: 'token123',
      });
      fetchSpy.mockResolvedValue(mockFetchResponse({ id: '1', key: 'PROJ-1', fields: {} }));

      await client.getIssue('PROJ-1');

      const headers = fetchSpy.mock.calls[0][1].headers;
      const expected = btoa('user@example.com:token123');
      expect(headers['Authorization']).toBe(`Basic ${expected}`);
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('uses Bearer token for Data Center credentials', async () => {
      const client = new JiraApiClient('https://jira.company.com', {
        pat: 'my-pat-token',
      });
      fetchSpy.mockResolvedValue(mockFetchResponse({ id: '1', key: 'PROJ-1', fields: {} }));

      await client.getIssue('PROJ-1');

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer my-pat-token');
    });
  });

  describe('URL construction', () => {
    it('builds correct URL from instance URL and path', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      fetchSpy.mockResolvedValue(mockFetchResponse({ id: '1', key: 'PROJ-1', fields: {} }));

      await client.getIssue('PROJ-1');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://acme.atlassian.net/rest/api/3/issue/PROJ-1?expand=renderedFields',
        expect.any(Object),
      );
    });

    it('strips trailing slash from instance URL', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net/', { pat: 'tok' });
      fetchSpy.mockResolvedValue(mockFetchResponse({ id: '1', key: 'PROJ-1', fields: {} }));

      await client.getIssue('PROJ-1');

      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://acme.atlassian.net/rest/api/3/issue/PROJ-1?expand=renderedFields',
      );
    });
  });

  describe('getIssue', () => {
    it('returns parsed issue response', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      const issueData = { id: '10001', key: 'PROJ-42', fields: { summary: 'Test' } };
      fetchSpy.mockResolvedValue(mockFetchResponse(issueData));

      const result = await client.getIssue('PROJ-42');

      expect(result.key).toBe('PROJ-42');
      expect(result.fields.summary).toBe('Test');
    });
  });

  describe('addComment', () => {
    it('sends ADF body as comment', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      const adfBody = { version: 1, type: 'doc', content: [] };
      const commentResponse = { id: '100', author: { displayName: 'Bot' }, body: adfBody, created: '2026-01-01T00:00:00Z' };
      fetchSpy.mockResolvedValue(mockFetchResponse(commentResponse));

      const result = await client.addComment('PROJ-42', adfBody);

      expect(result.id).toBe('100');
      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(requestBody.body).toEqual(adfBody);
    });
  });

  describe('deleteComment', () => {
    it('sends DELETE request', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      fetchSpy.mockResolvedValue(mockFetchResponse(undefined, 204));

      await client.deleteComment('PROJ-42', '100');

      expect(fetchSpy.mock.calls[0][0]).toContain('issue/PROJ-42/comment/100');
      expect(fetchSpy.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  describe('getComments', () => {
    it('returns comments array from paginated response', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      const page = {
        comments: [
          { id: '1', author: { displayName: 'Alice' }, body: {}, created: '2026-01-01T00:00:00Z' },
          { id: '2', author: { displayName: 'Bob' }, body: {}, created: '2026-01-02T00:00:00Z' },
        ],
        startAt: 0,
        maxResults: 50,
        total: 2,
      };
      fetchSpy.mockResolvedValue(mockFetchResponse(page));

      const result = await client.getComments('PROJ-42');

      expect(result).toHaveLength(2);
      expect(result[0].author.displayName).toBe('Alice');
    });
  });

  describe('getTransitions', () => {
    it('returns transitions array', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      const data = {
        transitions: [
          { id: '11', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } } },
          { id: '21', name: 'Done', to: { name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } } },
        ],
      };
      fetchSpy.mockResolvedValue(mockFetchResponse(data));

      const result = await client.getTransitions('PROJ-42');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Start Progress');
    });
  });

  describe('doTransition', () => {
    it('sends transition request', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      fetchSpy.mockResolvedValue(mockFetchResponse(undefined, 204));

      await client.doTransition('PROJ-42', '21');

      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(requestBody.transition.id).toBe('21');
    });
  });

  describe('error handling', () => {
    it('throws on 401 unauthorized', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'bad' });
      fetchSpy.mockResolvedValue(mockFetchResponse({ message: 'Unauthorized' }, 401));

      await expect(client.getIssue('PROJ-1')).rejects.toThrow('failed with 401');
    });

    it('throws on 404 not found', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      fetchSpy.mockResolvedValue(mockFetchResponse({ errorMessages: ['Issue not found'] }, 404));

      await expect(client.getIssue('PROJ-999')).rejects.toThrow('failed with 404');
    });

    it('throws on 400 bad request', async () => {
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      fetchSpy.mockResolvedValue(mockFetchResponse({ errors: { body: 'invalid' } }, 400));

      await expect(client.addComment('PROJ-1', {})).rejects.toThrow('failed with 400');
    });

    it('logs rate limit warning on 429', async () => {
      const { log } = await import('../../../core/utils');
      const client = new JiraApiClient('https://acme.atlassian.net', { pat: 'tok' });
      const response = mockFetchResponse({}, 429);
      fetchSpy.mockResolvedValue(response);

      await expect(client.getIssue('PROJ-1')).rejects.toThrow('failed with 429');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('rate limited'), 'warn');
    });
  });
});
