/**
 * Scenario-proof scenarios of feature-1043: the step definitions a worktree holds, in the file the scenario names, and the
 * notice the scenario proof writes when it finds none where ".adw/scenarios.md" says to look. The scenario test phase itself
 * runs with feature-992's steps, over the workflow and the ".adw/" they describe.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';

import { SCENARIOS_MD, scenarioDirectoryOf } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { requireProof, requireWorkflow, s as adwWorld } from '../../regression/step_definitions/feature-992-world.ts';
import { writeFeature, writeFile } from '../../regression/step_definitions/feature-992-worktree.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

Given(
  'the worktree holds a feature tagged {string} in the scenario directory {string} names, and steps for it in the file {string}',
  function (tag: string, file: string, stepFile: string) {
    assert.strictEqual(file, SCENARIOS_MD, `The scenario directory is the one "${SCENARIOS_MD}" names`);
    assert.ok(adwWorld.adwFiles, 'Expected a workflow whose ".adw/" the scenario describes to have been set up first');
    const { worktreePath } = requireWorkflow();
    const scenario = { name: `The scenario of ${tag}`, steps: ['Given the application is running'] };
    writeFeature(worktreePath, scenarioDirectoryOf(adwWorld.adwFiles), tag, [scenario]);
    writeFile(worktreePath, stepFile, `// The step definitions of the scenarios tagged ${tag}.\n`);
  },
);

Then('the scenario proof notes that no step definition file was found in {string}', function (this: RegressionWorld, directory: string) {
  const document = fs.readFileSync(requireProof(this).resultsFilePath, 'utf-8');
  assert.ok(
    document.includes(`No step definition files found in ${directory}`),
    `Expected the scenario proof to note that no step definition file was found in "${directory}", got:\n${document}`,
  );
});
