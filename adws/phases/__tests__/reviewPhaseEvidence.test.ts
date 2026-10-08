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
import { AgentStateManager } from '../../core';
import { runReviewAgent } from '../../agents/reviewAgent';
import { ReviewIssueKind, type ReviewPromptContext } from '../../agents/reviewPromptArgs';
import { APPLICATION_TYPE_PROFILES, type ApplicationProfile } from '../../core/applicationType';
import { ADW_REGRESSION_PROMOTION_LABEL } from '../../core/adwLabels';
import { uploadProofArtifacts } from '../../proof/proofUploader';
import type { PerIssueImage } from '../../proof/types';
import type { WorkflowConfig } from '../workflowInit';

const mockRunReviewAgent = vi.mocked(runReviewAgent);
const mockUploadProofArtifacts = vi.mocked(uploadProofArtifacts);
const mockAppendLog = vi.mocked(AgentStateManager.appendLog);

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

const TOTAL: PerIssueImage = { absPath: '/tmp/artifacts/adw-42/cart/total.png', relPath: 'adw-42/cart/total.png', scenario: 'Cart › The cart shows the order total' };
const ADDRESS: PerIssueImage = { absPath: '/tmp/artifacts/adw-42/checkout/address.png', relPath: 'adw-42/checkout/address.png', scenario: 'Checkout › The page asks for an address' };
const DISCOUNTED: PerIssueImage = { absPath: '/tmp/artifacts/adw-42/cart/discounted.png', relPath: 'adw-42/cart/discounted.png', scenario: 'Cart › The cart shows the order total' };

const repoId = { owner: 'test', repo: 'repo', platform: Platform.GitHub } as const;
const ORCHESTRATOR_STATE_PATH = '/tmp/orch-state';

interface MakeConfigOptions {
  profile?: ApplicationProfile;
  labels?: string[];
  /** `null` is a workflow with no scenario proof on its context. */
  images?: readonly PerIssueImage[] | null;
}

function proofOf(images: readonly PerIssueImage[]) {
  return { tagResults: [], hasBlockerFailures: false, perIssueImages: images, resultsFilePath: '/tmp/proof.md', artifactsDir: '/tmp/artifacts' };
}

function makeConfig({ profile = APPLICATION_TYPE_PROFILES.web, labels = [], images = [TOTAL, ADDRESS] }: MakeConfigOptions = {}): WorkflowConfig {
  return {
    orchestratorStatePath: ORCHESTRATOR_STATE_PATH,
    issueNumber: 42,
    issue: { id: '42', number: 42, title: 'Test', body: 'The issue body', state: 'OPEN', author: 'test', labels, comments: [], createdAt: '2026-01-01T00:00:00Z', url: 'https://github.com/test/repo/issues/42' },
    issueType: '/feature',
    applicationProfile: profile,
    ctx: images === null ? {} : { scenarioProof: proofOf(images) },
    logsDir: '/tmp/logs',
    worktreePath: '/tmp/worktree',
    adwId: 'test-adw',
    repoContext: { issueTracker: {}, codeHost: {}, cwd: '/tmp', repoId },
  } as unknown as WorkflowConfig;
}

/** What the phase handed the review agent as the third argument of `runReviewAgent`, for the call at `callIndex`. */
function contextOfCall(callIndex = 0): ReviewPromptContext {
  return mockRunReviewAgent.mock.calls[callIndex][2];
}

/** The eighth argument of `runReviewAgent`: the proof path. */
function proofPathOfCall(callIndex = 0): string | undefined {
  return mockRunReviewAgent.mock.calls[callIndex][7];
}

function loggedHandOffs(): string[] {
  return mockAppendLog.mock.calls
    .filter(([statePath]) => statePath === ORCHESTRATOR_STATE_PATH)
    .map(([, line]) => line)
    .filter(line => line.startsWith('Review: '));
}

beforeEach(() => {
  mockRunReviewAgent.mockReset();
  mockRunReviewAgent.mockResolvedValue(passingReview);
  mockUploadProofArtifacts.mockReset();
  mockUploadProofArtifacts.mockResolvedValue([]);
  mockAppendLog.mockClear();
});

describe('executeReviewPhase — what the review agent is handed', () => {
  it('starts the review of a web workflow with its guidance section, the issue kind and the paths of the images its proof selected', async () => {
    await executeReviewPhase(makeConfig(), '/tmp/proof.md');

    expect(mockRunReviewAgent).toHaveBeenCalledTimes(1);
    expect(contextOfCall()).toEqual({
      guidanceSection: 'Web applications',
      issueKind: ReviewIssueKind.Feature,
      imagePaths: [TOTAL.absPath, ADDRESS.absPath],
    });
  });

  it('hands over the images it uploads for the comment of the same attempt, no more and no fewer', async () => {
    await executeReviewPhase(makeConfig(), '/tmp/proof.md');

    const [{ images }] = mockUploadProofArtifacts.mock.calls[0];
    expect(contextOfCall().imagePaths).toEqual(images.map(image => image.absPath));
  });

  it('starts the review of a cli workflow with the cli guidance section and no image', async () => {
    await executeReviewPhase(makeConfig({ profile: APPLICATION_TYPE_PROFILES.cli, images: [] }), '/tmp/proof.md');

    expect(contextOfCall()).toMatchObject({ guidanceSection: 'CLI applications', imagePaths: [] });
  });

  it('hands over no image when the workflow has no scenario proof', async () => {
    await executeReviewPhase(makeConfig({ images: null }), '');

    expect(contextOfCall().imagePaths).toEqual([]);
  });

  it('hands over the promotion kind when the issue carries the regression-promotion label', async () => {
    await executeReviewPhase(makeConfig({ labels: [ADW_REGRESSION_PROMOTION_LABEL] }), '/tmp/proof.md');

    expect(contextOfCall().issueKind).toBe(ReviewIssueKind.Promotion);
  });

  it('still hands over the proof path', async () => {
    await executeReviewPhase(makeConfig(), '/tmp/proof.md');

    expect(proofPathOfCall()).toBe('/tmp/proof.md');
  });

  it('hands over no proof path when the repository runs no scenarios', async () => {
    await executeReviewPhase(makeConfig({ images: null }), '');

    expect(proofPathOfCall()).toBeUndefined();
  });
});

describe('executeReviewPhase — the hand-off in the orchestrator log', () => {
  it('records the guidance section, the issue kind and every image path before the review runs', async () => {
    mockRunReviewAgent.mockImplementation(async () => {
      expect(loggedHandOffs()).toHaveLength(1);
      return passingReview;
    });

    await executeReviewPhase(makeConfig(), '/tmp/proof.md');

    const [handOff] = loggedHandOffs();
    expect(handOff).toContain('Web applications');
    expect(handOff).toContain('feature');
    expect(handOff).toContain(TOTAL.absPath);
    expect(handOff).toContain(ADDRESS.absPath);
  });

  it('says in the log that there is no per-issue image when there is none', async () => {
    await executeReviewPhase(makeConfig({ profile: APPLICATION_TYPE_PROFILES.cli, images: [] }), '/tmp/proof.md');

    expect(loggedHandOffs()).toEqual(['Review: "CLI applications" guidance, feature issue, no per-issue image']);
  });
});

describe('executeReviewPhase — a review retried after the scenarios were re-run', () => {
  it("hands the next attempt the new proof's images and none of the earlier run's", async () => {
    const config = makeConfig({ images: [TOTAL] });
    await executeReviewPhase(config, '/tmp/proof.md');

    config.ctx.scenarioProof = proofOf([DISCOUNTED]);
    await executeReviewPhase(config, '/tmp/proof.md');

    expect(contextOfCall(0).imagePaths).toEqual([TOTAL.absPath]);
    expect(contextOfCall(1).imagePaths).toEqual([DISCOUNTED.absPath]);
    expect(loggedHandOffs()).toHaveLength(2);
    expect(loggedHandOffs()[1]).not.toContain(TOTAL.absPath);
  });
});
