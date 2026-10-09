/**
 * What the feature-992 scenarios put in a workflow's worktree: the scenario files of an issue, the step definitions for them,
 * and ADW's Playwright project as a checkout of a regen commit holds it.
 */

import * as fs from 'fs';
import * as path from 'path';

import { ADW_PLAYWRIGHT_PROJECT_DIR, syncAdwPlaywrightProject } from '../../../adws/core/adwPlaywrightProject.ts';
import { REPO_ROOT } from '../../../adws/core/config.ts';

export interface ScenarioSource {
  readonly name: string;
  /** Gherkin step lines, each with its keyword. */
  readonly steps: readonly string[];
}

export function writeFile(root: string, relativePath: string, content: string): void {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fileNameOf(tag: string): string {
  return tag.replace(/^@/, '');
}

export function featureSource(tag: string, scenarios: readonly ScenarioSource[]): string {
  const blocks = scenarios.map(({ name, steps }) => [`  Scenario: ${name}`, ...steps.map(step => `    ${step}`)].join('\n'));
  return [tag, `Feature: The scenarios tagged ${tag}`, '', ...blocks.flatMap(block => [block, ''])].join('\n');
}

export function writeFeature(worktreePath: string, directory: string, tag: string, scenarios: readonly ScenarioSource[]): void {
  writeFile(worktreePath, path.join(directory, `${fileNameOf(tag)}.feature`), featureSource(tag, scenarios));
}

export function writeStepFile(worktreePath: string, directory: string, tag: string, content: string): void {
  writeFile(worktreePath, path.join(directory, `${fileNameOf(tag)}.steps.ts`), content);
}

/** The scenario a stand-in run reports for a tag: a feature of one scenario whose one step needs no steps of its own. */
export function writeStandInScenario(worktreePath: string, featureDirectory: string, stepDirectory: string, tag: string): void {
  writeFeature(worktreePath, featureDirectory, tag, [{ name: `The scenario of ${tag}`, steps: ['Given the application is running'] }]);
  writeStepFile(worktreePath, stepDirectory, tag, `// The step definitions of the scenarios tagged ${tag}.\n`);
}

/** ADW's Playwright project as a worktree checked out from a regen commit holds it: its files and its lockfile, and no `node_modules`. */
export function writeWebProject(worktreePath: string): void {
  syncAdwPlaywrightProject(worktreePath, REPO_ROOT);
  const manifestFile = path.join(worktreePath, ADW_PLAYWRIGHT_PROJECT_DIR, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as { name: string; devDependencies: Record<string, string> };
  const lock = {
    name: manifest.name,
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: manifest.name, devDependencies: manifest.devDependencies } },
  };
  writeFile(worktreePath, path.join(ADW_PLAYWRIGHT_PROJECT_DIR, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
}
