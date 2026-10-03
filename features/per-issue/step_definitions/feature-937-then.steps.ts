/**
 * Then steps of the review-screenshots scenarios. Every assertion targets a runtime artefact: the
 * comments the recording issue tracker received, the uploads the stand-in screenshot store received
 * (and the URL it answered each with), and what the review phase returned or threw.
 */

import { Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import {
  fixtureBytes,
  requireStore,
  screenshotsIn,
  world,
  type RecordedComment,
} from './feature-937-world.ts';

const VERDICTS: Readonly<Record<string, boolean>> = { passing: true, failing: false };

// The first `## ` line is the comment's heading; the review comments carry an emoji shortcode before the title.
function headingOf(body: string): string {
  return body.split('\n').find(line => line.startsWith('## ')) ?? '';
}

function lastCommentHeaded(issueNumber: number, text: string): RecordedComment {
  const onIssue = world.comments.filter(comment => comment.issueNumber === issueNumber);
  const matching = onIssue.filter(comment => headingOf(comment.body).includes(text));
  assert.ok(
    matching.length > 0,
    `Expected issue ${issueNumber} to have received a comment headed "${text}"; its comments were headed: ${
      onIssue.map(comment => headingOf(comment.body)).join(' | ') || '(none)'
    }`,
  );
  return matching[matching.length - 1];
}

function imageSources(body: string): string[] {
  return [...body.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)].map(match => match[1].trim());
}

function urlsReturnedFor(relPath: string): string[] {
  const bytes = fixtureBytes(relPath);
  return requireStore().uploads.flatMap(upload => (upload.url !== null && upload.bytes.equals(bytes) ? [upload.url] : []));
}

function assertShowsExactly(comment: RecordedComment, listed: readonly string[]): void {
  const sources = imageSources(comment.body);
  const notEmbedded = listed.filter(relPath => !urlsReturnedFor(relPath).some(url => sources.includes(url)));
  assert.deepStrictEqual(
    notEmbedded,
    [],
    `Expected every listed screenshot to be embedded from a URL its upload returned. Image sources in the comment: ${JSON.stringify(sources)}\n${comment.body}`,
  );

  const allowed = listed.flatMap(urlsReturnedFor);
  const unexpected = sources.filter(source => !allowed.includes(source));
  assert.deepStrictEqual(
    unexpected,
    [],
    `Expected no image but the listed screenshots, each from a URL its upload returned.\n${comment.body}`,
  );
}

function assertStoreReceivedOnly(listed: readonly string[]): void {
  const { uploads } = requireStore();
  const listedBytes = listed.map(fixtureBytes);
  const notUploaded = listed.filter(relPath => !uploads.some(upload => upload.bytes.equals(fixtureBytes(relPath))));
  assert.deepStrictEqual(
    notUploaded,
    [],
    `Expected every listed screenshot to have been uploaded at least once. The store received: ${JSON.stringify(uploads.map(upload => upload.key))}`,
  );

  const unexpected = uploads.filter(upload => !listedBytes.some(bytes => bytes.equals(upload.bytes)));
  assert.deepStrictEqual(
    unexpected.map(upload => ({ key: upload.key, text: upload.bytes.toString() })),
    [],
    'Expected the store to receive nothing but the listed screenshots',
  );
}

function returnedVerdict(): { readonly reviewPassed: boolean } {
  const { outcome } = world;
  assert.ok(outcome, 'Expected the scenario tests and the review phase to have run');
  if (!outcome.returned) assert.fail(`Expected the review phase to return, but it threw:\n${outcome.failure}`);
  return outcome;
}

Then('the review phase returned a {word} verdict', function (verdict: string) {
  assert.ok(verdict in VERDICTS, `Unknown verdict "${verdict}"; the scenarios say "passing" or "failing"`);
  assert.strictEqual(returnedVerdict().reviewPassed, VERDICTS[verdict]);
});

Then('issue {int} received a comment headed {string}', function (issueNumber: number, heading: string) {
  lastCommentHeaded(issueNumber, heading);
});

Then(
  'the {string} comment on issue {int} shows exactly these screenshots, each embedded as an image from a URL its upload returned:',
  function (heading: string, issueNumber: number, table: DataTable) {
    assertShowsExactly(lastCommentHeaded(issueNumber, heading), screenshotsIn(table));
  },
);

Then(
  'the {string} comment on issue {int} still lists the blocker {string}',
  function (heading: string, issueNumber: number, blocker: string) {
    const { body } = lastCommentHeaded(issueNumber, heading);
    assert.ok(body.includes(blocker), `Expected the "${heading}" comment to list the blocker "${blocker}".\n${body}`);
  },
);

Then('the {string} comment on issue {int} embeds no image', function (heading: string, issueNumber: number) {
  const { body } = lastCommentHeaded(issueNumber, heading);
  assert.deepStrictEqual(imageSources(body), [], `Expected the "${heading}" comment to embed no image.\n${body}`);
});

Then('the screenshot store received uploads of these screenshots and of nothing else:', function (table: DataTable) {
  assertStoreReceivedOnly(screenshotsIn(table));
});

Then('the screenshot store received no upload', function () {
  assert.deepStrictEqual(
    requireStore().uploads.map(upload => upload.key),
    [],
    'Expected the screenshot store to have received no upload',
  );
});
