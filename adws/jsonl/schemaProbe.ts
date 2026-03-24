/**
 * Schema probe: spawns the Claude CLI with a minimal prompt and extracts the
 * JSONL envelope schema from the real output, writing it to schema.json.
 *
 * Run standalone: bunx tsx adws/jsonl/schemaProbe.ts
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolveClaudeCodePath, getSafeSubprocessEnv } from '../core/environment';
import type { EnvelopeSchema, SchemaField } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_PATH = path.join(__dirname, 'schema.json');

// ---------------------------------------------------------------------------
// Field schema extraction
// ---------------------------------------------------------------------------

/** Determines the JSON type of a value for SchemaField representation. */
function getJsonType(value: unknown): SchemaField['type'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object') return t;
  return 'string';
}

/**
 * Recursively walks an object and extracts its field structure as SchemaField[].
 * All observed fields are marked required:true (probe sees one live example).
 */
export function extractFieldSchema(obj: unknown): SchemaField[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [];

  return Object.entries(obj as Record<string, unknown>).map(([name, value]) => {
    const type = getJsonType(value);
    const field: SchemaField = { name, required: true, type };
    if (type === 'object' && value !== null) {
      field.fields = extractFieldSchema(value);
    }
    return field;
  });
}

// ---------------------------------------------------------------------------
// CLI probe
// ---------------------------------------------------------------------------

/** Spawns the Claude CLI with a minimal prompt and captures raw stdout. */
function runProbe(claudePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliArgs = ['--print', '--output-format', 'stream-json', 'say hello'];
    const proc = spawn(claudePath, cliArgs, {
      env: getSafeSubprocessEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (_code) => {
      if (stdout.trim()) {
        resolve(stdout);
      } else {
        reject(new Error(
          `Claude CLI produced no output. Check authentication (run 'claude auth login'). stderr: ${stderr.trim()}`
        ));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probes the Claude CLI with a minimal "say hello" prompt, extracts the JSONL
 * envelope schema from the output, and writes it to schema.json.
 *
 * @returns The extracted EnvelopeSchema.
 */
export async function probeClaudeJsonlSchema(): Promise<EnvelopeSchema> {
  let claudePath: string;
  try {
    claudePath = resolveClaudeCodePath();
  } catch (err) {
    throw new Error(
      `Claude CLI not found — set CLAUDE_CODE_PATH in .env or ensure 'claude' is in PATH. ${String(err)}`
    );
  }

  console.log(`Probing Claude CLI at: ${claudePath}`);
  const rawOutput = await runProbe(claudePath);

  const lines = rawOutput.split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    throw new Error('Claude CLI produced no JSONL lines. Check authentication: run "claude auth login".');
  }

  console.log(`Captured ${lines.length} JSONL line(s).`);

  const messageTypes: Record<string, SchemaField[]> = {};

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

      const msg = parsed as Record<string, unknown>;
      const type = msg['type'];
      if (typeof type !== 'string') continue;

      // First occurrence of each type wins
      if (!(type in messageTypes)) {
        messageTypes[type] = extractFieldSchema(parsed);
        console.log(`  Found message type: ${type}`);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  if (Object.keys(messageTypes).length === 0) {
    throw new Error('No typed JSONL messages found in Claude CLI output. Expected at least "assistant" and "result".');
  }

  const schema: EnvelopeSchema = {
    probedAt: new Date().toISOString(),
    messageTypes,
  };

  fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2) + '\n', 'utf-8');
  console.log(`Schema written to: ${SCHEMA_PATH}`);
  console.log(`Message types captured: ${Object.keys(messageTypes).join(', ')}`);

  return schema;
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

const isMain = path.resolve(process.argv[1] ?? '') === path.resolve(__filename);
if (isMain) {
  probeClaudeJsonlSchema().catch((err: unknown) => {
    console.error('Schema probe failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
