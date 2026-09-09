/**
 * BDD step definitions for feature-587.feature
 * HITL board-event Slack notifications.
 *
 * Execution patterns:
 *   §1–§3: Drive notifyReviewTransition / notifyBlockedTransition directly with
 *          injected mock readers (issue + PR fixtures seeded in world).
 *   §4:    Drive terminal handlers (handleWorkflowDiscarded, handlePRReviewWorkflowError,
 *          handleWorkflowError) with stubbed process.exit and minimal fake WorkflowConfig.
 *   §5:    Non-GitHub flag suppresses the notifier call at the step level (mirrors call-site
 *          Platform.GitHub guard).
 *   §6:    TypeScript type-check — already defined in feature-504.steps.ts, not redefined here.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  notifyReviewTransition,
  notifyBlockedTransition,
  type NotifierDeps,
} from '../../../adws/forge/hitlBoardNotifier.ts';
import { handleWorkflowDiscarded, handleWorkflowError } from '../../../adws/phases/workflowCompletion.ts';
import { handlePRReviewWorkflowError } from '../../../adws/phases/prReviewCompletion.ts';
import { Platform, type RepoContext } from '../../../adws/providers/types.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import type { PRReviewWorkflowConfig } from '../../../adws/phases/prReviewPhase.ts';
import type { WorkflowContext } from '../../../adws/github/workflowCommentsIssue.ts';
import type { PRReviewWorkflowContext } from '../../../adws/github/workflowCommentsPR.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

interface IssueRecord {
  title: string;
  labels: string[];
}

interface PRRecord {
  number: number;
  url: string;
  body: string;
}

const world: {
  issues: Map<number, IssueRecord>;
  pullRequests: PRRecord[];
  slackPayloads: string[];
  isGitHubPlatform: boolean;
  longErrorMessage: string;
  notifierThrew: boolean;
  origFetch: typeof fetch;
  origExit: typeof process.exit;
  tmpDir: string;
  seededAdwIds: string[];
} = {
  issues: new Map(),
  pullRequests: [],
  slackPayloads: [],
  isGitHubPlatform: true,
  longErrorMessage: '',
  notifierThrew: false,
  origFetch: globalThis.fetch,
  origExit: process.exit,
  tmpDir: '',
  seededAdwIds: [],
};

// Sentinel thrown when process.exit is called inside terminal handlers.
class ExitCalled extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

Before({ tags: '@adw-587' }, function () {
  world.issues = new Map();
  world.pullRequests = [];
  world.slackPayloads = [];
  world.isGitHubPlatform = true;
  world.longErrorMessage = '';
  world.notifierThrew = false;
  world.seededAdwIds = [];
  world.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-bdd-587-'));

  // Stub fetch to capture Slack POSTs
  world.origFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.includes('hooks.slack.com')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { text: string } : { text: '' };
      world.slackPayloads.push(body.text);
      return Promise.resolve(new Response('ok', { status: 200 }));
    }
    return world.origFetch(url, init);
  }) as typeof globalThis.fetch;

  // Stub process.exit inside terminal handlers
  world.origExit = process.exit;
  (process as NodeJS.Process).exit = ((code?: number) => {
    throw new ExitCalled(code);
  }) as typeof process.exit;
});

After({ tags: '@adw-587' }, function () {
  // Restore stubs
  globalThis.fetch = world.origFetch;
  (process as NodeJS.Process).exit = world.origExit;

  // Clean up temp dir and any seeded agent state files
  try { fs.rmSync(world.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  for (const adwId of world.seededAdwIds) {
    const agentDir = path.join(AGENTS_STATE_DIR, adwId);
    try { fs.rmSync(agentDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Background steps
// ---------------------------------------------------------------------------

Given('a Slack webhook URL is configured', function () {
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test-587';
});

// "the ADW codebase is checked out" is defined in ensureCronOnEveryEventSteps.ts

// ---------------------------------------------------------------------------
// Given steps — fixture registration
// ---------------------------------------------------------------------------

Given(
  'a GitHub issue {int} titled {string} carrying the {string} label',
  function (issueNumber: number, title: string, _label: string) {
    world.issues.set(issueNumber, { title, labels: ['hitl'] });
  },
);

Given(
  'a GitHub issue {int} titled {string} without the {string} label',
  function (issueNumber: number, title: string, _label: string) {
    world.issues.set(issueNumber, { title, labels: [] });
  },
);

Given(
  'an open pull request {int} whose body reads {string}',
  function (prNumber: number, body: string) {
    world.pullRequests.push({
      number: prNumber,
      url: `https://github.com/test-owner/test-repo/pull/${prNumber}`,
      body,
    });
  },
);

Given('the active repository is hosted on a non-GitHub platform', function () {
  world.isGitHubPlatform = false;
});

Given(
  'a review error message that begins {string}, spans several lines, and runs well past 200 characters before ending with the marker {string}',
  function (prefix: string, marker: string) {
    const filler = 'x'.repeat(50);
    world.longErrorMessage =
      `${prefix}\n` + `line two\n${filler}\n`.repeat(5) + `line end ${marker}`;
  },
);

Given('the configured Slack webhook rejects every delivery attempt', function () {
  // Replace the stub from Before with one that rejects every POST to the Slack webhook
  globalThis.fetch = ((_url: string, _init?: RequestInit) => {
    return Promise.reject(new Error('webhook rejected'));
  }) as typeof globalThis.fetch;
});

// ---------------------------------------------------------------------------
// When steps — drive the notifier functions and terminal handlers
// ---------------------------------------------------------------------------

function makeNotifierDeps(): NotifierDeps {
  return {
    readIssue: (issueNumber: number) => {
      const rec = world.issues.get(issueNumber);
      if (!rec) return null;
      return { title: rec.title, labels: rec.labels.map((name) => ({ name })) };
    },
    listOpenPRs: (_repoInfo) => {
      return world.pullRequests.map((pr) => ({
        number: pr.number,
        url: pr.url,
        body: pr.body,
        state: 'OPEN',
        headRefName: `feature-issue-${pr.number}-x`,
        baseRefName: 'main',
        updatedAt: new Date().toISOString(),
      }));
    },
  };
}

When('the review-transition notifier runs for issue {int}', async function (issueNumber: number) {
  if (!world.isGitHubPlatform) return; // models call-site Platform.GitHub guard
  const repoInfo = { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub };
  try {
    await notifyReviewTransition({ issueNumber, repoInfo }, makeNotifierDeps());
  } catch (err) {
    world.notifierThrew = true;
    throw err;
  }
});

When(
  'the blocked-transition notifier runs for issue {int} with source {string}',
  async function (issueNumber: number, source: string) {
    if (!world.isGitHubPlatform) return; // models call-site Platform.GitHub guard
    const repoInfo = { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub };
    await notifyBlockedTransition(
      { issueNumber, repoInfo, source: source as 'discarded' | 'review_error' },
      makeNotifierDeps(),
    );
  },
);

When(
  'the blocked-transition notifier runs for issue {int} with source {string} and error message {string}',
  async function (issueNumber: number, source: string, errorMessage: string) {
    const repoInfo = { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub };
    await notifyBlockedTransition(
      { issueNumber, repoInfo, source: source as 'discarded' | 'review_error', errorMessage },
      makeNotifierDeps(),
    );
  },
);

When(
  'the blocked-transition notifier runs for issue {int} with source "review_error" and that error message',
  async function (issueNumber: number) {
    const repoInfo = { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub };
    await notifyBlockedTransition(
      { issueNumber, repoInfo, source: 'review_error', errorMessage: world.longErrorMessage },
      makeNotifierDeps(),
    );
  },
);

// ---------------------------------------------------------------------------
// Terminal handler helpers
// ---------------------------------------------------------------------------

function makeRepoContext(platform: Platform, owner: string, repo: string): RepoContext {
  return {
    repoId: { owner, repo, platform },
    issueTracker: {
      commentOnIssue: () => {},
      moveToStatus: () => Promise.resolve(true),
      deleteComment: () => {},
      closeIssue: () => Promise.resolve(true),
      getIssueState: () => 'open',
      fetchComments: () => [],
      fetchIssue: () => ({ number: 0, title: '', body: '', state: 'open', labels: [] }),
    } as unknown as RepoContext['issueTracker'],
    codeHost: {
      commentOnPR: () => {},
      mergePR: () => Promise.resolve({ success: true }),
      approvePR: () => {},
      fetchPRReviews: () => [],
      fetchPRReviewComments: () => [],
      deleteComment: () => {},
    } as unknown as RepoContext['codeHost'],
    cwd: world.tmpDir,
  };
}

function makeWorkflowConfig(issueNumber: number): WorkflowConfig {
  const adwId = `test-587-${issueNumber}-${Date.now()}`;
  world.seededAdwIds.push(adwId);
  // writeState expects a directory path, not a file path
  const orchPath = path.join(world.tmpDir, `orch-${issueNumber}`);
  fs.mkdirSync(orchPath, { recursive: true });
  const ctx: WorkflowContext = { issueNumber, adwId };
  return {
    issueNumber,
    adwId,
    orchestratorStatePath: orchPath,
    orchestratorName: 'test-orchestrator' as WorkflowConfig['orchestratorName'],
    topLevelStatePath: path.join(world.tmpDir, `top-${issueNumber}.json`),
    ctx,
    repoContext: makeRepoContext(Platform.GitHub, 'test-owner', 'test-repo'),
    // Minimal stubs — unused fields in terminal handlers
    issue: { number: issueNumber, title: '', body: '', state: 'open', labels: [], assignees: [], comments: [], createdAt: '', updatedAt: '' } as unknown as WorkflowConfig['issue'],
    issueType: '/feature' as WorkflowConfig['issueType'],
    worktreePath: world.tmpDir,
    defaultBranch: 'main',
    logsDir: world.tmpDir,
    recoveryState: { inRecovery: false } as unknown as WorkflowConfig['recoveryState'],
    branchName: 'test-branch',
    applicationUrl: '',
    projectConfig: {} as WorkflowConfig['projectConfig'],
    adwYmlConfig: { hitl: false, unitTests: true, guardrails: false },
  };
}

When('the workflow-discarded terminal handler completes for issue {int}', async function (issueNumber: number) {
  const config = makeWorkflowConfig(issueNumber);
  try {
    await handleWorkflowDiscarded(config, 'PR closed', undefined, undefined, makeNotifierDeps());
  } catch (err) {
    if (!(err instanceof ExitCalled)) throw err;
  }
});

When(
  'the PR-review-error terminal handler completes for issue {int} with error message {string}',
  async function (issueNumber: number, errorMessage: string) {
    const config = makeWorkflowConfig(issueNumber);
    const prReviewConfig: PRReviewWorkflowConfig = {
      base: config,
      prNumber: 99,
      prDetails: {
        number: 99,
        title: 'test pr',
        body: '',
        url: `https://github.com/test-owner/test-repo/pull/99`,
        sourceBranch: 'test-branch',
        targetBranch: 'main',
      } as unknown as PRReviewWorkflowConfig['prDetails'],
      unaddressedComments: [],
      ctx: config.ctx as unknown as PRReviewWorkflowContext,
    };
    try {
      await handlePRReviewWorkflowError(
        prReviewConfig,
        new Error(errorMessage),
        undefined,
        undefined,
        makeNotifierDeps(),
      );
    } catch (err) {
      if (!(err instanceof ExitCalled)) throw err;
    }
  },
);

When('the transient-crash terminal handler completes for issue {int}', function (issueNumber: number) {
  const config = makeWorkflowConfig(issueNumber);
  try {
    handleWorkflowError(config, new Error('transient crash'));
  } catch (err) {
    if (!(err instanceof ExitCalled)) throw err;
  }
});

// ---------------------------------------------------------------------------
// Then steps — assertions
// ---------------------------------------------------------------------------

Then('a Slack notification is delivered to SLACK_WEBHOOK_URL', function () {
  assert.ok(
    world.slackPayloads.length > 0,
    `Expected a Slack notification to be delivered, but none was. Payloads: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('no Slack notification is delivered', function () {
  assert.strictEqual(
    world.slackPayloads.length,
    0,
    `Expected no Slack notification, but received: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('the delivered Slack message contains {string}', function (expected: string) {
  const all = world.slackPayloads.join('\n');
  assert.ok(
    all.includes(expected),
    `Expected delivered Slack message to contain "${expected}", but got: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('the delivered Slack message does not contain {string}', function (expected: string) {
  const all = world.slackPayloads.join('\n');
  assert.ok(
    !all.includes(expected),
    `Expected delivered Slack message NOT to contain "${expected}", but got: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('the delivered Slack message contains the title {string}', function (title: string) {
  const all = world.slackPayloads.join('\n');
  assert.ok(
    all.includes(title),
    `Expected delivered Slack message to contain title "${title}", but got: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('the delivered Slack message contains the URL of pull request {int}', function (prNumber: number) {
  const prUrl = `https://github.com/test-owner/test-repo/pull/${prNumber}`;
  const all = world.slackPayloads.join('\n');
  assert.ok(
    all.includes(prUrl),
    `Expected delivered Slack message to contain PR URL "${prUrl}", but got: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('the delivered Slack message does not contain the URL of pull request {int}', function (prNumber: number) {
  const prUrl = `https://github.com/test-owner/test-repo/pull/${prNumber}`;
  const all = world.slackPayloads.join('\n');
  assert.ok(
    !all.includes(prUrl),
    `Expected delivered Slack message NOT to contain PR URL "${prUrl}", but got: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('the delivered Slack message contains the URL of issue {int}', function (issueNumber: number) {
  const issueUrl = `https://github.com/test-owner/test-repo/issues/${issueNumber}`;
  const all = world.slackPayloads.join('\n');
  assert.ok(
    all.includes(issueUrl),
    `Expected delivered Slack message to contain issue URL "${issueUrl}", but got: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('the delivered Slack message does not contain the URL of issue {int}', function (issueNumber: number) {
  const issueUrl = `https://github.com/test-owner/test-repo/issues/${issueNumber}`;
  const all = world.slackPayloads.join('\n');
  assert.ok(
    !all.includes(issueUrl),
    `Expected delivered Slack message NOT to contain issue URL "${issueUrl}", but got: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('the delivered Slack message contains no newline characters', function () {
  for (const payload of world.slackPayloads) {
    assert.ok(
      !payload.includes('\n'),
      `Expected delivered Slack message to contain no newlines, but got: ${JSON.stringify(payload)}`,
    );
  }
});

Then('the review-transition notifier does not throw', function () {
  assert.strictEqual(
    world.notifierThrew,
    false,
    'Expected the review-transition notifier to not throw, but it did',
  );
});
