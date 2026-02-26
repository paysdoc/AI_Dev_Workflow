import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
  slugify: (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50),
}));

import { commitAndPushCostFiles } from '../github/gitOperations';

const mockExecSync = vi.mocked(execSync);

describe('commitAndPushCostFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stages, commits, and pushes cost files when changes exist', () => {
    // git status --porcelain returns changes
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M projects/my-repo/42-add-login.csv\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    const result = commitAndPushCostFiles('my-repo', 42, 'Add login', '/work');

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

    const result = commitAndPushCostFiles('my-repo', 42, 'Add login');

    expect(result).toBe(false);

    // Should not have called git add or git commit
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

    const result = commitAndPushCostFiles('my-repo', 42, 'Add login');

    expect(result).toBe(false);
  });

  it('correctly constructs file paths from repoName, issueNumber, and issueTitle', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status --porcelain')) return ' M file\n';
      if (cmdStr.startsWith('git branch --show-current')) return 'main\n';
      return '';
    });

    commitAndPushCostFiles('AI_Dev_Workflow', 34, 'Trigger should commit and push');

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

    commitAndPushCostFiles('my-repo', 42, 'Add login', '/custom/path');

    for (const call of mockExecSync.mock.calls) {
      const opts = call[1] as { cwd?: string };
      expect(opts.cwd).toBe('/custom/path');
    }
  });
});
