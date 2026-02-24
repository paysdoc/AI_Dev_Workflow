import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatPatchArgs, runPatchAgent } from '../agents/patchAgent';
import { ReviewIssue } from '../agents/reviewAgent';

vi.mock('../agents/claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'specs/patch/patch-adw-123-fix-button.md',
    totalCostUsd: 0.8,
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

function createReviewIssue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    reviewIssueNumber: 1,
    screenshotPath: '/path/to/issue.png',
    issueDescription: 'Button color is wrong',
    issueResolution: 'Change button color to blue',
    issueSeverity: 'blocker',
    ...overrides,
  };
}

describe('formatPatchArgs', () => {
  it('produces correct format with all parameters', () => {
    const issue = createReviewIssue();
    const result = formatPatchArgs('adw-123', issue, '/specs/plan.md', '/screenshots/issue.png');

    expect(result).toContain('adw-123');
    expect(result).toContain('Issue #1: Button color is wrong');
    expect(result).toContain('Resolution: Change button color to blue');
    expect(result).toContain('/specs/plan.md');
    expect(result).toContain('/screenshots/issue.png');
  });

  it('handles optional parameters gracefully', () => {
    const issue = createReviewIssue();
    const result = formatPatchArgs('adw-456', issue);

    expect(result).toContain('adw-456');
    expect(result).toContain('Issue #1');
    // Spec path and screenshots should be empty
    const lines = result.split('\n');
    // Line 0: adwId, Line 1: issue desc, Line 2: resolution, Line 3: spec_path, Line 4: agent_name, Line 5: screenshots
    expect(lines[3]).toBe(''); // spec_path empty
    expect(lines[5]).toBe(''); // screenshots empty
  });

  it('formats with different issue numbers', () => {
    const issue = createReviewIssue({ reviewIssueNumber: 5 });
    const result = formatPatchArgs('adw-789', issue);

    expect(result).toContain('Issue #5');
  });
});

describe('runPatchAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runClaudeAgentWithCommand with /patch, correct args, and opus model', async () => {
    const issue = createReviewIssue();
    await runPatchAgent('adw-123', issue, '/logs');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/patch',
      expect.stringContaining('adw-123'),
      'Patch: 1',
      expect.stringContaining('patch-agent-issue-1.jsonl'),
      'opus',
      undefined,
      undefined,
      undefined
    );
  });

  it('passes through cwd to the underlying agent', async () => {
    const issue = createReviewIssue();
    await runPatchAgent('adw-123', issue, '/logs', '/specs/plan.md', undefined, '/state', '/worktree');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/patch',
      expect.any(String),
      'Patch: 1',
      expect.any(String),
      'opus',
      undefined,
      '/state',
      '/worktree'
    );
  });

  it('includes specPath in args when provided', async () => {
    const issue = createReviewIssue();
    await runPatchAgent('adw-123', issue, '/logs', '/specs/plan.md');

    const args = vi.mocked(runClaudeAgentWithCommand).mock.calls[0][1];
    expect(args).toContain('/specs/plan.md');
  });

  it('uses issue screenshotPath as screenshots arg', async () => {
    const issue = createReviewIssue({ screenshotPath: '/img/blocker.png' });
    await runPatchAgent('adw-123', issue, '/logs');

    const args = vi.mocked(runClaudeAgentWithCommand).mock.calls[0][1];
    expect(args).toContain('/img/blocker.png');
  });
});
