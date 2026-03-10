/**
 * Factory for creating a RepoContext from provider configuration.
 * Maps ProvidersConfig values to the correct provider implementations.
 */

import type { ProvidersConfig } from '../core/projectConfig';
import type { RepoContext, RepoIdentifier, IssueTracker, CodeHost } from './types';
import { createGitHubIssueTracker } from './github/githubIssueTracker';
import { createGitHubCodeHost } from './github/githubCodeHost';
import { createJiraIssueTracker } from './jira/jiraIssueTracker';

/**
 * Creates a RepoContext by instantiating the correct provider implementations
 * based on the given ProvidersConfig.
 *
 * @param config - Provider configuration from `.adw/providers.md`
 * @param repoId - Repository identifier for the target repo
 * @param cwd - Working directory for the target repo
 * @returns A fully constructed RepoContext
 * @throws Error if an unsupported provider is requested or required fields are missing
 */
export function createRepoContext(
  config: ProvidersConfig,
  repoId: RepoIdentifier,
  cwd: string,
): RepoContext {
  const issueTracker = buildIssueTracker(config, repoId);
  const codeHost = buildCodeHost(config, repoId);

  return { issueTracker, codeHost, cwd, repoId };
}

function buildIssueTracker(config: ProvidersConfig, repoId: RepoIdentifier): IssueTracker {
  switch (config.issueTracker) {
    case 'github':
      return createGitHubIssueTracker(repoId);

    case 'jira':
      if (!config.issueTrackerUrl) {
        throw new Error('Jira issue tracker requires "Issue Tracker URL" to be set in .adw/providers.md');
      }
      if (!config.issueTrackerProjectKey) {
        throw new Error('Jira issue tracker requires "Issue Tracker Project Key" to be set in .adw/providers.md');
      }
      return createJiraIssueTracker(config.issueTrackerUrl, config.issueTrackerProjectKey);

    default:
      throw new Error(`Unsupported issue tracker provider: "${config.issueTracker}"`);
  }
}

function buildCodeHost(config: ProvidersConfig, repoId: RepoIdentifier): CodeHost {
  switch (config.codeHost) {
    case 'github':
      return createGitHubCodeHost(repoId);

    default:
      throw new Error(`Unsupported code host provider: "${config.codeHost}"`);
  }
}
