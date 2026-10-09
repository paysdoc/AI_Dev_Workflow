/**
 * The Then steps of feature-993. Everything is read from what the run left behind: the log of the dev server program, the
 * calls the stand-in `npx` recorded, the log of the wrapper around the Claude CLI stub, and the comments the process
 * posted. The state file, the park comment, the plan phase and the scenario fix agent are feature-990's and the regression
 * suite's. "Before the review patch agent was started" is the first start of `/patch`: a patch is the builder's answer to a
 * failed start, so whatever happened before it happened with the build as it was.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { isHeaded } from './feature-929-comments.ts';
import { commentsOn } from '../../regression/step_definitions/feature-929-workflow.ts';
import type { AgentStart } from './feature-990-read.ts';
import { requireWorkflowSetup } from './feature-990-world.ts';
import {
  describeEntries,
  describeRuns,
  failedStarts,
  issueScenarioRuns,
  issueScenarioRunsOf,
  issueServerLog,
  ranAt,
  reviewAgentStarts,
  reviewPatchAgentStarts,
  type ServerLogEntry,
} from './feature-993-read.ts';
import type { RecordedCall } from '../../regression/step_definitions/feature-992-standins.ts';

/** The comments a scenario names by the stage that posts them, and the heading each has. */
const COMMENT_HEADINGS: Readonly<Record<string, string>> = { review_failed: 'Review Failed' };

function firstReviewPatchAgentStart(): AgentStart {
  const [first] = reviewPatchAgentStarts();
  assert.ok(first, 'Expected the review patch agent to have been started');
  return first;
}

/** ADW writes each argument of a slash command in single quotes, so a quote inside an argument is written `'\''`. */
function unquoted(prompt: string): string {
  return prompt.split("'\\''").join("'");
}

function promptsOf(starts: readonly AgentStart[]): string {
  return starts.map(start => start.prompt).join('\n---\n') || '(none)';
}

function answeredItsHealthCheck(run: RecordedCall): boolean {
  const status = run.probes?.[0]?.status;
  return status !== null && status !== undefined && status < 400;
}

function assertScenariosPassedBefore(review: AgentStart): void {
  const preceding = issueScenarioRunsOf().filter(run => ranAt(run) < review.at);
  const last = preceding[preceding.length - 1];
  assert.ok(last, `Expected the issue's scenarios to have run on the issue's branch before the review agent started at ${review.at}, but the runs were:\n${describeRuns(issueScenarioRuns())}`);
  assert.ok(last.passed === true && answeredItsHealthCheck(last), `Expected the issue's scenarios to have passed against a dev server that answered before the review agent started at ${review.at}, but the last run was:\n${describeRuns([last])}`);
  const started = issueServerLog().filter(entry => entry.event === 'started' && entry.at <= ranAt(last));
  assert.ok(started.length > 0, `Expected a dev server to have been started on the issue's branch before that run, got:\n${describeEntries(issueServerLog())}`);
}

function entriesBetween(entries: readonly AgentStart[], after: number, before: number): AgentStart[] {
  return entries.filter(entry => entry.at > after && entry.at < before);
}

const lastTry = (start: readonly ServerLogEntry[]): number => start[start.length - 1]?.at ?? Number.NaN;
const firstTry = (start: readonly ServerLogEntry[]): number => start[0]?.at ?? Number.NaN;

Then("the dev server's start command ran {int} times on the issue's branch before the review patch agent was started", function (times: number) {
  const { at } = firstReviewPatchAgentStart();
  const before = issueServerLog().filter(entry => entry.event === 'attempt' && entry.at < at);
  assert.strictEqual(before.length, times, `Expected the start command to have run ${times} times on the issue's branch before the review patch agent started at ${at}, but the dev server logged:\n${describeEntries(issueServerLog())}`);
});

Then("no scenario was run on the issue's branch before the review patch agent was started", function () {
  const { at } = firstReviewPatchAgentStart();
  const before = issueScenarioRuns().filter(run => ranAt(run) < at);
  assert.deepStrictEqual(before, [], `Expected no scenario to have run on the issue's branch before the review patch agent started at ${at}, but these did:\n${describeRuns(before)}`);
});

Then("no scenario was run on the issue's branch", function () {
  const runs = issueScenarioRuns();
  assert.deepStrictEqual(runs, [], `Expected no scenario to have run on the issue's branch, but these did:\n${describeRuns(runs)}`);
});

Then('the review patch agent was handed a blocker that quotes {string} {int} time(s)', function (quoted: string, times: number) {
  const starts = reviewPatchAgentStarts();
  const handed = starts.filter(start => unquoted(start.prompt).includes(quoted));
  assert.strictEqual(handed.length, times, `Expected the review patch agent to have been handed a blocker that quotes "${quoted}" ${times} time(s), but it was started ${starts.length} time(s) with:\n${promptsOf(starts)}`);
});

Then("after the review patch the dev server was started on the issue's branch again, and answered its health check", function () {
  const { at } = firstReviewPatchAgentStart();
  const after = issueServerLog().filter(entry => entry.at > at);
  const started = after.find(entry => entry.event === 'started');
  assert.ok(started, `Expected the dev server to have been started on the issue's branch after the review patch agent started at ${at}, but it logged:\n${describeEntries(issueServerLog())}`);
  assert.ok(after.some(entry => entry.event === 'answered' && entry.at >= started.at), `Expected the dev server started at ${started.at} to have answered a request, but it logged:\n${describeEntries(issueServerLog())}`);
});

Then("the issue's scenarios ran against that dev server and passed", function () {
  const { at } = firstReviewPatchAgentStart();
  const started = issueServerLog().find(entry => entry.event === 'started' && entry.at > at);
  assert.ok(started, `Expected a dev server to have been started on the issue's branch after the review patch agent started at ${at}`);
  const runs = issueScenarioRunsOf().filter(run => ranAt(run) > started.at);
  assert.ok(runs.some(run => run.passed === true && answeredItsHealthCheck(run)), `Expected the issue's scenarios to have run and passed against the dev server started at ${started.at}, but the runs were:\n${describeRuns(issueScenarioRuns())}`);
});

Then('the workflow started the review agent {int} time(s)', function (times: number) {
  const starts = reviewAgentStarts();
  assert.strictEqual(starts.length, times, `Expected the workflow to have started the review agent ${times} time(s), but it started it ${starts.length} time(s)`);
});

Then('the workflow never started the review agent', function () {
  const starts = reviewAgentStarts();
  assert.deepStrictEqual(starts.map(start => start.at), [], 'Expected the workflow never to have started the review agent');
});

Then(
  "the workflow only ever started the review agent after the issue's scenarios had passed against a dev server started on the issue's branch",
  function () {
    const reviews = reviewAgentStarts();
    assert.ok(reviews.length > 0, 'Expected the workflow to have started the review agent');
    reviews.forEach(assertScenariosPassedBefore);
  },
);

Then("the dev server failed {int} start(s) on the issue's branch", function (times: number) {
  const starts = failedStarts();
  assert.strictEqual(starts.length, times, `Expected the dev server to have failed ${times} start(s) on the issue's branch, but it logged:\n${describeEntries(issueServerLog())}`);
});

Then('the review patch agent ran once between each failed start and the next, and not after the last', function () {
  const starts = failedStarts();
  assert.ok(starts.length > 0, 'Expected the dev server to have failed to start on the issue\'s branch');
  const patches = reviewPatchAgentStarts();

  starts.slice(0, -1).forEach((start, index) => {
    const between = entriesBetween(patches, lastTry(start), firstTry(starts[index + 1] ?? []));
    assert.strictEqual(between.length, 1, `Expected the review patch agent to have run once between failed start ${index + 1} and failed start ${index + 2}, but it ran ${between.length} time(s) then`);
  });
  const afterTheLast = patches.filter(patch => patch.at > lastTry(starts[starts.length - 1] ?? []));
  assert.deepStrictEqual(afterTheLast.map(patch => patch.at), [], 'Expected the review patch agent not to have run after the last failed start');
  assert.strictEqual(patches.length, starts.length - 1, `Expected the review patch agent to have run ${starts.length - 1} time(s) in all, but it ran ${patches.length} time(s)`);
});

Then('the {string} comment posted on issue {int} quotes {string}', function (stage: string, issue: number, quoted: string) {
  const heading = COMMENT_HEADINGS[stage];
  assert.ok(heading, `Unknown comment "${stage}"; the comments these scenarios read are: ${Object.keys(COMMENT_HEADINGS).join(', ')}`);
  const comments = commentsOn(issue).filter(body => isHeaded(body, heading));
  assert.ok(comments.length > 0, `Expected the "${stage}" comment on issue ${requireWorkflowSetup().issue}, but ${commentsOn(issue).length} comment(s) were posted:\n${commentsOn(issue).join('\n---\n')}`);
  comments.forEach(body => assert.ok(body.includes(quoted), `Expected the "${stage}" comment to quote "${quoted}", got:\n${body}`));
});
