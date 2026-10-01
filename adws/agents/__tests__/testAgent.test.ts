import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn(),
}));

import { runTestAgent, runResolveTestAgent } from '../testAgent';
import { runClaudeAgentWithCommand } from '../claudeAgent';

const mockRunClaudeAgent = vi.mocked(runClaudeAgentWithCommand);

const KILL_ON_COMPACTION_ARG = 13;

const PASSING_RESULTS = JSON.stringify([
  { test_name: 'app_tests', passed: true, execution_command: 'bun run test:unit', test_purpose: 'unit tests' },
]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runTestAgent — context compaction', () => {
  it('asks for the kill when its caller restarts the agent', async () => {
    mockRunClaudeAgent.mockResolvedValueOnce({ success: true, output: PASSING_RESULTS });

    const result = await runTestAgent('/tmp/adw-test-agent-logs', undefined, undefined, undefined, undefined, true);

    expect(mockRunClaudeAgent.mock.calls[0][KILL_ON_COMPACTION_ARG]).toBe(true);
    expect(result.allPassed).toBe(true);
  });

  it('leaves the agent running through a compaction by default', async () => {
    mockRunClaudeAgent.mockResolvedValueOnce({ success: true, output: PASSING_RESULTS });

    await runTestAgent('/tmp/adw-test-agent-logs');

    expect(mockRunClaudeAgent.mock.calls[0][KILL_ON_COMPACTION_ARG]).toBeFalsy();
  });

  it('hands a run stopped on compaction back to its caller to restart, with no results to read', async () => {
    mockRunClaudeAgent.mockResolvedValueOnce({ success: true, compactionDetected: true, output: 'cut off before any JSON' });

    const result = await runTestAgent('/tmp/adw-test-agent-logs', undefined, undefined, undefined, undefined, true);

    expect(mockRunClaudeAgent).toHaveBeenCalledTimes(1);
    expect(result.compactionDetected).toBe(true);
    expect(result.testResults).toEqual([]);
    expect(result.allPassed).toBe(false);
    expect(result.failedTests).toEqual([]);
  });
});

describe('runResolveTestAgent — context compaction', () => {
  const failedTest = { test_name: 'broken', passed: false, execution_command: 'bun run test:unit', test_purpose: 'unit tests' };

  it('asks for the kill when its caller restarts the agent, and by default leaves it running', async () => {
    mockRunClaudeAgent.mockResolvedValue({ success: true, output: 'fixed' });

    await runResolveTestAgent(failedTest, '/tmp/adw-test-agent-logs', undefined, undefined, undefined, undefined, true);
    await runResolveTestAgent(failedTest, '/tmp/adw-test-agent-logs');

    expect(mockRunClaudeAgent.mock.calls[0][KILL_ON_COMPACTION_ARG]).toBe(true);
    expect(mockRunClaudeAgent.mock.calls[1][KILL_ON_COMPACTION_ARG]).toBeFalsy();
  });
});
