/**
 * Every row drives the real webhook dispatch, the real cron tick or a real cron process against
 * feature-796's recording boundary. The fixture repositories ("adw-fixture/…-932") do not exist,
 * so a run that escapes this harness fails fast instead of acting on a repository.
 *
 * What could leave the process is shadowed by shell scripts that write their argv to a
 * per-scenario directory and do nothing else: `bunx` (every orchestrator launch), the Claude CLI
 * (`CLAUDE_CODE_PATH`, wrapped around test/mocks/claude-cli-stub.ts) and, for the cron-process
 * rows, `gh`. No orchestrator, classifier or label call is ever real.
 *
 * feature-796's and feature-820's hooks are scoped to their own tags and do not fire here, so
 * this file resets the shared world and cleans up after itself.
 */

import { Given, Before, After } from '@cucumber/cucumber';
import * as fs from 'fs';
import * as path from 'path';

import { world796, resetWorld, seededIssueNumbers } from '../../regression/step_definitions/feature-796.steps.ts';
import type { IssueComment, RepoIdentifier } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AUTH_GATE_PATH } from '../../../adws/core/authGate.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';
import { readLocalRepoIdentity } from '../../../adws/core/localRepoIdentity.ts';
import { PAUSE_QUEUE_PATH } from '../../../adws/core/pauseQueue.ts';
import { getSpawnLockFilePath } from '../../../adws/triggers/spawnGate.ts';
import { cronPidFilePath, killRealCronWorld } from '../../regression/step_definitions/realCronProcess.ts';
import {
  installBunxShadow,
  installClaudeShadow,
  readIfExists,
  requireBoundary,
  requireFixture,
  resetLocalState,
  restoreEnv,
  restoreFile,
  s,
  staleTimestamp,
} from '../../regression/step_definitions/feature-932-world.ts';

Before({ tags: '@label-routing' }, function () {
  resetWorld();
  resetLocalState();
  installBunxShadow();

  s.savedPath = process.env['PATH'];
  s.savedClaudeCodePath = process.env['CLAUDE_CODE_PATH'];
  installClaudeShadow();

  // An unsigned payload is refused with a 401 once a secret is set, and an auth gate makes the
  // webhook and the cron ignore the event — either would turn a "no run" assertion vacuous.
  s.savedWebhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];
  delete process.env['GITHUB_WEBHOOK_SECRET'];
  s.savedAuthGate = readIfExists(AUTH_GATE_PATH);
  fs.rmSync(AUTH_GATE_PATH, { force: true });

  // The tick scans the checkout's real pause queue.
  s.savedQueueRaw = readIfExists(PAUSE_QUEUE_PATH);
  fs.rmSync(PAUSE_QUEUE_PATH, { force: true });
});

/** The spawn lock is keyed by the repository whoever takes it: evaluateCandidate by the boundary's, the cron's own release by the cron module's. */
function spawnLockIdentities(boundary: LaunchBoundary | null): RepoIdentifier[] {
  const identities = boundary ? [boundary.repoId] : [];
  try {
    return [...identities, readLocalRepoIdentity()];
  } catch {
    return identities;
  }
}

function removeSpawnLocks(issueNumbers: readonly number[], identities: readonly RepoIdentifier[]): void {
  for (const identity of identities) {
    for (const issueNumber of issueNumbers) {
      fs.rmSync(getSpawnLockFilePath(identity, issueNumber), { force: true });
    }
  }
}

After({ tags: '@label-routing' }, function () {
  killRealCronWorld(s.cron);
  for (const repoKey of s.registeredCronRepoKeys) fs.rmSync(cronPidFilePath(repoKey), { force: true });

  const w = world796();
  const issueNumbers = w.activeFixture ? seededIssueNumbers(w.activeFixture) : [];
  removeSpawnLocks(issueNumbers, spawnLockIdentities(w.boundary));
  for (const adwId of s.usedAdwIds) {
    fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
    fs.rmSync(path.join(LOGS_DIR, adwId), { recursive: true, force: true });
  }
  for (const dir of [...w.tempDirs, s.dir, s.cronTargetReposDir]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }

  restoreEnv('PATH', s.savedPath);
  restoreEnv('CLAUDE_CODE_PATH', s.savedClaudeCodePath);
  clearClaudeCodePathCache();
  restoreEnv('GITHUB_WEBHOOK_SECRET', s.savedWebhookSecret);
  restoreFile(AUTH_GATE_PATH, s.savedAuthGate);
  restoreFile(PAUSE_QUEUE_PATH, s.savedQueueRaw);
  resetWorld();
});

Given(
  'issue {int} in the recording tracker carries the labels {string}, {string} and {string}',
  function (issueNumber: number, first: string, second: string, third: string) {
    requireFixture().issueLabels.set(issueNumber, [first, second, third]);
  },
);

Given('issue {int} in the recording tracker is in state {string}', function (issueNumber: number, state: string) {
  requireFixture().issueStates.set(issueNumber, state);
});

Given('the body of issue {int} in the recording tracker reads:', function (issueNumber: number, body: string) {
  requireFixture().issueBodies.set(issueNumber, body);
});

Given(
  'issue {int} has an earlier ADW workflow under adw id {string} recorded at workflowStage {string} running {string}',
  function (issueNumber: number, adwId: string, workflowStage: string, orchestratorScript: string) {
    const fixture = requireFixture();
    const { repoId } = requireBoundary();
    const comment: IssueComment = {
      id: `adw-id-comment-${adwId}`,
      body: `**ADW ID:** \`${adwId}\``,
      author: 'adw-bot[bot]',
      createdAt: staleTimestamp(),
    };
    fixture.issueComments.set(issueNumber, [...(fixture.issueComments.get(issueNumber) ?? []), comment]);
    s.usedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      issueNumber,
      workflowStage,
      orchestratorScript,
      repoIdentity: { owner: repoId.owner, repo: repoId.repo },
    });
  },
);
