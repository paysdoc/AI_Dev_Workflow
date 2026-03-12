import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runKpiAgent, formatKpiArgs } from '../kpiAgent';
import { runClaudeAgentWithCommand } from '../claudeAgent';

vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'Updated app_docs/agentic_kpis.md',
    totalCostUsd: 0.05,
  }),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    getModelForCommand: vi.fn().mockReturnValue('haiku'),
    getEffortForCommand: vi.fn().mockReturnValue('medium'),
  };
});

describe('formatKpiArgs', () => {
  it('returns single-element array with valid JSON string', () => {
    const result = formatKpiArgs('adw-123', 42, '/feature', 'specs/plan.md', ['adw_plan_iso']);
    expect(result).toHaveLength(1);
    expect(() => JSON.parse(result[0])).not.toThrow();
  });

  it('JSON contains all expected keys', () => {
    const result = formatKpiArgs('adw-123', 42, '/feature', 'specs/plan.md', ['adw_plan_iso'], '/worktree');
    const parsed = JSON.parse(result[0]);
    expect(parsed).toEqual({
      adw_id: 'adw-123',
      issue_number: 42,
      issue_class: '/feature',
      plan_file: 'specs/plan.md',
      all_adws: ['adw_plan_iso'],
      worktree_path: '/worktree',
    });
  });

  it('handles undefined worktreePath', () => {
    const result = formatKpiArgs('adw-123', 42, '/feature', 'specs/plan.md', ['adw_plan_iso']);
    const parsed = JSON.parse(result[0]);
    expect(parsed.worktree_path).toBeUndefined();
  });
});

describe('runKpiAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runClaudeAgentWithCommand with /track_agentic_kpis command', async () => {
    await runKpiAgent('adw-123', '/tmp/logs', 42, '/feature', 'specs/plan.md', ['adw_plan_iso']);

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/track_agentic_kpis',
      expect.any(Array),
      'KPI',
      expect.stringContaining('kpi-agent.jsonl'),
      'haiku',
      'medium',
      undefined,
      undefined,
      undefined,
    );
  });

  it('passes KPI args as JSON string in array', async () => {
    await runKpiAgent('adw-123', '/tmp/logs', 42, '/feature', 'specs/plan.md', ['adw_plan_iso']);

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const args = callArgs[1] as string[];
    expect(args).toHaveLength(1);
    const parsed = JSON.parse(args[0]);
    expect(parsed.adw_id).toBe('adw-123');
    expect(parsed.issue_number).toBe(42);
  });

  it('sets output file to kpi-agent.jsonl in logsDir', async () => {
    await runKpiAgent('adw-123', '/my/logs', 42, '/feature', 'specs/plan.md', ['adw_plan_iso']);

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[3]).toBe('/my/logs/kpi-agent.jsonl');
  });

  it('passes undefined as CWD (9th argument)', async () => {
    await runKpiAgent('adw-123', '/tmp/logs', 42, '/feature', 'specs/plan.md', ['adw_plan_iso']);

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[8]).toBeUndefined();
  });

  it('passes statePath as 8th argument when provided', async () => {
    await runKpiAgent('adw-123', '/tmp/logs', 42, '/feature', 'specs/plan.md', ['adw_plan_iso'], '/state/path');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[7]).toBe('/state/path');
  });

  it('passes issueBody to getModelForCommand and getEffortForCommand', async () => {
    const { getModelForCommand, getEffortForCommand } = await import('../../core');
    await runKpiAgent('adw-123', '/tmp/logs', 42, '/feature', 'specs/plan.md', ['adw_plan_iso'], undefined, undefined, '<!-- adw:fast -->');

    expect(getModelForCommand).toHaveBeenCalledWith('/track_agentic_kpis', '<!-- adw:fast -->');
    expect(getEffortForCommand).toHaveBeenCalledWith('/track_agentic_kpis', '<!-- adw:fast -->');
  });

  it('returns the agent result', async () => {
    const result = await runKpiAgent('adw-123', '/tmp/logs', 42, '/feature', 'specs/plan.md', ['adw_plan_iso']);

    expect(result.success).toBe(true);
    expect(result.output).toBe('Updated app_docs/agentic_kpis.md');
    expect(result.totalCostUsd).toBe(0.05);
  });
});
