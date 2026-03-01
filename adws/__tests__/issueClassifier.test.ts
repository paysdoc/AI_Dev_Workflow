import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyWithAdwCommand,
  classifyIssueForTrigger,
  classifyGitHubIssue,
  getWorkflowScript,
  extractAdwCommandFromText,
  extractAdwIdFromText,
  stripFencedCodeBlocks,
} from '../core/issueClassifier';
import { adwCommandToIssueTypeMap, adwCommandToOrchestratorMap, issueTypeToOrchestratorMap, AdwSlashCommand, IssueClassSlashCommand, GitHubIssue } from '../core/dataTypes';
import type { RepoInfo } from '../github/githubApi';

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
// stripFencedCodeBlocks
// ============================================================================

describe('stripFencedCodeBlocks', () => {
  it('returns text unchanged when no code blocks are present', () => {
    const text = 'This is plain text with no code blocks.';
    expect(stripFencedCodeBlocks(text)).toBe(text);
  });

  it('strips a single fenced code block', () => {
    const text = 'Before\n```\ncode here\n```\nAfter';
    expect(stripFencedCodeBlocks(text)).toBe('Before\n\nAfter');
  });

  it('strips multiple fenced code blocks', () => {
    const text = 'Start\n```\nblock one\n```\nMiddle\n```\nblock two\n```\nEnd';
    expect(stripFencedCodeBlocks(text)).toBe('Start\n\nMiddle\n\nEnd');
  });

  it('strips code blocks with language specifiers', () => {
    const text = 'Before\n```json\n{"body": "/adw_init"}\n```\nAfter';
    expect(stripFencedCodeBlocks(text)).toBe('Before\n\nAfter');
  });

  it('preserves text outside code blocks', () => {
    const text = 'Keep this /adw_init\n```\nRemove this /adw_init\n```\nKeep this too';
    const result = stripFencedCodeBlocks(text);
    expect(result).toContain('Keep this /adw_init');
    expect(result).toContain('Keep this too');
    expect(result).not.toContain('Remove this /adw_init');
  });
});

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

  it('returns null when /adw_init appears only inside a fenced code block', () => {
    const text = 'Issue body text\n```\n{"body": "/adw_init"}\n```\nMore text';
    expect(extractAdwCommandFromText(text)).toBeNull();
  });

  it('returns the command when it appears both inside a code block and outside', () => {
    const text = '```\n{"body": "/adw_init"}\n```\nPlease run /adw_init';
    expect(extractAdwCommandFromText(text)).toBe('/adw_init');
  });

  it('returns null when command is only in a code block with a language specifier', () => {
    const text = 'Some description\n```json\n{"command": "/adw_plan_build_test"}\n```\nEnd';
    expect(extractAdwCommandFromText(text)).toBeNull();
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

  it('returns adwId for backtick-wrapped ADW ID with underscore prefix', () => {
    expect(extractAdwIdFromText('ID: `adw_fix-bug-abc123`')).toBe('adw_fix-bug-abc123');
  });

  it('returns null for empty text', () => {
    expect(extractAdwIdFromText('')).toBeNull();
  });

  it('returns null for text with no adwId patterns', () => {
    expect(extractAdwIdFromText('This is a regular issue with no adwId')).toBeNull();
  });

  it('returns null when adwId pattern appears only inside a fenced code block', () => {
    const text = 'Issue text\n```\nadwId: hidden-id-123\n```\nMore text';
    expect(extractAdwIdFromText(text)).toBeNull();
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
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('extracted adwId="abc12345"')
    );
  });

  it('returns null when no ADW command is found in text', () => {
    const result = classifyWithAdwCommand(
      'issue context with no commands',
      42,
      'This issue has no explicit command',
    );

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('no ADW command found')
    );
  });

  it('logs truncated text when scanning', () => {
    classifyWithAdwCommand('ctx', 42, '/adw_init');

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('scanning text for issue #42')
    );
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
    // Classification summary log with classifier=regex
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Classification complete for issue #42: classifier=regex'),
      'success'
    );
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
    // Classification summary log with classifier=heuristic
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Classification complete for issue #42: classifier=heuristic'),
      'success'
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
    // Heuristic summary logged with warn since success=false
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('classifier=heuristic, issueType=/feature'),
      'warn'
    );
  });

  it('logs issue title and body length after fetching', async () => {
    vi.mocked(fetchGitHubIssue).mockResolvedValue(createMockIssue({
      title: 'My test issue',
      body: 'Please run /adw_plan_build_test on this',
    }));

    await classifyIssueForTrigger(42);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('title="My test issue"')
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('body length=')
    );
  });

  it('defaults to /feature when fetchGitHubIssue throws', async () => {
    vi.mocked(fetchGitHubIssue).mockRejectedValue(new Error('API error'));

    const result = await classifyIssueForTrigger(42);

    expect(result.issueType).toBe('/feature');
    expect(result.success).toBe(false);
  });

  it('passes repoInfo to fetchGitHubIssue when provided', async () => {
    const repoInfo: RepoInfo = { owner: 'ext-owner', repo: 'ext-repo' };
    vi.mocked(fetchGitHubIssue).mockResolvedValue(createMockIssue({
      number: 35,
      body: 'Please run /adw_plan_build_test on this',
    }));

    const result = await classifyIssueForTrigger(35, repoInfo);

    expect(fetchGitHubIssue).toHaveBeenCalledWith(35, { owner: 'ext-owner', repo: 'ext-repo' });
    expect(result.success).toBe(true);
    expect(result.adwCommand).toBe('/adw_plan_build_test');
  });

  it('fetches from default repo when repoInfo is not provided', async () => {
    vi.mocked(fetchGitHubIssue).mockResolvedValue(createMockIssue({
      number: 42,
      body: 'Please run /adw_plan_build_test on this',
    }));

    await classifyIssueForTrigger(42);

    expect(fetchGitHubIssue).toHaveBeenCalledWith(42, undefined);
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
    // Classification summary log with classifier=regex
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Classification complete for issue #42: classifier=regex'),
      'success'
    );
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
    // Classification summary log with classifier=heuristic
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Classification complete for issue #42: classifier=heuristic'),
      'success'
    );
    // Raw AI output log
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('raw AI output for issue #42')
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
    // Heuristic summary logged with warn since success=false
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('classifier=heuristic, issueType=/feature'),
      'warn'
    );
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

  it('logs labels in issue context', async () => {
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
    // Labels logged
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('labels=[enhancement]')
    );
  });

  it('logs unparseable AI output at warn level', async () => {
    vi.mocked(runClaudeAgentWithCommand)
      .mockResolvedValueOnce({ output: 'gibberish response', success: true });

    await classifyGitHubIssue(createMockIssue({
      body: 'No explicit command here',
    }));

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('could not parse command from AI output'),
      'warn'
    );
  });
});

// ============================================================================
// getWorkflowScript
// ============================================================================

describe('getWorkflowScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('logs routing via adwCommandToOrchestratorMap when adwCommand is provided', () => {
    getWorkflowScript('/feature', '/adw_plan');

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('routed via adwCommandToOrchestratorMap[/adw_plan]')
    );
  });

  it('logs routing via issueTypeToOrchestratorMap when no adwCommand', () => {
    getWorkflowScript('/bug');

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('routed via issueTypeToOrchestratorMap[/bug]')
    );
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
