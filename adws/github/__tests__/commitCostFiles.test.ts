import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
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

import { commitAndPushCostFiles } from '../gitOperations';
import { log } from '../../core/utils';

const mockExistsSync = vi.mocked(existsSync);

const mockExecSync = vi.mocked(execSync);

describe('commitAndPushCostFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('stages, commits, and pushes cost files when changes exist (single issue mode)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M projects/my-repo/42-add-login.csv\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo', issueNumber: 42, issueTitle: 'Add login', cwd: '/work' });

    expect(result).toBe(true);

    // Verify git add was called with correct paths
    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeDefined();
    expect(String(addCall![0])).toContain('projects/my-repo/42-add-login.csv');
    expect(String(addCall![0])).toContain('projects/my-repo/total-cost.csv');

    // Verify commit message
    const commitCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git commit'));
    expect(commitCall).toBeDefined();
    expect(String(commitCall![0])).toContain('cost: add cost data for issue #42');

    // Verify push
    const pushCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git push'));
    expect(pushCall).toBeDefined();
    expect(String(pushCall![0])).toContain('origin');
    expect(String(pushCall![0])).toContain('main');
  });

  it('returns false and skips commit when no cost file changes exist', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return '';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo', issueNumber: 42, issueTitle: 'Add login' });

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

    const result = commitAndPushCostFiles({ repoName: 'my-repo', issueNumber: 42, issueTitle: 'Add login' });

    expect(result).toBe(false);
  });

  it('correctly constructs file paths from repoName, issueNumber, and issueTitle', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    commitAndPushCostFiles({ repoName: 'AI_Dev_Workflow', issueNumber: 34, issueTitle: 'Trigger should commit and push' });

    const statusCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git status'));
    expect(String(statusCall![0])).toContain('projects/AI_Dev_Workflow/34-trigger-should-commit-and-push.csv');
    expect(String(statusCall![0])).toContain('projects/AI_Dev_Workflow/total-cost.csv');
  });

  it('passes cwd option through to execSync calls', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    commitAndPushCostFiles({ repoName: 'my-repo', issueNumber: 42, issueTitle: 'Add login', cwd: '/custom/path' });

    for (const call of mockExecSync.mock.calls) {
      const opts = call[1] as { cwd?: string };
      expect(opts.cwd).toBe('/custom/path');
    }
  });

  it('stages all CSVs in project directory when only repoName is provided (project mode)', () => {
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
    expect(String(addCall![0])).toContain('projects/my-repo/*.csv');

    const commitCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git commit'));
    expect(commitCall).toBeDefined();
    expect(String(commitCall![0])).toContain('cost: add cost data for my-repo');
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
    expect(String(commitCall![0])).toContain('cost: add cost data for all projects');
  });

  it('returns false and logs error when issueNumber is provided without repoName', () => {
    const result = commitAndPushCostFiles({ issueNumber: 42, issueTitle: 'Some title' });

    expect(result).toBe(false);
    expect(log).toHaveBeenCalledWith('Cannot commit issue cost files without a project name', 'error');

    // Should not have called any git commands
    expect(mockExecSync).not.toHaveBeenCalled();
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

  it('performs git pull --rebase --autostash before pushing', () => {
    const callOrder: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      if (cmdStr.startsWith('git add')) { callOrder.push('add'); return ''; }
      if (cmdStr.startsWith('git commit')) { callOrder.push('commit'); return ''; }
      if (cmdStr.startsWith('git pull --rebase --autostash')) { callOrder.push('pull-rebase'); return ''; }
      if (cmdStr.startsWith('git push')) { callOrder.push('push'); return ''; }
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo', issueNumber: 42, issueTitle: 'Add login' });

    expect(result).toBe(true);

    const pullRebaseCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git pull --rebase --autostash'));
    expect(pullRebaseCall).toBeDefined();
    expect(String(pullRebaseCall![0])).toContain('origin');
    expect(String(pullRebaseCall![0])).toContain('main');

    expect(callOrder).toEqual(['add', 'commit', 'pull-rebase', 'push']);
  });

  it('returns false when git pull --rebase --autostash fails', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      if (cmdStr.startsWith('git pull --rebase --autostash')) throw new Error('rebase conflict');
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo', issueNumber: 42, issueTitle: 'Add login' });

    expect(result).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to commit cost CSV files'), 'error');
  });

  it('filters out deleted untracked paths and commits remaining valid paths', () => {
    const deletedPath = 'projects/my-repo/97-refactor-the-code.csv';
    const validPath = 'projects/my-repo/total-cost.csv';

    mockExistsSync.mockImplementation((p: unknown) => String(p).includes('total-cost.csv'));

    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git ls-files') && cmdStr.includes(deletedPath)) return '';
      if (cmdStr.startsWith('git status --porcelain')) return ` M ${validPath}\n`;
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo', paths: [deletedPath, validPath] });

    expect(result).toBe(true);
    expect(log).toHaveBeenCalledWith(`Skipping untracked deleted path: ${deletedPath}`, 'info');

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeDefined();
    expect(String(addCall![0])).toContain(validPath);
    expect(String(addCall![0])).not.toContain(deletedPath);
  });

  it('stages deletion of tracked files passed via paths', () => {
    const deletedTrackedPath = 'projects/my-repo/97-refactor-the-code.csv';
    const validPath = 'projects/my-repo/total-cost.csv';

    mockExistsSync.mockImplementation((p: unknown) => {
      return String(p).includes('total-cost.csv');
    });

    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git ls-files') && cmdStr.includes(deletedTrackedPath)) return `${deletedTrackedPath}\n`;
      if (cmdStr.startsWith('git status --porcelain')) return ` D ${deletedTrackedPath}\n M ${validPath}\n`;
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo', paths: [deletedTrackedPath, validPath] });

    expect(result).toBe(true);

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeDefined();
    expect(String(addCall![0])).toContain(deletedTrackedPath);
    expect(String(addCall![0])).toContain(validPath);
  });

  it('returns false when all paths are deleted and untracked', () => {
    const deletedPath1 = 'projects/my-repo/97-refactor-the-code.csv';
    const deletedPath2 = 'projects/my-repo/98-another-issue.csv';

    mockExistsSync.mockReturnValue(false);

    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git ls-files')) return '';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo', paths: [deletedPath1, deletedPath2] });

    expect(result).toBe(false);
    expect(log).toHaveBeenCalledWith('No valid cost CSV paths to commit', 'info');

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeUndefined();
    const commitCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git commit'));
    expect(commitCall).toBeUndefined();
  });

  it('commits successfully with explicit paths when all paths are valid', () => {
    const path1 = 'projects/my-repo/42-add-login.csv';
    const path2 = 'projects/my-repo/total-cost.csv';

    mockExistsSync.mockReturnValue(true);

    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ` M ${path1}\n M ${path2}\n`;
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    const result = commitAndPushCostFiles({ repoName: 'my-repo', paths: [path1, path2] });

    expect(result).toBe(true);

    const addCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git add'));
    expect(addCall).toBeDefined();
    expect(String(addCall![0])).toContain(path1);
    expect(String(addCall![0])).toContain(path2);

    const commitCall = mockExecSync.mock.calls.find(c => String(c[0]).startsWith('git commit'));
    expect(commitCall).toBeDefined();
    expect(String(commitCall![0])).toContain('cost: update cost data for my-repo');
  });
});
