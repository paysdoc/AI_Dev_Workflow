import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getIssueCsvPath,
  getProjectCsvPath,
  formatIssueCostCsv,
  formatProjectCostCsv,
  parseProjectCostCsv,
  writeIssueCostCsv,
  updateProjectCostCsv,
} from '../core/costCsvWriter';
import type { CostBreakdown } from '../core/costTypes';
import type { ProjectCostRow } from '../core/costCsvWriter';

vi.mock('../core/utils', () => ({
  slugify: (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50),
  log: vi.fn(),
}));

describe('costCsvWriter', () => {
  describe('getIssueCsvPath', () => {
    it('returns correct path with slugified title', () => {
      const result = getIssueCsvPath('my-repo', 8, 'Move cost breakdown into CSV file');
      expect(result).toBe(path.join('projects', 'my-repo', '8-move-cost-breakdown-into-csv-file.csv'));
    });

    it('handles special characters in title', () => {
      const result = getIssueCsvPath('repo', 42, 'Fix bug: handle <special> chars!');
      expect(result).toBe(path.join('projects', 'repo', '42-fix-bug-handle-special-chars.csv'));
    });
  });

  describe('getProjectCsvPath', () => {
    it('returns correct path', () => {
      const result = getProjectCsvPath('my-repo');
      expect(result).toBe(path.join('projects', 'my-repo', 'total-cost.csv'));
    });
  });

  describe('formatIssueCostCsv', () => {
    it('produces correct CSV with multiple models', () => {
      const breakdown: CostBreakdown = {
        totalCostUsd: 2.5,
        modelUsage: {
          'sonnet': { inputTokens: 10000, outputTokens: 5000, cacheReadInputTokens: 20000, cacheCreationInputTokens: 1000, costUSD: 2.0 },
          'haiku': { inputTokens: 5000, outputTokens: 2000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 },
        },
        currencies: [{ currency: 'EUR', amount: 2.3, symbol: '€' }],
      };

      const csv = formatIssueCostCsv(breakdown);
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)');
      expect(lines[1]).toBe('sonnet,10000,5000,20000,1000,2.0000');
      expect(lines[2]).toBe('haiku,5000,2000,0,0,0.5000');
      expect(lines[3]).toBe('');
      expect(lines[4]).toBe('Total Cost (USD):,2.5000');
      expect(lines[5]).toBe('Total Cost (EUR):,2.3000');
    });

    it('handles empty model usage', () => {
      const breakdown: CostBreakdown = {
        totalCostUsd: 0,
        modelUsage: {},
        currencies: [],
      };

      const csv = formatIssueCostCsv(breakdown);
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)');
      expect(lines[1]).toBe('');
      expect(lines[2]).toBe('Total Cost (USD):,0.0000');
      expect(lines[3]).toBe('Total Cost (EUR):,N/A');
    });

    it('shows N/A when no EUR currency is available', () => {
      const breakdown: CostBreakdown = {
        totalCostUsd: 1.0,
        modelUsage: {
          'opus': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.0 },
        },
        currencies: [{ currency: 'GBP', amount: 0.79, symbol: '£' }],
      };

      const csv = formatIssueCostCsv(breakdown);
      expect(csv).toContain('Total Cost (EUR):,N/A');
    });
  });

  describe('parseProjectCostCsv', () => {
    it('parses valid CSV content', () => {
      const csv = [
        'Issue number,Issue description,Cost (USD),Markup (10%)',
        '1,Add login,1.5000,0.1500',
        '2,Fix bug,0.8000,0.0800',
        '',
        'Total Cost (USD):,2.5300',
        'Total Cost (EUR):,2.3276',
      ].join('\n');

      const rows = parseProjectCostCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ issueNumber: 1, issueDescription: 'Add login', costUsd: 1.5, markupUsd: 0.15 });
      expect(rows[1]).toEqual({ issueNumber: 2, issueDescription: 'Fix bug', costUsd: 0.8, markupUsd: 0.08 });
    });

    it('returns empty array for header-only content', () => {
      const csv = 'Issue number,Issue description,Cost (USD),Markup (10%)\n';
      const rows = parseProjectCostCsv(csv);
      expect(rows).toHaveLength(0);
    });

    it('returns empty array for empty content', () => {
      const rows = parseProjectCostCsv('');
      expect(rows).toHaveLength(0);
    });

    it('skips total summary lines', () => {
      const csv = [
        'Issue number,Issue description,Cost (USD),Markup (10%)',
        '5,Feature X,3.0000,0.3000',
        'Total Cost (USD):,3.3000',
        'Total Cost (EUR):,3.0360',
      ].join('\n');

      const rows = parseProjectCostCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].issueNumber).toBe(5);
    });
  });

  describe('formatProjectCostCsv', () => {
    it('produces correct CSV with data rows and totals', () => {
      const rows: ProjectCostRow[] = [
        { issueNumber: 1, issueDescription: 'Add login', costUsd: 1.5, markupUsd: 0.15 },
        { issueNumber: 2, issueDescription: 'Fix bug', costUsd: 0.8, markupUsd: 0.08 },
      ];

      const csv = formatProjectCostCsv(rows, 0.92);
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('Issue number,Issue description,Cost (USD),Markup (10%)');
      expect(lines[1]).toBe('1,Add login,1.5000,0.1500');
      expect(lines[2]).toBe('2,Fix bug,0.8000,0.0800');
      expect(lines[3]).toBe('');
      // Total: (1.5 + 0.15) + (0.8 + 0.08) = 2.53
      expect(lines[4]).toBe('Total Cost (USD):,2.5300');
      // EUR: 2.53 * 0.92 = 2.3276
      expect(lines[5]).toBe('Total Cost (EUR):,2.3276');
    });

    it('handles empty rows', () => {
      const csv = formatProjectCostCsv([], 0.92);
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('Issue number,Issue description,Cost (USD),Markup (10%)');
      expect(lines[1]).toBe('');
      expect(lines[2]).toBe('Total Cost (USD):,0.0000');
      expect(lines[3]).toBe('Total Cost (EUR):,0.0000');
    });

    it('shows N/A when EUR rate is zero', () => {
      const rows: ProjectCostRow[] = [
        { issueNumber: 1, issueDescription: 'Test', costUsd: 1.0, markupUsd: 0.1 },
      ];

      const csv = formatProjectCostCsv(rows, 0);
      expect(csv).toContain('Total Cost (EUR):,N/A');
    });
  });

  describe('writeIssueCostCsv', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates directory and writes file', () => {
      const breakdown: CostBreakdown = {
        totalCostUsd: 1.0,
        modelUsage: {
          'sonnet': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.0 },
        },
        currencies: [{ currency: 'EUR', amount: 0.92, symbol: '€' }],
      };

      writeIssueCostCsv(tmpDir, 'test-repo', 8, 'My Issue Title', breakdown);

      const expectedPath = path.join(tmpDir, 'projects', 'test-repo', '8-my-issue-title.csv');
      expect(fs.existsSync(expectedPath)).toBe(true);

      const content = fs.readFileSync(expectedPath, 'utf-8');
      expect(content).toContain('Model,Input Tokens');
      expect(content).toContain('sonnet,100,50,0,0,1.0000');
      expect(content).toContain('Total Cost (USD):,1.0000');
      expect(content).toContain('Total Cost (EUR):,0.9200');
    });
  });

  describe('updateProjectCostCsv', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates new CSV when none exists', () => {
      updateProjectCostCsv(tmpDir, 'test-repo', 1, 'First Issue', 2.0, 0.92);

      const csvPath = path.join(tmpDir, 'projects', 'test-repo', 'total-cost.csv');
      expect(fs.existsSync(csvPath)).toBe(true);

      const content = fs.readFileSync(csvPath, 'utf-8');
      expect(content).toContain('Issue number,Issue description,Cost (USD),Markup (10%)');
      expect(content).toContain('1,First Issue,2.0000,0.2000');
      // Total: 2.0 + 0.2 = 2.2; EUR: 2.2 * 0.92 = 2.024
      expect(content).toContain('Total Cost (USD):,2.2000');
      expect(content).toContain('Total Cost (EUR):,2.0240');
    });

    it('appends to existing CSV and updates totals', () => {
      updateProjectCostCsv(tmpDir, 'test-repo', 1, 'First Issue', 2.0, 0.92);
      updateProjectCostCsv(tmpDir, 'test-repo', 2, 'Second Issue', 1.0, 0.92);

      const csvPath = path.join(tmpDir, 'projects', 'test-repo', 'total-cost.csv');
      const content = fs.readFileSync(csvPath, 'utf-8');

      expect(content).toContain('1,First Issue,2.0000,0.2000');
      expect(content).toContain('2,Second Issue,1.0000,0.1000');
      // Total: (2.0 + 0.2) + (1.0 + 0.1) = 3.3; EUR: 3.3 * 0.92 = 3.036
      expect(content).toContain('Total Cost (USD):,3.3000');
      expect(content).toContain('Total Cost (EUR):,3.0360');
    });

    it('handles multiple sequential updates correctly', () => {
      updateProjectCostCsv(tmpDir, 'test-repo', 1, 'Issue A', 1.0, 0.92);
      updateProjectCostCsv(tmpDir, 'test-repo', 2, 'Issue B', 2.0, 0.92);
      updateProjectCostCsv(tmpDir, 'test-repo', 3, 'Issue C', 3.0, 0.92);

      const csvPath = path.join(tmpDir, 'projects', 'test-repo', 'total-cost.csv');
      const content = fs.readFileSync(csvPath, 'utf-8');
      const rows = parseProjectCostCsv(content);

      expect(rows).toHaveLength(3);
      expect(rows[0].issueNumber).toBe(1);
      expect(rows[1].issueNumber).toBe(2);
      expect(rows[2].issueNumber).toBe(3);

      // Total: (1+0.1) + (2+0.2) + (3+0.3) = 6.6
      expect(content).toContain('Total Cost (USD):,6.6000');
    });
  });
});
