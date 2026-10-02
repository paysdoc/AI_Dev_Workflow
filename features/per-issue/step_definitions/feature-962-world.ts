/**
 * What a scenario of feature-962.feature has set up and what its run produced, shared by the Given,
 * When and Then steps. Every directory a scenario made is removed when it ends.
 */

import assert from 'assert';

import type { WorkflowRun } from './feature-962-run.ts';
import { removeRunRoot } from './feature-962-sandbox.ts';
import type { SuiteKind } from './feature-962-suite.ts';
import type { SuiteRun } from './feature-962-suiteRun.ts';

interface ScenarioState {
  /** The suite every checkout of a run holds; a single passing scenario unless the scenario names another. */
  readonly suite: SuiteKind;
  /** The exit status of the stand-in's `docker run`. */
  readonly dockerExitStatus: number;
  readonly run: WorkflowRun | undefined;
  readonly suiteRun: SuiteRun | undefined;
}

const INITIAL_STATE: ScenarioState = { suite: 'passing', dockerExitStatus: 0, run: undefined, suiteRun: undefined };

let state: ScenarioState = INITIAL_STATE;
let runRoots: readonly string[] = [];

export const scenario = (): ScenarioState => state;

export function update(change: Partial<ScenarioState>): void {
  state = { ...state, ...change };
}

/** Removes `runRoot` when the scenario ends, whether it ended well or not. */
export function removeAfterScenario(runRoot: string): void {
  runRoots = [...runRoots, runRoot];
}

export function endScenario(): void {
  runRoots.forEach(removeRunRoot);
  runRoots = [];
  state = INITIAL_STATE;
}

export function finishedRun(): WorkflowRun {
  assert.ok(state.run, 'Expected the regression workflow to have run first');
  return state.run;
}

export function finishedSuiteRun(): SuiteRun {
  assert.ok(state.suiteRun, 'Expected the @regression suite to have run in the checkout first');
  return state.suiteRun;
}
