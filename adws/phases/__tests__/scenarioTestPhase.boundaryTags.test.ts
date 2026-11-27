import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../scenarioProof', () => ({
  runScenarioProof: vi.fn(),
}));

vi.mock('../../cost', () => ({
  createPhaseCostRecords: vi.fn(() => []),
  PhaseCostStatus: { Success: 'success', Failed: 'failed', Partial: 'partial' },
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
  AgentStateManager: {
    appendLog: vi.fn(),
  },
  emptyModelUsageMap: vi.fn(() => ({})),
}));

import * as path from 'path';
import { executeScenarioTestPhase, type ScenarioTestPhaseDeps } from '../scenarioTestPhase';
import { runScenarioProof } from '../scenarioProof';
import { AgentStateManager } from '../../core';
import { createPhaseCostRecords } from '../../cost';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { BoundaryViolationKind } from '../../core/boundaryList';
import type { BoundaryTagGate, BoundaryTagGateInput } from '../boundaryTagGate';
import { EVERY_DEVICE_SOURCE, failingProof, fakeDevices, fakeLifecycle, makeConfig, passingProof } from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);
const mockCreatePhaseCostRecords = vi.mocked(createPhaseCostRecords);
const mockAppendLog = vi.mocked(AgentStateManager.appendLog);

const FAILED_GATE: BoundaryTagGate = {
  kind: 'failed',
  violations: [{ kind: BoundaryViolationKind.MissingTag, featurePath: 'per-issue/feature-42.feature', scenario: 'Orders › Orders are listed' }],
  proof: failingProof,
};
const PASSED_GATE: BoundaryTagGate = { kind: 'passed', boundaries: [{ name: 'cli', description: 'a real command-line invocation' }] };
const SKIPPED_GATE: BoundaryTagGate = { kind: 'skipped' };

function gateAnswering(gate: BoundaryTagGate): { runBoundaryTagGate: ScenarioTestPhaseDeps['runBoundaryTagGate']; inputs: BoundaryTagGateInput[] } {
  const inputs: BoundaryTagGateInput[] = [];
  const runBoundaryTagGate = (input: BoundaryTagGateInput): BoundaryTagGate => {
    inputs.push(input);
    return gate;
  };
  return { runBoundaryTagGate, inputs };
}

const loggedToState = (): string[] => mockAppendLog.mock.calls.map(([, message]) => message);

beforeEach(() => {
  mockRunScenarioProof.mockReset();
  mockAppendLog.mockClear();
  mockCreatePhaseCostRecords.mockReset();
  mockCreatePhaseCostRecords.mockReturnValue([]);
});

describe('executeScenarioTestPhase — the boundary-tag check', () => {
  it("hands the gate the worktree, the runner's feature directory, the issue number and the phase's proof directory", async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const { runBoundaryTagGate, inputs } = gateAnswering(PASSED_GATE);

    await executeScenarioTestPhase(makeConfig({ scenarioDirectory: 'specs/features' }), { readDeclaredDevServer: () => null, runBoundaryTagGate });

    expect(inputs).toEqual([{ worktreePath: '/worktrees/test', featureDirectory: 'specs/features', issueNumber: 42, proofDir: path.join('agents', 'test-id', 'scenario-test') }]);
  });

  it("a failed gate runs no scenario and starts no dev server, and returns the gate's proof as a blocker failure", async () => {
    const lifecycle = fakeLifecycle();
    const { runBoundaryTagGate } = gateAnswering(FAILED_GATE);

    const result = await executeScenarioTestPhase(makeConfig(), {
      readDeclaredDevServer: () => 'bun run dev --port {PORT}',
      withHealthyDevServer: lifecycle.withHealthyDevServer,
      runBoundaryTagGate,
    });

    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(lifecycle.configs).toHaveLength(0);
    expect(result.scenarioProof).toBe(failingProof);
    expect(result.scenarioProof?.hasBlockerFailures).toBe(true);
    expect(loggedToState()).toEqual(
      expect.arrayContaining([
        'Scenario test phase: boundary-tag check failed with 1 violation(s); no scenario ran',
        '`per-issue/feature-42.feature`: scenario "Orders › Orders are listed" carries no boundary tag',
      ]),
    );
  });

  it('a failed gate records a failed phase cost and puts its proof on the workflow context', async () => {
    const config = makeConfig();
    const { runBoundaryTagGate } = gateAnswering(FAILED_GATE);

    await executeScenarioTestPhase(config, { readDeclaredDevServer: () => null, runBoundaryTagGate });

    expect(mockCreatePhaseCostRecords).toHaveBeenCalledWith(expect.objectContaining({ phase: 'scenarioTest', status: 'failed' }));
    expect(config.ctx.scenarioProof).toBe(failingProof);
  });

  it('a failed gate creates no device for a profile with platforms', async () => {
    const { withDevices, requests } = fakeDevices();
    const { runBoundaryTagGate } = gateAnswering(FAILED_GATE);
    const config = makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES['mobile:kotlincm'], deviceSources: EVERY_DEVICE_SOURCE });

    await executeScenarioTestPhase(config, { readDeclaredDevServer: () => null, withDevices, runBoundaryTagGate });

    expect(requests).toHaveLength(0);
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });

  it('a skipped gate, when the target has no list, runs the scenarios as before', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const { runBoundaryTagGate } = gateAnswering(SKIPPED_GATE);

    const result = await executeScenarioTestPhase(makeConfig(), { readDeclaredDevServer: () => null, runBoundaryTagGate });

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(result.scenarioProof).toBe(passingProof);
    expect(loggedToState()).toContain('Scenario test phase: .adw/scenarios.md has no ## Real Boundaries list — boundary-tag check skipped');
  });

  it('a passed gate runs the scenarios as before', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const { runBoundaryTagGate } = gateAnswering(PASSED_GATE);

    const result = await executeScenarioTestPhase(makeConfig(), { readDeclaredDevServer: () => null, runBoundaryTagGate });

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(result.scenarioProof).toBe(passingProof);
  });

  it.each([
    ['no scenarios are configured', { scenariosMd: '' }],
    ['the runner is N/A', { runScenariosByTag: 'N/A' }],
  ])('runs no gate when the phase skips because %s', async (_case, overrides) => {
    const { runBoundaryTagGate, inputs } = gateAnswering(FAILED_GATE);

    const result = await executeScenarioTestPhase(makeConfig(overrides), { readDeclaredDevServer: () => null, runBoundaryTagGate });

    expect(inputs).toHaveLength(0);
    expect(result.scenarioProof).toBeUndefined();
  });
});
