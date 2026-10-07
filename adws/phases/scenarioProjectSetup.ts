import { RunnerMode } from '../core/applicationType';
import { ADW_PLAYWRIGHT_SETUP_COMMAND, syncAdwPlaywrightProject, type ProjectFileOutcome } from '../core/adwPlaywrightProject';
import { runShellCommand, type ProcessRunner } from '../core/checkRunner';
import { loadProjectConfig } from '../core/projectConfig';
import { declaredApplicationProfile } from './applicationTypeGate';

export type ScenarioProjectSyncResult =
  | { readonly kind: 'synced'; readonly files: readonly ProjectFileOutcome[] }
  | { readonly kind: 'not_applicable' };

/**
 * Reads the type the regenerated `.adw/project.md` declares and, when it runs its scenarios on ADW's Playwright project,
 * writes that project's files from the framework's templates and installs it. A type ADW does not know is left to the
 * gate that parks the workflow, not to the upgrade.
 */
export async function syncDeclaredScenarioProject(
  worktreePath: string,
  frameworkRepoRoot: string,
  runProcess: ProcessRunner = runShellCommand,
): Promise<ScenarioProjectSyncResult> {
  const profile = declaredApplicationProfile(loadProjectConfig(worktreePath));
  if (profile?.runnerMode !== RunnerMode.AdwPlaywright) return { kind: 'not_applicable' };

  const files = syncAdwPlaywrightProject(worktreePath, frameworkRepoRoot);

  // Every worktree's `npm ci` installs from the features/package-lock.json this writes, so the regen commit must carry that file whatever the agent did.
  const { exitCode, output } = await runProcess(ADW_PLAYWRIGHT_SETUP_COMMAND, worktreePath);
  if (exitCode !== 0) {
    throw new Error(`${ADW_PLAYWRIGHT_SETUP_COMMAND} exited ${exitCode ?? 'without a code'}:\n${output}`);
  }
  return { kind: 'synced', files };
}
