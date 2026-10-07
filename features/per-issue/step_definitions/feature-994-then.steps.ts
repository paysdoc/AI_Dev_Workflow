/**
 * Then steps of the feature-994 scenarios. Every assertion targets a runtime artefact: the proof the assembler returned or the
 * scenario test phase wrote, the tags the stand-in scenario runner was asked for, the uploads the stand-in screenshot store
 * received, the comments the recording issue tracker and code host received, and the proof the review agent was given.
 * "The scenario proof records ..." (T-S12, T-PY3) and "the ADW TypeScript type-check passes" (T22) are the regression suite's.
 */

import { Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import {
  assertImagesCanBeOpened,
  assertShowsExactly,
  distinctImagesReceived,
  evidencePaths,
  expectedImageBytes,
  imageSources,
  lastCommentHeaded,
  lastProofReceived,
  mentionsAnImageFile,
} from './feature-994-evidence.ts';
import { tagsAskedFor } from './feature-994-runner.ts';
import { proofDocument, requireRunner, requireStore, s } from './feature-994-world.ts';
import * as path from 'path';

function imageNames(table: DataTable): string[] {
  return table.hashes().map(row => row['image']);
}

Then('the scenario proof states {string}', function (text: string) {
  const document = proofDocument();
  assert.ok(document.includes(text), `Expected the scenario proof to state "${text}".\n${document}`);
});

Then('the scenario proof does not state {string}', function (text: string) {
  const document = proofDocument();
  assert.ok(!document.includes(text), `Expected the scenario proof not to state "${text}".\n${document}`);
});

Then('the stand-in scenario runner was asked for the tags {string} and {string}, and for no other tag', function (first: string, second: string) {
  assert.deepStrictEqual([...tagsAskedFor(requireRunner())].sort(), [first, second].sort());
});

Then('the screenshot store received exactly these images, and nothing else:', function (table: DataTable) {
  const received = distinctImagesReceived().sort();
  assert.deepStrictEqual(received, expectedImageBytes(imageNames(table)).sort(), `Expected the screenshot store to receive exactly ${JSON.stringify(imageNames(table))}; it received ${JSON.stringify(requireStore().uploads.map(upload => upload.key))}`);
});

Then('nothing was uploaded to the screenshot store', function () {
  assert.deepStrictEqual(requireStore().uploads.map(upload => upload.key), [], 'Expected the screenshot store to have received no upload');
});

Then(
  'the {string} comment on issue {int} shows exactly these images, each embedded from a URL the screenshot store returned for it:',
  function (heading: string, issueNumber: number, table: DataTable) {
    const { body } = lastCommentHeaded(s.issueComments, issueNumber, heading);
    assertShowsExactly([body], imageNames(table), `the "${heading}" comment on issue ${issueNumber}`);
  },
);

Then('the {string} comment on issue {int} shows no image', function (heading: string, issueNumber: number) {
  const { body } = lastCommentHeaded(s.issueComments, issueNumber, heading);
  assert.deepStrictEqual(imageSources(body), [], `Expected the "${heading}" comment to show no image.\n${body}`);
});

Then(
  'the comments on pull request {int} show exactly these images, each embedded from a URL the screenshot store returned for it:',
  function (pullRequestNumber: number, table: DataTable) {
    const bodies = s.pullRequestComments.filter(comment => comment.number === pullRequestNumber).map(comment => comment.body);
    assert.ok(bodies.length > 0, `Expected pull request ${pullRequestNumber} to have received a comment`);
    assertShowsExactly(bodies, imageNames(table), `the comments on pull request ${pullRequestNumber}`);
  },
);

Then('no comment on pull request {int} shows an image', function (pullRequestNumber: number) {
  const bodies = s.pullRequestComments.filter(comment => comment.number === pullRequestNumber).map(comment => comment.body);
  assert.deepStrictEqual(bodies.flatMap(imageSources), [], `Expected no comment on pull request ${pullRequestNumber} to show an image.\n${bodies.join('\n---\n')}`);
});

Then('the review agent received, with the proof, the paths of exactly these images:', function (table: DataTable) {
  const paths = evidencePaths(lastProofReceived().content);
  const names = paths.map(imagePath => path.basename(imagePath));
  assert.deepStrictEqual([...names].sort(), [...imageNames(table)].sort(), `Expected the proof to give the paths of exactly ${JSON.stringify(imageNames(table))}; it gives ${JSON.stringify(paths)}`);
  assertImagesCanBeOpened(paths);
});

Then('the review agent received no image path with the proof', function () {
  const { content } = lastProofReceived();
  assert.deepStrictEqual(evidencePaths(content), [], `Expected the proof to give no image path.\n${content}`);
  assert.ok(!mentionsAnImageFile(content), `Expected the proof to name no image file.\n${content}`);
});

Then('the proof the review agent received states {string}', function (text: string) {
  const { content } = lastProofReceived();
  assert.ok(content.includes(text), `Expected the proof the review agent received to state "${text}".\n${content}`);
});

Then('the proof the review agent received does not state {string}', function (text: string) {
  const { content } = lastProofReceived();
  assert.ok(!content.includes(text), `Expected the proof the review agent received not to state "${text}".\n${content}`);
});
