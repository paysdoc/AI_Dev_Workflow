/**
 * Baseline scenarios of feature-1044: the repository of a bootstrap issue, whose base branch holds the ".adw/" that "adw_init"
 * writes for a hand-set application type and no application yet, and what the baseline of a real orchestrator process made of
 * it. The workflow, the run and the plan phase are feature-990's steps; the park assertions are feature-989's.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { ADW_DIRECTORY, renderAdwFiles } from '../../regression/step_definitions/feature-992-adw-files.ts';

import './feature-962-parameters.ts';
import { adwFilesWrittenFor } from './feature-1044-prompt.ts';
import { baselineCheckouts, executionLog, executionLogText, isBaseWorktree, serverEvents } from './feature-990-read.ts';
import { BASE_BRANCH, s } from './feature-990-world.ts';

const INIT_COMMAND = 'adw_init';
const DETAIL_SEPARATOR = ' — ';
/** What the fixture has of an application, which the repository of a bootstrap issue does not. */
const FIXTURE_APPLICATION = ['package.json', 'tsconfig.json', 'src'];

Given(
  'a target repository whose default branch {string} holds the {string} that {string} writes for the application type {string}, and no manifest and no Gradle wrapper yet',
  function (branch: string, directory: string, command: string, applicationType: string) {
    assert.strictEqual(branch, BASE_BRANCH, `The scenarios' target repository has the default branch "${BASE_BRANCH}"`);
    assert.strictEqual(directory, ADW_DIRECTORY, `The configuration ADW reads is in "${ADW_DIRECTORY}"`);
    assert.strictEqual(command, INIT_COMMAND, `The command that writes "${ADW_DIRECTORY}" is "${INIT_COMMAND}"`);
    const application = Object.fromEntries(FIXTURE_APPLICATION.map(file => [file, null]));
    s.repositoryFiles = { ...application, ...renderAdwFiles(adwFilesWrittenFor(applicationType)) };
  },
);

function requireBaseCheckout(baseBranch: string): void {
  const [checkout] = baselineCheckouts();
  assert.ok(checkout, `Expected the baseline to have checked the base branch out, but the execution log holds no such line:\n${executionLogText()}`);
  assert.strictEqual(checkout.baseBranch, baseBranch);
}

Then("the baseline's {string} check {reportedStepStatus} on the base branch {string} with a Gradle command", function (check: string, status: string, baseBranch: string) {
  assert.strictEqual(status, 'passed', `The baseline logs the command of a check that passed, not of one that is "${status}"`);
  requireBaseCheckout(baseBranch);

  const prefix = `Base branch check ${status}: ${check}`;
  const verdict = executionLog().find(({ message }) => message.startsWith(prefix));
  assert.ok(verdict, `Expected the execution log to say "${prefix}", got:\n${executionLogText()}`);

  const command = verdict.message.slice(verdict.message.indexOf(DETAIL_SEPARATOR) + DETAIL_SEPARATOR.length);
  assert.match(command, /\.\/gradlew\b/, `Expected the "${check}" check to be a Gradle command, but it is: ${command}`);
});

Then('the baseline started no dev server on its worktree of the base branch {string}', function (baseBranch: string) {
  requireBaseCheckout(baseBranch);

  const started = serverEvents().filter(event => event.event === 'started' && isBaseWorktree(event.cwd));
  assert.deepStrictEqual(started, [], `Expected the baseline to start no dev server on its worktree, but one started: ${JSON.stringify(started)}`);
  const serverLines = executionLog().filter(({ message }) => message.startsWith('Base branch dev server'));
  assert.deepStrictEqual(serverLines, [], `Expected the execution log to say nothing of a dev server of the base branch, got:\n${executionLogText()}`);
});
