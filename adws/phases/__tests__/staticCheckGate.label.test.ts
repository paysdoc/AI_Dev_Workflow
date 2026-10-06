import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CheckStatus, StaticCheckName, type CheckVerdict } from '../../core/checkRunner';
import { logCheckVerdict } from '../staticCheckGate';

const SKIPPED: CheckVerdict = { check: StaticCheckName.TypeCheck, command: 'n/a', status: CheckStatus.Skipped, exitCode: null, output: '' };
const PASSED: CheckVerdict = { check: StaticCheckName.Lint, command: 'bun run lint', status: CheckStatus.Passed, exitCode: 0, output: '' };
const FAILED: CheckVerdict = { check: StaticCheckName.Build, command: 'bun run build', status: CheckStatus.Failed, exitCode: 2, output: 'build error in src/b.ts\n' };

let statePath: string;

function loggedMessages(): string[] {
  return fs
    .readFileSync(path.join(statePath, 'execution.log'), 'utf-8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.replace(/^\[[^\]]*\] /, ''));
}

beforeEach(() => {
  statePath = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-check-verdict-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(statePath, { recursive: true, force: true });
});

describe('logCheckVerdict', () => {
  it('logs every verdict under the label it is given', () => {
    [SKIPPED, PASSED, FAILED].forEach((verdict) => logCheckVerdict(statePath, verdict, 'Base branch check'));

    expect(loggedMessages()).toEqual([
      'Base branch check skipped (N/A): type check',
      'Base branch check passed: lint — bun run lint',
      'Base branch check failed: build (exit 2) — bun run build',
      'build error in src/b.ts',
    ]);
  });

  it('logs the lines of the static check gate when it is given no label', () => {
    [SKIPPED, PASSED, FAILED].forEach((verdict) => logCheckVerdict(statePath, verdict));

    expect(loggedMessages()).toEqual([
      'Static check skipped (N/A): type check',
      'Static check passed: lint — bun run lint',
      'Static check failed: build (exit 2) — bun run build',
      'build error in src/b.ts',
    ]);
  });
});
