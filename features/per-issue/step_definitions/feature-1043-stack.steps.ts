/**
 * Stack-check scenarios of feature-1043: the stack-coherence check over the four values a repository's ".adw/" gives. The
 * scenario describes a stack, the check judges it, and the assertions read both what the stack was read as and what the
 * check warned about. The unit-test phase's own scenario describes the stack in a worktree instead (feature-1043-phase.steps.ts).
 */

import { Given, Then, When, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { inferStackLanguages, stackCoherenceCheck, type StackCoherenceWarning } from '../../../adws/core/stackCoherenceCheck.ts';

import { requireJudgement, requireStack, s } from './feature-1043-world.ts';
import { stackFrom } from './feature-1043-stack.ts';

const ADW_DIRECTORY = '.adw/';

function describeWarnings(warnings: readonly StackCoherenceWarning[]): string {
  return warnings.map(warning => `${warning.code}: ${warning.message}`).join(' | ') || 'none';
}

Given('a target repository whose {string} describes its stack as:', function (directory: string, table: DataTable) {
  assert.strictEqual(directory, ADW_DIRECTORY, `The descriptors of a repository's stack live in "${ADW_DIRECTORY}"`);
  s.stack = stackFrom(table);
});

When("the stack-coherence check judges that repository's stack", function () {
  const stack = requireStack();
  s.judgement = { languages: [...inferStackLanguages(stack)], result: stackCoherenceCheck(stack) };
});

Then('the stack-coherence check reads the stack as the single language {string}', function (language: string) {
  const { languages } = requireJudgement();
  assert.deepStrictEqual(
    languages,
    [language],
    `Expected the stack to be read as the single language "${language}", but it was read as: ${languages.join(', ') || 'no language'}`,
  );
});

Then('the stack-coherence check warns about nothing', function () {
  const { warnings } = requireJudgement().result;
  assert.deepStrictEqual(warnings, [], `Expected the stack-coherence check to warn about nothing, but it warned: ${describeWarnings(warnings)}`);
});

Then('the stack-coherence check gives the one warning {string}', function (code: string) {
  const { warnings } = requireJudgement().result;
  assert.deepStrictEqual(
    warnings.map(warning => warning.code),
    [code],
    `Expected the stack-coherence check to give the one warning "${code}", but it gave: ${describeWarnings(warnings)}`,
  );
});

Then('that warning names {string} and {string}', function (first: string, second: string) {
  const [warning] = requireJudgement().result.warnings;
  assert.ok(warning, 'Expected the stack-coherence check to have given a warning');
  [first, second].forEach(name => assert.ok(warning.message.includes(name), `Expected the warning to name "${name}", got: ${warning.message}`));
});
