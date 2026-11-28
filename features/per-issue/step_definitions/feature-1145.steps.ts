/**
 * The scenarios of feature-1145.feature run the real cron against a target repository whose Per-Issue Scenarios hold
 * Nominations, with the weekly Promotion Proposal pass or the Per-Issue Sweep due. What the cron did is read from the forge
 * writes the `gh` shadow recorded, the launches the recorder caught, the target repository's default branch and the cron's
 * output.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { readProposalCandidates } from '../../../adws/promotion/proposalBody.ts';
import { isOrchestratorLaunch } from '../../regression/support/harnessOrchestrators.ts';
import { describeLaunches, recordedLaunches } from '../../regression/support/launchRecorder.ts';
import { requireHarness } from '../../regression/support/subprocessHarness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { emptyIssueQueue, isOnDefaultBranch, labelsOf, outputTail, runCronWithDue, runCronWithSweepDue, seedMergedPullRequest } from './feature-1142-cron.ts';
import { addPerIssueScenario, perIssueFeatureOf } from './feature-1142-target.ts';
import {
  A_WEEK_LATER_MS,
  PAST_THE_GRACE_PERIOD_MS,
  PROMOTION_PROPOSAL_LABEL,
  cannedAnalysesOf,
  candidateLinesOf,
  candidateSectionOf,
  keepProposalOpen,
  programAnalysisAgent,
  recordNomination,
  runProposalPass,
  seedOpenProposal,
  seedOpenPullRequest,
  theFiledProposal,
} from './feature-1145-proposal.ts';

const CRON_STEP_TIMEOUT_MS = 180_000;
/** The sweep logs one of these only once it has read the usage report of its cucumber-js dry run. */
const USAGE_REPORT_READ: readonly RegExp[] = [/no unused step definitions/, /filed removal issue #\d+/, /is still open — not filing another/];

Given(
  'the target repository holds the Per-Issue Scenario {string} of issue {int}, whose pull request merged {int} days ago, with the nominated scenario {string}',
  async function (this: RegressionWorld, featurePath: string, issue: number, daysAgo: number, scenarioName: string) {
    addPerIssueScenario(this, featurePath, issue, scenarioName);
    await seedMergedPullRequest(this, issue, daysAgo);
    recordNomination(this, { issueNumber: issue, scenarioName, featurePath, merged: true });
  },
);

Given(
  'the target repository holds the Per-Issue Scenario {string} of issue {int}, whose pull request is still open, with the nominated scenario {string}',
  async function (this: RegressionWorld, featurePath: string, issue: number, scenarioName: string) {
    addPerIssueScenario(this, featurePath, issue, scenarioName);
    await seedOpenPullRequest(this, issue);
    recordNomination(this, { issueNumber: issue, scenarioName, featurePath, merged: false });
  },
);

Given(
  'the promotion analysis agent writes for each candidate why it qualifies and how it fits the existing Regression Suite, including overlap with scenarios already there',
  function (this: RegressionWorld) {
    programAnalysisAgent(this);
  },
);

When('the cron runs with its weekly Promotion Proposal pass due', { timeout: CRON_STEP_TIMEOUT_MS }, async function (this: RegressionWorld) {
  await emptyIssueQueue(this);
  await runProposalPass(this);
});

When(
  'the cron runs again a week later with its weekly Promotion Proposal pass due, while the proposal its first run filed is still open',
  { timeout: CRON_STEP_TIMEOUT_MS },
  async function (this: RegressionWorld) {
    const proposal = theFiledProposal(this);
    await keepProposalOpen(this, proposal, A_WEEK_LATER_MS);
    const output = await runProposalPass(this);

    const stillOpen = `Promotion Proposal #${proposal.number} is still open — not filing another`;
    assert.ok(output.includes(stillOpen), `Expected the pass to leave the Nominations to the open proposal #${proposal.number}. Last output:\n${outputTail(output)}`);
  },
);

Then('the cron filed exactly one Promotion Proposal in the target repository', function (this: RegressionWorld) {
  theFiledProposal(this);
});

Then('that proposal offers the scenario {string} of issue {int} with an unticked checkbox', function (this: RegressionWorld, scenarioName: string, issue: number) {
  const { body } = theFiledProposal(this);
  const lines = candidateLinesOf(body, issue, scenarioName);
  assert.strictEqual(lines.length, 1, `Expected the proposal to offer "${scenarioName}" of issue ${issue} on one checkbox line, but its body is:\n${body}`);
  assert.match(lines[0], /^- \[ \] /, `Expected the checkbox of "${scenarioName}" to be unticked: ${lines[0]}`);
});

Then('that proposal gives, under each candidate, the analysis the promotion analysis agent wrote for it', function (this: RegressionWorld) {
  const { body } = theFiledProposal(this);
  for (const analysis of cannedAnalysesOf(this)) {
    const section = candidateSectionOf(body, analysis.issueNumber);
    const missing = [analysis.qualification, analysis.fit, ...analysis.overlaps].filter((text) => !section.includes(text));
    assert.deepStrictEqual(missing, [], `Expected the section of issue #${analysis.issueNumber} to give the analysis the agent wrote, but it lacks: ${missing.join(' | ')}\n${section}`);
  }
});

Then('that proposal does not offer the scenario {string} of issue {int}', function (this: RegressionWorld, scenarioName: string, issue: number) {
  const { body } = theFiledProposal(this);
  const offered = readProposalCandidates(body).filter((reading) => reading.issueNumber === issue);
  assert.deepStrictEqual(offered, [], `Expected the proposal to offer no scenario of issue ${issue}, but its body is:\n${body}`);
  assert.ok(!body.includes(scenarioName), `Expected the proposal not to name "${scenarioName}", but its body is:\n${body}`);
});

When(
  "the cron polls again while the proposal its first run filed is still open and older than the cron's grace period",
  { timeout: CRON_STEP_TIMEOUT_MS },
  async function (this: RegressionWorld) {
    const proposal = theFiledProposal(this);
    await keepProposalOpen(this, proposal, PAST_THE_GRACE_PERIOD_MS);
    const output = await runCronWithDue(this, []);

    const poll = output.match(/POLL: [^\n]*/)?.[0] ?? '';
    assert.ok(poll.includes(`#${proposal.number}`), `Expected the cron's poll to have found the open proposal #${proposal.number}. Last output:\n${outputTail(output)}`);
  },
);

Then('that proposal carries the label {string} and the Promotion Proposal label', function (this: RegressionWorld, label: string) {
  const proposal = theFiledProposal(this);
  const labels = labelsOf(this, proposal.number);
  const missing = [label, PROMOTION_PROPOSAL_LABEL].filter((expected) => !labels.includes(expected));
  assert.deepStrictEqual(missing, [], `Expected Promotion Proposal #${proposal.number} to carry ${label} and ${PROMOTION_PROPOSAL_LABEL}, but its labels are: ${labels.join(', ') || 'none'}`);
});

Then('the cron launched no orchestrator for that proposal', function (this: RegressionWorld) {
  const proposal = theFiledProposal(this);
  const { recorder } = requireHarness(this);
  const launches = recordedLaunches(recorder).filter((argv) => isOrchestratorLaunch(argv) && argv.includes(String(proposal.number)));
  assert.deepStrictEqual(launches, [], `Expected the cron to launch no orchestrator for Promotion Proposal #${proposal.number}. Launches: ${describeLaunches(recorder)}`);
});

Given('an open Promotion Proposal in the target repository offers the scenario {string} of issue {int}', async function (this: RegressionWorld, scenarioName: string, issue: number) {
  await seedOpenProposal(this, { issueNumber: issue, scenarioName, featurePath: perIssueFeatureOf(this, issue) });
});

When('the cron runs with its Per-Issue Sweep due while that Promotion Proposal is open', { timeout: CRON_STEP_TIMEOUT_MS }, async function (this: RegressionWorld) {
  const output = await runCronWithSweepDue(this);
  assert.ok(
    USAGE_REPORT_READ.some((line) => line.test(output)),
    `Expected the sweep to have read the usage report of its cucumber-js dry run and decided about the removal issue. Last output:\n${outputTail(output)}`,
  );
});

Then("the target repository's default branch still holds {string}", function (this: RegressionWorld, path: string) {
  assert.ok(isOnDefaultBranch(this, path), `Expected ${path} to be still on the target repository's default branch. Last output:\n${outputTail(this.lastOutput)}`);
});
