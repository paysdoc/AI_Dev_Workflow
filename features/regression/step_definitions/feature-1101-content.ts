/**
 * What a feature-1101 repository holds besides the shared constant of the feature-1100 fixture: the ADW configuration, a step
 * definition file and a feature file. The merge run reads them from the merged worktree. A `cli` application type has a
 * descriptor scenario runner, no images and no devices. Nothing is installed and no dev server is declared, so the only
 * processes the re-run starts are the scenario runner's.
 */

import { FEATURE_NAME, type ScenarioRow } from './feature-1101-standin.ts';

const STEP_DEFINITIONS = 'features/step_definitions';

/** Without a run-by-tag command the repository is configured for ADW but has no scenarios: `.adw/scenarios.md` is absent. */
export function adwConfiguration(runByTag: string | null): Record<string, string> {
  const commands = ['# ADW Project Commands', '', '## Install Dependencies', 'N/A', '', '## Start Dev Server', 'N/A'];
  const files: Record<string, string> = {
    '.adw/project.md': '# Project\n\n## Application Type\ncli\n',
    '.adw/commands.md': `${[...commands, ...(runByTag === null ? [] : ['', '## Run Scenarios by Tag', runByTag])].join('\n')}\n`,
  };
  if (runByTag === null) return files;
  const scenarios = ['# ADW BDD Scenario Configuration', '', '## Scenario Directory', 'features/', '', '## Run Scenarios by Tag', runByTag, '', '## Step Def Directory', STEP_DEFINITIONS, '', '## BDD Framework', 'cucumber-js'];
  return { ...files, '.adw/scenarios.md': `${scenarios.join('\n')}\n` };
}

/** Only their presence matters: the stand-in runs the scenarios, but ADW skips the proof of a repository without step definitions. */
export function stepDefinitionFiles(): Record<string, string> {
  return { [`${STEP_DEFINITIONS}/orders.steps.ts`]: '// The scenarios of this repository are run by the stand-in scenario runner.\nexport {};\n' };
}

export const FEATURE_FILE = 'features/orders.feature';

export function featureFile(rows: readonly ScenarioRow[]): string {
  const scenarios = rows.flatMap((row) => [
    `  ${row.tag}`,
    `  Scenario: ${row.scenario}`,
    '    Given an order',
    '    When it is placed',
    '    Then it is judged',
    '',
  ]);
  return [`Feature: ${FEATURE_NAME}`, '', ...scenarios].join('\n');
}
