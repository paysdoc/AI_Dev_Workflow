/**
 * Framework scenarios of feature-1044: a command of the fixture framework (copied from the framework under test by
 * feature-992, hashed by feature-537's steps) that a scenario edits, and the worktree the upgrade runs the "/adw_init" agent in
 * (the upgrade and its stubbed agent are feature-931's).
 */

import { Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { initRunsIn } from '../../regression/step_definitions/feature-931-init-runs.ts';
import { git, upgradeWorld } from '../../regression/step_definitions/feature-931.steps.ts';
import { s as framework } from '../../regression/step_definitions/feature-992-world.ts';

const COMMANDS_DIRECTORY = '.claude/commands';
const FRONTMATTER_FENCE = '---';
const EDIT = 'Edited by the scenario, below the frontmatter.';

/** The index of the first line below the frontmatter. */
function bodyStart(lines: readonly string[], file: string): number {
  assert.strictEqual(lines[0], FRONTMATTER_FENCE, `Expected "${file}" to open with frontmatter`);
  const closing = lines.findIndex((line, index) => index > 0 && line === FRONTMATTER_FENCE);
  assert.ok(closing > 0, `Expected the frontmatter of "${file}" to close`);
  return closing + 1;
}

When('the {string} command in the fixture framework is edited below its frontmatter', function (command: string) {
  assert.ok(framework.fixtureFramework, 'Expected a fixture framework to have been copied first');
  const file = path.join(framework.fixtureFramework, COMMANDS_DIRECTORY, `${command.replace(/^\//, '')}.md`);
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  lines.splice(bodyStart(lines, file), 0, EDIT);
  fs.writeFileSync(file, lines.join('\n'));
});

Then("the {string} agent ran in a worktree whose {string} was the default branch's", function (command: string, file: string) {
  const { agent, repoDir, headBefore } = upgradeWorld();
  assert.strictEqual(agent?.command, command, `Expected the scenario to have configured the "${command}" agent`);
  const runs = initRunsIn(repoDir);
  assert.strictEqual(runs.length, 1, `Expected the "${command}" agent to have run once, but it ran ${runs.length} times`);

  const onDefaultBranch = git(repoDir, 'show', `${headBefore}:${file}`);
  assert.strictEqual(runs[0][file], onDefaultBranch, `Expected "${file}" in the worktree of the "${command}" agent to be the default branch's`);
});
