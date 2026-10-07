import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    AgentStateManager: { appendLog: vi.fn() },
    log: vi.fn(),
  };
});

import { DevServerStartStatus, SERVER_OUTPUT_TAIL_CHARS, type FailedDevServerStart } from '../../core/devServerFailure';
import { MAX_START_ATTEMPTS } from '../../core/devServerLifecycle';
import { recordFailedStartReview, serverStartBlocker } from '../reviewRetryLoop';
import type { WorkflowConfig } from '../workflowInit';

const SERVER_OUTPUT = "Error: Cannot find module './routes'\n    at start (server.js:3:1)";

const FAILED_START: FailedDevServerStart = {
  status: DevServerStartStatus.Failed,
  command: 'bun run dev --port 4567',
  healthUrl: 'http://localhost:4567/',
  output: SERVER_OUTPUT,
};

function makeWorkflowConfig(): { config: WorkflowConfig; commentOnIssue: ReturnType<typeof vi.fn> } {
  const commentOnIssue = vi.fn();
  const config = {
    issueNumber: 42,
    orchestratorStatePath: '/state',
    ctx: { issueNumber: 42, adwId: 'test-id', branchName: 'feature-42-test' },
    repoContext: { issueTracker: { commentOnIssue } },
  } as unknown as WorkflowConfig;
  return { config, commentOnIssue };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('serverStartBlocker', () => {
  it('is one numbered patch blocker', () => {
    expect(serverStartBlocker(FAILED_START)).toMatchObject({ reviewIssueNumber: 1, issueSeverity: 'blocker', remediationStrategy: 'patch' });
  });

  it('says that the server did not start on the issue branch and that no scenario ran, naming the command, the health URL and the attempts', () => {
    const { issueDescription } = serverStartBlocker(FAILED_START);

    expect(issueDescription).toContain('did not start on the issue branch');
    expect(issueDescription).toContain('no scenario ran');
    expect(issueDescription).toContain(FAILED_START.command);
    expect(issueDescription).toContain(FAILED_START.healthUrl);
    expect(issueDescription).toContain(String(MAX_START_ATTEMPTS));
  });

  it('asks for the change that stops the server from starting to be fixed, and forbids changing how the server is declared', () => {
    const { issueResolution } = serverStartBlocker(FAILED_START);

    expect(issueResolution).toMatch(/fix/i);
    expect(issueResolution).toContain('.adw/commands.md');
    expect(issueResolution).toMatch(/do not change/i);
  });

  it('puts the output in a fence that no backtick run inside the output can close', () => {
    const output = 'before\n```\ninside a fence\n````\nafter';
    const { issueDescription } = serverStartBlocker({ ...FAILED_START, output });

    const fence = '`'.repeat(5);
    expect(issueDescription).toContain(`${fence}\n${output}\n${fence}`);
  });

  it('fences the output in three backticks when it holds none', () => {
    const { issueDescription } = serverStartBlocker(FAILED_START);

    expect(issueDescription).toContain(`\`\`\`\n${SERVER_OUTPUT}\n\`\`\``);
  });

  it('says there was no output when the server printed nothing', () => {
    expect(serverStartBlocker({ ...FAILED_START, output: '  \n' }).issueDescription).toContain('(no output)');
  });

  it('keeps only the end of a long output', () => {
    const output = `${'noise\n'.repeat(5000)}Error: the real one`;
    const { issueDescription } = serverStartBlocker({ ...FAILED_START, output });

    expect(issueDescription).toContain('Error: the real one');
    expect(issueDescription.length).toBeLessThan(SERVER_OUTPUT_TAIL_CHARS + 1500);
  });
});

describe('recordFailedStartReview', () => {
  it('returns the server blocker and leaves it, the error and no screenshots on the context', () => {
    const { config } = makeWorkflowConfig();
    config.ctx.screenshotUrls = ['https://example.test/old.png'];

    const blockers = recordFailedStartReview(config, FAILED_START);

    expect(blockers).toEqual([serverStartBlocker(FAILED_START)]);
    expect(config.ctx.reviewIssues).toEqual(blockers);
    expect(config.ctx.errorMessage).toMatch(/dev server did not start/i);
    expect(config.ctx.screenshotUrls).toEqual([]);
  });

  it('posts the review_failed comment, which lists the blocker with the server output and says how to retry', () => {
    const { config, commentOnIssue } = makeWorkflowConfig();

    recordFailedStartReview(config, FAILED_START);

    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    const [issueNumber, body] = commentOnIssue.mock.calls[0];
    expect(issueNumber).toBe(42);
    expect(body).toContain('Review Failed');
    expect(body).toContain(SERVER_OUTPUT);
    expect(body).toContain('## Retry');
  });

  it('posts nothing when there is no repository context', () => {
    const { config, commentOnIssue } = makeWorkflowConfig();
    config.repoContext = undefined;

    const blockers = recordFailedStartReview(config, FAILED_START);

    expect(blockers).toHaveLength(1);
    expect(commentOnIssue).not.toHaveBeenCalled();
  });
});
