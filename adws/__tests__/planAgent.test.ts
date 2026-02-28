import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { getPlanFilePath, planFileExists, readPlanFile, correctPlanFileNaming, formatIssueContextAsArgs, runPlanAgent } from '../agents/planAgent';
import { GitHubIssue, GitHubComment } from '../core';
import { runClaudeAgentWithCommand } from '../agents/claudeAgent';

vi.mock('fs');
vi.mock('../agents/claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'Plan created',
    totalCostUsd: 0.5,
  }),
}));

describe('getPlanFilePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns new-convention file when it exists in specs directory', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-42-adw-abc123-sdlc_planner-fix-login.md',
      'other-file.md',
    ] as any);

    const result = getPlanFilePath(42);

    expect(result).toBe('specs/issue-42-adw-abc123-sdlc_planner-fix-login.md');
  });

  it('returns legacy file when only legacy exists', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-42-plan.md',
      'other-file.md',
    ] as any);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true, size: 100 } as fs.Stats);

    const result = getPlanFilePath(42);

    expect(result).toBe('specs/issue-42-plan.md');
  });

  it('returns legacy fallback path when no matching file exists', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-99-adw-xyz-sdlc_planner-other.md',
    ] as any);
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = getPlanFilePath(42);

    expect(result).toBe('specs/issue-42-plan.md');
  });

  it('returns legacy fallback when specs directory does not exist', () => {
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = getPlanFilePath(42);

    expect(result).toBe('specs/issue-42-plan.md');
  });

  it('searches within worktreePath when provided', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-10-adw-def456-sdlc_planner-add-feature.md',
    ] as any);

    const result = getPlanFilePath(10, '/my/worktree');

    expect(fs.readdirSync).toHaveBeenCalledWith('/my/worktree/specs');
    expect(result).toBe('specs/issue-10-adw-def456-sdlc_planner-add-feature.md');
  });

  it('checks legacy file with worktreePath prefix', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'unrelated-file.md',
    ] as any);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true, size: 50 } as fs.Stats);

    const result = getPlanFilePath(10, '/my/worktree');

    expect(fs.statSync).toHaveBeenCalledWith('/my/worktree/specs/issue-10-plan.md');
    expect(result).toBe('specs/issue-10-plan.md');
  });
});

describe('planFileExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when new-convention file exists and has content', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-5-adw-abc-sdlc_planner-my-plan.md',
    ] as any);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true, size: 200 } as fs.Stats);

    expect(planFileExists(5)).toBe(true);
  });

  it('returns true when legacy file exists and has content', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);
    vi.mocked(fs.statSync).mockImplementation((filePath) => {
      if (String(filePath) === 'specs/issue-5-plan.md') {
        return { isFile: () => true, size: 100 } as fs.Stats;
      }
      throw new Error('ENOENT');
    });

    // readdirSync returns empty, so findPlanFile's legacy check via statSync is called
    // But the first statSync call in findPlanFile for the legacy path also returns stats
    expect(planFileExists(5)).toBe(true);
  });

  it('returns false when no file exists', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(planFileExists(5)).toBe(false);
  });

  it('returns false when file exists but is empty', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-5-adw-abc-sdlc_planner-my-plan.md',
    ] as any);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true, size: 0 } as fs.Stats);

    expect(planFileExists(5)).toBe(false);
  });

  it('uses worktreePath for full path resolution', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-7-adw-xyz-sdlc_planner-task.md',
    ] as any);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true, size: 300 } as fs.Stats);

    expect(planFileExists(7, '/worktree/path')).toBe(true);
    expect(fs.statSync).toHaveBeenCalledWith(
      '/worktree/path/specs/issue-7-adw-xyz-sdlc_planner-task.md'
    );
  });
});

describe('readPlanFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns file content when the plan file exists', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-5-adw-abc-sdlc_planner-my-plan.md',
    ] as any);
    vi.mocked(fs.readFileSync).mockReturnValue('# Plan content\n\nDetailed plan here');

    const result = readPlanFile(5);

    expect(result).toBe('# Plan content\n\nDetailed plan here');
  });

  it('returns null when the plan file does not exist', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(readPlanFile(99)).toBeNull();
  });

  it('returns null when file read throws an error', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-5-adw-abc-sdlc_planner-my-plan.md',
    ] as any);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(readPlanFile(5)).toBeNull();
  });

  it('uses worktreePath for full path resolution', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-7-adw-xyz-sdlc_planner-task.md',
    ] as any);
    vi.mocked(fs.readFileSync).mockReturnValue('# Plan');

    readPlanFile(7, '/worktree/path');

    expect(fs.readFileSync).toHaveBeenCalledWith(
      '/worktree/path/specs/issue-7-adw-xyz-sdlc_planner-task.md',
      'utf-8'
    );
  });
});

describe('formatIssueContextAsArgs', () => {
  const makeComment = (body: string, author = 'user1', createdAt = '2025-01-01T00:00:00Z'): GitHubComment => ({
    id: `comment-${Math.random()}`,
    author: { login: author, isBot: false },
    body,
    createdAt,
  });

  const makeIssue = (comments: GitHubComment[]): GitHubIssue => ({
    number: 42,
    title: 'Test issue',
    body: 'Issue body',
    state: 'OPEN',
    author: { login: 'author', isBot: false },
    assignees: [],
    labels: [],
    comments,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    url: 'https://github.com/owner/repo/issues/42',
  });

  it('filters out ADW bot comments from the Comments section', () => {
    const comments = [
      makeComment('Human comment'),
      makeComment('## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123`'),
      makeComment('Another human comment'),
    ];
    const result = formatIssueContextAsArgs(makeIssue(comments));

    expect(result).toContain('Human comment');
    expect(result).toContain('Another human comment');
    expect(result).not.toContain('ADW Workflow Started');
  });

  it('includes non-ADW human comments in the Comments section', () => {
    const comments = [
      makeComment('Please fix this', 'alice'),
      makeComment('I agree', 'bob'),
    ];
    const result = formatIssueContextAsArgs(makeIssue(comments));

    expect(result).toContain('**alice**');
    expect(result).toContain('Please fix this');
    expect(result).toContain('**bob**');
    expect(result).toContain('I agree');
  });

  it('adds Actionable Comment section when an actionable comment is present', () => {
    const comments = [
      makeComment('## Take action\n\nPlease also update the tests'),
    ];
    const result = formatIssueContextAsArgs(makeIssue(comments));

    expect(result).toContain('### Actionable Comment');
    expect(result).toContain('Please also update the tests');
  });

  it('does not add Actionable Comment section when no actionable comment exists', () => {
    const comments = [
      makeComment('Just a regular comment'),
    ];
    const result = formatIssueContextAsArgs(makeIssue(comments));

    expect(result).not.toContain('### Actionable Comment');
  });

  it('uses the latest actionable comment when multiple exist', () => {
    const comments = [
      makeComment('## Take action\n\nFirst directive', 'user1', '2025-01-01T01:00:00Z'),
      makeComment('Some other comment', 'user2', '2025-01-01T02:00:00Z'),
      makeComment('## Take action\n\nSecond directive', 'user1', '2025-01-01T03:00:00Z'),
    ];
    const result = formatIssueContextAsArgs(makeIssue(comments));

    const actionableSection = result.split('### Actionable Comment')[1].split('### Comments')[0];
    expect(actionableSection).toContain('Second directive');
    expect(actionableSection).not.toContain('First directive');
  });

  it('shows "No comments." when all comments are ADW bot comments and no actionable comment exists', () => {
    const comments = [
      makeComment('## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123`'),
      makeComment('## :tada: ADW Workflow Completed\n\n**ADW ID:** `adw-123`'),
    ];
    const result = formatIssueContextAsArgs(makeIssue(comments));

    expect(result).toContain('### Comments\nNo comments.');
    expect(result).not.toContain('### Actionable Comment');
  });
});

describe('runPlanAgent', () => {
  const mockIssue: GitHubIssue = {
    number: 42,
    title: 'Test issue',
    body: 'Issue body',
    state: 'OPEN',
    author: { login: 'author', isBot: false },
    assignees: [],
    labels: [{ id: '1', name: 'bug', color: 'red' }],
    comments: [
      {
        id: 'comment-1',
        author: { login: 'alice', isBot: false },
        body: 'Please fix this soon',
        createdAt: '2025-01-02T00:00:00Z',
      },
      {
        id: 'comment-2',
        author: { login: 'bot', isBot: true },
        body: '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123`',
        createdAt: '2025-01-03T00:00:00Z',
      },
      {
        id: 'comment-3',
        author: { login: 'bob', isBot: false },
        body: '## Take action\n\nUpdate the tests too',
        createdAt: '2025-01-04T00:00:00Z',
      },
    ],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    url: 'https://github.com/owner/repo/issues/42',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes issue number as the first array argument', async () => {
    await runPlanAgent(mockIssue, '/tmp/logs', '/bug', undefined, undefined, 'my-adw-id');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const argsArray = callArgs[1] as string[];
    expect(argsArray[0]).toBe('42');
  });

  it('passes adwId as the second array argument when provided', async () => {
    await runPlanAgent(mockIssue, '/tmp/logs', '/bug', undefined, undefined, 'my-adw-id');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/bug',
      expect.arrayContaining(['42', 'my-adw-id', expect.any(String)]),
      'Plan',
      expect.any(String),
      expect.any(String),
      undefined,
      undefined,
      undefined,
    );

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const argsArray = callArgs[1] as string[];
    expect(argsArray[1]).toBe('my-adw-id');
  });

  it('defaults the second array argument to adw-unknown when adwId is omitted', async () => {
    await runPlanAgent(mockIssue, '/tmp/logs', '/feature');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const argsArray = callArgs[1] as string[];
    expect(argsArray[1]).toBe('adw-unknown');
  });

  it('passes issue JSON as the third array argument', async () => {
    await runPlanAgent(mockIssue, '/tmp/logs', '/bug', undefined, undefined, 'test-id');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const argsArray = callArgs[1] as string[];
    const issueJson = JSON.parse(argsArray[2]);
    expect(issueJson.number).toBe(42);
    expect(issueJson.title).toBe('Test issue');
    expect(issueJson.author).toBe('author');
    expect(issueJson.labels).toEqual(['bug']);
  });

  it('includes filtered human comments in issueJson', async () => {
    await runPlanAgent(mockIssue, '/tmp/logs', '/bug', undefined, undefined, 'test-id');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const argsArray = callArgs[1] as string[];
    const issueJson = JSON.parse(argsArray[2]);

    expect(issueJson.comments).toHaveLength(2);
    expect(issueJson.comments[0]).toEqual({
      author: 'alice',
      createdAt: '2025-01-02T00:00:00Z',
      body: 'Please fix this soon',
    });
    expect(issueJson.comments[1]).toEqual({
      author: 'bob',
      createdAt: '2025-01-04T00:00:00Z',
      body: '## Take action\n\nUpdate the tests too',
    });
  });

  it('includes actionableComment in issueJson when present', async () => {
    await runPlanAgent(mockIssue, '/tmp/logs', '/bug', undefined, undefined, 'test-id');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const argsArray = callArgs[1] as string[];
    const issueJson = JSON.parse(argsArray[2]);

    expect(issueJson.actionableComment).toBe('Update the tests too');
  });

  it('sets actionableComment to null when no actionable comment exists', async () => {
    const issueWithoutActionable: GitHubIssue = {
      ...mockIssue,
      comments: [
        {
          id: 'comment-1',
          author: { login: 'alice', isBot: false },
          body: 'Just a regular comment',
          createdAt: '2025-01-02T00:00:00Z',
        },
      ],
    };

    await runPlanAgent(issueWithoutActionable, '/tmp/logs', '/bug', undefined, undefined, 'test-id');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const argsArray = callArgs[1] as string[];
    const issueJson = JSON.parse(argsArray[2]);

    expect(issueJson.actionableComment).toBeNull();
  });
});

describe('correctPlanFileNaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when correctly-named file already exists', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-42-adw-abc-sdlc_planner-fix.md',
    ] as any);

    const result = correctPlanFileNaming(42);

    expect(result).toBeNull();
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it('renames swapped file to correct convention', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-abc123-adw-42-sdlc_planner-fix-login.md',
    ] as any);

    const result = correctPlanFileNaming(42);

    expect(fs.renameSync).toHaveBeenCalledWith(
      'specs/issue-abc123-adw-42-sdlc_planner-fix-login.md',
      'specs/issue-42-adw-abc123-sdlc_planner-fix-login.md',
    );
    expect(result).toBe('specs/issue-42-adw-abc123-sdlc_planner-fix-login.md');
  });

  it('returns null when no matching files exist', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'unrelated-file.md',
      'issue-99-adw-xyz-sdlc_planner-other.md',
    ] as any);

    const result = correctPlanFileNaming(42);

    expect(result).toBeNull();
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it('returns null when specs directory does not exist', () => {
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = correctPlanFileNaming(42);

    expect(result).toBeNull();
  });

  it('handles worktreePath correctly', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      'issue-abc123-adw-42-sdlc_planner-fix-login.md',
    ] as any);

    const result = correctPlanFileNaming(42, '/my/worktree');

    expect(fs.readdirSync).toHaveBeenCalledWith('/my/worktree/specs');
    expect(fs.renameSync).toHaveBeenCalledWith(
      '/my/worktree/specs/issue-abc123-adw-42-sdlc_planner-fix-login.md',
      '/my/worktree/specs/issue-42-adw-abc123-sdlc_planner-fix-login.md',
    );
    expect(result).toBe('specs/issue-42-adw-abc123-sdlc_planner-fix-login.md');
  });
});
