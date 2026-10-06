/**
 * What the feature-991 scenarios share: what the application-type mapping answered, the project configuration a
 * scenario read, and how the application-type step of a workflow's start ended. The workflow itself is feature-988's
 * `s.workflow`, so that the feature-989 steps that act on "the workflow" find it.
 */

import { After, Before } from '@cucumber/cucumber';

import type { ApplicationProfile, ApplicationTypeResolution } from '../../../adws/core/applicationType.ts';
import type { ProjectConfig } from '../../../adws/core/projectConfig.ts';

import { beginScenario, endScenario } from './feature-988-world.ts';

/** How the application-type step of a workflow's start ended: it returned a profile, or it called `process.exit`. */
export interface StartOutcome {
  readonly applicationProfile: ApplicationProfile | null;
  readonly exitCode: number | null;
  readonly error: unknown;
}

export interface State991 {
  /** What the mapping answered, in the order it was asked. */
  consultations: ApplicationTypeResolution[];
  /** A throwaway repository the configuration scenarios read, removed with the scenario's other directories. */
  repositoryDir: string | null;
  projectConfig: ProjectConfig | null;
  start: StartOutcome | null;
}

function freshState(): State991 {
  return { consultations: [], repositoryDir: null, projectConfig: null, start: null };
}

export const s: State991 = freshState();

export function resetState(): void {
  Object.assign(s, freshState());
}

/** Both of feature-988's hooks are safe to run twice: a scenario tagged for feature-989 and this feature runs the hooks of each. */
Before({ tags: '@adw-991' }, function () {
  beginScenario();
  resetState();
});

After({ tags: '@adw-991' }, async function () {
  await endScenario();
  resetState();
});
