/**
 * The pure label vocabulary lives in adws/core/adwLabels.ts;
 * `IssueTracker.ensureLabel`/`applyLabel` are their own exact bodies and are
 * not relocated here.
 */

import { log } from '../core/logger';
import type { Logger } from '@paysdoc/devplatform/git';
import { ADW_LABEL_DEFINITIONS } from '../core/adwLabels';
import type { LaunchBoundary } from '../core/launchGitContext';
import type { IssueTracker, RepoIdentifier } from '@paysdoc/devplatform';

/**
 * A single label's failure does not abort provisioning of the rest.
 */
export function ensureAdwLabelsExist(
  repoInfo: RepoIdentifier,
  tracker: Pick<IssueTracker, 'ensureLabel'>,
  logger: Logger = log,
): void {
  let succeeded = 0;
  for (const def of ADW_LABEL_DEFINITIONS) {
    try {
      tracker.ensureLabel(def.name, def.color, def.description);
      succeeded++;
    } catch (error) {
      logger(`ensureAdwLabelsExist: failed to create label "${def.name}": ${error}`, 'warn');
    }
  }
  logger(
    `ensureAdwLabelsExist: ensured ${succeeded}/${ADW_LABEL_DEFINITIONS.length} adw:* labels on ${repoInfo.owner}/${repoInfo.repo}`,
    'info',
  );
}

/** Never throws: an issue tracker that cannot be minted is logged like a failed label. */
export function provisionAdwLabels(
  boundary: Pick<LaunchBoundary, 'repoId' | 'providers'>,
  logger: Logger = log,
): void {
  try {
    ensureAdwLabelsExist(boundary.repoId, boundary.providers.issueTracker, logger);
  } catch (error) {
    logger(`provisionAdwLabels: no issue tracker for ${boundary.repoId.owner}/${boundary.repoId.repo}: ${error}`, 'warn');
  }
}
