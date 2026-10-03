/**
 * Then steps of feature-934.feature about the text and labels of the promotion issue the sweep
 * filed, and the order it was filed in relative to the marker's pull request.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { mergedPullRequests, onlyFiledIssue } from './feature-934-observed.ts';
import { requireForge } from './feature-934-world.ts';

const PER_ISSUE_DIR = 'features/per-issue';

function bodyOf(featureNumber: number): string {
  return onlyFiledIssue(requireForge(), featureNumber).body;
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

Then('the promotion issue for feature-{int} carries the labels {string}, {string} and {string}', function (
  featureNumber: number,
  first: string,
  second: string,
  third: string,
) {
  const { labels } = onlyFiledIssue(requireForge(), featureNumber);
  assert.deepStrictEqual([...labels].sort(), [first, second, third].sort());
});

Then('the promotion issue for feature-{int} was filed after that pull request merged', function (featureNumber: number) {
  const forge = requireForge();
  const issue = onlyFiledIssue(forge, featureNumber);
  const featurePath = `${PER_ISSUE_DIR}/feature-${featureNumber}.feature`;
  const marker = mergedPullRequests(forge).find(pr => pr.files.includes(featurePath));
  assert.ok(marker, `Expected a merged pull request that changed ${featurePath}`);
  assert.ok(marker.at < issue.at, `Expected the issue (event ${issue.at}) to be filed after the pull request merged (event ${marker.at})`);
});

Then('the promotion issue for feature-{int} contains no HTML comment', function (featureNumber: number) {
  assert.ok(!bodyOf(featureNumber).includes('<!--'), 'Expected the promotion issue to hold no HTML comment');
});

Then(
  'the promotion issue for feature-{int} moves {string} with a git mv to a path under {string}',
  function (featureNumber: number, source: string, destinationDir: string) {
    const move = new RegExp(`\`git mv ${escapeForRegExp(source)} ${escapeForRegExp(destinationDir)}[^\\s\`]+/feature-${featureNumber}\\.feature\``);
    assert.match(bodyOf(featureNumber), move);
  },
);

Then('the promotion issue for feature-{int} holds the command {string}', function (featureNumber: number, command: string) {
  assert.ok(bodyOf(featureNumber).includes(`\`${command}\``), `Expected the promotion issue to hold \`${command}\``);
});

Then('the promotion issue for feature-{int} names the vocabulary registry {string}', function (featureNumber: number, registryPath: string) {
  assert.ok(bodyOf(featureNumber).includes(`\`${registryPath}\``), `Expected the promotion issue to name \`${registryPath}\``);
});

Then('the promotion issue for feature-{int} does not contain the text {string}', function (featureNumber: number, text: string) {
  assert.ok(!bodyOf(featureNumber).includes(text), `Expected the promotion issue not to contain "${text}"`);
});

Then(
  'the promotion issue for feature-{int} tells the agent to remove the {string} tags from the moved feature',
  function (featureNumber: number, tagPrefix: string) {
    assert.match(bodyOf(featureNumber), new RegExp(`Remove the \`${escapeForRegExp(tagPrefix)}\` tags from the moved feature`));
  },
);

Then(
  'the promotion issue for feature-{int} does not ask for the moved feature\'s existing tags to be kept',
  function (featureNumber: number) {
    assert.doesNotMatch(bodyOf(featureNumber), /keep[^\n.]*(existing|its)[^\n.]*tags/i);
  },
);

Then(
  'the promotion issue for feature-{int} still tells the agent to add a feature-level {string} tag',
  function (featureNumber: number, tag: string) {
    assert.ok(bodyOf(featureNumber).includes(`Add a feature-level \`${tag}\` tag`), `Expected the promotion issue to say to add a feature-level ${tag} tag`);
  },
);
