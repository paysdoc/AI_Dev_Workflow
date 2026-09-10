/**
 * forgeProviders.selection.test.ts — GitLab code host and Jira issue tracker
 * forge selection. Split out of forgeProviders.test.ts; see that file's
 * header for the sibling-suite layout.
 */

import { describe, it, expect } from 'vitest';
import { forgeProviders } from '../forgeProviders';
import { Platform } from '../types';
import { makeRepoId, makeCtx, baseOptions } from './forgeProvidersFixture';

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
