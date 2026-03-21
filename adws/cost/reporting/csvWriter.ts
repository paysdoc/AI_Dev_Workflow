/**
 * New CSV writer for PhaseCostRecord data.
 * Produces per-issue CSVs (one row per model per phase) and the project total CSV
 * (one row per issue per phase). Token type columns are dynamic: a fixed superset
 * is always present, and unknown token types are appended alphabetically.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PhaseCostRecord } from '../types';
import { PhaseCostStatus } from '../types';
import { slugify, log } from '../../core/utils';

/** Fixed superset of token columns always present in every CSV, in display order. */
export const FIXED_TOKEN_COLUMNS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'] as const;

/** A row in the project-level total cost CSV (no markup). */
export interface ProjectTotalRow {
  readonly issueNumber: number;
  readonly issueDescription: string;
  readonly phase: string;
  readonly model: string;
  readonly costUsd: number;
}

/**
 * Collects all token type keys across all records.
 * Returns FIXED_TOKEN_COLUMNS first, then any unknown types appended alphabetically.
 */
export function collectAllTokenTypes(records: readonly PhaseCostRecord[]): string[] {
  const known = new Set<string>(FIXED_TOKEN_COLUMNS);
  const extras = new Set<string>();

  for (const record of records) {
    for (const key of Object.keys(record.tokenUsage)) {
      if (!known.has(key)) {
        extras.add(key);
      }
    }
  }

  return [...FIXED_TOKEN_COLUMNS, ...[...extras].sort()];
}

/** Escapes a CSV field value by quoting if it contains commas, quotes, or newlines. */
function csvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a PhaseCostRecord[] to CSV content with dynamic token type columns.
 * Header: workflow_id, issue_number, phase, model, provider, computed_cost_usd,
 *         reported_cost_usd, status, retry_count, continuation_count, duration_ms,
 *         timestamp, estimated_tokens, actual_tokens, [token columns...]
 */
export function formatIssueCostCsv(records: readonly PhaseCostRecord[]): string {
  const tokenColumns = collectAllTokenTypes(records);
  const header = [
    'workflow_id',
    'issue_number',
    'phase',
    'model',
    'provider',
    'computed_cost_usd',
    'reported_cost_usd',
    'status',
    'retry_count',
    'continuation_count',
    'duration_ms',
    'timestamp',
    'estimated_tokens',
    'actual_tokens',
    ...tokenColumns,
  ].join(',');

  const rows = records.map(r => [
    csvField(r.workflowId),
    csvField(r.issueNumber),
    csvField(r.phase),
    csvField(r.model),
    csvField(r.provider),
    csvField(r.computedCostUsd.toFixed(6)),
    csvField((r.reportedCostUsd ?? 0).toFixed(6)),
    csvField(r.status),
    csvField(r.retryCount),
    csvField(r.continuationCount),
    csvField(r.durationMs),
    csvField(r.timestamp),
    csvField(r.estimatedTokens ? JSON.stringify(r.estimatedTokens) : ''),
    csvField(r.actualTokens ? JSON.stringify(r.actualTokens) : ''),
    ...tokenColumns.map(col => csvField(r.tokenUsage[col] ?? 0)),
  ].join(','));

  return [header, ...rows].join('\n') + '\n';
}

/** Returns the relative path for an issue's cost CSV file. */
function getIssueCsvPath(repoName: string, issueNumber: number, issueTitle: string): string {
  const slug = slugify(issueTitle);
  return path.join('projects', repoName, `${issueNumber}-${slug}.csv`);
}

/**
 * Writes a per-issue cost CSV from a complete set of PhaseCostRecord[].
 * Overwrites any existing file.
 */
export function writeIssueCostCsv(
  repoRoot: string,
  repoName: string,
  issueNumber: number,
  issueTitle: string,
  records: readonly PhaseCostRecord[],
): void {
  const relativePath = getIssueCsvPath(repoName, issueNumber, issueTitle);
  const fullPath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, formatIssueCostCsv(records), 'utf-8');
  log(`Issue cost CSV written: ${relativePath}`, 'success');
}

/**
 * Parses a new-format issue cost CSV back into PhaseCostRecord[].
 * Returns an empty array when csvContent is empty or the format is unrecognised
 * (e.g., an old-format CSV that lacks the 'workflow_id' header column).
 */
export function parseIssueCostCsv(csvContent: string): PhaseCostRecord[] {
  const lines = csvContent.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];

  const header = lines[0].split(',');
  // Detect old-format CSV by checking for the new format's sentinel column
  if (!header.includes('workflow_id')) return [];

  const idx = (col: string): number => header.indexOf(col);
  const fixedCols = new Set([
    'workflow_id', 'issue_number', 'phase', 'model', 'provider',
    'computed_cost_usd', 'reported_cost_usd', 'status', 'retry_count',
    'continuation_count', 'duration_ms', 'timestamp', 'estimated_tokens', 'actual_tokens',
  ]);
  const tokenCols = header.filter(h => !fixedCols.has(h));

  return lines.slice(1).map(line => {
    const parts = line.split(',');
    const get = (col: string): string => parts[idx(col)]?.trim() ?? '';

    const tokenUsage: Record<string, number> = {};
    for (const col of tokenCols) {
      tokenUsage[col] = parseFloat(parts[idx(col)] ?? '0') || 0;
    }

    return {
      workflowId: get('workflow_id'),
      issueNumber: parseInt(get('issue_number'), 10) || 0,
      phase: get('phase'),
      model: get('model'),
      provider: get('provider'),
      computedCostUsd: parseFloat(get('computed_cost_usd')) || 0,
      reportedCostUsd: parseFloat(get('reported_cost_usd')) || 0,
      status: (get('status') as PhaseCostStatus) || PhaseCostStatus.Success,
      retryCount: parseInt(get('retry_count'), 10) || 0,
      continuationCount: parseInt(get('continuation_count'), 10) || 0,
      durationMs: parseInt(get('duration_ms'), 10) || 0,
      timestamp: get('timestamp'),
      estimatedTokens: get('estimated_tokens') ? JSON.parse(get('estimated_tokens')) as Record<string, number> : undefined,
      actualTokens: get('actual_tokens') ? JSON.parse(get('actual_tokens')) as Record<string, number> : undefined,
      tokenUsage,
    };
  });
}

/**
 * Reads an existing per-issue CSV (if any), parses into PhaseCostRecord[],
 * merges with newRecords, and rewrites. Old-format CSVs are silently replaced.
 * Supports per-phase incremental writes.
 */
export function appendIssueCostCsv(
  repoRoot: string,
  repoName: string,
  issueNumber: number,
  issueTitle: string,
  newRecords: readonly PhaseCostRecord[],
): void {
  const relativePath = getIssueCsvPath(repoName, issueNumber, issueTitle);
  const fullPath = path.join(repoRoot, relativePath);

  let existingRecords: PhaseCostRecord[] = [];
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    existingRecords = parseIssueCostCsv(content);
    // existingRecords is empty when the file is old-format — silently overwrite
  }

  const merged = [...existingRecords, ...newRecords];
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, formatIssueCostCsv(merged), 'utf-8');
  log(`Issue cost CSV updated: ${relativePath}`, 'success');
}

/**
 * Extracts the total computed USD cost from a new-format issue CSV.
 * Returns 0 when the file is empty or uses the old format.
 */
export function parseIssueCostTotal(csvContent: string): number {
  const records = parseIssueCostCsv(csvContent);
  return records.reduce((sum, r) => sum + r.computedCostUsd, 0);
}

/**
 * Formats the project total CSV — one row per (issue, phase, model), no markup.
 * Columns: Issue number, Issue description, Phase, Model, Cost (USD)
 * Includes a totals row at the bottom.
 */
export function formatProjectTotalCsv(rows: readonly ProjectTotalRow[], eurRate: number): string {
  const header = 'Issue number,Issue description,Phase,Model,Cost (USD)';
  const dataRows = rows.map(r =>
    [
      csvField(r.issueNumber),
      csvField(r.issueDescription),
      csvField(r.phase),
      csvField(r.model),
      csvField(r.costUsd.toFixed(6)),
    ].join(',')
  );

  const totalUsd = rows.reduce((sum, r) => sum + r.costUsd, 0);
  const totalEur = eurRate > 0 ? (totalUsd * eurRate).toFixed(4) : 'N/A';

  const totals = [
    '',
    `Total Cost (USD):,${totalUsd.toFixed(4)}`,
    `Total Cost (EUR):,${totalEur}`,
  ];

  return [header, ...dataRows, ...totals].join('\n') + '\n';
}

/**
 * Rebuilds the project total CSV from scratch by scanning all issue CSVs
 * in projects/<repoName>/. Only new-format CSVs contribute rows.
 */
export function rebuildProjectTotalCsv(repoRoot: string, repoName: string, eurRate: number): void {
  const projectDir = path.join(repoRoot, 'projects', repoName);
  fs.mkdirSync(projectDir, { recursive: true });

  const csvFiles = fs.existsSync(projectDir)
    ? fs.readdirSync(projectDir).filter(f => f.endsWith('.csv') && f !== 'total-cost.csv')
    : [];

  const rows: ProjectTotalRow[] = csvFiles.flatMap(filename => {
    const dashIndex = filename.indexOf('-');
    if (dashIndex === -1) return [];

    const issueNumber = parseInt(filename.substring(0, dashIndex), 10);
    if (isNaN(issueNumber)) return [];

    const issueDescription = filename.substring(dashIndex + 1).replace(/\.csv$/, '').replace(/-/g, ' ');
    const content = fs.readFileSync(path.join(projectDir, filename), 'utf-8');
    const records = parseIssueCostCsv(content);

    return records.map(r => ({
      issueNumber,
      issueDescription,
      phase: r.phase,
      model: r.model,
      costUsd: r.computedCostUsd,
    }));
  }).sort((a, b) => a.issueNumber - b.issueNumber || a.phase.localeCompare(b.phase));

  const totalPath = path.join(projectDir, 'total-cost.csv');
  fs.writeFileSync(totalPath, formatProjectTotalCsv(rows, eurRate), 'utf-8');
  log(`Project total CSV rebuilt: projects/${repoName}/total-cost.csv`, 'success');
}
