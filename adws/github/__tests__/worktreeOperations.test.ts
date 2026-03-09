import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../core/config', () => ({
  WORKTREES_DIR: '/mock/project/.worktrees',
}));

vi.mock('../gitOperations', () => ({
  getDefaultBranch: vi.fn(() => 'main'),
  deleteLocalBranch: vi.fn(() => true),
}));

vi.mock('../../core/targetRepoRegistry', () => ({
  hasTargetRepo: vi.fn(() => false),
  getTargetRepo: vi.fn(() => ({ owner: 'ext-owner', repo: 'ext-repo' })),
  resolveTargetRepoCwd: vi.fn((cwd?: string) => cwd),
}));

vi.mock('../../core/targetRepoManager', () => ({
  getTargetRepoWorkspacePath: vi.fn((owner: string, repo: string) => `/mock/repos/${owner}/${repo}`),
}));

import { execSync } from 'child_process';
import * as fs from 'fs';
import {
  getWorktreePath,
  worktreeExists,
  listWorktrees,
  createWorktree,
  createWorktreeForNewBranch,
  killProcessesInDirectory,
  removeWorktree,
  removeWorktreesForIssue,
  getWorktreeForBranch,
  ensureWorktree,
  getMainRepoPath,
  isBranchCheckedOutElsewhere,
  freeBranchFromMainRepo,
  getWorktreesDir,
  copyEnvToWorktree,
  findWorktreeForIssue,
} from '../worktreeOperations';
import { deleteLocalBranch, getDefaultBranch } from '../gitOperations';
import { resolveTargetRepoCwd } from '../../core/targetRepoRegistry';

describe('getWorktreePath', () => {
  const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct path for simple branch name', () => {
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    const result = getWorktreePath('main');
    expect(result).toBe(path.join('/mock/project/.worktrees', 'main'));
  });

  it('sanitizes branch name with slashes', () => {
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    const result = getWorktreePath('feature/issue-51-run-adw-workflow');
    expect(result).toBe(path.join('/mock/project/.worktrees', 'feature-issue-51-run-adw-workflow'));
  });

  it('sanitizes branch name with multiple special characters', () => {
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    const result = getWorktreePath('bugfix/fix:bug*test?name');
    expect(result).toBe(path.join('/mock/project/.worktrees', 'bugfix-fix-bug-test-name'));
  });
});

describe('worktreeExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when worktree exists', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-51
HEAD def456
branch refs/heads/feature/issue-51

`;
    // First call for getWorktreesDir -> getMainRepoPath, second call for git worktree list
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = worktreeExists('feature/issue-51');
    expect(result).toBe(true);
  });

  it('returns false when worktree does not exist', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = worktreeExists('feature/issue-51');
    expect(result).toBe(false);
  });

  it('returns false when git command fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git error');
    });

    const result = worktreeExists('feature/issue-51');
    expect(result).toBe(false);
  });

  it('passes explicit cwd to execSync when provided', () => {
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    worktreeExists('feature/issue-99', '/target/repo');

    expect(vi.mocked(resolveTargetRepoCwd)).toHaveBeenCalledWith('/target/repo');
    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: '/target/repo',
    });
  });

  it('uses TargetRepoRegistry to resolve cwd when no explicit cwd is provided', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/mock/repos/ext-owner/ext-repo');
    const worktreeListOutput = `worktree /mock/repos/ext-owner/ext-repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    worktreeExists('feature/issue-99');

    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: '/mock/repos/ext-owner/ext-repo',
    });
  });

  it('falls back to undefined cwd when registry is not set and no explicit cwd', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    worktreeExists('feature/issue-99');

    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: undefined,
    });
  });
});

describe('listWorktrees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns list of worktree paths', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-51
HEAD def456
branch refs/heads/feature/issue-51

worktree /mock/project/.worktrees/bugfix-issue-52
HEAD ghi789
branch refs/heads/bugfix/issue-52

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = listWorktrees();
    expect(result).toEqual([
      '/mock/project/.worktrees/feature-issue-51',
      '/mock/project/.worktrees/bugfix-issue-52',
    ]);
  });

  it('returns empty array when no worktrees exist', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = listWorktrees();
    expect(result).toEqual([]);
  });

  it('returns empty array when git command fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git error');
    });

    const result = listWorktrees();
    expect(result).toEqual([]);
  });

  it('passes cwd to execSync when provided', () => {
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/main

worktree /target/repo/.worktrees/feature-issue-10-fix
HEAD def456
branch refs/heads/feature/issue-10-fix

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = listWorktrees('/target/repo');

    expect(result).toEqual(['/target/repo/.worktrees/feature-issue-10-fix']);
    expect(execSync).toHaveBeenCalledWith(
      'git worktree list --porcelain',
      expect.objectContaining({ cwd: '/target/repo' })
    );
  });

  it('does not pass cwd to execSync when omitted', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    listWorktrees();

    expect(execSync).toHaveBeenCalledWith(
      'git worktree list --porcelain',
      expect.objectContaining({ cwd: undefined })
    );
  });
});

describe('createWorktree', () => {
  const mainRepoWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates worktree for existing branch', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git rev-parse')) {
        return ''; // branch exists
      }
      if (cmdStr.includes('git worktree add')) {
        return '';
      }
      return '';
    });

    const result = createWorktree('feature/issue-51');

    expect(result).toBe(path.join('/mock/project/.worktrees', 'feature-issue-51'));
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('git worktree add'),
      { stdio: 'pipe' }
    );
  });

  it('creates worktree with new branch from base branch', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git rev-parse')) {
        throw new Error('branch does not exist');
      }
      if (cmdStr.includes('git worktree add')) {
        return '';
      }
      return '';
    });

    const result = createWorktree('feature/issue-51', 'main');

    expect(result).toBe(path.join('/mock/project/.worktrees', 'feature-issue-51'));
    expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/project/.worktrees', { recursive: true });
  });

  it('throws error when branch does not exist and no base branch provided', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git rev-parse')) {
        throw new Error('branch does not exist');
      }
      return '';
    });

    expect(() => createWorktree('nonexistent-branch')).toThrow(
      "Branch 'nonexistent-branch' does not exist and no base branch was provided"
    );
  });

  it('throws error when branchName is empty string', () => {
    expect(() => createWorktree('')).toThrow('branchName must be a non-empty string');
  });

  it('throws error when branchName is whitespace-only', () => {
    expect(() => createWorktree('  ')).toThrow('branchName must be a non-empty string');
  });

  it('throws error when git worktree add fails', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git rev-parse')) {
        return ''; // branch exists
      }
      if (cmdStr.includes('git worktree add')) {
        throw new Error('worktree already exists');
      }
      return '';
    });

    expect(() => createWorktree('feature/issue-51')).toThrow(
      "Failed to create worktree for branch 'feature/issue-51'"
    );
  });

  it('passes explicit baseRepoPath through resolveTargetRepoCwd', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      if (cmdStr.includes('git rev-parse')) {
        return '';
      }
      if (cmdStr.includes('git worktree add')) {
        return '';
      }
      return '';
    });

    createWorktree('feature/issue-99', undefined, '/target/repo');

    expect(vi.mocked(resolveTargetRepoCwd)).toHaveBeenCalledWith('/target/repo');
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining('git rev-parse'),
      { stdio: 'pipe', cwd: '/target/repo' }
    );
  });

  it('uses TargetRepoRegistry to resolve cwd when no explicit baseRepoPath is provided', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/mock/repos/ext-owner/ext-repo');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const worktreeListOutput = `worktree /mock/repos/ext-owner/ext-repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      if (cmdStr.includes('git rev-parse')) {
        return '';
      }
      if (cmdStr.includes('git worktree add')) {
        return '';
      }
      return '';
    });

    createWorktree('feature/issue-99');

    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining('git rev-parse'),
      { stdio: 'pipe', cwd: '/mock/repos/ext-owner/ext-repo' }
    );
  });
});

describe('createWorktreeForNewBranch', () => {
  const mainRepoWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates worktree with new branch from HEAD', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      return '';
    });

    const result = createWorktreeForNewBranch('feature/issue-51');

    expect(result).toBe(path.join('/mock/project/.worktrees', 'feature-issue-51'));
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('-b "feature/issue-51"'),
      { stdio: 'pipe' }
    );
  });

  it('creates worktree with new branch from specified base', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      return '';
    });

    const result = createWorktreeForNewBranch('feature/issue-51', 'develop');

    expect(result).toBe(path.join('/mock/project/.worktrees', 'feature-issue-51'));
    const execCalls = vi.mocked(execSync).mock.calls;
    const worktreeAddCall = execCalls.find((call) =>
      String(call[0]).includes('git worktree add')
    );
    expect(worktreeAddCall).toBeDefined();
    expect(String(worktreeAddCall![0])).toContain('develop');
  });

  it('throws error when branchName is empty string', () => {
    expect(() => createWorktreeForNewBranch('')).toThrow('branchName must be a non-empty string');
  });

  it('throws error when branchName is whitespace-only', () => {
    expect(() => createWorktreeForNewBranch('  ')).toThrow('branchName must be a non-empty string');
  });

  it('creates worktrees directory if it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      return '';
    });

    createWorktreeForNewBranch('feature/issue-51');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/project/.worktrees', { recursive: true });
  });

  it('throws error when git command fails', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git worktree add')) {
        throw new Error('branch already exists');
      }
      return '';
    });

    expect(() => createWorktreeForNewBranch('feature/issue-51')).toThrow(
      "Failed to create worktree with new branch 'feature/issue-51'"
    );
  });

  it('passes explicit baseRepoPath through resolveTargetRepoCwd', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      return '';
    });

    createWorktreeForNewBranch('feature/issue-99', undefined, '/target/repo');

    expect(vi.mocked(resolveTargetRepoCwd)).toHaveBeenCalledWith('/target/repo');
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining('git worktree add'),
      { stdio: 'pipe', cwd: '/target/repo' }
    );
  });

  it('uses TargetRepoRegistry to resolve cwd when no explicit baseRepoPath is provided', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/mock/repos/ext-owner/ext-repo');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const worktreeListOutput = `worktree /mock/repos/ext-owner/ext-repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      return '';
    });

    createWorktreeForNewBranch('feature/issue-99');

    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining('git worktree add'),
      { stdio: 'pipe', cwd: '/mock/repos/ext-owner/ext-repo' }
    );
  });
});

describe('removeWorktree', () => {
  const mainRepoWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes worktree successfully', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce(mainRepoWorktreeList) // getWorktreesDir -> getMainRepoPath
      .mockReturnValueOnce(''); // git worktree remove

    const result = removeWorktree('feature/issue-51');

    expect(result).toBe(true);
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('git worktree remove'),
      { stdio: 'pipe' }
    );
  });

  it('returns false when worktree does not exist', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git worktree remove')) {
        throw new Error('not a valid worktree');
      }
      return '';
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = removeWorktree('nonexistent-branch');

    expect(result).toBe(false);
  });

  it('cleans up orphaned worktree directory', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git worktree remove')) {
        throw new Error('not a valid worktree');
      }
      if (cmdStr.includes('git worktree prune')) {
        return '';
      }
      return '';
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.rmSync).mockReturnValue(undefined);

    const result = removeWorktree('orphaned-branch');

    expect(result).toBe(true);
    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('orphaned-branch'),
      { recursive: true, force: true }
    );
  });
});

describe('getWorktreeForBranch', () => {
  const mainRepoWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns worktree path when it exists', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-51
HEAD def456
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = getWorktreeForBranch('feature/issue-51');
    expect(result).toBe(path.join('/mock/project/.worktrees', 'feature-issue-51'));
  });

  it('returns null when worktree does not exist', () => {
    vi.mocked(execSync).mockReturnValue(mainRepoWorktreeList);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = getWorktreeForBranch('feature/issue-51');
    expect(result).toBeNull();
  });

  it('returns path for orphaned worktree directory', () => {
    // getWorktreeForBranch calls execSync first for worktree list, then getWorktreePath -> getWorktreesDir -> getMainRepoPath
    vi.mocked(execSync).mockReturnValue(mainRepoWorktreeList);
    // fs.existsSync is called to check if the orphaned directory exists
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      // Return true for the orphaned worktree directory check
      if (String(p).includes('orphaned-branch')) {
        return true;
      }
      return false;
    });

    const result = getWorktreeForBranch('orphaned-branch');
    expect(result).toBe(path.join('/mock/project/.worktrees', 'orphaned-branch'));
  });

  it('returns null when git command fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git error');
    });

    const result = getWorktreeForBranch('feature/issue-51');
    expect(result).toBeNull();
  });

  it('passes explicit baseRepoPath through resolveTargetRepoCwd', () => {
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    getWorktreeForBranch('feature/issue-99', '/target/repo');

    expect(vi.mocked(resolveTargetRepoCwd)).toHaveBeenCalledWith('/target/repo');
    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: '/target/repo',
    });
  });

  it('uses TargetRepoRegistry to resolve cwd when no explicit baseRepoPath is provided', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/mock/repos/ext-owner/ext-repo');
    const worktreeListOutput = `worktree /mock/repos/ext-owner/ext-repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    getWorktreeForBranch('feature/issue-99');

    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: '/mock/repos/ext-owner/ext-repo',
    });
  });

  it('falls back to undefined cwd when registry is not set and no explicit baseRepoPath', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    getWorktreeForBranch('feature/issue-99');

    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: undefined,
    });
  });
});

describe('ensureWorktree', () => {
  const mainRepoWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing worktree path when it exists', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-51
HEAD def456
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      return '';
    });
    vi.mocked(fs.existsSync).mockReturnValue(false); // .env doesn't exist

    const result = ensureWorktree('feature/issue-51');
    expect(result).toBe(path.join('/mock/project/.worktrees', 'feature-issue-51'));
  });

  it('creates new worktree when it does not exist', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git rev-parse')) {
        return ''; // branch exists
      }
      if (cmdStr.includes('git worktree add')) {
        return '';
      }
      return '';
    });

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.includes('.env')) {
        return false; // .env doesn't exist
      }
      if (pathStr.includes('.worktrees')) {
        return true; // worktrees dir exists
      }
      return false;
    });

    const result = ensureWorktree('feature/issue-51');
    expect(result).toBe(path.join('/mock/project/.worktrees', 'feature-issue-51'));
  });

  it('passes explicit baseRepoPath through resolveTargetRepoCwd', () => {
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/main

worktree /target/repo/.worktrees/feature-issue-99
HEAD def456
branch refs/heads/feature/issue-99

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    ensureWorktree('feature/issue-99', undefined, '/target/repo');

    expect(vi.mocked(resolveTargetRepoCwd)).toHaveBeenCalledWith('/target/repo');
  });

  it('uses TargetRepoRegistry to resolve cwd when no explicit baseRepoPath is provided', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/mock/repos/ext-owner/ext-repo');
    const worktreeListOutput = `worktree /mock/repos/ext-owner/ext-repo
HEAD abc123
branch refs/heads/main

worktree /mock/repos/ext-owner/ext-repo/.worktrees/feature-issue-99
HEAD def456
branch refs/heads/feature/issue-99

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    ensureWorktree('feature/issue-99');

    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: '/mock/repos/ext-owner/ext-repo',
    });
  });
});

describe('Concurrent ADW Workflow Isolation', () => {
  const mainRepoWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates isolated worktrees for multiple concurrent workflows', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git rev-parse')) {
        return ''; // branch exists
      }
      return '';
    });

    const worktree1 = createWorktree('feature/issue-1');
    const worktree2 = createWorktree('feature/issue-2');

    expect(worktree1).toBe(path.join('/mock/project/.worktrees', 'feature-issue-1'));
    expect(worktree2).toBe(path.join('/mock/project/.worktrees', 'feature-issue-2'));
    expect(worktree1).not.toBe(worktree2);

    const execCalls = vi.mocked(execSync).mock.calls;
    const worktreeAddCalls = execCalls.filter((call) =>
      String(call[0]).includes('git worktree add')
    );
    expect(worktreeAddCalls).toHaveLength(2);
    expect(String(worktreeAddCalls[0][0])).toContain('feature-issue-1');
    expect(String(worktreeAddCalls[1][0])).toContain('feature-issue-2');
  });

  it('generates unique paths for different branch names', () => {
    vi.mocked(execSync).mockReturnValue(mainRepoWorktreeList);

    const path1 = getWorktreePath('feature/issue-1');
    const path2 = getWorktreePath('feature/issue-10');
    const path3 = getWorktreePath('feature/issue-100');
    const path4 = getWorktreePath('bugfix/issue-1');

    expect(path1).toBe(path.join('/mock/project/.worktrees', 'feature-issue-1'));
    expect(path2).toBe(path.join('/mock/project/.worktrees', 'feature-issue-10'));
    expect(path3).toBe(path.join('/mock/project/.worktrees', 'feature-issue-100'));
    expect(path4).toBe(path.join('/mock/project/.worktrees', 'bugfix-issue-1'));

    const allPaths = [path1, path2, path3, path4];
    const uniquePaths = new Set(allPaths);
    expect(uniquePaths.size).toBe(allPaths.length);
  });

  it('correctly identifies each worktree independently when multiple exist', () => {
    const multiWorktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-1
HEAD def456
branch refs/heads/feature/issue-1

worktree /mock/project/.worktrees/feature-issue-2
HEAD ghi789
branch refs/heads/feature/issue-2

worktree /mock/project/.worktrees/bugfix-issue-3
HEAD jkl012
branch refs/heads/bugfix/issue-3

`;
    vi.mocked(execSync).mockReturnValue(multiWorktreeListOutput);

    expect(worktreeExists('feature/issue-1')).toBe(true);
    expect(worktreeExists('feature/issue-2')).toBe(true);
    expect(worktreeExists('bugfix/issue-3')).toBe(true);
    expect(worktreeExists('feature/issue-10')).toBe(false);
    expect(worktreeExists('nonexistent-branch')).toBe(false);
  });

  it('removes one worktree without affecting others', () => {
    const initialWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-1
HEAD def456
branch refs/heads/feature/issue-1

worktree /mock/project/.worktrees/feature-issue-2
HEAD ghi789
branch refs/heads/feature/issue-2

`;
    const afterRemovalWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-2
HEAD ghi789
branch refs/heads/feature/issue-2

`;

    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return initialWorktreeList;
      }
      return '';
    });

    const removeResult = removeWorktree('feature/issue-1');
    expect(removeResult).toBe(true);

    const execCalls = vi.mocked(execSync).mock.calls;
    const removeCall = execCalls.find((call) =>
      String(call[0]).includes('git worktree remove')
    );
    expect(removeCall).toBeDefined();
    expect(String(removeCall![0])).toContain('feature-issue-1');
    expect(String(removeCall![0])).not.toContain('feature-issue-2');

    vi.mocked(execSync).mockReturnValue(afterRemovalWorktreeList);
    expect(worktreeExists('feature/issue-1')).toBe(false);
    expect(worktreeExists('feature/issue-2')).toBe(true);
  });

  it('main repository state is not affected by worktree operations', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-1
HEAD def456
branch refs/heads/feature/issue-1

worktree /mock/project/.worktrees/feature-issue-2
HEAD ghi789
branch refs/heads/feature/issue-2

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const worktrees = listWorktrees();

    expect(worktrees).not.toContain('/mock/project');
    expect(worktrees).toContain('/mock/project/.worktrees/feature-issue-1');
    expect(worktrees).toContain('/mock/project/.worktrees/feature-issue-2');

    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git rev-parse')) {
        return ''; // branch exists
      }
      return '';
    });

    createWorktree('feature/issue-3');

    const execCalls = vi.mocked(execSync).mock.calls;
    const worktreeAddCall = execCalls.find((call) =>
      String(call[0]).includes('git worktree add')
    );
    expect(worktreeAddCall).toBeDefined();
    expect(String(worktreeAddCall![0])).not.toContain('git checkout');
    expect(String(worktreeAddCall![0])).not.toContain('git switch');
  });
});

describe('getMainRepoPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the main repository path', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-51
HEAD def456
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = getMainRepoPath();
    expect(result).toBe('/mock/project');
  });

  it('throws error when git command fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git error');
    });

    expect(() => getMainRepoPath()).toThrow('Failed to get main repository path');
  });

  it('throws error when no main repo found', () => {
    const worktreeListOutput = `worktree /mock/project/.worktrees/feature-issue-51
HEAD def456
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    expect(() => getMainRepoPath()).toThrow('Failed to get main repository path');
  });
});

describe('isBranchCheckedOutElsewhere', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when branch is not checked out anywhere', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-51
HEAD def456
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = isBranchCheckedOutElsewhere('feature/issue-99');
    expect(result).toEqual({ checkedOut: false, path: null, isMainRepo: false });
  });

  it('returns true with isMainRepo when branch is checked out in main repo', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/feature/issue-51

worktree /mock/project/.worktrees/other-branch
HEAD def456
branch refs/heads/other-branch

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = isBranchCheckedOutElsewhere('feature/issue-51');
    expect(result).toEqual({
      checkedOut: true,
      path: '/mock/project',
      isMainRepo: true,
    });
  });

  it('returns true without isMainRepo when branch is checked out in another worktree', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-51
HEAD def456
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = isBranchCheckedOutElsewhere('feature/issue-51');
    expect(result).toEqual({
      checkedOut: true,
      path: '/mock/project/.worktrees/feature-issue-51',
      isMainRepo: false,
    });
  });

  it('returns false when git command fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git error');
    });

    const result = isBranchCheckedOutElsewhere('feature/issue-51');
    expect(result).toEqual({ checkedOut: false, path: null, isMainRepo: false });
  });

  it('passes explicit cwd to execSync when provided', () => {
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    isBranchCheckedOutElsewhere('feature/issue-99', '/target/repo');

    expect(vi.mocked(resolveTargetRepoCwd)).toHaveBeenCalledWith('/target/repo');
    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: '/target/repo',
    });
  });

  it('uses TargetRepoRegistry to resolve cwd when no explicit cwd is provided', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/mock/repos/ext-owner/ext-repo');
    const worktreeListOutput = `worktree /mock/repos/ext-owner/ext-repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    isBranchCheckedOutElsewhere('feature/issue-99');

    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: '/mock/repos/ext-owner/ext-repo',
    });
  });

  it('falls back to undefined cwd when registry is not set and no explicit cwd', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    isBranchCheckedOutElsewhere('feature/issue-99');

    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: undefined,
    });
  });
});

describe('freeBranchFromMainRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('commits and pushes changes when there are uncommitted changes', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync)
      .mockReturnValueOnce(worktreeListOutput) // getMainRepoPath
      .mockReturnValueOnce('M file.txt\n') // git status --porcelain
      .mockReturnValueOnce('') // git add -A
      .mockReturnValueOnce('') // git commit
      .mockReturnValueOnce('') // git push
      .mockReturnValueOnce(''); // git checkout main && git pull

    freeBranchFromMainRepo('feature/issue-51');

    const execCalls = vi.mocked(execSync).mock.calls;
    expect(execCalls).toHaveLength(6);
    expect(String(execCalls[2][0])).toBe('git add -A');
    expect(String(execCalls[3][0])).toContain('git commit');
    expect(String(execCalls[3][0])).toContain('WIP: auto-commit');
    expect(String(execCalls[4][0])).toContain('git push');
    expect(String(execCalls[5][0])).toBe('git checkout "main" && git pull');
  });

  it('skips commit when there are no uncommitted changes', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync)
      .mockReturnValueOnce(worktreeListOutput) // getMainRepoPath
      .mockReturnValueOnce('') // git status --porcelain (no changes)
      .mockReturnValueOnce(''); // git checkout main && git pull

    freeBranchFromMainRepo('feature/issue-51');

    const execCalls = vi.mocked(execSync).mock.calls;
    expect(execCalls).toHaveLength(3);
    expect(String(execCalls[2][0])).toBe('git checkout "main" && git pull');
  });

  it('continues even when push fails', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync)
      .mockReturnValueOnce(worktreeListOutput) // getMainRepoPath
      .mockReturnValueOnce('M file.txt\n') // git status --porcelain
      .mockReturnValueOnce('') // git add -A
      .mockReturnValueOnce('') // git commit
      .mockImplementationOnce(() => {
        throw new Error('push failed');
      }) // git push fails
      .mockReturnValueOnce(''); // git checkout main && git pull

    // Should not throw
    freeBranchFromMainRepo('feature/issue-51');

    const execCalls = vi.mocked(execSync).mock.calls;
    expect(execCalls).toHaveLength(6);
    expect(String(execCalls[5][0])).toBe('git checkout "main" && git pull');
  });

  it('throws error when checkout fails', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync)
      .mockReturnValueOnce(worktreeListOutput) // getMainRepoPath
      .mockReturnValueOnce('') // git status --porcelain
      .mockImplementationOnce(() => {
        throw new Error('checkout failed');
      }); // git checkout fails

    expect(() => freeBranchFromMainRepo('feature/issue-51')).toThrow(
      "Failed to free branch 'feature/issue-51' from main repository"
    );
  });

  it('passes explicit cwd to getMainRepoPath when provided', () => {
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync)
      .mockReturnValueOnce(worktreeListOutput) // getMainRepoPath
      .mockReturnValueOnce('') // git status --porcelain (no changes)
      .mockReturnValueOnce(''); // git checkout main && git pull

    freeBranchFromMainRepo('feature/issue-51', '/target/repo');

    expect(vi.mocked(resolveTargetRepoCwd)).toHaveBeenCalledWith('/target/repo');
    const execCalls = vi.mocked(execSync).mock.calls;
    expect(execCalls[0][1]).toEqual({ encoding: 'utf-8', cwd: '/target/repo' });
  });

  it('uses TargetRepoRegistry to resolve cwd when no explicit cwd is provided', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/mock/repos/ext-owner/ext-repo');
    const worktreeListOutput = `worktree /mock/repos/ext-owner/ext-repo
HEAD abc123
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync)
      .mockReturnValueOnce(worktreeListOutput) // getMainRepoPath
      .mockReturnValueOnce('') // git status --porcelain (no changes)
      .mockReturnValueOnce(''); // git checkout main && git pull

    freeBranchFromMainRepo('feature/issue-51');

    const execCalls = vi.mocked(execSync).mock.calls;
    expect(execCalls[0][1]).toEqual({ encoding: 'utf-8', cwd: '/mock/repos/ext-owner/ext-repo' });
  });

  it('passes mainRepoPath to getDefaultBranch', () => {
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync)
      .mockReturnValueOnce(worktreeListOutput) // getMainRepoPath
      .mockReturnValueOnce('') // git status --porcelain (no changes)
      .mockReturnValueOnce(''); // git checkout main && git pull

    freeBranchFromMainRepo('feature/issue-51', '/target/repo');

    expect(vi.mocked(getDefaultBranch)).toHaveBeenCalledWith('/target/repo');
  });
});

describe('createWorktree edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles branch already checked out in main repository', () => {
    const checkedOutInMainWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/feature/issue-51

`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return checkedOutInMainWorktreeList;
      }
      if (cmdStr.includes('git rev-parse')) {
        return ''; // branch exists
      }
      if (cmdStr.includes('git status')) {
        return ''; // no uncommitted changes
      }
      if (cmdStr.includes('git checkout')) {
        return '';
      }
      if (cmdStr.includes('git worktree add')) {
        return '';
      }
      return '';
    });

    const result = createWorktree('feature/issue-51');

    expect(result).toBe('/mock/project/.worktrees/feature-issue-51');
    const execCalls = vi.mocked(execSync).mock.calls;
    const checkoutCall = execCalls.find((call) =>
      String(call[0]).includes('git checkout "main"')
    );
    expect(checkoutCall).toBeDefined();
  });

  it('reuses worktree when branch is checked out in different worktree path', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/different-path
HEAD def456
branch refs/heads/feature/issue-51

`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      if (cmdStr.includes('git rev-parse')) {
        return ''; // branch exists
      }
      return '';
    });

    const result = createWorktree('feature/issue-51');

    expect(result).toBe('/mock/project/.worktrees/different-path');
    // Should not call git worktree add since we're reusing
    const execCalls = vi.mocked(execSync).mock.calls;
    const worktreeAddCall = execCalls.find((call) =>
      String(call[0]).includes('git worktree add')
    );
    expect(worktreeAddCall).toBeUndefined();
  });
});

describe('getWorktreeForBranch edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds worktree by branch name even at unexpected path', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/unexpected-path
HEAD def456
branch refs/heads/feature/issue-51

`;
    // getWorktreeForBranch calls getWorktreePath -> getWorktreesDir -> getMainRepoPath
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = getWorktreeForBranch('feature/issue-51');
    expect(result).toBe('/mock/project/.worktrees/unexpected-path');
  });

  it('returns expected path when worktree exists at expected location', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-51
HEAD def456
branch refs/heads/feature/issue-51

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = getWorktreeForBranch('feature/issue-51');
    expect(result).toBe('/mock/project/.worktrees/feature-issue-51');
  });
});

describe('getWorktreesDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns path based on main repo path', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = getWorktreesDir();
    expect(result).toBe('/mock/project/.worktrees');
  });

  it('uses getMainRepoPath to determine worktrees directory', () => {
    const worktreeListOutput = `worktree /different/path/repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = getWorktreesDir();
    expect(result).toBe('/different/path/repo/.worktrees');
  });
});

describe('copyEnvToWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies .env when it exists in main repo', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === '/mock/project/.env'
    );
    vi.mocked(fs.copyFileSync).mockReturnValue(undefined);

    copyEnvToWorktree('/mock/project/.worktrees/feature-branch');

    expect(fs.existsSync).toHaveBeenCalledWith('/mock/project/.env');
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/mock/project/.env',
      '/mock/project/.worktrees/feature-branch/.env'
    );
  });

  it('copies .env.local when it exists in main repo', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.copyFileSync).mockReturnValue(undefined);

    copyEnvToWorktree('/mock/project/.worktrees/feature-branch');

    expect(fs.existsSync).toHaveBeenCalledWith('/mock/project/.env.local');
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/mock/project/.env.local',
      '/mock/project/.worktrees/feature-branch/.env.local'
    );
  });

  it('copies .env but not .env.local when only .env exists', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === '/mock/project/.env'
    );
    vi.mocked(fs.copyFileSync).mockReturnValue(undefined);

    copyEnvToWorktree('/mock/project/.worktrees/feature-branch');

    expect(fs.copyFileSync).toHaveBeenCalledTimes(1);
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/mock/project/.env',
      '/mock/project/.worktrees/feature-branch/.env'
    );
  });

  it('copies .env.local but not .env when only .env.local exists', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === '/mock/project/.env.local'
    );
    vi.mocked(fs.copyFileSync).mockReturnValue(undefined);

    copyEnvToWorktree('/mock/project/.worktrees/feature-branch');

    expect(fs.copyFileSync).toHaveBeenCalledTimes(1);
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/mock/project/.env.local',
      '/mock/project/.worktrees/feature-branch/.env.local'
    );
  });

  it('copies neither when neither exists', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    copyEnvToWorktree('/mock/project/.worktrees/feature-branch');

    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it('does nothing when .env does not exist (no error)', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // Should not throw
    copyEnvToWorktree('/mock/project/.worktrees/feature-branch');

    expect(fs.existsSync).toHaveBeenCalledWith('/mock/project/.env');
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it('handles copy errors gracefully (logs warning, does not throw)', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.copyFileSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    // Should not throw
    copyEnvToWorktree('/mock/project/.worktrees/feature-branch');

    expect(fs.copyFileSync).toHaveBeenCalled();
  });
});

describe('removeWorktreesForIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes all worktrees matching the issue number', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-42-add-login
HEAD def456
branch refs/heads/feature/issue-42-add-login

worktree /mock/project/.worktrees/bugfix-issue-42-fix-bug
HEAD ghi789
branch refs/heads/bugfix/issue-42-fix-bug

worktree /mock/project/.worktrees/feature-issue-99-other
HEAD jkl012
branch refs/heads/feature/issue-99-other

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      return '';
    });

    const result = removeWorktreesForIssue(42);

    expect(result).toBe(2);
    const removeCalls = vi.mocked(execSync).mock.calls.filter((call) =>
      String(call[0]).includes('git worktree remove')
    );
    expect(removeCalls).toHaveLength(2);
    expect(String(removeCalls[0][0])).toContain('feature-issue-42-add-login');
    expect(String(removeCalls[1][0])).toContain('bugfix-issue-42-fix-bug');
  });

  it('returns 0 when no worktrees match', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-99-other
HEAD jkl012
branch refs/heads/feature/issue-99-other

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      return '';
    });

    const result = removeWorktreesForIssue(42);

    expect(result).toBe(0);
    const removeCalls = vi.mocked(execSync).mock.calls.filter((call) =>
      String(call[0]).includes('git worktree remove')
    );
    expect(removeCalls).toHaveLength(0);
  });

  it('returns 0 when no worktrees exist', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = removeWorktreesForIssue(42);

    expect(result).toBe(0);
  });

  it('handles removal failures gracefully with fs.rmSync fallback', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-42-add-login
HEAD def456
branch refs/heads/feature/issue-42-add-login

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      if (cmdStr.includes('git worktree remove')) {
        throw new Error('worktree remove failed');
      }
      return '';
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.rmSync).mockReturnValue(undefined);

    const result = removeWorktreesForIssue(42);

    expect(result).toBe(1);
    expect(fs.rmSync).toHaveBeenCalledWith(
      '/mock/project/.worktrees/feature-issue-42-add-login',
      { recursive: true, force: true }
    );
  });

  it('does not match partial issue numbers', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-1-small-fix
HEAD def456
branch refs/heads/feature/issue-1-small-fix

worktree /mock/project/.worktrees/feature-issue-10-medium-fix
HEAD ghi789
branch refs/heads/feature/issue-10-medium-fix

worktree /mock/project/.worktrees/feature-issue-100-large-fix
HEAD jkl012
branch refs/heads/feature/issue-100-large-fix

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      return '';
    });

    const result = removeWorktreesForIssue(1);

    expect(result).toBe(1);
    const removeCalls = vi.mocked(execSync).mock.calls.filter((call) =>
      String(call[0]).includes('git worktree remove')
    );
    expect(removeCalls).toHaveLength(1);
    expect(String(removeCalls[0][0])).toContain('feature-issue-1-small-fix');
  });
});

describe('findWorktreeForIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns worktree result when matching worktree exists', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-42-add-login
HEAD def456
branch refs/heads/feature/issue-42-add-login

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/feature', 42);

    expect(result).toEqual({
      worktreePath: '/mock/project/.worktrees/feature-issue-42-add-login',
      branchName: 'feature/issue-42-add-login',
    });
  });

  it('returns null when no matching worktree exists', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/feature', 42);

    expect(result).toBeNull();
  });

  it('matches correct prefix for bug issues', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/bugfix-issue-42-fix-bug
HEAD def456
branch refs/heads/bugfix/issue-42-fix-bug

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/bug', 42);

    expect(result).toEqual({
      worktreePath: '/mock/project/.worktrees/bugfix-issue-42-fix-bug',
      branchName: 'bugfix/issue-42-fix-bug',
    });
  });

  it('matches correct prefix for chore issues', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/chore-issue-42-update-readme
HEAD def456
branch refs/heads/chore/issue-42-update-readme

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/chore', 42);

    expect(result).toEqual({
      worktreePath: '/mock/project/.worktrees/chore-issue-42-update-readme',
      branchName: 'chore/issue-42-update-readme',
    });
  });

  it('does not match different issue type prefix', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/bugfix-issue-42-fix-bug
HEAD def456
branch refs/heads/bugfix/issue-42-fix-bug

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/feature', 42);

    expect(result).toBeNull();
  });

  it('does not match different issue number', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-42-add-login
HEAD def456
branch refs/heads/feature/issue-42-add-login

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/feature', 99);

    expect(result).toBeNull();
  });

  it('does not match partial issue numbers', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-10-medium-fix
HEAD def456
branch refs/heads/feature/issue-10-medium-fix

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/feature', 1);

    expect(result).toBeNull();
  });

  it('ignores the main worktree', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/feature/issue-42-add-login

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/feature', 42);

    expect(result).toBeNull();
  });

  it('returns null when git command fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git error');
    });

    const result = findWorktreeForIssue('/feature', 42);

    expect(result).toBeNull();
  });

  it('returns the first match when multiple worktrees exist for the same issue', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-42-add-login
HEAD def456
branch refs/heads/feature/issue-42-add-login

worktree /mock/project/.worktrees/feature-issue-42-add-login-v2
HEAD ghi789
branch refs/heads/feature/issue-42-add-login-v2

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/feature', 42);

    expect(result).toEqual({
      worktreePath: '/mock/project/.worktrees/feature-issue-42-add-login',
      branchName: 'feature/issue-42-add-login',
    });
  });

  it('matches worktree with alias prefix for bug issues (bug- instead of bugfix-)', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/bug-issue-42-fix-something
HEAD def456
branch refs/heads/bug-issue-42-fix-something

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/bug', 42);

    expect(result).toEqual({
      worktreePath: '/mock/project/.worktrees/bug-issue-42-fix-something',
      branchName: 'bug-issue-42-fix-something',
    });
  });

  it('matches worktree with alias prefix for feature issues (feat- instead of feature-)', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feat-issue-42-add-login
HEAD def456
branch refs/heads/feat-issue-42-add-login

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/feature', 42);

    expect(result).toEqual({
      worktreePath: '/mock/project/.worktrees/feat-issue-42-add-login',
      branchName: 'feat-issue-42-add-login',
    });
  });

  it('prefers canonical prefix over alias when both exist', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/bugfix-issue-42-fix-something
HEAD def456
branch refs/heads/bugfix/issue-42-fix-something

worktree /mock/project/.worktrees/bug-issue-42-fix-something
HEAD ghi789
branch refs/heads/bug-issue-42-fix-something

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    const result = findWorktreeForIssue('/bug', 42);

    expect(result).toEqual({
      worktreePath: '/mock/project/.worktrees/bugfix-issue-42-fix-something',
      branchName: 'bugfix/issue-42-fix-something',
    });
  });

  it('passes explicit cwd to execSync when provided', () => {
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/main

worktree /target/repo/.worktrees/feature-issue-42-add-login
HEAD def456
branch refs/heads/feature/issue-42-add-login

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    findWorktreeForIssue('/feature', 42, '/target/repo');

    expect(vi.mocked(resolveTargetRepoCwd)).toHaveBeenCalledWith('/target/repo');
    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: '/target/repo',
    });
  });

  it('uses TargetRepoRegistry to resolve cwd when no explicit cwd is provided', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/mock/repos/ext-owner/ext-repo');
    const worktreeListOutput = `worktree /mock/repos/ext-owner/ext-repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    findWorktreeForIssue('/feature', 42);

    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: '/mock/repos/ext-owner/ext-repo',
    });
  });

  it('falls back to undefined cwd when registry is not set and no explicit cwd', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    findWorktreeForIssue('/feature', 42);

    expect(vi.mocked(execSync)).toHaveBeenCalledWith('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: undefined,
    });
  });
});

describe('killProcessesInDirectory', () => {
  const originalKill = process.kill;

  beforeEach(() => {
    vi.clearAllMocks();
    process.kill = vi.fn() as typeof process.kill;
  });

  afterEach(() => {
    process.kill = originalKill;
  });

  it('handles no running processes (lsof returns empty)', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('lsof')) {
        return '\n';
      }
      return '';
    });

    killProcessesInDirectory('/mock/worktree');

    expect(process.kill).not.toHaveBeenCalled();
  });

  it('successfully kills processes found by lsof', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('lsof')) {
        return '12345\n67890\n';
      }
      return '';
    });
    // After SIGTERM, processes exit (kill with 0 throws)
    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      if (signal === 0) {
        throw new Error('ESRCH');
      }
      return true;
    });

    killProcessesInDirectory('/mock/worktree');

    expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(process.kill).toHaveBeenCalledWith(67890, 'SIGTERM');
  });

  it('sends SIGKILL to processes that survive SIGTERM', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('lsof')) {
        return '12345\n';
      }
      return '';
    });
    // Process survives SIGTERM (kill with 0 succeeds = still alive)
    vi.mocked(process.kill).mockImplementation(() => true);

    killProcessesInDirectory('/mock/worktree');

    expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(process.kill).toHaveBeenCalledWith(12345, 0);
    expect(process.kill).toHaveBeenCalledWith(12345, 'SIGKILL');
  });

  it('handles lsof command not being available', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('lsof: command not found');
    });

    // Should not throw
    killProcessesInDirectory('/mock/worktree');

    expect(process.kill).not.toHaveBeenCalled();
  });

  it('handles processes that have already exited during SIGTERM', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('lsof')) {
        return '12345\n';
      }
      return '';
    });
    // SIGTERM throws (process already gone), kill(0) also throws
    vi.mocked(process.kill).mockImplementation(() => {
      throw new Error('ESRCH');
    });

    // Should not throw
    killProcessesInDirectory('/mock/worktree');
  });

  it('filters out current process PID', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('lsof')) {
        return `${process.pid}\n12345\n`;
      }
      return '';
    });
    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      if (signal === 0) {
        throw new Error('ESRCH');
      }
      return true;
    });

    killProcessesInDirectory('/mock/worktree');

    // Should NOT have killed the current process
    expect(process.kill).not.toHaveBeenCalledWith(process.pid, 'SIGTERM');
    // Should have killed the other process
    expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
  });
});

describe('removeWorktree with process killing and branch deletion', () => {
  const mainRepoWorktreeList = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls deleteLocalBranch after successful removal', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('lsof')) {
        throw new Error('no processes');
      }
      return '';
    });

    const result = removeWorktree('feature/issue-51');

    expect(result).toBe(true);
    expect(deleteLocalBranch).toHaveBeenCalledWith('feature/issue-51', undefined);
  });

  it('calls deleteLocalBranch after fallback fs.rmSync removal', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('git worktree remove')) {
        throw new Error('failed');
      }
      if (cmdStr.includes('lsof')) {
        throw new Error('no processes');
      }
      return '';
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.rmSync).mockReturnValue(undefined);

    const result = removeWorktree('orphaned-branch');

    expect(result).toBe(true);
    expect(deleteLocalBranch).toHaveBeenCalledWith('orphaned-branch', undefined);
  });

  it('passes cwd to all internal git commands when provided', () => {
    const targetRepoWorktreeList = `worktree /target/repo
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return targetRepoWorktreeList;
      }
      if (cmdStr.includes('lsof')) {
        throw new Error('no processes');
      }
      return '';
    });

    const result = removeWorktree('feature/issue-51', '/target/repo');

    expect(result).toBe(true);

    const removeCalls = vi.mocked(execSync).mock.calls.filter((call) =>
      String(call[0]).includes('git worktree remove')
    );
    removeCalls.forEach((call) => {
      expect(call[1]).toEqual(expect.objectContaining({ cwd: '/target/repo' }));
    });

    expect(deleteLocalBranch).toHaveBeenCalledWith('feature/issue-51', '/target/repo');
  });

  it('does not pass cwd when omitted (existing behavior)', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return mainRepoWorktreeList;
      }
      if (cmdStr.includes('lsof')) {
        throw new Error('no processes');
      }
      return '';
    });

    removeWorktree('feature/issue-51');

    const removeCalls = vi.mocked(execSync).mock.calls.filter((call) =>
      String(call[0]).includes('git worktree remove')
    );
    removeCalls.forEach((call) => {
      expect(call[1]).toEqual(expect.objectContaining({ cwd: undefined }));
    });

    expect(deleteLocalBranch).toHaveBeenCalledWith('feature/issue-51', undefined);
  });
});

describe('removeWorktreesForIssue with process killing and branch deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes local branches for removed worktrees', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

worktree /mock/project/.worktrees/feature-issue-42-add-login
HEAD def456
branch refs/heads/feature/issue-42-add-login

worktree /mock/project/.worktrees/feature-issue-99-other
HEAD jkl012
branch refs/heads/feature/issue-99-other

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      if (cmdStr.includes('lsof')) {
        throw new Error('no processes');
      }
      return '';
    });

    const result = removeWorktreesForIssue(42);

    expect(result).toBe(1);
    expect(deleteLocalBranch).toHaveBeenCalledWith('feature/issue-42-add-login', undefined);
    expect(deleteLocalBranch).not.toHaveBeenCalledWith('feature/issue-99-other', expect.anything());
  });

  it('passes cwd to all internal execSync calls when provided', () => {
    const worktreeListOutput = `worktree /target/repo
HEAD abc123
branch refs/heads/main

worktree /target/repo/.worktrees/feature-issue-42-add-login
HEAD def456
branch refs/heads/feature/issue-42-add-login

`;
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('git worktree list')) {
        return worktreeListOutput;
      }
      if (cmdStr.includes('lsof')) {
        throw new Error('no processes');
      }
      return '';
    });

    const targetCwd = '/target/repo';
    const result = removeWorktreesForIssue(42, targetCwd);

    expect(result).toBe(1);

    // Verify that git worktree list calls received cwd
    const listCalls = vi.mocked(execSync).mock.calls.filter((call) =>
      String(call[0]).includes('git worktree list')
    );
    listCalls.forEach((call) => {
      expect(call[1]).toEqual(expect.objectContaining({ cwd: targetCwd }));
    });

    // Verify that git worktree remove received cwd
    const removeCalls = vi.mocked(execSync).mock.calls.filter((call) =>
      String(call[0]).includes('git worktree remove')
    );
    removeCalls.forEach((call) => {
      expect(call[1]).toEqual(expect.objectContaining({ cwd: targetCwd }));
    });

    // Verify that git worktree prune received cwd
    const pruneCalls = vi.mocked(execSync).mock.calls.filter((call) =>
      String(call[0]).includes('git worktree prune')
    );
    pruneCalls.forEach((call) => {
      expect(call[1]).toEqual(expect.objectContaining({ cwd: targetCwd }));
    });

    // Verify that deleteLocalBranch received cwd
    expect(deleteLocalBranch).toHaveBeenCalledWith('feature/issue-42-add-login', '/target/repo');
  });

  it('does not pass cwd when omitted (existing behavior)', () => {
    const worktreeListOutput = `worktree /mock/project
HEAD abc123
branch refs/heads/main

`;
    vi.mocked(execSync).mockReturnValue(worktreeListOutput);

    removeWorktreesForIssue(42);

    const listCalls = vi.mocked(execSync).mock.calls.filter((call) =>
      String(call[0]).includes('git worktree list')
    );
    listCalls.forEach((call) => {
      expect(call[1]).toEqual(expect.objectContaining({ cwd: undefined }));
    });
  });
});
