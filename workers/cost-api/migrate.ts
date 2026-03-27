/**
 * One-time migration script: reads all historical CSV cost files from `projects/`
 * and uploads them to D1 via the Cost API Worker's POST /api/cost endpoint.
 *
 * Run: bunx tsx workers/cost-api/migrate.ts
 * Requires: COST_API_URL and COST_API_TOKEN env vars
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseIssueCostCsv } from '../../adws/cost/reporting/csvWriter.ts';
import type { PhaseCostRecord } from '../../adws/cost/types.ts';
import type { IngestPayload, IngestRecord } from './src/types.ts';

// ---------------------------------------------------------------------------
// Project metadata
// ---------------------------------------------------------------------------

interface ProjectMeta {
  readonly name: string;
  readonly repoUrl: string;
}

const PROJECT_META: Readonly<Record<string, ProjectMeta>> = {
  AI_Dev_Workflow: { name: 'AI Dev Workflow', repoUrl: 'https://github.com/paysdoc/AI_Dev_Workflow' },
  Millennium: { name: 'Millennium', repoUrl: 'https://github.com/paysdoc/Millennium' },
  vestmatic: { name: 'vestmatic', repoUrl: 'https://github.com/paysdoc/vestmatic' },
};

// ---------------------------------------------------------------------------
// Filename parsing
// ---------------------------------------------------------------------------

interface FilenameInfo {
  readonly issueNumber: number;
  readonly issueDescription: string;
}

/**
 * Extracts issue number and description from a CSV filename.
 *
 * Handles two patterns:
 * - `0-{type}-{issueNumber}-{description}.csv`  → strips `0-{type}-` prefix
 * - `{issueNumber}-{description}.csv`
 */
function parseFilename(filename: string): FilenameInfo | null {
  const base = filename.replace(/\.csv$/, '');

  // Old `0-` prefix pattern: 0-bug-52-issue-desc
  const zeroPrefixMatch = base.match(/^0-[a-z]+-(\d+)-(.+)$/);
  if (zeroPrefixMatch) {
    const issueNumber = parseInt(zeroPrefixMatch[1], 10);
    const issueDescription = zeroPrefixMatch[2].replace(/-/g, ' ');
    return { issueNumber, issueDescription };
  }

  // Standard pattern: 113-define-issuetracker...
  const standardMatch = base.match(/^(\d+)-(.+)$/);
  if (standardMatch) {
    const issueNumber = parseInt(standardMatch[1], 10);
    const issueDescription = standardMatch[2].replace(/-/g, ' ');
    return { issueNumber, issueDescription };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Old-format CSV parser
// ---------------------------------------------------------------------------

/**
 * Parses an old-format CSV into IngestRecord[].
 * Header: `Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)`
 * Skips summary lines starting with "Total Cost".
 */
function parseOldFormatCsv(
  content: string,
  filename: string,
  _project: string,
): IngestRecord[] {
  const filenameInfo = parseFilename(filename);
  if (!filenameInfo) {
    console.warn(`  [skip] Cannot parse filename: ${filename}`);
    return [];
  }

  const lines = content.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];

  // Validate header
  if (!lines[0].startsWith('Model,')) return [];

  return lines.slice(1).flatMap((line): IngestRecord[] => {
    // Skip summary lines
    if (line.startsWith('Total Cost')) return [];

    const parts = line.split(',');
    if (parts.length < 6) return [];

    const model = parts[0].trim();
    if (!model) return [];

    const inputTokens = parseInt(parts[1], 10) || 0;
    const outputTokens = parseInt(parts[2], 10) || 0;
    const cacheRead = parseInt(parts[3], 10) || 0;
    const cacheWrite = parseInt(parts[4], 10) || 0;
    const cost = parseFloat(parts[5]) || 0;

    return [{
      issue_number: filenameInfo.issueNumber,
      issue_description: filenameInfo.issueDescription,
      phase: 'unknown',
      model,
      provider: 'anthropic',
      computed_cost_usd: cost,
      token_usage: {
        input: inputTokens,
        output: outputTokens,
        cache_read: cacheRead,
        cache_write: cacheWrite,
      },
      migrated: true,
    }];
  });
}

// ---------------------------------------------------------------------------
// New-format CSV converter
// ---------------------------------------------------------------------------

/**
 * Converts PhaseCostRecord[] (from parseIssueCostCsv) into IngestRecord[].
 */
function convertNewFormatRecords(records: PhaseCostRecord[]): IngestRecord[] {
  return records.map(r => ({
    workflow_id: r.workflowId,
    issue_number: r.issueNumber,
    phase: r.phase,
    model: r.model,
    provider: r.provider,
    computed_cost_usd: r.computedCostUsd,
    reported_cost_usd: r.reportedCostUsd,
    status: r.status,
    retry_count: r.retryCount,
    continuation_count: r.contextResetCount,
    duration_ms: r.durationMs,
    timestamp: r.timestamp,
    token_usage: r.tokenUsage,
    migrated: true,
  }));
}

// ---------------------------------------------------------------------------
// Directory scanner
// ---------------------------------------------------------------------------

/**
 * Scans a project directory, parses all non-total CSV files, and returns IngestRecord[].
 */
function scanProjectDirectory(projectDir: string, project: string): IngestRecord[] {
  if (!fs.existsSync(projectDir)) {
    console.log(`  [info] Directory not found, skipping: ${projectDir}`);
    return [];
  }

  const csvFiles = fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.csv') && f !== 'total-cost.csv')
    .sort();

  if (csvFiles.length === 0) {
    console.log(`  [info] No CSV files found in ${projectDir}`);
    return [];
  }

  return csvFiles.flatMap(filename => {
    const content = fs.readFileSync(path.join(projectDir, filename), 'utf-8');
    const isNewFormat = content.split('\n')[0]?.includes('workflow_id') ?? false;

    if (isNewFormat) {
      const records = parseIssueCostCsv(content);
      const ingestRecords = convertNewFormatRecords(records);
      console.log(`  [new]  ${filename} → ${ingestRecords.length} record(s)`);
      return ingestRecords;
    } else {
      const ingestRecords = parseOldFormatCsv(content, filename, project);
      console.log(`  [old]  ${filename} → ${ingestRecords.length} record(s)`);
      return ingestRecords;
    }
  });
}

// ---------------------------------------------------------------------------
// Batch uploader
// ---------------------------------------------------------------------------

interface UploadResult {
  readonly batches: number;
  readonly inserted: number;
  readonly errors: string[];
}

/**
 * Splits records into batches and POSTs each to the Worker's /api/cost endpoint.
 */
async function uploadBatches(
  records: IngestRecord[],
  project: string,
  apiUrl: string,
  apiToken: string,
  batchSize = 50,
): Promise<UploadResult> {
  const meta = PROJECT_META[project];
  if (!meta) throw new Error(`Unknown project: ${project}`);

  let inserted = 0;
  let batches = 0;
  const errors: string[] = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const payload: IngestPayload = {
      project,
      name: meta.name,
      repo_url: meta.repoUrl,
      records: batch,
    };

    try {
      const response = await fetch(`${apiUrl}/api/cost`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 201) {
        const body = await response.json() as { inserted: number };
        inserted += body.inserted;
        batches++;
        console.log(`  [ok]   batch ${batches}: inserted ${body.inserted} record(s)`);
      } else {
        const body = await response.text();
        const msg = `batch ${batches + 1} failed (HTTP ${response.status}): ${body}`;
        console.error(`  [err]  ${msg}`);
        errors.push(msg);
        batches++;
      }
    } catch (err) {
      const msg = `batch ${batches + 1} network error: ${String(err)}`;
      console.error(`  [err]  ${msg}`);
      errors.push(msg);
      batches++;
    }
  }

  return { batches, inserted, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiUrl = process.env['COST_API_URL'];
  const apiToken = process.env['COST_API_TOKEN'];

  if (!apiUrl) {
    console.error('Error: COST_API_URL environment variable is required');
    process.exit(1);
  }
  if (!apiToken) {
    console.error('Error: COST_API_TOKEN environment variable is required');
    process.exit(1);
  }

  const repoRoot = path.resolve(import.meta.dirname, '../..');
  const projects = ['AI_Dev_Workflow', 'Millennium', 'vestmatic'] as const;

  const summary: Array<{ project: string; records: number; inserted: number; errors: string[] }> = [];

  for (const project of projects) {
    console.log(`\n=== ${project} ===`);
    const projectDir = path.join(repoRoot, 'projects', project);
    const records = scanProjectDirectory(projectDir, project);

    console.log(`  Total: ${records.length} record(s) to upload`);

    if (records.length === 0) {
      summary.push({ project, records: 0, inserted: 0, errors: [] });
      continue;
    }

    const result = await uploadBatches(records, project, apiUrl, apiToken);
    summary.push({ project, records: records.length, inserted: result.inserted, errors: result.errors });
  }

  console.log('\n=== Migration Summary ===');
  let totalRecords = 0;
  let totalInserted = 0;
  let totalErrors = 0;

  for (const entry of summary) {
    const status = entry.errors.length === 0 ? 'ok' : `${entry.errors.length} error(s)`;
    console.log(`  ${entry.project}: ${entry.records} scanned, ${entry.inserted} inserted [${status}]`);
    totalRecords += entry.records;
    totalInserted += entry.inserted;
    totalErrors += entry.errors.length;
  }

  console.log(`\n  Total: ${totalRecords} scanned, ${totalInserted} inserted, ${totalErrors} batch error(s)`);

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
