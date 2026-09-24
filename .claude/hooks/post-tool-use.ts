#!/usr/bin/env bunx tsx
import * as fs from 'fs';
import * as path from 'path';
import { ensureSessionLogDir } from './utils/constants';

interface HookInput {
  session_id?: string;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const inputData: HookInput = JSON.parse(Buffer.concat(chunks).toString());

    const sessionId = inputData.session_id || 'unknown';

    const logDir = ensureSessionLogDir(sessionId);
    const logPath = path.join(logDir, 'post_tool_use.json');

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

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();
