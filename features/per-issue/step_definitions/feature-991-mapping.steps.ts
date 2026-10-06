/**
 * Mapping and configuration scenarios of feature-991. The mapping scenarios call `resolveApplicationType` directly and
 * read what it answers; the configuration scenarios call `loadProjectConfig` over a throwaway repository, or over ADW's
 * own checkout.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  EvidenceKind,
  RunnerMode,
  resolveApplicationType,
  type ApplicationProfile,
  type ApplicationTypeResolution,
} from '../../../adws/core/applicationType.ts';
import { REPO_ROOT } from '../../../adws/core/config.ts';
import { loadProjectConfig, type ProjectConfig } from '../../../adws/core/projectConfig.ts';

import { s as sharedWorld } from './feature-988-world.ts';
import { assertApplicationTypeSection, assertProjectMdFile, projectMd } from './feature-991-project-md.ts';
import { s } from './feature-991-world.ts';

const SCENARIOS_MD = '.adw/scenarios.md';
const ADW_DIRECTORY = '.adw/';

type Parked = Extract<ApplicationTypeResolution, { kind: 'park' }>;

function latestConsultation(): ApplicationTypeResolution {
  const latest = s.consultations[s.consultations.length - 1];
  assert.ok(latest, 'Expected the application-type mapping to have been consulted first');
  return latest;
}

function profileOf(resolution: ApplicationTypeResolution): ApplicationProfile {
  if (resolution.kind !== 'known') {
    assert.fail(`Expected the mapping to know the application type, but it decides to park the issue (found ${JSON.stringify(resolution.evidence.found)})`);
  }
  return resolution.profile;
}

function requireParked(): Parked {
  const resolution = latestConsultation();
  if (resolution.kind !== 'park') {
    assert.fail(`Expected the mapping to decide to park the issue, but it chose the profile ${JSON.stringify(resolution.profile)}`);
  }
  return resolution;
}

function requireProjectConfig(): ProjectConfig {
  assert.ok(s.projectConfig, "Expected a repository's project configuration to have been read first");
  return s.projectConfig;
}

function makeRepository(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-991-repository-'));
  sharedWorld.directories.push(directory);
  s.repositoryDir = directory;
  return directory;
}

function requireRepository(): string {
  assert.ok(s.repositoryDir, 'Expected a repository to have been set up first');
  return s.repositoryDir;
}

When('the application-type mapping is consulted for the application type {string}', function (declared: string) {
  s.consultations.push(resolveApplicationType(declared));
});

When('the application-type mapping is consulted with no application type', function () {
  s.consultations.push(resolveApplicationType(null));
});

When("the application-type mapping is consulted with that repository's application type", function () {
  s.consultations.push(resolveApplicationType(requireProjectConfig().applicationType));
});

Then('the mapping chooses the scenario runner that {string} describes', function (file: string) {
  assert.strictEqual(file, SCENARIOS_MD, `The descriptor runner is the one "${SCENARIOS_MD}" describes`);
  const { runnerMode } = profileOf(latestConsultation());
  assert.strictEqual(runnerMode, RunnerMode.Descriptor, `Expected the mapping to choose the runner that "${SCENARIOS_MD}" describes, but it chose "${runnerMode}"`);
});

Then("the mapping chooses ADW's Playwright project as the scenario runner", function () {
  const { runnerMode } = profileOf(latestConsultation());
  assert.strictEqual(runnerMode, RunnerMode.AdwPlaywright, `Expected the mapping to choose ADW's Playwright project, but it chose "${runnerMode}"`);
});

Then('the mapping asks for no image as evidence', function () {
  const { evidenceKinds } = profileOf(latestConsultation());
  assert.deepStrictEqual([...evidenceKinds], [], `Expected the mapping to ask for no image, but it asks for: ${evidenceKinds.join(', ')}`);
});

Then('the mapping asks for an image of each per-issue scenario as evidence', function () {
  const { evidenceKinds } = profileOf(latestConsultation());
  assert.deepStrictEqual([...evidenceKinds], [EvidenceKind.PerIssueImages], `Expected the mapping to ask for an image of each per-issue scenario, but it asks for: ${evidenceKinds.join(', ') || 'no image'}`);
});

Then('each of those consultations chose a review guidance section, and no two chose the same one', function () {
  assert.ok(s.consultations.length > 1, `Expected at least two consultations, got ${s.consultations.length}`);
  const sections = s.consultations.map(resolution => profileOf(resolution).reviewGuidanceSection);
  sections.forEach(section => assert.notStrictEqual(section.trim(), '', 'Expected every consultation to choose a review guidance section'));
  assert.strictEqual(new Set(sections).size, sections.length, `Expected no two consultations to choose the same review guidance section, got: ${sections.join(' | ')}`);
});

Then('the mapping decides to park the issue for the reason {string}', function (reason: string) {
  assert.strictEqual(requireParked().evidence.reason, reason, `Expected the mapping to decide to park the issue for the reason "${reason}"`);
});

Then('the park records that no application type was found', function () {
  assert.strictEqual(requireParked().evidence.found, null, 'Expected the park to record that no application type was found');
});

Then('the park records that the application type {string} was found', function (declared: string) {
  assert.strictEqual(requireParked().evidence.found, declared, `Expected the park to record the application type "${declared}" as it was written`);
});

Given('a repository whose {string} has no {string} section', function (file: string, section: string) {
  assertProjectMdFile(file);
  assertApplicationTypeSection(section);
  const directory = makeRepository();
  fs.mkdirSync(path.join(directory, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(directory, file), projectMd(null), 'utf-8');
});

Given('a repository that has no {string} directory', function (directory: string) {
  assert.strictEqual(directory, ADW_DIRECTORY, `The directory ADW configures a repository in is "${ADW_DIRECTORY}"`);
  makeRepository();
});

When("ADW reads the repository's project configuration", function () {
  s.projectConfig = loadProjectConfig(requireRepository());
});

When('ADW reads the project configuration of its own repository', function () {
  s.projectConfig = loadProjectConfig(REPO_ROOT);
});

Then('the project configuration names no application type', function () {
  assert.strictEqual(requireProjectConfig().applicationType, null, 'Expected the project configuration to name no application type');
});

Then('the project configuration names the application type {string}', function (declared: string) {
  assert.strictEqual(requireProjectConfig().applicationType, declared, `Expected the project configuration to name the application type "${declared}"`);
});
