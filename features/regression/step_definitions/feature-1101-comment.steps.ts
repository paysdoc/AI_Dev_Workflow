/**
 * The Thens of the in-process feature-1101 scenarios that read the "ADW Parked" comment a red re-run leaves on the issue. The
 * comment is a run of paragraphs: what was merged in and the commits as bullets, which files conflicted, what failed (each
 * failure a title in a code span and its error quoted beneath), then the plain statement and the remedy. Each Then reads the
 * paragraph it is about, so a failure names what the comment gave instead of only that a substring is missing.
 */

import { Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { onelineBetween } from './feature-1101-repo.ts';
import { assertNamesThe, requireWorkflow } from './feature-1101-world.ts';

const COMMITS_LEAD = 'These commits came in from';
const CONFLICTS_LEAD = 'These files conflicted';
const NO_CONFLICTS = 'No file conflicted';
const FAILURES_LEAD = 'What failed on the branch merged with';
const QUOTE_INDENT = /^ {4}/;
const ONELINE_FORM = 'git log --oneline';

interface ListedFailure {
  readonly title: string;
  readonly detail: string;
}

function parkComments(issueNumber: number, name: string): string[] {
  return requireWorkflow().forge.comments.filter((comment) => comment.issueNumber === issueNumber && comment.body.includes(name)).map((comment) => comment.body);
}

function theComment(name: string, issueNumber: number): string {
  const found = parkComments(issueNumber, name);
  assert.strictEqual(found.length, 1, `Expected exactly one "${name}" comment on issue ${issueNumber}, but found ${found.length}`);
  return found[0];
}

const paragraphsOf = (comment: string): string[] => comment.split(/\n\s*\n/);

/** The lines of the bullet list that follows the paragraph starting with `lead`, each without its bullet and its code span. */
function bulletsAfter(comment: string, lead: string): string[] {
  const paragraphs = paragraphsOf(comment);
  const at = paragraphs.findIndex((paragraph) => paragraph.startsWith(lead));
  assert.ok(at >= 0, `Expected the comment to have a paragraph starting "${lead}". The comment:\n${comment}`);
  return (paragraphs[at + 1] ?? '').split('\n').map((line) => /^- `+ ?(.*?) ?`+$/.exec(line)?.[1] ?? line);
}

function failuresListed(comment: string): ListedFailure[] {
  const paragraphs = paragraphsOf(comment);
  const at = paragraphs.findIndex((paragraph) => paragraph.startsWith(FAILURES_LEAD));
  assert.ok(at >= 0, `Expected the comment to have a paragraph starting "${FAILURES_LEAD}". The comment:\n${comment}`);

  const failures: ListedFailure[] = [];
  for (let index = at + 1; index + 1 < paragraphs.length; index += 2) {
    const title = /^`+ ?([\s\S]*?) ?`+$/.exec(paragraphs[index])?.[1];
    if (title === undefined) break;
    failures.push({ title, detail: paragraphs[index + 1].split('\n').map((line) => line.replace(QUOTE_INDENT, '')).join('\n') });
  }
  return failures;
}

const subjectOf = (line: string): string => line.slice(line.indexOf(' ') + 1);

Then(
  'the {string} comment on issue {int} lists, in {string} form, exactly these commits merged in from {string}:',
  function (name: string, issueNumber: number, form: string, baseBranch: string, table: DataTable) {
    assert.strictEqual(form, ONELINE_FORM, `Only the "${ONELINE_FORM}" form is listed, but the step names "${form}"`);
    const workflow = requireWorkflow();
    assertNamesThe('base branch', workflow.baseBranch, baseBranch);
    const oldHead = workflow.runs[workflow.runs.length - 1]?.branchTipBefore;
    assert.ok(oldHead, 'Expected adwMerge to have run, so that the commits it merged in can be counted from the branch it found');

    const listed = bulletsAfter(theComment(name, issueNumber), COMMITS_LEAD);
    const printed = onelineBetween(workflow.repo, oldHead);
    assert.deepStrictEqual([...listed].sort(), [...printed].sort(), `Expected the comment to list what ${ONELINE_FORM} ${oldHead}..origin/${baseBranch} prints`);
    const expectedSubjects = table.hashes().map((row) => row['commit']);
    assert.deepStrictEqual(listed.map(subjectOf).sort(), [...expectedSubjects].sort(), 'Expected the commits listed to be the ones the scenario names');
  },
);

Then('the {string} comment on issue {int} names no conflicted file', function (name: string, issueNumber: number) {
  const comment = theComment(name, issueNumber);
  assert.ok(comment.includes(NO_CONFLICTS), `Expected the comment to say that "${NO_CONFLICTS}". The comment:\n${comment}`);
  assert.ok(!comment.includes(CONFLICTS_LEAD), `Expected the comment to name no conflicted file. The comment:\n${comment}`);
});

Then('the {string} comment on issue {int} names {string} as the only file that conflicted', function (name: string, issueNumber: number, file: string) {
  assert.deepStrictEqual(bulletsAfter(theComment(name, issueNumber), CONFLICTS_LEAD), [file], `Expected "${file}" to be the only file the comment names as conflicted`);
});

Then('the {string} comment on issue {int} names the failing scenario {string} with its error {string}', function (name: string, issueNumber: number, scenario: string, error: string) {
  const comment = theComment(name, issueNumber);
  const failure = failuresListed(comment).find((listed) => listed.title.endsWith(scenario));
  assert.ok(failure, `Expected the comment to list a failure of the scenario "${scenario}". The comment:\n${comment}`);
  assert.strictEqual(failure.detail, error, `Expected the error of "${scenario}" to be "${error}"`);
});

function assertSays(name: string, issueNumber: number, text: string): void {
  const comment = theComment(name, issueNumber);
  assert.ok(comment.includes(text), `Expected the "${name}" comment to say "${text}". The comment:\n${comment}`);
}

Then('the {string} comment on issue {int} says that the branch passed on its own and fails combined with {string}', function (name: string, issueNumber: number, baseBranch: string) {
  assertSays(name, issueNumber, `The branch passed on its own and fails combined with \`${baseBranch}\`.`);
});

Then('the {string} comment on issue {int} tells the reader to fix the branch by hand and push, or to comment {string}', function (name: string, issueNumber: number, directive: string) {
  assertSays(name, issueNumber, `Fix by hand and push, or comment \`${directive}\`.`);
});

Then('the {string} comment on issue {int} says that either way ADW re-runs the scenarios, attempts fixes, re-reviews and merges', function (name: string, issueNumber: number) {
  assertSays(name, issueNumber, 'Either way ADW re-runs the scenarios, attempts fixes, re-reviews and merges.');
});
