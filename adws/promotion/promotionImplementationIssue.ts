/**
 * Pure. The issue ADW files for the candidates the owner approved in a Promotion Proposal, which the chore pipeline builds
 * unattended, and the marker line by which a later pass finds it already filed. Its approved scenarios are candidate lines in
 * the proposal format, so the Per-Issue Sweep reads them back to keep those scenarios until the issue is closed.
 */

import { PROMOTION_IMPLEMENTATION_LABELS } from '../core/adwLabels.ts';
import { codeSpan } from '../core/unusedStepIssueBody.ts';
import type { NominationKey } from './nominationCollector.ts';
import { candidateMarker, readProposalCandidates, type ProposalIssueSpec } from './proposalBody.ts';

export const IMPLEMENTATION_ISSUE_MARKER_PREFIX = 'Promotes: Promotion Proposal #';

export interface ImplementationIssueRef {
  readonly number: number;
  readonly body: string;
  /** 'OPEN' or 'CLOSED', compared without case; absent ⇒ open. */
  readonly state?: string;
}

export interface ApprovedScenario extends NominationKey {
  readonly featurePath: string;
}

export interface PromotionImplementationInput {
  readonly proposalNumber: number;
  readonly approved: readonly ApprovedScenario[];
}

const INSTRUCTIONS: readonly string[] = [
  '## What to do',
  '',
  "- Move each scenario listed above on its own into the Regression Suite, the directory that `## Regression Scenario Directory` of `.adw/scenarios.md` names. Never move a whole feature file: leave the per-issue file's other scenarios where they are, and the Per-Issue Sweep removes them.",
  '- Reword each moved scenario to the phrases of the Vocabulary Registry, the file that `## Vocabulary Registry` of `.adw/scenarios.md` names. Register a new phrase only when no registered phrase fits.',
  '- Tag each moved scenario `@regression` and drop its per-issue tags (`@adw-<issue>`, `@nominated`).',
  '- Move the step definitions each moved scenario needs, with the helpers they import, out of the files named after its issue (`feature-<issue>.*`, `feature-<issue>-*`), which the Per-Issue Sweep deletes, into step-definition files it keeps, so that the scenario still runs.',
  "- Write no new scenario. The repository's static checks and its `@regression` scenarios must pass.",
];

function scenarioLine(scenario: ApprovedScenario): string {
  return `- [ ] #${scenario.issueNumber} · ${codeSpan(scenario.scenarioName)} in ${codeSpan(scenario.featurePath)} ${candidateMarker(scenario)}`;
}

function markerLineOf(proposalNumber: number): RegExp {
  return new RegExp(`^\\s*${IMPLEMENTATION_ISSUE_MARKER_PREFIX}${proposalNumber}\\s*$`, 'm');
}

export function buildPromotionImplementationIssue({ proposalNumber, approved }: PromotionImplementationInput): ProposalIssueSpec {
  const touchedFiles = [...new Set(approved.map((scenario) => scenario.featurePath))];
  const body = [
    `${IMPLEMENTATION_ISSUE_MARKER_PREFIX}${proposalNumber}`,
    '',
    `The owner approved the scenarios below by closing Promotion Proposal #${proposalNumber} as completed with them ticked. The pull request merges without a further human gate once the test and review phases pass.`,
    '',
    '## Scenarios to promote',
    '',
    ...approved.map(scenarioLine),
    '',
    ...INSTRUCTIONS,
    '',
    '## Touched Files',
    '',
    ...touchedFiles.map((file) => `- ${codeSpan(file)}`),
  ].join('\n');
  const count = `${approved.length} scenario${approved.length === 1 ? '' : 's'}`;
  return { title: `chore: promote ${count} into the Regression Suite from Promotion Proposal #${proposalNumber}`, body, labels: [...PROMOTION_IMPLEMENTATION_LABELS] };
}

/** The lowest-numbered issue, open or closed, whose body holds the marker line of exactly that proposal; null when none does. */
export function implementationIssueFor(proposalNumber: number, issues: readonly ImplementationIssueRef[]): ImplementationIssueRef | null {
  const markerLine = markerLineOf(proposalNumber);
  const filed = issues.filter((issue) => markerLine.test(issue.body));
  if (filed.length === 0) return null;
  return filed.reduce((lowest, issue) => (issue.number < lowest.number ? issue : lowest));
}

/** The scenarios the issue promotes; its ticks carry no meaning. */
export function implementationIssueCandidates(issue: ImplementationIssueRef): readonly NominationKey[] {
  return readProposalCandidates(issue.body).map(({ issueNumber, scenarioName }) => ({ issueNumber, scenarioName }));
}
