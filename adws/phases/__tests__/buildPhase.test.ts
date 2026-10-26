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
import { BUILD_COMPLETE_MARKER } from '../progressGate';
import { runBuildAgent, runCommitAgent } from '../../agents';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR, MAX_CONTEXT_RESETS, MAX_PROGRESS_CHECKPOINTS } from '../../core/config';
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

function recordingConfig(gitContext: Record<string, unknown> = {}): { config: WorkflowConfig; comments: () => string } {
  const commentOnIssue = vi.fn();
  const repoContext = { issueTracker: { commentOnIssue, moveToStatus: vi.fn().mockResolvedValue(true) } } as unknown as WorkflowConfig['repoContext'];
  const stubGitContext = { getHeadTreeHash: () => 'tree-a', hasUncommittedChanges: () => false, commandEnv: () => ({}), ...gitContext };
  const config = makeConfig({ repoContext, gitContext: stubGitContext as unknown as WorkflowConfig['gitContext'] });
  return { config, comments: () => commentOnIssue.mock.calls.map(([, body]) => String(body)).join('\n') };
}

function newTreeOnEveryRead(): () => string {
  let reads = 0;
  return () => `tree-${reads++}`;
}

function stoppedAtTokenLimit(output: string) {
  return { success: true, tokenLimitExceeded: true, output };
}

describe('executeBuildPhase — a stopped agent that reported completion', () => {
  beforeEach(() => {
    mockRunBuildAgent.mockReset();
  });

  it('ends the build without another context when a run stopped at the token limit reports completion', async () => {
    mockRunBuildAgent.mockResolvedValueOnce(stoppedAtTokenLimit(`Every plan step is committed and every validation command passes.\n${BUILD_COMPLETE_MARKER}\n`));
    const { config, comments } = recordingConfig();

    await executeBuildPhase(config);

    expect(mockRunBuildAgent).toHaveBeenCalledTimes(1);
    expect(comments()).not.toContain('Token Limit Recovery');
    expect(comments()).toContain('Build Completed');
  });

  it('ends the build at the run that reports completion, although a tree that keeps changing would have run on to the backstop', async () => {
    mockRunBuildAgent
      .mockResolvedValueOnce(stoppedAtTokenLimit('Committed the last plan step.'))
      .mockResolvedValueOnce(stoppedAtTokenLimit(`Every step is done and validations pass.\n${BUILD_COMPLETE_MARKER}\nSplitting the callbacks into helpers…`));
    const { config, comments } = recordingConfig({ getHeadTreeHash: newTreeOnEveryRead(), hasUncommittedChanges: () => true });

    await executeBuildPhase(config);

    expect(mockRunBuildAgent).toHaveBeenCalledTimes(2);
    expect(mockRunBuildAgent.mock.calls[1][2]).toContain('## Completion Check');
    expect(mockRunCommitAgent).toHaveBeenCalledTimes(2);
    expect(comments().match(/Token Limit Recovery/g)).toHaveLength(1);
  });

  it('ends the build at once when a compaction stops the run that reports completion', async () => {
    mockRunBuildAgent.mockResolvedValueOnce({ success: true, compactionDetected: true, output: `All steps done.\n${BUILD_COMPLETE_MARKER}` });
    const { config, comments } = recordingConfig();

    await executeBuildPhase(config);

    expect(mockRunBuildAgent).toHaveBeenCalledTimes(1);
    expect(comments()).not.toContain('Context Compaction Recovery');
    expect(comments()).toContain('Build Completed');
  });

  it('does not abort a finished build as no_progress when the runs that stopped only verified', async () => {
    const isLastRunOfTheBatch = () => mockRunBuildAgent.mock.calls.length === MAX_CONTEXT_RESETS;
    mockRunBuildAgent.mockImplementation(async () => stoppedAtTokenLimit(isLastRunOfTheBatch() ? `Verified.\n${BUILD_COMPLETE_MARKER}` : 'Verified the plan.'));

    await executeBuildPhase(recordingConfig().config);

    expect(mockRunBuildAgent).toHaveBeenCalledTimes(MAX_CONTEXT_RESETS);
  });

  it('still restarts the agent when a stopped run only mentions the marker in a sentence', async () => {
    mockRunBuildAgent
      .mockResolvedValueOnce(stoppedAtTokenLimit(`I will print ${BUILD_COMPLETE_MARKER} once every step is done.`))
      .mockResolvedValueOnce({ success: true, output: 'done' });

    await executeBuildPhase(recordingConfig().config);

    expect(mockRunBuildAgent).toHaveBeenCalledTimes(2);
  });

  it('still restarts the agent, with the completion check in its prompt, when a stopped run does not report completion', async () => {
    mockRunBuildAgent
      .mockResolvedValueOnce(stoppedAtTokenLimit('partial'))
      .mockResolvedValueOnce({ success: true, output: 'done' });

    await executeBuildPhase(recordingConfig().config);

    expect(mockRunBuildAgent).toHaveBeenCalledTimes(2);
    expect(mockRunBuildAgent.mock.calls[1][2]).toContain('## Completion Check');
  });
});

describe('executeBuildPhase — progress gate on incomplete builds', () => {
  beforeEach(() => {
    mockRunBuildAgent.mockReset();
    mockRunBuildAgent.mockResolvedValue(stoppedAtTokenLimit('Still working.'));
  });

  it('aborts as no_progress once the batch ends on a tree the build has already seen', async () => {
    await expect(executeBuildPhase(recordingConfig().config)).rejects.toThrow(/no progress/i);

    expect(mockRunBuildAgent).toHaveBeenCalledTimes(MAX_CONTEXT_RESETS);
  });

  it('aborts at the checkpoint backstop when every batch ends on a new tree', async () => {
    await expect(executeBuildPhase(recordingConfig({ getHeadTreeHash: newTreeOnEveryRead() }).config)).rejects.toThrow(/checkpoint backstop/i);

    expect(mockRunBuildAgent).toHaveBeenCalledTimes(MAX_CONTEXT_RESETS * (MAX_PROGRESS_CHECKPOINTS + 1));
  });
});
