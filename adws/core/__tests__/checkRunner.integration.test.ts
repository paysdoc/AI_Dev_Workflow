/**
 * Integration test: the default process runner of the check runner, against the real shell.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runShellCommand, runStaticChecks, CheckStatus, StaticCheckName } from '../checkRunner';

let workDir = '';

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-check-runner-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('runShellCommand', () => {
  it('returns the exit code of the command', async () => {
    const outcome = await runShellCommand('exit 3', workDir);

    expect(outcome.exitCode).toBe(3);
  });

  it('returns exit code 0 for a command that succeeds', async () => {
    const outcome = await runShellCommand('true', workDir);

    expect(outcome).toEqual({ exitCode: 0, output: '' });
  });

  it('captures what the command writes to standard output and to standard error', async () => {
    const outcome = await runShellCommand("printf 'to stdout\\n'; printf 'to stderr\\n' >&2; exit 3", workDir);

    expect(outcome.exitCode).toBe(3);
    expect(outcome.output).toContain('to stdout');
    expect(outcome.output).toContain('to stderr');
  });

  it('runs the command in the given directory', async () => {
    const outcome = await runShellCommand('pwd', workDir);

    expect(outcome.output.trim()).toBe(fs.realpathSync(workDir));
  });

  it('reports no exit code for a command killed by a signal', async () => {
    const outcome = await runShellCommand('kill -9 $$', workDir);

    expect(outcome.exitCode).toBeNull();
  });

  it('reports a command that cannot be started as a failure with the reason in its output', async () => {
    const outcome = await runShellCommand('true', path.join(workDir, 'missing'));

    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.output).toMatch(/ENOENT/);
  });
});

describe('runStaticChecks with the default process runner', () => {
  it('reports passed, skipped, failed and passed, with each command’s own output', async () => {
    const verdicts = await runStaticChecks(
      { typeCheck: 'exit 0', additionalTypeChecks: 'N/A', runLinter: 'echo lint-out; exit 1', runBuild: 'echo build-out' },
      workDir,
    );

    expect(verdicts.map(verdict => [verdict.check, verdict.status, verdict.exitCode])).toEqual([
      [StaticCheckName.TypeCheck, CheckStatus.Passed, 0],
      [StaticCheckName.AdditionalTypeChecks, CheckStatus.Skipped, null],
      [StaticCheckName.Lint, CheckStatus.Failed, 1],
      [StaticCheckName.Build, CheckStatus.Passed, 0],
    ]);
    expect(verdicts[2].output).toContain('lint-out');
    expect(verdicts[3].output).toContain('build-out');
  });

  it('fails every configured check when the working directory does not exist', async () => {
    const verdicts = await runStaticChecks(
      { typeCheck: 'true', additionalTypeChecks: 'N/A', runLinter: 'true', runBuild: 'true' },
      path.join(workDir, 'missing'),
    );

    expect(verdicts.map(verdict => verdict.status)).toEqual([
      CheckStatus.Failed,
      CheckStatus.Skipped,
      CheckStatus.Failed,
      CheckStatus.Failed,
    ]);
  });
});
