/**
 * CSV cost report writer: generates per-issue and project-level CSV files
 * from CostBreakdown data produced by the workflow cost tracking system.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CostBreakdown } from '../types/costTypes';
import { slugify, log } from './utils';

/** A row in the project-level total cost CSV. */
export interface ProjectCostRow {
  issueNumber: number;
  issueDescription: string;
  costUsd: number;
  markupUsd: number;
}

/** Returns the relative path for an issue's cost CSV file. */
export function getIssueCsvPath(repoName: string, issueNumber: number, issueTitle: string): string {
  const slug = slugify(issueTitle);
  return path.join('projects', repoName, `${issueNumber}-${slug}.csv`);
}

/** Returns the relative path for the project total cost CSV file. */
export function getProjectCsvPath(repoName: string): string {
  return path.join('projects', repoName, 'total-cost.csv');
}

/** Formats a per-issue cost breakdown as CSV content. */
export function formatIssueCostCsv(breakdown: CostBreakdown): string {
  const lines: string[] = [
    'Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)',
  ];

  for (const [model, usage] of Object.entries(breakdown.modelUsage)) {
    lines.push(
      `${model},${usage.inputTokens},${usage.outputTokens},${usage.cacheReadInputTokens},${usage.cacheCreationInputTokens},${usage.costUSD.toFixed(4)}`
    );
  }

  lines.push('');

  const eurEntry = breakdown.currencies.find(c => c.currency === 'EUR');
  const eurTotal = eurEntry ? eurEntry.amount.toFixed(4) : 'N/A';

  lines.push(`Total Cost (USD):,${breakdown.totalCostUsd.toFixed(4)}`);
  lines.push(`Total Cost (EUR):,${eurTotal}`);

  return lines.join('\n') + '\n';
}

/** Parses an existing project cost CSV, extracting data rows (skipping header and total lines). */
export function parseProjectCostCsv(csvContent: string): ProjectCostRow[] {
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  const rows: ProjectCostRow[] = [];

  for (const line of lines) {
    // Skip header and total summary lines
    if (line.startsWith('Issue number,') || line.startsWith('Total Cost')) {
      continue;
    }

    const parts = line.split(',');
    if (parts.length < 4) continue;

    const issueNumber = parseInt(parts[0], 10);
    if (isNaN(issueNumber)) continue;

    rows.push({
      issueNumber,
      issueDescription: parts[1],
      costUsd: parseFloat(parts[2]) || 0,
      markupUsd: parseFloat(parts[3]) || 0,
    });
  }

  return rows;
}

/** Formats the full project total cost CSV from an array of rows. */
export function formatProjectCostCsv(rows: ProjectCostRow[], eurRate: number): string {
  const lines: string[] = [
    'Issue number,Issue description,Cost (USD),Markup (10%)',
  ];

  for (const row of rows) {
    lines.push(
      `${row.issueNumber},${row.issueDescription},${row.costUsd.toFixed(4)},${row.markupUsd.toFixed(4)}`
    );
  }

  const totalUsd = rows.reduce((sum, row) => sum + row.costUsd + row.markupUsd, 0);
  const totalEur = eurRate > 0 ? (totalUsd * eurRate).toFixed(4) : 'N/A';

  lines.push('');
  lines.push(`Total Cost (USD):,${totalUsd.toFixed(4)}`);
  lines.push(`Total Cost (EUR):,${totalEur}`);

  return lines.join('\n') + '\n';
}

/** Parses an issue CSV file's content and extracts the Total Cost (USD) value. */
export function parseIssueCostTotal(csvContent: string): number {
  const line = csvContent.split('\n').find(l => l.startsWith('Total Cost (USD):,'));
  if (!line) return 0;
  const value = parseFloat(line.split(',')[1]);
  return isNaN(value) ? 0 : value;
}

/** Writes a per-issue cost CSV file. */
export function writeIssueCostCsv(
  repoRoot: string,
  repoName: string,
  issueNumber: number,
  issueTitle: string,
  breakdown: CostBreakdown,
): void {
  const relativePath = getIssueCsvPath(repoName, issueNumber, issueTitle);
  const fullPath = path.join(repoRoot, relativePath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, formatIssueCostCsv(breakdown), 'utf-8');

  log(`Issue cost CSV written: ${relativePath}`, 'success');
}

/** Rebuilds the project total cost CSV from scratch by scanning all individual issue CSV files. */
export function rebuildProjectCostCsv(
  repoRoot: string,
  repoName: string,
  eurRate: number,
): void {
  const projectDir = path.join(repoRoot, 'projects', repoName);
  fs.mkdirSync(projectDir, { recursive: true });

  const csvFiles = fs.existsSync(projectDir)
    ? fs.readdirSync(projectDir).filter(f => f.endsWith('.csv') && f !== 'total-cost.csv')
    : [];

  const rows: ProjectCostRow[] = csvFiles
    .map(filename => {
      const dashIndex = filename.indexOf('-');
      if (dashIndex === -1) return null;

      const issueNumber = parseInt(filename.substring(0, dashIndex), 10);
      if (isNaN(issueNumber)) return null;

      const issueDescription = filename.substring(dashIndex + 1).replace(/\.csv$/, '').replace(/-/g, ' ');
      const content = fs.readFileSync(path.join(projectDir, filename), 'utf-8');
      const costUsd = parseIssueCostTotal(content);

      return { issueNumber, issueDescription, costUsd, markupUsd: costUsd * 0.1 };
    })
    .filter((row): row is ProjectCostRow => row !== null)
    .sort((a, b) => a.issueNumber - b.issueNumber);

  const relativePath = getProjectCsvPath(repoName);
  const fullPath = path.join(repoRoot, relativePath);
  fs.writeFileSync(fullPath, formatProjectCostCsv(rows, eurRate), 'utf-8');

  log(`Project cost CSV rebuilt: ${relativePath}`, 'success');
}
