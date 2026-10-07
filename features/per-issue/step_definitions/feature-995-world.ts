/**
 * What the feature-995 scenarios share: the scratch repositories of the scenario about a leftover ".adw/review_proof.md", and the
 * hooks that bring up the harness a scenario's steps need. The scenarios of this feature come in three kinds that run what earlier
 * features run, so their hooks do what those features' hooks do. A scenario says which kind it is in its first step: "a workflow of
 * the ... orchestrator" runs real orchestrator processes (feature-990), and "a workflow for issue ..." runs the real scenario test
 * phase and review phase (feature-994). The earlier features' own scenarios that also carry `@adw-995` keep only their own hooks.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { After, Before, type ITestCaseHookParameter } from '@cucumber/cucumber';

import type { ProjectConfig } from '../../../adws/core/projectConfig.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

import { setUpWorld990, tearDownWorld990 } from './feature-990-world.ts';
import { setUpWorld994, tearDownWorld994 } from './feature-994-world.ts';

export interface State995 {
  /** The directories the scenario made, removed after it. */
  directories: string[];
  /** The repositories the scenario described: the first holds a complete configuration, the second also a leftover file. */
  repositories: string[];
  /** The project configuration ADW read from each repository, in the same order. */
  configs: ProjectConfig[];
}

function freshState(): State995 {
  return { directories: [], repositories: [], configs: [] };
}

export const s: State995 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

/** A temporary directory the scenario owns, removed after it. */
export function makeDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  s.directories.push(directory);
  return directory;
}

const OWN_SCENARIOS = '@adw-995 and not @adw-992 and not @adw-994';
const ORCHESTRATOR_WORKFLOW = /^a workflow of the ".+" orchestrator/;
const REVIEW_WORKFLOW = /^a workflow for issue \d+ in a /;

type Pickle = ITestCaseHookParameter['pickle'];

function describes(pickle: Pickle, workflow: RegExp): boolean {
  return pickle.steps.some(step => workflow.test(step.text));
}

Before({ tags: OWN_SCENARIOS }, async function (this: RegressionWorld, { pickle }: ITestCaseHookParameter) {
  resetState();
  if (describes(pickle, ORCHESTRATOR_WORKFLOW)) await setUpWorld990(this);
  if (describes(pickle, REVIEW_WORKFLOW)) setUpWorld994();
});

After({ tags: OWN_SCENARIOS }, async function (this: RegressionWorld, { pickle }: ITestCaseHookParameter) {
  if (describes(pickle, ORCHESTRATOR_WORKFLOW)) await tearDownWorld990(this);
  if (describes(pickle, REVIEW_WORKFLOW)) tearDownWorld994();
  s.directories.forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
  resetState();
});
