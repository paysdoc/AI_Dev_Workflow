import { describe, it, expect, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { appendGitMockInvocation, readGitMockLog } from '../gitMockLog.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GIT_MOCK_PATH = resolve(__dirname, '../git-remote-mock.ts');
const PUSH_ARGS = ['push', '--force-with-lease', '--force-if-includes', '-u', 'origin', 'surface-26'];

const dirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

interface MockRun {
  status: number | null;
  stdout: string;
}

/** `logPath` undefined runs the mock with no MOCK_GIT_LOG at all, whatever the outer environment holds. */
function runGitMock(args: string[], cwd: string, logPath: string | undefined, extraEnv: Record<string, string> = {}): MockRun {
  const { MOCK_GIT_LOG: _outerLog, ...inherited } = process.env;
  const env = { ...inherited, ...(logPath === undefined ? {} : { MOCK_GIT_LOG: logPath }), ...extraEnv };
  const result = spawnSync('bun', [GIT_MOCK_PATH, ...args], { encoding: 'utf-8', cwd, env });
  return { status: result.status, stdout: result.stdout ?? '' };
}

describe('git-remote-mock — invocation log', () => {
  it('records a push with its full argument list and the working directory, and still prints the canned output', () => {
    const dir = makeTempDir('git-mock-log-');
    const logPath = join(dir, 'git.jsonl');

    const run = runGitMock(PUSH_ARGS, dir, logPath);

    expect(run.status).toBe(0);
    expect(run.stdout).toBe('Everything up-to-date\n');
    expect(readGitMockLog(logPath)).toEqual([{ subcommand: 'push', args: PUSH_ARGS, cwd: realpathSync(dir) }]);
  });

  it.each(['fetch', 'clone', 'pull', 'ls-remote'])('records %s under its own subcommand and exits 0', (subcommand) => {
    const dir = makeTempDir('git-mock-log-');
    const logPath = join(dir, 'git.jsonl');

    const run = runGitMock([subcommand, 'origin'], dir, logPath);

    expect(run.status).toBe(0);
    expect(readGitMockLog(logPath)).toEqual([{ subcommand, args: [subcommand, 'origin'], cwd: realpathSync(dir) }]);
  });

  it('appends one line per invocation, in the order the invocations were made', () => {
    const dir = makeTempDir('git-mock-log-');
    const logPath = join(dir, 'git.jsonl');

    runGitMock(['fetch', 'origin', 'surface-26'], dir, logPath);
    runGitMock(PUSH_ARGS, dir, logPath);

    expect(readGitMockLog(logPath).map(({ subcommand }) => subcommand)).toEqual(['fetch', 'push']);
  });

  it('hands a local subcommand to the real git and records nothing', () => {
    const dir = makeTempDir('git-mock-log-');
    const logPath = join(dir, 'git.jsonl');

    const run = runGitMock(['init', '-q'], dir, logPath, { REAL_GIT_PATH: execSync('which git', { encoding: 'utf-8' }).trim() });

    expect(run.status).toBe(0);
    expect(existsSync(join(dir, '.git'))).toBe(true);
    expect(readGitMockLog(logPath)).toEqual([]);
  });

  it('still turns a push into a no-op that exits 0, and writes no file, when MOCK_GIT_LOG is unset', () => {
    const dir = makeTempDir('git-mock-log-');

    const run = runGitMock(PUSH_ARGS, dir, undefined);

    expect(run.status).toBe(0);
    expect(run.stdout).toBe('Everything up-to-date\n');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('does not fail git when the log cannot be written', () => {
    const dir = makeTempDir('git-mock-log-');
    const unwritable = join(dir, 'no-such-directory', 'git.jsonl');

    const run = runGitMock(PUSH_ARGS, dir, unwritable);

    expect(run.status).toBe(0);
    expect(run.stdout).toBe('Everything up-to-date\n');
    expect(existsSync(unwritable)).toBe(false);
  });
});

describe('gitMockLog', () => {
  it('reads nothing from a log that does not exist', () => {
    const dir = makeTempDir('git-mock-log-');

    expect(readGitMockLog(join(dir, 'missing.jsonl'))).toEqual([]);
  });

  it('round-trips what it appends, in order', () => {
    const dir = makeTempDir('git-mock-log-');
    const logPath = join(dir, 'git.jsonl');
    const first = { subcommand: 'fetch', args: ['fetch', 'origin'], cwd: '/work/a' };
    const second = { subcommand: 'push', args: ['push', '-u', 'origin', 'b'], cwd: '/work/b' };

    appendGitMockInvocation(logPath, first);
    appendGitMockInvocation(logPath, second);

    expect(readGitMockLog(logPath)).toEqual([first, second]);
  });

  it('skips blank lines, lines that are not JSON and records of the wrong shape', () => {
    const dir = makeTempDir('git-mock-log-');
    const logPath = join(dir, 'git.jsonl');
    const kept = { subcommand: 'pull', args: ['pull'], cwd: '/work' };
    const lines = [
      '',
      JSON.stringify(kept),
      '   ',
      'not json at all',
      JSON.stringify({ subcommand: 'push', args: 'push origin x', cwd: '/work' }),
      JSON.stringify({ subcommand: 'push', args: ['push', 7], cwd: '/work' }),
      JSON.stringify({ subcommand: 'push', args: ['push'] }),
      JSON.stringify(['push']),
      'null',
    ];
    writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf-8');

    expect(readGitMockLog(logPath)).toEqual([kept]);
  });
});
