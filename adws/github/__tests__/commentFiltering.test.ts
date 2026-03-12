import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

import { execSync } from 'child_process';
import { isAdwComment, isActionableComment, isClearComment, extractActionableContent, isAdwRunningForIssue, ADW_SIGNATURE } from '../workflowCommentsBase';
import { AgentStateManager } from '../../core/agentState';

const testRepoInfo = { owner: 'test-owner', repo: 'test-repo' };

describe('isAdwComment', () => {
  it('returns true for ADW workflow started comment', () => {
    const body = '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`';
    expect(isAdwComment(body)).toBe(true);
  });

  it('returns true for ADW build progress comment', () => {
    const body = '## :gear: Build Progress\n\n**Turns completed:** 5';
    expect(isAdwComment(body)).toBe(true);
  });

  it('returns true for ADW error comment', () => {
    const body = '## :x: ADW Workflow Error\n\n**Error:** something went wrong';
    expect(isAdwComment(body)).toBe(true);
  });

  it('returns true for ADW completed comment', () => {
    const body = '## :tada: ADW Workflow Completed\n\nAll done!';
    expect(isAdwComment(body)).toBe(true);
  });

  it('returns true for ADW implementing comment', () => {
    const body = '## :hammer_and_wrench: Implementing Solution\n\nWorking on it...';
    expect(isAdwComment(body)).toBe(true);
  });

  it('returns false for plain human comment', () => {
    expect(isAdwComment('Please also update the tests')).toBe(false);
  });

  it('returns false for human comment with emoji but not in heading format', () => {
    expect(isAdwComment(':thumbsup: looks good')).toBe(false);
  });

  it('returns false for human comment with heading but no emoji', () => {
    expect(isAdwComment('## Some heading\n\nDetails here')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAdwComment('')).toBe(false);
  });

  it('returns false for comment with emoji heading missing trailing space', () => {
    expect(isAdwComment('## :rocket:No space after colon')).toBe(false);
  });

  it('returns false for comment with colon-wrapped words not in heading', () => {
    expect(isAdwComment('please check :the_file: for errors')).toBe(false);
  });

  it('returns true for comment with only the new signature footer (no heading)', () => {
    expect(isAdwComment(`Some plain text${ADW_SIGNATURE}`)).toBe(true);
  });

  it('returns true for comment with both heading and signature', () => {
    const body = `## :rocket: ADW Workflow Started\n\n**ADW ID:** \`adw-123-abc\`${ADW_SIGNATURE}`;
    expect(isAdwComment(body)).toBe(true);
  });

  it('returns true for comment with adw-bot marker embedded in text', () => {
    expect(isAdwComment('Some text <!-- adw-bot --> more text')).toBe(true);
  });

  it('returns false for human comment without signature or heading', () => {
    expect(isAdwComment('Just a regular comment with no ADW markers')).toBe(false);
  });
});

describe('isClearComment', () => {
  it('returns true for exact ## Clear match', () => {
    expect(isClearComment('## Clear')).toBe(true);
  });

  it('returns true for lowercase ## clear', () => {
    expect(isClearComment('## clear')).toBe(true);
  });

  it('returns true for uppercase ## CLEAR', () => {
    expect(isClearComment('## CLEAR')).toBe(true);
  });

  it('returns true for ## Clear with surrounding text', () => {
    expect(isClearComment('Some context\n\n## Clear')).toBe(true);
  });

  it('returns false for ## Take action (not a clear comment)', () => {
    expect(isClearComment('## Take action')).toBe(false);
  });

  it('returns false for plain text containing the word "clear" without heading', () => {
    expect(isClearComment('Please clear this issue')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isClearComment('')).toBe(false);
  });

  it('returns false for ADW system comment', () => {
    expect(isClearComment('## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`')).toBe(false);
  });
});

describe('isActionableComment', () => {
  it('returns true for a comment with ## Take action heading', () => {
    expect(isActionableComment('## Take action')).toBe(true);
  });

  it('returns true for a comment with ## Take action heading followed by body text', () => {
    expect(isActionableComment('## Take action\n\nPlease fix the bug described above.')).toBe(true);
  });

  it('returns true for a comment with text before and after ## Take action heading', () => {
    expect(isActionableComment('Some context here\n\n## Take action\n\nDo the thing.')).toBe(true);
  });

  it('returns false for a plain human comment without the directive', () => {
    expect(isActionableComment('Please also update the tests')).toBe(false);
  });

  it('returns false for an ADW system comment', () => {
    expect(isActionableComment('## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`')).toBe(false);
  });

  it('returns false for a Vercel bot comment', () => {
    expect(isActionableComment('[vc]: #abc123\nDeployment preview ready')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isActionableComment('')).toBe(false);
  });

  it('returns false for a comment with "Take action" but not as an ## heading', () => {
    expect(isActionableComment('You should Take action on this issue soon')).toBe(false);
  });

  it('returns true for case-insensitive match (## take action)', () => {
    expect(isActionableComment('## take action')).toBe(true);
  });

  it('returns true for case-insensitive match (## TAKE ACTION)', () => {
    expect(isActionableComment('## TAKE ACTION')).toBe(true);
  });
});

describe('extractActionableContent', () => {
  it('returns the content after ## Take action heading', () => {
    expect(extractActionableContent('## Take action\n\nPlease fix the bug.')).toBe('Please fix the bug.');
  });

  it('returns null for a comment without ## Take action', () => {
    expect(extractActionableContent('Just a regular comment')).toBeNull();
  });

  it('returns null for a comment with only ## Take action and no body text', () => {
    expect(extractActionableContent('## Take action')).toBeNull();
  });

  it('returns trimmed content', () => {
    expect(extractActionableContent('## Take action\n\n  content with spaces  \n\n')).toBe('content with spaces');
  });

  it('returns only the text after ## Take action when text exists before it', () => {
    const comment = 'Some context here\n\n## Take action\n\nDo the thing.';
    expect(extractActionableContent(comment)).toBe('Do the thing.');
  });

  it('handles multiline content after ## Take action', () => {
    const comment = '## Take action\n\nLine one.\nLine two.\nLine three.';
    expect(extractActionableContent(comment)).toBe('Line one.\nLine two.\nLine three.');
  });

  it('is case-insensitive for the heading', () => {
    expect(extractActionableContent('## take action\n\nLowercase heading.')).toBe('Lowercase heading.');
    expect(extractActionableContent('## TAKE ACTION\n\nUppercase heading.')).toBe('Uppercase heading.');
  });

  it('returns null for empty string input', () => {
    expect(extractActionableContent('')).toBeNull();
  });
});

describe('isAdwRunningForIssue', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  const makeIssueJson = (comments: { body: string; createdAt: string }[]) =>
    JSON.stringify({
      number: 42,
      title: 'Test issue',
      body: 'Issue body',
      state: 'OPEN',
      author: { login: 'user', type: 'User' },
      assignees: [],
      labels: [],
      milestone: null,
      comments: comments.map((c, i) => ({
        id: `comment-${i}`,
        author: { login: 'bot', type: 'Bot' },
        body: c.body,
        createdAt: c.createdAt,
        updatedAt: c.createdAt,
      })),
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      closedAt: null,
      url: 'https://github.com/owner/repo/issues/42',
    });

  it('returns false when issue has no comments', async () => {
    vi.mocked(execSync).mockReturnValue(makeIssueJson([]));
    expect(await isAdwRunningForIssue(42, testRepoInfo)).toBe(false);
  });

  it('returns false when issue has only non-ADW comments', async () => {
    vi.mocked(execSync).mockReturnValue(
      makeIssueJson([
        { body: 'Human comment here', createdAt: '2025-01-01T01:00:00Z' },
      ])
    );
    expect(await isAdwRunningForIssue(42, testRepoInfo)).toBe(false);
  });

  it('returns false when latest ADW stage is completed', async () => {
    vi.mocked(execSync).mockReturnValue(
      makeIssueJson([
        {
          body: '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`',
          createdAt: '2025-01-01T01:00:00Z',
        },
        {
          body: '## :tada: ADW Workflow Completed\n\n**ADW ID:** `adw-123-abc`',
          createdAt: '2025-01-01T02:00:00Z',
        },
      ])
    );
    expect(await isAdwRunningForIssue(42, testRepoInfo)).toBe(false);
  });

  it('returns false when latest ADW stage is error', async () => {
    vi.mocked(execSync).mockReturnValue(
      makeIssueJson([
        {
          body: '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`',
          createdAt: '2025-01-01T01:00:00Z',
        },
        {
          body: '## :x: ADW Workflow Error\n\n**ADW ID:** `adw-123-abc`\n**Error:** failed',
          createdAt: '2025-01-01T02:00:00Z',
        },
      ])
    );
    expect(await isAdwRunningForIssue(42, testRepoInfo)).toBe(false);
  });

  it('returns true when latest ADW stage is implementing and process is alive', async () => {
    vi.spyOn(AgentStateManager, 'isAgentProcessRunning').mockReturnValue(true);
    vi.mocked(execSync).mockReturnValue(
      makeIssueJson([
        {
          body: '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`',
          createdAt: '2025-01-01T01:00:00Z',
        },
        {
          body: '## :hammer_and_wrench: Implementing Solution\n\n**ADW ID:** `adw-123-abc`',
          createdAt: '2025-01-01T02:00:00Z',
        },
      ])
    );
    expect(await isAdwRunningForIssue(42, testRepoInfo)).toBe(true);
  });

  it('returns true when latest ADW stage is starting and process is alive', async () => {
    vi.spyOn(AgentStateManager, 'isAgentProcessRunning').mockReturnValue(true);
    vi.mocked(execSync).mockReturnValue(
      makeIssueJson([
        {
          body: '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`',
          createdAt: '2025-01-01T01:00:00Z',
        },
      ])
    );
    expect(await isAdwRunningForIssue(42, testRepoInfo)).toBe(true);
  });

  it('ignores non-ADW comments when determining workflow state', async () => {
    vi.spyOn(AgentStateManager, 'isAgentProcessRunning').mockReturnValue(true);
    vi.mocked(execSync).mockReturnValue(
      makeIssueJson([
        {
          body: '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`',
          createdAt: '2025-01-01T01:00:00Z',
        },
        {
          body: 'Human follow-up comment',
          createdAt: '2025-01-01T03:00:00Z',
        },
      ])
    );
    expect(await isAdwRunningForIssue(42, testRepoInfo)).toBe(true);
  });

  it('returns false when latest stage is non-terminal but agent process is dead', async () => {
    vi.spyOn(AgentStateManager, 'isAgentProcessRunning').mockReturnValue(false);
    vi.mocked(execSync).mockReturnValue(
      makeIssueJson([
        {
          body: '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`',
          createdAt: '2025-01-01T01:00:00Z',
        },
        {
          body: '## :hammer_and_wrench: Implementing Solution\n\n**ADW ID:** `adw-123-abc`',
          createdAt: '2025-01-01T02:00:00Z',
        },
      ])
    );
    expect(await isAdwRunningForIssue(42, testRepoInfo)).toBe(false);
  });

  it('returns true when latest stage is non-terminal and no ADW ID can be extracted', async () => {
    vi.mocked(execSync).mockReturnValue(
      makeIssueJson([
        {
          body: '## :rocket: ADW Workflow Started\n\nADW ID: unknown-format',
          createdAt: '2025-01-01T01:00:00Z',
        },
      ])
    );
    expect(await isAdwRunningForIssue(42, testRepoInfo)).toBe(true);
  });
});
