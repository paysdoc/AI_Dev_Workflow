import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../agents/proposalAnalysisAgent', () => ({
  runProposalAnalysisAgent: vi.fn(),
}));

vi.mock('../../phases/worktreeSetup', () => ({
  copyClaudeAssetsToWorktree: vi.fn(),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    generateAdwId: vi.fn(() => 'abc123-promotion-proposal'),
    ensureLogsDirectory: vi.fn((adwId: string) => `/tmp/adw-logs/${adwId}`),
  };
});

import type { LaunchBoundary } from '../../core';
import { runProposalAnalysisAgent } from '../../agents/proposalAnalysisAgent';
import { copyClaudeAssetsToWorktree } from '../../phases/worktreeSetup';
import type { Nomination } from '../../promotion/nominationCollector';
import { NominationState } from '../../promotion/nominationCollector';
import type { ProposalIssueSpec } from '../../promotion/proposalBody';
import { makePromotionProposalDefaults, PROMOTION_PROPOSAL_CHECKOUT_BRANCH } from '../promotionProposalDefaults';

const WORKTREE_PATH = '/repo/.worktrees/chore-promotion-proposal';
const SPEC: ProposalIssueSpec = { title: 'Promotion Proposal 2026-11-28: 1 candidate', body: '## Promotion Proposal', labels: ['adw:none', 'promotion-proposal'] };

function fakeBoundary(options: { worktreeFails?: boolean; failingLabel?: string } = {}) {
  const calls: string[] = [];
  const gitContext = {
    selfHost: true,
    owner: 'acme',
    repo: 'widgets',
    removeWorktree: vi.fn((branch: string) => {
      calls.push(`removeWorktree ${branch}`);
      throw new Error('no such worktree');
    }),
    createWorktreeForNewBranch: vi.fn((branch: string, base: string) => {
      calls.push(`createWorktreeForNewBranch ${branch} ${base}`);
      if (options.worktreeFails) throw new Error('git worktree add failed');
      return WORKTREE_PATH;
    }),
  };
  const issueTracker = {
    createIssue: vi.fn((title: string) => {
      calls.push(`createIssue ${title}`);
      return 1500;
    }),
    applyLabel: vi.fn((issueNumber: number, label: string) => {
      calls.push(`applyLabel #${issueNumber} ${label}`);
      if (label === options.failingLabel) throw new Error(`could not apply ${label}`);
    }),
    closeIssue: vi.fn(async (issueNumber: number) => {
      calls.push(`closeIssue #${issueNumber}`);
      return true;
    }),
  };
  const codeHost = { getDefaultBranch: vi.fn(() => 'trunk') };
  const boundary = { gitContext, providers: { issueTracker, codeHost } } as unknown as LaunchBoundary;
  return { boundary, gitContext, issueTracker, calls };
}

describe('makePromotionProposalDefaults', () => {
  beforeEach(() => {
    vi.mocked(runProposalAnalysisAgent).mockReset();
    vi.mocked(copyClaudeAssetsToWorktree).mockReset();
  });

  it('fileProposal creates the issue and applies adw:none before the Promotion Proposal label', async () => {
    const { boundary, calls } = fakeBoundary();

    const issueNumber = await makePromotionProposalDefaults(boundary, vi.fn()).fileProposal(SPEC);

    expect(issueNumber).toBe(1500);
    expect(calls).toEqual([`createIssue ${SPEC.title}`, 'applyLabel #1500 adw:none', 'applyLabel #1500 promotion-proposal']);
  });

  it('fileProposal closes the issue it created, and rethrows, when a label cannot be applied', async () => {
    const { boundary, issueTracker, calls } = fakeBoundary({ failingLabel: 'promotion-proposal' });

    await expect(makePromotionProposalDefaults(boundary, vi.fn()).fileProposal(SPEC)).rejects.toThrow('could not apply promotion-proposal');

    expect(calls[calls.length - 1]).toBe('closeIssue #1500');
    expect(issueTracker.closeIssue).toHaveBeenCalledWith(1500, expect.stringContaining('could not label this Promotion Proposal'));
  });

  it('prepareCheckout removes a stale checkout and creates one off the default branch, and returns null when that fails', () => {
    const ready = fakeBoundary();
    const failing = fakeBoundary({ worktreeFails: true });
    const log = vi.fn();

    expect(makePromotionProposalDefaults(ready.boundary, vi.fn()).prepareCheckout()).toEqual({ worktreePath: WORKTREE_PATH, defaultBranch: 'trunk' });
    expect(ready.calls).toEqual([`removeWorktree ${PROMOTION_PROPOSAL_CHECKOUT_BRANCH}`, `createWorktreeForNewBranch ${PROMOTION_PROPOSAL_CHECKOUT_BRANCH} trunk`]);

    expect(makePromotionProposalDefaults(failing.boundary, log).prepareCheckout()).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('git worktree add failed'), 'warn');
  });

  it("analyse copies ADW's commands and skills into the checkout and runs the analysis there with the boundary's launch context", async () => {
    const { boundary, gitContext } = fakeBoundary();
    const candidate: Nomination = { issueNumber: 1207, scenarioName: 'An invoice is sent', featurePath: 'features/per-issue/feature-1207.feature', state: NominationState.AwaitingProposal };
    const analyses = [{ issueNumber: 1207, scenarioName: 'An invoice is sent', qualification: 'q', fit: 'f', overlaps: [] }];
    vi.mocked(runProposalAnalysisAgent).mockResolvedValue({ success: true, output: '[]', totalCostUsd: 0.25, analyses });

    const result = await makePromotionProposalDefaults(boundary, vi.fn()).analyse([candidate], { worktreePath: WORKTREE_PATH, defaultBranch: 'trunk' });

    expect(result).toEqual(analyses);
    expect(copyClaudeAssetsToWorktree).toHaveBeenCalledWith(WORKTREE_PATH, gitContext);
    expect(runProposalAnalysisAgent).toHaveBeenCalledWith([candidate], {
      logsDir: '/tmp/adw-logs/abc123-promotion-proposal',
      cwd: WORKTREE_PATH,
      phaseName: 'promotionProposal',
      launchContext: { selfHost: true, adwId: 'abc123-promotion-proposal', gitContext },
    });
  });
});
