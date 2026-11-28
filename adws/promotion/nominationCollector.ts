/**
 * Pure apart from the injected merge lookup. A Nomination is a tag on a Per-Issue Scenario's own tag lines, never on its Feature
 * or Rule, and its issue is the one the per-issue file is named after.
 */

import type { FeatureFileSource } from '../proof/featureScenarioIndex.ts';
import { parse } from './scenarioParser.ts';

export const NOMINATION_TAG = '@nominated';
export const NOMINATION_DECLINED_TAG = '@nomination-declined';

export enum NominationState {
  AwaitingProposal = 'awaiting_proposal',
  InOpenProposal = 'in_open_proposal',
  Declined = 'declined',
}

/** How a Promotion Proposal names a candidate. */
export interface NominationKey {
  readonly issueNumber: number;
  readonly scenarioName: string;
}

export interface Nomination extends NominationKey {
  readonly featurePath: string;
  readonly state: NominationState;
}

export interface NominationSources {
  /** The Per-Issue Scenario files as the default branch holds them, with repo-relative paths. */
  readonly features: readonly FeatureFileSource[];
  /** The Per-Issue Sweep's lookup: null when no merged pull request links the issue. */
  readonly getMergedAt: (issueNumber: number) => Promise<Date | null>;
  /** The candidates the open Promotion Proposal lists; none when omitted. */
  readonly openProposalCandidates?: readonly NominationKey[];
}

type MergeLookup = NominationSources['getMergedAt'];

interface TaggedScenario extends NominationKey {
  readonly featurePath: string;
  readonly tags: readonly string[];
  readonly headerLine: number;
}

const PER_ISSUE_FILE_NAME = /^feature-(\d+)\.feature$/;

function issueNumberOf(featurePath: string): number | null {
  const fileName = featurePath.slice(featurePath.lastIndexOf('/') + 1);
  const match = PER_ISSUE_FILE_NAME.exec(fileName);
  return match ? Number.parseInt(match[1], 10) : null;
}

function scenariosOf(content: string): ReturnType<typeof parse> {
  try {
    return parse(content);
  } catch {
    return [];
  }
}

function carriesNominationTag(tags: readonly string[]): boolean {
  return tags.includes(NOMINATION_TAG) || tags.includes(NOMINATION_DECLINED_TAG);
}

function taggedScenariosOf(file: FeatureFileSource): TaggedScenario[] {
  const issueNumber = issueNumberOf(file.path);
  if (issueNumber === null) return [];
  return scenariosOf(file.content)
    .filter((scenario) => carriesNominationTag(scenario.tags))
    .map(({ name, tags, headerLine }) => ({ issueNumber, scenarioName: name, featurePath: file.path, tags, headerLine }));
}

async function hasMerged(issueNumber: number, getMergedAt: MergeLookup): Promise<boolean> {
  try {
    return (await getMergedAt(issueNumber)) !== null;
  } catch {
    return false;
  }
}

async function mergedIssuesOf(scenarios: readonly TaggedScenario[], getMergedAt: MergeLookup): Promise<ReadonlySet<number>> {
  const issueNumbers = [...new Set(scenarios.map((scenario) => scenario.issueNumber))];
  const merged = await Promise.all(issueNumbers.map((issueNumber) => hasMerged(issueNumber, getMergedAt)));
  return new Set(issueNumbers.filter((_, position) => merged[position]));
}

function isSameCandidate(a: NominationKey, b: NominationKey): boolean {
  return a.issueNumber === b.issueNumber && a.scenarioName === b.scenarioName;
}

function stateOf(scenario: TaggedScenario, openProposalCandidates: readonly NominationKey[]): NominationState {
  if (scenario.tags.includes(NOMINATION_DECLINED_TAG)) return NominationState.Declined;
  const listed = openProposalCandidates.some((candidate) => isSameCandidate(candidate, scenario));
  return listed ? NominationState.InOpenProposal : NominationState.AwaitingProposal;
}

function nominationOf(scenario: TaggedScenario, openProposalCandidates: readonly NominationKey[]): Nomination {
  const { issueNumber, scenarioName, featurePath } = scenario;
  return { issueNumber, scenarioName, featurePath, state: stateOf(scenario, openProposalCandidates) };
}

function byIssueThenPosition(a: TaggedScenario, b: TaggedScenario): number {
  return a.issueNumber - b.issueNumber || a.headerLine - b.headerLine;
}

/** The nominated and declined scenarios of the issues that have merged; the merge of each such issue is looked up once. */
export async function collectNominations(sources: NominationSources): Promise<readonly Nomination[]> {
  const tagged = sources.features.flatMap(taggedScenariosOf);
  const merged = await mergedIssuesOf(tagged, sources.getMergedAt);
  const openProposalCandidates = sources.openProposalCandidates ?? [];
  return tagged
    .filter((scenario) => merged.has(scenario.issueNumber))
    .sort(byIssueThenPosition)
    .map((scenario) => nominationOf(scenario, openProposalCandidates));
}
