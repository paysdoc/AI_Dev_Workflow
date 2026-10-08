/**
 * The Then steps of feature-990 that read the park comments a workflow posted. They complement feature-989's, which
 * this feature reuses for "is parked as", "names the failing check" and "no park comment was posted": these name an
 * issue where feature-989's builder steps do not, and cover the base-branch parks.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { assertDirectiveSays, parkCommentsOn, requireParkCommentOn } from './feature-989-comments.ts';

const QUOTE_INDENT = '    ';

function lastParkComment(issue: number): string {
  return requireParkCommentOn(issue);
}

Then('the park comment posted on issue {int} quotes {string}', function (issue: number, quoted: string) {
  const comment = lastParkComment(issue);
  const quotingLine = comment.split('\n').find(line => line.startsWith(QUOTE_INDENT) && line.includes(quoted));
  assert.ok(quotingLine, `Expected the park comment to quote "${quoted}" in an indented line, got:\n${comment}`);
});

Then('the park comment posted on issue {int} names the scenario {string}', function (issue: number, scenario: string) {
  const comment = lastParkComment(issue);
  assert.ok(comment.includes(`${scenario}\``), `Expected the park comment to name the scenario "${scenario}", got:\n${comment}`);
});

Then('the park comment posted on issue {int} says that it fails on the base branch {string}', function (issue: number, baseBranch: string) {
  const comment = lastParkComment(issue);
  const line = comment.split('\n').find(candidate => candidate.includes('fails on the base branch') && candidate.includes(`\`${baseBranch}\``));
  assert.ok(line, `Expected the park comment to say that it fails on the base branch "${baseBranch}", got:\n${comment}`);
});

Then('the park comment posted on issue {int} says that {string} re-runs the baseline and parks the issue again if it is still red', function (issue: number, directive: string) {
  assertDirectiveSays(lastParkComment(issue), directive, 're-runs the baseline and parks the issue again if it is still red');
});

Then('the park comment posted on issue {int} says that {string} waives the baseline, so that this run fixes the pre-existing failures too', function (issue: number, directive: string) {
  assertDirectiveSays(lastParkComment(issue), directive, 'waives the baseline, so that this run fixes the pre-existing failures too');
});

Then('the park comment posted on issue {int} says that {string} re-runs the scenario on the base branch and parks the issue again if it still fails there', function (issue: number, directive: string) {
  assertDirectiveSays(lastParkComment(issue), directive, 're-runs the scenario on the base branch and parks the issue again if it still fails there');
});

Then('the park comment posted on issue {int} says that {string} lets this run fix the pre-existing failure too', function (issue: number, directive: string) {
  assertDirectiveSays(lastParkComment(issue), directive, 'lets this run fix the pre-existing failure too');
});

Then('a second park comment was posted on issue {int}, naming the failing check {string}', function (issue: number, check: string) {
  const parks = parkCommentsOn(issue);
  assert.strictEqual(parks.length, 2, `Expected a second park comment on issue ${issue}, but ${parks.length} park comment(s) were posted`);
  assert.ok(parks[1]?.includes(`\`${check}\``), `Expected the second park comment to name the failing check "${check}", got:\n${parks[1]}`);
});

Then('a second park comment was posted on issue {int}, naming the scenario {string}', function (issue: number, scenario: string) {
  const parks = parkCommentsOn(issue);
  assert.strictEqual(parks.length, 2, `Expected a second park comment on issue ${issue}, but ${parks.length} park comment(s) were posted`);
  assert.ok(parks[1]?.includes(`${scenario}\``), `Expected the second park comment to name the scenario "${scenario}", got:\n${parks[1]}`);
});

Then('no second park comment was posted on issue {int}', function (issue: number) {
  const parks = parkCommentsOn(issue);
  assert.ok(parks.length <= 1, `Expected no second park comment on issue ${issue}, but ${parks.length} were posted:\n${parks.join('\n---\n')}`);
});
