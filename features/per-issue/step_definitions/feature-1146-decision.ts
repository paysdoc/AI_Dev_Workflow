/**
 * What the scenarios of feature-1146.feature give the cron and read back from it: the Promotion Proposal the owner closed, or
 * left open, seeded on the mock forge as the weekly pass files one; the implementation issue the cron's decision pass filed,
 * read from the forge writes the `gh` shadow recorded; and the decline pull request it merged, read from those writes and from
 * the scenario's own tag line on the target repository's default branch.
 */

import assert from 'assert';

import type { NominationKey } from '../../../adws/promotion/nominationCollector.ts';
import { implementationIssueCandidates } from '../../../adws/promotion/promotionImplementationIssue.ts';
import { buildPromotionProposal, readProposalCandidates } from '../../../adws/promotion/proposalBody.ts';
import { PROPOSAL_DECISION_MARKER } from '../../../adws/promotion/proposalDecisionRecord.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';
import { DEFAULT_BRANCH } from '../../regression/support/fixtureTargetRepo.ts';
import { realGit } from '../../regression/support/fixtureWorktree.ts';
import { SURFACE_REPO } from '../../regression/support/mockForgeProviders.ts';
import { ensureTargetWorkspace } from '../../regression/support/subprocessHarness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { cronOutputsOf, filedIssues, keepIssueOpen, outputTail, runCronWithDue, type FiledIssue } from './feature-1142-cron.ts';
import { perIssueFeatureOf } from './feature-1142-target.ts';
import { recordedNominations } from './feature-1145-proposal.ts';

const DAY_MS = 86_400_000;
const SEEDED_PROPOSAL_NUMBER = 114_699;
/** Well inside the 30 days a proposal stays open, so only the owner's close decides it. */
const DECIDED_AFTER_DAYS = 5;
const PASS_LOG = 'promotionDecisionPass:';
const DECLINE_BRANCH = 'chore/nomination-decline';
const IMPLEMENTATION_TITLE = /^chore: promote /;
const FILED_IMPLEMENTATION_ISSUE = /filed implementation issue #(\d+) for Promotion Proposal #\d+/g;
const REPO_PATH = `/repos/${SURFACE_REPO.owner}/${SURFACE_REPO.repo}`;

/** The close reason as the forge's REST API names it. */
export enum OwnerClose {
  Completed = 'completed',
  NotPlanned = 'not_planned',
}

export interface FiledImplementationIssue extends FiledIssue {
  readonly number: number;
}

interface CreatedPullRequest {
  readonly head?: string;
  readonly number?: number;
}

interface ProposalSeed {
  readonly closedAs: OwnerClose | null;
  readonly filedDaysAgo: number;
  readonly ticked: readonly string[];
}

const seededProposals = new WeakMap<RegressionWorld, number>();

function tickedLine(line: string, ticked: readonly string[]): string {
  const named = readProposalCandidates(line).some((reading) => ticked.includes(reading.scenarioName));
  return named ? line.replace('[ ]', '[x]') : line;
}

function closeFields(closedAs: OwnerClose | null): Record<string, string> {
  if (closedAs === null) return { state: 'open' };
  return { state: 'closed', state_reason: closedAs, closed_at: new Date().toISOString() };
}

/** The proposal the weekly pass files for every Nomination the Givens recorded, with the owner's ticks, as the only issue on the forge. */
async function seedProposal(world: RegressionWorld, { closedAs, filedDaysAgo, ticked }: ProposalSeed): Promise<void> {
  assert.ok(world.mockContext, 'mockContext must be initialised in a Before hook');
  const nominations = recordedNominations(world);
  const unknown = ticked.filter((name) => !nominations.some((nomination) => nomination.scenarioName === name));
  assert.deepStrictEqual(unknown, [], 'Expected the target repository to hold the Nomination of every ticked scenario first');

  const filedAt = new Date(Date.now() - filedDaysAgo * DAY_MS).toISOString();
  const candidates = nominations.map(({ issueNumber, scenarioName, featurePath }) => ({ issueNumber, scenarioName, featurePath, qualification: 'It guards a costly path.', fit: 'It fits beside the order scenarios.', overlaps: [] }));
  const { title, body, labels } = buildPromotionProposal(candidates, new Date(filedAt));
  const proposal = {
    number: SEEDED_PROPOSAL_NUMBER,
    title,
    body: body.split('\n').map((line) => tickedLine(line, ticked)).join('\n'),
    ...closeFields(closedAs),
    labels: labels.map((name) => ({ name })),
    createdAt: filedAt,
    updatedAt: new Date().toISOString(),
  };
  await world.mockContext.setState({ issues: { [String(SEEDED_PROPOSAL_NUMBER)]: proposal } });
  seededProposals.set(world, SEEDED_PROPOSAL_NUMBER);
}

export function seedClosedProposal(world: RegressionWorld, closedAs: OwnerClose, offered: number, ticked: readonly string[]): Promise<void> {
  const nominations = recordedNominations(world).length;
  assert.strictEqual(nominations, offered, `Expected the target repository to hold the ${offered} nominated scenarios the proposal offers, but it holds ${nominations}`);
  return seedProposal(world, { closedAs, filedDaysAgo: DECIDED_AFTER_DAYS, ticked });
}

export function seedProposalOpenFor(world: RegressionWorld, days: number): Promise<void> {
  return seedProposal(world, { closedAs: null, filedDaysAgo: days, ticked: [] });
}

export function seededProposalNumber(world: RegressionWorld): number {
  const number = seededProposals.get(world);
  assert.ok(number !== undefined, 'Expected the scenario to have seeded a Promotion Proposal first');
  return number;
}

/** Runs the cron for one tick with its Promotion Proposal decision pass due, and fails unless the pass ran. */
export async function runDecisionPass(world: RegressionWorld): Promise<string> {
  const output = await runCronWithDue(world, ['PROMOTION_DECISION_INTERVAL_CYCLES']);
  assert.ok(output.includes(PASS_LOG), `Expected the cron's Promotion Proposal decision pass to have run. Last output:\n${outputTail(output)}`);
  return output;
}

/** The shadow numbers an issue as it files it; the mock it is replayed against does not, so the number is read from the pass's line. */
export function theFiledImplementationIssue(world: RegressionWorld): FiledImplementationIssue {
  const filed = filedIssues(world).filter((issue) => IMPLEMENTATION_TITLE.test(issue.title));
  const numbers = cronOutputsOf(world).flatMap((output) => [...output.matchAll(FILED_IMPLEMENTATION_ISSUE)].map((match) => Number(match[1])));
  const titles = filedIssues(world).map((issue) => issue.title).join(', ') || 'none';
  assert.strictEqual(filed.length, 1, `Expected the cron to have filed exactly one implementation issue, but it filed ${filed.length}; the issues it filed: ${titles}`);
  assert.strictEqual(numbers.length, 1, `Expected the cron to have logged filing exactly one implementation issue, but it logged ${numbers.length}: ${numbers.join(', ')}`);
  return { ...filed[0], number: numbers[0] };
}

/** The mock keeps no issue the shadow filed, so the next run's forge would not hold the implementation issue without this. */
export async function keepImplementationIssueOpen(world: RegressionWorld): Promise<void> {
  const issue = theFiledImplementationIssue(world);
  await keepIssueOpen(world, issue.number, issue);
}

export function namesScenario(issue: FiledImplementationIssue, key: NominationKey): boolean {
  const keyed = implementationIssueCandidates(issue).some((candidate) => candidate.issueNumber === key.issueNumber && candidate.scenarioName === key.scenarioName);
  return keyed && issue.body.includes(`\`${key.scenarioName}\``);
}

function requestsTo(world: RegressionWorld, method: string, path: string): RecordedRequest[] {
  return world.getRecordedRequests().filter((request) => request.method === method && request.url === path);
}

export function openedPullRequests(world: RegressionWorld): CreatedPullRequest[] {
  return requestsTo(world, 'POST', `${REPO_PATH}/pulls`).map((request) => JSON.parse(request.body) as CreatedPullRequest);
}

export function mergedDeclinePullRequests(world: RegressionWorld): number[] {
  const numbers = openedPullRequests(world).filter((created) => created.head === DECLINE_BRANCH).map((created) => created.number);
  return numbers.filter((number): number is number => number !== undefined && requestsTo(world, 'PUT', `${REPO_PATH}/pulls/${number}/merge`).length > 0);
}

export function isDeclineBranch(branch: string | undefined): boolean {
  return branch === DECLINE_BRANCH;
}

/** The tags on the line right above the scenario's own `Scenario:` line, as the target repository's default branch holds the file. */
export function scenarioTagsOnDefaultBranch(world: RegressionWorld, issue: number, scenarioName: string): string[] {
  const featurePath = perIssueFeatureOf(world, issue);
  const lines = realGit(ensureTargetWorkspace(world), 'show', `${DEFAULT_BRANCH}:${featurePath}`).split('\n').map((line) => line.trim());
  const at = lines.indexOf(`Scenario: ${scenarioName}`);
  assert.ok(at > 0, `Expected ${featurePath} on the default branch to hold the scenario "${scenarioName}", but it reads:\n${lines.join('\n')}`);
  return lines[at - 1].startsWith('@') ? lines[at - 1].split(/\s+/) : [];
}

export function subjectOfLastCommitTo(world: RegressionWorld, issue: number): string {
  return realGit(ensureTargetWorkspace(world), 'log', '-1', '--format=%s', DEFAULT_BRANCH, '--', perIssueFeatureOf(world, issue));
}

function holdsDecisionRecord(request: RecordedRequest): boolean {
  const { body } = JSON.parse(request.body) as { body?: string };
  return (body ?? '').includes(`<!-- ${PROPOSAL_DECISION_MARKER}:`);
}

function closes(request: RecordedRequest): boolean {
  return (JSON.parse(request.body) as { state?: string }).state === 'closed';
}

/** Where, among the forge writes in the order they were made, the decision comment on the proposal and its close were recorded; -1 when not. */
export function decisionCommentAndClose(world: RegressionWorld, proposal: number): { readonly comment: number; readonly close: number } {
  const requests = world.getRecordedRequests();
  const comment = requests.findIndex((request) => request.method === 'POST' && request.url === `${REPO_PATH}/issues/${proposal}/comments` && holdsDecisionRecord(request));
  const close = requests.findIndex((request) => request.method === 'PATCH' && request.url === `${REPO_PATH}/issues/${proposal}` && closes(request));
  return { comment, close };
}
