#!/usr/bin/env bun
/**
 * Accepts the same flags as the real Claude Code CLI and streams canned JSONL
 * to stdout. Pointed to via the CLAUDE_CODE_PATH environment variable.
 *
 * Environment variables:
 *   MOCK_FIXTURE_PATH          — path to a payload JSON file (array of ContentBlock
 *                                objects). When not set, payload is auto-selected
 *                                from the prompt.
 *   MOCK_MANIFEST_PATH         — path to a manifest JSON file. When set, the manifest
 *                                interpreter applies declared file edits to the worktree
 *                                and overrides the payload path. Takes precedence over
 *                                MOCK_FIXTURE_PATH.
 *   MOCK_WORKTREE_PATH         — absolute path to the target worktree for manifest edits
 *                                (falls back to process.cwd() when MOCK_MANIFEST_PATH is set).
 *   MOCK_STREAM_DELAY_MS       — delay between output lines in ms (default: 10).
 *   MOCK_RESPONSE              — set to "rate-limited" to answer with a rejected
 *                                rate_limit_event, a limit-text assistant line and a
 *                                429 result, then exit 1. A manifest `response` block
 *                                (see manifestInterpreter.ts) takes precedence over this.
 *   MOCK_RATE_LIMIT_RESETS_AT  — epoch seconds echoed into rate_limit_info.resetsAt.
 *                                Defaults to now + 300s so the reset has not yet passed.
 *   MOCK_RATE_LIMIT_TYPE       — echoed into rate_limit_info.rateLimitType. Defaults to
 *                                "five_hour".
 *
 * Manifest marker-file fallback:
 *   Callers that spawn this stub through a production code path (e.g. a phase
 *   function invoked in-process) route the child's environment through
 *   getSafeSubprocessEnv()'s fixed allowlist, which does not include MOCK_*
 *   names — so MOCK_MANIFEST_PATH can't reach this process via env. cwd is NOT
 *   filtered (it's set explicitly by the spawn call), so as a fallback, when
 *   MOCK_MANIFEST_PATH is unset, this stub also checks for a manifest at
 *   <cwd>/.adw-stub-manifest.json.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { applyManifest, type ManifestResponse } from './manifestInterpreter.ts';
import { resolveResponseMode, shouldRateLimit, buildRateLimitedLines, type RateLimitedResponseMode, type RateLimitedTemplates } from './stubResponse.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../fixtures/jsonl');
const ENVELOPE_DIR = join(FIXTURE_DIR, 'envelopes');
const PAYLOAD_DIR = join(FIXTURE_DIR, 'payloads');
const INVOCATION_COUNTER_PATH = resolve(process.cwd(), '.adw-stub-invocations');

const STREAM_DELAY_MS = parseInt(process.env['MOCK_STREAM_DELAY_MS'] ?? '10', 10);

const VALUE_FLAGS = new Set(['--output-format', '--model', '--effort']);

/** Skips known flags and their values; returns the first non-flag argument. */
function extractPrompt(argv: string[]): string {
  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('-')) {
      return arg;
    }
    if (VALUE_FLAGS.has(arg)) {
      i += 2;
    } else {
      i += 1;
    }
  }
  return '';
}

function selectPayloadPath(): string {
  const mockFixturePath = process.env['MOCK_FIXTURE_PATH'];
  if (mockFixturePath) {
    return resolve(mockFixturePath);
  }

  const prompt = extractPrompt(process.argv);
  if (prompt.includes('/implement') || prompt.includes('/build')) {
    return join(PAYLOAD_DIR, 'build-agent.json');
  }
  if (prompt.includes('/review')) {
    return join(PAYLOAD_DIR, 'review-agent.json');
  }
  // Default: plan-agent (covers /feature, /plan, and unrecognized commands)
  return join(PAYLOAD_DIR, 'plan-agent.json');
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function streamLine(line: string): Promise<void> {
  process.stdout.write(line + '\n');
  await sleep(STREAM_DELAY_MS);
}

/** Extracts text content from ContentBlock array for the result.result field. */
function extractText(payload: Array<{ type: string; text?: string }>): string {
  return payload
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text ?? '')
    .join('');
}

/** Enables ordering assertions in step defs. */
function recordInvocation(prompt: string): void {
  const logPath = process.env['MOCK_INVOCATION_LOG'];
  if (!logPath) return;
  try {
    appendFileSync(logPath, prompt + '\n', 'utf-8');
  } catch {
    // Best-effort; never abort the stub for logging failures.
  }
}

/** Resolves the manifest path: MOCK_MANIFEST_PATH takes precedence; falls back
 *  to a cwd-relative marker file (see the "Manifest marker-file fallback" note
 *  above) for callers whose env can't carry MOCK_* names to this process. */
function resolveManifestPath(): string | undefined {
  const fromEnv = process.env['MOCK_MANIFEST_PATH'];
  if (fromEnv) return fromEnv;
  const marker = resolve(process.cwd(), '.adw-stub-manifest.json');
  return existsSync(marker) ? marker : undefined;
}

/** Missing or corrupt counter file counts as 0 (first call rejected). */
function readInvocationCount(): number {
  try {
    const n = Number(readFileSync(INVOCATION_COUNTER_PATH, 'utf-8').trim());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function bumpInvocationCount(current: number): void {
  try {
    writeFileSync(INVOCATION_COUNTER_PATH, String(current + 1), 'utf-8');
  } catch {
    // Best-effort; never abort the stub for a counter-file failure.
  }
}

function loadRateLimitedTemplates(): RateLimitedTemplates {
  const readTemplate = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(ENVELOPE_DIR, name), 'utf-8')) as Record<string, unknown>;
  return {
    event: readTemplate('rate-limit-event-rejected.jsonl'),
    assistant: readTemplate('assistant-rate-limited.jsonl'),
    result: readTemplate('result-rate-limited.jsonl'),
  };
}

async function streamRateLimitedResponse(mode: RateLimitedResponseMode): Promise<void> {
  const lines = buildRateLimitedLines(loadRateLimitedTemplates(), mode);
  for (const line of lines) {
    await streamLine(line);
  }
}

async function main(): Promise<void> {
  try {
    recordInvocation(extractPrompt(process.argv));

    const manifestPath = resolveManifestPath();
    let payloadPath: string;
    let manifestResponse: ManifestResponse | undefined;
    if (manifestPath) {
      const worktreePath = process.env['MOCK_WORKTREE_PATH'] ?? process.cwd();
      const result = applyManifest(manifestPath, worktreePath);
      payloadPath = result.jsonlPath;
      manifestResponse = result.response;
    } else {
      payloadPath = selectPayloadPath();
    }

    const mode = resolveResponseMode(manifestResponse, process.env);
    if (mode.kind === 'rate-limited') {
      const invocationCount = mode.limitedInvocations !== undefined ? readInvocationCount() : 0;
      const limited = shouldRateLimit(mode, invocationCount);
      if (mode.limitedInvocations !== undefined) bumpInvocationCount(invocationCount);
      if (limited) {
        await streamRateLimitedResponse(mode);
        // The real CLI exits non-zero when the result is an error; agentProcessHandler
        // kills the agent on the rejected event anyway, so the code itself is rarely
        // observed in production.
        process.exit(1);
      }
    }

    const payload = JSON.parse(readFileSync(payloadPath, 'utf-8')) as Array<{
      type: string;
      text?: string;
    }>;

    const envelopePath = join(ENVELOPE_DIR, 'assistant-message.jsonl');
    const envelope = JSON.parse(readFileSync(envelopePath, 'utf-8')) as {
      message: { content: unknown[] };
    };
    envelope.message.content = payload;
    await streamLine(JSON.stringify(envelope));

    const resultPath = join(ENVELOPE_DIR, 'result-message.jsonl');
    const result = JSON.parse(readFileSync(resultPath, 'utf-8')) as {
      result: string;
    };
    const textContent = extractText(payload);
    result.result = textContent.substring(0, 500) || 'Task completed.';
    await streamLine(JSON.stringify(result));

    process.exit(0);
  } catch (error) {
    process.stderr.write(`claude-cli-stub error: ${error}\n`);
    process.exit(1);
  }
}

void main();
