import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn(),
}));

import { runCommandAgent, type CommandAgentConfig } from '../commandAgent';
import { runClaudeAgentWithCommand } from '../claudeAgent';

const mockRunClaudeAgent = vi.mocked(runClaudeAgentWithCommand);

const KILL_ON_COMPACTION_ARG = 13;

const config: CommandAgentConfig<string> = {
  command: '/test',
  agentName: 'Probe',
  outputFileName: 'probe.jsonl',
  extractOutput: output => (output.startsWith('ok')
    ? { success: true, data: output }
    : { success: false, error: 'output is not ok' }),
};

const options = { args: 'args', logsDir: '/tmp/adw-command-agent-logs' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runCommandAgent — context compaction', () => {
  it('passes the kill request to its agent, and leaves the output-correction retry running on', async () => {
    mockRunClaudeAgent
      .mockResolvedValueOnce({ success: true, output: 'not valid' })
      .mockResolvedValueOnce({ success: true, output: 'ok' });

    await runCommandAgent(config, { ...options, killOnCompaction: true });

    expect(mockRunClaudeAgent).toHaveBeenCalledTimes(2);
    expect(mockRunClaudeAgent.mock.calls[0][KILL_ON_COMPACTION_ARG]).toBe(true);
    expect(mockRunClaudeAgent.mock.calls[1][KILL_ON_COMPACTION_ARG]).toBeUndefined();
  });

  it('does not ask for the kill unless its caller restarts the agent', async () => {
    mockRunClaudeAgent.mockResolvedValueOnce({ success: true, output: 'ok' });

    await runCommandAgent(config, options);

    expect(mockRunClaudeAgent.mock.calls[0][KILL_ON_COMPACTION_ARG]).toBeFalsy();
  });

  it('hands back a run stopped on compaction without validating its cut-off output', async () => {
    mockRunClaudeAgent.mockResolvedValueOnce({ success: true, compactionDetected: true, output: 'cut off midway' });

    const result = await runCommandAgent(config, { ...options, killOnCompaction: true });

    expect(mockRunClaudeAgent).toHaveBeenCalledTimes(1);
    expect(result.compactionDetected).toBe(true);
    expect(result.parsed).toBeUndefined();
  });
});
