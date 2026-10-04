import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import { FixLoopStall } from '../../core/staticCheckFixLoop';
import { ParkReason, buildParkComment, type ParkEvidence } from '../../forge/parkComment';
import { decideRetryAction } from '../../triggers/retryHandler';
import { parkWorkflow } from '../workflowPark';
import type { WorkflowConfig } from '../workflowInit';

class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

const EVIDENCE: ParkEvidence = {
  reason: ParkReason.FixLoopStalled,
  failedChecks: [{ check: 'lint', command: 'bun run lint', exitCode: 1, output: 'src/app.ts: 1 problem\n' }],
  stall: FixLoopStall.IdenticalOutput,
  rounds: 2,
  rejections: [],
};

const adwId = `park-test-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const tempDirs: string[] = [];

type ParkConfig = Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorStatePath' | 'repoContext'>;

function makeConfig(commentOnIssue: ((issueNumber: number, body: string) => void) | null = vi.fn()): ParkConfig {
  const orchestratorStatePath = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-park-state-'));
  tempDirs.push(orchestratorStatePath);
  return {
    adwId,
    issueNumber: 989,
    orchestratorStatePath,
    repoContext: commentOnIssue ? ({ issueTracker: { commentOnIssue } } as unknown as WorkflowConfig['repoContext']) : undefined,
  };
}

function park(config: ParkConfig, evidence: ParkEvidence = EVIDENCE): void {
  expect(() => parkWorkflow(config, evidence)).toThrow(ExitSignal);
}

function executionLog(config: ParkConfig): string {
  return fs.readFileSync(path.join(config.orchestratorStatePath, 'execution.log'), 'utf-8');
}

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitSignal(code);
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
  tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

describe('parkWorkflow', () => {
  it('writes human_gated as the top-level workflow stage', () => {
    park(makeConfig());

    expect(AgentStateManager.readTopLevelState(adwId)?.workflowStage).toBe('human_gated');
  });

  it('keeps what the top-level state already holds', () => {
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 989, workflowStage: 'test_running' });

    park(makeConfig());

    expect(AgentStateManager.readTopLevelState(adwId)).toMatchObject({ adwId, issueNumber: 989, workflowStage: 'human_gated' });
  });

  it('posts exactly the park comment of the evidence on the issue', () => {
    const commentOnIssue = vi.fn();

    park(makeConfig(commentOnIssue));

    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    expect(commentOnIssue).toHaveBeenCalledWith(989, buildParkComment(adwId, EVIDENCE));
  });

  it('has written the stage by the time the comment is posted', () => {
    const stageAtPost: Array<string | undefined> = [];
    const commentOnIssue = vi.fn(() => {
      stageAtPost.push(AgentStateManager.readTopLevelState(adwId)?.workflowStage);
    });

    park(makeConfig(commentOnIssue));

    expect(stageAtPost).toEqual(['human_gated']);
  });

  it('appends a line to the execution log that names the reason', () => {
    const config = makeConfig();

    park(config);

    expect(executionLog(config)).toContain('human_gated');
    expect(executionLog(config)).toContain(ParkReason.FixLoopStalled);
  });

  it('ends the process with exit code 0, since a park is not a failure', () => {
    park(makeConfig());

    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('exits after the comment is posted', () => {
    const order: string[] = [];
    const commentOnIssue = vi.fn(() => { order.push('comment'); });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      order.push('exit');
      throw new ExitSignal(code);
    });

    park(makeConfig(commentOnIssue));

    expect(order).toEqual(['comment', 'exit']);
  });

  it('logs a comment that cannot be posted, and still parks and exits', () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });
    const config = makeConfig(() => { throw new Error('HTTP 502 from the forge'); });

    park(config);

    expect(AgentStateManager.readTopLevelState(adwId)?.workflowStage).toBe('human_gated');
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(logged.join('\n')).toContain('HTTP 502 from the forge');
  });

  it('parks without a comment when there is no repository context', () => {
    park(makeConfig(null));

    expect(AgentStateManager.readTopLevelState(adwId)?.workflowStage).toBe('human_gated');
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('parks for every reason the builder knows', () => {
    const reasons: ParkEvidence[] = [
      { reason: ParkReason.BaselineRed, baseBranch: 'trunk', failedChecks: [] },
      { reason: ParkReason.PreExistingRegression, baseBranch: 'trunk', scenario: 'A scenario' },
      { reason: ParkReason.MissingApplicationType, found: null },
      { reason: ParkReason.BaseServerDown, baseBranch: 'trunk', output: 'EADDRINUSE' },
    ];

    reasons.forEach((evidence) => {
      const commentOnIssue = vi.fn();
      park(makeConfig(commentOnIssue), evidence);
      expect(commentOnIssue).toHaveBeenCalledWith(989, buildParkComment(adwId, evidence));
    });
  });

  it('leaves the workflow in a stage that "## Retry" re-arms to phase_timeout', () => {
    park(makeConfig());

    const stage = AgentStateManager.readTopLevelState(adwId)?.workflowStage;
    expect(decideRetryAction(stage)).toEqual({ kind: 'rearm_phase_timeout', from: 'human_gated' });
  });
});
