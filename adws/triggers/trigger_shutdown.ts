#!/usr/bin/env bunx tsx

/**
 * Shutdown trigger for ADW (AI Developer Workflow).
 *
 * Terminates all running cron and webhook trigger processes:
 * 1. Reads cron PID files from agents/cron/ and kills each live process
 * 2. Finds the webhook server process (trigger_webhook.ts) and kills it
 * 3. Cleans up stale PID files
 *
 * Usage: bunx tsx adws/triggers/trigger_shutdown.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { log } from '../core';
import { AGENTS_STATE_DIR } from '../core/config';
import { isProcessAlive } from '../core/stateHelpers';

interface CronPidRecord {
  pid: number;
  repoKey: string;
  startedAt: string;
}

/** Shuts down all cron processes registered via PID files. */
function shutdownCronProcesses(): number {
  const cronDir = path.join(AGENTS_STATE_DIR, 'cron');
  if (!fs.existsSync(cronDir)) {
    log('No cron PID directory found, skipping cron shutdown');
    return 0;
  }

  const pidFiles = fs.readdirSync(cronDir).filter((f) => f.endsWith('.json'));
  if (pidFiles.length === 0) {
    log('No cron PID files found');
    return 0;
  }

  let killed = 0;
  for (const file of pidFiles) {
    const filePath = path.join(cronDir, file);
    try {
      const record = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CronPidRecord;
      if (isProcessAlive(record.pid)) {
        process.kill(record.pid, 'SIGTERM');
        log(`Killed cron process PID ${record.pid} for ${record.repoKey}`, 'success');
        killed++;
      } else {
        log(`Cron PID ${record.pid} for ${record.repoKey} already dead, cleaning up`);
      }
      fs.unlinkSync(filePath);
    } catch (error) {
      log(`Failed to process cron PID file ${file}: ${error}`, 'error');
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  return killed;
}

/** Finds and kills webhook server processes (trigger_webhook.ts). */
function shutdownWebhookProcesses(): number {
  try {
    // Find processes matching trigger_webhook.ts, excluding this script and grep itself
    const output = execSync(
      `ps aux | grep 'trigger_webhook\\.ts' | grep -v grep | grep -v trigger_shutdown`,
      { encoding: 'utf-8' },
    ).trim();

    if (!output) {
      log('No webhook server processes found');
      return 0;
    }

    let killed = 0;
    for (const line of output.split('\n')) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;

      try {
        process.kill(pid, 'SIGTERM');
        log(`Killed webhook server process PID ${pid}`, 'success');
        killed++;
      } catch (error) {
        log(`Failed to kill webhook PID ${pid}: ${error}`, 'error');
      }
    }
    return killed;
  } catch {
    // grep exits with code 1 when no matches found
    log('No webhook server processes found');
    return 0;
  }
}

// --- Main ---
log('ADW trigger shutdown initiated');

const cronKilled = shutdownCronProcesses();
const webhookKilled = shutdownWebhookProcesses();
const total = cronKilled + webhookKilled;

if (total === 0) {
  log('No running trigger processes found');
} else {
  log(`Shutdown complete: ${cronKilled} cron + ${webhookKilled} webhook process(es) terminated`, 'success');
}
