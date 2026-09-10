/**
 * ADW's forge wiring — the environment→config reads (#818) and the GitHub
 * seams (#819) `forgeProviders()` needs but must never read itself: the
 * extractable library takes injected configuration; this module is where
 * ADW's own environment, label catalogue and Slack notification behaviour
 * live. Deep-imports `../providers/forgeProviders` — never the providers
 * barrel, which would close an import cycle back through `../../core` (#792).
 */

import type { GitContext } from '../gitContext';
import type { RepoIdentifier } from '../providers/types';
import { BoardStatus } from '../providers/types';
import type { GitLabConfig } from '../providers/gitlab/gitlabApiClient';
import type { JiraAuth } from '../providers/jira/jiraApiClient';
import type { JiraConfig } from '../providers/jira/jiraIssueTracker';
import type { ForgeProviderDeps, GitHubForgeDeps } from '../providers/forgeProviders';
import type { ProviderConfig } from './providerConfig';
import { notifyReviewTransition, buildNotifierDeps } from '../forge/hitlBoardNotifier';
import { resolveAdwLabelDefinition } from './adwLabels';
import { isGitHubAppConfigured } from './githubAppAuth';
import { GITLAB_TOKEN, GITLAB_INSTANCE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT, GITHUB_PAT } from './environment';
import { log } from './logger';

/** The GitLab/Jira variables ADW's environment supplies (#818) — a value, so the wiring below is pure and testable without mocking. */
export type ForgeEnv = Readonly<Record<'GITLAB_TOKEN' | 'GITLAB_INSTANCE_URL' | 'JIRA_EMAIL' | 'JIRA_API_TOKEN' | 'JIRA_PAT', string>>;

const ADW_FORGE_ENV: ForgeEnv = { GITLAB_TOKEN, GITLAB_INSTANCE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT };

/** ADW wiring (#818): the GitLab adapter's injected config from the environment; the operator-facing message stays here. */
export function gitLabConfigFromEnv(env: ForgeEnv = ADW_FORGE_ENV): GitLabConfig {
  if (!env.GITLAB_TOKEN) {
    throw new Error('GITLAB_TOKEN environment variable is required for GitLab code host. Set it in your .env file.');
  }
  return { token: env.GITLAB_TOKEN, instanceUrl: env.GITLAB_INSTANCE_URL };
}

/** ADW wiring (#818): Jira auth from the environment — Cloud (email + API token) first, then a Data Center PAT. */
export function jiraAuthFromEnv(env: ForgeEnv = ADW_FORGE_ENV): JiraAuth {
  if (env.JIRA_EMAIL && env.JIRA_API_TOKEN) return { email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN };
  if (env.JIRA_PAT) return { pat: env.JIRA_PAT };
  throw new Error('Jira authentication not configured. Set JIRA_EMAIL + JIRA_API_TOKEN (Cloud) or JIRA_PAT (Data Center/Server).');
}

/** ADW wiring (#823): assembles the Jira adapter's injected config from `.adw/providers.md`'s `## Issue Tracker URL` / `## Issue Tracker Project Key` sections plus the environment-derived auth. */
export function jiraConfigFrom(config: Pick<ProviderConfig, 'issueTrackerUrl' | 'issueTrackerProjectKey'>, env: ForgeEnv = ADW_FORGE_ENV): JiraConfig {
  if (!config.issueTrackerUrl) {
    throw new Error('Missing ## Issue Tracker URL section of .adw/providers.md, required for the Jira issue tracker.');
  }
  if (!config.issueTrackerProjectKey) {
    throw new Error('Missing ## Issue Tracker Project Key section of .adw/providers.md, required for the Jira issue tracker.');
  }
  return { instanceUrl: config.issueTrackerUrl, projectKey: config.issueTrackerProjectKey, auth: jiraAuthFromEnv(env) };
}

/**
 * ADW wiring: the HITL Slack ping on a move to Review, the `adw:*` lazy-create
 * catalogue, and the PR-approval capability predicate — re-homed as injected
 * seams so the adapter itself never learns about Slack, ADW's label colours,
 * or the GitHub App/PAT configuration.
 */
export function adwGitHubForgeDeps(repoId: RepoIdentifier, ctx: GitContext): GitHubForgeDeps {
  const notifierDeps = buildNotifierDeps(ctx, repoId);
  return {
    onStatusMoved: async (issueNumber, status) => {
      if (status === BoardStatus.Review) {
        await notifyReviewTransition({ issueNumber, repoInfo: repoId }, notifierDeps);
      }
    },
    resolveLabelDefinition: resolveAdwLabelDefinition,
    canApprovePullRequests: () => isGitHubAppConfigured() && Boolean(GITHUB_PAT),
  };
}

/**
 * ADW's full `ForgeProviderDeps` for a launch boundary: the logger, the
 * GitHub seams, and GitLab/Jira configuration read from the environment only
 * for a forge that is actually selected — a GitHub-only deployment never
 * touches `GITLAB_TOKEN` or the Jira variables.
 */
export function buildAdwForgeDeps(config: ProviderConfig, repoId: RepoIdentifier, ctx: GitContext): ForgeProviderDeps {
  return {
    logger: log,
    github: adwGitHubForgeDeps(repoId, ctx),
    gitlab: config.codeHost === 'gitlab' ? gitLabConfigFromEnv() : undefined,
    jira: config.issueTracker === 'jira' ? jiraConfigFrom(config) : undefined,
  };
}
