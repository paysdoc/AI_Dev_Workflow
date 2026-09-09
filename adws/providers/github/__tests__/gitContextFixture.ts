/**
 * Shared exec-fake fixture for the GitHub adapter's behaviour tests (#819):
 * a real `GitContext` over a spy `exec`, plus a capturing logger. Extracted
 * from `ghRepoApi.test.ts`'s `validOptions`/`makeSpyExec` pattern so the
 * rewritten port-class suites don't each redeclare it.
 */

import { GitContext } from '../../../gitContext';
import type { GitContextOptions, ExecFn, Logger, LogLevel } from '../../../gitContext';
import { createLiteralTokenProvider } from '../githubTokenProvider';

export const FRAMEWORK_ROOT = '/srv/adw/framework';
export const TARGET_REPOS_DIR = '/srv/adw/repos';

export function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'widget',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('gh-token-abc'),
    gitIdentity: {
      authorName: 'ADW Bot',
      authorEmail: 'bot@adw.dev',
      committerName: 'ADW Bot',
      committerEmail: 'bot@adw.dev',
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  };
}

export interface SpyCall {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
}

/** A spy `exec` that answers by first-matching command substring, or `defaultStdout` when nothing matches. */
export function makeSpyExec(
  responses: ReadonlyMap<string, string | Error> = new Map(),
  defaultStdout = '',
): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, cwd: options.cwd, env: { ...options.env }, input: options.input });
    for (const [pattern, response] of responses) {
      if (command.includes(pattern)) {
        if (response instanceof Error) throw response;
        return response;
      }
    }
    return defaultStdout;
  };
  return { exec, calls };
}

export function makeCtx(overrides: Partial<GitContextOptions> = {}, exec?: ExecFn): GitContext {
  return new GitContext(validOptions(overrides), exec ? { exec } : undefined);
}

export interface CapturedLog {
  message: string;
  level?: LogLevel;
}

export function makeCapturingLogger(): { logger: Logger; logs: CapturedLog[] } {
  const logs: CapturedLog[] = [];
  const logger: Logger = (message, level) => {
    logs.push({ message, level });
  };
  return { logger, logs };
}
