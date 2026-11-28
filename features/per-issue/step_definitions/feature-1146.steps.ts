/**
 * The scenarios of feature-1146.feature run the real cron against a target repository whose Per-Issue Scenarios hold
 * Nominations and whose Promotion Proposal the owner decided or left open, with the cron's decision pass, its weekly Promotion
 * Proposal pass or its Per-Issue Sweep due. What the cron did is read from the forge writes the `gh` shadow recorded, the
 * target repository's default branch and the cron's output.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { labelsOf, outputTail, runCronWithSweepDue, seedMergedPullRequest } from './feature-1142-cron.ts';
import { addPerIssueScenario } from './feature-1142-target.ts';
import { PAST_THE_GRACE_PERIOD_MS, keepProposalOpen, theFiledProposal } from './feature-1145-proposal.ts';
import {
  OwnerClose,
  commentsPostedOn,
  decisionCommentAndClose,
  holdsDecisionRecord,
  isDeclineBranch,
  keepImplementationIssueOpen,
  mergedDeclinePullRequests,
  namesScenario,
  openedPullRequests,
  runDecisionPass,
  scenarioTagsOnDefaultBranch,
  seedClosedProposal,
  seedProposalOpenFor,
  seededProposalNumber,
  subjectOfLastCommitTo,
  theFiledImplementationIssue,
} from './feature-1146-decision.ts';

const CRON_STEP_TIMEOUT_MS = 180_000;
const OFFERED_COUNTS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3 };
const DECLINE_COMMIT = /^chore: decline /;
const NOMINATION_DECLINED_TAG = '@nomination-declined';
/** The sweep logs one of these only once it has read the usage report of its cucumber-js dry run. */
const USAGE_REPORT_READ: readonly RegExp[] = [/no unused step definitions/, /filed removal issue #\d+/, /is still open — not filing another/];

function offeredCount(word: string): number {
  const count = OFFERED_COUNTS[word];
  assert.ok(count !== undefined, `Expected the number of offered scenarios as one of ${Object.keys(OFFERED_COUNTS).join(', ')}, but got "${word}"`);
  return count;
}

/**
 * Leaves the mock forge's issues as they are, so the sweep reads the Promotion Proposal the scenario put there. The sweep
 * reads its dry run's usage report only after it has read its exemption, so the guard also proves the exemption was read.
 */
async function runSweepBesideTheProposal(world: RegressionWorld): Promise<void> {
  const output = await runCronWithSweepDue(world);
  assert.ok(
    USAGE_REPORT_READ.some((line) => line.test(output)),
    `Expected the sweep to have read the usage report of its cucumber-js dry run and decided about the removal issue. Last output:\n${outputTail(output)}`,
  );
}

function decisionRecorded(world: RegressionWorld): boolean {
  return decisionCommentAndClose(world, seededProposalNumber(world)).comment !== -1;
}

Given(
  'the owner closed as completed the Promotion Proposal offering those {word} scenarios, with {string} and {string} ticked',
  async function (this: RegressionWorld, offered: string, first: string, second: string) {
    await seedClosedProposal(this, OwnerClose.Completed, offeredCount(offered), [first, second]);
  },
);

Given(
  'the owner closed as completed the Promotion Proposal offering those {word} scenarios, with {string} ticked',
  async function (this: RegressionWorld, offered: string, ticked: string) {
    await seedClosedProposal(this, OwnerClose.Completed, offeredCount(offered), [ticked]);
  },
);

Given(
  'the owner closed as not planned the Promotion Proposal offering those {word} scenarios, with {string} ticked',
  async function (this: RegressionWorld, offered: string, ticked: string) {
    await seedClosedProposal(this, OwnerClose.NotPlanned, offeredCount(offered), [ticked]);
  },
);

Given('the owner closed as not planned the Promotion Proposal offering that scenario', async function (this: RegressionWorld) {
  await seedClosedProposal(this, OwnerClose.NotPlanned, 1, []);
});

Given(
  'the target repository holds the Per-Issue Scenario {string} of issue {int}, whose pull request merged {int} days ago, with the declined scenario {string}',
  async function (this: RegressionWorld, featurePath: string, issue: number, daysAgo: number, scenarioName: string) {
    addPerIssueScenario(this, featurePath, issue, scenarioName, NOMINATION_DECLINED_TAG);
    await seedMergedPullRequest(this, issue, daysAgo);
  },
);

Given('the Promotion Proposal offering that scenario has been open for {int} days', async function (this: RegressionWorld, days: number) {
  await seedProposalOpenFor(this, days);
});

When('the cron runs with its Promotion Proposal decision pass due', { timeout: CRON_STEP_TIMEOUT_MS }, async function (this: RegressionWorld) {
  await runDecisionPass(this);
});

When(
  'the cron is restarted and runs again with its Promotion Proposal decision pass due',
  { timeout: CRON_STEP_TIMEOUT_MS },
  async function (this: RegressionWorld) {
    await keepImplementationIssueOpen(this);
    await runDecisionPass(this);
  },
);

Then('the cron filed exactly one implementation issue in the target repository', function (this: RegressionWorld) {
  theFiledImplementationIssue(this);
});

Then(
  'that implementation issue carries the labels {string} and {string} and not the label {string}',
  function (this: RegressionWorld, first: string, second: string, absent: string) {
    const issue = theFiledImplementationIssue(this);
    const labels = labelsOf(this, issue.number);
    const missing = [first, second].filter((label) => !labels.includes(label));
    assert.deepStrictEqual(missing, [], `Expected implementation issue #${issue.number} to carry ${first} and ${second}, but its labels are: ${labels.join(', ') || 'none'}`);
    assert.ok(!labels.includes(absent), `Expected implementation issue #${issue.number} not to carry ${absent}, but its labels are: ${labels.join(', ')}`);
  },
);

Then('that implementation issue links the Promotion Proposal', function (this: RegressionWorld) {
  const issue = theFiledImplementationIssue(this);
  const link = `Promotes: Promotion Proposal #${seededProposalNumber(this)}`;
  assert.ok(issue.body.split('\n').some((line) => line.trim() === link), `Expected implementation issue #${issue.number} to hold the line "${link}", but its body is:\n${issue.body}`);
});

Then(
  'that implementation issue names the scenario {string} of issue {int} and the scenario {string} of issue {int}',
  function (this: RegressionWorld, firstName: string, firstIssue: number, secondName: string, secondIssue: number) {
    const issue = theFiledImplementationIssue(this);
    const keys = [{ issueNumber: firstIssue, scenarioName: firstName }, { issueNumber: secondIssue, scenarioName: secondName }];
    const unnamed = keys.filter((key) => !namesScenario(issue, key)).map((key) => `"${key.scenarioName}" of issue ${key.issueNumber}`);
    assert.deepStrictEqual(unnamed, [], `Expected implementation issue #${issue.number} to name ${unnamed.join(' and ')}, but its body is:\n${issue.body}`);
  },
);

Then('that implementation issue names the scenario {string} of issue {int}', function (this: RegressionWorld, scenarioName: string, issueNumber: number) {
  const issue = theFiledImplementationIssue(this);
  assert.ok(namesScenario(issue, { issueNumber, scenarioName }), `Expected implementation issue #${issue.number} to name "${scenarioName}" of issue ${issueNumber}, but its body is:\n${issue.body}`);
});

Then('that implementation issue does not name the scenario {string} of issue {int}', function (this: RegressionWorld, scenarioName: string, issueNumber: number) {
  const issue = theFiledImplementationIssue(this);
  assert.ok(!namesScenario(issue, { issueNumber, scenarioName }), `Expected implementation issue #${issue.number} not to name "${scenarioName}" of issue ${issueNumber}, but its body is:\n${issue.body}`);
  assert.ok(!issue.body.includes(scenarioName), `Expected implementation issue #${issue.number} not to mention "${scenarioName}", but its body is:\n${issue.body}`);
});

Then(
  "the cron's merged sweep pull request replaced {string} with {string} on the scenario {string} of issue {int}",
  function (this: RegressionWorld, replaced: string, replacement: string, scenarioName: string, issue: number) {
    const merged = mergedDeclinePullRequests(this);
    assert.ok(merged.length > 0, `Expected the cron to have opened and merged a pull request declining the Nominations. Last output:\n${outputTail(this.lastOutput)}`);
    const tags = scenarioTagsOnDefaultBranch(this, issue, scenarioName);
    assert.ok(tags.includes(replacement) && !tags.includes(replaced), `Expected "${scenarioName}" of issue ${issue} to carry ${replacement} in place of ${replaced} on the default branch, but its tags are: ${tags.join(' ')}`);
    assert.match(subjectOfLastCommitTo(this, issue), DECLINE_COMMIT, `Expected the decline commit, merged through pull request #${merged.join(', #')}, to have changed the scenario of issue ${issue}`);
  },
);

Then(
  "the scenario {string} of issue {int} does not carry {string} on the target repository's default branch",
  function (this: RegressionWorld, scenarioName: string, issue: number, tag: string) {
    const tags = scenarioTagsOnDefaultBranch(this, issue, scenarioName);
    assert.ok(!tags.includes(tag), `Expected "${scenarioName}" of issue ${issue} not to carry ${tag} on the default branch, but its tags are: ${tags.join(' ')}`);
  },
);

Then('the cron commented on that Promotion Proposal and closed it', function (this: RegressionWorld) {
  const proposal = seededProposalNumber(this);
  const { comment, close } = decisionCommentAndClose(this, proposal);
  assert.ok(comment !== -1, `Expected the cron to have left its decision record on Promotion Proposal #${proposal}. Last output:\n${outputTail(this.lastOutput)}`);
  assert.ok(close > comment, `Expected the cron to have closed Promotion Proposal #${proposal} after commenting on it. Last output:\n${outputTail(this.lastOutput)}`);
});

Then('the cron commented on that Promotion Proposal exactly once', function (this: RegressionWorld) {
  const proposal = seededProposalNumber(this);
  const comments = commentsPostedOn(this, proposal);
  assert.strictEqual(
    comments.length,
    1,
    `Expected the cron, across all its runs, to have commented on Promotion Proposal #${proposal} exactly once, but it commented ${comments.length} time(s):\n${comments.join('\n---\n') || 'none'}\nLast output:\n${outputTail(this.lastOutput)}`,
  );
  assert.ok(holdsDecisionRecord(comments[0]), `Expected the one comment on Promotion Proposal #${proposal} to hold the decision record, but it reads:\n${comments[0]}`);
});

When(
  'the cron runs again with its Per-Issue Sweep due, while the proposal its first run filed is still open',
  { timeout: CRON_STEP_TIMEOUT_MS },
  async function (this: RegressionWorld) {
    await keepProposalOpen(this, theFiledProposal(this), PAST_THE_GRACE_PERIOD_MS);
    await runSweepBesideTheProposal(this);
  },
);

When(
  'the cron runs with its Per-Issue Sweep due, before its decision pass has acted on that Promotion Proposal',
  { timeout: CRON_STEP_TIMEOUT_MS },
  async function (this: RegressionWorld) {
    assert.ok(!decisionRecorded(this), `Expected no decision record on Promotion Proposal #${seededProposalNumber(this)} yet`);
    await runSweepBesideTheProposal(this);
  },
);

When(
  'the cron runs again with its Per-Issue Sweep due, after its decision pass has acted on that Promotion Proposal',
  { timeout: CRON_STEP_TIMEOUT_MS },
  async function (this: RegressionWorld) {
    assert.ok(
      decisionRecorded(this),
      `Expected the cron's decision pass to have left its decision record on Promotion Proposal #${seededProposalNumber(this)} first. Last output:\n${outputTail(this.lastOutput)}`,
    );
    await runSweepBesideTheProposal(this);
  },
);

Then('the cron opened exactly one sweep pull request in the target repository', function (this: RegressionWorld) {
  const opened = openedPullRequests(this);
  assert.strictEqual(opened.length, 1, `Expected the cron to have opened exactly one pull request, but it opened ${opened.length}, from: ${opened.map((created) => created.head).join(', ') || 'none'}`);
  assert.ok(isDeclineBranch(opened[0].head), `Expected the one pull request the cron opened to decline Nominations, but it came from the branch ${opened[0].head}`);
});
