/** How the scenarios of feature-965.feature read a git-mock log and compare it with what they expect. */

import assert from 'assert';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { readGitMockLog } from '../../../test/mocks/gitMockLog.ts';
import type { GitMockInvocation } from '../../../test/mocks/types.ts';

/** The mock records the directory it ran in as the system reports it: on macOS os.tmpdir() lies under /var, which links to /private/var. */
export function invocationOf(subcommand: string, argumentsText: string, worktreePath: string): GitMockInvocation {
  return { subcommand, args: argumentsText.split(' '), cwd: realpathSync(worktreePath) };
}

function rawLines(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf-8').split('\n').filter((line) => line.trim().length > 0);
}

/** Compares the file's lines, not only the records `readGitMockLog` accepts, so a malformed line fails here. */
export function assertLogHolds(logPath: string, expected: readonly GitMockInvocation[]): void {
  assert.ok(logPath, 'Expected a path for the git-mock log, but there is none');
  const lines = rawLines(logPath);
  assert.strictEqual(lines.length, expected.length, `Expected the log at ${logPath} to hold ${expected.length} line(s), but it holds ${lines.length}:\n${lines.join('\n') || '(empty)'}`);
  assert.deepStrictEqual(readGitMockLog(logPath), expected, `Expected the log at ${logPath} to hold the invocations ${JSON.stringify(expected)}, but it holds:\n${lines.join('\n')}`);
}
