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
  parseIssueCostTotal,
  rebuildProjectCostCsv,
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

  describe('parseIssueCostTotal', () => {
    it('parses valid issue CSV content and returns the correct total', () => {
      const csv = [
        'Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)',
        'claude-opus-4-6,45,11896,1190928,26536,1.0589',
        'claude-haiku-4-5-20251001,21308,1156,0,0,0.0271',
        '',
        'Total Cost (USD):,1.5378',
        'Total Cost (EUR):,1.3030',
      ].join('\n');

      expect(parseIssueCostTotal(csv)).toBe(1.5378);
    });

    it('returns 0 for content without a Total Cost (USD) line', () => {
      const csv = 'Model,Input Tokens\nsonnet,100';
      expect(parseIssueCostTotal(csv)).toBe(0);
    });

    it('returns 0 for empty content', () => {
      expect(parseIssueCostTotal('')).toBe(0);
    });
  });

  describe('rebuildProjectCostCsv', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const writeIssueCsv = (dir: string, filename: string, totalCostUsd: number): void => {
      const projectDir = path.join(dir, 'projects', 'test-repo');
      fs.mkdirSync(projectDir, { recursive: true });
      const content = [
        'Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)',
        `sonnet,100,50,0,0,${totalCostUsd.toFixed(4)}`,
        '',
        `Total Cost (USD):,${totalCostUsd.toFixed(4)}`,
        `Total Cost (EUR):,N/A`,
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(projectDir, filename), content, 'utf-8');
    };

    it('rebuilds correctly from multiple issue CSV files', () => {
      writeIssueCsv(tmpDir, '1-add-login.csv', 2.0);
      writeIssueCsv(tmpDir, '2-fix-bug.csv', 1.0);

      rebuildProjectCostCsv(tmpDir, 'test-repo', 0.92);

      const csvPath = path.join(tmpDir, 'projects', 'test-repo', 'total-cost.csv');
      const content = fs.readFileSync(csvPath, 'utf-8');
      const rows = parseProjectCostCsv(content);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ issueNumber: 1, issueDescription: 'add login', costUsd: 2.0, markupUsd: 0.2 });
      expect(rows[1]).toEqual({ issueNumber: 2, issueDescription: 'fix bug', costUsd: 1.0, markupUsd: 0.1 });
      // Total: (2.0+0.2) + (1.0+0.1) = 3.3; EUR: 3.3 * 0.92 = 3.036
      expect(content).toContain('Total Cost (USD):,3.3000');
      expect(content).toContain('Total Cost (EUR):,3.0360');
    });

    it('creates empty CSV when project directory has no issue files', () => {
      rebuildProjectCostCsv(tmpDir, 'test-repo', 0.92);

      const csvPath = path.join(tmpDir, 'projects', 'test-repo', 'total-cost.csv');
      const content = fs.readFileSync(csvPath, 'utf-8');
      const rows = parseProjectCostCsv(content);

      expect(rows).toHaveLength(0);
      expect(content).toContain('Total Cost (USD):,0.0000');
    });

    it('skips total-cost.csv when scanning files', () => {
      writeIssueCsv(tmpDir, '1-some-issue.csv', 1.5);
      // Write a total-cost.csv with stale data
      const projectDir = path.join(tmpDir, 'projects', 'test-repo');
      fs.writeFileSync(path.join(projectDir, 'total-cost.csv'), 'stale data', 'utf-8');

      rebuildProjectCostCsv(tmpDir, 'test-repo', 0.92);

      const content = fs.readFileSync(path.join(projectDir, 'total-cost.csv'), 'utf-8');
      const rows = parseProjectCostCsv(content);

      expect(rows).toHaveLength(1);
      expect(rows[0].issueNumber).toBe(1);
    });

    it('skips files that do not follow the {number}-{slug}.csv naming pattern', () => {
      writeIssueCsv(tmpDir, '1-valid-issue.csv', 1.0);
      // Write files with invalid naming patterns
      const projectDir = path.join(tmpDir, 'projects', 'test-repo');
      fs.writeFileSync(path.join(projectDir, 'notes.csv'), 'some notes', 'utf-8');
      fs.writeFileSync(path.join(projectDir, 'abc-not-a-number.csv'), 'invalid', 'utf-8');

      rebuildProjectCostCsv(tmpDir, 'test-repo', 0.92);

      const content = fs.readFileSync(path.join(projectDir, 'total-cost.csv'), 'utf-8');
      const rows = parseProjectCostCsv(content);

      expect(rows).toHaveLength(1);
      expect(rows[0].issueNumber).toBe(1);
    });

    it('sorts rows by issue number ascending', () => {
      writeIssueCsv(tmpDir, '10-later-issue.csv', 3.0);
      writeIssueCsv(tmpDir, '2-middle-issue.csv', 2.0);
      writeIssueCsv(tmpDir, '1-first-issue.csv', 1.0);

      rebuildProjectCostCsv(tmpDir, 'test-repo', 0.92);

      const csvPath = path.join(tmpDir, 'projects', 'test-repo', 'total-cost.csv');
      const rows = parseProjectCostCsv(fs.readFileSync(csvPath, 'utf-8'));

      expect(rows.map(r => r.issueNumber)).toEqual([1, 2, 10]);
    });

    it('reflects latest cost with no duplicates on re-run', () => {
      writeIssueCsv(tmpDir, '6-set-up-adw-environment.csv', 1.1719);
      rebuildProjectCostCsv(tmpDir, 'test-repo', 0.92);

      // Overwrite with updated cost (simulating a re-run)
      writeIssueCsv(tmpDir, '6-set-up-adw-environment.csv', 1.5378);
      rebuildProjectCostCsv(tmpDir, 'test-repo', 0.92);

      const csvPath = path.join(tmpDir, 'projects', 'test-repo', 'total-cost.csv');
      const rows = parseProjectCostCsv(fs.readFileSync(csvPath, 'utf-8'));

      expect(rows).toHaveLength(1);
      expect(rows[0].issueNumber).toBe(6);
      expect(rows[0].costUsd).toBe(1.5378);
    });
  });
});
