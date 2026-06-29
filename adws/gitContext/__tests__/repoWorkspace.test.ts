import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
  getTargetRepoWorkspacePath,
  convertToSshUrl,
  isRepoCloned,
  ensureRepoWorkspace,
} from '../repoWorkspace';
import type { WorkspaceExecFn } from '../repoWorkspace';

const TARGET_REPOS_DIR = '/srv/adw/repos';

// ---------------------------------------------------------------------------
// getTargetRepoWorkspacePath
// ---------------------------------------------------------------------------

describe('getTargetRepoWorkspacePath', () => {
  it('composes targetReposDir/owner/repo', () => {
    const result = getTargetRepoWorkspacePath('acme', 'webapp', TARGET_REPOS_DIR);
    expect(result).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp'));
  });

  it('returns different paths for different owner/repo pairs', () => {
    const a = getTargetRepoWorkspacePath('acme', 'webapp', TARGET_REPOS_DIR);
    const b = getTargetRepoWorkspacePath('octo', 'infra', TARGET_REPOS_DIR);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// convertToSshUrl
// ---------------------------------------------------------------------------

describe('convertToSshUrl', () => {
  it('converts HTTPS GitHub URL to SSH', () => {
    const result = convertToSshUrl('https://github.com/acme/webapp');
    expect(result).toBe('git@github.com:acme/webapp.git');
  });

  it('converts HTTPS URL with .git suffix', () => {
    const result = convertToSshUrl('https://github.com/acme/webapp.git');
    expect(result).toBe('git@github.com:acme/webapp.git');
  });

  it('returns an already-SSH URL unchanged', () => {
    const sshUrl = 'git@github.com:acme/webapp.git';
    expect(convertToSshUrl(sshUrl)).toBe(sshUrl);
  });

  it('returns a non-GitHub HTTPS URL unchanged', () => {
    const url = 'https://gitlab.com/acme/webapp.git';
    expect(convertToSshUrl(url)).toBe(url);
  });
});

// ---------------------------------------------------------------------------
// isRepoCloned
// ---------------------------------------------------------------------------

describe('isRepoCloned', () => {
  it('returns true when .git exists at the workspace path', () => {
    const result = isRepoCloned('/some/path', { existsSync: (p) => String(p).endsWith('.git') });
    expect(result).toBe(true);
  });

  it('returns false when .git does not exist', () => {
    const result = isRepoCloned('/some/path', { existsSync: () => false });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureRepoWorkspace — clone branch (not cloned)
// ---------------------------------------------------------------------------

describe('ensureRepoWorkspace — not cloned: clones via SSH', () => {
  it('calls exec with git clone when workspace is absent', () => {
    const execCalls: string[] = [];
    const fakeExec: WorkspaceExecFn = (cmd) => { execCalls.push(cmd); };

    ensureRepoWorkspace('acme', 'webapp', 'https://github.com/acme/webapp', {
      targetReposDir: TARGET_REPOS_DIR,
      getDefaultBranch: () => 'main',
      exec: fakeExec,
      fsDeps: { existsSync: () => false, mkdirSync: () => {} },
      log: () => {},
    });

    const cloneCall = execCalls.find(c => c.includes('git clone'));
    expect(cloneCall).toBeDefined();
    expect(cloneCall!).toContain('git@github.com:acme/webapp.git');
  });

  it('returns the computed workspace path', () => {
    const fakeExec: WorkspaceExecFn = () => {};
    const result = ensureRepoWorkspace('acme', 'webapp', 'https://github.com/acme/webapp', {
      targetReposDir: TARGET_REPOS_DIR,
      getDefaultBranch: () => 'main',
      exec: fakeExec,
      fsDeps: { existsSync: () => false, mkdirSync: () => {} },
      log: () => {},
    });
    expect(result).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp'));
  });
});

// ---------------------------------------------------------------------------
// ensureRepoWorkspace — fetch branch (already cloned)
// ---------------------------------------------------------------------------

describe('ensureRepoWorkspace — already cloned: fetches and reads default branch', () => {
  it('runs git fetch origin when workspace already exists', () => {
    const execCalls: string[] = [];
    const fakeExec: WorkspaceExecFn = (cmd) => { execCalls.push(cmd); };

    ensureRepoWorkspace('acme', 'webapp', 'https://github.com/acme/webapp', {
      targetReposDir: TARGET_REPOS_DIR,
      getDefaultBranch: () => 'main',
      exec: fakeExec,
      fsDeps: { existsSync: (p) => String(p).endsWith('.git'), mkdirSync: () => {} },
      log: () => {},
    });

    expect(execCalls).toContain('git fetch origin');
  });

  it('calls getDefaultBranch through the injected thunk (bound-auth runner)', () => {
    let defaultBranchCalled = false;
    const getDefaultBranch = () => { defaultBranchCalled = true; return 'main'; };

    ensureRepoWorkspace('acme', 'webapp', 'https://github.com/acme/webapp', {
      targetReposDir: TARGET_REPOS_DIR,
      getDefaultBranch,
      exec: () => {},
      fsDeps: { existsSync: (p) => String(p).endsWith('.git'), mkdirSync: () => {} },
      log: () => {},
    });

    expect(defaultBranchCalled).toBe(true);
  });

  it('does NOT call git clone when workspace already exists', () => {
    const execCalls: string[] = [];
    const fakeExec: WorkspaceExecFn = (cmd) => { execCalls.push(cmd); };

    ensureRepoWorkspace('acme', 'webapp', 'https://github.com/acme/webapp', {
      targetReposDir: TARGET_REPOS_DIR,
      getDefaultBranch: () => 'main',
      exec: fakeExec,
      fsDeps: { existsSync: (p) => String(p).endsWith('.git'), mkdirSync: () => {} },
      log: () => {},
    });

    expect(execCalls.some(c => c.includes('git clone'))).toBe(false);
  });
});
