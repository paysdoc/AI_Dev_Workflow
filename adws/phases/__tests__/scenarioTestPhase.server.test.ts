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

import { AgentStateManager } from '../../core';
import { DevServerStartStatus } from '../../core/devServerFailure';
import { MAX_START_ATTEMPTS } from '../../core/devServerLifecycle';
import { createPhaseCostRecords } from '../../cost';
import { executeScenarioTestPhase } from '../scenarioTestPhase';
import { runScenarioProof } from '../scenarioProof';
import { fakeLifecycle, makeConfig, passingProof } from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);
const mockCreatePhaseCostRecords = vi.mocked(createPhaseCostRecords);
const mockAppendLog = vi.mocked(AgentStateManager.appendLog);

const DECLARED_SERVER = 'bun run dev --port {PORT}';
const SERVER_OUTPUT = "Error: Cannot find module './routes'\n    at start (server.js:3:1)\n";

beforeEach(() => {
  mockRunScenarioProof.mockReset();
  mockAppendLog.mockReset();
  mockCreatePhaseCostRecords.mockReset();
  mockCreatePhaseCostRecords.mockReturnValue([]);
});

function loggedToState(): string {
  return mockAppendLog.mock.calls.map(([, message]) => message).join('\n');
}

describe('executeScenarioTestPhase — a declared dev server that does not start', () => {
  it('runs no scenario', async () => {
    const lifecycle = fakeLifecycle({ output: SERVER_OUTPUT });

    await executeScenarioTestPhase(makeConfig({ healthCheckPath: '/health' }), {
      readDeclaredDevServer: () => DECLARED_SERVER,
      withHealthyDevServer: lifecycle.withHealthyDevServer,
    });

    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });

  it('reports the failed start with the server output, the command with its port and the health URL', async () => {
    const lifecycle = fakeLifecycle({ output: SERVER_OUTPUT });

    const result = await executeScenarioTestPhase(makeConfig({ healthCheckPath: '/health' }), {
      readDeclaredDevServer: () => DECLARED_SERVER,
      withHealthyDevServer: lifecycle.withHealthyDevServer,
    });

    expect(result.devServer).toEqual({
      status: DevServerStartStatus.Failed,
      command: 'bun run dev --port 4567',
      healthUrl: 'http://localhost:4567/health',
      output: SERVER_OUTPUT,
    });
    expect(result.scenarioProof).toBeUndefined();
    expect(result.costUsd).toBe(0);
  });

  it('clears a proof left on the context by an earlier run, so that no stale proof reaches a comment or the pull request', async () => {
    const config = makeConfig();
    config.ctx.scenarioProof = passingProof;
    const lifecycle = fakeLifecycle({ output: SERVER_OUTPUT });

    await executeScenarioTestPhase(config, { readDeclaredDevServer: () => DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(config.ctx.scenarioProof).toBeUndefined();
  });

  it('records the phase cost as failed', async () => {
    const lifecycle = fakeLifecycle({ output: SERVER_OUTPUT });

    await executeScenarioTestPhase(makeConfig(), { readDeclaredDevServer: () => DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(mockCreatePhaseCostRecords).toHaveBeenCalledWith(expect.objectContaining({ phase: 'scenarioTest', status: 'failed' }));
  });

  it('returns the cost records it made', async () => {
    mockCreatePhaseCostRecords.mockReturnValueOnce([{ id: 'record-1' } as unknown as import('../../cost').PhaseCostRecord]);
    const lifecycle = fakeLifecycle({ output: SERVER_OUTPUT });

    const result = await executeScenarioTestPhase(makeConfig(), { readDeclaredDevServer: () => DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(result.phaseCostRecords).toEqual([{ id: 'record-1' }]);
  });

  it('says in the state log that the server did not start on the issue branch and that no scenario ran, with the output', async () => {
    const lifecycle = fakeLifecycle({ output: SERVER_OUTPUT });

    await executeScenarioTestPhase(makeConfig(), { readDeclaredDevServer: () => DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    const logged = loggedToState();
    expect(logged).toContain('did not start on the issue branch');
    expect(logged).toContain(`after ${MAX_START_ATTEMPTS} attempts`);
    expect(logged).toContain('no scenario ran');
    expect(logged).toContain("Error: Cannot find module './routes'");
  });

  it('says there was no output when the server printed nothing', async () => {
    const lifecycle = fakeLifecycle({ output: '' });

    const result = await executeScenarioTestPhase(makeConfig(), { readDeclaredDevServer: () => DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(loggedToState()).toContain('(no output)');
    expect(result.devServer).toMatchObject({ status: DevServerStartStatus.Failed, output: '' });
  });
});

describe('executeScenarioTestPhase — a declared dev server that starts', () => {
  it('runs the scenarios inside the lifecycle and reports the server as started', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const lifecycle = fakeLifecycle();

    const result = await executeScenarioTestPhase(makeConfig(), { readDeclaredDevServer: () => DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(result.devServer).toEqual({ status: DevServerStartStatus.Started });
    expect(result.scenarioProof).toBe(passingProof);
  });

  it('hands the lifecycle the declared command, the port of the application address, the health path, the worktree and a log under the logs directory', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const lifecycle = fakeLifecycle();

    await executeScenarioTestPhase(makeConfig({ healthCheckPath: '/health' }), { readDeclaredDevServer: () => DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(lifecycle.configs).toEqual([
      { startCommand: DECLARED_SERVER, port: 4567, healthPath: '/health', cwd: '/worktrees/test', outputPath: '/logs/dev-server.log' },
    ]);
  });

  it('falls back to the root path when the health check path is empty', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const lifecycle = fakeLifecycle();

    await executeScenarioTestPhase(makeConfig({ healthCheckPath: '' }), { readDeclaredDevServer: () => DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(lifecycle.configs[0].healthPath).toBe('/');
  });

  it('puts the proof on the context, as the proof publish phase reads it', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig();
    const lifecycle = fakeLifecycle();

    await executeScenarioTestPhase(config, { readDeclaredDevServer: () => DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(config.ctx.scenarioProof).toBe(passingProof);
  });

  it('reads the declaration from the worktree', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const readDeclaredDevServer = vi.fn(() => DECLARED_SERVER);
    const lifecycle = fakeLifecycle();

    await executeScenarioTestPhase(makeConfig(), { readDeclaredDevServer, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(readDeclaredDevServer).toHaveBeenCalledWith('/worktrees/test');
  });
});

describe('executeScenarioTestPhase — a repository that declares no dev server', () => {
  it('starts nothing although the parsed config holds the parser default, and reports the server as not started', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const lifecycle = fakeLifecycle({ output: 'would have failed' });

    const result = await executeScenarioTestPhase(makeConfig({ startDevServer: 'bun run dev' }), {
      readDeclaredDevServer: () => null,
      withHealthyDevServer: lifecycle.withHealthyDevServer,
    });

    expect(lifecycle.configs).toHaveLength(0);
    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(result.devServer).toEqual({ status: DevServerStartStatus.NotStarted });
    expect(result.scenarioProof).toBe(passingProof);
  });
});

describe('executeScenarioTestPhase — no scenarios to serve', () => {
  it('touches neither the declaration nor the lifecycle, and reports the server as not started', async () => {
    const readDeclaredDevServer = vi.fn(() => DECLARED_SERVER);
    const lifecycle = fakeLifecycle();

    const result = await executeScenarioTestPhase(makeConfig({ scenariosMd: '' }), { readDeclaredDevServer, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(readDeclaredDevServer).not.toHaveBeenCalled();
    expect(lifecycle.configs).toHaveLength(0);
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(result.devServer).toEqual({ status: DevServerStartStatus.NotStarted });
  });
});
