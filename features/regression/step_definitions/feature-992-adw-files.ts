/**
 * The ".adw/" a feature-992 workflow's worktree holds. Several steps of a scenario each say one thing about it (the type, the
 * dev server, the scenario command), so they build one model, which is written out once, as `adw_init` would have written it,
 * just before the phase runs.
 */

import * as fs from 'fs';
import * as path from 'path';

import { ADW_PLAYWRIGHT_RUN_BY_TAG, ADW_PLAYWRIGHT_STEP_DEF_DIR } from '../../../adws/core/adwPlaywrightProject.ts';

import { projectMd } from './feature-991-project-md.ts';

export const COMMANDS_MD = '.adw/commands.md';
export const SCENARIOS_MD = '.adw/scenarios.md';
export const ADW_DIRECTORY = '.adw/';

const START_DEV_SERVER = 'Start Dev Server';
const HEALTH_CHECK_PATH = 'Health Check Path';
const RUN_BY_TAG = 'Run Scenarios by Tag';
const BDD_FRAMEWORK = 'BDD Framework';
const STEP_DEF_DIRECTORY = 'Step Def Directory';

export interface AdwFiles {
  readonly applicationType: string;
  readonly commands: Map<string, string>;
  readonly scenarios: Map<string, string>;
}

/** What `adw_init` writes for a repository of the type, before a scenario says anything more. */
export function freshAdwFiles(applicationType: string): AdwFiles {
  const web = applicationType === 'web';
  return {
    applicationType,
    commands: new Map([
      [START_DEV_SERVER, 'N/A'],
      [HEALTH_CHECK_PATH, '/'],
      [RUN_BY_TAG, web ? ADW_PLAYWRIGHT_RUN_BY_TAG : 'N/A'],
    ]),
    scenarios: new Map([
      ['Scenario Directory', 'features/'],
      [RUN_BY_TAG, web ? ADW_PLAYWRIGHT_RUN_BY_TAG : 'N/A'],
      [BDD_FRAMEWORK, web ? 'playwright-bdd' : 'cucumber-js'],
      [STEP_DEF_DIRECTORY, web ? ADW_PLAYWRIGHT_STEP_DEF_DIR : 'features/step_definitions'],
    ]),
  };
}

export function setStartDevServer(files: AdwFiles, command: string, healthCheckPath: string): void {
  files.commands.set(START_DEV_SERVER, command);
  files.commands.set(HEALTH_CHECK_PATH, healthCheckPath);
}

/** The command goes in both files, since `adw_init` writes it to both. */
export function setRunScenariosByTag(files: AdwFiles, command: string): void {
  files.commands.set(RUN_BY_TAG, command);
  files.scenarios.set(RUN_BY_TAG, command);
}

export function setBddFramework(files: AdwFiles, framework: string, stepDefDirectory: string): void {
  files.scenarios.set(BDD_FRAMEWORK, framework);
  files.scenarios.set(STEP_DEF_DIRECTORY, stepDefDirectory);
}

/** The directory ".adw/scenarios.md" names for step definitions, with a trailing slash. */
export function stepDefDirectoryOf(files: AdwFiles): string {
  const directory = files.scenarios.get(STEP_DEF_DIRECTORY) ?? '';
  return directory.endsWith('/') ? directory : `${directory}/`;
}

function render(title: string, sections: ReadonlyMap<string, string>): string {
  return `${[`# ${title}`, ...[...sections].map(([heading, body]) => `## ${heading}\n${body}`)].join('\n\n')}\n`;
}

/** The files by path from the repository's root, with the content `adw_init` would have written. */
export function renderAdwFiles(files: AdwFiles): Readonly<Record<string, string>> {
  return {
    [`${ADW_DIRECTORY}project.md`]: projectMd(files.applicationType),
    [COMMANDS_MD]: render('ADW Project Commands', files.commands),
    [SCENARIOS_MD]: render('ADW BDD Scenario Configuration', files.scenarios),
  };
}

export function writeAdwFiles(worktreePath: string, files: AdwFiles): void {
  for (const [relativePath, content] of Object.entries(renderAdwFiles(files))) {
    const file = path.join(worktreePath, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}
