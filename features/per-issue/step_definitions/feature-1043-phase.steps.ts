/**
 * Unit-test phase scenarios of feature-1043: a worktree that declares its application type and describes its stack in
 * ".adw/", and what the unit-test phase says about that stack. The workflow, the JUnit report and the phase itself are
 * feature-988's steps; the stack is written beside the static checks the scenario's first step configured, not over them.
 */

import { Given, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { declaredApplicationProfile } from '../../../adws/phases/applicationTypeGate.ts';

import { world796 } from '../../regression/step_definitions/feature-796.steps.ts';
import { commentsOn } from '../../regression/step_definitions/feature-929-workflow.ts';
import { ADW_DIRECTORY, COMMANDS_MD, SCENARIOS_MD } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { PROJECT_MD, assertProjectMdFile, projectMd } from '../../regression/step_definitions/feature-991-project-md.ts';
import { requireWorkflow } from './feature-988-phase.steps.ts';
import { isHeaded } from './feature-929-comments.ts';
import { stackFrom } from './feature-1043-stack.ts';

const LABELLING_OPERATIONS: ReadonlySet<string> = new Set(['applyLabel', 'addLabel']);

function sectionsOf(sections: readonly (readonly [heading: string, body: string])[]): string {
  return sections.map(([heading, body]) => `\n## ${heading}\n\n${body}\n`).join('');
}

function writeInWorktree(relativePath: string, write: (file: string) => void): void {
  const file = path.join(requireWorkflow().worktreePath, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  write(file);
}

Given("the worktree's {string} declares the application type {string}", function (file: string, applicationType: string) {
  assertProjectMdFile(file);
  const profile = declaredApplicationProfile({ applicationType });
  assert.ok(profile, `The application type "${applicationType}" is not one ADW knows`);
  writeInWorktree(PROJECT_MD, target => fs.writeFileSync(target, projectMd(applicationType), 'utf-8'));
  requireWorkflow().config.applicationProfile = profile;
});

Given("the worktree's {string} describes its stack as:", function (directory: string, table: DataTable) {
  assert.strictEqual(directory, ADW_DIRECTORY, `The descriptors of a repository's stack live in "${ADW_DIRECTORY}"`);
  const { testFramework, runTests, bddFramework, runScenariosByTag } = stackFrom(table);
  const commandSections = sectionsOf([['Test Framework', testFramework], ['Run Tests', runTests], ['Run Scenarios by Tag', runScenariosByTag]]);
  const scenarioSections = sectionsOf([['BDD Framework', bddFramework], ['Run Scenarios by Tag', runScenariosByTag]]);
  writeInWorktree(COMMANDS_MD, target => fs.appendFileSync(target, commandSections));
  writeInWorktree(SCENARIOS_MD, target => fs.writeFileSync(target, `# ADW BDD Scenario Configuration\n${scenarioSections}`, 'utf-8'));
});

Then('the unit-test phase posted no comment headed {string} on issue {int}', function (heading: string, issueNumber: number) {
  const headed = commentsOn(issueNumber).filter(body => isHeaded(body, heading));
  assert.deepStrictEqual(
    headed,
    [],
    `Expected the unit-test phase to post no comment headed "${heading}" on issue ${issueNumber}, but it posted:\n${headed.join('\n---\n')}`,
  );
});

Then('issue {int} was not labelled {string}', function (issueNumber: number, label: string) {
  const labelled = world796().activeCallLog.filter(
    call => LABELLING_OPERATIONS.has(call.operation) && call.args[0] === issueNumber && call.args[1] === label,
  );
  assert.deepStrictEqual(labelled, [], `Expected issue ${issueNumber} not to be labelled "${label}", but it was ${labelled.length} time(s)`);
});
