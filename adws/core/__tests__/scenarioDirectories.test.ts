import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getDefaultScenariosConfig, parseScenariosMd, type ScenariosConfig } from '../projectConfig';
import {
  DEFAULT_PER_ISSUE_SCENARIO_DIRECTORY,
  DEFAULT_REGRESSION_SCENARIO_DIRECTORY,
  isWithinDirectory,
  normalizeRepoDirectory,
  resolveScenarioDirectories,
} from '../scenarioDirectories';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function configWith(overrides: Partial<ScenariosConfig>): ScenariosConfig {
  return { ...getDefaultScenariosConfig(), ...overrides };
}

describe('resolveScenarioDirectories', () => {
  it('uses the configured per-issue directory without its trailing slash', () => {
    expect(resolveScenarioDirectories(configWith({ perIssueScenarioDirectory: 'e2e/per-issue/' })).perIssue).toBe('e2e/per-issue');
  });

  it('falls back to features/per-issue when the per-issue directory is absent, empty, the repository root, absolute or outside the repository', () => {
    for (const perIssueScenarioDirectory of [undefined, '', '   ', '.', './', '/srv/repo/features/per-issue', 'C:\\repo\\per-issue', '../elsewhere/per-issue', 'features/../../per-issue']) {
      const directories = resolveScenarioDirectories(configWith({ perIssueScenarioDirectory }));
      expect(directories.perIssue, String(perIssueScenarioDirectory)).toBe(DEFAULT_PER_ISSUE_SCENARIO_DIRECTORY);
    }
    expect(DEFAULT_PER_ISSUE_SCENARIO_DIRECTORY).toBe('features/per-issue');
  });

  it('names the configured regression directory, or features/regression when it is absent', () => {
    expect(resolveScenarioDirectories(configWith({ regressionScenarioDirectory: 'e2e/regression/' })).regression).toBe('e2e/regression');
    expect(resolveScenarioDirectories(configWith({})).regression).toBe(DEFAULT_REGRESSION_SCENARIO_DIRECTORY);
    expect(DEFAULT_REGRESSION_SCENARIO_DIRECTORY).toBe('features/regression');
  });

  it("looks for step-definition files in the configured step-definition directory and in the per-issue directory's step_definitions, once each", () => {
    const elsewhere = resolveScenarioDirectories(configWith({ perIssueScenarioDirectory: 'e2e/per-issue/', stepDefDirectory: 'e2e/steps' }));
    expect(elsewhere.stepDefinitions).toEqual(['e2e/steps', 'e2e/per-issue/step_definitions']);

    const same = resolveScenarioDirectories(configWith({ perIssueScenarioDirectory: 'e2e/per-issue', stepDefDirectory: 'e2e/per-issue/step_definitions/' }));
    expect(same.stepDefinitions).toEqual(['e2e/per-issue/step_definitions']);

    const unusable = resolveScenarioDirectories(configWith({ stepDefDirectory: '/absolute/steps' }));
    expect(unusable.stepDefinitions).toEqual(['features/per-issue/step_definitions']);
  });

  it("resolves ADW's own scenario configuration to features/per-issue, features/step_definitions and features/per-issue/step_definitions", () => {
    const own = parseScenariosMd(readFileSync(join(REPO_ROOT, '.adw/scenarios.md'), 'utf-8'));

    expect(resolveScenarioDirectories(own)).toEqual({
      perIssue: 'features/per-issue',
      regression: 'features/regression',
      stepDefinitions: ['features/step_definitions', 'features/per-issue/step_definitions'],
    });
  });

  it('resolves the default configuration to exactly features/per-issue/step_definitions for the per-issue step definitions', () => {
    const directories = resolveScenarioDirectories(getDefaultScenariosConfig());

    expect(directories.perIssue).toBe('features/per-issue');
    expect(directories.stepDefinitions).toContain('features/per-issue/step_definitions');
    expect(directories.stepDefinitions).toEqual(['features/step_definitions', 'features/per-issue/step_definitions']);
  });

  it('normalises ./ prefixes, backslashes, duplicate slashes and trailing slashes on every directory', () => {
    const directories = resolveScenarioDirectories(
      configWith({ perIssueScenarioDirectory: './e2e//per-issue/', regressionScenarioDirectory: '.\\e2e\\regression\\', stepDefDirectory: ' ./e2e/./steps// ' }),
    );

    expect(directories).toEqual({ perIssue: 'e2e/per-issue', regression: 'e2e/regression', stepDefinitions: ['e2e/steps', 'e2e/per-issue/step_definitions'] });
    expect(normalizeRepoDirectory('features/per-issue')).toBe('features/per-issue');
    expect(normalizeRepoDirectory('..')).toBe('');
  });
});

describe('isWithinDirectory', () => {
  it('isWithinDirectory holds for the directory and every file under it, never for a sibling directory sharing its prefix or an empty directory', () => {
    expect(isWithinDirectory('features/steps', 'features/steps')).toBe(true);
    expect(isWithinDirectory('features/steps/orders.steps.ts', 'features/steps')).toBe(true);
    expect(isWithinDirectory('features/steps/nested/deep.ts', 'features/steps')).toBe(true);
    expect(isWithinDirectory('features/steps-old/x.ts', 'features/steps')).toBe(false);
    expect(isWithinDirectory('features/stepsx', 'features/steps')).toBe(false);
    expect(isWithinDirectory('features/steps/orders.steps.ts', '')).toBe(false);
  });
});
