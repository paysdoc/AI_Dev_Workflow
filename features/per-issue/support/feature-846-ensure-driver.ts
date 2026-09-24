/**
 * `TARGET_REPOS_DIR` (adws/core/environment.ts) is bound at import time, so
 * driving `ensureTargetRepoWorkspace` in-process from the step definitions
 * would clone into the real `~/.adw/repos` on the host running the suite
 * rather than the scenario's temporary target-repos root. This script is
 * spawned as a child instead, with `HOME`/`TARGET_REPOS_DIR` overridden in
 * its env. It lives under `features/per-issue/support/`, outside every
 * `cucumber.js` `import` glob, so it is never auto-loaded as a step
 * definition module.
 *
 * Usage: bunx tsx feature-846-ensure-driver.ts <owner> <repo> <cloneUrl>
 * Prints `{"workspacePath": "..."}` as the last line of stdout — preceding
 * lines may carry `ensureTargetRepoWorkspace`'s own info/warn log output.
 */

import { ensureTargetRepoWorkspace } from '../../../adws/core/targetRepoManager.ts';
import type { TargetRepoInfo } from '../../../adws/types/issueTypes.ts';

const [owner, repo, cloneUrl] = process.argv.slice(2);

const targetRepo: TargetRepoInfo = { owner, repo, cloneUrl };
const workspacePath = ensureTargetRepoWorkspace(targetRepo, () => 'main');

process.stdout.write(JSON.stringify({ workspacePath }));
