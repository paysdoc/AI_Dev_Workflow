/**
 * Shared fixture for forgeProviders() tests: a repo identity builder, a real
 * `GitContext` over a spy `exec`, and default assembly options. Extracted
 * from forgeProviders.test.ts so the split suites (forgeProviders.test.ts,
 * forgeProviders.selection.test.ts, forgeProviders.deps.test.ts) don't each
 * redeclare it.
 */

import { type CodeHostForge, type IssueTrackerForge, type ForgeProvidersOptions } from '../forgeProviders';
import { Platform, type RepoIdentifier } from '../types';
import { GitContext } from '../../gitContext';
import type { GitContextOptions, ExecFn } from '../../gitContext';
import { createLiteralTokenProvider } from '../github/githubTokenProvider';

export function makeRepoId(overrides: Partial<RepoIdentifier> = {}): RepoIdentifier {
  return { owner: 'acme', repo: 'webapp', platform: Platform.GitHub, ...overrides };
}

export function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
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

export interface SpyCall { command: string; env: NodeJS.ProcessEnv }

export function makeSpyExec(responses: ReadonlyMap<string, string> = new Map()): { exec: ExecFn; calls: SpyCall[] } {
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

export function makeCtx(overrides: Partial<GitContextOptions> = {}, exec?: ExecFn): GitContext {
  return new GitContext(validOptions(overrides), exec ? { exec } : undefined);
}

const GITHUB_GITHUB = { codeHost: 'github' as CodeHostForge, issueTracker: 'github' as IssueTrackerForge };

export function baseOptions(overrides: Partial<ForgeProvidersOptions> = {}): ForgeProvidersOptions {
  return {
    forge: GITHUB_GITHUB,
    identity: makeRepoId(),
    tokenProvider: createLiteralTokenProvider('gh-token-abc', 'gh-pat-xyz'),
    gitContext: makeCtx(),
    ...overrides,
  };
}
