/**
 * §1 of feature-933.feature: the branch-name check, run through its package script over the ADW
 * checkout and in-process over throwaway fixture trees. Every assertion reads the check's exit
 * status and its report; no scenario reads or greps a source file.
 */

import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { execFileSync } from 'child_process';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

import { runBranchNameCheck } from '../../../adws/checkBranchNames.ts';
import { makeTempDir, writeFixtureFile } from './feature-933-fixture.ts';

const REPO_ROOT = process.cwd();

const FIXTURE_FILES: Readonly<Record<string, string>> = {
  'adws/core/fixtureModule.ts': 'export function addOne(value: number): number {\n  return value + 1;\n}\n',
  '.claude/commands/fixture_command.md': '# Fixture command\n\n## Run\n\n- Read the issue\n- Make the change\n- Report what changed\n',
};

const check: { root: string | null; exitCode: number; report: string } = { root: null, exitCode: -1, report: '' };

After({ tags: '@adw-933' }, function () {
  check.root = null;
  check.exitCode = -1;
  check.report = '';
});

function requireRoot(): string {
  assert.ok(check.root, 'Expected a fixture tree to have been built first');
  return check.root;
}

function runOverTree(root: string): void {
  const { exitCode, lines } = runBranchNameCheck(root);
  check.exitCode = exitCode;
  check.report = lines.join('\n');
}

Given('a fixture tree that the branch-name check passes', function () {
  const root = makeTempDir('adw-933-tree-');
  for (const [relPath, body] of Object.entries(FIXTURE_FILES)) writeFixtureFile(root, relPath, body);
  mkdirSync(join(root, '.github'), { recursive: true });
  check.root = root;
  runOverTree(root);
  assert.strictEqual(check.exitCode, 0, `Expected the fixture tree to pass as built. Report:\n${check.report}`);
});

Given('the file {string} in the fixture tree contains the line:', function (relPath: string, line: string) {
  const file = join(requireRoot(), relPath);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${line}\n`);
});

When('the branch-name check is run over the fixture tree', function () {
  runOverTree(requireRoot());
});

When('the branch-name check is run over the ADW checkout', function () {
  try {
    check.report = execFileSync('bun', ['run', 'lint:branch-names'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    check.exitCode = 0;
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    check.exitCode = e.status ?? 1;
    check.report = e.stdout ?? '';
  }
});

Then('the branch-name check passes', function () {
  assert.strictEqual(check.exitCode, 0, `Expected the branch-name check to pass. Report:\n${check.report}`);
});

Then('the branch-name check fails', function () {
  assert.ok(check.exitCode > 0, `Expected the branch-name check to fail. Exit status ${check.exitCode}. Report:\n${check.report}`);
});

Then('the branch-name check report names {string}', function (relPath: string) {
  assert.ok(check.report.includes(relPath), `Expected the report to name ${relPath}. Report:\n${check.report}`);
});
