/**
 * Unit tests for issueDependencies — parseDependencies, extractDependencies, and findOpenDependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../agents/dependencyExtractionAgent', () => ({
  runDependencyExtractionAgent: vi.fn(),
}));

vi.mock('../core', () => ({
  log: vi.fn(),
}));

vi.mock('../github/issueApi', () => ({
  getIssueState: vi.fn(),
}));

import { parseDependencies, extractDependencies, findOpenDependencies } from '../triggers/issueDependencies';
import { runDependencyExtractionAgent } from '../agents/dependencyExtractionAgent';
import { getIssueState } from '../github/issueApi';
import type { RepoInfo } from '../github/githubApi';

const mockRunAgent = vi.mocked(runDependencyExtractionAgent);
const mockGetIssueState = vi.mocked(getIssueState);

const REPO_INFO: RepoInfo = { owner: 'test-owner', repo: 'test-repo' } as RepoInfo;

describe('parseDependencies', () => {
  it('extracts #N references from ## Dependencies heading', () => {
    const body = '## Dependencies\n- #42\n- #10\n';
    expect(parseDependencies(body)).toEqual(expect.arrayContaining([42, 10]));
  });

  it('extracts from ## Depends on heading (case-insensitive)', () => {
    const body = '## Depends on\n- #7\n';
    expect(parseDependencies(body)).toContain(7);
  });

  it('extracts full GitHub issue URLs', () => {
    const body = '## Dependencies\nhttps://github.com/owner/repo/issues/55\n';
    expect(parseDependencies(body)).toContain(55);
  });

  it('stops at the next ## heading', () => {
    const body = '## Dependencies\n- #1\n## Notes\n- #2\n';
    const result = parseDependencies(body);
    expect(result).toContain(1);
    expect(result).not.toContain(2);
  });

  it('returns [] when no ## Dependencies heading is found', () => {
    expect(parseDependencies('This issue has no dependencies section.')).toEqual([]);
  });

  it('returns [] for an empty string', () => {
    expect(parseDependencies('')).toEqual([]);
  });

  it('deduplicates repeated issue numbers', () => {
    const body = '## Dependencies\n- #5\n- #5\n';
    const result = parseDependencies(body);
    expect(result.filter(n => n === 5)).toHaveLength(1);
  });
});

describe('extractDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns LLM result when agent succeeds with non-empty array', async () => {
    mockRunAgent.mockResolvedValueOnce({ success: true, output: '[42, 10]', dependencies: [42, 10] });

    const result = await extractDependencies('issue body', 'logs');

    expect(result).toEqual([42, 10]);
  });

  it('falls back to regex when agent fails', async () => {
    mockRunAgent.mockResolvedValueOnce({ success: false, output: 'error', dependencies: [] });

    const body = '## Dependencies\n- #7\n';
    const result = await extractDependencies(body, 'logs');

    expect(result).toContain(7);
  });

  it('falls back to regex when agent returns empty array', async () => {
    mockRunAgent.mockResolvedValueOnce({ success: true, output: '[]', dependencies: [] });

    const body = '## Dependencies\n- #99\n';
    const result = await extractDependencies(body, 'logs');

    expect(result).toContain(99);
  });

  it('falls back to regex when agent throws', async () => {
    mockRunAgent.mockRejectedValueOnce(new Error('network error'));

    const body = '## Dependencies\n- #3\n';
    const result = await extractDependencies(body, 'logs');

    expect(result).toContain(3);
  });
});

describe('findOpenDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only open dependency numbers', async () => {
    mockRunAgent.mockResolvedValueOnce({ success: true, output: '[1, 2]', dependencies: [1, 2] });
    mockGetIssueState.mockImplementation((num: number) => num === 1 ? 'OPEN' : 'CLOSED');

    const result = await findOpenDependencies('body', REPO_INFO);

    expect(result).toEqual([1]);
  });

  it('returns [] when all dependencies are closed', async () => {
    mockRunAgent.mockResolvedValueOnce({ success: true, output: '[5, 6]', dependencies: [5, 6] });
    mockGetIssueState.mockReturnValue('CLOSED');

    const result = await findOpenDependencies('body', REPO_INFO);

    expect(result).toEqual([]);
  });

  it('returns [] when no dependencies are found', async () => {
    mockRunAgent.mockResolvedValueOnce({ success: true, output: '[]', dependencies: [] });
    // Also no regex deps in empty body
    const result = await findOpenDependencies('no deps here', REPO_INFO);

    expect(result).toEqual([]);
    expect(mockGetIssueState).not.toHaveBeenCalled();
  });

  it('accepts an optional logsDir without breaking callers that omit it', async () => {
    mockRunAgent.mockResolvedValueOnce({ success: true, output: '[]', dependencies: [] });

    // Called with only the two required parameters — should not throw
    await expect(findOpenDependencies('body', REPO_INFO)).resolves.toEqual([]);
  });

  it('skips a dependency and logs a warning when getIssueState throws', async () => {
    mockRunAgent.mockResolvedValueOnce({ success: true, output: '[10]', dependencies: [10] });
    mockGetIssueState.mockImplementation(() => { throw new Error('API error'); });

    const result = await findOpenDependencies('body', REPO_INFO);

    expect(result).toEqual([]);
  });

  it('passes logsDir, statePath, and cwd through to the agent', async () => {
    mockRunAgent.mockResolvedValueOnce({ success: true, output: '[]', dependencies: [] });

    await findOpenDependencies('body', REPO_INFO, 'custom/logs', '/state', '/cwd');

    expect(mockRunAgent).toHaveBeenCalledWith('body', 'custom/logs', '/state', '/cwd');
  });
});
