/**
 * When COST_API_URL is not set, writes are silently skipped. All errors are caught and
 * logged as warnings — D1 failures never crash the workflow.
 */

import { COST_API_URL, COST_API_TOKEN } from '../core/environment';
import { log } from '../core';
import type { PhaseCostRecord } from './types';

export interface IngestPayloadOptions {
  /** Project slug — used to resolve or auto-create the project row in D1. */
  readonly project: string;
  /** Display name for the project; used only during auto-creation. */
  readonly name?: string;
  /** GitHub/GitLab repo URL; used only during auto-creation. */
  readonly repoUrl?: string;
  readonly records: readonly PhaseCostRecord[];
}

export function transformToIngestPayload(options: IngestPayloadOptions): object {
  const { project, name, repoUrl, records } = options;

  const ingestRecords = records.map(r => ({
    workflow_id: r.workflowId,
    issue_number: r.issueNumber,
    phase: r.phase,
    model: r.model,
    provider: r.provider,
    token_usage: r.tokenUsage,
    computed_cost_usd: r.computedCostUsd,
    reported_cost_usd: r.reportedCostUsd,
    status: r.status,
    retry_count: r.retryCount,
    continuation_count: r.contextResetCount,
    duration_ms: r.durationMs,
    timestamp: r.timestamp,
  }));

  return {
    project,
    ...(name !== undefined && { name }),
    ...(repoUrl !== undefined && { repo_url: repoUrl }),
    records: ingestRecords,
  };
}

/**
 * Silently returns when COST_API_URL is not set or when records is empty.
 * Logs a warning on non-2xx responses or network errors, but never throws.
 */
export async function postCostRecordsToD1(options: IngestPayloadOptions): Promise<void> {
  if (!COST_API_URL) return;
  if (options.records.length === 0) return;

  const payload = transformToIngestPayload(options);

  try {
    const response = await fetch(`${COST_API_URL}/api/cost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${COST_API_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(unreadable)');
      log(`D1 write failed: HTTP ${response.status} from Cost API — ${body}`, 'warn');
    }
  } catch (error) {
    log(`D1 write failed: ${error}`, 'warn');
  }
}
