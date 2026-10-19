/**
 * The ".adw/" a feature-992 workflow's worktree holds. Several steps of a scenario each say one thing about it (the type, the
 * dev server, the scenario command), so they build one model, which is written out once, as `adw_init` would have written it,
 * just before the phase runs.
 */

import * as fs from 'fs';
import * as path from 'path';

import { ADW_PLAYWRIGHT_RUN_BY_TAG, ADW_PLAYWRIGHT_STEP_DEF_DIR } from '../../../adws/core/adwPlaywrightProject.ts';
import { DEVICE_SOURCE_SECTION_TITLES, type DeviceSource } from '../../../adws/core/deviceSourceConfig.ts';
import { declaredApplicationProfile } from '../../../adws/phases/applicationTypeGate.ts';

import { projectMd } from './feature-991-project-md.ts';

export const COMMANDS_MD = '.adw/commands.md';
export const SCENARIOS_MD = '.adw/scenarios.md';
export const ADW_DIRECTORY = '.adw/';

const SCENARIO_DIRECTORY = 'Scenario Directory';
const INSTALL_DEPENDENCIES = 'Install Dependencies';
const START_DEV_SERVER = 'Start Dev Server';
const HEALTH_CHECK_PATH = 'Health Check Path';
const RUN_BY_TAG = 'Run Scenarios by Tag';
const BDD_FRAMEWORK = 'BDD Framework';
const STEP_DEF_DIRECTORY = 'Step Def Directory';

/** Sample values of the fixture: the defaults `adw_init` writes for these sections are its own. */
export const SAMPLE_DEVICE_SOURCE: DeviceSource = {
  androidSystemImage: 'system-images;android-35;google_apis;arm64-v8a',
  androidDeviceProfile: 'pixel_8',
  iosDeviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
  iosRuntime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
};

const DEVICE_SOURCE_KEYS = Object.keys(DEVICE_SOURCE_SECTION_TITLES) as Array<keyof DeviceSource>;

export interface AdwFiles {
  readonly applicationType: string;
  /** The sections of ".adw/project.md" beside the application type, by heading. */
  readonly project: Map<string, string>;
  readonly commands: Map<string, string>;
  readonly scenarios: Map<string, string>;
}

function hasPlatforms(applicationType: string): boolean {
  return (declaredApplicationProfile({ applicationType })?.platforms.length ?? 0) > 0;
}

/** What `adw_init` writes for a repository of the type, before a scenario says anything more. */
export function freshAdwFiles(applicationType: string): AdwFiles {
  const web = applicationType === 'web';
  const files: AdwFiles = {
    applicationType,
    project: new Map(),
    commands: new Map([
      [START_DEV_SERVER, 'N/A'],
      [HEALTH_CHECK_PATH, '/'],
      [RUN_BY_TAG, web ? ADW_PLAYWRIGHT_RUN_BY_TAG : 'N/A'],
    ]),
    scenarios: new Map([
      [SCENARIO_DIRECTORY, 'features/'],
      [RUN_BY_TAG, web ? ADW_PLAYWRIGHT_RUN_BY_TAG : 'N/A'],
      [BDD_FRAMEWORK, web ? 'playwright-bdd' : 'cucumber-js'],
      [STEP_DEF_DIRECTORY, web ? ADW_PLAYWRIGHT_STEP_DEF_DIR : 'features/step_definitions'],
    ]),
  };
  if (hasPlatforms(applicationType)) setEveryDeviceSource(files);
  return files;
}

export function setProjectSection(files: AdwFiles, heading: string, body: string): void {
  files.project.set(heading, body);
}

export function removeProjectSection(files: AdwFiles, heading: string): void {
  files.project.delete(heading);
}

/** Whatever the type: the owner writes the sections, and a `cli` or `web` repository may hold them and ignore them. */
export function setEveryDeviceSource(files: AdwFiles): void {
  DEVICE_SOURCE_KEYS.forEach(key => setProjectSection(files, DEVICE_SOURCE_SECTION_TITLES[key], SAMPLE_DEVICE_SOURCE[key]));
}

export function setNoDeviceSource(files: AdwFiles): void {
  DEVICE_SOURCE_KEYS.forEach(key => removeProjectSection(files, DEVICE_SOURCE_SECTION_TITLES[key]));
}

/** A section left out reads as the default, `bun install`, which a checkout that something other than Bun runs has no use for. */
export function setInstallDependencies(files: AdwFiles, command: string): void {
  files.commands.set(INSTALL_DEPENDENCIES, command);
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

/** The directory ".adw/scenarios.md" names for feature files. */
export function scenarioDirectoryOf(files: AdwFiles): string {
  return files.scenarios.get(SCENARIO_DIRECTORY) ?? '';
}

/** The directory ".adw/scenarios.md" names for step definitions, with a trailing slash. */
export function stepDefDirectoryOf(files: AdwFiles): string {
  const directory = files.scenarios.get(STEP_DEF_DIRECTORY) ?? '';
  return directory.endsWith('/') ? directory : `${directory}/`;
}

function render(title: string, sections: ReadonlyMap<string, string>): string {
  return `${[`# ${title}`, ...[...sections].map(([heading, body]) => `## ${heading}\n${body}`)].join('\n\n')}\n`;
}

/** The description with the application type, followed by the sections `project` holds: none for a `cli` or `web` repository until a step names some. */
export function renderProjectMd(files: Pick<AdwFiles, 'applicationType' | 'project'>): string {
  const sections = [...files.project].map(([heading, body]) => `## ${heading}\n${body}\n`);
  return [projectMd(files.applicationType), ...sections].join('\n');
}

/** The files by path from the repository's root, with the content `adw_init` would have written. */
export function renderAdwFiles(files: AdwFiles): Readonly<Record<string, string>> {
  return {
    [`${ADW_DIRECTORY}project.md`]: renderProjectMd(files),
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
