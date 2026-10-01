import { describe, it, expect } from 'vitest';
import { AnthropicTokenUsageExtractor } from '../providers/anthropic/extractor';
import { toLegacyModelUsageMap } from '../providers/anthropic/legacyModelUsage';
import { mergeModelUsageMaps } from '../costHelpers';
import { createPhaseCostRecords, PhaseCostStatus, type LegacyModelUsageMap, type PhaseCostRecord } from '../types';
import { checkDivergence } from '../computation';
import { formatDivergenceWarning, formatEstimateVsActual } from '../reporting/commentFormatter';

const MODEL = 'claude-sonnet-4-5-20250929';

const ASSISTANT_LINE = JSON.stringify({
  type: 'assistant',
  message: {
    id: 'msg_1',
    model: MODEL,
    usage: { input_tokens: 1000, cache_creation_input_tokens: 400, cache_read_input_tokens: 2000 },
    content: [{ type: 'text', text: 'x'.repeat(1600) }],
  },
});

function resultLine(cliCostUsd: number): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    session_id: 's-1',
    total_cost_usd: cliCostUsd,
    modelUsage: {
      [MODEL]: {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 2000,
        cacheCreationInputTokens: 400,
        costUSD: cliCostUsd,
      },
    },
  });
}

function usageOf(lines: string[]): LegacyModelUsageMap {
  const extractor = new AnthropicTokenUsageExtractor(MODEL);
  extractor.onChunk(lines.join('\n') + '\n');
  return toLegacyModelUsageMap(extractor);
}

function recordOf(usage: LegacyModelUsageMap, phase = 'plan'): PhaseCostRecord {
  const [record] = createPhaseCostRecords({
    workflowId: 'wf-1',
    issueNumber: 936,
    phase,
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: 0,
    modelUsage: usage,
  });
  return record;
}

describe('phase cost records built from a Claude CLI stream', () => {
  describe('reported cost against computed cost', () => {
    it('holds the CLI figure as the reported cost and the local computation as the computed cost, so the divergence check fires', () => {
      const record = recordOf(usageOf([ASSISTANT_LINE, resultLine(0.0252)]));

      expect(record.reportedCostUsd).toBe(0.0252);
      expect(record.computedCostUsd).toBeCloseTo(0.0126, 10);

      const divergence = checkDivergence(record.computedCostUsd, record.reportedCostUsd);
      expect(divergence.isDivergent).toBe(true);
      expect(divergence.percentDiff).toBeCloseTo(50, 5);

      const warning = formatDivergenceWarning([record]);
      expect(warning).toContain('Cost Divergence Detected');
      expect(warning).toContain('computed $0.0126 vs reported $0.0252');
    });

    it('stays silent when the CLI figure is within 5% of the computed cost', () => {
      const record = recordOf(usageOf([ASSISTANT_LINE, resultLine(0.0128)]));

      expect(record.reportedCostUsd).toBe(0.0128);
      expect(checkDivergence(record.computedCostUsd, record.reportedCostUsd).isDivergent).toBe(false);
      expect(formatDivergenceWarning([record])).toBe('');
    });
  });

  describe('estimated tokens against actual tokens', () => {
    it('carries the streamed estimate and the actual counts, which the estimate-against-actual report puts side by side', () => {
      const record = recordOf(usageOf([ASSISTANT_LINE, resultLine(0.0252)]));

      expect(record.estimatedTokens).toEqual({ input: 1000, cache_write: 400, cache_read: 2000, output: 400 });
      expect(record.actualTokens).toEqual({ input: 1000, output: 500, cache_read: 2000, cache_write: 400 });

      const report = formatEstimateVsActual([record]);
      expect(report).toContain('Estimate vs Actual Tokens');
      expect(report).toContain('| plan | claude-sonnet-4-5-20250929 | output | 400 | 500 | +100 | 25.0% |');
    });

    it('carries the estimate but no reported cost and no actual counts for a run that ends before the result message', () => {
      const record = recordOf(usageOf([ASSISTANT_LINE]));

      expect(record.estimatedTokens).toEqual({ input: 1000, cache_write: 400, cache_read: 2000, output: 400 });
      expect(record.actualTokens).toBeUndefined();
      expect(record.reportedCostUsd).toBeUndefined();
      expect(checkDivergence(record.computedCostUsd, record.reportedCostUsd).isDivergent).toBe(false);
      expect(formatEstimateVsActual([record])).toBe('');
    });
  });

  describe('runs merged into one record', () => {
    it('sums the CLI figures, the computed costs and the actual token counts of two finalized runs', () => {
      const first = usageOf([ASSISTANT_LINE, resultLine(0.0252)]);
      const second = usageOf([ASSISTANT_LINE, resultLine(0.0128)]);

      const record = recordOf(mergeModelUsageMaps(first, second));

      expect(record.reportedCostUsd).toBeCloseTo(0.038, 10);
      expect(record.estimatedTokens).toEqual({ input: 2000, cache_write: 800, cache_read: 4000, output: 800 });
      expect(record.actualTokens).toEqual({ input: 2000, output: 1000, cache_read: 4000, cache_write: 800 });
      expect(record.tokenUsage['input']).toBe(2000);
      expect(record.computedCostUsd).toBeCloseTo(0.0252, 10);
    });

    it('drops the reported cost and the actual tokens when one run ended before its result message', () => {
      const finalized = usageOf([ASSISTANT_LINE, resultLine(0.0252)]);
      const stopped = usageOf([ASSISTANT_LINE]);

      const record = recordOf(mergeModelUsageMaps(finalized, stopped));

      expect(record.reportedCostUsd).toBeUndefined();
      expect(record.actualTokens).toBeUndefined();
      expect(record.estimatedTokens).toEqual({ input: 2000, cache_write: 800, cache_read: 4000, output: 800 });
    });

    it('keeps the figures of the first entry merged into an empty map', () => {
      const usage = usageOf([ASSISTANT_LINE, resultLine(0.0252)]);

      const merged = mergeModelUsageMaps({}, usage)[MODEL];

      expect(merged.reportedCostUSD).toBe(0.0252);
      expect(merged.estimatedTokens).toEqual({ input: 1000, cache_write: 400, cache_read: 2000, output: 400 });
      expect(merged.actualTokens).toEqual({ input: 1000, output: 500, cache_read: 2000, cache_write: 400 });
    });

    it('leaves the merged entries unchanged', () => {
      const first = usageOf([ASSISTANT_LINE, resultLine(0.0252)]);
      const second = usageOf([ASSISTANT_LINE, resultLine(0.0128)]);
      const firstBefore = structuredClone(first);

      mergeModelUsageMaps(first, second);

      expect(first).toEqual(firstBefore);
    });
  });
});
