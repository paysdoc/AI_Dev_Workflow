/**
 * Shared world state for GitContext BDD step definitions.
 * Imported by feature-659.steps.ts and feature-662.steps.ts so both share
 * a single W object and makeSpyExec factory — no duplicate step definitions.
 */

import { GitContext } from '../../../adws/gitContext/index.ts';
import type { GitContextOptions, ExecFn, FsDeps } from '../../../adws/gitContext/index.ts';

export const TARGET_REPOS_ROOT = '/srv/adw/repos';
export const FRAMEWORK_ROOT = '/srv/adw/framework';

export interface SpyCall {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface PendingCtxArgs {
  owner: string;
  repo: string;
  token: string;
  authorName: string;
  authorEmail: string;
}

export interface SharedWorld {
  pendingArgs: PendingCtxArgs | null;
  ctx: GitContext | null;
  spyCalls: SpyCall[];
  /** Mutable response map read by the spy at call time (captured by reference). */
  responseMap: Map<string, string | Error>;
  contextsByKey: Map<string, { ctx: GitContext; calls: SpyCall[] }>;
  pendingByKey: Map<string, PendingCtxArgs>;
  parentEnvSnapshot: NodeJS.ProcessEnv | null;
  originalCwd: string;
  savedGhToken: string | undefined;
  lastError: Error | null;
}

export const W: SharedWorld = {
  pendingArgs: null,
  ctx: null,
  spyCalls: [],
  responseMap: new Map(),
  contextsByKey: new Map(),
  pendingByKey: new Map(),
  parentEnvSnapshot: null,
  originalCwd: process.cwd(),
  savedGhToken: undefined,
  lastError: null,
};

/**
 * Spy factory. The spy reads `responseMap` at call time (by reference) so
 * Givens that run AFTER spy creation can still configure responses.
 * Falls back to `defaultStdout` when no pattern matches.
 */
export function makeSpyExec(
  responseMap: Map<string, string | Error>,
  defaultStdout = 'main\n',
): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, cwd: options.cwd, env: { ...options.env } });
    for (const [pattern, response] of responseMap) {
      if (command.includes(pattern)) {
        if (response instanceof Error) throw response;
        return response;
      }
    }
    return defaultStdout;
  };
  return { exec, calls };
}

export function makeFullOptions(
  owner: string,
  repo: string,
  token: string,
  authorName: string,
  authorEmail: string,
): GitContextOptions {
  return {
    owner,
    repo,
    selfHost: false,
    token,
    gitIdentity: {
      authorName,
      authorEmail,
      committerName: authorName,
      committerEmail: authorEmail,
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_ROOT,
  };
}

export function parseAuthor(authorStr: string): { name: string; email: string } {
  const match = /^(.+?)\s*<([^>]+)>$/.exec(authorStr.trim());
  if (!match) throw new Error(`Cannot parse author string: "${authorStr}"`);
  return { name: match[1].trim(), email: match[2].trim() };
}

/** No-op fs spy for BDD tests — all paths are imaginary, so fs operations are stubbed out. */
export function makeNoOpFsDeps(): FsDeps {
  return {
    existsSync: () => false,
    mkdirSync: () => {},
    copyFileSync: () => {},
    rmSync: () => {},
  };
}
