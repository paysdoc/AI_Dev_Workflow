import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDocumentAgent, formatDocumentArgs, extractDocPathFromOutput } from '../documentAgent';
import { runClaudeAgentWithCommand } from '../claudeAgent';

vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: '/path/to/doc.md',
    totalCostUsd: 0.3,
  }),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    getModelForCommand: vi.fn().mockReturnValue('sonnet'),
    getEffortForCommand: vi.fn().mockReturnValue('high'),
  };
});

describe('formatDocumentArgs', () => {
  it('returns array with adwId, specPath, and screenshotsDir', () => {
    const result = formatDocumentArgs('adw-123', 'specs/plan.md', '/screenshots');
    expect(result).toEqual(['adw-123', 'specs/plan.md', '/screenshots']);
  });

  it('defaults specPath to empty string when undefined', () => {
    const result = formatDocumentArgs('adw-123', undefined, '/screenshots');
    expect(result).toEqual(['adw-123', '', '/screenshots']);
  });

  it('defaults screenshotsDir to empty string when undefined', () => {
    const result = formatDocumentArgs('adw-123', 'specs/plan.md');
    expect(result).toEqual(['adw-123', 'specs/plan.md', '']);
  });

  it('defaults both optional params to empty strings', () => {
    const result = formatDocumentArgs('adw-456');
    expect(result).toEqual(['adw-456', '', '']);
  });
});

describe('extractDocPathFromOutput', () => {
  it('extracts path from single-line output', () => {
    const result = extractDocPathFromOutput('app_docs/feature-login.md');
    expect(result).toBe('app_docs/feature-login.md');
  });

  it('extracts path from last line of multi-line output', () => {
    const output = `Creating documentation...
Processing spec file...
app_docs/feature-login.md`;
    const result = extractDocPathFromOutput(output);
    expect(result).toBe('app_docs/feature-login.md');
  });

  it('trims whitespace from the output', () => {
    const result = extractDocPathFromOutput('  app_docs/feature-login.md  \n');
    expect(result).toBe('app_docs/feature-login.md');
  });

  it('skips blank lines when extracting path', () => {
    const output = `Some text\n\napp_docs/doc.md\n\n`;
    const result = extractDocPathFromOutput(output);
    expect(result).toBe('app_docs/doc.md');
  });

  it('returns empty string for empty output', () => {
    const result = extractDocPathFromOutput('');
    expect(result).toBe('');
  });

  it('returns empty string for whitespace-only output', () => {
    const result = extractDocPathFromOutput('   \n  \n  ');
    expect(result).toBe('');
  });
});

describe('runDocumentAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runClaudeAgentWithCommand with /document command', async () => {
    await runDocumentAgent('adw-123', '/tmp/logs', 'specs/plan.md', '/screenshots');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/document',
      ['adw-123', 'specs/plan.md', '/screenshots'],
      'Document',
      expect.stringContaining('document-agent.jsonl'),
      'sonnet',
      'high',
      undefined,
      undefined,
      undefined,
    );
  });

  it('returns AgentResult with docPath extracted from output', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValueOnce({
      success: true,
      output: 'Processing...\napp_docs/feature-login.md',
      totalCostUsd: 0.2,
    });

    const result = await runDocumentAgent('adw-123', '/tmp/logs');

    expect(result.success).toBe(true);
    expect(result.docPath).toBe('app_docs/feature-login.md');
  });

  it('returns empty docPath when output has no extractable path', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValueOnce({
      success: true,
      output: '',
      totalCostUsd: 0.1,
    });

    const result = await runDocumentAgent('adw-123', '/tmp/logs');

    expect(result.docPath).toBe('');
  });

  it('passes specPath and screenshotsDir as args', async () => {
    await runDocumentAgent('adw-123', '/tmp/logs', 'specs/my-plan.md', '/my/screenshots');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const args = callArgs[1] as string[];
    expect(args).toEqual(['adw-123', 'specs/my-plan.md', '/my/screenshots']);
  });

  it('uses empty strings for optional args when not provided', async () => {
    await runDocumentAgent('adw-123', '/tmp/logs');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const args = callArgs[1] as string[];
    expect(args).toEqual(['adw-123', '', '']);
  });

  it('sets output file path in logsDir', async () => {
    await runDocumentAgent('adw-123', '/my/logs');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const outputFile = callArgs[3] as string;
    expect(outputFile).toBe('/my/logs/document-agent.jsonl');
  });

  it('passes statePath and cwd to runClaudeAgentWithCommand', async () => {
    await runDocumentAgent('adw-123', '/tmp/logs', undefined, undefined, '/state/path', '/worktree');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[7]).toBe('/state/path');
    expect(callArgs[8]).toBe('/worktree');
  });

  it('passes issueBody to getModelForCommand and getEffortForCommand', async () => {
    const { getModelForCommand, getEffortForCommand } = await import('../../core');
    await runDocumentAgent('adw-123', '/tmp/logs', undefined, undefined, undefined, undefined, '<!-- adw:fast -->');

    expect(getModelForCommand).toHaveBeenCalledWith('/document', '<!-- adw:fast -->');
    expect(getEffortForCommand).toHaveBeenCalledWith('/document', '<!-- adw:fast -->');
  });

  it('spreads agent result properties into return value', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValueOnce({
      success: true,
      output: 'app_docs/doc.md',
      totalCostUsd: 0.5,
      sessionId: 'session-abc',
    });

    const result = await runDocumentAgent('adw-123', '/tmp/logs');

    expect(result.success).toBe(true);
    expect(result.totalCostUsd).toBe(0.5);
    expect(result.sessionId).toBe('session-abc');
    expect(result.docPath).toBe('app_docs/doc.md');
  });
});
