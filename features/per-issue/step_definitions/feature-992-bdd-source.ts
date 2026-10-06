/**
 * The scenarios of the fresh-repository scenario as the repository's owner would write them for ADW's Playwright project:
 * Gherkin, and TypeScript steps that register with `createBdd()` and take the fixture the scenario says it uses. The
 * scenario's table says in a sentence what each scenario does; this file turns the sentence into steps. The steps are text
 * only: they are written into a temporary repository at run time, where `@playwright/test` and `playwright-bdd` are installed.
 */

import assert from 'assert';

import type { ScenarioSource } from './feature-992-worktree.ts';

export interface ScenarioRow {
  readonly scenario: string;
  readonly steps: string;
}

interface Plan {
  readonly name: string;
  readonly path: string;
  readonly fixture: string;
  readonly subject: string;
  readonly expected: string;
}

interface StepKind {
  readonly gherkin: (plan: Plan) => readonly string[];
  readonly definitions: string;
}

const SENTENCE = /^(?:open|request) "([^"]*)" with the "(\w+)" fixture and expect the (\w+) "?([^"]*)"?$/;

const STEP_KINDS: Readonly<Record<string, StepKind>> = {
  'page:title': {
    gherkin: ({ path, expected }) => [`Given I open the page "${path}"`, `Then the page title is "${expected}"`],
    definitions: [
      "Given('I open the page {string}', async ({ page }, path: string) => {",
      '  await page.goto(path);',
      '});',
      '',
      "Then('the page title is {string}', async ({ page }, title: string) => {",
      '  await expect(page).toHaveTitle(title);',
      '});',
    ].join('\n'),
  },
  'request:status': {
    gherkin: ({ path, expected }) => [`Then "${path}" answers with the status ${expected}`],
    definitions: [
      "Then('{string} answers with the status {int}', async ({ request }, path: string, status: number) => {",
      '  const response = await request.get(path);',
      '  expect(response.status()).toBe(status);',
      '});',
    ].join('\n'),
  },
};

function planOf({ scenario, steps }: ScenarioRow): Plan {
  const parsed = SENTENCE.exec(steps);
  assert.ok(parsed, `The scenario "${scenario}" says "${steps}", which this harness cannot turn into steps`);
  const [, path, fixture, subject, expected] = parsed;
  return { name: scenario, path, fixture, subject, expected };
}

function kindOf(plan: Plan): StepKind {
  const kind = STEP_KINDS[`${plan.fixture}:${plan.subject}`];
  assert.ok(kind, `This harness writes no steps that take the "${plan.fixture}" fixture and expect the ${plan.subject}`);
  return kind;
}

export function scenarioSources(rows: readonly ScenarioRow[]): ScenarioSource[] {
  return rows.map(planOf).map(plan => ({ name: plan.name, steps: kindOf(plan).gherkin(plan) }));
}

/** Every kind of step the scenarios use is registered once: a pattern registered twice makes `bddgen` fail. */
export function stepFileSource(rows: readonly ScenarioRow[], registration: string, library: string): string {
  const definitions = [...new Set(rows.map(planOf).map(plan => kindOf(plan).definitions))];
  return [
    "import { expect } from '@playwright/test';",
    `import { ${registration.replace(/\(\)$/, '')} } from '${library}';`,
    '',
    `const { Given, Then } = ${registration};`,
    '',
    definitions.join('\n\n'),
    '',
  ].join('\n');
}
