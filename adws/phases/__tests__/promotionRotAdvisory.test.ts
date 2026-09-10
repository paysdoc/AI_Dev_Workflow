import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
  emptyModelUsageMap: vi.fn(() => ({})),
  mergeModelUsageMaps: vi.fn((a: object, b: object) => ({ ...a, ...b })),
  hasRegressionPromotionLabel: (labels: readonly string[]) =>
    labels.includes('regression-promotion'),
}));

vi.mock('../../cost', () => ({
  createPhaseCostRecords: vi.fn(() => []),
  PhaseCostStatus: { Success: 'success' },
}));

vi.mock('../../agents/rotAnalysisAgent', () => ({
  runRotAnalysisAgent: vi.fn(),
}));

import { runPromotionRotAdvisory, executePromotionRotAdvisory } from '../promotionRotAdvisory';
import { runRotAnalysisAgent } from '../../agents/rotAnalysisAgent';
import type { RotVerdict } from '../../agents/rotAnalysisAgent';

const mockRunRotAnalysisAgent = vi.mocked(runRotAnalysisAgent);

const sampleVerdicts: RotVerdict[] = [
  { step: 'a foo happens', keyword: 'Given', reuse: 'new', rot: 'VALID', note: 'ok' },
];

// ── runPromotionRotAdvisory: the injectable core — no mocking needed for its own deps ──

describe('runPromotionRotAdvisory (injectable core)', () => {
  it('label absent → analyze and postComment are never called', async () => {
    const analyze = vi.fn(async () => sampleVerdicts);
    const postComment = vi.fn();
    await runPromotionRotAdvisory(
      { prNumber: 900, labels: ['enhancement'], feature: 'feature-665' },
      { analyze, postComment, log: vi.fn() },
    );
    expect(analyze).not.toHaveBeenCalled();
    expect(postComment).not.toHaveBeenCalled();
  });

  it('label present → analyze called once with the feature id, postComment called once with a formatted body', async () => {
    const analyze = vi.fn(async () => sampleVerdicts);
    const postComment = vi.fn();
    await runPromotionRotAdvisory(
      { prNumber: 900, labels: ['regression-promotion'], feature: 'feature-665' },
      { analyze, postComment, log: vi.fn() },
    );
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith('feature-665');
    expect(postComment).toHaveBeenCalledTimes(1);
    const [prNumber, body] = postComment.mock.calls[0];
    expect(prNumber).toBe(900);
    expect(body).toContain('a foo happens');
  });

  it('analyze throws → resolves without throwing and posts no comment', async () => {
    const analyze = vi.fn(async () => { throw new Error('injected analysis failure'); });
    const postComment = vi.fn();
    await expect(
      runPromotionRotAdvisory(
        { prNumber: 900, labels: ['regression-promotion'], feature: 'feature-665' },
        { analyze, postComment, log: vi.fn() },
      ),
    ).resolves.toBeUndefined();
    expect(postComment).not.toHaveBeenCalled();
  });

  it('postComment throws → resolves without throwing', async () => {
    const analyze = vi.fn(async () => sampleVerdicts);
    const postComment = vi.fn(() => { throw new Error('transient gh error'); });
    await expect(
      runPromotionRotAdvisory(
        { prNumber: 900, labels: ['regression-promotion'], feature: 'feature-665' },
        { analyze, postComment, log: vi.fn() },
      ),
    ).resolves.toBeUndefined();
  });
});

// ── executePromotionRotAdvisory: the WorkflowConfig adapter ────────────────────────────

const okAgentResult = {
  success: true,
  output: '[]',
  sessionId: 'sess',
  totalCostUsd: 0.01,
  modelUsage: {},
  parsed: sampleVerdicts,
};

function makeIssue(labels: string[]) {
  return {
    id: '665',
    number: 665,
    title: 'Promote scenario',
    body: 'Promotes: feature-665\n',
    state: 'OPEN',
    author: 'test',
    labels,
    comments: [],
    createdAt: '2026-01-01T00:00:00Z',
    url: 'https://github.com/test/test/issues/665',
  };
}

function makeWorkflowConfig(overrides: Record<string, unknown> = {}) {
  return {
    adwId: 'test-adw',
    issueNumber: 665,
    issue: makeIssue(['regression-promotion']),
    ctx: { prNumber: 900 },
    logsDir: '/tmp/logs',
    worktreePath: '/tmp/worktree',
    repoContext: { codeHost: { commentOnPullRequest: vi.fn() } },
    ...overrides,
  } as unknown as Parameters<typeof executePromotionRotAdvisory>[0] & {
    repoContext: { codeHost: { commentOnPullRequest: ReturnType<typeof vi.fn> } };
  };
}

describe('executePromotionRotAdvisory (WorkflowConfig adapter)', () => {
  beforeEach(() => {
    mockRunRotAnalysisAgent.mockReset();
    mockRunRotAnalysisAgent.mockResolvedValue(okAgentResult);
  });

  it('label absent → commentOnPullRequest not called, resolves', async () => {
    const config = makeWorkflowConfig({ issue: makeIssue(['enhancement']) });
    const result = await executePromotionRotAdvisory(config);
    expect(config.repoContext.codeHost.commentOnPullRequest).not.toHaveBeenCalled();
    expect(mockRunRotAnalysisAgent).not.toHaveBeenCalled();
    expect(result.phaseCostRecords).toEqual([]);
  });

  it('label + PR number + marker present → agent called once, comment posted exactly once', async () => {
    const config = makeWorkflowConfig();
    await executePromotionRotAdvisory(config);
    expect(mockRunRotAnalysisAgent).toHaveBeenCalledTimes(1);
    expect(mockRunRotAnalysisAgent).toHaveBeenCalledWith('feature-665', expect.objectContaining({ cwd: '/tmp/worktree' }));
    expect(config.repoContext.codeHost.commentOnPullRequest).toHaveBeenCalledTimes(1);
  });

  it('agent throws (e.g. OutputValidationError after exhausted retries) → resolves without throwing, no comment posted', async () => {
    mockRunRotAnalysisAgent.mockReset();
    mockRunRotAnalysisAgent.mockRejectedValueOnce(new Error('Output validation failed after 10 retries'));
    const config = makeWorkflowConfig();
    await expect(executePromotionRotAdvisory(config)).resolves.toBeDefined();
    expect(config.repoContext.codeHost.commentOnPullRequest).not.toHaveBeenCalled();
  });

  it('no PR number resolvable → no agent call, no comment, resolves with zero cost', async () => {
    const config = makeWorkflowConfig({ ctx: {} });
    const result = await executePromotionRotAdvisory(config);
    expect(mockRunRotAnalysisAgent).not.toHaveBeenCalled();
    expect(config.repoContext.codeHost.commentOnPullRequest).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });
});
