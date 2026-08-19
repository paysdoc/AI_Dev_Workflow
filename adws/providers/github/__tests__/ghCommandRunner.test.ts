/**
 * ghCommandRunner.test.ts — the adapter's sole route into GitContext.exec (#792).
 *
 * Drives a real GitContext constructed with an injected exec spy, exactly as
 * adws/gitContext/__tests__/repoApiCwd.test.ts does. No child_process is
 * touched — this is entirely an in-process behavioural proof.
 */

import { describe, it, expect } from 'vitest';
import { GitContext } from '../../../gitContext';
import type { GitContextOptions, ExecFn, TokenProvider, CredentialRequest } from '../../../gitContext/types';
import { createGhCommandRunner } from '../ghCommandRunner';

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';

const GIT_IDENTITY = {
  authorName: 'ADW Bot',
  authorEmail: 'bot@adw.dev',
  committerName: 'ADW Bot',
  committerEmail: 'bot@adw.dev',
};

interface SpyCall {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
}

function makeSpyExec(stdout = 'seam-answer\n'): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, cwd: options.cwd, env: { ...options.env }, input: options.input });
    return stdout;
  };
  return { exec, calls };
}

/** A provider that answers 'default' with one credential and 'alternateIdentity' with another. */
function makePurposeSplitProvider(ordinary: string, elevated: string): TokenProvider {
  return {
    credentialEnv(request: CredentialRequest): NodeJS.ProcessEnv {
      return { GH_TOKEN: request.purpose === 'alternateIdentity' ? elevated : ordinary };
    },
  };
}

function buildContext(overrides: Partial<GitContextOptions> = {}, exec: ExecFn): GitContext {
  const options: GitContextOptions = {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    tokenProvider: makePurposeSplitProvider('token-default', 'token-alternate'),
    gitIdentity: GIT_IDENTITY,
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  };
  return new GitContext(options, { exec });
}

describe('createGhCommandRunner', () => {
  it('sends the command string to the executor verbatim', () => {
    const { exec, calls } = makeSpyExec();
    const runner = createGhCommandRunner(buildContext({}, exec));

    runner.run('gh api user --jq .login');

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('gh api user --jq .login');
  });

  it('returns the executor\'s answer', () => {
    const { exec } = makeSpyExec('adapter-seam-answer\n');
    const runner = createGhCommandRunner(buildContext({}, exec));

    const result = runner.run('gh api user --jq .login');

    expect(result).toBe('adapter-seam-answer');
  });

  it('runs from the framework root for a target (non-self-host) context', () => {
    const { exec, calls } = makeSpyExec();
    const runner = createGhCommandRunner(buildContext({ selfHost: false }, exec));

    runner.run('gh api user');

    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('runs from the framework root for a self-host context too', () => {
    const { exec, calls } = makeSpyExec();
    const runner = createGhCommandRunner(buildContext({ selfHost: true }, exec));

    runner.run('gh api user');

    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('carries the default-purpose credential and the four GIT_* identity variables when no purpose is given', () => {
    const { exec, calls } = makeSpyExec();
    const runner = createGhCommandRunner(buildContext({}, exec));

    runner.run('gh api user');

    expect(calls[0].env.GH_TOKEN).toBe('token-default');
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe(GIT_IDENTITY.authorName);
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe(GIT_IDENTITY.authorEmail);
    expect(calls[0].env.GIT_COMMITTER_NAME).toBe(GIT_IDENTITY.committerName);
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe(GIT_IDENTITY.committerEmail);
  });

  it("carries the alternate credential when purpose 'alternateIdentity' is requested", () => {
    const { exec, calls } = makeSpyExec();
    const runner = createGhCommandRunner(buildContext({}, exec));

    runner.run('gh api graphql', { purpose: 'alternateIdentity' });

    expect(calls[0].env.GH_TOKEN).toBe('token-alternate');
  });

  it("carries the primary credential when purpose 'default' is explicit", () => {
    const { exec, calls } = makeSpyExec();
    const runner = createGhCommandRunner(buildContext({}, exec));

    runner.run('gh api user', { purpose: 'default' });

    expect(calls[0].env.GH_TOKEN).toBe('token-default');
  });

  it('pipes an optional input string through to the executor', () => {
    const { exec, calls } = makeSpyExec();
    const runner = createGhCommandRunner(buildContext({}, exec));

    runner.run('gh api graphql --input -', { input: '{"query":"..."}' });

    expect(calls[0].input).toBe('{"query":"..."}');
  });

  it('leaves input undefined when none is supplied', () => {
    const { exec, calls } = makeSpyExec();
    const runner = createGhCommandRunner(buildContext({}, exec));

    runner.run('gh api user');

    expect(calls[0].input).toBeUndefined();
  });

  it('mutates no process environment variable', () => {
    const before = { ...process.env };
    const { exec } = makeSpyExec();
    const runner = createGhCommandRunner(buildContext({}, exec));

    runner.run('gh api user');

    expect(process.env).toEqual(before);
  });
});
