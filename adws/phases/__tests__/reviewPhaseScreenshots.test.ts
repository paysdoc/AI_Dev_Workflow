import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform } from '@paysdoc/devplatform';

vi.mock('../../core', () => ({
  log: vi.fn(),
  AgentStateManager: {
    appendLog: vi.fn(),
    initializeState: vi.fn(() => '/tmp/state'),
  },
  emptyModelUsageMap: vi.fn(() => ({})),
  mergeModelUsageMaps: vi.fn((a, b) => ({ ...a, ...b })),
}));

vi.mock('../../cost', () => ({
  createPhaseCostRecords: vi.fn(() => []),
  PhaseCostStatus: { Success: 'success', Failed: 'failed' },
}));

vi.mock('../../agents/planAgent', () => ({
  getPlanFilePath: vi.fn(() => '/tmp/plan.md'),
}));

vi.mock('../../agents/reviewAgent', () => ({
  runReviewAgent: vi.fn(),
}));

vi.mock('../phaseCommentHelpers', () => ({
  postIssueStageComment: vi.fn(),
}));

vi.mock('../../proof/proofUploader', () => ({
  uploadProofArtifacts: vi.fn(),
}));

import { executeReviewPhase } from '../reviewPhase';
import { runReviewAgent } from '../../agents/reviewAgent';
import { postIssueStageComment } from '../phaseCommentHelpers';
import { uploadProofArtifacts } from '../../proof/proofUploader';
import type { WorkflowConfig } from '../workflowInit';

const mockRunReviewAgent = vi.mocked(runReviewAgent);
const mockPostIssueStageComment = vi.mocked(postIssueStageComment);
const mockUploadProofArtifacts = vi.mocked(uploadProofArtifacts);

const passingReview = {
  success: true,
  output: '',
  sessionId: 's',
  totalCostUsd: 0.01,
  modelUsage: {},
  passed: true,
  blockerIssues: [],
  reviewResult: { success: true, reviewSummary: 'LGTM', reviewIssues: [], screenshots: [] },
};

const blocker = {
  reviewIssueNumber: 1,
  issueDescription: 'Bug in logic',
  issueResolution: 'Fix it',
  issueSeverity: 'blocker' as const,
};

const failingReview = { ...passingReview, passed: false, blockerIssues: [blocker] };

const uploaded = [
  { scenario: 'login', fileName: 'step-1.png', url: 'https://screenshots.paysdoc.nl/repo/proof/test-adw/login/step-1.png' },
  { scenario: 'checkout', fileName: 'step-2.png', url: 'https://screenshots.paysdoc.nl/repo/proof/test-adw/checkout/step-2.png' },
];
const uploadedUrls = uploaded.map(artifact => artifact.url);

const repoId = { owner: 'test', repo: 'repo', platform: Platform.GitHub } as const;

interface MakeConfigOptions {
  withRepoContext?: boolean;
  withScenarioProof?: boolean;
}

function makeConfig({ withRepoContext = true, withScenarioProof = true }: MakeConfigOptions = {}): WorkflowConfig {
  return {
    orchestratorStatePath: '/tmp/orch-state',
    issueNumber: 42,
    issue: {
      id: '42',
      number: 42,
      title: 'Test',
      body: '',
      state: 'OPEN',
      author: 'test',
      labels: [],
      comments: [],
      createdAt: '2026-01-01T00:00:00Z',
      url: 'https://github.com/test/repo/issues/42',
    },
    ctx: withScenarioProof
      ? {
          scenarioProof: {
            tagResults: [],
            hasBlockerFailures: false,
            resultsFilePath: '/tmp/proof.md',
            artifactsDir: '/tmp/artifacts',
          },
        }
      : {},
    logsDir: '/tmp/logs',
    worktreePath: '/tmp/worktree',
    adwId: 'test-adw',
    repoContext: withRepoContext
      ? { issueTracker: {}, codeHost: {}, cwd: '/tmp', repoId }
      : undefined,
  } as unknown as WorkflowConfig;
}

interface PostedComment {
  readonly stage: string;
  readonly screenshotUrls: string[] | undefined;
}

let posted: PostedComment[];

beforeEach(() => {
  posted = [];
  mockRunReviewAgent.mockReset();
  mockRunReviewAgent.mockResolvedValue(passingReview);
  mockPostIssueStageComment.mockReset();
  mockPostIssueStageComment.mockImplementation((_repoContext, _issueNumber, stage, ctx) => {
    posted.push({ stage, screenshotUrls: ctx.screenshotUrls });
  });
  mockUploadProofArtifacts.mockReset();
  mockUploadProofArtifacts.mockResolvedValue(uploaded);
});

function commentAt(stage: string): PostedComment | undefined {
  return posted.find(comment => comment.stage === stage);
}

describe('executeReviewPhase — screenshots on the issue comment', () => {
  it('uploads the images of the proof it judged and puts their URLs on the Review Passed comment', async () => {
    const config = makeConfig();

    await executeReviewPhase(config, '/tmp/proof.md');

    expect(mockUploadProofArtifacts).toHaveBeenCalledTimes(1);
    expect(mockUploadProofArtifacts).toHaveBeenCalledWith({
      artifactsDir: '/tmp/artifacts',
      repoInfo: repoId,
      adwId: 'test-adw',
    });
    expect(commentAt('review_passed')?.screenshotUrls).toEqual(uploadedUrls);
  });

  it('puts their URLs on the Review Failed comment of a failing review', async () => {
    mockRunReviewAgent.mockResolvedValue(failingReview);

    const result = await executeReviewPhase(makeConfig(), '/tmp/proof.md');

    expect(result.reviewPassed).toBe(false);
    expect(commentAt('review_failed')?.screenshotUrls).toEqual(uploadedUrls);
  });

  it('uploads nothing and sets an empty list when there is no scenario proof', async () => {
    const config = makeConfig({ withScenarioProof: false });

    await executeReviewPhase(config, '');

    expect(mockUploadProofArtifacts).not.toHaveBeenCalled();
    expect(config.ctx.screenshotUrls).toEqual([]);
  });

  it('uploads nothing and posts no comment when there is no repository context', async () => {
    const config = makeConfig({ withRepoContext: false });

    await executeReviewPhase(config, '/tmp/proof.md');

    expect(mockUploadProofArtifacts).not.toHaveBeenCalled();
    expect(mockPostIssueStageComment).not.toHaveBeenCalled();
  });

  it('replaces the URLs of an earlier attempt, so a later comment never shows images of an earlier run', async () => {
    const config = makeConfig();
    await executeReviewPhase(config, '/tmp/proof.md');
    mockUploadProofArtifacts.mockResolvedValue([]);

    await executeReviewPhase(config, '/tmp/proof.md');

    expect(config.ctx.screenshotUrls).toEqual([]);
    expect(posted.filter(comment => comment.stage === 'review_passed').map(comment => comment.screenshotUrls)).toEqual([
      uploadedUrls,
      [],
    ]);
  });

  it('uploads nothing when the review agent fails to return', async () => {
    mockRunReviewAgent.mockRejectedValue(new Error('rate limited'));

    await expect(executeReviewPhase(makeConfig(), '/tmp/proof.md')).rejects.toThrow('rate limited');

    expect(mockUploadProofArtifacts).not.toHaveBeenCalled();
  });
});
