/**
 * Upgrade scenarios of feature-991. They drive feature-931's harness: the real `executeUpgrade` over a throwaway target
 * repository, with a stubbed "/adw_init" agent. Here the stub writes the ".adw/project.md" the scenario names, and the
 * scenario reads what the regen commit holds through the parser ADW reads a repository with. The upgrade's own steps
 * ("a target repository ...", "the framework upgrade regenerates ...", "the upgrade commits ...") are not defined again.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { parseApplicationType } from '../../../adws/core/projectConfig.ts';

import { configureAdwInitAgent, regenCommitFile } from './feature-931.steps.ts';
import { assertApplicationTypeSection, assertProjectMdFile, projectMd } from './feature-991-project-md.ts';

Given(
  'the {string} agent writes a complete ADW configuration whose {string} declares the application type {string}',
  function (command: string, file: string, applicationType: string) {
    assertProjectMdFile(file);
    configureAdwInitAgent(command, projectMd(applicationType));
  },
);

Given(
  'the {string} agent writes a complete ADW configuration whose {string} has no {string} section',
  function (command: string, file: string, section: string) {
    assertProjectMdFile(file);
    assertApplicationTypeSection(section);
    configureAdwInitAgent(command, projectMd(null));
  },
);

Then("ADW reads the application type {string} from the regen commit's {string}", function (applicationType: string, file: string) {
  assert.strictEqual(
    parseApplicationType(regenCommitFile(file)),
    applicationType,
    `Expected ADW to read the application type "${applicationType}" from the regen commit's "${file}"`,
  );
});

Then("ADW reads no application type from the regen commit's {string}", function (file: string) {
  assert.strictEqual(
    parseApplicationType(regenCommitFile(file)),
    null,
    `Expected ADW to read no application type from the regen commit's "${file}"`,
  );
});
