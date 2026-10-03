/**
 * Steps of the "Smoke processes" section of the vocabulary registry that seed what the promotion
 * sweep reads: the target workspace's default branch, which the sweep builds its own worktree off,
 * and the forge's promotion issues and the pull requests that closed them. Everything the Givens
 * commit goes on `main` and moves `origin/main` with it, since the sweep never reads the workspace's
 * checkout. The forge is seeded through the mock server's state, never through recorded requests:
 * T7 counts the recorded merges.
 */

import { Given } from '@cucumber/cucumber';
import assert from 'assert';
import { join } from 'path';
import { readFileSync } from 'fs';

import { ADW_REGRESSION_PROMOTION_LABEL } from '../../../adws/core/adwLabels.ts';
import { parseScenariosMd } from '../../../adws/core/projectConfig.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import { commitOnDefaultBranch, removeOnDefaultBranch } from '../support/fixtureTargetRepo.ts';
import { realGit } from '../support/fixtureWorktree.ts';
import {
  HISTORY_FEATURE_PATH,
  VOCABULARY_PATH,
  bestScore,
  candidateFeature,
  historyFeature,
  vocabularyRegistry,
  withVocabularyDeclared,
} from '../support/promotionFixtures.ts';
import { ensureTargetWorkspace } from '../support/subprocessHarness.ts';
import type { RegressionWorld } from './world.ts';

/** ADW reads a repository's vocabulary declaration from here and nowhere else. */
const DECLARATION_PATH = '.adw/scenarios.md';
const DAY_MS = 86_400_000;
const FIRST_PROMOTION_ISSUE = 9200;
const FIRST_PROMOTION_PULL_REQUEST = 9250;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** The registry the workspace's committed declaration names, as committed: what the sweep scores against. */
function committedVocabulary(workspace: string): string {
  const declared = parseScenariosMd(realGit(workspace, 'show', `HEAD:${DECLARATION_PATH}`)).vocabularyRegistry;
  assert.ok(declared, `Expected the workspace to have committed a vocabulary declaration in ${DECLARATION_PATH} first`);
  return realGit(workspace, 'show', `HEAD:${declared}`);
}

Given("the target repository's workspace declares its regression vocabulary in {string}", function (this: RegressionWorld, declarationPath: string) {
  assert.strictEqual(declarationPath, DECLARATION_PATH, `Expected the declaration in ${DECLARATION_PATH}, the only place ADW reads it from`);
  const workspace = ensureTargetWorkspace(this);
  const declared = readFileSync(join(workspace, declarationPath), 'utf-8');
  commitOnDefaultBranch(workspace, VOCABULARY_PATH, vocabularyRegistry(), `Add ${VOCABULARY_PATH}`);
  commitOnDefaultBranch(workspace, declarationPath, withVocabularyDeclared(declared), `Declare the vocabulary registry in ${declarationPath}`);
});

Given(
  "the target repository's workspace has committed {string} holding the scenario {string}, which the promotion scorer rates {int}",
  function (this: RegressionWorld, featurePath: string, scenarioName: string, expectedScore: number) {
    const workspace = ensureTargetWorkspace(this);
    const featureNumber = /feature-(\d+)\.feature$/.exec(featurePath)?.[1];
    const text = candidateFeature(featureNumber && `@adw-${featureNumber}`, scenarioName, expectedScore);

    const actual = bestScore(text, committedVocabulary(workspace));
    assert.strictEqual(actual, expectedScore, `Expected the promotion scorer to rate "${scenarioName}" ${expectedScore} under the vocabulary the workspace committed, but it rates it ${actual}`);
    commitOnDefaultBranch(workspace, featurePath, text, `Add ${featurePath}`);
  },
);

/** Committed now, which is inside the window however many days it is. */
Given(
  "{int} more per-issue scenarios were added to, and since removed from, the target repository's default branch in the last {int} days",
  function (this: RegressionWorld, scenarioCount: number, days: number) {
    assert.ok(days >= 1, `Expected a window of at least one day, but got ${days}`);
    const workspace = ensureTargetWorkspace(this);
    commitOnDefaultBranch(workspace, HISTORY_FEATURE_PATH, historyFeature(scenarioCount), `Add ${scenarioCount} scenarios in ${HISTORY_FEATURE_PATH}`);
    removeOnDefaultBranch(workspace, HISTORY_FEATURE_PATH, `chore: sweep ${HISTORY_FEATURE_PATH}`);
  },
);

function isPromotionIssue(issue: unknown): boolean {
  const labels = (issue as { labels?: unknown }).labels;
  const names = (Array.isArray(labels) ? labels : []).map((label) => (typeof label === 'string' ? label : (label as { name?: unknown }).name));
  return names.includes(ADW_REGRESSION_PROMOTION_LABEL);
}

/** Each promotes a feature no file names, so the sweep's reconcile for the candidate is unchanged; a pull request merged half the window ago links it. */
function promotionRecords(index: number, mergedAt: string): { issue: Record<string, unknown>; pullRequest: Record<string, unknown> } {
  const issueNumber = FIRST_PROMOTION_ISSUE + index;
  const pullRequestNumber = FIRST_PROMOTION_PULL_REQUEST + index;
  return {
    issue: {
      number: issueNumber,
      title: `Promote feature-${issueNumber}`,
      state: 'closed',
      body: `Promotes: feature-${issueNumber}\n`,
      user: { login: 'adw-bot' },
      labels: [{ name: ADW_REGRESSION_PROMOTION_LABEL }],
      created_at: mergedAt,
      updated_at: mergedAt,
      closed_at: mergedAt,
    },
    pullRequest: {
      number: pullRequestNumber,
      title: `Promote feature-${issueNumber}`,
      body: `Implements #${issueNumber}\n`,
      state: 'closed',
      merged: true,
      merged_at: mergedAt,
      headRefName: `promote-feature-${issueNumber}`,
      baseRefName: 'main',
    },
  };
}

/** Leaves exactly `count` promotion issues in the mock, none for 0, whatever was there before. */
Given(
  'the target repository has {int} promotion issue(s) whose pull request merged in the last {int} days',
  async function (this: RegressionWorld, count: number, days: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    const { issues, prs } = getMockServerState();
    const records = Array.from({ length: count }, (_, index) => promotionRecords(index, daysAgo(Math.floor(days / 2))));
    const others = Object.entries(issues).filter(([, issue]) => !isPromotionIssue(issue));
    await this.mockContext.setState({
      issues: { ...Object.fromEntries(others), ...Object.fromEntries(records.map(({ issue }) => [String(issue.number), issue])) },
      prs: { ...prs, ...Object.fromEntries(records.map(({ pullRequest }) => [String(pullRequest.number), pullRequest])) },
    });
  },
);
