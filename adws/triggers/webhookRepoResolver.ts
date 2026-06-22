/**
 * Webhook per-event repo identity resolution.
 *
 * Extracted from trigger_webhook.ts so the per-event boundary is testable
 * without triggering the webhook server's module-level side effects
 * (HTTP server creation). Mirrors cronRepoResolver.ts.
 */

import type { RepoInfo } from '../github/githubApi';
import { getRepoInfoFromPayload } from '../github/githubApi';
import type { TargetRepoInfo } from '../types/issueTypes';

/** Resolution result for a webhook event payload. */
export interface WebhookRepoResolution {
  repoInfo: RepoInfo;
  targetRepo: TargetRepoInfo;
  targetRepoArgs: string[];
}

/**
 * Resolves the repo identity from a raw webhook event body.
 * Returns null when the payload carries no usable repository.
 * Pure: no I/O, no env access, no side effects.
 */
export function resolveWebhookRepo(body: Record<string, unknown>): WebhookRepoResolution | null {
  const repository = body.repository as Record<string, unknown> | undefined;
  if (!repository) return null;

  const fullName = repository.full_name as string | undefined;
  const cloneUrl = (repository.clone_url ?? repository.html_url) as string | undefined;
  if (!fullName || !cloneUrl) return null;

  const repoInfo = getRepoInfoFromPayload(fullName);
  const targetRepo: TargetRepoInfo = { owner: repoInfo.owner, repo: repoInfo.repo, cloneUrl };
  const targetRepoArgs = ['--target-repo', fullName, '--clone-url', cloneUrl];

  return { repoInfo, targetRepo, targetRepoArgs };
}
