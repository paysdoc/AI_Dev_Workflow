/**
 * Live probe against the pinned Claude CLI. Refresh mode (default) reconciles the
 * probe-owned schema entries and writes schema.json; --check runs the same probe
 * read-only and reports drift without writing (CI's live leg).
 *
 * Run standalone: bunx tsx adws/jsonl/schemaProbe.ts [--check]
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolveClaudeCodePath, getSafeSubprocessEnv } from '../core/environment';
import { extractObservedSchema, mergeObservedSchema, findLiveDrift, PROBE_OWNED_TYPES } from './schemaMerge';
import type { EnvelopeSchema, LiveDriftReport, SchemaField } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_PATH = path.join(__dirname, 'schema.json');

// The same output mode claudeAgent.ts and rateLimitProbe.ts use. --verbose is
// mandatory for stream-json in print mode on the current CLI.
const PROBE_ARGS: readonly string[] = [
  '--print', '--verbose', '--output-format', 'stream-json',
  '--max-turns', '1', '--model', 'haiku', 'say hello',
];

function runProbe(claudePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // A throwaway cwd so the repo's .claude/settings.json hooks, CLAUDE.md and
    // project memory are never loaded into the probe's own turn.
    const tempCwd = mkdtempSync(path.join(tmpdir(), 'adw-jsonl-probe-'));
    const cleanup = (): void => {
      try { rmSync(tempCwd, { recursive: true, force: true }); } catch { /* best-effort */ }
    };

    const proc = spawn(claudePath, [...PROBE_ARGS], {
      cwd: tempCwd,
      env: getSafeSubprocessEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', () => {
      cleanup();
      if (stdout.trim()) {
        resolve(stdout);
      } else {
        reject(new Error(
          `Claude CLI produced no output. Check authentication (run 'claude auth login'). stderr: ${stderr.trim()}`
        ));
      }
    });

    proc.on('error', (err) => {
      cleanup();
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });
  });
}

function readCommittedSchema(schemaPath: string): EnvelopeSchema {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(
      `schema.json not found at ${schemaPath}. The probe reconciles an existing schema — it does not bootstrap one from nothing.`
    );
  }
  return JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as EnvelopeSchema;
}

/** `claude_code_version` off the observed system/init line, when present and a string. */
function extractCliVersion(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object') continue;
      const msg = parsed as Record<string, unknown>;
      if (msg['type'] === 'system' && msg['subtype'] === 'init' && typeof msg['claude_code_version'] === 'string') {
        return msg['claude_code_version'];
      }
    } catch {
      // skip non-JSON lines
    }
  }
  return undefined;
}

async function liveProbe(): Promise<{ lines: string[]; observed: Record<string, SchemaField[]>; cliVersion: string | undefined }> {
  const claudePath = resolveClaudeCodePath();
  const rawOutput = await runProbe(claudePath);
  const lines = rawOutput.split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    throw new Error('Claude CLI produced no JSONL lines. Check authentication: run "claude auth login".');
  }
  return { lines, observed: extractObservedSchema(lines), cliVersion: extractCliVersion(lines) };
}

/** Refreshes the probe-owned entries against the pinned CLI and writes schemaPath. */
export async function probeClaudeJsonlSchema(schemaPath: string = SCHEMA_PATH): Promise<EnvelopeSchema> {
  const committed = readCommittedSchema(schemaPath);
  const { observed, cliVersion } = await liveProbe();

  const missingOwned = PROBE_OWNED_TYPES.filter(t => !(t in observed));
  if (missingOwned.length > 0) {
    throw new Error(
      `Probe did not observe: ${missingOwned.join(', ')}. A run that hits a rate limit produces only a rejected rate_limit_event and an error result — if a limit is active, wait for the reset and retry.`
    );
  }

  const merged = mergeObservedSchema(committed, observed, new Date().toISOString(), cliVersion);
  fs.writeFileSync(schemaPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  console.log(`Schema written to: ${schemaPath}`);
  console.log(`Probe-owned entries reconciled: ${PROBE_OWNED_TYPES.join(', ')}`);
  if (cliVersion) console.log(`Observed Claude CLI version: ${cliVersion}`);
  return merged;
}

/** Read-only: reports drift between the committed schema and a fresh live probe. Never writes. */
export async function checkClaudeJsonlSchema(schemaPath: string = SCHEMA_PATH): Promise<LiveDriftReport> {
  const committed = readCommittedSchema(schemaPath);
  const { observed, cliVersion } = await liveProbe();

  if (cliVersion && committed.cliVersion && cliVersion !== committed.cliVersion) {
    console.warn(`Live Claude CLI version ${cliVersion} differs from the schema's committed cliVersion ${committed.cliVersion} (informational — not a failure).`);
  }

  return findLiveDrift(committed, observed);
}

const isMain = path.resolve(process.argv[1] ?? '') === path.resolve(__filename);
if (isMain) {
  if (process.argv.includes('--check')) {
    checkClaudeJsonlSchema()
      .then((report) => {
        console.log(`Observed types: ${report.observedTypes.join(', ') || '(none)'}`);
        if (report.newFields.length > 0) {
          console.log(`New fields (informational): ${report.newFields.join(', ')}`);
        }
        if (report.unobservedTypes.length > 0) {
          console.error(`Unobserved probe-owned types: ${report.unobservedTypes.join(', ')}`);
        }
        if (report.missingRequired.length > 0) {
          console.error(`Missing required fields: ${report.missingRequired.join(', ')}`);
        }
        const failed = report.unobservedTypes.length > 0 || report.missingRequired.length > 0;
        console.log(failed ? 'Live envelope check FAILED.' : 'Live envelope check passed.');
        process.exit(failed ? 1 : 0);
      })
      .catch((err: unknown) => {
        console.error('Schema live check failed:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      });
  } else {
    probeClaudeJsonlSchema().catch((err: unknown) => {
      console.error('Schema probe failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
  }
}
