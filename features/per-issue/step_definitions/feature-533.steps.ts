import { Before, After, When } from '@cucumber/cucumber';
import { existsSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

export const invocationLogs = new Map<string, string>();

export const tempDirs: string[] = [];

Before({ tags: '@adw-533' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  invocationLogs.clear();
  tempDirs.length = 0;
});

After({ tags: '@adw-533' }, async function (this: RegressionWorld) {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  for (const [, worktreePath] of this.worktreePaths) {
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  await teardownMockInfrastructure();
  this.mockContext = null;
  this.worktreePaths.clear();
  this.prsByBranch.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
  invocationLogs.clear();
  tempDirs.length = 0;
});

export function ensureInvocationLog(world: RegressionWorld, adwId: string): string {
  const existing = invocationLogs.get(adwId);
  if (existing) return existing;

  const logDir = mkdtempSync(join(tmpdir(), `adw-inv-${adwId}-`));
  tempDirs.push(logDir);
  const logPath = join(logDir, 'invocations.log');
  writeFileSync(logPath, '', 'utf-8');
  invocationLogs.set(adwId, logPath);
  world.harnessEnv = { ...world.harnessEnv, MOCK_INVOCATION_LOG: logPath };
  return logPath;
}

export function readInvocations(adwId: string): string[] {
  const logPath = invocationLogs.get(adwId);
  if (!logPath || !existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
}

export function buildReviewPayload(
  issues: Array<{
    reviewIssueNumber: number;
    issueDescription: string;
    issueResolution: string;
    issueSeverity: string;
    remediationStrategy?: string;
  }>,
  success: boolean,
): string {
  const reviewResult = {
    success,
    reviewSummary: success ? 'Review passed.' : `Review found ${issues.length} blocker(s).`,
    reviewIssues: issues,
    screenshots: [],
  };
  return JSON.stringify(reviewResult);
}

export function seedReviewPayload(world: RegressionWorld, adwId: string, payloadText: string): void {
  const worktreePath = world.worktreePaths.get(adwId);
  assert.ok(worktreePath, `No worktree found for adwId "${adwId}". Did G11 run?`);
  const payloadContent = JSON.stringify([{ type: 'text', text: payloadText }]) + '\n';
  writeFileSync(join(worktreePath, '.adw-stub-payload.json'), payloadContent, 'utf-8');
  world.harnessEnv = {
    ...world.harnessEnv,
    MOCK_FIXTURE_PATH: join(worktreePath, '.adw-stub-payload.json'),
  };
}

When(
  'the {string} orchestrator is invoked with adwId {string} and PR {int}',
  function (this: RegressionWorld, _orchestratorName: string, _adwId: string, _prNumber: number) {
    // mockContext is set (Before hook runs) → pending until CUTOVER.
    if (this.mockContext !== null) return 'pending';
  },
);
