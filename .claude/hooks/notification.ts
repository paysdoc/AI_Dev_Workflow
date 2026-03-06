#!/usr/bin/env bunx tsx
/**
 * Notification hook for Claude Code.
 * Logs notifications to session-specific JSON files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ensureSessionLogDir } from './utils/constants';

interface HookInput {
  session_id?: string;
  [key: string]: unknown;
}

// Parse --notify argument from process.argv
const args = process.argv.slice(2);
const _notifyEnabled = args.includes('--notify');

async function main(): Promise<void> {
  try {
    // Read JSON input from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const inputData: HookInput = JSON.parse(Buffer.concat(chunks).toString());

    // Extract session_id
    const sessionId = inputData.session_id || 'unknown';

    // Ensure session log directory exists
    const logDir = ensureSessionLogDir(sessionId);
    const logPath = path.join(logDir, 'notification.json');

    // Read existing log data or initialize empty list
    let logData: unknown[] = [];
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        logData = JSON.parse(content);
      } catch {
        logData = [];
      }
    }

    // Append new data
    logData.push(inputData);

    // Write back to file with formatting
    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));

    process.exit(0);
  } catch {
    // Handle any errors gracefully
    process.exit(0);
  }
}

main();
