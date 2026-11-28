import * as path from 'path';
import { parseScenariosMd, readScenariosMd } from '../core/projectConfig.ts';
import { readFeatureFiles } from '../proof/featureFileReader.ts';
import type { FeatureFileSource } from '../proof/featureScenarioIndex.ts';

/**
 * Reads the directory that the checkout's own `.adw/scenarios.md` declares under `## Per-Issue Scenario Directory`, never the
 * `## Scenario Directory` fallback: a target without per-issue scenarios nominates nothing.
 *
 * @param checkoutPath - A checkout of the default branch, such as a worktree synced to `origin/<default>`.
 * @returns Each `.feature` file below that directory with its repo-relative path; [] without the section or the directory.
 */
export function readPerIssueScenarioFiles(checkoutPath: string): readonly FeatureFileSource[] {
  const directory = parseScenariosMd(readScenariosMd(checkoutPath)).perIssueScenarioDirectory;
  if (directory === undefined) return [];
  return readFeatureFiles(path.resolve(checkoutPath, directory)).map((file) => ({ ...file, path: path.posix.join(directory, file.path) }));
}
