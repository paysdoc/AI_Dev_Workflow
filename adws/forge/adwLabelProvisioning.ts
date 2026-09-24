/**
 * The pure label vocabulary lives in adws/core/adwLabels.ts;
 * `IssueTracker.ensureLabel`/`applyLabel` are their own exact bodies and are
 * not relocated here.
 */

import { log } from '../core/logger';
import type { Logger } from '@paysdoc/devplatform/git';
import { ADW_LABEL_DEFINITIONS } from '../core/adwLabels';
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
