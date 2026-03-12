import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('../../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../../core/config', () => ({
  GITLAB_TOKEN: 'glpat-test-token',
  GITLAB_INSTANCE_URL: 'https://gitlab.com',
}));

import { spawnSync } from 'child_process';
import { GitLabCodeHost, createGitLabCodeHost } from '../gitlabCodeHost';
import { GitLabApiClient } from '../gitlabApiClient';
import { Platform, type RepoIdentifier } from '../../types';

const testRepoId: RepoIdentifier = {
  owner: 'acme',
  repo: 'widgets',
  platform: Platform.GitLab,
};

function mockSpawnResult(stdout: string): ReturnType<typeof spawnSync> {
  return {
    stdout,
    stderr: '',
    status: 0,
    signal: null,
    pid: 1234,
    output: [null, stdout, ''],
    error: undefined,
  } as unknown as ReturnType<typeof spawnSync>;
}

const mockProject = { id: 42, default_branch: 'main', path_with_namespace: 'acme/widgets' };

const mockMR = {
  iid: 10,
  title: 'feat: add login',
  description: 'Closes #42',
  source_branch: 'feature/login',
  target_branch: 'main',
  web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/10',
  state: 'opened',
};

const mockNote = {
  id: 100,
  body: 'Great work!',
  author: { id: 1, username: 'bot', name: 'Bot' },
  created_at: '2026-01-01T00:00:00Z',
  type: null,
};

const mockDiscussions = [
  {
    id: 'disc-1',
    notes: [{
      id: 200,
      body: 'Fix this',
      author: { id: 2, username: 'reviewer', name: 'Reviewer' },
      created_at: '2026-01-02T00:00:00Z',
      type: 'DiffNote',
      position: { new_path: 'src/app.ts', new_line: 5 },
    }],
  },
];

describe('createGitLabCodeHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a valid CodeHost instance', () => {
    const host = createGitLabCodeHost(testRepoId);

    expect(host).toBeDefined();
    expect(host.getRepoIdentifier()).toEqual(testRepoId);
  });

  it('throws on empty owner', () => {
    expect(() =>
      createGitLabCodeHost({ owner: '', repo: 'widgets', platform: Platform.GitLab }),
    ).toThrow('owner must not be empty');
  });

  it('throws on empty repo', () => {
    expect(() =>
      createGitLabCodeHost({ owner: 'acme', repo: '', platform: Platform.GitLab }),
    ).toThrow('repo must not be empty');
  });
});

describe('GitLabCodeHost', () => {
  let host: GitLabCodeHost;
  let spawnSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    spawnSpy = vi.mocked(spawnSync);
    const client = new GitLabApiClient('https://gitlab.com', 'glpat-test-token');
    host = new GitLabCodeHost(testRepoId, client);
  });

  describe('getRepoIdentifier', () => {
    it('returns the bound RepoIdentifier', () => {
      expect(host.getRepoIdentifier()).toEqual(testRepoId);
    });
  });

  describe('getDefaultBranch', () => {
    it('delegates to client and returns default_branch', () => {
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(mockProject)));

      const result = host.getDefaultBranch();

      expect(result).toBe('main');
    });
  });

  describe('fetchMergeRequest', () => {
    it('calls client with project path and maps result', () => {
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(mockMR)));

      const result = host.fetchMergeRequest(10);

      expect(result).toEqual({
        number: 10,
        title: 'feat: add login',
        body: 'Closes #42',
        sourceBranch: 'feature/login',
        targetBranch: 'main',
        url: 'https://gitlab.com/acme/widgets/-/merge_requests/10',
        linkedIssueNumber: 42,
      });
    });

    it('propagates errors from underlying client', () => {
      spawnSpy.mockReturnValue({
        stdout: '',
        stderr: 'Connection refused',
        status: 1,
        signal: null,
        pid: 0,
        output: [null, '', 'Connection refused'],
        error: undefined,
      } as unknown as ReturnType<typeof spawnSync>);

      expect(() => host.fetchMergeRequest(10)).toThrow();
    });
  });

  describe('commentOnMergeRequest', () => {
    it('calls client createNote', () => {
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(mockNote)));

      host.commentOnMergeRequest(10, 'Great work!');

      const args = spawnSpy.mock.calls[0][1] as string[];
      const url = args[args.length - 1];
      expect(url).toContain('/merge_requests/10/notes');
    });
  });

  describe('fetchReviewComments', () => {
    it('calls client listDiscussions and maps result', () => {
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(mockDiscussions)));

      const result = host.fetchReviewComments(10);

      expect(result).toEqual([{
        id: '200',
        body: 'Fix this',
        author: 'reviewer',
        createdAt: '2026-01-02T00:00:00Z',
        path: 'src/app.ts',
        line: 5,
      }]);
    });

    it('returns empty array when no discussions', () => {
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify([])));

      const result = host.fetchReviewComments(10);

      expect(result).toEqual([]);
    });
  });

  describe('listOpenMergeRequests', () => {
    it('calls client listMergeRequests and maps result', () => {
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify([mockMR])));

      const result = host.listOpenMergeRequests();

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(10);
      expect(result[0].sourceBranch).toBe('feature/login');
    });

    it('returns empty array when no open MRs', () => {
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify([])));

      const result = host.listOpenMergeRequests();

      expect(result).toEqual([]);
    });
  });

  describe('createMergeRequest', () => {
    it('calls client createMergeRequest with mapped payload and returns URL', () => {
      spawnSpy.mockReturnValue(mockSpawnResult(JSON.stringify(mockMR)));

      const result = host.createMergeRequest({
        title: 'feat: add login',
        body: 'Closes #42',
        sourceBranch: 'feature/login',
        targetBranch: 'main',
        linkedIssueNumber: 42,
      });

      expect(result).toBe('https://gitlab.com/acme/widgets/-/merge_requests/10');

      const args = spawnSpy.mock.calls[0][1] as string[];
      const bodyIndex = args.indexOf('-d');
      const body = JSON.parse(args[bodyIndex + 1]);
      expect(body.source_branch).toBe('feature/login');
      expect(body.target_branch).toBe('main');
      expect(body.title).toBe('feat: add login');
      expect(body.description).toBe('Closes #42');
    });
  });
});
