/**
 * Steps of the feature-995 scenario about a ".adw/review_proof.md" left in a repository: two scratch repositories whose ".adw/"
 * hold the same complete configuration, one of them also the leftover file, and the project configuration ADW reads from each.
 * ".adw/" is complete when it holds the five files `adw_init` writes, so that every file ADW reads is there to be read.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { loadProjectConfig } from '../../../adws/core/projectConfig.ts';

import { ADW_DIRECTORY, freshAdwFiles, writeAdwFiles } from './feature-992-adw-files.ts';
import { makeDirectory, s } from './feature-995-world.ts';

const PROVIDERS_MD = '# ADW Providers\n\n## Code Host\ngithub\n\n## Issue Tracker\ngithub\n';
const CONDITIONAL_DOCS_MD = '# Conditional Documentation\n\n- app_docs/feature-cart.md\n  - Owns:\n    - src/cart/**\n  - Conditions:\n    - When working on the cart\n';

function makeRepository(): string {
  const repository = makeDirectory('adw-995-repository-');
  writeAdwFiles(repository, freshAdwFiles('cli'));
  fs.writeFileSync(path.join(repository, ADW_DIRECTORY, 'providers.md'), PROVIDERS_MD);
  fs.writeFileSync(path.join(repository, ADW_DIRECTORY, 'conditional_docs.md'), CONDITIONAL_DOCS_MD);
  s.repositories.push(repository);
  return repository;
}

Given('a repository whose {string} holds a complete ADW configuration', function (directory: string) {
  assert.strictEqual(directory, ADW_DIRECTORY, `The configuration of a repository is kept in "${ADW_DIRECTORY}"`);
  makeRepository();
});

Given('a second repository whose {string} holds the same configuration and also a {string} that reads:', function (directory: string, file: string, text: string) {
  assert.strictEqual(directory, ADW_DIRECTORY, `The configuration of a repository is kept in "${ADW_DIRECTORY}"`);
  const repository = makeRepository();
  fs.writeFileSync(path.join(repository, file), `${text}\n`);
});

When('ADW reads the project configuration of each repository', function () {
  assert.strictEqual(s.repositories.length, 2, 'Expected the scenario to have described two repositories');
  s.configs = s.repositories.map(repository => loadProjectConfig(repository));
  s.configs.forEach((config, index) => assert.ok(config.hasAdwDir, `Expected ADW to find the ".adw/" of repository ${index + 1}`));
});

Then('ADW read the same project configuration from both repositories', function () {
  const [withoutLeftover, withLeftover] = s.configs;
  assert.ok(withoutLeftover && withLeftover, 'Expected ADW to have read the project configuration of both repositories');
  assert.deepStrictEqual(withLeftover, withoutLeftover);
});
