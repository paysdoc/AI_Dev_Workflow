/**
 * The Given steps of feature-993. A Given only describes the target repository, the agents and the workflow: nothing is
 * committed and nothing runs until the first run. The static checks, the dev server of the default branch and
 * `When the workflow runs` are feature-990's. A dev server on the issue's branch cannot be described in
 * `.adw/commands.md`, which is the same on both branches, so the agents that change it say so: the build agents and the
 * review patch agent leave a marker in their worktree, which the dev server program reads (feature-990-scripts.ts).
 */

import { Given } from '@cucumber/cucumber';
import assert from 'assert';

import { describeWorkflow } from './feature-990-run.ts';
import { s, type ServerEffect } from './feature-990-world.ts';
import { assertProjectMdFile } from '../../regression/step_definitions/feature-991-project-md.ts';

const WEB = 'web';
const SERVER_EXIT_CODE = 1;

function breaksTheServer(standardError: string, exitCode: number): ServerEffect {
  assert.strictEqual(exitCode, SERVER_EXIT_CODE, `The dev server of these scenarios exits ${SERVER_EXIT_CODE} instead of starting`);
  return { kind: 'breaks', standardError };
}

Given("the default branch's {string} declares the application type {string}", function (file: string, applicationType: string) {
  assertProjectMdFile(file);
  assert.strictEqual(applicationType, WEB, `The target repositories of these scenarios are "${WEB}" ones`);
  s.web = true;
});

Given(
  "the build leaves the issue's branch with a dev server that prints {string} to standard error and exits {int} instead of starting",
  function (standardError: string, exitCode: number) {
    s.serverEffects = { ...s.serverEffects, build: breaksTheServer(standardError, exitCode) };
  },
);

Given(
  "the review patch agent leaves the issue's branch with a dev server that prints {string} to standard error and exits {int} instead of starting",
  function (standardError: string, exitCode: number) {
    s.serverEffects = { ...s.serverEffects, patch: breaksTheServer(standardError, exitCode) };
  },
);

Given("the review patch agent makes the dev server on the issue's branch start and answer its health check", function () {
  s.serverEffects = { ...s.serverEffects, patch: { kind: 'fixes' } };
});

Given("no review patch makes the dev server on the issue's branch start", function () {
  s.serverEffects = { ...s.serverEffects, patch: null };
});

Given("the issue's scenarios pass when they run against a dev server that answers its health check, and fail without one", function () {
  s.issueScenariosNeedServer = true;
});

Given('the review agent finds no blocker', function () {
  s.review = { kind: 'passes' };
});

Given('the review agent finds the blocker {string} on every attempt', function (blocker: string) {
  s.review = { kind: 'blocks', blocker };
});

Given(
  'a workflow of the {string} orchestrator for issue {int} under adwId {string} in that repository',
  async function (orchestrator: string, issue: number, adwId: string) {
    await describeWorkflow(orchestrator, issue, adwId);
  },
);
