#!/usr/bin/env bunx tsx
import * as fs from 'fs';
import * as path from 'path';
import { ensureSessionLogDir } from './utils/constants';

interface HookInput {
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
  [key: string]: unknown;
}

const args = process.argv.slice(2);
const chatEnabled = args.includes('--chat');

async function main(): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const inputData: HookInput = JSON.parse(Buffer.concat(chunks).toString());

    const sessionId = inputData.session_id || 'unknown';

    const logDir = ensureSessionLogDir(sessionId);
    const logPath = path.join(logDir, 'subagent_stop.json');

    let logData: unknown[] = [];
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        logData = JSON.parse(content);
      } catch {
        logData = [];
      }
    }

    logData.push(inputData);

    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));

    if (chatEnabled && inputData.transcript_path) {
      const transcriptPath = inputData.transcript_path;
      if (fs.existsSync(transcriptPath)) {
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

          const chatFile = path.join(logDir, 'chat.json');
          fs.writeFileSync(chatFile, JSON.stringify(chatData, null, 2));
        } catch {
          // Fail silently
        }
      }
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();
