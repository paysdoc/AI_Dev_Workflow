import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as childProcess from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
  AgentStateManager: { appendLog: vi.fn() },
  getSafeSubprocessEnv: vi.fn().mockReturnValue({}),
  resolveClaudeCodePath: vi.fn().mockReturnValue('/usr/local/bin/claude'),
  clearClaudeCodePathCache: vi.fn(),
}));

vi.mock('../agentProcessHandler', () => ({
  handleAgentProcess: vi.fn(),
}));

import { runPrimedClaudeAgentWithCommand } from '../claudeAgent';
import { handleAgentProcess } from '../agentProcessHandler';

describe('runPrimedClaudeAgentWithCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(childProcess.spawn).mockReturnValue({} as any);
    vi.mocked(handleAgentProcess).mockResolvedValue({ success: true, output: 'done' });
  });

  function getSpawnPrompt(): string {
    const spawnArgs = vi.mocked(childProcess.spawn).mock.calls[0][1] as string[];
    return spawnArgs[spawnArgs.length - 1];
  }

  it('composes a prompt starting with /install followed by a blank line', async () => {
    await runPrimedClaudeAgentWithCommand('/feature', 'some content', 'Plan', '/logs/output.jsonl');

    const prompt = getSpawnPrompt();
    expect(prompt).toMatch(/^\/install\n\n/);
  });

  it('includes the command and string args in the second step', async () => {
    await runPrimedClaudeAgentWithCommand('/feature', 'my arg', 'Plan', '/logs/output.jsonl');

    const prompt = getSpawnPrompt();
    expect(prompt).toContain("Once /install completes, run: /feature 'my arg'");
  });

  it('includes array args each quoted and joined in the second step', async () => {
    await runPrimedClaudeAgentWithCommand('/feature', ['arg1', 'arg2', 'arg3'], 'Plan', '/logs/output.jsonl');

    const prompt = getSpawnPrompt();
    expect(prompt).toContain("Once /install completes, run: /feature 'arg1' 'arg2' 'arg3'");
  });

  it('escapes single quotes in args', async () => {
    await runPrimedClaudeAgentWithCommand('/feature', ["it's quoted"], 'Plan', '/logs/output.jsonl');

    const prompt = getSpawnPrompt();
    expect(prompt).toContain("'it'\\''s quoted'");
  });

  it('handles empty args array with just the command in the second step', async () => {
    await runPrimedClaudeAgentWithCommand('/feature', [], 'Plan', '/logs/output.jsonl');

    const prompt = getSpawnPrompt();
    expect(prompt).toMatch(/Once \/install completes, run: \/feature\s*$/);
  });

  it('passes model to the CLI args', async () => {
    await runPrimedClaudeAgentWithCommand('/feature', 'args', 'Plan', '/logs/output.jsonl', 'opus');

    const spawnArgs = vi.mocked(childProcess.spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('opus');
  });

  it('passes effort to the CLI args when provided', async () => {
    await runPrimedClaudeAgentWithCommand('/feature', 'args', 'Plan', '/logs/output.jsonl', 'opus', 'high');

    const spawnArgs = vi.mocked(childProcess.spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('--effort');
    expect(spawnArgs).toContain('high');
  });

  it('omits effort from CLI args when not provided', async () => {
    await runPrimedClaudeAgentWithCommand('/feature', 'args', 'Plan', '/logs/output.jsonl', 'opus');

    const spawnArgs = vi.mocked(childProcess.spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain('--effort');
  });

  it('forwards cwd to spawn', async () => {
    await runPrimedClaudeAgentWithCommand('/feature', 'args', 'Plan', '/logs/output.jsonl', 'sonnet', undefined, undefined, undefined, '/custom/cwd');

    const spawnOptions = vi.mocked(childProcess.spawn).mock.calls[0][2] as { cwd: string };
    expect(spawnOptions.cwd).toBe('/custom/cwd');
  });
});
