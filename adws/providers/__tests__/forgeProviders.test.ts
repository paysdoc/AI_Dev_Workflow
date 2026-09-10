import { describe, it, expect, vi } from 'vitest';
import {
  forgeProviders,
  UnknownForgeError,
  type CodeHostForge,
  type IssueTrackerForge,
  type ForgeProvidersOptions,
} from '../forgeProviders';
import { Platform, BoardStatus, type RepoIdentifier } from '../types';
import { GitContext } from '../../gitContext';
import type { GitContextOptions, ExecFn } from '../../gitContext';
import { createLiteralTokenProvider } from '../github/githubTokenProvider';

function makeRepoId(overrides: Partial<RepoIdentifier> = {}): RepoIdentifier {
  return { owner: 'acme', repo: 'webapp', platform: Platform.GitHub, ...overrides };
}

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('gh-token-abc', 'gh-pat-xyz'),
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

const GITHUB_GITHUB = { codeHost: 'github' as CodeHostForge, issueTracker: 'github' as IssueTrackerForge };

function baseOptions(overrides: Partial<ForgeProvidersOptions> = {}): ForgeProvidersOptions {
  return {
    forge: GITHUB_GITHUB,
    identity: makeRepoId(),
    tokenProvider: createLiteralTokenProvider('gh-token-abc', 'gh-pat-xyz'),
    gitContext: makeCtx(),
    ...overrides,
  };
}

// ── github/github ────────────────────────────────────────────────────────────

describe('forgeProviders — github/github', () => {
  it('mints all three providers bound to the supplied identity, frozen', () => {
    const identity = makeRepoId();
    const providers = forgeProviders(baseOptions({ identity }));
    expect(providers.issueTracker).toBeDefined();
    expect(providers.codeHost).toBeDefined();
    expect(providers.boardManager).toBeDefined();
    expect(providers.codeHost.getRepoIdentifier()).toEqual(identity);
    expect(Object.isFrozen(providers)).toBe(true);
  });

  it('every command the minted providers issue reaches the spy, named to the identity, carrying the token', () => {
    const identity = makeRepoId();
    const { exec, calls } = makeSpyExec();
    const ctx = makeCtx({}, exec);
    const providers = forgeProviders(baseOptions({ identity, gitContext: ctx }));

    providers.issueTracker.fetchLabels(1);
    providers.codeHost.getDefaultBranch();

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((c) => c.env.GH_TOKEN === 'gh-token-abc')).toBe(true);
    expect(calls.every((c) => c.command.includes('acme/webapp'))).toBe(true);
  });

  it('two calls mint distinct codeHost/issueTracker instances', () => {
    const identity = makeRepoId();
    const first = forgeProviders(baseOptions({ identity }));
    const second = forgeProviders(baseOptions({ identity }));
    expect(first.codeHost).not.toBe(second.codeHost);
    expect(first.issueTracker).not.toBe(second.issueTracker);
  });
});

// ── identity / context / tokenProvider guard clauses ─────────────────────────

describe('forgeProviders — identity, context-binding and tokenProvider refusals', () => {
  it('a context bound to another repository is refused naming both, before any provider is constructed', () => {
    const identity = makeRepoId({ owner: 'acme', repo: 'webapp' });
    const { exec, calls } = makeSpyExec();
    const mismatchedCtx = makeCtx({ owner: 'octo', repo: 'infra' }, exec);

    expect(() => forgeProviders(baseOptions({ identity, gitContext: mismatchedCtx }))).toThrow(/octo\/infra/);
    expect(() => forgeProviders(baseOptions({ identity, gitContext: mismatchedCtx }))).toThrow(/acme\/webapp/);
    expect(calls).toHaveLength(0);
  });

  it('throws through validateRepoIdentifier for an empty owner', () => {
    expect(() => forgeProviders(baseOptions({ identity: makeRepoId({ owner: '' }) }))).toThrow(/owner/);
  });

  it('throws through validateRepoIdentifier for an empty repo', () => {
    expect(() => forgeProviders(baseOptions({ identity: makeRepoId({ repo: '' }) }))).toThrow(/repo/);
  });

  it('a tokenProvider that does not implement the port throws the named error', () => {
    expect(() => forgeProviders(baseOptions({ tokenProvider: {} as never }))).toThrow(/credentialEnv/);
  });
});

// ── unknown / wrong-port forge names ──────────────────────────────────────────

describe('forgeProviders — unknown and wrong-port forge names', () => {
  it('an unknown code host forge throws UnknownForgeError naming the value and the port; nothing constructed', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = makeCtx({}, exec);
    let error: unknown;
    try {
      forgeProviders(baseOptions({ gitContext: ctx, forge: { codeHost: 'bananas' as CodeHostForge, issueTracker: 'github' } }));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(UnknownForgeError);
    expect((error as Error).name).toBe('UnknownForgeError');
    expect((error as Error).message).toMatch(/bananas/);
    expect((error as Error).message).toMatch(/code host/);
    expect(calls).toHaveLength(0);
  });

  it('an unknown issue tracker forge ("gitlab") throws UnknownForgeError naming the value and the port', () => {
    expect(() => forgeProviders(baseOptions({ forge: { codeHost: 'github', issueTracker: 'gitlab' as IssueTrackerForge } })))
      .toThrow(UnknownForgeError);
    try {
      forgeProviders(baseOptions({ forge: { codeHost: 'github', issueTracker: 'gitlab' as IssueTrackerForge } }));
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(/gitlab/);
      expect((err as Error).message).toMatch(/issue tracker/);
    }
  });

  it('a wrong-port forge name ("jira" as a code host) is refused', () => {
    expect(() => forgeProviders(baseOptions({ forge: { codeHost: 'jira' as CodeHostForge, issueTracker: 'github' } })))
      .toThrow(UnknownForgeError);
  });

  it('a valid code host with an invalid issue tracker constructs nothing and names the tracker', () => {
    expect(() => forgeProviders(baseOptions({ forge: { codeHost: 'github', issueTracker: 'bananas' as IssueTrackerForge } })))
      .toThrow(/bananas/);
  });
});

// ── GitLab / Jira selection ───────────────────────────────────────────────────

describe('forgeProviders — gitlab code host selection', () => {
  it('with deps.gitlab: a GitLab code host bound to identity, a GitHub issue tracker, and no board manager', () => {
    const identity = makeRepoId({ platform: Platform.GitLab });
    const ctx = makeCtx({ owner: identity.owner, repo: identity.repo });
    const providers = forgeProviders(baseOptions({
      identity,
      gitContext: ctx,
      forge: { codeHost: 'gitlab', issueTracker: 'github' },
      deps: { gitlab: { token: 'glpat-x', instanceUrl: 'https://gitlab.example.com' } },
    }));
    expect(providers.codeHost.getRepoIdentifier()).toEqual(identity);
    expect(providers.issueTracker).toBeDefined();
    expect(providers.boardManager).toBeUndefined();
  });

  it('without deps.gitlab: refused, naming the missing config', () => {
    expect(() => forgeProviders(baseOptions({ forge: { codeHost: 'gitlab', issueTracker: 'github' } })))
      .toThrow(/gitlab.*deps\.gitlab/i);
  });
});

describe('forgeProviders — jira issue tracker selection', () => {
  it('with deps.jira: constructs (no request until an operation runs), code host GitHub', () => {
    const identity = makeRepoId();
    const providers = forgeProviders(baseOptions({
      identity,
      forge: { codeHost: 'github', issueTracker: 'jira' },
      deps: { jira: { instanceUrl: 'https://issues.example.com', projectKey: 'ADW', auth: { pat: 'tok' } } },
    }));
    expect(providers.issueTracker).toBeDefined();
    expect(providers.codeHost).toBeDefined();
  });

  it('without deps.jira: refused, naming the missing config', () => {
    expect(() => forgeProviders(baseOptions({ forge: { codeHost: 'github', issueTracker: 'jira' } })))
      .toThrow(/jira.*deps\.jira/i);
  });
});

// ── GitHub seams (deps.github) and logger threading ───────────────────────────

const PROJECT_RESPONSE = JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1' }] } } } });
const ITEM_RESPONSE = JSON.stringify({
  data: { repository: { issue: { projectItems: { nodes: [
    { id: 'ITEM_1', project: { id: 'PVT_1' }, fieldValueByName: { name: 'Todo' } },
  ] } } } },
});
const MOVE_RESPONSE = JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } } });

function fieldResponseFor(status: string): string {
  return JSON.stringify({ data: { node: { field: { id: 'FIELD_1', options: [{ id: 'OPT_1', name: status }] } } } });
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

describe('forgeProviders — deps.github seams', () => {
  it('deps.github.onStatusMoved fires once, awaited, after a successful move to Review', async () => {
    const onStatusMoved = vi.fn().mockResolvedValue(undefined);
    const providers = forgeProviders(baseOptions({
      gitContext: makeCtx({}, makeMoveExec('Review')),
      deps: { github: { onStatusMoved } },
    }));

    const result = await providers.issueTracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(true);
    expect(onStatusMoved).toHaveBeenCalledTimes(1);
    expect(onStatusMoved).toHaveBeenCalledWith(42, BoardStatus.Review);
  });

  it('deps.github.onStatusMoved does not fire after a failed move', async () => {
    const onStatusMoved = vi.fn();
    const throwingExec: ExecFn = () => { throw new Error('gh api error: 500'); };
    const providers = forgeProviders(baseOptions({
      gitContext: makeCtx({}, throwingExec),
      deps: { github: { onStatusMoved } },
    }));

    const result = await providers.issueTracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(false);
    expect(onStatusMoved).not.toHaveBeenCalled();
  });

  it("deps.github.resolveLabelDefinition is consulted on applyLabel's lazy-create path", () => {
    const resolveLabelDefinition = vi.fn().mockReturnValue({ name: 'adw:blocked', color: 'b60205', description: 'x' });
    let editCalls = 0;
    const exec: ExecFn = (command) => {
      if (command.includes('issue edit')) {
        editCalls += 1;
        if (editCalls === 1) throw new Error('label not found');
      }
      return '';
    };
    const providers = forgeProviders(baseOptions({
      gitContext: makeCtx({}, exec),
      deps: { github: { resolveLabelDefinition } },
    }));

    providers.issueTracker.applyLabel(42, 'adw:blocked');

    expect(resolveLabelDefinition).toHaveBeenCalledWith('adw:blocked');
    expect(editCalls).toBe(2);
  });

  it('deps.github.canApprovePullRequests answers codeHost.canApprovePullRequests()', () => {
    const providers = forgeProviders(baseOptions({ deps: { github: { canApprovePullRequests: () => true } } }));
    expect(providers.codeHost.canApprovePullRequests()).toBe(true);

    const negativeProviders = forgeProviders(baseOptions({ deps: { github: { canApprovePullRequests: () => false } } }));
    expect(negativeProviders.codeHost.canApprovePullRequests()).toBe(false);
  });
});

describe('forgeProviders — deps.logger threading', () => {
  it("a capturing deps.logger receives the board manager's warn line on a failed project lookup", async () => {
    const logs: { message: string; level?: string }[] = [];
    const logger = (message: string, level?: string) => { logs.push({ message, level }); };
    const failingExec: ExecFn = () => { throw new Error('gh api error: 500'); };
    const providers = forgeProviders(baseOptions({
      gitContext: makeCtx({}, failingExec),
      deps: { logger },
    }));

    await providers.boardManager?.findBoard();

    expect(logs.some((l) => l.level === 'warn' && l.message.includes('acme/webapp'))).toBe(true);
  });
});
