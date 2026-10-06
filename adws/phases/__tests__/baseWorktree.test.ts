import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import type { ExecFn } from '@paysdoc/devplatform/git';
import { branchPrefixAliases, branchPrefixMap } from '../../types/issueRouting';
import { extractIssueNumberFromDirName } from '../../triggers/devServerJanitor';
import { baseWorktreeName, buildBaseWorktreePort, sharedBaseWorktree, type BaseWorktreeDeps, type BaseWorktreePort } from '../baseWorktree';

type Git = BaseWorktreeDeps['git'];
type BaseConfig = Parameters<typeof buildBaseWorktreePort>[0];
type Call = ReadonlyArray<string | undefined>;

const NAME = 'base-issue-990-base-test';
const WORKTREE_PATH = '/repo/.worktrees/feature-issue-990-x';
const CHECKOUT_PATH = `/repo/.worktrees/${NAME}`;
const CONFIG: BaseConfig = { issueNumber: 990, adwId: 'base-test', defaultBranch: 'trunk', worktreePath: WORKTREE_PATH };

const CREATION: readonly Call[] = [
  ['removeWorktree', NAME],
  ['fetchRemote', 'trunk', WORKTREE_PATH],
  ['addDetachedWorktree', CHECKOUT_PATH, 'origin/trunk', WORKTREE_PATH],
  ['copyEnvToWorktree', CHECKOUT_PATH],
  ['headShort', CHECKOUT_PATH],
];
const REMOVAL: Call = ['removeWorktree', NAME];

function makeGit() {
  const calls: Call[] = [];
  const failing = new Set<keyof Git>();
  const record = (method: keyof Git, ...args: Array<string | undefined>): void => {
    calls.push([method, ...args]);
    if (failing.has(method)) throw new Error(`${method} failed`);
  };
  const git: Git = {
    removeWorktree: (name) => {
      record('removeWorktree', name);
      return true;
    },
    fetchRemote: (branch, cwd) => record('fetchRemote', branch, cwd),
    addDetachedWorktree: (target, ref, cwd) => record('addDetachedWorktree', target, ref, cwd),
    worktreePathFor: (name) => `/repo/.worktrees/${name}`,
    copyEnvToWorktree: (target) => record('copyEnvToWorktree', target),
    headShort: (cwd) => {
      record('headShort', cwd);
      return 'abc1234';
    },
  };
  return { git, calls, failing };
}

function makePort() {
  const fake = makeGit();
  const exitCleanups: Array<() => void> = [];
  const port = buildBaseWorktreePort(CONFIG, { git: fake.git, onExit: (cleanup) => { exitCleanups.push(cleanup); } });
  return { ...fake, port, exitCleanups };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildBaseWorktreePort', () => {
  it('checks the remote base branch out detached, after clearing a stale checkout, and reports where and at which commit', () => {
    const { port, calls } = makePort();

    expect(port.ensure()).toEqual({ path: CHECKOUT_PATH, baseBranch: 'trunk', commit: 'abc1234' });
    expect(calls).toEqual(CREATION);
  });

  it('makes the checkout once: a second ensure() returns the same checkout and touches nothing', () => {
    const { port, calls, exitCleanups } = makePort();

    const first = port.ensure();
    const second = port.ensure();

    expect(second).toBe(first);
    expect(calls).toEqual(CREATION);
    expect(exitCleanups).toHaveLength(1);
  });

  describe('removing the checkout', () => {
    it('is what the registered exit cleanup does', () => {
      const { port, calls, exitCleanups } = makePort();
      port.ensure();

      exitCleanups[0]();

      expect(calls).toEqual([...CREATION, REMOVAL]);
    });

    it('leaves the exit cleanup nothing more to do once remove() has run', () => {
      const { port, calls, exitCleanups } = makePort();
      port.ensure();

      port.remove();
      exitCleanups[0]();

      expect(calls).toEqual([...CREATION, REMOVAL]);
    });

    it('happens once, however often remove() is called', () => {
      const { port, calls } = makePort();
      port.ensure();

      port.remove();
      port.remove();

      expect(calls).toEqual([...CREATION, REMOVAL]);
    });

    it('does nothing before the checkout was made', () => {
      const { port, calls } = makePort();

      port.remove();

      expect(calls).toEqual([]);
    });
  });

  describe('a creation that fails', () => {
    it.each(['removeWorktree', 'fetchRemote', 'addDetachedWorktree', 'copyEnvToWorktree', 'headShort'] as const)(
      'rethrows when %s fails, and registers no exit cleanup',
      (step) => {
        const { port, failing, exitCleanups } = makePort();
        failing.add(step);

        expect(() => port.ensure()).toThrow(`${step} failed`);
        expect(exitCleanups).toEqual([]);
      },
    );

    it('is not remembered: the next ensure() starts over', () => {
      const { port, calls, failing, exitCleanups } = makePort();
      failing.add('fetchRemote');
      expect(() => port.ensure()).toThrow();
      failing.clear();

      const checkout = port.ensure();

      expect(checkout.path).toBe(CHECKOUT_PATH);
      expect(calls).toEqual([CREATION[0], CREATION[1], ...CREATION]);
      expect(exitCleanups).toHaveLength(1);
    });
  });

  describe('by default', () => {
    it('uses the launch GitContext of the config, and removes the checkout when the process exits', () => {
      const once = vi.spyOn(process, 'once').mockReturnValue(process);
      const { git, calls } = makeGit();

      buildBaseWorktreePort({ ...CONFIG, gitContext: git as unknown as GitContext }).ensure();
      const [event, onProcessExit] = once.mock.calls[0];
      onProcessExit();

      expect(event).toBe('exit');
      expect(once).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([...CREATION, REMOVAL]);
    });

    it('needs no GitContext to be built, only to be used', () => {
      const port = buildBaseWorktreePort(CONFIG);

      expect(() => port.remove()).not.toThrow();
      expect(() => port.ensure()).toThrow(/no launch GitContext/);
    });
  });
});

function launchGitContext(worktreeList: string): GitContext {
  const exec: ExecFn = (command) => (command.includes('worktree list --porcelain') ? worktreeList : '');
  return new GitContext(
    {
      owner: 'acme',
      repo: 'widgets',
      selfHost: false,
      tokenProvider: createLiteralTokenProvider('test-token'),
      gitIdentity: { authorName: 'ADW Bot', authorEmail: 'bot@adw.dev', committerName: 'ADW Bot', committerEmail: 'bot@adw.dev' },
      frameworkRepoRoot: '/srv/adw/framework',
      targetReposDir: '/srv/adw/repos',
    },
    { exec, logger: () => undefined },
  );
}

function worktreeList(...worktrees: ReadonlyArray<{ readonly path: string; readonly branch?: string }>): string {
  return worktrees
    .map(({ path: worktree, branch }) => `worktree ${worktree}\nHEAD 1111111\n${branch ? `branch refs/heads/${branch}` : 'detached'}\n`)
    .join('\n');
}

describe('baseWorktreeName', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-base-worktree-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('names the checkout after the issue and the run', () => {
    expect(baseWorktreeName(990, 'x')).toBe('base-issue-990-x');
  });

  it('puts the checkout in reach of the dev-server janitor', () => {
    expect(extractIssueNumberFromDirName(baseWorktreeName(990, 'x'))).toBe(990);
  });

  it('puts the checkout in reach of the cleanup of every worktree of an issue', () => {
    const checkout = path.join(workspace, '.worktrees', baseWorktreeName(990, 'x'));
    fs.mkdirSync(checkout, { recursive: true });
    const git = launchGitContext(worktreeList({ path: workspace, branch: 'trunk' }, { path: checkout }));

    expect(git.removeWorktreesForIssue(990)).toBe(1);
  });

  it('keeps the checkout from being taken for the worktree of the issue itself', () => {
    const worktrees = '/srv/adw/repos/acme/widgets/.worktrees';
    // Listed on a branch, which a detached checkout never is, so that only its name can keep it out.
    const base = { path: `${worktrees}/${baseWorktreeName(990, 'x')}`, branch: 'trunk' };
    const own = { path: `${worktrees}/feature-issue-990-x`, branch: 'feature-issue-990-x' };
    // The list is trimmed on its way out of GitContext, so the entry listed last has no blank line after it and is never matched.
    const sibling = { path: `${worktrees}/chore-issue-991-y`, branch: 'chore-issue-991-y' };
    const prefixes = [...Object.values(branchPrefixMap), ...Object.values(branchPrefixAliases).flat()];

    const found = launchGitContext(worktreeList(base, own, sibling)).findWorktreeForIssue(prefixes, 990);

    expect(found).toEqual({ worktreePath: own.path, branchName: own.branch });
  });
});

describe('sharedBaseWorktree', () => {
  const shared: BaseWorktreePort[] = [];
  const share = (config: BaseConfig): BaseWorktreePort => {
    const port = sharedBaseWorktree(config);
    shared.push(port);
    return port;
  };

  afterEach(() => {
    shared.splice(0).forEach((port) => port.remove());
  });

  it('returns one port per adwId', () => {
    const first = share({ ...CONFIG, adwId: 'shared-a' });

    expect(share({ ...CONFIG, adwId: 'shared-a' })).toBe(first);
    expect(share({ ...CONFIG, adwId: 'shared-b' })).not.toBe(first);
  });

  it('builds a fresh port for the next caller once its port was removed', () => {
    const config = { ...CONFIG, adwId: 'shared-c' };
    const first = share(config);

    first.remove();

    expect(share(config)).not.toBe(first);
  });

  it('shares one checkout between its callers', () => {
    vi.spyOn(process, 'once').mockReturnValue(process);
    const { git, calls } = makeGit();
    const config = { ...CONFIG, gitContext: git as unknown as GitContext };

    const baseline = share(config).ensure();
    const rerun = share(config).ensure();

    expect(rerun).toBe(baseline);
    expect(calls).toEqual(CREATION);
  });
});
