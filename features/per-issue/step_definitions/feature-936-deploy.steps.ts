/**
 * Deploy-detection scenarios of feature-936. A throwaway repository is laid out like the ADW
 * repository, a release is merged from its default branch the way `gh pr merge --merge` merges
 * one, and the deploy workflow's change detection is run for that push in a checkout of it
 * (see feature-936-pathsFilter.ts for how the detection is run).
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';

import { detectWorkersToDeploy, type DetectionOutcome } from './feature-936-pathsFilter.ts';
import {
  changedFilesBetween,
  commitOnDefaultBranch,
  createRepository,
  mergeDefaultBranchIntoRelease,
  mergePullRequestIntoDefaultBranch,
  openCheckout,
  type ReleasePush,
  type ThrowawayRepo,
} from './feature-936-throwawayRepo.ts';

interface DeployState {
  readonly repo: ThrowawayRepo | undefined;
  readonly push: ReleasePush | undefined;
  readonly checkouts: readonly string[];
  readonly outcome: DetectionOutcome | undefined;
}

const INITIAL_STATE: DeployState = { repo: undefined, push: undefined, checkouts: [], outcome: undefined };

let state: DeployState = INITIAL_STATE;

After({ tags: '@adw-936' }, function () {
  const dirs = [state.repo?.dir, ...state.checkouts].filter((dir): dir is string => dir !== undefined);
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  state = INITIAL_STATE;
});

function repository(): ThrowawayRepo {
  assert.ok(state.repo, 'Expected a throwaway repository to have been created first');
  return state.repo;
}

function assertBranch(actual: string, expected: string, role: string): void {
  assert.strictEqual(actual, expected, `Expected the ${role} branch to be "${expected}"`);
}

function runDetection(releaseBranch: string, history: 'full' | 'pushed-commit-only'): void {
  const repo = repository();
  assert.ok(state.push, 'Expected the default branch to have been merged into the release branch first');
  assertBranch(releaseBranch, repo.releaseBranch, 'release');
  const checkout = openCheckout(repo, state.push, history);
  state = { ...state, checkouts: [...state.checkouts, checkout], outcome: detectWorkersToDeploy(repo, state.push, checkout) };
}

function describeOutcome(outcome: DetectionOutcome): string {
  return JSON.stringify(outcome);
}

function outcomeOf(): DetectionOutcome {
  assert.ok(state.outcome, 'Expected the change detection to have run first');
  return state.outcome;
}

Given('a throwaway repository whose default branch is {string} and whose {string} holds the previous release', function (defaultBranch: string, releaseBranch: string) {
  state = { ...state, repo: createRepository(defaultBranch, releaseBranch) };
});

Given('a commit on {string} that is not yet on {string} changes {string}', function (branch: string, otherBranch: string, file: string) {
  const repo = repository();
  assertBranch(branch, repo.defaultBranch, 'default');
  assertBranch(otherBranch, repo.releaseBranch, 'release');
  commitOnDefaultBranch(repo, file);
});

Given('a( later) pull request that changes {string} has been merged into {string} with a merge commit', function (file: string, branch: string) {
  const repo = repository();
  assertBranch(branch, repo.defaultBranch, 'default');
  mergePullRequestIntoDefaultBranch(repo, file);
});

When('{string} is merged into {string} with a merge commit, the way releases are merged', function (source: string, target: string) {
  const repo = repository();
  assertBranch(source, repo.defaultBranch, 'default');
  assertBranch(target, repo.releaseBranch, 'release');
  state = { ...state, push: mergeDefaultBranchIntoRelease(repo) };
});

When('the change-detection step of the deploy workflow runs for the push of that merge to {string}', function (releaseBranch: string) {
  runDetection(releaseBranch, 'full');
});

When(
  'the change-detection step of the deploy workflow runs for the push of that merge to {string} in a checkout that holds only the pushed commit',
  function (releaseBranch: string) {
    runDetection(releaseBranch, 'pushed-commit-only');
  },
);

Then('a comparison of {string} with the default branch {string} finds no changed file', function (releaseBranch: string, defaultBranch: string) {
  const repo = repository();
  assertBranch(releaseBranch, repo.releaseBranch, 'release');
  assertBranch(defaultBranch, repo.defaultBranch, 'default');
  assert.deepStrictEqual(changedFilesBetween(repo, `${defaultBranch}...${releaseBranch}`), []);
});

Then('the change detection marks the {string} Worker for deployment', function (worker: string) {
  const outcome = outcomeOf();
  assert.ok(outcome.kind === 'completed', `Expected the change detection to complete. Outcome: ${describeOutcome(outcome)}`);
  assert.strictEqual(outcome.marked[worker], true, `Expected the "${worker}" Worker to be marked. Outcome: ${describeOutcome(outcome)}`);
});

Then('the change detection leaves the {string} Worker out of the deployment', function (worker: string) {
  const outcome = outcomeOf();
  if (outcome.kind === 'not-triggered') return;
  assert.ok(outcome.kind === 'completed', `Expected the change detection to complete. Outcome: ${describeOutcome(outcome)}`);
  assert.strictEqual(outcome.marked[worker], false, `Expected the "${worker}" Worker to be left out. Outcome: ${describeOutcome(outcome)}`);
});

Then('the change detection either fails or marks the {string} Worker for deployment', function (worker: string) {
  const outcome = outcomeOf();
  const marked = outcome.kind === 'completed' && outcome.marked[worker] === true;
  assert.ok(outcome.kind === 'failed' || marked, `Expected the change detection to fail or mark "${worker}", not to skip it silently. Outcome: ${describeOutcome(outcome)}`);
});
