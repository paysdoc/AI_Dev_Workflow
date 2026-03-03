import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../core/targetRepoRegistry', () => ({
  resolveTargetRepoCwd: vi.fn((cwd?: string) => cwd),
}));

import { execSync } from 'child_process';
import { log } from '../core/utils';
import { resolveTargetRepoCwd } from '../core/targetRepoRegistry';
import {
  getCurrentBranch,
  getDefaultBranch,
  checkoutDefaultBranch,
  deleteLocalBranch,
  deleteRemoteBranch,
} from '../github/gitOperations';

describe('getDefaultBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the default branch name from gh CLI', () => {
    vi.mocked(execSync).mockReturnValue('main\n');

    const result = getDefaultBranch();

    expect(result).toBe('main');
    expect(execSync).toHaveBeenCalledWith(
      "gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'",
      { encoding: 'utf-8' }
    );
  });

  it('trims whitespace from the branch name', () => {
    vi.mocked(execSync).mockReturnValue('  develop  \n');

    const result = getDefaultBranch();

    expect(result).toBe('develop');
  });

  it('throws error when gh command fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('gh: command not found');
    });

    expect(() => getDefaultBranch()).toThrow('Failed to get default branch');
  });

  it('throws error when gh returns empty string', () => {
    vi.mocked(execSync).mockReturnValue('');

    expect(() => getDefaultBranch()).toThrow('GitHub CLI returned empty default branch name');
  });

  it('throws error when gh returns only whitespace', () => {
    vi.mocked(execSync).mockReturnValue('   \n');

    expect(() => getDefaultBranch()).toThrow('GitHub CLI returned empty default branch name');
  });
});

describe('checkoutDefaultBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks out the default branch and pulls latest changes', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('main\n') // getDefaultBranch call
      .mockReturnValueOnce('') // git checkout
      .mockReturnValueOnce(''); // git pull

    const result = checkoutDefaultBranch();

    expect(result).toBe('main');
    expect(execSync).toHaveBeenCalledTimes(3);
    expect(execSync).toHaveBeenNthCalledWith(
      1,
      "gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'",
      { encoding: 'utf-8' }
    );
    expect(execSync).toHaveBeenNthCalledWith(
      2,
      'git checkout "main"',
      { stdio: 'pipe' }
    );
    expect(execSync).toHaveBeenNthCalledWith(
      3,
      'git pull origin "main"',
      { stdio: 'pipe' }
    );
  });

  it('works with different default branch names', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('develop\n') // getDefaultBranch call
      .mockReturnValueOnce('') // git checkout
      .mockReturnValueOnce(''); // git pull

    const result = checkoutDefaultBranch();

    expect(result).toBe('develop');
    expect(execSync).toHaveBeenNthCalledWith(
      2,
      'git checkout "develop"',
      { stdio: 'pipe' }
    );
    expect(execSync).toHaveBeenNthCalledWith(
      3,
      'git pull origin "develop"',
      { stdio: 'pipe' }
    );
  });

  it('throws error when checkout fails', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('main\n') // getDefaultBranch call
      .mockImplementationOnce(() => {
        throw new Error('error: Your local changes would be overwritten');
      });

    expect(() => checkoutDefaultBranch()).toThrow("Failed to checkout default branch 'main'");
  });

  it('throws error when pull fails', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('main\n') // getDefaultBranch call
      .mockReturnValueOnce('') // git checkout succeeds
      .mockImplementationOnce(() => {
        throw new Error('fatal: unable to access remote');
      });

    expect(() => checkoutDefaultBranch()).toThrow("Failed to pull latest changes for 'main'");
  });

  it('throws error when getting default branch fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('gh: not logged in');
    });

    expect(() => checkoutDefaultBranch()).toThrow('Failed to get default branch');
  });
});

describe('deleteLocalBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully deletes a local branch', () => {
    vi.mocked(execSync).mockReturnValue('');

    const result = deleteLocalBranch('feature/issue-42-add-login');

    expect(result).toBe(true);
    expect(execSync).toHaveBeenCalledWith(
      'git branch -D "feature/issue-42-add-login"',
      { stdio: 'pipe' }
    );
  });

  it('returns false when branch does not exist', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("error: branch 'nonexistent' not found.");
    });

    const result = deleteLocalBranch('nonexistent');

    expect(result).toBe(false);
  });

  it('returns false and warns for protected branch main', () => {
    const result = deleteLocalBranch('main');

    expect(result).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Refusing to delete protected branch'),
      'info'
    );
  });

  it('returns false and warns for protected branch master', () => {
    const result = deleteLocalBranch('master');

    expect(result).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('returns false and warns for protected branch develop', () => {
    const result = deleteLocalBranch('develop');

    expect(result).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('passes cwd to execSync when provided', () => {
    vi.mocked(execSync).mockReturnValue('');

    deleteLocalBranch('feature/issue-42-add-login', '/target/repo');

    expect(execSync).toHaveBeenCalledWith(
      'git branch -D "feature/issue-42-add-login"',
      { stdio: 'pipe', cwd: '/target/repo' }
    );
  });

  it('does not pass cwd when omitted', () => {
    vi.mocked(execSync).mockReturnValue('');

    deleteLocalBranch('feature/issue-42-add-login');

    expect(execSync).toHaveBeenCalledWith(
      'git branch -D "feature/issue-42-add-login"',
      { stdio: 'pipe', cwd: undefined }
    );
  });
});

describe('deleteRemoteBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully deletes a remote branch', () => {
    vi.mocked(execSync).mockReturnValue('');

    const result = deleteRemoteBranch('feature/issue-42-add-login');

    expect(result).toBe(true);
    expect(execSync).toHaveBeenCalledWith(
      'git push origin --delete "feature/issue-42-add-login"',
      { stdio: 'pipe' }
    );
  });

  it('returns false when remote branch does not exist', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('error: unable to delete: remote ref does not exist');
    });

    const result = deleteRemoteBranch('nonexistent');

    expect(result).toBe(false);
  });

  it('returns false and warns for protected branch main', () => {
    const result = deleteRemoteBranch('main');

    expect(result).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Refusing to delete protected remote branch'),
      'info'
    );
  });

  it('returns false and warns for protected branch master', () => {
    const result = deleteRemoteBranch('master');

    expect(result).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('returns false and warns for protected branch develop', () => {
    const result = deleteRemoteBranch('develop');

    expect(result).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('passes cwd to execSync when provided', () => {
    vi.mocked(execSync).mockReturnValue('');

    deleteRemoteBranch('feature/issue-42-add-login', '/target/repo');

    expect(execSync).toHaveBeenCalledWith(
      'git push origin --delete "feature/issue-42-add-login"',
      { stdio: 'pipe', cwd: '/target/repo' }
    );
  });

  it('does not pass cwd when omitted', () => {
    vi.mocked(execSync).mockReturnValue('');

    deleteRemoteBranch('feature/issue-42-add-login');

    expect(execSync).toHaveBeenCalledWith(
      'git push origin --delete "feature/issue-42-add-login"',
      { stdio: 'pipe', cwd: undefined }
    );
  });
});

describe('registry fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCurrentBranch uses resolved cwd from registry', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/target/repo');
    vi.mocked(execSync).mockReturnValue('feature/test\n');

    getCurrentBranch();

    expect(resolveTargetRepoCwd).toHaveBeenCalledWith(undefined);
    expect(execSync).toHaveBeenCalledWith(
      'git branch --show-current',
      { encoding: 'utf-8', cwd: '/target/repo' }
    );
  });

  it('getDefaultBranch uses resolved cwd from registry', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/target/repo');
    vi.mocked(execSync).mockReturnValue('main\n');

    getDefaultBranch();

    expect(resolveTargetRepoCwd).toHaveBeenCalledWith(undefined);
    expect(execSync).toHaveBeenCalledWith(
      "gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'",
      { encoding: 'utf-8', cwd: '/target/repo' }
    );
  });

  it('deleteLocalBranch uses resolved cwd from registry', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/target/repo');
    vi.mocked(execSync).mockReturnValue('');

    deleteLocalBranch('feature/issue-42-add-login');

    expect(resolveTargetRepoCwd).toHaveBeenCalledWith(undefined);
    expect(execSync).toHaveBeenCalledWith(
      'git branch -D "feature/issue-42-add-login"',
      { stdio: 'pipe', cwd: '/target/repo' }
    );
  });
});
