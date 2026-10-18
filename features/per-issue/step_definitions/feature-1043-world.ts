/**
 * What the feature-1043 scenarios share, and the hooks that bring up the worlds of the earlier features whose steps they
 * reuse: the mapping and the workflow's start (feature-991), the unit-test phase (feature-988), the scenario test phase and
 * the step-definition phase (feature-992), and the review phase (feature-994). A scenario that also carries the tag of one
 * of those features runs that feature's hooks as well, so every reset here is safe to run twice.
 */

import assert from 'assert';
import { After, Before } from '@cucumber/cucumber';

import type { StackCoherenceInput, StackCoherenceResult, StackLanguage } from '../../../adws/core/stackCoherenceCheck.ts';

import { beginScenario, endScenario } from '../../regression/step_definitions/feature-988-world.ts';
import { disposeToolchain } from '../../regression/step_definitions/feature-992-standins.ts';
import { resetState as resetState992 } from '../../regression/step_definitions/feature-992-world.ts';
import { resetState as resetState991 } from './feature-991-world.ts';
import { setUpWorld994, tearDownWorld994 } from './feature-994-world.ts';

/** What the Gherkin runtime registry answered for a BDD framework. */
export interface RegistryAnswer {
  readonly framework: string;
  readonly gherkin: boolean;
  readonly extensions: readonly string[];
}

/** What the stack-coherence check made of a stack: the languages it read, and what it warned about. */
export interface StackJudgement {
  readonly languages: readonly StackLanguage[];
  readonly result: StackCoherenceResult;
}

export interface State1043 {
  /** The line the gate wrote to the workflow's execution log for the application type the scenario is about. */
  gateLine: string | null;
  registry: RegistryAnswer | null;
  /** The stack a target repository's ".adw/" describes. */
  stack: StackCoherenceInput | null;
  judgement: StackJudgement | null;
}

function freshState(): State1043 {
  return { gateLine: null, registry: null, stack: null, judgement: null };
}

export const s: State1043 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

export function requireGateLine(): string {
  assert.ok(s.gateLine, "Expected the workflow's execution log to have been read for the application type first");
  return s.gateLine;
}

export function requireRegistry(): RegistryAnswer {
  assert.ok(s.registry, 'Expected the Gherkin runtime registry to have been consulted first');
  return s.registry;
}

export function requireStack(): StackCoherenceInput {
  assert.ok(s.stack, "Expected a target repository's stack to have been described first");
  return s.stack;
}

export function requireJudgement(): StackJudgement {
  assert.ok(s.judgement, "Expected the stack-coherence check to have judged the repository's stack first");
  return s.judgement;
}

function resetWorlds(): void {
  resetState991();
  resetState992();
  resetState();
}

Before({ tags: '@adw-1043' }, function () {
  beginScenario();
  setUpWorld994();
  resetWorlds();
});

After({ tags: '@adw-1043' }, async function () {
  await endScenario();
  tearDownWorld994();
  disposeToolchain();
  resetWorlds();
});
