import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import { BaselineStatus, type BaselineRecord } from '../../core/baselineGate';
import { BaseScenarioOutcome, type FailingScenario, type ScenarioRerun } from '../../core/regressionTriage';
import type { TestCaseResult } from '../../core/testReportParser';
import { ParkReason, buildParkComment, parkDirectives } from '../../forge/parkComment';
import { createPreExistingRegressionGate, failingRegressionScenarios } from '../preExistingRegressionGate';
import type { ScenarioProofResult, TagProofResult } from '../scenarioProof';
import type { WorkflowConfig } from '../workflowInit';

class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

const ADW_ID = `pre-existing-gate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const BASE_BRANCH = 'trunk';
const FEATURE = 'Alpha';
const tempDirs: string[] = [];

const PASSED_BASELINE: BaselineRecord = { status: BaselineStatus.Passed, baseBranch: BASE_BRANCH, baseCommit: 'abc1234', recordedAt: '2026-10-04T10:00:00.000Z' };
const WAIVED_BASELINE: BaselineRecord = { status: BaselineStatus.Waived, waivedPark: 'baseline_red', recordedAt: '2026-10-04T10:00:00.000Z' };

function testCase(name: string, status: TestCaseResult['status'], classname: string | null = FEATURE): TestCaseResult {
  return { name, status, ...(classname === null ? {} : { classname }) };
}

function tagResult(resolvedTag: string, overrides: Partial<TagProofResult> = {}): TagProofResult {
  return { tag: resolvedTag, resolvedTag, severity: 'blocker', optional: false, passed: true, output: '', exitCode: 0, skipped: false, ...overrides };
}

function proofOf(...tagResults: TagProofResult[]): ScenarioProofResult {
  return {
    tagResults,
    hasBlockerFailures: tagResults.some(result => result.severity === 'blocker' && !result.passed && !result.skipped),
    resultsFilePath: '/proof.md',
    artifactsDir: '/artifacts',
  };
}

function failingRegression(...cases: TestCaseResult[]): ScenarioProofResult {
  return proofOf(tagResult('@regression', { passed: false, exitCode: 1, cases }));
}

function makeConfig(commentOnIssue: (issueNumber: number, body: string) => void = vi.fn()): WorkflowConfig {
  const orchestratorStatePath = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-gate-state-'));
  tempDirs.push(orchestratorStatePath);
  return {
    adwId: ADW_ID,
    issueNumber: 990,
    defaultBranch: BASE_BRANCH,
    orchestratorStatePath,
    repoContext: { issueTracker: { commentOnIssue } },
  } as unknown as WorkflowConfig;
}

function scriptedRerun(outcomes: Readonly<Record<string, BaseScenarioOutcome>>): { rerunOnBase: ScenarioRerun; rerun: ReturnType<typeof vi.fn> } {
  const rerun = vi.fn(async (scenario: FailingScenario) => outcomes[scenario.name] ?? BaseScenarioOutcome.NotRun);
  return { rerunOnBase: rerun, rerun };
}

function executionLog(config: WorkflowConfig): string {
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
  fs.rmSync(path.join(AGENTS_STATE_DIR, ADW_ID), { recursive: true, force: true });
  tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

describe('failingRegressionScenarios', () => {
  it('takes the failed cases of the @regression tag, with their classname as the feature', () => {
    const proof = failingRegression(testCase('A', 'failed'), testCase('B', 'passed'), testCase('C', 'failed', 'Gamma'));

    expect(failingRegressionScenarios(proof)).toEqual([
      { name: 'A', feature: FEATURE },
      { name: 'C', feature: 'Gamma' },
    ]);
  });

  it('leaves the feature out of a case that has no classname', () => {
    const proof = failingRegression(testCase('A', 'failed', null));

    expect(failingRegressionScenarios(proof)).toEqual([{ name: 'A' }]);
  });

  it('has none when @regression passed, was skipped or was not run', () => {
    expect(failingRegressionScenarios(proofOf(tagResult('@regression')))).toEqual([]);
    expect(failingRegressionScenarios(proofOf(tagResult('@regression', { passed: true, skipped: true })))).toEqual([]);
    expect(failingRegressionScenarios(proofOf(tagResult('@adw-990', { passed: false })))).toEqual([]);
  });

  it('cannot identify the scenarios of a @regression run that failed without per-case results', () => {
    expect(failingRegressionScenarios(proofOf(tagResult('@regression', { passed: false, exitCode: 1 })))).toBeNull();
  });
});

describe('the pre-existing regression gate — a scenario that also fails on the base branch', () => {
  it('parks the issue with the pre_existing_regression comment for that scenario', async () => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(commentOnIssue);
    const { rerunOnBase } = scriptedRerun({ A: BaseScenarioOutcome.Failed });
    const gate = createPreExistingRegressionGate(config, { rerunOnBase, readBaseline: () => PASSED_BASELINE });

    await expect(gate(failingRegression(testCase('A', 'failed')))).rejects.toThrow(ExitSignal);

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(AgentStateManager.readTopLevelState(ADW_ID)).toMatchObject({ workflowStage: 'human_gated', parkReason: 'pre_existing_regression' });
    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    expect(commentOnIssue).toHaveBeenCalledWith(
      990,
      buildParkComment(ADW_ID, { reason: ParkReason.PreExistingRegression, baseBranch: BASE_BRANCH, scenario: 'Alpha: A' }),
    );
  });

  it('names the scenario and the base branch, and says what both directives do', async () => {
    const commentOnIssue = vi.fn();
    const gate = createPreExistingRegressionGate(makeConfig(commentOnIssue), {
      rerunOnBase: scriptedRerun({ A: BaseScenarioOutcome.Failed }).rerunOnBase,
      readBaseline: () => PASSED_BASELINE,
    });

    await expect(gate(failingRegression(testCase('A', 'failed')))).rejects.toThrow(ExitSignal);

    const comment = String(commentOnIssue.mock.calls[0]?.[1]);
    const directives = parkDirectives({ reason: ParkReason.PreExistingRegression, baseBranch: BASE_BRANCH, scenario: 'Alpha: A' });
    expect(comment).toContain('Alpha: A');
    expect(comment).toContain(`\`${BASE_BRANCH}\``);
    expect(comment).toContain(directives.retry);
    expect(comment).toContain(directives.continue);
  });

  it('records the outcome of each re-run in the execution log', async () => {
    const config = makeConfig();
    const { rerunOnBase } = scriptedRerun({ A: BaseScenarioOutcome.Passed, B: BaseScenarioOutcome.Failed });
    const gate = createPreExistingRegressionGate(config, { rerunOnBase, readBaseline: () => PASSED_BASELINE });

    await expect(gate(failingRegression(testCase('A', 'failed'), testCase('B', 'failed')))).rejects.toThrow(ExitSignal);

    const log = executionLog(config);
    expect(log).toMatch(/Alpha: A.*passes on the base branch/);
    expect(log).toMatch(/Alpha: B.*also fails on the base branch/);
  });

  it('parks naming the scenario that fails there, not the one that passes', async () => {
    const commentOnIssue = vi.fn();
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Passed, B: BaseScenarioOutcome.Failed });
    const gate = createPreExistingRegressionGate(makeConfig(commentOnIssue), { rerunOnBase, readBaseline: () => undefined });

    await expect(gate(failingRegression(testCase('A', 'failed'), testCase('B', 'failed')))).rejects.toThrow(ExitSignal);

    expect(rerun.mock.calls.map(call => (call[0] as FailingScenario).name)).toEqual(['A', 'B']);
    expect(String(commentOnIssue.mock.calls[0]?.[1])).toContain('Alpha: B');
  });
});

describe('the pre-existing regression gate — a scenario the change broke', () => {
  it('returns without posting anything or exiting when the scenario passes on the base branch', async () => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(commentOnIssue);
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Passed });
    const gate = createPreExistingRegressionGate(config, { rerunOnBase, readBaseline: () => PASSED_BASELINE });

    await expect(gate(failingRegression(testCase('A', 'failed')))).resolves.toBeUndefined();

    expect(rerun).toHaveBeenCalledTimes(1);
    expect(commentOnIssue).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
    expect(AgentStateManager.readTopLevelState(ADW_ID)?.workflowStage).toBeUndefined();
  });

  it('treats a scenario that could not be run on the base branch as introduced', async () => {
    const commentOnIssue = vi.fn();
    const gate = createPreExistingRegressionGate(makeConfig(commentOnIssue), {
      rerunOnBase: scriptedRerun({ A: BaseScenarioOutcome.NotRun }).rerunOnBase,
      readBaseline: () => PASSED_BASELINE,
    });

    await expect(gate(failingRegression(testCase('A', 'failed')))).resolves.toBeUndefined();

    expect(commentOnIssue).not.toHaveBeenCalled();
  });

  it('records the outcome of the re-run in the execution log', async () => {
    const config = makeConfig();
    const gate = createPreExistingRegressionGate(config, {
      rerunOnBase: scriptedRerun({ A: BaseScenarioOutcome.NotRun }).rerunOnBase,
      readBaseline: () => PASSED_BASELINE,
    });

    await gate(failingRegression(testCase('A', 'failed')));

    expect(executionLog(config)).toMatch(/Alpha: A.*could not be run on the base branch/);
  });
});

describe('the pre-existing regression gate — a waived baseline', () => {
  it('re-runs nothing and leaves every failing scenario to the fix agent, saying why', async () => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(commentOnIssue);
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Failed });
    const gate = createPreExistingRegressionGate(config, { rerunOnBase, readBaseline: () => WAIVED_BASELINE });

    await expect(gate(failingRegression(testCase('A', 'failed')))).resolves.toBeUndefined();

    expect(rerun).not.toHaveBeenCalled();
    expect(commentOnIssue).not.toHaveBeenCalled();
    expect(executionLog(config)).toMatch(/baseline was waived.*fix agent|fix agent.*baseline was waived/);
  });
});

describe('the pre-existing regression gate — nothing to triage', () => {
  it('re-runs nothing when only a tag of the issue failed', async () => {
    const config = makeConfig();
    const { rerunOnBase, rerun } = scriptedRerun({});
    const gate = createPreExistingRegressionGate(config, { rerunOnBase, readBaseline: () => PASSED_BASELINE });
    const proof = proofOf(tagResult('@regression'), tagResult('@adw-990', { passed: false, exitCode: 1, cases: [testCase('Own scenario', 'failed')] }));

    await expect(gate(proof)).resolves.toBeUndefined();

    expect(rerun).not.toHaveBeenCalled();
  });

  it('re-runs nothing when @regression failed without per-case results, and warns that the scenarios cannot be identified', async () => {
    const config = makeConfig();
    const { rerunOnBase, rerun } = scriptedRerun({});
    const gate = createPreExistingRegressionGate(config, { rerunOnBase, readBaseline: () => PASSED_BASELINE });
    const proof = proofOf(tagResult('@regression', { passed: false, exitCode: 1 }));

    await expect(gate(proof)).resolves.toBeUndefined();

    expect(rerun).not.toHaveBeenCalled();
    expect(executionLog(config)).toMatch(/cannot be identified.*fix agent/);
  });
});

describe('the pre-existing regression gate — a passed baseline', () => {
  it('still re-runs the scenario, because the baseline runs no regression scenario and cannot vouch for one', async () => {
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Passed });
    const gate = createPreExistingRegressionGate(makeConfig(), { rerunOnBase, readBaseline: () => PASSED_BASELINE });

    await gate(failingRegression(testCase('A', 'failed')));

    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it('reads the baseline from the top-level state by default', async () => {
    AgentStateManager.writeTopLevelState(ADW_ID, { adwId: ADW_ID, baseline: WAIVED_BASELINE });
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Failed });
    const gate = createPreExistingRegressionGate(makeConfig(), { rerunOnBase });

    await expect(gate(failingRegression(testCase('A', 'failed')))).resolves.toBeUndefined();

    expect(rerun).not.toHaveBeenCalled();
  });
});
