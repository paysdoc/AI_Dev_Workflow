/**
 * The Thens of feature-1104.feature that say what the planning command the planner ran tells it. The planner finds its command in the
 * worktree it runs in, so these steps read the text the stand-in Claude CLI recorded when the planner's run started (feature-1104-cli.ts),
 * take its `## Behavioural Equivalence` section and assert the phrases that carry each rule. The route to the planner, and the hooks, are
 * feature-1104.steps.ts's.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { BEHAVIOURAL_EQUIVALENCE, behaviouralEquivalenceSection, isPlaceholder, planFormatSection } from './feature-1104-commands.ts';
import { commandFile, plannerRunOf } from './feature-1104.steps.ts';

interface PlannedCommand {
  readonly command: string;
  readonly text: string;
  readonly section: string;
}

function commandRunBy(world: RegressionWorld, adwId: string, command: string): PlannedCommand {
  const { commandText } = plannerRunOf(world, adwId, command);
  assert.ok(commandText !== undefined, `Expected the worktree to hold ${commandFile(command)} when the planner started`);
  const section = behaviouralEquivalenceSection(commandText);
  assert.ok(section !== undefined, `Expected the ${command} planning command the planner ran to have a "${BEHAVIOURAL_EQUIVALENCE}" section`);
  return { command, text: commandText, section };
}

function quoted(phrases: readonly string[]): string {
  return phrases.map((phrase) => `"${phrase}"`).join(', ');
}

function assertSays({ command, section }: PlannedCommand, phrases: readonly string[]): void {
  const missing = phrases.filter((phrase) => !section.includes(phrase));
  assert.deepStrictEqual(missing, [], `Expected the "${BEHAVIOURAL_EQUIVALENCE}" section of the ${command} planning command the planner ran to hold ${quoted(phrases)}, but it lacks: ${quoted(missing)}`);
}

/** The planner writes each section of the plan from the Plan Format, so the Plan Format must point back to the rule where the planner writes the section. */
function assertPlanFormatPointsBack({ command, text }: PlannedCommand, heading: string): void {
  const block = planFormatSection(text, heading);
  assert.ok(block !== undefined, `Expected the Plan Format of the ${command} planning command the planner ran to have a "${heading}" section`);
  const pointsBack = block.some((line) => isPlaceholder(line) && line.includes('behavioural equivalence step'));
  assert.ok(pointsBack, `Expected the "${heading}" section of the Plan Format of the ${command} planning command the planner ran to hold a placeholder line that names the behavioural equivalence step`);
}

Then(
  'the {string} planning command the planner of the workflow for adwId {string} ran tells it that the plan of an issue that ports, rewrites, migrates, re-bundles or restructures existing code, and says or implies that what the code does stays the same, must include a behavioural equivalence step as a task of its own under {string}',
  function (this: RegressionWorld, command: string, adwId: string, heading: string) {
    assertSays(commandRunBy(this, adwId, command), [
      'ports, rewrites, migrates, re-bundles or restructures',
      'says or implies',
      'stays the same',
      'must include a behavioural equivalence step',
      'task of its own',
      heading,
    ]);
  },
);

Then(
  'the {string} planning command the planner of the workflow for adwId {string} ran tells it that the behavioural equivalence step keeps a copy of the old implementation that the tests can run, and runs the old and the new implementation on the same inputs and diffs what they produce, across the public API and odd inputs such as null and undefined options, empty collections and boundary values',
  function (this: RegressionWorld, command: string, adwId: string) {
    assertSays(commandRunBy(this, adwId, command), [
      'copy of the old implementation',
      'tests can run',
      'same inputs',
      'diffs what they produce',
      'public API',
      '`null`',
      '`undefined`',
      'empty collections',
      'boundary values',
    ]);
  },
);

Then(
  'the {string} planning command the planner of the workflow for adwId {string} ran tells it to list the command that runs the comparison under {string}',
  function (this: RegressionWorld, command: string, adwId: string, heading: string) {
    const planned = commandRunBy(this, adwId, command);
    assertSays(planned, [heading]);
    assertPlanFormatPointsBack(planned, heading);
  },
);

Then(
  "the {string} planning command the planner of the workflow for adwId {string} ran tells it that a byte-for-byte check of a build artefact against the build's own output, and the existing tests still passing, are not behavioural equivalence checks",
  function (this: RegressionWorld, command: string, adwId: string) {
    assertSays(commandRunBy(this, adwId, command), [
      'not behavioural equivalence checks',
      'byte-for-byte',
      "build's own output",
      'the existing tests still passing',
    ]);
  },
);

Then(
  'the {string} planning command the planner of the workflow for adwId {string} ran tells it that an issue that restructures no existing code, such as one that adds new behaviour, gets no behavioural equivalence step and needs no note about one',
  function (this: RegressionWorld, command: string, adwId: string) {
    assertSays(commandRunBy(this, adwId, command), [
      'restructures no existing code',
      'adds new behaviour',
      'gets no behavioural equivalence step',
      'needs no note about one',
    ]);
  },
);

Then(
  'the {string} planning command the planner of the workflow for adwId {string} ran tells it that when the old implementation cannot be run, or what the code does is meant to change, the plan has no behavioural equivalence step and {string} says so and why',
  function (this: RegressionWorld, command: string, adwId: string, heading: string) {
    const planned = commandRunBy(this, adwId, command);
    assertSays(planned, ['cannot be run', 'meant to change', 'there is no behavioural equivalence step', heading, 'say so and why']);
    assertPlanFormatPointsBack(planned, heading);
  },
);
