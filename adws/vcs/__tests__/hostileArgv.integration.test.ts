/**
 * Real-git proof that a commit message reaches git as a single argv element: a message carrying an
 * apostrophe, backticks and `$(...)` is recorded byte-for-byte and nothing in it runs on the host.
 * No `exec` is injected, so the executor is the one production uses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';

const HOSTILE_TITLE = "Fix the user's `foo` $(echo pwned) crash";
const MESSAGE = `chore: ${HOSTILE_TITLE}`;
const TRACKED_FILE = 'hostile.txt';

type Commit = (ctx: GitContext, message: string) => boolean;

let workdir: string;
let sentinelDir: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeContext(): GitContext {
  return new GitContext({
    owner: 'test',
    repo: 'test',
    selfHost: true,
    tokenProvider: createLiteralTokenProvider('dummy-token-for-local-test'),
    gitIdentity: {
      authorName: 'ADW Test',
      authorEmail: 'test@adw.test',
      committerName: 'ADW Test',
      committerEmail: 'test@adw.test',
    },
    frameworkRepoRoot: workdir,
    targetReposDir: tmpdir(),
  });
}

function lastCommitMessage(): string {
  return git(workdir, 'log', '-1', '--format=%B');
}

const COMMITS: ReadonlyArray<readonly [string, Commit]> = [
  ['commitChanges', (ctx, message) => ctx.commitChanges(message, workdir)],
  ['addAndCommitPaths', (ctx, message) => ctx.addAndCommitPaths([TRACKED_FILE], message, workdir)],
];

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'adw-hostile-argv-work-'));
  sentinelDir = mkdtempSync(join(tmpdir(), 'adw-hostile-argv-sentinel-'));
  git(workdir, 'init', '-q');
  git(workdir, 'config', 'user.email', 'test@adw.test');
  git(workdir, 'config', 'user.name', 'ADW Test');
  git(workdir, 'config', 'commit.gpgsign', 'false');
  git(workdir, 'commit', '-q', '--allow-empty', '-m', 'initial commit');
  writeFileSync(join(workdir, TRACKED_FILE), 'content\n');
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(sentinelDir, { recursive: true, force: true });
});

describe.each(COMMITS)('GitContext.%s with a hostile message (real git)', (_name, commit) => {
  it('records the message byte-for-byte', () => {
    expect(commit(makeContext(), MESSAGE)).toBe(true);

    const recorded = lastCommitMessage();
    expect(recorded).toBe(MESSAGE);
    expect(recorded).toContain('$(echo pwned)');
    expect(recorded).toContain('`foo`');
    expect(recorded.replace('$(echo pwned)', '')).not.toContain('pwned');
  });

  it('runs no command the message carries', () => {
    const substitution = join(sentinelDir, 'substitution');
    const backticks = join(sentinelDir, 'backticks');
    const message = `chore: $(touch ${substitution}) \`touch ${backticks}\``;

    expect(commit(makeContext(), message)).toBe(true);

    expect(lastCommitMessage()).toBe(message);
    expect(existsSync(substitution)).toBe(false);
    expect(existsSync(backticks)).toBe(false);
  });
});
