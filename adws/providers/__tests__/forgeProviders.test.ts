/**
 * forgeProviders.test.ts — core assembly, identity/context refusals, and
 * unknown-forge-name refusals. Sibling suites, sharing forgeProvidersFixture.ts:
 *  - forgeProviders.selection.test.ts  (GitLab/Jira forge selection)
 *  - forgeProviders.deps.test.ts       (deps.github seams, deps.logger threading)
 */

import { describe, it, expect } from 'vitest';
import {
  forgeProviders,
  UnknownForgeError,
  type CodeHostForge,
  type IssueTrackerForge,
} from '../forgeProviders';
import { makeRepoId, makeCtx, makeSpyExec, baseOptions } from './forgeProvidersFixture';

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
