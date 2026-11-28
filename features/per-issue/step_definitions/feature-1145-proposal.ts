/**
 * What the scenarios of feature-1145.feature give the cron and read back from it: the Nominations of the target repository,
 * the analysis the promotion analysis agent answers with, an open Promotion Proposal on the mock forge, and the proposal the
 * cron filed, read from the forge writes the `gh` shadow recorded.
 *
 * The agent is the Claude CLI stub, programmed by a marker manifest above every worktree the cron creates: the stub reads no
 * MOCK_* name from an agent's environment. The stub answers with at most 500 characters of text, so each canned analysis is
 * short. Every other command the stub is asked answers with an error, so a run that needs anything else fails loudly.
 */

import assert from 'assert';
import { writeFileSync } from 'fs';
import { join } from 'path';

import { GRACE_PERIOD_MS } from '../../../adws/core/config.ts';
import { buildPromotionProposal, readProposalCandidates } from '../../../adws/promotion/proposalBody.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import { STUB_MANIFEST_MARKER } from '../../../test/mocks/stubMarker.ts';
import { DEFAULT_BRANCH } from '../../regression/support/fixtureTargetRepo.ts';
import { requireHarness } from '../../regression/support/subprocessHarness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { cronOutputsOf, filedIssues, keepIssueOpen, outputTail, runCronWithDue, type FiledIssue } from './feature-1142-cron.ts';

export const PROMOTION_PROPOSAL_LABEL = 'promotion-proposal';
const ANALYSIS_COMMAND = '/promote_regression_vocabulary';
const STUB_RESULT_LIMIT = 500;
const DAY_MS = 86_400_000;
/** Older than the 7 days a repository waits between two Promotion Proposals, so only the open proposal can stop a filing. */
export const A_WEEK_LATER_MS = 8 * DAY_MS;
export const PAST_THE_GRACE_PERIOD_MS = 2 * GRACE_PERIOD_MS;
/** Keeps a seeded pull request's number clear of the issue numbers the scenarios name. */
const PULL_REQUEST_OFFSET = 1_000_000;
const SEEDED_PROPOSAL_NUMBER = 114_599;
const PASS_LOG = 'promotionProposalPass:';
const FILED_PROPOSAL = /filed Promotion Proposal #(\d+)/g;
const PROPOSAL_TITLE = /^Promotion Proposal /;
const TASK_LIST_LINE = /^\s*[-*+]\s+\[[ xX]\]\s/;

export interface NominatedScenario {
  readonly issueNumber: number;
  readonly scenarioName: string;
  readonly featurePath: string;
  readonly merged: boolean;
}

export interface CannedAnalysis {
  readonly issueNumber: number;
  readonly scenarioName: string;
  readonly qualification: string;
  readonly fit: string;
  readonly overlaps: readonly string[];
}

export interface FiledProposal extends FiledIssue {
  readonly number: number;
}

const nominations = new WeakMap<RegressionWorld, NominatedScenario[]>();
const analyses = new WeakMap<RegressionWorld, CannedAnalysis[]>();

export function recordNomination(world: RegressionWorld, nomination: NominatedScenario): void {
  nominations.set(world, [...(nominations.get(world) ?? []), nomination]);
}

export function cannedAnalysesOf(world: RegressionWorld): readonly CannedAnalysis[] {
  const canned = analyses.get(world);
  assert.ok(canned, 'Expected the promotion analysis agent to have been given its answer first');
  return canned;
}

function analysisOf({ issueNumber, scenarioName }: NominatedScenario): CannedAnalysis {
  return {
    issueNumber,
    scenarioName,
    qualification: `Guards ${issueNumber}; no regression scenario does.`,
    fit: `Fits beside the order scenarios: ${issueNumber}.`,
    overlaps: [`features/regression/orders.feature: ${issueNumber}`],
  };
}

/** Answers the analysis of the Nominations whose issue merged, the candidates the cron is expected to offer, in issue order. */
export function programAnalysisAgent(world: RegressionWorld): void {
  const harness = requireHarness(world);
  const candidates = (nominations.get(world) ?? []).filter((nomination) => nomination.merged).sort((a, b) => a.issueNumber - b.issueNumber);
  const canned = candidates.map(analysisOf);
  const answer = JSON.stringify(canned);
  assert.ok(answer.length <= STUB_RESULT_LIMIT, `The canned analysis is ${answer.length} characters, more than the ${STUB_RESULT_LIMIT} the Claude CLI stub answers with`);

  const payloadPath = join(harness.root, 'promotion-analysis-payload.json');
  writeFileSync(payloadPath, JSON.stringify([{ type: 'text', text: answer }]), 'utf-8');
  const manifest = { jsonlPath: payloadPath, edits: [], response: { kind: 'error' }, byCommand: { [ANALYSIS_COMMAND]: { jsonlPath: payloadPath } } };
  writeFileSync(join(harness.targetReposDir, STUB_MANIFEST_MARKER), JSON.stringify(manifest), 'utf-8');
  analyses.set(world, canned);
}

export async function seedOpenPullRequest(world: RegressionWorld, issue: number): Promise<void> {
  assert.ok(world.mockContext, 'mockContext must be initialised in a Before hook');
  const number = PULL_REQUEST_OFFSET + issue;
  const pullRequest = { number, title: `Implement issue ${issue}`, body: `Implements #${issue}\n\nCloses #${issue}`, state: 'OPEN', mergedAt: null, headRefName: `feature-issue-${issue}`, baseRefName: DEFAULT_BRANCH };
  await world.mockContext.setState({ prs: { ...getMockServerState().prs, [String(number)]: pullRequest } });
}

/** Runs the cron for one tick with its weekly Promotion Proposal pass due, and fails unless the pass ran. */
export async function runProposalPass(world: RegressionWorld): Promise<string> {
  const output = await runCronWithDue(world, ['PROMOTION_PROPOSAL_INTERVAL_CYCLES']);
  assert.ok(output.includes(PASS_LOG), `Expected the cron's weekly Promotion Proposal pass to have run. Last output:\n${outputTail(output)}`);
  return output;
}

/** The shadow numbers an issue as it files it; the mock it is replayed against does not, so the number is read from the cron's line. */
export function theFiledProposal(world: RegressionWorld): FiledProposal {
  const filed = filedIssues(world).filter((issue) => PROPOSAL_TITLE.test(issue.title));
  const numbers = cronOutputsOf(world).flatMap((output) => [...output.matchAll(FILED_PROPOSAL)].map((match) => Number(match[1])));
  const titles = filedIssues(world).map((issue) => issue.title).join(', ') || 'none';
  assert.strictEqual(filed.length, 1, `Expected the cron to have filed exactly one Promotion Proposal, but it filed ${filed.length}; the issues it filed: ${titles}`);
  assert.strictEqual(numbers.length, 1, `Expected the cron to have logged filing exactly one Promotion Proposal, but it logged ${numbers.length}: ${numbers.join(', ')}`);
  return { ...filed[0], number: numbers[0] };
}

/** Puts the filed proposal into the mock as the forge holds it, open and labelled, filed `ageMs` ago. */
export async function keepProposalOpen(world: RegressionWorld, proposal: FiledProposal, ageMs: number): Promise<void> {
  assert.ok(world.mockContext, 'mockContext must be initialised in a Before hook');
  await keepIssueOpen(world, proposal.number, proposal);
  const filedAt = new Date(Date.now() - ageMs).toISOString();
  const { issues } = getMockServerState();
  const kept = { ...(issues[String(proposal.number)] as Record<string, unknown>), createdAt: filedAt, updatedAt: filedAt };
  await world.mockContext.setState({ issues: { ...issues, [String(proposal.number)]: kept } });
}

/** The proposal is the only issue the cron's poll finds: open, labelled as the pass labels one, with a body the pass would build. */
export async function seedOpenProposal(world: RegressionWorld, nomination: Omit<NominatedScenario, 'merged'>): Promise<void> {
  assert.ok(world.mockContext, 'mockContext must be initialised in a Before hook');
  const analysed = { ...nomination, qualification: 'It guards shipping.', fit: 'It fits beside the order scenarios.', overlaps: [] };
  const { title, body, labels } = buildPromotionProposal([analysed], new Date());
  const filedAt = new Date(Date.now() - DAY_MS).toISOString();
  const proposal = { number: SEEDED_PROPOSAL_NUMBER, title, body, state: 'OPEN', labels: labels.map((name) => ({ name })), createdAt: filedAt, updatedAt: filedAt };
  await world.mockContext.setState({ issues: { [String(SEEDED_PROPOSAL_NUMBER)]: proposal } });
}

/** The lines that render a checkbox naming the scenario of the issue and keyed by it. */
export function candidateLinesOf(body: string, issueNumber: number, scenarioName: string): string[] {
  const keyedBy = (line: string): boolean => readProposalCandidates(line).some((reading) => reading.issueNumber === issueNumber && reading.scenarioName === scenarioName);
  return body.split('\n').filter((line) => TASK_LIST_LINE.test(line) && line.includes(`#${issueNumber} `) && line.includes(`\`${scenarioName}\``) && keyedBy(line));
}

/** The candidate's own section of the body, from its `### #N` heading to the next `### ` heading or the end. */
export function candidateSectionOf(body: string, issueNumber: number): string {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`### #${issueNumber} `));
  assert.ok(start !== -1, `Expected the proposal to hold a section for issue #${issueNumber}, but its body is:\n${body}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('### '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}
