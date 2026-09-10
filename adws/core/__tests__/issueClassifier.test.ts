import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VALID_ISSUE_TYPES } from '../../types/issueTypes';
import type { GitHubIssue } from '../../providers/github/domain/issue';

vi.mock('../../agents/claudeAgent', async () => {
  const { AuthRequiredError: ARE, RateLimitError: RLE } = await import('../../types/agentTypes');
  return {
    runClaudeAgentWithCommand: vi.fn(),
    AuthRequiredError: ARE,
    RateLimitError: RLE,
  };
});

import { runClaudeAgentWithCommand } from '../../agents/claudeAgent';
import { classifyGitHubIssue, classifyIssueForTrigger } from '../issueClassifier';
import type { ClassifyIssueForTriggerDeps, ClassifiableIssue } from '../issueClassifier';

const mockRunAgent = vi.mocked(runClaudeAgentWithCommand);

function makeIssue(overrides?: Partial<GitHubIssue>): GitHubIssue {
  return {
    number: 576,
    title: 'durable unit-test gate for adw.yml',
    body: 'Issue about ADW configuration — adw.yml bootstrap and unit-test coverage.',
    state: 'open',
    author: { login: 'paysdoc', isBot: false },
    assignees: [],
    labels: [],
    comments: [],
    createdAt: '2026-06-15T12:00:00Z',
    updatedAt: '2026-06-15T12:00:00Z',
    url: 'https://github.com/paysdoc/AI_Dev_Workflow/issues/576',
    ...overrides,
  };
}

function makeClassifiableIssue(overrides?: Partial<ClassifiableIssue>): ClassifiableIssue {
  return {
    number: 576,
    title: 'durable unit-test gate for adw.yml',
    body: 'Issue about ADW configuration — adw.yml bootstrap and unit-test coverage.',
    labels: [],
    comments: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockRunAgent.mockReset();
});

// Test A: domain invariant
describe('VALID_ISSUE_TYPES domain invariant', () => {
  it('equals exactly the four real workflow types', () => {
    expect([...VALID_ISSUE_TYPES]).toEqual(['/chore', '/bug', '/feature', '/pr_review']);
  });

  it('does not contain /adw_init', () => {
    expect(VALID_ISSUE_TYPES).not.toContain('/adw_init');
  });
});

// Test D: classifyIssueForTrigger — adw:* label override at the chokepoint
describe('classifyIssueForTrigger — adw:* label override', () => {
  it('single adw:bug label deterministically resolves to /bug without calling the LLM', async () => {
    const issue = makeClassifiableIssue({ number: 618, title: 'fix: some bug', labels: ['adw:bug'] });
    const mockFetchIssue = vi.fn().mockResolvedValue(issue);
    const mockClassify = vi.fn();
    const deps: ClassifyIssueForTriggerDeps = { fetchIssue: mockFetchIssue, classifyWith: mockClassify };

    const result = await classifyIssueForTrigger(618, deps);

    expect(result.issueType).toBe('/bug');
    expect(result.success).toBe(true);
    expect(result.issueTitle).toBe(issue.title);
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('conflicting adw:bug + adw:feature labels fall through to the LLM', async () => {
    const issue = makeClassifiableIssue({
      number: 619,
      title: 'ambiguous issue',
      labels: ['adw:bug', 'adw:feature'],
    });
    const mockFetchIssue = vi.fn().mockResolvedValue(issue);
    const mockClassify = vi.fn().mockResolvedValue({ issueType: '/feature', success: true });
    const deps: ClassifyIssueForTriggerDeps = { fetchIssue: mockFetchIssue, classifyWith: mockClassify };

    const result = await classifyIssueForTrigger(619, deps);

    expect(mockClassify).toHaveBeenCalledTimes(1);
    expect(result.issueType).toBe('/feature');
  });

  it('no adw:* labels fall through to the LLM', async () => {
    const issue = makeClassifiableIssue({ number: 620, title: 'unlabelled issue', labels: [] });
    const mockFetchIssue = vi.fn().mockResolvedValue(issue);
    const mockClassify = vi.fn().mockResolvedValue({ issueType: '/chore', success: true });
    const deps: ClassifyIssueForTriggerDeps = { fetchIssue: mockFetchIssue, classifyWith: mockClassify };

    const result = await classifyIssueForTrigger(620, deps);

    expect(mockClassify).toHaveBeenCalledTimes(1);
    expect(result.issueType).toBe('/chore');
  });
});

// Test B: /adw_init cannot be the resolved type
describe('classifyGitHubIssue — /adw_init safety', () => {
  it('degrades to /feature when agent output contains only /adw_init', async () => {
    mockRunAgent.mockResolvedValue({
      success: true,
      output: '/adw_init',
    });
    const result = await classifyGitHubIssue(makeIssue());
    expect(result.issueType).toBe('/feature');
    expect(result.issueType).not.toBe('/adw_init');
  });

  // Test C: last real type wins when /adw_init trails a real type
  it('resolves to /bug when output has /bug before a trailing /adw_init', async () => {
    mockRunAgent.mockResolvedValue({
      success: true,
      output: 'this looks like /bug, not /adw_init',
    });
    const result = await classifyGitHubIssue(makeIssue());
    expect(result.issueType).toBe('/bug');
  });
});
