/**
 * Configuration and resolver scenarios of feature-1045. A repository's ".adw/project.md" is written from the fixture of
 * feature-992, which models the sections of that file; ADW reads it with feature-991's step, which runs the real
 * `loadProjectConfig` over the throwaway repository. The resolver scenarios call `resolveDeviceSource` over what it read.
 */

import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { resolveDeviceSource, type DeviceSourceResolution } from '../../../adws/core/deviceSourceConfig.ts';
import { declaredApplicationProfile } from '../../../adws/phases/applicationTypeGate.ts';

import { PROJECT_MD, assertProjectMdFile } from '../../regression/step_definitions/feature-991-project-md.ts';
import {
  freshAdwFiles,
  removeProjectSection,
  renderProjectMd,
  setEveryDeviceSource,
  setNoDeviceSource,
  setProjectSection,
  type AdwFiles,
} from '../../regression/step_definitions/feature-992-adw-files.ts';
import { makeRepository, requireProjectConfig } from './feature-991-mapping.steps.ts';
import { s, requireResolution } from './feature-1045-world.ts';
import { assertDeviceSourceSection, titleOf, valuesOf } from './feature-1045-sections.ts';

type Missing = Extract<DeviceSourceResolution, { readonly kind: 'missing' }>;

function writeProjectMd(content: string): void {
  const file = path.join(makeRepository(), PROJECT_MD);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

/** The ".adw/project.md" of a repository of the type, which names the device sources `name` sets and no others. */
function projectMdNaming(applicationType: string, name: (files: AdwFiles) => void): string {
  const files = freshAdwFiles(applicationType);
  setNoDeviceSource(files);
  name(files);
  return renderProjectMd(files);
}

function requireMissing(): Missing {
  const resolution = requireResolution();
  if (resolution.kind !== 'missing') assert.fail(`Expected resolving the device sources to fail, but the resolution is ${JSON.stringify(resolution)}`);
  return resolution;
}

Given('a repository whose {string} holds:', function (file: string, content: string) {
  assertProjectMdFile(file);
  writeProjectMd(`${content}\n`);
});

Given(
  'a repository whose {string} declares the application type {string} and names these device sources:',
  function (file: string, applicationType: string, table: DataTable) {
    assertProjectMdFile(file);
    writeProjectMd(projectMdNaming(applicationType, files => table.hashes().forEach(({ section, value }) => setProjectSection(files, titleOf(section), value))));
  },
);

Given('a repository whose {string} declares the application type {string} and names no device source', function (file: string, applicationType: string) {
  assertProjectMdFile(file);
  writeProjectMd(projectMdNaming(applicationType, () => undefined));
});

Given(
  'a repository whose {string} declares the application type {string} and names every device source but {string}',
  function (file: string, applicationType: string, section: string) {
    assertProjectMdFile(file);
    writeProjectMd(
      projectMdNaming(applicationType, files => {
        setEveryDeviceSource(files);
        removeProjectSection(files, titleOf(section));
      }),
    );
  },
);

Then('the project configuration names these device sources, and no other:', function (table: DataTable) {
  assert.deepStrictEqual(requireProjectConfig().deviceSources, valuesOf(table), 'Expected the project configuration to name exactly these device sources');
});

Then('the project configuration names no device source', function () {
  assert.deepStrictEqual(
    requireProjectConfig().deviceSources,
    { androidSystemImage: null, androidDeviceProfile: null, iosDeviceType: null, iosRuntime: null },
    'Expected the project configuration to name no device source',
  );
});

When('the device sources are resolved from that project configuration', function () {
  const projectConfig = requireProjectConfig();
  const profile = declaredApplicationProfile(projectConfig);
  assert.ok(profile, `Expected the project configuration to declare an application type ADW knows, but it says ${JSON.stringify(projectConfig.applicationType)}`);
  s.resolution = resolveDeviceSource(projectConfig.deviceSources, profile.platforms);
});

Then('the device sources resolve to:', function (table: DataTable) {
  const resolution = requireResolution();
  if (resolution.kind !== 'resolved') assert.fail(`Expected the device sources to resolve, but the resolution is ${JSON.stringify(resolution)}`);
  assert.deepStrictEqual(resolution.deviceSource, valuesOf(table), 'Expected the device sources to resolve to exactly these');
});

Then('resolving the device sources fails with an error that names {string}', function (section: string) {
  const missing = requireMissing();
  assert.strictEqual(missing.section, section, `Expected the error to name the section "${section}"`);
  assert.ok(missing.message.includes(section), `Expected the message of the error to name "${section}", but it says: ${missing.message}`);
});

Then('that error does not name {string}', function (section: string) {
  assertDeviceSourceSection(section);
  const { message } = requireMissing();
  assert.ok(!message.includes(section), `Expected the message of the error not to name "${section}", but it says: ${message}`);
});
