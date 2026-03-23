#!/usr/bin/env bun
/**
 * Claude CLI stub for ADW mock infrastructure.
 *
 * Accepts the same flags as the real Claude Code CLI and streams canned JSONL
 * to stdout. Pointed to via the CLAUDE_CODE_PATH environment variable.
 *
 * Environment variables:
 *   MOCK_FIXTURE_PATH  — path to a payload JSON file (array of ContentBlock objects).
 *                        When not set, payload is auto-selected from the prompt.
 *   MOCK_STREAM_DELAY_MS — delay between output lines in ms (default: 10).
 */

import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../fixtures/jsonl');
const ENVELOPE_DIR = join(FIXTURE_DIR, 'envelopes');
const PAYLOAD_DIR = join(FIXTURE_DIR, 'payloads');

const STREAM_DELAY_MS = parseInt(process.env['MOCK_STREAM_DELAY_MS'] ?? '10', 10);

/** Flags that accept a following value argument. */
const VALUE_FLAGS = new Set(['--output-format', '--model', '--effort']);

/**
 * Extracts the trailing prompt string from process.argv.
 * Skips known flags and their values; returns the first non-flag argument.
 */
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

/** Selects the payload file path based on prompt content or MOCK_FIXTURE_PATH. */
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

/** Sleeps for the configured delay. */
function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Writes a JSONL line to stdout, then waits for the configured delay. */
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

/** Main entry point. */
async function main(): Promise<void> {
  try {
    const payloadPath = selectPayloadPath();
    const payload = JSON.parse(readFileSync(payloadPath, 'utf-8')) as Array<{
      type: string;
      text?: string;
    }>;

    // Assemble and stream the assistant message
    const envelopePath = join(ENVELOPE_DIR, 'assistant-message.jsonl');
    const envelope = JSON.parse(readFileSync(envelopePath, 'utf-8')) as {
      message: { content: unknown[] };
    };
    envelope.message.content = payload;
    await streamLine(JSON.stringify(envelope));

    // Assemble and stream the result message
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
