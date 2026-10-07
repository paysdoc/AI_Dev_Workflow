/**
 * Check-runner scenarios of feature-988, and the Then steps the unit-test phase scenarios share
 * with them. The scenarios run the real check runner over the real shell: a recording process
 * runner notes each command and hands it on to `runShellCommand`.
 */

import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { runStaticChecks, CheckStatus, type CheckVerdict } from '../../../adws/core/checkRunner.ts';
import { loadProjectConfig } from '../../../adws/core/projectConfig.ts';

import { checksThatRan } from '../../regression/step_definitions/feature-988-commands.ts';
import { s, recordingProcessRunner, writeStaticChecks } from '../../regression/step_definitions/feature-988-world.ts';

interface VerdictRow {
  check: string;
  verdict: string;
  'exit code': string;
  'output includes': string;
}

function assertOutput(verdict: CheckVerdict, row: VerdictRow): void {
  const included = row['output includes'];
  if (included !== '') {
    assert.ok(verdict.output.includes(included), `${row.check}: expected its output to include "${included}", got:\n${verdict.output}`);
    return;
  }
  if (verdict.status === CheckStatus.Skipped) {
    assert.strictEqual(verdict.output, '', `${row.check}: expected a skipped check to have no output`);
  }
}

function assertVerdict(verdict: CheckVerdict, row: VerdictRow): void {
  assert.strictEqual(verdict.status, row.verdict, `${row.check}: expected the verdict ${row.verdict}`);
  const expectedExitCode = row['exit code'] === '' ? null : Number(row['exit code']);
  assert.strictEqual(verdict.exitCode, expectedExitCode, `${row.check}: expected the exit code ${expectedExitCode}`);
  assertOutput(verdict, row);
}

Given('a working directory whose {string} configures these static checks, in this order:', function (relativePath: string, table: DataTable) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'adw-988-check-'));
  s.directories.push(directory);
  s.workingDirectory = directory;
  writeStaticChecks(directory, relativePath, table);
});

When('the check runner runs the static checks configured in that working directory', async function () {
  assert.ok(s.workingDirectory, 'Expected a working directory to have been set up first');
  s.verdicts = await runStaticChecks(loadProjectConfig(s.workingDirectory).commands, s.workingDirectory, recordingProcessRunner());
});

Then('exactly these static checks ran, in this order:', function (table: DataTable) {
  const expected = table.hashes().map(row => row.check);
  assert.deepStrictEqual(checksThatRan(s.configured, s.ranCommands), expected);
});

Then('the check runner reported these verdicts, in this order:', function (table: DataTable) {
  const rows = table.hashes() as unknown as VerdictRow[];
  assert.deepStrictEqual(s.verdicts.map(verdict => verdict.check), rows.map(row => row.check));
  rows.forEach((row, index) => assertVerdict(s.verdicts[index], row));
});
