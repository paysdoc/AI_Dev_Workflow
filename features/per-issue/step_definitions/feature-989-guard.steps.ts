/**
 * Fix-round guard scenarios of feature-989. Each calls the pure guard directly: the language comes from
 * `inferStackLanguages` over the two descriptors the scenario names (the run commands stay empty, so no
 * default command adds a language), the repository's own patterns become a "## Suppression Patterns"
 * body, and a round's diff is built from the scenario's wording.
 */

import { Given, When, Then, Before, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { inferStackLanguages } from '../../../adws/core/stackCoherenceCheck.ts';
import {
  buildFixRoundGuardConfig,
  describeGuardRejection,
  evaluateFixRound,
  type FixRoundVerdict,
} from '../../../adws/core/fixRoundGuard.ts';

import { addedLineDiff, createdFileDiff, deletedFileDiff, diffForChange, editedFileDiff } from './feature-989-diffs.ts';

interface GuardScenario {
  testFramework: string;
  bddFramework: string;
  /** One bullet per entry the repository lists as its own suppression pattern. */
  suppressionSection: string;
  diffs: string[];
  verdict: FixRoundVerdict | null;
}

const guardScenario: GuardScenario = { testFramework: '', bddFramework: '', suppressionSection: '', diffs: [], verdict: null };

Before({ tags: '@adw-989' }, function () {
  Object.assign(guardScenario, { testFramework: '', bddFramework: '', suppressionSection: '', diffs: [], verdict: null });
});

function requireVerdict(): FixRoundVerdict {
  assert.ok(guardScenario.verdict, 'Expected the fix-round guard to have judged a fix round first');
  return guardScenario.verdict;
}

function describedReasons(): string[] {
  const verdict = requireVerdict();
  assert.ok(!verdict.accepted, 'Expected the fix-round guard to have rejected the fix round, but it accepted it');
  return verdict.reasons.map(describeGuardRejection);
}

function assertSomeReasonNames(reasons: readonly string[], file: string): void {
  assert.ok(reasons.some(reason => reason.includes(`\`${file}\``)), `Expected a reason that names "${file}", got:\n${reasons.join('\n')}`);
}

Given(
  'a target repository whose {string} names the test framework {string} and the BDD framework {string}',
  function (descriptorDirectory: string, testFramework: string, bddFramework: string) {
    assert.strictEqual(descriptorDirectory, '.adw/', 'The stack descriptors live in ".adw/"');
    Object.assign(guardScenario, { testFramework, bddFramework });
  },
);

Given('the repository\'s {string} lists these entries as its own suppression patterns:', function (file: string, table: DataTable) {
  assert.strictEqual(file, '.adw/commands.md', 'The repository lists its own suppression patterns in ".adw/commands.md"');
  guardScenario.suppressionSection = table.hashes().map(row => `- ${row.entry}`).join('\n');
});

Given('a fix round whose diff adds the line {string} to {string}', function (line: string, file: string) {
  guardScenario.diffs.push(addedLineDiff(file, line));
});

Given('a fix round whose diff edits {string}', function (file: string) {
  guardScenario.diffs.push(editedFileDiff(file));
});

Given('a fix round whose diff creates {string}', function (file: string) {
  guardScenario.diffs.push(createdFileDiff(file));
});

Given('a fix round whose diff deletes {string}', function (file: string) {
  guardScenario.diffs.push(deletedFileDiff(file));
});

Given('a fix round whose diff makes these changes:', function (table: DataTable) {
  table.hashes().forEach(row => guardScenario.diffs.push(diffForChange(row.file, row.change)));
});

Given('a fix round whose diff is:', function (diff: string) {
  guardScenario.diffs.push(diff);
});

When('the fix-round guard judges the fix round for that repository', function () {
  const languages = inferStackLanguages({
    testFramework: guardScenario.testFramework,
    bddFramework: guardScenario.bddFramework,
    runTests: '',
    runScenariosByTag: '',
  });
  const config = buildFixRoundGuardConfig(languages, guardScenario.suppressionSection);
  guardScenario.verdict = evaluateFixRound(guardScenario.diffs.join('\n'), config);
});

Then('the fix-round guard accepts the fix round', function () {
  const verdict = requireVerdict();
  const reasons = verdict.accepted ? [] : verdict.reasons.map(describeGuardRejection);
  assert.ok(verdict.accepted, `Expected the fix-round guard to accept the fix round, but it rejected it:\n${reasons.join('\n')}`);
});

Then('the fix-round guard rejects the fix round with a reason that names {string}', function (file: string) {
  assertSomeReasonNames(describedReasons(), file);
});

Then('the fix-round guard rejects the fix round with reasons that name each of:', function (table: DataTable) {
  const reasons = describedReasons();
  table.hashes().forEach(row => assertSomeReasonNames(reasons, row.file));
});
