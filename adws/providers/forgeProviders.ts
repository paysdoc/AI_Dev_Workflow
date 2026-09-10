/**
 * forgeProviders() — the provider package's one public assembly function,
 * and the library's entry point at 1.0.0 (frozen after HITL review).
 *
 * One identity in, every returned provider bound to it. Refuses — before
 * constructing anything — an identity that fails `validateRepoIdentifier`, a
 * `tokenProvider` that does not implement the port, a `gitContext` bound to
 * another repository (naming both), and an unknown or wrong-port forge name
 * (`UnknownForgeError`, naming the value and the port). The board manager is
 * present only for a GitHub code host and omitted — never a refusing stub —
 * otherwise.
 *
 * The consumer parses its own configuration into a `ForgeSelection`;
 * `tokenProvider` is the credential port the consumer built `gitContext`
 * with, declared on the contract so a later adapter that authenticates
 * through the port needs no signature change. Imports only the executor,
 * the ports and this package's own adapters — never `adws/core`,
 * `adws/types`, `adws/github` or `adws/forge`; reads no file and no
 * environment variable.
 */

import type { GitContext, Logger, TokenProvider } from '../gitContext';
import { type BoardManager, type BoundProviders, type CodeHost, type IssueTracker, type RepoIdentifier, validateRepoIdentifier } from './types';
import { assertContextBoundTo } from './github/contextBinding';
import { createGitHubIssueTracker, type GitHubIssueTrackerDeps } from './github/githubIssueTracker';
import { createGitHubCodeHost, type GitHubCodeHostDeps } from './github/githubCodeHost';
import { createGitHubBoardManager } from './github/githubBoardManager';
import { createGitLabCodeHost } from './gitlab/gitlabCodeHost';
import type { GitLabConfig } from './gitlab/gitlabApiClient';
import { createJiraIssueTracker, type JiraConfig } from './jira/jiraIssueTracker';

// ---------------------------------------------------------------------------
// The closed forge unions — one per port
// ---------------------------------------------------------------------------

export const CODE_HOST_FORGES = ['github', 'gitlab'] as const;
export const ISSUE_TRACKER_FORGES = ['github', 'jira'] as const;

export type CodeHostForge = (typeof CODE_HOST_FORGES)[number];
export type IssueTrackerForge = (typeof ISSUE_TRACKER_FORGES)[number];
export type ForgeName = CodeHostForge | IssueTrackerForge;

/** Runtime guard for JS consumers and config-derived strings — `CodeHostForge` is a compile-time-only guarantee. */
export function isCodeHostForge(value: string): value is CodeHostForge {
  return (CODE_HOST_FORGES as readonly string[]).includes(value);
}

/** Runtime guard for JS consumers and config-derived strings — `IssueTrackerForge` is a compile-time-only guarantee. */
export function isIssueTrackerForge(value: string): value is IssueTrackerForge {
  return (ISSUE_TRACKER_FORGES as readonly string[]).includes(value);
}

export interface ForgeSelection {
  readonly codeHost: CodeHostForge;
  readonly issueTracker: IssueTrackerForge;
}

/** ADW-shaped GitHub seams a consumer may inject — Slack/label/approval behaviour the library itself never learns about. */
export interface GitHubForgeDeps {
  readonly onStatusMoved?: GitHubIssueTrackerDeps['onStatusMoved'];
  readonly resolveLabelDefinition?: GitHubIssueTrackerDeps['resolveLabelDefinition'];
  readonly canApprovePullRequests?: GitHubCodeHostDeps['canApprovePullRequests'];
}

export interface ForgeProviderDeps {
  readonly logger?: Logger;
  readonly github?: GitHubForgeDeps;
  /** Required when `forge.codeHost === 'gitlab'`. */
  readonly gitlab?: GitLabConfig;
  /** Required when `forge.issueTracker === 'jira'`. */
  readonly jira?: JiraConfig;
}

export interface ForgeProvidersOptions {
  readonly forge: ForgeSelection;
  readonly identity: RepoIdentifier;
  readonly tokenProvider: TokenProvider;
  readonly gitContext: GitContext;
  readonly deps?: ForgeProviderDeps;
}

/** Thrown by {@link forgeProviders} for a forge name outside the closed union for its port. */
export class UnknownForgeError extends Error {
  constructor(value: string, port: 'code host' | 'issue tracker', allowed: readonly string[]) {
    super(`forgeProviders: unknown ${port} forge "${value}" (expected one of: ${allowed.join(', ')})`);
    this.name = 'UnknownForgeError';
  }
}

function assertTokenProvider(tokenProvider: TokenProvider): void {
  if (typeof tokenProvider?.credentialEnv !== 'function') {
    throw new Error('forgeProviders: tokenProvider must implement credentialEnv(request)');
  }
}

// ---------------------------------------------------------------------------
// Per-port builders — one small named function each, no default-to-GitHub fallback
// ---------------------------------------------------------------------------

function buildIssueTracker(forgeName: IssueTrackerForge, gitContext: GitContext, identity: RepoIdentifier, deps: ForgeProviderDeps): IssueTracker {
  if (forgeName === 'github') {
    return createGitHubIssueTracker(gitContext, identity, {
      logger: deps.logger,
      onStatusMoved: deps.github?.onStatusMoved,
      resolveLabelDefinition: deps.github?.resolveLabelDefinition,
    });
  }
  if (!deps.jira) {
    throw new Error('forgeProviders: issue tracker "jira" needs deps.jira (JiraConfig)');
  }
  return createJiraIssueTracker(deps.jira, { logger: deps.logger });
}

function buildCodeHost(forgeName: CodeHostForge, gitContext: GitContext, identity: RepoIdentifier, deps: ForgeProviderDeps): CodeHost {
  if (forgeName === 'github') {
    return createGitHubCodeHost(gitContext, identity, {
      logger: deps.logger,
      canApprovePullRequests: deps.github?.canApprovePullRequests,
    });
  }
  if (!deps.gitlab) {
    throw new Error('forgeProviders: code host "gitlab" needs deps.gitlab (GitLabConfig)');
  }
  return createGitLabCodeHost(identity, deps.gitlab, { logger: deps.logger });
}

/** GitHub is the only code host with board support; every other selection omits the member — never a refusing stub. */
function buildBoardManager(forgeName: CodeHostForge, gitContext: GitContext, identity: RepoIdentifier, deps: ForgeProviderDeps): BoardManager | undefined {
  if (forgeName !== 'github') return undefined;
  return createGitHubBoardManager(gitContext, identity, { logger: deps.logger });
}

// ---------------------------------------------------------------------------
// The assembly function
// ---------------------------------------------------------------------------

/**
 * Builds the one bound provider set for `identity`. Guard clauses run in
 * order — identity, token provider, context binding, then both forge names
 * — entirely before any adapter is constructed, so a refusal never leaves a
 * partially-built set and never issues a command.
 */
export function forgeProviders(options: ForgeProvidersOptions): BoundProviders {
  const { forge, identity, tokenProvider, gitContext, deps = {} } = options;

  validateRepoIdentifier(identity);
  assertTokenProvider(tokenProvider);
  assertContextBoundTo(gitContext, identity, 'forgeProviders');

  if (!isIssueTrackerForge(forge.issueTracker)) {
    throw new UnknownForgeError(forge.issueTracker, 'issue tracker', ISSUE_TRACKER_FORGES);
  }
  if (!isCodeHostForge(forge.codeHost)) {
    throw new UnknownForgeError(forge.codeHost, 'code host', CODE_HOST_FORGES);
  }

  const issueTracker = buildIssueTracker(forge.issueTracker, gitContext, identity, deps);
  const codeHost = buildCodeHost(forge.codeHost, gitContext, identity, deps);
  const boardManager = buildBoardManager(forge.codeHost, gitContext, identity, deps);

  return Object.freeze({ issueTracker, codeHost, boardManager });
}
