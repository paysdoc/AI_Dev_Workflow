import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseAdwClassificationOutput,
  classifyWithAdwCommand,
  classifyIssueForTrigger,
  classifyGitHubIssue,
  getWorkflowScript,
} from '../core/issueClassifier';
import { adwCommandToIssueTypeMap, adwCommandToOrchestratorMap, AdwSlashCommand, GitHubIssue } from '../core/dataTypes';

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    log: vi.fn(),
  };
});

vi.mock('../github/githubApi', () => ({
  fetchGitHubIssue: vi.fn(),
}));

vi.mock('../agents/claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn(),
}));

import { log } from '../core';
import { fetchGitHubIssue } from '../github/githubApi';
import { runClaudeAgentWithCommand } from '../agents/claudeAgent';

function createMockIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: 'Test issue',
    body: 'Test body with /adw_plan_build_test',
    state: 'open',
    author: { login: 'test', isBot: false },
    assignees: [],
    labels: [],
    comments: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    url: 'https://github.com/test/repo/issues/42',
    ...overrides,
  };
}

// ============================================================================
// parseAdwClassificationOutput
// ============================================================================

describe('parseAdwClassificationOutput', () => {
  it('returns parsed result for valid JSON with adwSlashCommand', () => {
    const result = parseAdwClassificationOutput('{"adwSlashCommand": "/adw_plan"}');

    expect(result).toEqual({ adwSlashCommand: '/adw_plan' });
  });

  it('returns parsed result for JSON with both adwSlashCommand and adwId', () => {
    const result = parseAdwClassificationOutput(
      '{"adwSlashCommand": "/adw_build", "adwId": "abc12345"}'
    );

    expect(result).toEqual({ adwSlashCommand: '/adw_build', adwId: 'abc12345' });
  });

  it('returns null for empty JSON {}', () => {
    expect(parseAdwClassificationOutput('{}')).toBeNull();
  });

  it('returns null for invalid/malformed output', () => {
    expect(parseAdwClassificationOutput('not json at all')).toBeNull();
    expect(parseAdwClassificationOutput('')).toBeNull();
    expect(parseAdwClassificationOutput('  ')).toBeNull();
  });

  it('returns null for JSON with unknown ADW command', () => {
    const result = parseAdwClassificationOutput('{"adwSlashCommand": "/adw_unknown"}');

    expect(result).toBeNull();
  });

  it('handles JSON embedded in surrounding text', () => {
    const output = 'Here is the result: {"adwSlashCommand": "/adw_sdlc", "adwId": "xyz98765"} That is the extracted info.';
    const result = parseAdwClassificationOutput(output);

    expect(result).toEqual({ adwSlashCommand: '/adw_sdlc', adwId: 'xyz98765' });
  });

  it('returns null when adwSlashCommand is missing but adwId is present', () => {
    const result = parseAdwClassificationOutput('{"adwId": "abc12345"}');

    expect(result).toBeNull();
  });

  it('returns result with only adwSlashCommand when adwId is absent', () => {
    const result = parseAdwClassificationOutput('{"adwSlashCommand": "/adw_patch"}');

    expect(result).toEqual({ adwSlashCommand: '/adw_patch' });
  });
});

// ============================================================================
// classifyWithAdwCommand
// ============================================================================

describe('classifyWithAdwCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns classification result when ADW command is found', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      output: '{"adwSlashCommand": "/adw_plan_build_test"}',
      success: true,
    });

    const result = await classifyWithAdwCommand('issue text', 42, '/tmp/output.jsonl');

    expect(result).toEqual({
      issueType: '/feature',
      success: true,
      adwCommand: '/adw_plan_build_test',
      adwId: undefined,
    });
  });

  it('returns classification with adwId when both command and ID are found', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      output: '{"adwSlashCommand": "/adw_build", "adwId": "abc12345"}',
      success: true,
    });

    const result = await classifyWithAdwCommand('issue text', 42, '/tmp/output.jsonl');

    expect(result).toEqual({
      issueType: '/feature',
      success: true,
      adwCommand: '/adw_build',
      adwId: 'abc12345',
    });
  });

  it('returns null when agent returns empty JSON', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      output: '{}',
      success: true,
    });

    const result = await classifyWithAdwCommand('issue text', 42, '/tmp/output.jsonl');

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('no valid command')
    );
  });

  it('returns null when agent call fails', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      output: '',
      success: false,
    });

    const result = await classifyWithAdwCommand('issue text', 42, '/tmp/output.jsonl');

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('ADW classifier agent failed'),
      'error'
    );
  });

  it('returns null when agent throws', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockRejectedValue(new Error('agent error'));

    const result = await classifyWithAdwCommand('issue text', 42, '/tmp/output.jsonl');

    expect(result).toBeNull();
  });

  it('maps each ADW command to the correct IssueClassSlashCommand', async () => {
    const entries = Object.entries(adwCommandToIssueTypeMap) as [AdwSlashCommand, string][];

    for (const [adwCommand, expectedIssueType] of entries) {
      vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
        output: JSON.stringify({ adwSlashCommand: adwCommand }),
        success: true,
      });

      const result = await classifyWithAdwCommand('issue text', 42, '/tmp/output.jsonl');

      expect(result?.issueType).toBe(expectedIssueType);
      expect(result?.adwCommand).toBe(adwCommand);
    }
  });

  it('calls runClaudeAgentWithCommand with haiku model', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      output: '{}',
      success: true,
    });

    await classifyWithAdwCommand('issue text', 42, '/tmp/output.jsonl');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/classify_adw',
      'issue text',
      'adw-classifier-42',
      '/tmp/output.jsonl',
      'haiku'
    );
  });
});

// ============================================================================
// classifyIssueForTrigger
// ============================================================================

describe('classifyIssueForTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchGitHubIssue).mockResolvedValue(createMockIssue());
  });

  it('uses ADW classification when /classify_adw finds a command', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValueOnce({
      output: '{"adwSlashCommand": "/adw_plan_build_test"}',
      success: true,
    });

    const result = await classifyIssueForTrigger(42);

    expect(result.issueType).toBe('/feature');
    expect(result.adwCommand).toBe('/adw_plan_build_test');
    expect(result.success).toBe(true);
    // Should only call once (for /classify_adw), not twice
    expect(runClaudeAgentWithCommand).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Attempting ADW classification')
    );
  });

  it('falls back to /classify_issue when /classify_adw returns empty', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '{}', success: true })
      .mockResolvedValueOnce({ output: '/bug', success: true });

    const result = await classifyIssueForTrigger(42);

    expect(result.issueType).toBe('/bug');
    expect(result.adwCommand).toBeUndefined();
    expect(result.success).toBe(true);
    expect(runClaudeAgentWithCommand).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('falling back to /classify_issue')
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Attempting heuristic classification')
    );
  });

  it('defaults to /feature when both classifiers fail', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '{}', success: true })
      .mockResolvedValueOnce({ output: 'unknown output', success: true });

    const result = await classifyIssueForTrigger(42);

    expect(result.issueType).toBe('/feature');
    expect(result.success).toBe(false);
  });

  it('defaults to /feature when fetchGitHubIssue throws', async () => {
    vi.mocked(fetchGitHubIssue).mockRejectedValue(new Error('API error'));

    const result = await classifyIssueForTrigger(42);

    expect(result.issueType).toBe('/feature');
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// classifyGitHubIssue
// ============================================================================

describe('classifyGitHubIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses ADW classification when /classify_adw finds a command', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValueOnce({
      output: '{"adwSlashCommand": "/adw_patch"}',
      success: true,
    });

    const result = await classifyGitHubIssue(createMockIssue());

    expect(result.issueType).toBe('/bug');
    expect(result.adwCommand).toBe('/adw_patch');
    expect(result.success).toBe(true);
    expect(runClaudeAgentWithCommand).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Attempting ADW classification')
    );
  });

  it('falls back to /classify_issue when /classify_adw returns empty', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '{}', success: true })
      .mockResolvedValueOnce({ output: '/chore', success: true });

    const result = await classifyGitHubIssue(createMockIssue());

    expect(result.issueType).toBe('/chore');
    expect(result.adwCommand).toBeUndefined();
    expect(result.success).toBe(true);
    expect(runClaudeAgentWithCommand).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('falling back to /classify_issue')
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Attempting heuristic classification')
    );
  });

  it('defaults to /feature when both classifiers fail', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '{}', success: true })
      .mockResolvedValueOnce({ output: '', success: false });

    const result = await classifyGitHubIssue(createMockIssue());

    expect(result.issueType).toBe('/feature');
    expect(result.success).toBe(false);
  });

  it('includes labels in issue context for classification', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '{}', success: true })
      .mockResolvedValueOnce({ output: '/feature', success: true });

    const issue = createMockIssue({
      labels: [{ id: '1', name: 'enhancement', color: '00ff00' }],
    });

    await classifyGitHubIssue(issue);

    // The second call (classify_issue) should receive context with labels
    const secondCallArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[1];
    expect(secondCallArgs[1]).toContain('enhancement');
  });
});

// ============================================================================
// getWorkflowScript
// ============================================================================

describe('getWorkflowScript', () => {
  // Issue-type-based routing (no ADW command)
  it('returns adwPlanBuildTest for /feature', () => {
    expect(getWorkflowScript('/feature')).toBe('adws/adwPlanBuildTest.tsx');
  });

  it('returns adwPlanBuildTest for /chore', () => {
    expect(getWorkflowScript('/chore')).toBe('adws/adwPlanBuildTest.tsx');
  });

  it('returns adwPlanBuild for /bug', () => {
    expect(getWorkflowScript('/bug')).toBe('adws/adwPlanBuild.tsx');
  });

  it('returns adwPlanBuild for /pr_review', () => {
    expect(getWorkflowScript('/pr_review')).toBe('adws/adwPlanBuild.tsx');
  });

  // Mapped ADW commands route to their dedicated orchestrators
  it('returns adwPlanBuildTestReview when adwCommand is /adw_plan_build_test_review', () => {
    expect(getWorkflowScript('/feature', '/adw_plan_build_test_review')).toBe('adws/adwPlanBuildTestReview.tsx');
  });

  it('returns adwPlan when adwCommand is /adw_plan', () => {
    expect(getWorkflowScript('/chore', '/adw_plan')).toBe('adws/adwPlan.tsx');
  });

  it('returns adwBuild when adwCommand is /adw_build', () => {
    expect(getWorkflowScript('/feature', '/adw_build')).toBe('adws/adwBuild.tsx');
  });

  it('returns adwTest when adwCommand is /adw_test', () => {
    expect(getWorkflowScript('/feature', '/adw_test')).toBe('adws/adwTest.tsx');
  });

  it('returns adwPlanBuild when adwCommand is /adw_plan_build', () => {
    expect(getWorkflowScript('/bug', '/adw_plan_build')).toBe('adws/adwPlanBuild.tsx');
  });

  it('returns adwPlanBuildTest when adwCommand is /adw_plan_build_test', () => {
    expect(getWorkflowScript('/feature', '/adw_plan_build_test')).toBe('adws/adwPlanBuildTest.tsx');
  });

  it('returns adwSdlc when adwCommand is /adw_sdlc', () => {
    expect(getWorkflowScript('/feature', '/adw_sdlc')).toBe('adws/adwSdlc.tsx');
  });

  // All ADW commands now have dedicated orchestrators
  it('returns adwPatch when adwCommand is /adw_patch', () => {
    expect(getWorkflowScript('/bug', '/adw_patch')).toBe('adws/adwPatch.tsx');
  });

  it('returns adwDocument when adwCommand is /adw_document', () => {
    expect(getWorkflowScript('/chore', '/adw_document')).toBe('adws/adwDocument.tsx');
  });

  it('returns adwPrReview when adwCommand is /adw_review', () => {
    expect(getWorkflowScript('/pr_review', '/adw_review')).toBe('adws/adwPrReview.tsx');
  });

  // ADW command takes priority over issueType
  it('uses adwCommand override regardless of issueType', () => {
    expect(getWorkflowScript('/bug', '/adw_plan_build_test_review')).toBe('adws/adwPlanBuildTestReview.tsx');
    expect(getWorkflowScript('/chore', '/adw_plan_build_test_review')).toBe('adws/adwPlanBuildTestReview.tsx');
    expect(getWorkflowScript('/feature', '/adw_plan')).toBe('adws/adwPlan.tsx');
    expect(getWorkflowScript('/pr_review', '/adw_plan_build_test')).toBe('adws/adwPlanBuildTest.tsx');
  });

  // Parametric test over all mapped entries
  it.each(Object.entries(adwCommandToOrchestratorMap))(
    'routes %s to %s via adwCommandToOrchestratorMap',
    (command, expectedScript) => {
      expect(getWorkflowScript('/feature', command as AdwSlashCommand)).toBe(expectedScript);
    }
  );
});
