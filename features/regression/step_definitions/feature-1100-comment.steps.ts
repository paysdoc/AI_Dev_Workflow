/**
 * The Thens of the in-process feature-1100 scenarios that read the comment a blocked merge leaves on the issue. The comment lists
 * what was tried, one fact to a line ("Merge attempts: 5"), and each Then reads the line it is about, so a failure names the
 * number or the wording the comment gave instead of only that a substring is missing.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { requireWorkflow } from '../../regression/step_definitions/feature-1100-world.ts';

function commentsOn(issueNumber: number, heading: string): string[] {
  return requireWorkflow().forge.comments
    .filter((comment) => comment.issueNumber === issueNumber && comment.body.includes(heading))
    .map((comment) => comment.body);
}

/** The one comment of that name on the issue, which every Then below reads. */
function theComment(name: string, issueNumber: number): string {
  const found = commentsOn(issueNumber, name);
  assert.strictEqual(found.length, 1, `Expected exactly one "${name}" comment on issue ${issueNumber}, but found ${found.length}`);
  return found[0];
}

function factLine(comment: string, label: string): string | undefined {
  return new RegExp(`^[-*]?\\s*${label}:\\s*(.*)$`, 'm').exec(comment)?.[1].trim();
}

/** `expected` is the whole of the line's text, or only its start when the line goes on to explain itself. */
function assertFact(name: string, issueNumber: number, label: string, expected: string, matching: 'whole line' | 'start of line' = 'whole line'): void {
  const comment = theComment(name, issueNumber);
  const actual = factLine(comment, label);
  const holds = matching === 'whole line' ? actual === expected : actual?.startsWith(expected) === true;
  const found = actual === undefined ? `has no "${label}" line` : `says "${label}: ${actual}"`;
  assert.ok(holds, `Expected the "${name}" comment to say "${label}: ${expected}"${matching === 'whole line' ? '' : '…'}, but it ${found}. The comment:\n${comment}`);
}

Then('issue {int} received exactly one {string} comment', function (issueNumber: number, heading: string) {
  const received = commentsOn(issueNumber, heading).length;
  assert.strictEqual(received, 1, `Expected issue ${issueNumber} to receive exactly one "${heading}" comment, but it received ${received}`);
});

Then('the {string} comment on issue {int} says that there were {int} merge attempts', function (name: string, issueNumber: number, attempts: number) {
  assertFact(name, issueNumber, 'Merge attempts', String(attempts));
});

Then(
  /^the "([^"]*)" comment on issue (\d+) says that conflict resolution (ran|did not run)$/,
  function (name: string, issueNumber: string, resolution: string) {
    assertFact(name, Number(issueNumber), 'Conflict resolution', resolution);
  },
);

Then('the {string} comment on issue {int} says that the local merge check was clean against {string}', function (name: string, issueNumber: number, baseBranch: string) {
  assertFact(name, issueNumber, 'Local merge check', `clean against \`origin/${baseBranch}\``, 'start of line');
});

Then('the {string} comment on issue {int} says that the local merge check found conflicts with {string}', function (name: string, issueNumber: number, baseBranch: string) {
  assertFact(name, issueNumber, 'Local merge check', `found conflicts with \`origin/${baseBranch}\``);
});

Then('the {string} comment on issue {int} quotes the last error {string}', function (name: string, issueNumber: number, error: string) {
  assertFact(name, issueNumber, 'Last error', error);
});

Then('the {string} comment on issue {int} does not contain {string}', function (name: string, issueNumber: number, text: string) {
  const comment = theComment(name, issueNumber);
  assert.ok(!comment.includes(text), `Expected the "${name}" comment not to contain "${text}". The comment:\n${comment}`);
});
