/**
 * Pure. The directories a target's `.adw/scenarios.md` names for its Per-Issue Scenarios, its Regression Suite and its step
 * definitions, normalised to repository-relative paths with `/` separators and no trailing slash.
 */

import * as path from 'path';
import type { ScenariosConfig } from './projectConfig';

export const DEFAULT_PER_ISSUE_SCENARIO_DIRECTORY = 'features/per-issue';
export const DEFAULT_REGRESSION_SCENARIO_DIRECTORY = 'features/regression';
export const PER_ISSUE_STEP_DEFINITIONS_SUBDIRECTORY = 'step_definitions';

export interface ScenarioDirectories {
  readonly perIssue: string;
  readonly regression: string;
  /** The configured `## Step Def Directory`, then the per-issue directory's own `step_definitions`, each once. */
  readonly stepDefinitions: readonly string[];
}

const WINDOWS_DRIVE = /^[A-Za-z]:\//;

/** '' for an empty value, the repository root, an absolute path or one that leaves the repository. */
export function normalizeRepoDirectory(value: string): string {
  const slashed = value.trim().replace(/\\/g, '/');
  if (slashed === '' || slashed.startsWith('/') || WINDOWS_DRIVE.test(slashed)) return '';
  const normalized = path.posix.normalize(slashed).replace(/\/+$/, '');
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return '';
  return normalized;
}

function directoryOr(value: string | undefined, fallback: string): string {
  return normalizeRepoDirectory(value ?? '') || fallback;
}

export function resolveScenarioDirectories(
  scenarios: Pick<ScenariosConfig, 'perIssueScenarioDirectory' | 'regressionScenarioDirectory' | 'stepDefDirectory'>,
): ScenarioDirectories {
  const perIssue = directoryOr(scenarios.perIssueScenarioDirectory, DEFAULT_PER_ISSUE_SCENARIO_DIRECTORY);
  const regression = directoryOr(scenarios.regressionScenarioDirectory, DEFAULT_REGRESSION_SCENARIO_DIRECTORY);
  const candidates = [normalizeRepoDirectory(scenarios.stepDefDirectory), `${perIssue}/${PER_ISSUE_STEP_DEFINITIONS_SUBDIRECTORY}`];
  const stepDefinitions = candidates.filter((directory, index) => directory !== '' && candidates.indexOf(directory) === index);
  return { perIssue, regression, stepDefinitions };
}

/** True for the directory itself and every path under it; never for a sibling sharing its prefix, nor for ''. */
export function isWithinDirectory(file: string, directory: string): boolean {
  if (directory === '') return false;
  return file === directory || file.startsWith(`${directory}/`);
}
