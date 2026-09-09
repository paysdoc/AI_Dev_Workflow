/**
 * Webhook per-event repo identity resolution.
 *
 * Extracted from trigger_webhook.ts so the per-event boundary is testable
 * without triggering the webhook server's module-level side effects
 * (HTTP server creation). Mirrors cronRepoResolver.ts.
 */

import type { TargetRepoInfo } from '../types/issueTypes';
import { Platform, type RepoIdentifier } from '../providers/types';

/** Resolution result for a webhook event payload. */
export interface WebhookRepoResolution {
  repoInfo: RepoIdentifier;
  targetRepo: TargetRepoInfo;
  targetRepoArgs: string[];
}

/**
 * Parses owner and repo from a GitHub repository full name (e.g., "owner/repo").
 * The one place this parse survives `githubApi.ts`'s deletion (#821) — it runs
 * upstream of any provider, deciding which repository the per-event boundary
 * will be built for, so it cannot itself be migrated onto one.
 */
function parseRepoFullName(repoFullName: string): RepoIdentifier {
  const parts = repoFullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository full name: ${repoFullName}`);
  }
  return { owner: parts[0], repo: parts[1], platform: Platform.GitHub };
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

  const repoInfo = parseRepoFullName(fullName);
  const targetRepo: TargetRepoInfo = { owner: repoInfo.owner, repo: repoInfo.repo, cloneUrl };
  const targetRepoArgs = ['--target-repo', fullName, '--clone-url', cloneUrl];

  return { repoInfo, targetRepo, targetRepoArgs };
}
