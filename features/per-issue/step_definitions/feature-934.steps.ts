/**
 * Given and When steps of feature-934.feature: the throwaway promotion-sweep target, what its
 * default branch holds, what its forge already recorded, and the two sweeps the scenarios run. The
 * Then steps live in `feature-934-then.steps.ts`.
 */

import { Given, When } from '@cucumber/cucumber';
import { appendFileSync } from 'fs';
import * as path from 'path';

import {
  DEFAULT_VOCABULARY_PATH,
  REWRITTEN_DESCRIPTION,
  VOCABULARY_REGISTRY,
  assertScoreIs,
  candidateFeature,
  historyFeature,
  originalDescription,
  scenarioCount,
  stepDefinitionsFor,
} from './feature-934-scoring.ts';
import { commitToDefault, daysAgoIso, ensureHostCheckout, git, isoDay, readOnDefault } from './feature-934-target.ts';
import {
  requireForge,
  requireTarget,
  runPerIssueSweepOnTarget,
  runPromotionSweepOnTarget,
  startTarget,
  world,
} from './feature-934-world.ts';

const PER_ISSUE_DIR = 'features/per-issue';
const ANNOTATION = 'Consumed by scenario_writer.';

function featurePathOf(featureNumber: number): string {
  return `${PER_ISSUE_DIR}/feature-${featureNumber}.feature`;
}

function featureNumberOf(featurePath: string): number {
  const match = /feature-(\d+)\.feature$/.exec(featurePath);
  if (!match) throw new Error(`Expected a per-issue feature path, got "${featurePath}"`);
  return Number(match[1]);
}

function repeat(count: number, action: () => void): void {
  Array.from({ length: count }, action);
}

function annotated(value: string, placement: string): string {
  switch (placement) {
    case 'above the value': return `<!-- ${ANNOTATION} -->\n${value}`;
    case 'after the value on its line': return `${value} <!-- ${ANNOTATION} -->`;
    case 'below the value': return `${value}\n<!-- ${ANNOTATION} -->`;
    case 'on several lines above the value': return `<!-- ${ANNOTATION}\n     When set, the @regression sweep step is skipped. -->\n${value}`;
    default: throw new Error(`Unknown comment placement "${placement}"`);
  }
}

function scenariosMd(perIssueDir: string, regressionDir: string, vocabularyPath: string, placement: string): string {
  return [
    '# ADW BDD Scenario Configuration',
    '',
    '## Scenario Directory',
    'features/',
    '',
    '## Per-Issue Scenario Directory',
    annotated(perIssueDir, placement),
    '',
    '## Regression Scenario Directory',
    annotated(regressionDir, placement),
    '',
    '## Vocabulary Registry',
    annotated(vocabularyPath, placement),
    '',
  ].join('\n');
}

function featureTextOnDefault(featureNumber: number): string {
  const text = readOnDefault(requireTarget(), featurePathOf(featureNumber));
  if (text === null) throw new Error(`Expected feature-${featureNumber} to exist on the remote default branch`);
  return text;
}

Given(
  'a promotion sweep target {string} whose default branch {string} accepts changes only through merged pull requests',
  function (slug: string, defaultBranch: string) {
    const [owner, repo] = slug.split('/');
    startTarget(owner, repo, defaultBranch);
  },
);

Given('the target\'s history added {int} per-issue scenarios in the last 90 days', function (total: number) {
  const target = requireTarget();
  const missing = total - target.addedScenarios;
  if (missing < 0) throw new Error(`The target already added ${target.addedScenarios} per-issue scenarios, more than ${total}`);
  if (missing === 0) return;
  // The file is removed again: the history of swept files still counts towards the ramp.
  const historyFile = `${PER_ISSUE_DIR}/history-${world.historyFiles++}.feature`;
  commitToDefault(target, { [historyFile]: historyFeature(missing) }, 'chore: add seeded per-issue history', 30);
  commitToDefault(target, { [historyFile]: null }, 'chore: sweep seeded per-issue history', 29);
  target.addedScenarios = total;
});

Given(
  'the target has {int} promotion issue(s) closed by a pull request merged {int} days ago',
  function (count: number, days: number) {
    const forge = requireForge();
    repeat(count, () => {
      const issue = forge.seedPromotionIssue({ feature: world.nextPromotedFeature++, state: 'CLOSED' });
      forge.seedPullRequest({ body: `Closes #${issue}`, state: 'MERGED', mergedAt: new Date(daysAgoIso(days)) });
    });
  },
);

Given(
  'the target has {int} promotion issue(s) closed {int} days ago whose pull requests closed unmerged',
  function (count: number, _days: number) {
    const forge = requireForge();
    repeat(count, () => {
      const issue = forge.seedPromotionIssue({ feature: world.nextPromotedFeature++, state: 'CLOSED' });
      forge.seedPullRequest({ body: `Closes #${issue}`, state: 'CLOSED' });
    });
  },
);

Given('the target has {int} open promotion issue(s)', function (count: number) {
  const forge = requireForge();
  repeat(count, () => forge.seedPromotionIssue({ feature: world.nextPromotedFeature++, state: 'OPEN' }));
});

Given(
  'the remote default branch holds {string} and its step definitions, with a best scenario whose promotion score is {int}',
  function (featurePath: string, targetScore: number) {
    const target = requireTarget();
    const featureNumber = featureNumberOf(featurePath);
    const content = candidateFeature(featureNumber, targetScore);
    assertScoreIs(content, targetScore);
    commitToDefault(
      target,
      {
        [featurePath]: content,
        [`${PER_ISSUE_DIR}/step_definitions/feature-${featureNumber}.steps.ts`]: stepDefinitionsFor(featureNumber),
        [world.vocabularyPath ?? DEFAULT_VOCABULARY_PATH]: VOCABULARY_REGISTRY,
      },
      `feat: add ${featurePath}`,
    );
    target.addedScenarios += scenarioCount(content);
  },
);

Given(
  'the cron host\'s checkout is on the branch {string}, branched from {string}, with an uncommitted change to {string}',
  function (branch: string, from: string, changedFile: string) {
    const target = requireTarget();
    ensureHostCheckout(target);
    git(target.hostCheckout, ['checkout', '-b', branch, from]);
    appendFileSync(path.join(target.hostCheckout, changedFile), '\nAn uncommitted note.\n');
  },
);

Given(
  'after the cron host\'s checkout was taken, a commit on the remote default branch rewrote the description of {string}',
  function (featurePath: string) {
    const target = requireTarget();
    ensureHostCheckout(target);
    const featureNumber = featureNumberOf(featurePath);
    const rewritten = featureTextOnDefault(featureNumber).replace(originalDescription(featureNumber), REWRITTEN_DESCRIPTION);
    commitToDefault(target, { [featurePath]: rewritten }, `docs: rewrite the description of ${featurePath}`);
  },
);

Given('the code host refuses to merge pull requests', function () {
  requireForge().mergesRefused = true;
});

Given(
  'feature-{int} on the remote default branch already carries a {string} tag dated {int} days ago',
  function (featureNumber: number, tag: string, days: number) {
    const tagged = featureTextOnDefault(featureNumber).replace(/^@adw-\d+/, adw => `${adw} ${tag}${isoDay(daysAgoIso(days))}`);
    commitToDefault(requireTarget(), { [featurePathOf(featureNumber)]: tagged }, `chore: mark feature-${featureNumber} promotion-suggested`);
  },
);

Given(
  'promotion issue {int} for feature-{int} was closed {int} days ago and its pull request closed unmerged',
  function (issueNumber: number, featureNumber: number, _days: number) {
    const forge = requireForge();
    forge.seedPromotionIssue({ feature: featureNumber, state: 'CLOSED', number: issueNumber });
    forge.seedPullRequest({ body: `Closes #${issueNumber}`, state: 'CLOSED' });
  },
);

Given('the pull request that resolved issue {int} merged {int} days ago', function (issueNumber: number, days: number) {
  requireForge().seedPullRequest({ body: `Closes #${issueNumber}`, state: 'MERGED', mergedAt: new Date(daysAgoIso(days)) });
});

Given(
  'the target\'s {string} sets the per-issue directory {string}, the regression directory {string} and the vocabulary registry {string}, each annotated with an HTML comment placed {string}',
  function (configFile: string, perIssueDir: string, regressionDir: string, vocabularyPath: string, placement: string) {
    commitToDefault(
      requireTarget(),
      { [configFile]: scenariosMd(perIssueDir, regressionDir, vocabularyPath, placement) },
      `chore: configure ${configFile}`,
    );
    world.vocabularyPath = vocabularyPath;
  },
);

When('the promotion sweep computes its threshold for the target', async function () {
  await runPromotionSweepOnTarget();
});

When('the promotion sweep runs', async function () {
  await runPromotionSweepOnTarget();
});

When('the per-issue scenario sweep runs', async function () {
  await runPerIssueSweepOnTarget();
});
