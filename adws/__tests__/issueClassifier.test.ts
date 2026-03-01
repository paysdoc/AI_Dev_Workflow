import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyWithAdwCommand,
  classifyIssueForTrigger,
  classifyGitHubIssue,
  getWorkflowScript,
  extractAdwCommandFromText,
  extractAdwIdFromText,
} from '../core/issueClassifier';
import { adwCommandToIssueTypeMap, adwCommandToOrchestratorMap, issueTypeToOrchestratorMap, AdwSlashCommand, IssueClassSlashCommand, GitHubIssue } from '../core/dataTypes';

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
// extractAdwCommandFromText
// ============================================================================

describe('extractAdwCommandFromText', () => {
  it('returns /adw_init when text contains /adw_init', () => {
    expect(extractAdwCommandFromText('/adw_init')).toBe('/adw_init');
  });

  it('returns /adw_plan_build_test when text contains /adw_plan_build_test (not /adw_plan)', () => {
    expect(extractAdwCommandFromText('Please run /adw_plan_build_test on this')).toBe('/adw_plan_build_test');
  });

  it('returns /adw_sdlc when command is embedded in prose', () => {
    expect(extractAdwCommandFromText('We need to run /adw_sdlc for this feature request')).toBe('/adw_sdlc');
  });

  it('returns null when no ADW command is present', () => {
    expect(extractAdwCommandFromText('This is a regular issue with no commands')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(extractAdwCommandFromText('')).toBeNull();
  });

  it('returns null for partial matches like /adw_unknown', () => {
    expect(extractAdwCommandFromText('/adw_unknown')).toBeNull();
  });

  it('returns the first match when multiple commands are present', () => {
    const result = extractAdwCommandFromText('/adw_init and also /adw_sdlc');
    // Both are valid; the longest-first sort determines order, but /adw_sdlc is longer
    // However, /adw_init appears first in the text. Since we sort by length descending
    // and use .find(), /adw_sdlc will be checked first and found first.
    expect(result).toBe('/adw_sdlc');
  });

  it('matches /adw_plan_build_test_review over /adw_plan_build_test', () => {
    expect(extractAdwCommandFromText('/adw_plan_build_test_review')).toBe('/adw_plan_build_test_review');
  });

  it('matches /adw_plan when only /adw_plan is present', () => {
    expect(extractAdwCommandFromText('run /adw_plan for this issue')).toBe('/adw_plan');
  });
});

// ============================================================================
// extractAdwIdFromText
// ============================================================================

describe('extractAdwIdFromText', () => {
  it('returns adwId for label-prefixed "adwId: fix-bug-abc123"', () => {
    expect(extractAdwIdFromText('adwId: fix-bug-abc123')).toBe('fix-bug-abc123');
  });

  it('returns adwId for label-prefixed "ADW ID: my-workflow-xyz789"', () => {
    expect(extractAdwIdFromText('ADW ID: my-workflow-xyz789')).toBe('my-workflow-xyz789');
  });

  it('returns adwId for backtick-wrapped ADW ID', () => {
    expect(extractAdwIdFromText('ID: `adw-fix-bug-abc123`')).toBe('adw-fix-bug-abc123');
  });

  it('returns null for empty text', () => {
    expect(extractAdwIdFromText('')).toBeNull();
  });

  it('returns null for text with no adwId patterns', () => {
    expect(extractAdwIdFromText('This is a regular issue with no adwId')).toBeNull();
  });
});

// ============================================================================
// classifyWithAdwCommand
// ============================================================================

describe('classifyWithAdwCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns classification when issueBody contains explicit /adw_init', () => {
    const result = classifyWithAdwCommand(
      'issue context',
      42,
      'Please run /adw_init on this repo',
    );

    expect(result).toEqual({
      issueType: '/adw_init',
      success: true,
      adwCommand: '/adw_init',
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('regex'),
      'success'
    );
  });

  it('returns classification with adwId when text has both command and adwId', () => {
    const result = classifyWithAdwCommand(
      'issue context',
      42,
      '/adw_build\nadwId: abc12345',
    );

    expect(result).toEqual({
      issueType: '/feature',
      success: true,
      adwCommand: '/adw_build',
      adwId: 'abc12345',
    });
  });

  it('returns null when no ADW command is found in text', () => {
    const result = classifyWithAdwCommand(
      'issue context with no commands',
      42,
      'This issue has no explicit command',
    );

    expect(result).toBeNull();
  });

  it('maps each ADW command to the correct IssueClassSlashCommand', () => {
    const entries = Object.entries(adwCommandToIssueTypeMap) as [AdwSlashCommand, string][];

    for (const [adwCommand, expectedIssueType] of entries) {
      const result = classifyWithAdwCommand(
        `text with ${adwCommand}`,
        42,
        `Please run ${adwCommand} on this`,
      );

      expect(result?.issueType).toBe(expectedIssueType);
      expect(result?.adwCommand).toBe(adwCommand);
    }
  });
});

// ============================================================================
// classifyIssueForTrigger
// ============================================================================

describe('classifyIssueForTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses regex when issue body contains explicit ADW command', async () => {
    vi.mocked(fetchGitHubIssue).mockResolvedValue(createMockIssue({
      body: 'Please run /adw_plan_build_test on this',
    }));

    const result = await classifyIssueForTrigger(42);

    expect(result.issueType).toBe('/feature');
    expect(result.adwCommand).toBe('/adw_plan_build_test');
    expect(result.success).toBe(true);
    // Should NOT call the agent at all — regex matched deterministically
    expect(runClaudeAgentWithCommand).not.toHaveBeenCalled();
  });

  it('falls back to /classify_issue when no regex match is found', async () => {
    vi.mocked(fetchGitHubIssue).mockResolvedValue(createMockIssue({
      body: 'No explicit command here',
    }));
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '/bug', success: true });

    const result = await classifyIssueForTrigger(42);

    expect(result.issueType).toBe('/bug');
    expect(result.adwCommand).toBeUndefined();
    expect(result.success).toBe(true);
    expect(runClaudeAgentWithCommand).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('falling back to /classify_issue')
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Attempting heuristic classification')
    );
  });

  it('defaults to /feature when classify_issue fails', async () => {
    vi.mocked(fetchGitHubIssue).mockResolvedValue(createMockIssue({
      body: 'No explicit command here',
    }));
    vi.mocked(runClaudeAgentWithCommand)
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

  it('uses regex when issue body contains explicit ADW command', async () => {
    const result = await classifyGitHubIssue(createMockIssue({
      body: 'Run /adw_patch to fix this',
    }));

    expect(result.issueType).toBe('/bug');
    expect(result.adwCommand).toBe('/adw_patch');
    expect(result.success).toBe(true);
    // Should NOT call the agent at all
    expect(runClaudeAgentWithCommand).not.toHaveBeenCalled();
  });

  it('falls back to /classify_issue when no regex match is found', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '/chore', success: true });

    const result = await classifyGitHubIssue(createMockIssue({
      body: 'No explicit command here',
    }));

    expect(result.issueType).toBe('/chore');
    expect(result.adwCommand).toBeUndefined();
    expect(result.success).toBe(true);
    expect(runClaudeAgentWithCommand).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('falling back to /classify_issue')
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Attempting heuristic classification')
    );
  });

  it('defaults to /feature when classify_issue fails', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '', success: false });

    const result = await classifyGitHubIssue(createMockIssue({
      body: 'No explicit command here',
    }));

    expect(result.issueType).toBe('/feature');
    expect(result.success).toBe(false);
  });

  it('recognizes /adw_init from heuristic classifier fallback', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '/adw_init', success: true });

    const result = await classifyGitHubIssue(createMockIssue({
      body: 'No explicit command here',
    }));

    expect(result.issueType).toBe('/adw_init');
    expect(result.success).toBe(true);
  });

  it('returns last command when AI output mentions multiple commands', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: 'Not /chore, definitely /bug', success: true });

    const result = await classifyGitHubIssue(createMockIssue({
      body: 'No explicit command here',
    }));

    expect(result.issueType).toBe('/bug');
    expect(result.success).toBe(true);
  });

  it('includes labels in issue context for classification', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: '/feature', success: true });

    const issue = createMockIssue({
      body: 'No explicit command here',
      labels: [{ id: '1', name: 'enhancement', color: '00ff00' }],
    });

    await classifyGitHubIssue(issue);

    // The call (classify_issue) should receive context with labels
    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[1]).toContain('enhancement');
  });
});

// ============================================================================
// getWorkflowScript
// ============================================================================

describe('getWorkflowScript', () => {
  // Issue-type-based routing (no ADW command)
  it('returns adwSdlc for /feature', () => {
    expect(getWorkflowScript('/feature')).toBe('adws/adwSdlc.tsx');
  });

  it('returns adwPlanBuild for /chore', () => {
    expect(getWorkflowScript('/chore')).toBe('adws/adwPlanBuild.tsx');
  });

  it('returns adwPlanBuildTest for /bug', () => {
    expect(getWorkflowScript('/bug')).toBe('adws/adwPlanBuildTest.tsx');
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

  // Parametric test over all mapped ADW command entries
  it.each(Object.entries(adwCommandToOrchestratorMap))(
    'routes %s to %s via adwCommandToOrchestratorMap',
    (command, expectedScript) => {
      expect(getWorkflowScript('/feature', command as AdwSlashCommand)).toBe(expectedScript);
    }
  );

  // Parametric test over all mapped issue type entries
  it.each(Object.entries(issueTypeToOrchestratorMap))(
    'routes issue type %s to %s via issueTypeToOrchestratorMap',
    (issueType, expectedScript) => {
      expect(getWorkflowScript(issueType as IssueClassSlashCommand)).toBe(expectedScript);
    }
  );
});
