/**
 * The analysis behind a Promotion Proposal: `/promote_regression_vocabulary`, with the `promote-regression-vocabulary` skill,
 * writes for each candidate why it qualifies for the Regression Suite, how it fits the suite as it stands and where it
 * overlaps the scenarios already there. Its answer is read back as exactly one analysis per candidate, in candidate order.
 */

import { runCommandAgent, type CommandAgentConfig, type CommandAgentOptions, type ExtractionResult } from './commandAgent';
import type { AgentResult } from './claudeAgent';
import type { Nomination, NominationKey } from '../promotion/nominationCollector';
import { isSameCandidate, type CandidateAnalysis } from '../promotion/proposalBody';

export type ProposalAnalysisCandidate = Pick<Nomination, 'issueNumber' | 'scenarioName' | 'featurePath'>;

type ExtractionFailure = Extract<ExtractionResult<never>, { success: false }>;

export const proposalAnalysisSchema: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    required: ['issueNumber', 'scenarioName', 'qualification', 'fit', 'overlaps'],
    properties: {
      issueNumber: { type: 'integer', minimum: 1 },
      scenarioName: { type: 'string' },
      qualification: { type: 'string', minLength: 1 },
      fit: { type: 'string', minLength: 1 },
      overlaps: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  description: 'One analysis per candidate of the Promotion Proposal, in the order the candidates were given',
};

function failure(error: string): ExtractionFailure {
  return { success: false, error };
}

function describeKey({ issueNumber, scenarioName }: NominationKey): string {
  return `#${issueNumber} ${JSON.stringify(scenarioName)}`;
}

function jsonArrayText(output: string): string | null {
  const trimmed = output.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1].trim();
  if (fenced?.startsWith('[')) return fenced;
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  return start !== -1 && end > start ? trimmed.slice(start, end + 1) : null;
}

function parsedArray(output: string): ExtractionResult<readonly unknown[]> {
  const text = jsonArrayText(output);
  if (text === null) return failure('Could not find a JSON array in the analysis output');
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? { success: true, data: parsed } : failure('The analysis output is not a JSON array');
  } catch (error) {
    return failure(`The analysis output is not valid JSON: ${String(error)}`);
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isFilledText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isTextList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function analysisAt(raw: unknown, position: number): ExtractionResult<CandidateAnalysis> {
  const entry = `Analysis entry ${position + 1}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return failure(`${entry} is not an object`);

  const { issueNumber, scenarioName, qualification, fit, overlaps } = raw as Record<string, unknown>;
  if (!isPositiveInteger(issueNumber)) return failure(`${entry} has an issueNumber that is not a positive integer`);
  if (typeof scenarioName !== 'string') return failure(`${entry} has a scenarioName that is not a string`);
  if (!isFilledText(qualification)) return failure(`${entry} has a blank qualification`);
  if (!isFilledText(fit)) return failure(`${entry} has a blank fit`);
  if (!isTextList(overlaps)) return failure(`${entry} has an overlap that is not a string`);

  const filledOverlaps = overlaps.map((overlap) => overlap.trim()).filter((overlap) => overlap !== '');
  return { success: true, data: { issueNumber, scenarioName, qualification: qualification.trim(), fit: fit.trim(), overlaps: filledOverlaps } };
}

function isFailure<T>(result: ExtractionResult<T>): result is ExtractionFailure {
  return !result.success;
}

function validatedAnalyses(entries: readonly unknown[]): ExtractionResult<readonly CandidateAnalysis[]> {
  const results = entries.map(analysisAt);
  const invalid = results.find(isFailure);
  if (invalid) return invalid;
  return { success: true, data: results.flatMap((result) => (result.success ? [result.data] : [])) };
}

/** Exactly one analysis per candidate, about no other scenario, returned in candidate order. */
function inCandidateOrder(analyses: readonly CandidateAnalysis[], candidates: readonly NominationKey[]): ExtractionResult<CandidateAnalysis[]> {
  const stranger = analyses.find((analysis) => !candidates.some((candidate) => isSameCandidate(candidate, analysis)));
  if (stranger) return failure(`The analysis names ${describeKey(stranger)}, which is not a candidate`);

  const analysesOf = (candidate: NominationKey): readonly CandidateAnalysis[] => analyses.filter((analysis) => isSameCandidate(analysis, candidate));
  const twice = candidates.find((candidate) => analysesOf(candidate).length > 1);
  if (twice) return failure(`The analysis covers the candidate ${describeKey(twice)} more than once`);
  const missing = candidates.find((candidate) => analysesOf(candidate).length === 0);
  if (missing) return failure(`The analysis leaves out the candidate ${describeKey(missing)}`);

  return { success: true, data: candidates.flatMap(analysesOf) };
}

/** Never throws: every problem with the answer comes back as the error `/correct_output` is retried with. */
export function extractProposalAnalyses(candidates: readonly NominationKey[]): (output: string) => ExtractionResult<CandidateAnalysis[]> {
  return (output) => {
    const parsed = parsedArray(output);
    if (!parsed.success) return parsed;
    const analyses = validatedAnalyses(parsed.data);
    if (!analyses.success) return analyses;
    return inCandidateOrder(analyses.data, candidates);
  };
}

export async function runProposalAnalysisAgent(
  candidates: readonly ProposalAnalysisCandidate[],
  options: Omit<CommandAgentOptions, 'args'>,
): Promise<AgentResult & { analyses: CandidateAnalysis[] }> {
  const config: CommandAgentConfig<CandidateAnalysis[]> = {
    command: '/promote_regression_vocabulary',
    agentName: 'Promotion Proposal Analysis',
    outputFileName: 'promotion-proposal-analysis-agent.jsonl',
    extractOutput: extractProposalAnalyses(candidates),
    outputSchema: proposalAnalysisSchema,
  };
  const args = JSON.stringify(candidates.map(({ issueNumber, scenarioName, featurePath }) => ({ issueNumber, scenarioName, featurePath })));
  const result = await runCommandAgent(config, { ...options, args });
  return { ...result, analyses: result.parsed };
}
