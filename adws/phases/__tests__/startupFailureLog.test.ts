import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import { recordStartupFailure } from '../startupFailureLog';

const ADW_ID = `test-startup-failure-${Date.now()}`;
const ORCHESTRATOR = 'sdlc-orchestrator';
const logPath = () => join(AGENTS_STATE_DIR, ADW_ID, ORCHESTRATOR, 'execution.log');

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(join(AGENTS_STATE_DIR, ADW_ID), { recursive: true, force: true });
});

describe('recordStartupFailure', () => {
  it('appends the error with its stack to the orchestrator execution log, creating the directory when startup died before it existed', () => {
    expect(existsSync(join(AGENTS_STATE_DIR, ADW_ID))).toBe(false);
    const error = new Error('Pre-flight check failed: Claude CLI not executable');

    recordStartupFailure(ADW_ID, ORCHESTRATOR, error);

    const log = readFileSync(logPath(), 'utf-8');
    expect(log).toContain(`${ORCHESTRATOR} startup failed:`);
    expect(log).toContain('Pre-flight check failed: Claude CLI not executable');
    expect(log).toContain(error.stack?.split('\n')[1]?.trim() ?? '');
  });

  it('records String(error) for a thrown value that is not an Error', () => {
    recordStartupFailure(ADW_ID, ORCHESTRATOR, 'plain string rejection');

    expect(readFileSync(logPath(), 'utf-8')).toContain('startup failed: plain string rejection');
  });

  it('appends after the lines an earlier run left instead of rewriting the log', () => {
    const statePath = AgentStateManager.initializeState(ADW_ID, ORCHESTRATOR);
    AgentStateManager.appendLog(statePath, 'Allocated port 57665 for dev server');

    recordStartupFailure(ADW_ID, ORCHESTRATOR, new Error('second run died'));

    const log = readFileSync(logPath(), 'utf-8');
    expect(log.indexOf('Allocated port 57665 for dev server')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('second run died')).toBeGreaterThan(log.indexOf('Allocated port 57665 for dev server'));
  });

  it('never throws when the log cannot be written, so the caller can still rethrow the startup error', () => {
    vi.spyOn(AgentStateManager, 'appendLog').mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => recordStartupFailure(ADW_ID, ORCHESTRATOR, new Error('startup error'))).not.toThrow();
  });
});
