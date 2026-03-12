import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../github/issueApi', () => ({
  getIssueState: vi.fn(),
}));

import { getIssueState } from '../../github/issueApi';
import { parseDependencies, findOpenDependencies } from '../issueDependencies';

const testRepoInfo = { owner: 'test-owner', repo: 'test-repo' };

describe('parseDependencies', () => {
  it('extracts hash references from Dependencies section', () => {
    const body = '## Dependencies\n- #42\n- #10\n';
    expect(parseDependencies(body)).toEqual([42, 10]);
  });

  it('extracts full GitHub issue URLs', () => {
    const body = '## Dependencies\n- https://github.com/owner/repo/issues/42\n';
    expect(parseDependencies(body)).toEqual([42]);
  });

  it('extracts mixed formats', () => {
    const body = '## Dependencies\n- #42\n- https://github.com/owner/repo/issues/10\n';
    expect(parseDependencies(body)).toEqual([42, 10]);
  });

  it('returns empty array when no Dependencies section exists', () => {
    const body = '## Description\nSome description\n';
    expect(parseDependencies(body)).toEqual([]);
  });

  it('returns empty array when Dependencies section is empty', () => {
    const body = '## Dependencies\n\n## Other Section\n';
    expect(parseDependencies(body)).toEqual([]);
  });

  it('deduplicates when same issue referenced multiple times', () => {
    const body = '## Dependencies\n- #42\n- #42\n- https://github.com/owner/repo/issues/42\n';
    expect(parseDependencies(body)).toEqual([42]);
  });

  it('handles case-insensitive heading matching', () => {
    expect(parseDependencies('## dependencies\n- #5\n')).toEqual([5]);
    expect(parseDependencies('## DEPENDENCIES\n- #5\n')).toEqual([5]);
    expect(parseDependencies('## Dependencies\n- #5\n')).toEqual([5]);
  });

  it('stops extracting at next ## heading', () => {
    const body = '## Dependencies\n- #42\n## Other\n- #99\n';
    expect(parseDependencies(body)).toEqual([42]);
  });

  it('returns empty array for empty body', () => {
    expect(parseDependencies('')).toEqual([]);
  });

  it('ignores #0 and negative-like references', () => {
    const body = '## Dependencies\n- #0\n- #5\n';
    expect(parseDependencies(body)).toEqual([5]);
  });
});

describe('findOpenDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only open issues', async () => {
    vi.mocked(getIssueState).mockImplementation((num: number) => {
      if (num === 42) return 'OPEN';
      return 'CLOSED';
    });

    const body = '## Dependencies\n- #42\n- #10\n';
    const result = await findOpenDependencies(body, testRepoInfo);
    expect(result).toEqual([42]);
  });

  it('returns empty array when all dependencies are closed', async () => {
    vi.mocked(getIssueState).mockReturnValue('CLOSED');

    const body = '## Dependencies\n- #42\n- #10\n';
    const result = await findOpenDependencies(body, testRepoInfo);
    expect(result).toEqual([]);
  });

  it('returns empty array when no dependencies section exists', async () => {
    const result = await findOpenDependencies('## Description\nNo deps here', testRepoInfo);
    expect(result).toEqual([]);
    expect(getIssueState).not.toHaveBeenCalled();
  });

  it('skips dependencies that fail state check', async () => {
    vi.mocked(getIssueState).mockImplementation((num: number) => {
      if (num === 42) throw new Error('network error');
      return 'OPEN';
    });

    const body = '## Dependencies\n- #42\n- #10\n';
    const result = await findOpenDependencies(body, testRepoInfo);
    expect(result).toEqual([10]);
  });

  it('passes repoInfo to getIssueState', async () => {
    vi.mocked(getIssueState).mockReturnValue('CLOSED');

    const repoInfo = { owner: 'test', repo: 'repo' };
    await findOpenDependencies('## Dependencies\n- #5\n', repoInfo);

    expect(getIssueState).toHaveBeenCalledWith(5, repoInfo);
  });
});
