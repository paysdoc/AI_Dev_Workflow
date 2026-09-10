import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../forge/hitlBoardNotifier', () => ({
  notifyReviewTransition: vi.fn(),
  buildNotifierDeps: vi.fn(() => ({ readIssue: vi.fn(), listOpenPRs: vi.fn() })),
}));

import { parseOwnerRepoFromUrl, mintBoundProviders, resolveAdwLabelDefinition } from '../repoContext';
import { Platform, BoardStatus, type RepoIdentifier } from '../types';
import { GitContext } from '../../gitContext';
import type { GitContextOptions, ExecFn } from '../../gitContext';
import { createLiteralTokenProvider } from '../github/githubTokenProvider';
import { notifyReviewTransition } from '../../forge/hitlBoardNotifier';

const notifyMock = vi.mocked(notifyReviewTransition);

describe('parseOwnerRepoFromUrl', () => {
  describe('HTTPS URLs', () => {
    it('parses standard repo name', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/AI_Dev_Workflow')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses standard repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/AI_Dev_Workflow.git')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses dotted repo name', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/paysdoc.nl')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses dotted repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/paysdoc.nl.git')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses repo name with multiple dots', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/org/api.v2.staging.git')).toEqual({
        owner: 'org',
        repo: 'api.v2.staging',
      });
    });
  });

  describe('SSH URLs', () => {
    it('parses standard repo name', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/AI_Dev_Workflow')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses standard repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/AI_Dev_Workflow.git')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses dotted repo name', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/paysdoc.nl')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses dotted repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/paysdoc.nl.git')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses repo name with multiple dots', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:org/api.v2.staging.git')).toEqual({
        owner: 'org',
        repo: 'api.v2.staging',
      });
    });
  });

  describe('edge cases', () => {
    it('returns null for unrecognised URL format', () => {
      expect(parseOwnerRepoFromUrl('not-a-url')).toBeNull();
    });
  });
});

// ── mintBoundProviders ────────────────────────────────────────────────────────

function makeRepoId(overrides: Partial<RepoIdentifier> = {}): RepoIdentifier {
  return { owner: 'acme', repo: 'webapp', platform: Platform.GitHub, ...overrides };
}

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('gh-token-abc'),
    gitIdentity: { authorName: 'ADW Bot', authorEmail: 'bot@adw.dev', committerName: 'ADW Bot', committerEmail: 'bot@adw.dev' },
    frameworkRepoRoot: '/srv/adw/framework',
    targetReposDir: '/srv/adw/repos',
    ...overrides,
  };
}

interface SpyCall { command: string; env: NodeJS.ProcessEnv }

function makeSpyExec(responses: ReadonlyMap<string, string> = new Map()): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, env: { ...options.env } });
    for (const [pattern, response] of responses) {
      if (command.includes(pattern)) return response;
    }
    return '';
  };
  return { exec, calls };
}

function makeCtx(overrides: Partial<GitContextOptions> = {}, exec?: ExecFn): GitContext {
  return new GitContext(validOptions(overrides), exec ? { exec } : undefined);
}

describe('mintBoundProviders', () => {
  it('GitHub/GitHub mints all three providers bound to the supplied repoId', () => {
    const repoId = makeRepoId();
    const providers = mintBoundProviders({
      repoId,
      gitContext: makeCtx(),
      codeHostPlatform: Platform.GitHub,
      issueTrackerPlatform: Platform.GitHub,
    });
    expect(providers.issueTracker).toBeDefined();
    expect(providers.codeHost).toBeDefined();
    expect(providers.boardManager).toBeDefined();
    expect(providers.codeHost.getRepoIdentifier()).toEqual(repoId);
  });

  it('refuses an unsupported code-host platform by name, never substituting GitHub', () => {
    expect(() =>
      mintBoundProviders({
        repoId: makeRepoId(),
        gitContext: makeCtx(),
        codeHostPlatform: Platform.Bitbucket,
        issueTrackerPlatform: Platform.GitHub,
      }),
    ).toThrow(/bitbucket/);
  });

  it('refuses an unsupported issue-tracker platform by name, never substituting GitHub', () => {
    expect(() =>
      mintBoundProviders({
        repoId: makeRepoId(),
        gitContext: makeCtx(),
        codeHostPlatform: Platform.GitHub,
        issueTrackerPlatform: Platform.GitLab,
      }),
    ).toThrow(/gitlab/);
  });

  it('throws through validateRepoIdentifier for an empty owner', () => {
    expect(() =>
      mintBoundProviders({
        repoId: makeRepoId({ owner: '' }),
        gitContext: makeCtx(),
        codeHostPlatform: Platform.GitHub,
        issueTrackerPlatform: Platform.GitHub,
      }),
    ).toThrow(/owner/);
  });

  it('throws through validateRepoIdentifier for an empty repo', () => {
    expect(() =>
      mintBoundProviders({
        repoId: makeRepoId({ repo: '' }),
        gitContext: makeCtx(),
        codeHostPlatform: Platform.GitHub,
        issueTrackerPlatform: Platform.GitHub,
      }),
    ).toThrow(/repo/);
  });

  it('returns a frozen triple', () => {
    const providers = mintBoundProviders({
      repoId: makeRepoId(),
      gitContext: makeCtx(),
      codeHostPlatform: Platform.GitHub,
      issueTrackerPlatform: Platform.GitHub,
    });
    expect(Object.isFrozen(providers)).toBe(true);
  });

  it('two calls with the same repoId mint distinct codeHost/issueTracker instances', () => {
    const repoId = makeRepoId();
    const first = mintBoundProviders({ repoId, gitContext: makeCtx(), codeHostPlatform: Platform.GitHub, issueTrackerPlatform: Platform.GitHub });
    const second = mintBoundProviders({ repoId, gitContext: makeCtx(), codeHostPlatform: Platform.GitHub, issueTrackerPlatform: Platform.GitHub });
    expect(first.codeHost).not.toBe(second.codeHost);
    expect(first.issueTracker).not.toBe(second.issueTracker);
  });

  it('a mismatched context is refused naming both identities before any provider is minted', () => {
    const repoId = makeRepoId();
    const mismatchedCtx = makeCtx({ owner: 'octo', repo: 'infra' });
    expect(() =>
      mintBoundProviders({ repoId, gitContext: mismatchedCtx, codeHostPlatform: Platform.GitHub, issueTrackerPlatform: Platform.GitHub }),
    ).toThrow(/octo\/infra/);
  });

  it('threads the supplied context into both the minted tracker and code host', () => {
    const repoId = makeRepoId();
    const { exec, calls } = makeSpyExec();
    const ctx = makeCtx({ tokenProvider: createLiteralTokenProvider('gh-token-abc') }, exec);
    const providers = mintBoundProviders({ repoId, gitContext: ctx, codeHostPlatform: Platform.GitHub, issueTrackerPlatform: Platform.GitHub });

    providers.issueTracker.fetchLabels(1);
    providers.codeHost.getDefaultBranch();

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((c) => c.env.GH_TOKEN === 'gh-token-abc')).toBe(true);
  });
});

// ── Review-transition notification wiring ────────────────────────────────────

const PROJECT_RESPONSE = JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1' }] } } } });
const ITEM_RESPONSE = JSON.stringify({
  data: { repository: { issue: { projectItems: { nodes: [
    { id: 'ITEM_1', project: { id: 'PVT_1' }, fieldValueByName: { name: 'Todo' } },
  ] } } } },
});
const MOVE_RESPONSE = JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } } });

function fieldResponseFor(status: string): string {
  return JSON.stringify({ data: { node: { field: { id: 'FIELD_1', options: [{ id: 'OPT_1', name: status } ] } } } });
}

function makeMoveExec(targetStatus: string): ExecFn {
  const responses = new Map([
    ['projectsV2(first:1)', PROJECT_RESPONSE],
    ['projectItems(first:50)', ITEM_RESPONSE],
    ['field(name:', fieldResponseFor(targetStatus)],
    ['updateProjectV2ItemFieldValue', MOVE_RESPONSE],
  ]);
  return makeSpyExec(responses).exec;
}

describe('mintBoundProviders — Review-transition notification wiring', () => {
  beforeEach(() => {
    notifyMock.mockClear();
    notifyMock.mockResolvedValue(undefined);
  });

  it('a successful move to Review calls notifyReviewTransition once, awaited', async () => {
    const repoId = makeRepoId();
    const providers = mintBoundProviders({
      repoId, gitContext: makeCtx({}, makeMoveExec('Review')),
      codeHostPlatform: Platform.GitHub, issueTrackerPlatform: Platform.GitHub,
    });

    const result = await providers.issueTracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(true);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toEqual({ issueNumber: 42, repoInfo: repoId });
  });

  it('a move to a non-Review status does not call notifyReviewTransition', async () => {
    const repoId = makeRepoId();
    const providers = mintBoundProviders({
      repoId, gitContext: makeCtx({}, makeMoveExec('In Progress')),
      codeHostPlatform: Platform.GitHub, issueTrackerPlatform: Platform.GitHub,
    });

    const result = await providers.issueTracker.moveToStatus(42, BoardStatus.InProgress);

    expect(result).toBe(true);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('a false move does not call notifyReviewTransition', async () => {
    const repoId = makeRepoId();
    const throwingExec: ExecFn = () => { throw new Error('gh api error: 500'); };
    const providers = mintBoundProviders({
      repoId, gitContext: makeCtx({}, throwingExec),
      codeHostPlatform: Platform.GitHub, issueTrackerPlatform: Platform.GitHub,
    });

    const result = await providers.issueTracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(false);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

// ── resolveAdwLabelDefinition ─────────────────────────────────────────────────

describe('resolveAdwLabelDefinition', () => {
  it('adw:blocked resolves to its catalogue colour', () => {
    expect(resolveAdwLabelDefinition('adw:blocked')).toEqual({ name: 'adw:blocked', color: 'b60205', description: 'ADW lane escalated to human (terminal)' });
  });

  it('regression-promotion resolves to its catalogue colour', () => {
    expect(resolveAdwLabelDefinition('regression-promotion').color).toBe('c5def5');
  });

  it('an unknown label falls back to the generic grey definition', () => {
    expect(resolveAdwLabelDefinition('mystery-label')).toEqual({ name: 'mystery-label', color: 'ededed', description: 'ADW label' });
  });
});
