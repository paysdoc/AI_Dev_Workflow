/**
 * The parameter types of feature-962.feature. Cucumber reads a parameter type when a step is
 * defined, so every step file that uses one imports this module, which defines them once.
 */

import { defineParameterType } from '@cucumber/cucumber';

import { STEP_STATUSES, type StepStatus } from './feature-962-suite.ts';

export const JOB_IDS = ['host', 'docker'] as const;
export type JobId = (typeof JOB_IDS)[number];

/** The status a Cucumber JSON report gives a step. */
export const REPORTED_STATUSES = ['pending', 'undefined', 'failed', 'passed'] as const;
export type ReportedStatus = (typeof REPORTED_STATUSES)[number];

defineParameterType({
  name: 'regressionJob',
  regexp: new RegExp(JOB_IDS.join('|')),
  transformer: (id: string) => id as JobId,
});

defineParameterType({
  name: 'suiteStepStatus',
  regexp: new RegExp(STEP_STATUSES.join('|')),
  transformer: (status: string) => status as StepStatus,
});

defineParameterType({
  name: 'reportedStepStatus',
  regexp: new RegExp(REPORTED_STATUSES.join('|')),
  transformer: (status: string) => status as ReportedStatus,
});
