/**
 * Upgrade scenarios of feature-992. They drive feature-931's harness: the real `executeUpgrade` over a throwaway target
 * repository, with a stubbed "/adw_init" agent, and with the stand-in `npm` and `npx` of feature-992-standins.ts first on
 * `PATH` while the upgrade installs ADW's Playwright project. The upgrade's own steps ("a target repository ...", "the
 * framework upgrade regenerates ...", "the upgrade commits ...") and the agent's ("... writes a complete ADW configuration
 * whose ...") are not defined again.
 */

import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { ADW_PLAYWRIGHT_PROJECT_FILES, ADW_PLAYWRIGHT_TEMPLATE_DIR } from '../../../adws/core/adwPlaywrightProject.ts';
import { REPO_ROOT } from '../../../adws/core/config.ts';
import { REQUIRED_ADW_FILES } from '../../../adws/phases/worktreeSetup.ts';
import { adoptFixtureFramework } from '../../regression/step_definitions/feature-537.steps.ts';

import { commitAll, configureAdwInitAgent, createTargetRepo, git, regenCommitFile, upgradeWorld } from './feature-931.steps.ts';
import { assertProjectMdFile, projectMd } from './feature-991-project-md.ts';
import { commandMatches, ranIn } from './feature-992-calls.ts';
import { commandLine, recordedCalls } from './feature-992-standins.ts';
import { registerDirectory, s } from './feature-992-world.ts';
import { ownFileContent } from './feature-992-own-files.ts';

const MANIFESTS: Readonly<Record<string, string>> = {
  'package.json': '{ "name": "adw-992-target", "version": "0.0.0" }\n',
  'pyproject.toml': '[project]\nname = "adw-992-target"\nversion = "0.0.0"\n',
};

const CONFIG_TEMPLATE = 'playwright.config.ts.template';

function repoDir(): string {
  const { repoDir: dir } = upgradeWorld();
  assert.ok(dir, 'Expected a target repository to have been prepared first');
  return dir;
}

function contentAt(revision: string, file: string): Buffer {
  return execFileSync('git', ['show', `${revision}:${file}`], { cwd: repoDir(), stdio: ['ignore', 'pipe', 'pipe'] });
}

function regenCommitFiles(): string[] {
  return git(repoDir(), 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
}

function assertUnchanged(file: string, expected?: string): void {
  const before = contentAt(upgradeWorld().headBefore, file);
  assert.ok(contentAt('HEAD', file).equals(before), `Expected the regen commit to leave "${file}" as the default branch has it`);
  if (expected !== undefined) assert.strictEqual(before.toString('utf-8'), expected, `Expected the default branch to hold the repository's own "${file}"`);
}

function packagesNamedBy(manifest: string): string[] {
  const { dependencies, devDependencies } = JSON.parse(manifest) as Record<'dependencies' | 'devDependencies', Record<string, string> | undefined>;
  return Object.keys({ ...dependencies, ...devDependencies }).sort();
}

Given('a target repository never initialised by ADW whose only manifest is {string}', function (manifest: string) {
  const content = MANIFESTS[manifest];
  assert.ok(content !== undefined, `This harness writes no "${manifest}" for a target repository`);
  createTargetRepo(false, { file: manifest, content });
});

Given("the target repository's default branch has these files of its own:", function (table: DataTable) {
  const files = table.hashes().map(row => row.file);
  const own = Object.fromEntries(files.map(file => [file, ownFileContent(file)]));
  for (const [file, content] of Object.entries(own)) {
    const target = path.join(repoDir(), file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  commitAll(repoDir(), 'chore: add the repository\'s own files');
  s.ownFiles = own;
});

Given(
  'the {string} agent writes an ADW configuration with no {string}, whose {string} declares the application type {string}',
  function (command: string, absentFile: string, file: string, applicationType: string) {
    assertProjectMdFile(file);
    const written = REQUIRED_ADW_FILES.map(name => `.adw/${name}`);
    assert.ok(!written.includes(absentFile), `The stubbed "${command}" agent writes "${absentFile}", contradicting the scenario: ${written.join(', ')}`);
    configureAdwInitAgent(command, projectMd(applicationType));
  },
);

Then("the regen commit's {string} is byte-identical to ADW's Playwright configuration template", function (file: string) {
  const row = ADW_PLAYWRIGHT_PROJECT_FILES.find(({ target }) => target === file);
  assert.strictEqual(row?.template, CONFIG_TEMPLATE, `"${file}" is not the file ADW writes from its Playwright configuration template`);
  const template = fs.readFileSync(path.join(REPO_ROOT, ADW_PLAYWRIGHT_TEMPLATE_DIR, CONFIG_TEMPLATE));
  assert.ok(contentAt('HEAD', file).equals(template), `Expected the regen commit's "${file}" to hold the template's bytes`);
});

Then("the regen commit's {string} depends on {string} and {string}", function (file: string, first: string, second: string) {
  const named = packagesNamedBy(regenCommitFile(file));
  assert.deepStrictEqual([first, second].filter(name => !named.includes(name)), [], `Expected the regen commit's "${file}" to depend on "${first}" and "${second}", but it names: ${named.join(', ')}`);
});

Then('the upgrade installed the packages {string} names, and the Playwright browser, in {string}', function (manifest: string, directory: string) {
  const named = packagesNamedBy(regenCommitFile(manifest));
  assert.ok(named.length > 0, `Expected "${manifest}" to name packages`);
  const calls = recordedCalls().filter(call => ranIn(call, path.join(repoDir(), directory)));
  const installIndex = calls.findIndex(call => commandMatches(call, 'npm install'));
  assert.ok(installIndex !== -1, `Expected "npm install" to have run in "${directory}", but the stand-ins recorded: ${JSON.stringify(calls.map(commandLine))}`);
  assert.deepStrictEqual([...calls[installIndex].packages].sort(), named, `Expected "npm install" to find the packages "${manifest}" names`);
  const browserIndex = calls.findIndex(call => commandMatches(call, 'npx playwright install'));
  assert.ok(browserIndex > installIndex, `Expected "npx playwright install" to have run in "${directory}" after "npm install", but the stand-ins recorded: ${JSON.stringify(calls.map(commandLine))}`);
});

Then('the upgrade installed nothing in {string}', function (directory: string) {
  const calls = recordedCalls().filter(call => ranIn(call, path.join(repoDir(), directory)));
  assert.deepStrictEqual(calls.map(commandLine), [], `Expected the upgrade to install nothing in "${directory}"`);
  assert.ok(!fs.existsSync(path.join(repoDir(), directory, 'node_modules')), `Expected no "node_modules" in "${directory}"`);
});

Then('the regen commit holds nothing under {string}', function (directory: string) {
  assert.deepStrictEqual(regenCommitFiles().filter(file => file.startsWith(directory)), [], `Expected the regen commit to hold nothing under "${directory}"`);
});

Then('the regen commit holds no {string}', function (file: string) {
  assert.ok(!regenCommitFiles().includes(file), `Expected the regen commit to hold no "${file}"`);
});

Then('the regen commit leaves {string} as the default branch has it', function (file: string) {
  assertUnchanged(file);
});

Then('the regen commit leaves each of those files as the default branch has it', function () {
  const owned = Object.entries(s.ownFiles);
  assert.ok(owned.length > 0, "Expected the scenario to have given the repository files of its own");
  owned.forEach(([file, content]) => assertUnchanged(file, content));
});

Given('a fixture framework copied from the ADW framework under test', function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-992-framework-'));
  registerDirectory(root);
  for (const directory of ['.claude/commands', 'templates']) {
    fs.cpSync(path.join(REPO_ROOT, directory), path.join(root, directory), { recursive: true });
  }
  s.fixtureFramework = root;
  adoptFixtureFramework(root);
});

When("ADW's Playwright configuration template in the fixture framework is modified by a single byte", function () {
  assert.ok(s.fixtureFramework, 'Expected a fixture framework to have been copied first');
  const template = path.join(s.fixtureFramework, ADW_PLAYWRIGHT_TEMPLATE_DIR, CONFIG_TEMPLATE);
  const modified = Buffer.from(fs.readFileSync(template));
  modified[0] = modified[0] ^ 0xff;
  fs.writeFileSync(template, modified);
});
