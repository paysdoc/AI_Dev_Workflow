import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'fs';
import { dirname, join, delimiter, sep } from 'path';
import { tmpdir } from 'os';
import { setupMockInfrastructure, teardownMockInfrastructure, withRealGit } from '../test-harness.ts';
import { startMockServer } from '../github-api-server.ts';
import { readGitMockLog } from '../gitMockLog.ts';

const outerGitLog = process.env['MOCK_GIT_LOG'];

afterEach(async () => {
  await teardownMockInfrastructure();
  if (outerGitLog === undefined) delete process.env['MOCK_GIT_LOG'];
  else process.env['MOCK_GIT_LOG'] = outerGitLog;
});

async function isListening(url: string): Promise<boolean> {
  return fetch(url).then(() => true).catch(() => false);
}

describe('setupMockInfrastructure — git-mock wrapper location', () => {
  it('installs the git wrapper under a writable directory outside process.cwd()', async () => {
    await setupMockInfrastructure();

    const mockDir = (process.env['PATH'] ?? '').split(delimiter)[0] ?? '';
    const cwd = process.cwd();

    expect(mockDir).not.toBe('');
    expect(mockDir === cwd || mockDir.startsWith(cwd + sep)).toBe(false);
    expect(mockDir === tmpdir() || mockDir.startsWith(tmpdir() + sep)).toBe(true);
    expect(() => accessSync(mockDir, constants.W_OK)).not.toThrow();
  });
});

describe('teardownMockInfrastructure — unconditional cleanup', () => {
  it('stops a mock server left listening by a partial setup', async () => {
    const { url } = await startMockServer(0);
    expect(await isListening(url)).toBe(true);

    await teardownMockInfrastructure();

    expect(await isListening(url)).toBe(false);
  });
});

describe('setupMockInfrastructure — crash safety', () => {
  it('stops the server it started when a later setup step throws', async () => {
    const FIXED_PORT = 48173;
    const originalTmpdir = process.env['TMPDIR'];
    process.env['TMPDIR'] = join(originalTmpdir ?? tmpdir(), 'adw-767-does-not-exist', 'nested');

    try {
      await expect(setupMockInfrastructure({ port: FIXED_PORT })).rejects.toThrow();
      expect(await isListening(`http://localhost:${FIXED_PORT}/`)).toBe(false);
    } finally {
      if (originalTmpdir === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = originalTmpdir;
      await teardownMockInfrastructure();
    }
  });
});

describe('setupMockInfrastructure — git-mock invocation log', () => {
  const PUSH = ['push', 'origin', 'surface-26'];

  function pushThroughGitOnPath(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'adw-git-log-cwd-'));
    try {
      execFileSync('git', PUSH, { cwd, env: process.env, stdio: 'pipe' });
      return realpathSync(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  it('points MOCK_GIT_LOG at an empty log of its own, under the temporary directory and outside the checkout', async () => {
    const { gitLogPath } = await setupMockInfrastructure();
    const cwd = process.cwd();

    expect(gitLogPath).toBe(process.env['MOCK_GIT_LOG']);
    expect(gitLogPath.startsWith(tmpdir() + sep)).toBe(true);
    expect(gitLogPath === cwd || gitLogPath.startsWith(cwd + sep)).toBe(false);
    expect(existsSync(gitLogPath)).toBe(true);
    expect(readFileSync(gitLogPath, 'utf-8')).toBe('');
  });

  it('records a push made through the git the setup put first on PATH', async () => {
    const { gitLogPath } = await setupMockInfrastructure();

    const pushedFrom = pushThroughGitOnPath();

    expect(readGitMockLog(gitLogPath)).toEqual([{ subcommand: 'push', args: PUSH, cwd: pushedFrom }]);
  });

  it.each([
    ['unset', undefined],
    ['set to its earlier value', '/nonexistent/adw-965-outer.jsonl'],
  ])('removes the log on teardown and leaves MOCK_GIT_LOG %s', async (_label, before) => {
    if (before === undefined) delete process.env['MOCK_GIT_LOG'];
    else process.env['MOCK_GIT_LOG'] = before;
    const { gitLogPath } = await setupMockInfrastructure();
    pushThroughGitOnPath();

    await teardownMockInfrastructure();

    expect(existsSync(gitLogPath)).toBe(false);
    expect(existsSync(dirname(gitLogPath))).toBe(false);
    expect(process.env['MOCK_GIT_LOG']).toBe(before);
  });

  it('hands a second setup made without a teardown the log of the first', async () => {
    const first = await setupMockInfrastructure();
    const second = await setupMockInfrastructure();

    expect(typeof first.gitLogPath).toBe('string');
    expect(second.gitLogPath).toBe(first.gitLogPath);
  });

  it('gives each setup a log of its own, empty of what the last one recorded', async () => {
    const first = await setupMockInfrastructure();
    pushThroughGitOnPath();
    await teardownMockInfrastructure();

    const second = await setupMockInfrastructure();

    expect(second.gitLogPath).not.toBe(first.gitLogPath);
    expect(readGitMockLog(second.gitLogPath)).toEqual([]);
  });
});

describe('withRealGit — the git-mock off PATH for one run', () => {
  function firstPathEntry(): string {
    return (process.env['PATH'] ?? '').split(delimiter)[0] ?? '';
  }

  /** Made with the real git that setup recorded, so the git-mock leading PATH takes no part in making it. */
  function createRepositoryWithOneCommit(): string {
    const realGit = process.env['REAL_GIT_PATH'] ?? 'git';
    const repo = mkdtempSync(join(tmpdir(), 'adw-real-git-repo-'));
    execFileSync(realGit, ['init', '-q', '-b', 'main'], { cwd: repo, stdio: 'pipe' });
    execFileSync(realGit, ['-c', 'user.name=ADW Test', '-c', 'user.email=test@adw.local', 'commit', '-q', '--allow-empty', '-m', 'one'], {
      cwd: repo,
      stdio: 'pipe',
    });
    return repo;
  }

  function lsRemote(repo: string): string {
    return execFileSync('git', ['ls-remote', repo], { env: process.env, encoding: 'utf-8' });
  }

  it('lets a network subcommand inside the run reach the real git, where outside it the git-mock answers', async () => {
    await setupMockInfrastructure();
    const repo = createRepositoryWithOneCommit();

    try {
      expect(lsRemote(repo)).not.toContain('refs/heads/main');

      const listedInside = await withRealGit(async () => lsRemote(repo));

      expect(listedInside).toContain('refs/heads/main');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('puts PATH back after the run resolves, with the git-mock leading it again', async () => {
    await setupMockInfrastructure();
    const pathBefore = process.env['PATH'];
    const mockDir = firstPathEntry();

    await withRealGit(async () => 'done');

    expect(process.env['PATH']).toBe(pathBefore);
    expect(firstPathEntry()).toBe(mockDir);
  });

  it('puts PATH back after the run rejects, with the git-mock leading it again, and passes the rejection on', async () => {
    await setupMockInfrastructure();
    const pathBefore = process.env['PATH'];
    const mockDir = firstPathEntry();

    await expect(withRealGit(async () => { throw new Error('the run failed'); })).rejects.toThrow('the run failed');

    expect(process.env['PATH']).toBe(pathBefore);
    expect(firstPathEntry()).toBe(mockDir);
  });

  it('keeps every other PATH entry for the run, whatever its place, and drops each occurrence of the git-mock directory', async () => {
    const outerPath = process.env['PATH'] ?? '';
    await setupMockInfrastructure();
    const mockDir = firstPathEntry();
    const shadowDir = mkdtempSync(join(tmpdir(), 'adw-path-shadow-'));
    process.env['PATH'] = [shadowDir, process.env['PATH'], mockDir].join(delimiter);

    try {
      const pathInside = await withRealGit(async () => process.env['PATH']);

      expect(pathInside).toBe([shadowDir, outerPath].join(delimiter));
    } finally {
      rmSync(shadowDir, { recursive: true, force: true });
    }
  });

  it('only runs the run, and returns what it returns, while the mock infrastructure is not set up', async () => {
    await setupMockInfrastructure();
    await teardownMockInfrastructure();
    const pathBefore = process.env['PATH'];

    const result = await withRealGit(async () => ({ pathInside: process.env['PATH'], answer: 42 }));

    expect(result).toEqual({ pathInside: pathBefore, answer: 42 });
    expect(process.env['PATH']).toBe(pathBefore);
  });
});
