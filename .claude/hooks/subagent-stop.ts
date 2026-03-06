#!/usr/bin/env bunx tsx
/**
 * Subagent stop hook for Claude Code.
 * Logs subagent stop events and optionally converts JSONL transcript to JSON.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ensureSessionLogDir } from './utils/constants';

interface HookInput {
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
  [key: string]: unknown;
}

// Parse --chat argument from process.argv
const args = process.argv.slice(2);
const chatEnabled = args.includes('--chat');

async function main(): Promise<void> {
  try {
    // Read JSON input from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const inputData: HookInput = JSON.parse(Buffer.concat(chunks).toString());

    // Extract required fields
    const sessionId = inputData.session_id || 'unknown';

    // Ensure session log directory exists
    const logDir = ensureSessionLogDir(sessionId);
    const logPath = path.join(logDir, 'subagent_stop.json');

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

    // Handle --chat switch (same as stop.ts)
    if (chatEnabled && inputData.transcript_path) {
      const transcriptPath = inputData.transcript_path;
      if (fs.existsSync(transcriptPath)) {
        // Read .jsonl file and convert to JSON array
        const chatData: unknown[] = [];
        try {
          const content = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = content.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              try {
                chatData.push(JSON.parse(trimmed));
              } catch {
                // Skip invalid lines
              }
            }
          }

          // Write to session-specific chat.json
          const chatFile = path.join(logDir, 'chat.json');
          fs.writeFileSync(chatFile, JSON.stringify(chatData, null, 2));
        } catch {
          // Fail silently
        }
      }
    }

    process.exit(0);
  } catch {
    // Handle any errors gracefully
    process.exit(0);
  }
}

main();
