import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../forge/hitlBoardNotifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../forge/hitlBoardNotifier')>();
  return { ...actual, notifyBlockedTransition: vi.fn().mockResolvedValue(undefined) };
});

import { handlePRReviewWorkflowError } from '../prReviewCompletion';
import { notifyBlockedTransition } from '../../forge/hitlBoardNotifier';
import { Platform, type RepoContext, type RepoIdentifier } from '../../providers/types';
import type { WorkflowConfig } from '../workflowInit';
import type { PRReviewWorkflowConfig } from '../prReviewPhase';
import type { PRReviewWorkflowContext } from '../../forge/workflowCommentsPR';

// Sentinel thrown when process.exit is called inside the terminal handler.
class ExitCalled extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };

describe('handlePRReviewWorkflowError — notifier deps fallback', () => {
  let origExit: typeof process.exit;
  let tmpDir: string;
  let orchestratorStatePath: string;

  beforeEach(() => {
    origExit = process.exit;
    process.exit = ((code?: number) => {
      throw new ExitCalled(code);
    }) as typeof process.exit;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-prreview-completion-'));
    orchestratorStatePath = path.join(tmpDir, 'orch');
    fs.mkdirSync(orchestratorStatePath);
  });

  afterEach(() => {
    process.exit = origExit;
    vi.clearAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reaches notifyBlockedTransition with real buildNotifierDeps readers when no deps are injected and the config carries a GitHub repoContext', async () => {
    const fetchIssueMock = vi.fn().mockResolvedValue({
      id: '42', number: 42, title: 'Fix the retry budget', body: '', state: 'OPEN',
      author: 'octocat', labels: ['hitl'], comments: [], createdAt: '', url: '',
    });

    const repoContext: RepoContext = {
      repoId: REPO_ID,
      issueTracker: { moveToStatus: vi.fn().mockResolvedValue(true), fetchIssue: fetchIssueMock } as unknown as RepoContext['issueTracker'],
      codeHost: { commentOnPullRequest: vi.fn(), listPullRequests: vi.fn().mockReturnValue([]) } as unknown as RepoContext['codeHost'],
      cwd: tmpDir,
    };

    const ctx: PRReviewWorkflowContext = {
      issueNumber: 42,
      adwId: 'test-adw',
      prNumber: 99,
      reviewComments: 0,
    };

    const base: WorkflowConfig = {
      issueNumber: 42,
      adwId: 'test-adw',
      orchestratorStatePath,
      orchestratorName: 'test-orchestrator' as WorkflowConfig['orchestratorName'],
      topLevelStatePath: path.join(tmpDir, 'top.json'),
      ctx,
      repoContext,
      issue: {
        number: 42,
        title: '',
        body: '',
        state: 'open',
        labels: [],
        assignees: [],
        comments: [],
        createdAt: '',
        updatedAt: '',
      } as unknown as WorkflowConfig['issue'],
      issueType: '/pr_review' as WorkflowConfig['issueType'],
      worktreePath: tmpDir,
      defaultBranch: 'main',
      logsDir: tmpDir,
      recoveryState: { inRecovery: false } as unknown as WorkflowConfig['recoveryState'],
      branchName: 'test-branch',
      applicationUrl: '',
      projectConfig: {} as WorkflowConfig['projectConfig'],
      adwYmlConfig: { hitl: false, unitTests: true, guardrails: false },
    };

    const prReviewConfig: PRReviewWorkflowConfig = {
      base,
      prNumber: 99,
      prDetails: {
        number: 99,
        title: 'test pr',
        body: '',
        url: 'https://github.com/acme/widget/pull/99',
        sourceBranch: 'test-branch',
        targetBranch: 'main',
      } as unknown as PRReviewWorkflowConfig['prDetails'],
      unaddressedComments: [],
      ctx,
    };

    await expect(handlePRReviewWorkflowError(prReviewConfig, new Error('boom'))).rejects.toBeInstanceOf(ExitCalled);

    expect(vi.mocked(notifyBlockedTransition)).toHaveBeenCalledTimes(1);
    const [args, deps] = vi.mocked(notifyBlockedTransition).mock.calls[0];
    expect(args).toEqual({ issueNumber: 42, repoInfo: REPO_ID, source: 'review_error', errorMessage: 'Error: boom' });

    expect(typeof deps.readIssue).toBe('function');
    expect(typeof deps.listOpenPRs).toBe('function');
    await expect(deps.readIssue(42, REPO_ID)).resolves.toEqual({ title: 'Fix the retry budget', labels: ['hitl'] });
    expect(fetchIssueMock).toHaveBeenCalledWith(42);

    expect(fs.existsSync(path.join(orchestratorStatePath, 'state.json'))).toBe(true);
  });
});
