import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReviewAgent, formatReviewArgs, ReviewIssue, ReviewResult } from '../agents/reviewAgent';
import { extractJson } from '../core/jsonParser';

vi.mock('../agents/claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'mock-output',
    totalCostUsd: 0.5,
  }),
}));

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    log: vi.fn(),
  };
});

import { runClaudeAgentWithCommand } from '../agents/claudeAgent';

function createReviewResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    success: true,
    reviewSummary: 'Implementation matches the spec.',
    reviewIssues: [],
    screenshots: ['/path/to/screenshot.png'],
    ...overrides,
  };
}

function createBlockerIssue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    reviewIssueNumber: 1,
    screenshotPath: '/path/to/issue.png',
    issueDescription: 'Button color is wrong',
    issueResolution: 'Change button color to blue',
    issueSeverity: 'blocker',
    ...overrides,
  };
}

describe('extractJson (ReviewResult parsing)', () => {
  it('correctly parses valid JSON output', () => {
    const reviewResult = createReviewResult();
    const output = JSON.stringify(reviewResult);
    const result = extractJson<ReviewResult>(output);

    expect(result).toEqual(reviewResult);
  });

  it('handles malformed JSON gracefully (returns null)', () => {
    expect(extractJson<ReviewResult>('not json at all')).toBeNull();
    expect(extractJson<ReviewResult>('')).toBeNull();
    expect(extractJson<ReviewResult>('{ invalid json }')).toBeNull();
  });

  it('extracts JSON embedded in surrounding text', () => {
    const reviewResult = createReviewResult();
    const output = `Here is the result: ${JSON.stringify(reviewResult)} That was the output.`;
    const result = extractJson<ReviewResult>(output);

    expect(result).toEqual(reviewResult);
  });

  it('extracts JSON embedded in markdown code blocks', () => {
    const reviewResult = createReviewResult();
    const output = `\`\`\`json\n${JSON.stringify(reviewResult)}\n\`\`\``;
    const result = extractJson<ReviewResult>(output);

    expect(result).toEqual(reviewResult);
  });

  it('parses result with review issues', () => {
    const reviewResult = createReviewResult({
      success: false,
      reviewIssues: [
        createBlockerIssue(),
        { ...createBlockerIssue({ reviewIssueNumber: 2, issueSeverity: 'skippable' }) },
      ],
    });
    const result = extractJson<ReviewResult>(JSON.stringify(reviewResult));

    expect(result?.reviewIssues).toHaveLength(2);
    expect(result?.reviewIssues[0].issueSeverity).toBe('blocker');
    expect(result?.reviewIssues[1].issueSeverity).toBe('skippable');
  });
});

describe('runReviewAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runClaudeAgentWithCommand with /review, correct args, and opus model', async () => {
    const reviewResult = createReviewResult();
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: JSON.stringify(reviewResult),
      totalCostUsd: 0.5,
    });

    await runReviewAgent('adw-123', 'specs/issue-1-plan.md', '/logs');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/review',
      ['adw-123', 'specs/issue-1-plan.md', 'review_agent'],
      'Review',
      expect.stringContaining('review-agent.jsonl'),
      'opus',
      undefined,
      undefined,
      undefined
    );
  });

  it('correctly identifies blocker issues from review results', async () => {
    const reviewResult = createReviewResult({
      success: false,
      reviewIssues: [
        createBlockerIssue(),
        createBlockerIssue({ reviewIssueNumber: 2, issueSeverity: 'tech-debt' }),
        createBlockerIssue({ reviewIssueNumber: 3, issueSeverity: 'blocker' }),
      ],
    });
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: JSON.stringify(reviewResult),
      totalCostUsd: 0.5,
    });

    const result = await runReviewAgent('adw-123', 'specs/plan.md', '/logs');

    expect(result.blockerIssues).toHaveLength(2);
    expect(result.blockerIssues[0].reviewIssueNumber).toBe(1);
    expect(result.blockerIssues[1].reviewIssueNumber).toBe(3);
    expect(result.passed).toBe(false);
  });

  it('returns passed: true when no blockers exist (even with skippable/tech-debt issues)', async () => {
    const reviewResult = createReviewResult({
      success: true,
      reviewIssues: [
        createBlockerIssue({ reviewIssueNumber: 1, issueSeverity: 'skippable' }),
        createBlockerIssue({ reviewIssueNumber: 2, issueSeverity: 'tech-debt' }),
      ],
    });
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: JSON.stringify(reviewResult),
      totalCostUsd: 0.3,
    });

    const result = await runReviewAgent('adw-123', 'specs/plan.md', '/logs');

    expect(result.passed).toBe(true);
    expect(result.blockerIssues).toHaveLength(0);
  });

  it('returns passed: true when reviewResult is null (unparseable output)', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: 'not json',
      totalCostUsd: 0.1,
    });

    const result = await runReviewAgent('adw-123', 'specs/plan.md', '/logs');

    expect(result.reviewResult).toBeNull();
    expect(result.passed).toBe(true);
    expect(result.blockerIssues).toHaveLength(0);
  });

  it('passes statePath and cwd to runClaudeAgentWithCommand', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: JSON.stringify(createReviewResult()),
      totalCostUsd: 0.5,
    });

    await runReviewAgent('adw-123', 'specs/plan.md', '/logs', '/state/path', '/worktree');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/review',
      expect.any(Array),
      'Review',
      expect.any(String),
      'opus',
      undefined,
      '/state/path',
      '/worktree'
    );
  });

  it('appends applicationUrl as 4th line in args when provided', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: JSON.stringify(createReviewResult()),
      totalCostUsd: 0.5,
    });

    await runReviewAgent('adw-123', 'specs/plan.md', '/logs', undefined, undefined, 'http://localhost:45678');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/review',
      ['adw-123', 'specs/plan.md', 'review_agent', 'http://localhost:45678'],
      'Review',
      expect.any(String),
      'opus',
      undefined,
      undefined,
      undefined
    );
  });

  it('omits applicationUrl from args when not provided', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: JSON.stringify(createReviewResult()),
      totalCostUsd: 0.5,
    });

    await runReviewAgent('adw-123', 'specs/plan.md', '/logs');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/review',
      ['adw-123', 'specs/plan.md', 'review_agent'],
      'Review',
      expect.any(String),
      'opus',
      undefined,
      undefined,
      undefined
    );
  });
});

describe('formatReviewArgs', () => {
  it('returns array with adwId, specFile, and agentName', () => {
    const result = formatReviewArgs('adw-123', 'specs/plan.md', 'review_agent');
    expect(result).toEqual(['adw-123', 'specs/plan.md', 'review_agent']);
  });

  it('includes applicationUrl as 4th element when provided', () => {
    const result = formatReviewArgs('adw-123', 'specs/plan.md', 'review_agent', 'http://localhost:45678');
    expect(result).toEqual(['adw-123', 'specs/plan.md', 'review_agent', 'http://localhost:45678']);
  });

  it('omits applicationUrl when not provided', () => {
    const result = formatReviewArgs('adw-123', 'specs/plan.md', 'review_agent');
    expect(result).toHaveLength(3);
  });
});
