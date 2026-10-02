import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core', () => ({ log: vi.fn() }));
vi.mock('../../core/environment', () => ({ COST_API_URL: '', COST_API_TOKEN: '' }));

import { transformToIngestPayload } from '../d1Client';
import type { PhaseCostRecord } from '../types';

interface IngestBody {
  readonly project: string;
  readonly records: readonly Record<string, unknown>[];
}

function recordWith(overrides: Partial<PhaseCostRecord>): PhaseCostRecord {
  return {
    workflowId: 'wf-1',
    issueNumber: 936,
    phase: 'plan',
    model: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    tokenUsage: { input: 10000, output: 2000, cache_read: 50000, cache_write: 4000 },
    computedCostUsd: 0.0126,
    reportedCostUsd: 0.0252,
    status: 'success',
    retryCount: 0,
    contextResetCount: 0,
    durationMs: 1000,
    timestamp: '2026-10-01T12:00:00.000Z',
    estimatedTokens: undefined,
    actualTokens: undefined,
    ...overrides,
  };
}

function sentRecords(records: readonly PhaseCostRecord[]): Record<string, unknown>[] {
  const payload = transformToIngestPayload({ project: 'acme-widgets', records });
  return (JSON.parse(JSON.stringify(payload)) as IngestBody).records.map(record => ({ ...record }));
}

describe('transformToIngestPayload', () => {
  it('sends the local computation as computed_cost_usd and the CLI figure as reported_cost_usd', () => {
    const [sent] = sentRecords([recordWith({ computedCostUsd: 0.0126, reportedCostUsd: 0.0252 })]);

    expect(sent['computed_cost_usd']).toBe(0.0126);
    expect(sent['reported_cost_usd']).toBe(0.0252);
  });

  it('sends no reported_cost_usd for a record without a CLI figure, which the Worker stores as NULL', () => {
    const [sent] = sentRecords([recordWith({ reportedCostUsd: undefined })]);

    expect(sent['computed_cost_usd']).toBe(0.0126);
    expect(sent).not.toHaveProperty('reported_cost_usd');
  });
});
