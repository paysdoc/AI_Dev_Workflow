import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
  slugify: (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50),
}));

import { commitAndPushCostFiles } from '../commitOperations';
import { log } from '../../core/utils';

const mockExecSync = vi.mocked(execSync);

describe('commitAndPushCostFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stages all changes in project directory when repoName is provided (project mode)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M projects/my-repo/total-cost.csv\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'feature/branch\n';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo' });

    expect(result).toBe(true);

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeDefined();
    expect(String(addCall![0])).toBe('git add "projects/my-repo/"');

    const commitCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git commit'));
    expect(commitCall).toBeDefined();
    expect(String(commitCall![0])).toContain('cost: update cost data for my-repo');
  });

  it('stages all CSVs under projects/ when no options are provided (all projects mode)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M projects/repo-a/total-cost.csv\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    const result = commitAndPushCostFiles({});

    expect(result).toBe(true);

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeDefined();
    expect(String(addCall![0])).toBe('git add projects/');

    const commitCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git commit'));
    expect(commitCall).toBeDefined();
    expect(String(commitCall![0])).toContain('cost: update cost data for all projects');
  });

  it('returns false and skips commit when no cost file changes exist', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return '';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo' });

    expect(result).toBe(false);

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeUndefined();
    const commitCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git commit'));
    expect(commitCall).toBeUndefined();
  });

  it('returns false on commit failure', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M some-file.csv\n';
      if (cmdStr.startsWith('git add')) return '';
      if (cmdStr.startsWith('git commit')) throw new Error('commit failed');
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo' });

    expect(result).toBe(false);
  });

  it('passes cwd option through to execSync calls', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    commitAndPushCostFiles({ repoName: 'my-repo', cwd: '/custom/path' });

    for (const call of mockExecSync.mock.calls) {
      const opts = call[1] as { cwd?: string };
      expect(opts.cwd).toBe('/custom/path');
    }
  });

  it('returns false when project mode has no changes', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return '';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo' });

    expect(result).toBe(false);

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeUndefined();
  });

  it('returns false when all projects mode has no changes', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return '';
      return '';
    });

    const result = commitAndPushCostFiles({});

    expect(result).toBe(false);

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeUndefined();
  });

  it('performs git fetch + git rebase --autostash before pushing', () => {
    const callOrder: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      if (cmdStr.startsWith('git add')) { callOrder.push('add'); return ''; }
      if (cmdStr.startsWith('git commit')) { callOrder.push('commit'); return ''; }
      if (cmdStr.startsWith('git fetch origin')) { callOrder.push('fetch'); return ''; }
      if (cmdStr.startsWith('git rebase --autostash')) { callOrder.push('rebase'); return ''; }
      if (cmdStr.startsWith('git push')) { callOrder.push('push'); return ''; }
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo' });

    expect(result).toBe(true);

    const fetchCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git fetch origin'));
    expect(fetchCall).toBeDefined();
    expect(String(fetchCall![0])).toContain('main');

    const rebaseCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git rebase --autostash'));
    expect(rebaseCall).toBeDefined();
    expect(String(rebaseCall![0])).toContain('origin/main');

    expect(callOrder).toEqual(['add', 'commit', 'fetch', 'rebase', 'push']);
  });

  it('returns false when git fetch fails', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      if (cmdStr.startsWith('git fetch origin')) throw new Error('fetch failed');
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo' });

    expect(result).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to commit cost CSV files'), 'error');
  });

  it('returns false when git rebase --autostash fails', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      if (cmdStr.startsWith('git rebase --autostash')) throw new Error('rebase conflict');
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo' });

    expect(result).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to commit cost CSV files'), 'error');
  });

  it('returns false when getCurrentBranch returns empty string (detached HEAD)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return '\n';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo' });

    expect(result).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to commit cost CSV files'), 'error');
  });

  it('stages deletions within the project directory using directory-based git add', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' D projects/my-repo/42-some-issue.csv\n M projects/my-repo/total-cost.csv\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo' });

    expect(result).toBe(true);

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeDefined();
    // Directory-based add stages both additions and deletions
    expect(String(addCall![0])).toBe('git add "projects/my-repo/"');
  });
});
