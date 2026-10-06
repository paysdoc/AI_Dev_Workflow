/**
 * Hooks for feature-959, scoped to OWN_ROWS, the tag only that feature carries: the flagged
 * feature-908 and feature-912 rows run under their own harness.
 *
 * `mockContext` is initialised here because the shared T1 and T5 phrases fall into a legacy
 * source-inspection branch when it is null. The tick scans the checkout's real pause queue and
 * returns early under an auth gate, so both are saved, removed and restored around each row. The
 * spawn locks the rows leave under this process's pid, the processes that stand in for
 * orchestrators, and the PR review a row runs in this process are removed or ended in `After`: a
 * lock left behind would spoil later rows.
 */

import { Before, After } from '@cucumber/cucumber';
import * as fs from 'fs';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { releaseHeldSpawnLocks } from '../../regression/step_definitions/feature-911.steps.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { AUTH_GATE_PATH } from '../../../adws/core/authGate.ts';
import { resetLogAdwId } from '../../../adws/core/logger.ts';
import { PAUSE_QUEUE_PATH } from '../../../adws/core/pauseQueue.ts';
import { world796, resetWorld } from './feature-796.steps.ts';
import { installBunxShadow, readIfExists, resetLocalState, restoreFile, s as world932 } from './feature-932-world.ts';
import { removeSpawnLocks } from './feature-959-boundary.ts';
import { killOrchestratorProcess } from './feature-959-processes.ts';
import { OWN_ROWS, removeScenarioArtefacts, resetState, s } from './feature-959-world.ts';

Before({ tags: OWN_ROWS }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  resetWorld();
  resetLocalState();
  installBunxShadow();
  resetState();

  s.savedQueueRaw = readIfExists(PAUSE_QUEUE_PATH);
  fs.rmSync(PAUSE_QUEUE_PATH, { force: true });
  s.savedAuthGate = readIfExists(AUTH_GATE_PATH);
  fs.rmSync(AUTH_GATE_PATH, { force: true });
});

After({ tags: OWN_ROWS }, async function (this: RegressionWorld) {
  await Promise.all(s.processes.map(killOrchestratorProcess));
  // Ends the PR review's lifecycle: the heartbeat stops and its lock is released before the state files go.
  // A lifecycle that rejected has failed its step already; it must not stop the cleanup below.
  s.releasePrReview?.();
  await s.prReview?.catch(() => false);
  resetLogAdwId();
  releaseHeldSpawnLocks();
  removeSpawnLocks();
  removeScenarioArtefacts();
  for (const dir of [...world796().tempDirs, world932.dir]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }

  restoreFile(AUTH_GATE_PATH, s.savedAuthGate);
  restoreFile(PAUSE_QUEUE_PATH, s.savedQueueRaw);
  resetWorld();
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  resetState();
});
