import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn(),
}));

vi.mock('../../core/logger', () => ({
  log: vi.fn(),
}));

import { runClaudeAgentWithCommand } from '../claudeAgent';
import { runCommandAgent, OutputValidationError, type ExtractionResult } from '../commandAgent';
import { getModelForCommand, getEffortForCommand } from '../../core/modelRouting';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const VALIDATION_ERROR = 'not JSON';

const mockedAgent = vi.mocked(runClaudeAgentWithCommand);

function parseJson(output: string): ExtractionResult<{ ok: boolean }> {
  try {
    return { success: true, data: JSON.parse(output) as { ok: boolean } };
  } catch {
    return { success: false, error: VALIDATION_ERROR };
  }
}

const config = {
  command: '/review' as const,
  agentName: 'reviewer',
  outputFileName: 'review.jsonl',
  extractOutput: parseJson,
  outputSchema: SCHEMA,
};

let logsDir: string;

beforeEach(() => {
  mockedAgent.mockReset();
  logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-agent-'));
});

afterEach(() => {
  fs.rmSync(logsDir, { recursive: true, force: true });
});

describe('runCommandAgent output-validation retry', () => {
  it.each([
    ['default', undefined],
    ['fast', 'Ship it. /fast'],
  ])('runs /correct_output with positional arguments and a routed model in %s mode', async (_mode, issueBody) => {
    mockedAgent
      .mockResolvedValueOnce({ success: true, output: 'not json' })
      .mockResolvedValueOnce({ success: true, output: '{"ok":true}' });

    const result = await runCommandAgent(config, { args: ['42', 'adw-1'], logsDir, issueBody, cwd: '/work/tree' });

    expect(result.parsed).toEqual({ ok: true });
    expect(mockedAgent).toHaveBeenCalledTimes(2);
    const retryCall = mockedAgent.mock.calls[1];
    const [command, args, , , model, effort] = retryCall;
    expect(command).toBe('/correct_output');
    expect(model).toBe(getModelForCommand('/correct_output', issueBody));
    expect(effort).toBe(getEffortForCommand('/correct_output', issueBody));
    expect(retryCall[8]).toBe('/work/tree');

    const [originalCommand, originalArgs, invalidOutputFile, validationError, schema] = args as string[];
    expect(originalCommand).toBe('/review');
    expect(originalArgs).toBe('42 adw-1');
    expect(validationError).toBe(VALIDATION_ERROR);
    expect(schema).toBe(JSON.stringify(SCHEMA));
    expect(path.isAbsolute(invalidOutputFile)).toBe(true);
    expect(path.dirname(invalidOutputFile)).toBe(logsDir);
    expect(fs.readFileSync(invalidOutputFile, 'utf-8')).toBe('not json');
  });

  it('starts every spawn with a slash command', async () => {
    mockedAgent
      .mockResolvedValueOnce({ success: true, output: 'not json' })
      .mockResolvedValueOnce({ success: true, output: '{"ok":true}' });

    await runCommandAgent(config, { args: 'plain args', logsDir });

    expect(mockedAgent.mock.calls.map(([command]) => command.startsWith('/'))).toEqual([true, true]);
  });

  it('stops after three identical validation errors in a row', async () => {
    mockedAgent.mockResolvedValue({ success: true, output: 'not json' });

    await expect(runCommandAgent(config, { args: [], logsDir })).rejects.toBeInstanceOf(OutputValidationError);
    expect(mockedAgent).toHaveBeenCalledTimes(3);
  });

  it('numbers the file each retry reads, so a later retry does not overwrite an earlier one', async () => {
    mockedAgent
      .mockResolvedValueOnce({ success: true, output: 'first bad' })
      .mockResolvedValueOnce({ success: true, output: 'second bad' })
      .mockResolvedValueOnce({ success: true, output: '{"ok":true}' });
    const alternating = (output: string): ExtractionResult<{ ok: boolean }> =>
      output.endsWith('bad') ? { success: false, error: `bad: ${output}` } : parseJson(output);

    await runCommandAgent({ ...config, extractOutput: alternating }, { args: [], logsDir });

    const files = mockedAgent.mock.calls.slice(1).map(([, args]) => (args as string[])[2]);
    expect(files.map((file) => path.basename(file))).toEqual(['review-invalid-output-1.txt', 'review-invalid-output-2.txt']);
    expect(files.map((file) => fs.readFileSync(file, 'utf-8'))).toEqual(['first bad', 'second bad']);
  });
});

describe('the /correct_output command file', () => {
  it('exists under .claude/commands', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, '.claude', 'commands', 'correct_output.md'))).toBe(true);
  });
});
