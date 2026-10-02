/**
 * Then steps of feature-934.feature about the sweep's report, the remote default branch, the pull
 * requests and the cron host's checkout. The promotion issue's text is asserted in
 * `feature-934-issue.steps.ts`; the regression listing in `feature-934-regression.steps.ts`.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';

import { REWRITTEN_DESCRIPTION } from './feature-934-scoring.ts';
import {
  directPushAttempts,
  git,
  isoDay,
  leftoverWorktreeDirs,
  readOnDefault,
  snapshotHost,
  trackedOnDefault,
  worktreesOf,
} from './feature-934-target.ts';
import { filedIssues, mergedPullRequests, requireReport } from './feature-934-observed.ts';
import { requireForge, requireTarget, world } from './feature-934-world.ts';

const PER_ISSUE_DIR = 'features/per-issue';
const SUGGESTED_PREFIX = '@promotion-suggested-';
const DECLINED_TAG = '@promotion-declined';

function featurePathOf(featureNumber: number): string {
  return `${PER_ISSUE_DIR}/feature-${featureNumber}.feature`;
}

function featureOnDefault(featureNumber: number): string {
  const text = readOnDefault(requireTarget(), featurePathOf(featureNumber));
  assert.ok(text !== null, `Expected feature-${featureNumber} to be tracked on the remote default branch`);
  return text;
}

/** Every token of every tag line: a line is a tag line when all its whitespace-separated tokens start with `@`. */
function tagTokens(featureText: string): string[] {
  return featureText
    .split('\n')
    .map(line => line.trim().split(/\s+/).filter(Boolean))
    .filter(tokens => tokens.length > 0 && tokens.every(token => token.startsWith('@')))
    .flat();
}

function reportedAs(featureNumber: number, status: string): boolean {
  const report = requireReport();
  const filePath = featurePathOf(featureNumber);
  switch (status) {
    case 'originated': return report.originated.includes(featureNumber);
    case 'redriven': return report.redriven.includes(featureNumber);
    case 'declined': return report.declined.includes(filePath);
    case 'withdrawn': return report.withdrawn.includes(filePath);
    case 'left': return report.left.includes(filePath);
    default: throw new Error(`Unknown sweep outcome "${status}"`);
  }
}

Then('the computed promotion threshold is {int}', function (expected: number) {
  assert.strictEqual(requireReport().threshold, expected);
});

Then('the sweep reports feature-{int} as {string}', function (featureNumber: number, status: string) {
  assert.ok(reportedAs(featureNumber, status), `Expected the sweep to report feature-${featureNumber} as "${status}". Report: ${JSON.stringify(requireReport())}`);
});

Then('the sweep does not report feature-{int} as {string}', function (featureNumber: number, status: string) {
  assert.ok(!reportedAs(featureNumber, status), `Expected the sweep not to report feature-${featureNumber} as "${status}". Report: ${JSON.stringify(requireReport())}`);
});

Then(
  'feature-{int} on the remote default branch carries a {string} tag dated today',
  function (featureNumber: number, tagPrefix: string) {
    const today = isoDay(new Date().toISOString());
    const dated = tagTokens(featureOnDefault(featureNumber)).filter(token => token.startsWith(tagPrefix));
    assert.deepStrictEqual(dated, [`${tagPrefix}${today}`], `Expected feature-${featureNumber} to carry ${tagPrefix}${today}`);
  },
);

Then('feature-{int} on the remote default branch carries no promotion marker', function (featureNumber: number) {
  const markers = tagTokens(featureOnDefault(featureNumber)).filter(token => token.startsWith(SUGGESTED_PREFIX) || token === DECLINED_TAG);
  assert.deepStrictEqual(markers, [], `Expected feature-${featureNumber} to carry no promotion marker`);
});

Then('feature-{int} on the remote default branch carries no {string} tag', function (featureNumber: number, tagPrefix: string) {
  const found = tagTokens(featureOnDefault(featureNumber)).filter(token => token.startsWith(tagPrefix));
  assert.deepStrictEqual(found, [], `Expected feature-${featureNumber} to carry no ${tagPrefix} tag`);
});

Then(
  'feature-{int} on the remote default branch carries the {string} tag and no {string} tag',
  function (featureNumber: number, tag: string, absentPrefix: string) {
    const tokens = tagTokens(featureOnDefault(featureNumber));
    assert.ok(tokens.includes(tag), `Expected feature-${featureNumber} to carry ${tag}. Tags: ${tokens.join(' ')}`);
    assert.deepStrictEqual(tokens.filter(token => token.startsWith(absentPrefix)), [], `Expected feature-${featureNumber} to carry no ${absentPrefix} tag`);
  },
);

Then('feature-{int} on the remote default branch still holds its rewritten description', function (featureNumber: number) {
  assert.ok(featureOnDefault(featureNumber).includes(REWRITTEN_DESCRIPTION), `Expected feature-${featureNumber} to keep the description rewritten after the cron host's checkout was taken`);
});

Then('the remote default branch still tracks {string}', function (relPath: string) {
  assert.ok(trackedOnDefault(requireTarget(), relPath), `Expected ${relPath} to be tracked on the remote default branch`);
});

Then('the sweep filed {int} promotion issue(s) for feature-{int}', function (count: number, featureNumber: number) {
  const filed = filedIssues(requireForge(), featureNumber);
  assert.strictEqual(filed.length, count, `Expected ${count} promotion issue(s) for feature-${featureNumber}, found ${filed.length}`);
});

Then('the marker change reached {string} through a merged pull request from a dedicated branch', function (branch: string) {
  const target = requireTarget();
  const merged = mergedPullRequests(requireForge());
  assert.ok(merged.length > 0, 'Expected a pull request to have been merged');
  const mergeSubjects = git(target.remote, ['log', '--merges', '--format=%s', branch]).split('\n');
  for (const pr of merged) {
    assert.notStrictEqual(pr.sourceBranch, branch, 'Expected the pull request to come from a branch other than the default branch');
    assert.ok(mergeSubjects.includes(`Merge pull request #${pr.number} from ${pr.sourceBranch}`), `Expected "${branch}" to hold the merge of pull request #${pr.number}`);
  }
});

Then('that pull request changed only {string}', function (relPath: string) {
  const merged = mergedPullRequests(requireForge());
  assert.strictEqual(merged.length, 1, `Expected exactly one merged pull request, found ${merged.length}`);
  assert.deepStrictEqual(merged[0].files, [relPath]);
});

Then('no direct push to {string} was attempted', function (branch: string) {
  const target = requireTarget();
  assert.strictEqual(branch, target.defaultBranch, 'The target only records pushes to its default branch');
  assert.deepStrictEqual(directPushAttempts(target), [], `Expected no direct push to "${branch}"`);
});

Then('the cron host\'s checkout is still on {string} at the commit it started on', function (branch: string) {
  const started = world.hostAtStart;
  assert.ok(started, 'Expected the promotion sweep to have run first');
  const now = snapshotHost(requireTarget());
  assert.strictEqual(now.branch, branch);
  assert.strictEqual(started.branch, branch, `Expected the checkout to start on "${branch}"`);
  assert.strictEqual(now.head, started.head, 'Expected the checkout to be at the commit it started on');
});

Then('the cron host\'s checkout has no uncommitted change', function () {
  assert.strictEqual(snapshotHost(requireTarget()).status, '', 'Expected a clean cron host checkout');
});

Then('the cron host\'s checkout still holds its uncommitted change to {string}', function (changedFile: string) {
  const target = requireTarget();
  const started = world.hostAtStart;
  assert.ok(started, 'Expected the promotion sweep to have run first');
  assert.strictEqual(snapshotHost(target).status, started.status, 'Expected the checkout\'s uncommitted state to be unchanged');
  assert.ok(started.status.includes(changedFile), `Expected ${changedFile} to be modified in the checkout`);
  assert.ok(readFileSync(path.join(target.hostCheckout, changedFile), 'utf-8').includes('An uncommitted note.'));
});

Then('the sweep left no worktree behind in the cron host\'s checkout', function () {
  const target = requireTarget();
  assert.strictEqual(worktreesOf(target).length, 1, `Expected only the checkout itself, found: ${worktreesOf(target).join(', ')}`);
  assert.deepStrictEqual(leftoverWorktreeDirs(target), []);
});

Then('the per-issue scenario sweep removed no file', function () {
  assert.deepStrictEqual(world.perIssueRemoved, [], 'Expected the per-issue scenario sweep to remove nothing');
});
