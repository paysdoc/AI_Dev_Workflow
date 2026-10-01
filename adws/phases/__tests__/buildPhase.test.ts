import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents')>();
  return {
    ...actual,
    runBuildAgent: vi.fn(),
    runCommitAgent: vi.fn(),
    getPlanFilePath: vi.fn(() => 'plan.md'),
  };
});

import { executeBuildPhase } from '../buildPhase';
import { runBuildAgent, runCommitAgent } from '../../agents';
import type { WorkflowConfig } from '../workflowInit';

const PLAN_TEXT = '# Plan\n\nImplement the change.';

const mockRunBuildAgent = vi.mocked(runBuildAgent);
const mockRunCommitAgent = vi.mocked(runCommitAgent);

let tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(): WorkflowConfig {
  const worktreePath = makeTempDir('adw-build-worktree-');
  fs.writeFileSync(path.join(worktreePath, 'plan.md'), PLAN_TEXT);
  return {
    issueNumber: 929,
    adwId: 'build929-test',
    issue: { number: 929, title: 'bug', body: '', url: 'https://example.test/issues/929' },
    issueType: '/bug',
    worktreePath,
    defaultBranch: 'dev',
    logsDir: makeTempDir('adw-build-logs-'),
    orchestratorStatePath: makeTempDir('adw-build-state-'),
    orchestratorName: 'orchestrator',
    recoveryState: { canResume: false, lastCompletedStage: null, adwId: null, branchName: null, planPath: null, prUrl: null },
    ctx: { issueNumber: 929, adwId: 'build929-test' },
    repoContext: undefined,
    gitContext: { getHeadTreeHash: () => 'tree-a', hasUncommittedChanges: () => false, commandEnv: () => ({}) },
  } as unknown as WorkflowConfig;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRunCommitAgent.mockResolvedValue({ success: true, output: 'committed', commitMessage: 'build-agent: fix: done' });
});

afterEach(() => {
  tempDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
  tempDirs = [];
});

describe('executeBuildPhase — context compaction', () => {
  it('asks for the kill on every build agent run, and restarts the agent with a fresh continuation context', async () => {
    mockRunBuildAgent
      .mockResolvedValueOnce({ success: true, compactionDetected: true, output: 'partial' })
      .mockResolvedValueOnce({ success: true, output: 'done' });

    await executeBuildPhase(makeConfig());

    expect(mockRunBuildAgent).toHaveBeenCalledTimes(2);
    for (const call of mockRunBuildAgent.mock.calls) {
      expect(call[8]).toBe(true);
    }
    const restartedPlan = mockRunBuildAgent.mock.calls[1][2];
    expect(restartedPlan).toContain(PLAN_TEXT);
    expect(restartedPlan).toContain('## Continuation Context');
  });
});
