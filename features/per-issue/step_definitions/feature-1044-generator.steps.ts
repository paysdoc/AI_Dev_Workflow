/**
 * Step-definition scenarios of feature-1044: what the command the step-definition phase started the generator with tells the
 * step definitions of a repository whose ".adw/" is what "adw_init" writes. The generator finds its command in the worktree it
 * runs in, where worktree setup copies the framework's own command files, so these steps read the framework's file, in the
 * runner mode the generator was started in. The workflow is the scenario-proof scenarios' step; the phase and the record of the
 * generator's run are feature-992's.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { REPO_ROOT } from '../../../adws/core/config.ts';
import { parseMarkdownSections, sectionValue } from '../../../adws/core/markdownSections.ts';
import { requireApplicationProfile } from '../../../adws/phases/applicationTypeGate.ts';

import { SCENARIOS_MD } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { onlyGeneratorRun, startedWith } from '../../regression/step_definitions/feature-992-phase.steps.ts';
import { requireWorkflow } from '../../regression/step_definitions/feature-992-world.ts';

import { SCENARIO_RUN_CONTRACT, bulletAt } from './feature-1044-prompt.ts';

const COMMANDS_DIRECTORY = '.claude/commands';
const RUNNER_MODE = '## Runner mode';
const DEVICE_LIFE_CYCLE = 'never create, boot, shut down or delete';

const codeSpan = (text: string): string => `\`${text}\``;
const CONTRACT_HEADING = codeSpan(`## ${SCENARIO_RUN_CONTRACT}`);

/** The lines of a `## ` section of the command file, below its heading and up to the next one. */
function sectionOf(lines: readonly string[], heading: string, command: string): string[] {
  const start = lines.findIndex(line => line.trim() === heading);
  assert.ok(start >= 0, `Expected ${command} to have a "${heading}" section`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/**
 * The lines nested under the bullet of the runner mode the generator was started in: what that mode tells the step definitions
 * of a repository whose ".adw/scenarios.md" has the contract the bullet names. The worktree's must have it, or the note would
 * not apply to its step definitions.
 */
function deviceNote(): string[] {
  const run = onlyGeneratorRun();
  const [, , mode] = startedWith(run);
  const command = fs.readFileSync(path.join(REPO_ROOT, COMMANDS_DIRECTORY, `${run.command.slice(1)}.md`), 'utf-8').split('\n');
  const modes = sectionOf(command, RUNNER_MODE, run.command);
  const index = modes.findIndex(line => line.startsWith(`- ${codeSpan(mode)}`));
  assert.ok(index >= 0, `Expected the "${RUNNER_MODE}" of ${run.command} to say what the mode "${mode}" it was started in means`);
  const [modeLine, ...note] = bulletAt(modes, index);
  assert.ok(
    modeLine.includes(CONTRACT_HEADING),
    `Expected the mode "${mode}" of ${run.command} to say what it asks of a repository whose "${SCENARIOS_MD}" has a ${CONTRACT_HEADING}, but it says: ${modeLine}`,
  );
  const scenariosMd = fs.readFileSync(path.join(requireWorkflow().worktreePath, SCENARIOS_MD), 'utf-8');
  assert.ok(sectionValue(parseMarkdownSections(scenariosMd), SCENARIO_RUN_CONTRACT), `Expected the worktree's "${SCENARIOS_MD}" to have the ${CONTRACT_HEADING} that "adw_init" writes`);
  return note;
}

function assertNoteSays(says: (line: string) => boolean, what: string): void {
  const note = deviceNote();
  assert.ok(note.some(says), `Expected the command the step-definition generator was started with to tell the step definitions ${what}, but it tells them:\n${note.join('\n')}`);
}

Then(
  'the command the step-definition generator was started with tells the step definitions to drive the devices named by {string} and {string}',
  function (android: string, ios: string) {
    assertNoteSays(line => line.includes(codeSpan(android)) && line.includes(codeSpan(ios)) && line.includes('device'), `to drive the devices named by "${android}" and "${ios}"`);
  },
);

Then('the command the step-definition generator was started with tells the step definitions never to create, boot, shut down or delete a device', function () {
  assertNoteSays(line => line.toLowerCase().includes(DEVICE_LIFE_CYCLE), 'never to create, boot, shut down or delete a device');
});

Then(
  'the command the step-definition generator was started with tells the step definitions to write each screenshot under {string} or {string} in {string}',
  function (first: string, second: string, variable: string) {
    const platformDirectories = requireApplicationProfile(requireWorkflow().config).platforms.map(platform => `${platform}/`);
    assert.deepStrictEqual(
      [first, second].sort(),
      [...platformDirectories].sort(),
      `ADW reads the platform of an image from its first directory under "${variable}", which names a platform of the profile`,
    );
    assertNoteSays(
      line => /screenshot/i.test(line) && [variable, first, second].every(name => line.includes(codeSpan(name))),
      `to write each screenshot under "${first}" or "${second}" in "${variable}"`,
    );
  },
);
