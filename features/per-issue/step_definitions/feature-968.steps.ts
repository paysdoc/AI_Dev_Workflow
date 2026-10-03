/**
 * Step definitions for feature-968.feature that no other file defines. The checks judge the runs
 * feature-961's steps made: the child run of the `@regression` suite and the dry run of every
 * feature the configuration loads. Nothing here starts a Cucumber process or reads a source file.
 */

import { Then, type DataTable } from '@cucumber/cucumber';
import { TestStepResultStatus, type Envelope } from '@cucumber/messages';
import assert from 'assert';

import { describeScenario, scenariosFrom, verdictHolds, type ScenarioOutcome, type StepOutcome } from '../../support/cucumberChildRun.ts';
import { requireRun } from './feature-961.steps.ts';

const { PENDING, UNDEFINED, AMBIGUOUS, FAILED } = TestStepResultStatus;

const SMOKE_DIRECTORY = 'features/regression/smoke/';
const NOT_RESOLVED_SHOWN = 3;
/** A run that exits 0 under strict mode has none of these, so each is a reason for the exit code to be 1. */
const NOT_RESOLVED: ReadonlySet<TestStepResultStatus> = new Set([PENDING, UNDEFINED, AMBIGUOUS, FAILED]);

function isNotResolved({ status }: StepOutcome): boolean {
  return NOT_RESOLVED.has(status);
}

/** A hook that is pending or failed ends its scenario as surely as a step does. */
function hasNotResolvedPart(scenario: ScenarioOutcome): boolean {
  return [...scenario.steps, ...scenario.hooks].some(isNotResolved);
}

Then('that run reports no pending, no undefined and no failed scenario, and exits 0', function () {
  const { status, envelopes, stderr } = requireRun();
  const scenarios = scenariosFrom(envelopes);
  assert.ok(scenarios.length > 0, `Expected the run to hold at least one scenario. stderr:\n${stderr}`);

  const notResolved = scenarios.filter(hasNotResolvedPart);
  assert.deepStrictEqual(
    notResolved.slice(0, NOT_RESOLVED_SHOWN).map(describeScenario),
    [],
    `Expected no pending, undefined or failed scenario, but ${notResolved.length} of ${scenarios.length} are (the first ${NOT_RESOLVED_SHOWN} are shown)`,
  );
  assert.strictEqual(status, 0, `Expected the run to exit 0. stderr:\n${stderr}`);
});

function assertSmokeScenarioPasses(scenarios: readonly ScenarioOutcome[], feature: string, name: string): void {
  const found = scenarios.filter((scenario) => scenario.uri.endsWith(`${SMOKE_DIRECTORY}${feature}`) && scenario.name === name);
  assert.strictEqual(found.length, 1, `Expected exactly one scenario "${name}" from ${feature} in the run, but it ran ${found.length}`);
  assert.ok(verdictHolds(found[0], 'passes'), `Expected "${name}" of ${feature} to pass, but the child Cucumber run reported:\n${describeScenario(found[0])}`);
}

Then('that run passed each of these smoke scenarios:', function (table: DataTable) {
  const scenarios = scenariosFrom(requireRun().envelopes);
  table.hashes().forEach(({ feature, scenario }) => assertSmokeScenarioPasses(scenarios, feature, scenario));
});

/** One entry for each step definition the run loaded, so an expression that two files define appears twice. */
function loadedExpressions(envelopes: readonly Envelope[]): string[] {
  const expressions = envelopes.flatMap(({ stepDefinition }) => (stepDefinition ? [stepDefinition.pattern.source] : []));
  assert.ok(expressions.length > 0, 'Expected the dry run to have loaded step definitions');
  return expressions;
}

function listedExpressions(table: DataTable): string[] {
  return table.hashes().map(({ expression }) => expression);
}

Then('the dry run loaded no step definition with any of these expressions:', function (table: DataTable) {
  const loaded = loadedExpressions(requireRun().envelopes);
  const present = listedExpressions(table).filter((expression) => loaded.includes(expression));
  assert.deepStrictEqual(present, [], 'Expected the dry run to have loaded no step definition with these expressions');
});

Then('the dry run loaded exactly one step definition with each of these expressions:', function (table: DataTable) {
  const loaded = loadedExpressions(requireRun().envelopes);
  const counts = listedExpressions(table).map((expression) => ({ expression, loaded: loaded.filter((source) => source === expression).length }));
  assert.deepStrictEqual(
    counts.filter((count) => count.loaded !== 1),
    [],
    'Expected the dry run to have loaded exactly one step definition with each of these expressions',
  );
});
