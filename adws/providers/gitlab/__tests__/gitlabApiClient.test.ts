import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'child_process';
import { GitLabApiClient } from '../gitlabApiClient';

function mockSpawnResult(stdout: string, status = 0): ReturnType<typeof spawnSync> {
  return {
    stdout,
    stderr: '',
    status,
    signal: null,
    pid: 1234,
    output: [null, stdout, ''],
    error: undefined,
  } as unknown as ReturnType<typeof spawnSync>;
}

function mockSpawnError(errorMessage: string): ReturnType<typeof spawnSync> {
  return {
    stdout: '',
    stderr: '',
    status: null,
    signal: null,
    pid: 0,
    output: [null, '', ''],
    error: new Error(errorMessage),
  } as unknown as ReturnType<typeof spawnSync>;
}

describe('GitLabApiClient', () => {
  let spawnSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    spawnSpy = vi.mocked(spawnSync);
  });

  describe('authentication', () => {
    it('uses PRIVATE-TOKEN header', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'glpat-abc123');
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify({ id: 1, default_branch: 'main', path_with_namespace: 'acme/widgets' })));

      client.getProject('acme/widgets');

      const args = spawnSpy.mock.calls[0][1] as string[];
      const tokenIndex = args.indexOf('PRIVATE-TOKEN: glpat-abc123');
      expect(tokenIndex).toBeGreaterThan(-1);
      expect(args[tokenIndex - 1]).toBe('-H');
    });
  });

  describe('URL construction', () => {
    it('builds correct URL with encoded project path', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify({ id: 1, default_branch: 'main', path_with_namespace: 'acme/widgets' })));

      client.getProject('acme/widgets');

      const args = spawnSpy.mock.calls[0][1] as string[];
      const url = args[args.length - 1];
      expect(url).toBe('https://gitlab.com/api/v4/projects/acme%2Fwidgets');
    });

    it('strips trailing slash from instance URL', () => {
      const client = new GitLabApiClient('https://gitlab.com/', 'tok');
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify({ id: 1, default_branch: 'main', path_with_namespace: 'acme/widgets' })));

      client.getProject('acme/widgets');

      const args = spawnSpy.mock.calls[0][1] as string[];
      const url = args[args.length - 1];
      expect(url).toBe('https://gitlab.com/api/v4/projects/acme%2Fwidgets');
    });

    it('works with self-hosted instance URL', () => {
      const client = new GitLabApiClient('https://gitlab.example.com', 'tok');
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify({ id: 1, default_branch: 'develop', path_with_namespace: 'team/project' })));

      client.getProject('team/project');

      const args = spawnSpy.mock.calls[0][1] as string[];
      const url = args[args.length - 1];
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/team%2Fproject');
    });
  });

  describe('getProject', () => {
    it('returns parsed project response', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      const projectData = { id: 42, default_branch: 'main', path_with_namespace: 'acme/widgets' };
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(projectData)));

      const result = client.getProject('acme/widgets');

      expect(result.id).toBe(42);
      expect(result.default_branch).toBe('main');
    });
  });

  describe('createMergeRequest', () => {
    it('sends POST with payload', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      const mrData = { iid: 1, title: 'feat: login', description: '', source_branch: 'feature', target_branch: 'main', web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/1', state: 'opened' };
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(mrData)));

      const result = client.createMergeRequest('acme/widgets', {
        source_branch: 'feature',
        target_branch: 'main',
        title: 'feat: login',
        description: 'Implements login',
      });

      const args = spawnSpy.mock.calls[0][1] as string[];
      expect(args).toContain('POST');
      const bodyIndex = args.indexOf('-d');
      expect(bodyIndex).toBeGreaterThan(-1);
      const bodyStr = args[bodyIndex + 1];
      const body = JSON.parse(bodyStr);
      expect(body.source_branch).toBe('feature');
      expect(body.title).toBe('feat: login');
      expect(result.iid).toBe(1);
    });
  });

  describe('getMergeRequest', () => {
    it('returns parsed MR response', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      const mrData = { iid: 5, title: 'Fix bug', description: 'Closes #10', source_branch: 'fix/bug', target_branch: 'main', web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/5', state: 'opened' };
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(mrData)));

      const result = client.getMergeRequest('acme/widgets', 5);

      expect(result.iid).toBe(5);
      expect(result.title).toBe('Fix bug');

      const args = spawnSpy.mock.calls[0][1] as string[];
      const url = args[args.length - 1];
      expect(url).toContain('/merge_requests/5');
    });
  });

  describe('createNote', () => {
    it('sends POST with body payload', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      const noteData = { id: 100, body: 'Great work!', author: { id: 1, username: 'bot', name: 'Bot' }, created_at: '2026-01-01T00:00:00Z', type: null };
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(noteData)));

      const result = client.createNote('acme/widgets', 5, 'Great work!');

      expect(result.id).toBe(100);
      const args = spawnSpy.mock.calls[0][1] as string[];
      const bodyIndex = args.indexOf('-d');
      const body = JSON.parse(args[bodyIndex + 1]);
      expect(body.body).toBe('Great work!');
    });
  });

  describe('listDiscussions', () => {
    it('returns parsed discussions array', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      const discussions = [
        { id: 'disc-1', notes: [{ id: 1, body: 'Note 1', author: { id: 1, username: 'alice', name: 'Alice' }, created_at: '2026-01-01T00:00:00Z', type: null }] },
      ];
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(discussions)));

      const result = client.listDiscussions('acme/widgets', 5);

      expect(result).toHaveLength(1);
      expect(result[0].notes[0].body).toBe('Note 1');
    });
  });

  describe('listMergeRequests', () => {
    it('appends state query parameter', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify([])));

      client.listMergeRequests('acme/widgets', 'opened');

      const args = spawnSpy.mock.calls[0][1] as string[];
      const url = args[args.length - 1];
      expect(url).toContain('?state=opened');
    });

    it('omits query parameter when state is not provided', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify([])));

      client.listMergeRequests('acme/widgets');

      const args = spawnSpy.mock.calls[0][1] as string[];
      const url = args[args.length - 1];
      expect(url).not.toContain('?state=');
    });
  });

  describe('error handling', () => {
    it('throws on spawn error', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      spawnSpy.mockReturnValue(mockSpawnError('curl not found'));

      expect(() => client.getProject('acme/widgets')).toThrow('curl not found');
    });

    it('throws on non-zero exit code', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      spawnSpy.mockReturnValue({
        ...mockSpawnResult('', 1),
        stderr: 'Connection refused',
        status: 1,
      });

      expect(() => client.getProject('acme/widgets')).toThrow('curl exited with code 1');
    });

    it('throws on 401 unauthorized response', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'bad-token');
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify({ error: '401 Unauthorized' })));

      expect(() => client.getProject('acme/widgets')).toThrow('failed with 401');
    });

    it('throws on 404 not found response', () => {
      const client = new GitLabApiClient('https://gitlab.com', 'tok');
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify({ message: '404 Not Found' })));

      expect(() => client.getProject('acme/widgets')).toThrow('failed with 404');
    });
  });
});
