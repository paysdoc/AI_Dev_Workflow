import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../utils', () => ({
  log: vi.fn(),
}));

vi.mock('../config', () => ({
  TARGET_REPOS_DIR: '/home/user/.adw/repos',
}));

import { execSync } from 'child_process';
import * as fs from 'fs';
import {
  getTargetRepoWorkspacePath,
  isRepoCloned,
  cloneTargetRepo,
  pullLatestDefaultBranch,
  ensureTargetRepoWorkspace,
} from '../targetRepoManager';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTargetRepoWorkspacePath', () => {
  it('returns correct path structure', () => {
    const result = getTargetRepoWorkspacePath('myorg', 'myrepo');
    expect(result).toBe('/home/user/.adw/repos/myorg/myrepo');
  });

  it('handles nested owner names', () => {
    const result = getTargetRepoWorkspacePath('owner', 'repo-name');
    expect(result).toBe('/home/user/.adw/repos/owner/repo-name');
  });
});

describe('isRepoCloned', () => {
  it('returns true when .git directory exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    expect(isRepoCloned('/some/path')).toBe(true);
    expect(fs.existsSync).toHaveBeenCalledWith('/some/path/.git');
  });

  it('returns false when .git directory does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(isRepoCloned('/some/path')).toBe(false);
  });
});

describe('cloneTargetRepo', () => {
  it('creates parent directory and clones repo', () => {
    cloneTargetRepo('https://github.com/owner/repo.git', '/home/user/.adw/repos/owner/repo');
    expect(fs.mkdirSync).toHaveBeenCalledWith('/home/user/.adw/repos/owner', { recursive: true });
    expect(execSync).toHaveBeenCalledWith(
      'git clone "https://github.com/owner/repo.git" "/home/user/.adw/repos/owner/repo"',
      expect.objectContaining({ stdio: 'pipe' }),
    );
  });
});

describe('pullLatestDefaultBranch', () => {
  it('fetches, checks out, and pulls the default branch', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce(undefined as any) // git fetch
      .mockReturnValueOnce('main\n') // gh repo view
      .mockReturnValueOnce(undefined as any) // git checkout
      .mockReturnValueOnce(undefined as any); // git pull

    const result = pullLatestDefaultBranch('/workspace/repo');

    expect(result).toBe('main');
    expect(execSync).toHaveBeenCalledWith('git fetch origin', expect.objectContaining({ cwd: '/workspace/repo' }));
    expect(execSync).toHaveBeenCalledWith(
      'gh repo view --json defaultBranchRef --jq .defaultBranchRef.name',
      expect.objectContaining({ cwd: '/workspace/repo' }),
    );
    expect(execSync).toHaveBeenCalledWith('git checkout "main"', expect.objectContaining({ cwd: '/workspace/repo' }));
    expect(execSync).toHaveBeenCalledWith('git pull origin "main"', expect.objectContaining({ cwd: '/workspace/repo' }));
  });
});

describe('ensureTargetRepoWorkspace', () => {
  it('clones repo when not present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockReturnValue(undefined as any);

    const result = ensureTargetRepoWorkspace({
      owner: 'owner',
      repo: 'repo',
      cloneUrl: 'https://github.com/owner/repo.git',
    });

    expect(result).toBe('/home/user/.adw/repos/owner/repo');
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('git clone'),
      expect.anything(),
    );
  });

  it('pulls latest when repo already cloned', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync)
      .mockReturnValueOnce(undefined as any) // git fetch
      .mockReturnValueOnce('main\n') // gh repo view
      .mockReturnValueOnce(undefined as any) // git checkout
      .mockReturnValueOnce(undefined as any); // git pull

    const result = ensureTargetRepoWorkspace({
      owner: 'owner',
      repo: 'repo',
      cloneUrl: 'https://github.com/owner/repo.git',
    });

    expect(result).toBe('/home/user/.adw/repos/owner/repo');
    expect(execSync).toHaveBeenCalledWith('git fetch origin', expect.anything());
  });

  it('uses provided workspacePath when set', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockReturnValue(undefined as any);

    const result = ensureTargetRepoWorkspace({
      owner: 'owner',
      repo: 'repo',
      cloneUrl: 'https://github.com/owner/repo.git',
      workspacePath: '/custom/path/repo',
    });

    expect(result).toBe('/custom/path/repo');
  });
});
