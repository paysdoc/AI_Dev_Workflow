import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../commandAgent', () => ({
  runCommandAgent: vi.fn(),
}));

import { runCommandAgent } from '../commandAgent';
import { extractProposalAnalyses, proposalAnalysisSchema, runProposalAnalysisAgent, type ProposalAnalysisCandidate } from '../proposalAnalysisAgent';

const REFUND: ProposalAnalysisCandidate = { issueNumber: 1201, scenarioName: 'An order is refunded', featurePath: 'features/per-issue/feature-1201.feature' };
const INVOICE: ProposalAnalysisCandidate = { issueNumber: 1207, scenarioName: 'An invoice is sent', featurePath: 'features/per-issue/feature-1207.feature' };
const CANDIDATES = [REFUND, INVOICE];

function entry(candidate: ProposalAnalysisCandidate, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issueNumber: candidate.issueNumber,
    scenarioName: candidate.scenarioName,
    qualification: `Issue ${candidate.issueNumber} guards a costly path.`,
    fit: 'It sits beside the order scenarios.',
    overlaps: ['features/regression/orders.feature — An order is placed — partly'],
    ...overrides,
  };
}

function analysisOf(candidate: ProposalAnalysisCandidate) {
  const { issueNumber, scenarioName, qualification, fit, overlaps } = entry(candidate) as { issueNumber: number; scenarioName: string; qualification: string; fit: string; overlaps: string[] };
  return { issueNumber, scenarioName, qualification, fit, overlaps };
}

const extract = extractProposalAnalyses(CANDIDATES);

function errorOf(output: string): string {
  const result = extract(output);
  expect(result.success).toBe(false);
  return result.success ? '' : result.error;
}

describe('extractProposalAnalyses', () => {
  it('returns one analysis per candidate in candidate order, from bare JSON and from a fenced block', () => {
    const answer = JSON.stringify([entry(INVOICE), entry(REFUND)]);
    const expected = { success: true, data: [analysisOf(REFUND), analysisOf(INVOICE)] };

    expect(extract(answer)).toEqual(expected);
    expect(extract(`Here is the analysis:\n\`\`\`json\n${answer}\n\`\`\`\nDone.`)).toEqual(expected);
  });

  it('trims the texts and drops blank overlaps', () => {
    const answer = JSON.stringify([
      entry(REFUND, { qualification: '  Guards refunds.\n', fit: '\tFits the order scenarios. ', overlaps: ['  orders.feature — partly  ', '   ', ''] }),
      entry(INVOICE, { overlaps: [] }),
    ]);

    const result = extract(answer);

    expect(result).toEqual({
      success: true,
      data: [
        { ...analysisOf(REFUND), qualification: 'Guards refunds.', fit: 'Fits the order scenarios.', overlaps: ['orders.feature — partly'] },
        { ...analysisOf(INVOICE), overlaps: [] },
      ],
    });
  });

  it('fails, naming the candidate, when a candidate has no analysis', () => {
    expect(errorOf(JSON.stringify([entry(REFUND)]))).toContain('#1207 "An invoice is sent"');
  });

  it('fails for an entry about a scenario that is no candidate, or a candidate analysed twice', () => {
    const stranger = entry({ issueNumber: 1300, scenarioName: 'A stranger', featurePath: 'features/per-issue/feature-1300.feature' });

    expect(errorOf(JSON.stringify([entry(REFUND), entry(INVOICE), stranger]))).toContain('#1300 "A stranger"');
    expect(errorOf(JSON.stringify([entry(REFUND), entry(INVOICE), entry(REFUND)]))).toContain('more than once');
  });

  it('fails for a blank qualification or fit, a non-integer issue number or a non-string overlap', () => {
    expect(errorOf(JSON.stringify([entry(REFUND, { qualification: '  ' }), entry(INVOICE)]))).toContain('qualification');
    expect(errorOf(JSON.stringify([entry(REFUND), entry(INVOICE, { fit: '' })]))).toContain('fit');
    expect(errorOf(JSON.stringify([entry(REFUND, { issueNumber: 1201.5 }), entry(INVOICE)]))).toContain('issueNumber');
    expect(errorOf(JSON.stringify([entry(REFUND, { issueNumber: '1201' }), entry(INVOICE)]))).toContain('issueNumber');
    expect(errorOf(JSON.stringify([entry(REFUND, { overlaps: ['orders.feature', 7] }), entry(INVOICE)]))).toContain('overlap');
    expect(errorOf(JSON.stringify(['not an object', entry(INVOICE)]))).toContain('not an object');
  });

  it('fails when the output holds no JSON array or invalid JSON', () => {
    expect(errorOf('I could not analyse the candidates.')).toContain('JSON array');
    expect(errorOf('[{"issueNumber": 1201, "scenarioName": }]')).toContain('JSON');
  });
});

describe('runProposalAnalysisAgent', () => {
  beforeEach(() => {
    vi.mocked(runCommandAgent).mockReset();
  });

  it('runs /promote_regression_vocabulary with the candidates as one JSON argument and returns the extracted analyses', async () => {
    const analyses = [analysisOf(REFUND), analysisOf(INVOICE)];
    vi.mocked(runCommandAgent).mockResolvedValue({ success: true, output: '[]', totalCostUsd: 0.12, parsed: analyses });
    const nominations = CANDIDATES.map((candidate) => ({ ...candidate, state: 'awaiting_proposal' }));

    const result = await runProposalAnalysisAgent(nominations, { logsDir: '/tmp/logs/abc123-promotion-proposal', cwd: '/repo/.worktrees/chore-promotion-proposal' });

    expect(result.analyses).toEqual(analyses);
    const [config, options] = vi.mocked(runCommandAgent).mock.calls[0];
    expect(config).toMatchObject({ command: '/promote_regression_vocabulary', outputSchema: proposalAnalysisSchema });
    expect(options).toEqual({
      logsDir: '/tmp/logs/abc123-promotion-proposal',
      cwd: '/repo/.worktrees/chore-promotion-proposal',
      args: JSON.stringify(CANDIDATES),
    });
    expect(config.extractOutput?.(JSON.stringify([entry(REFUND), entry(INVOICE)]))).toEqual({ success: true, data: analyses });
  });
});
