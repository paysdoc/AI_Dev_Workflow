import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
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
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import type { RecoveryState } from '../../types/workflowTypes';
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

function makeConfig(overrides: Partial<WorkflowConfig> = {}, { withPlan = true }: { withPlan?: boolean } = {}): WorkflowConfig {
  const worktreePath = makeTempDir('adw-build-worktree-');
  if (withPlan) fs.writeFileSync(path.join(worktreePath, 'plan.md'), PLAN_TEXT);
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
    ...overrides,
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

class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

describe('executeBuildPhase — a plan lost with the worktree', () => {
  const adwId = `build-lost-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const PLAN_PATH = `specs/issue-929-adw-${adwId}-sdlc_planner-fix.md`;
  const PARK_HEADING = '## :raised_hand: ADW Parked — The Plan Was Lost with the Worktree';

  let commentOnIssue: ReturnType<typeof vi.fn>;
  let exitSpy: MockInstance;
  let logSpy: MockInstance;

  function resumedAfter(lastCompletedStage: NonNullable<RecoveryState['lastCompletedStage']>): RecoveryState {
    return { canResume: true, lastCompletedStage, adwId, branchName: 'feature-issue-929-lost', planPath: PLAN_PATH, prUrl: null };
  }

  function lostPlanConfig(recoveryState: RecoveryState | undefined, withPlan = false): WorkflowConfig {
    commentOnIssue = vi.fn();
    const repoContext = { issueTracker: { commentOnIssue, moveToStatus: vi.fn().mockResolvedValue(true) } } as unknown as WorkflowConfig['repoContext'];
    return makeConfig({ adwId, repoContext, ...(recoveryState ? { recoveryState } : {}) }, { withPlan });
  }

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
  });

  it('parks as worktree_lost and ends the process with exit code 0 on a resume after the build started, when the worktree holds no plan', async () => {
    await expect(executeBuildPhase(lostPlanConfig(resumedAfter('build_running')))).rejects.toBeInstanceOf(ExitSignal);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(AgentStateManager.readTopLevelState(adwId)).toMatchObject({ workflowStage: 'worktree_lost', parkReason: 'worktree_lost' });
  });

  it('does not start the build agent, and posts only the park comment: no "Running Build"', async () => {
    await expect(executeBuildPhase(lostPlanConfig(resumedAfter('build_running')))).rejects.toBeInstanceOf(ExitSignal);

    expect(mockRunBuildAgent).not.toHaveBeenCalled();
    expect(mockRunCommitAgent).not.toHaveBeenCalled();
    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    const body = String(commentOnIssue.mock.calls[0][1]);
    expect(body.startsWith(PARK_HEADING)).toBe(true);
    expect(body).toContain('The `build` phase');
    expect(body).toContain(`\`${PLAN_PATH}\``);
  });

  it('still fails with an error naming the plan file on a fresh run, and does not park', async () => {
    await expect(executeBuildPhase(lostPlanConfig(undefined))).rejects.toThrow('Cannot read plan file');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(commentOnIssue).not.toHaveBeenCalled();
    expect(AgentStateManager.readTopLevelState(adwId)).toBeNull();
  });

  it('still fails with an error naming the plan file on a resume before the plan was created, and does not park', async () => {
    await expect(executeBuildPhase(lostPlanConfig(resumedAfter('plan_building')))).rejects.toThrow('Cannot read plan file');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(AgentStateManager.readTopLevelState(adwId)).toBeNull();
  });

  it('builds as before on a resume when the plan is in the worktree, and does not park', async () => {
    mockRunBuildAgent.mockResolvedValue({ success: true, output: 'done' });

    await executeBuildPhase(lostPlanConfig(resumedAfter('build_running'), true));

    expect(exitSpy).not.toHaveBeenCalled();
    expect(mockRunBuildAgent).toHaveBeenCalledTimes(1);
    expect(commentOnIssue.mock.calls.map(([, body]) => String(body)).join('\n')).not.toContain(PARK_HEADING);
    expect(AgentStateManager.readTopLevelState(adwId)).toBeNull();
  });
});
