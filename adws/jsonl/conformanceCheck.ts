/**
 * Exits non-zero when drift is detected.
 *
 * Run standalone: bunx tsx adws/jsonl/conformanceCheck.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseJsonlOutput, type JsonlParserState } from '../core/claudeStreamParser';
import { AnthropicTokenUsageExtractor } from '../cost/providers/anthropic/extractor';
import { resolveSchemaFields, findMissingFields, findExtraFields } from './schemaFields';
import type { EnvelopeSchema, ConformanceResult } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_SCHEMA_PATH = path.join(__dirname, 'schema.json');
/** Shared with fixtureUpdater.ts so a failing report's `jsonl:update` hint covers every fixture the gate checked. */
export const DEFAULT_FIXTURE_DIRS: readonly string[] = [
  path.join(__dirname, 'fixtures'),
  path.join(__dirname, '..', '..', 'test', 'fixtures', 'jsonl', 'envelopes'),
];

interface LinePresence {
  assistantCount: number;
  hasResult: boolean;
  hasRejectedRateLimitEvent: boolean;
}

function freshParserState(): JsonlParserState {
  return {
    lastResult: null,
    fullOutput: '',
    turnCount: 0,
    toolCount: 0,
    lineBuffer: '',
    rateLimitRejected: false,
    authErrorDetected: false,
    serverErrorDetected: false,
    overloadedErrorDetected: false,
    compactionDetected: false,
    deniedToolCallCount: 0,
  };
}

/** Non-empty, trimmed lines — a fixture is one JSON object per line, blank lines allowed between them. */
function readFixtureLines(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function computePresence(messages: Record<string, unknown>[]): LinePresence {
  let assistantCount = 0;
  let hasResult = false;
  let hasRejectedRateLimitEvent = false;

  for (const msg of messages) {
    if (msg['type'] === 'assistant') assistantCount++;
    if (msg['type'] === 'result') hasResult = true;
    if (msg['type'] === 'rate_limit_event') {
      const info = msg['rate_limit_info'] as Record<string, unknown> | undefined;
      if (info?.['status'] === 'rejected') hasRejectedRateLimitEvent = true;
    }
  }

  return { assistantCount, hasResult, hasRejectedRateLimitEvent };
}

/** Runs the shared stream parser once over the whole fixture (the newline the parser needs to flush its final line). */
function runParserCheck(fixtureText: string, presence: LinePresence): string[] {
  const state = freshParserState();

  try {
    parseJsonlOutput(fixtureText, state);
  } catch (err) {
    return [`parseJsonlOutput threw: ${err instanceof Error ? err.message : String(err)}`];
  }

  const errors: string[] = [];

  if (presence.assistantCount > 0 && state.turnCount !== presence.assistantCount) {
    errors.push(`expected turnCount ${presence.assistantCount} from ${presence.assistantCount} assistant message(s), got ${state.turnCount}`);
  }
  if (presence.hasResult && state.lastResult === null) {
    errors.push('result message did not set lastResult (parser did not recognize message)');
  }
  if (presence.hasRejectedRateLimitEvent && !state.rateLimitRejected) {
    errors.push('rejected rate_limit_event did not set rateLimitRejected');
  }

  return errors;
}

/** Estimated (not finalized) usage is asserted: a rejected first call finalizes with an empty modelUsage. */
function runExtractorCheck(fixtureText: string, presence: LinePresence): string[] {
  const extractor = new AnthropicTokenUsageExtractor();

  try {
    extractor.onChunk(fixtureText);
  } catch (err) {
    return [`AnthropicTokenUsageExtractor.onChunk threw: ${err instanceof Error ? err.message : String(err)}`];
  }

  const errors: string[] = [];

  if (presence.assistantCount > 0 && Object.keys(extractor.getEstimatedUsage()).length === 0) {
    errors.push('assistant message(s) produced no estimated token usage (extractor may not have recognized message)');
  }
  if (presence.hasResult && !extractor.isFinalized()) {
    errors.push('result message did not finalize the extractor');
  }

  return errors;
}

function fieldLabel(lineNumber: number, totalLines: number, key: string, detail: string): string {
  return totalLines > 1 ? `line ${lineNumber} (${key}): ${detail}` : detail;
}

function unknownTypeLabel(lineNumber: number, totalLines: number, key: string): string {
  const detail = `type "${key}" has no schema coverage (informational)`;
  return totalLines > 1 ? `line ${lineNumber}: ${detail}` : detail;
}

function checkFixture(filePath: string, schema: EnvelopeSchema): ConformanceResult {
  const relPath = path.relative(process.cwd(), filePath);
  const lines = readFixtureLines(filePath);
  const base: Omit<ConformanceResult, 'passed'> = {
    fixturePath: relPath,
    lineCount: lines.length,
    missingFields: [],
    extraFields: [],
    parserErrors: [],
    extractorErrors: [],
  };

  if (lines.length === 0) {
    return { ...base, passed: false, parseError: 'Fixture is empty.' };
  }

  const messages: Record<string, unknown>[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]!);
    } catch (err) {
      return { ...base, passed: false, parseError: `line ${lineNumber}: invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...base, passed: false, parseError: `line ${lineNumber}: fixture line must be a JSON object, not an array or primitive.` };
    }
    const msg = parsed as Record<string, unknown>;
    if (typeof msg['type'] !== 'string') {
      return { ...base, passed: false, parseError: `line ${lineNumber}: fixture line is missing a string "type" field.` };
    }
    messages.push(msg);
  }

  const missingFields: string[] = [];
  const extraFields: string[] = [];

  messages.forEach((msg, idx) => {
    const lineNumber = idx + 1;
    const resolved = resolveSchemaFields(schema, msg);
    if (!resolved) {
      const key = typeof msg['subtype'] === 'string' ? `${msg['type']}/${msg['subtype']}` : String(msg['type']);
      extraFields.push(unknownTypeLabel(lineNumber, lines.length, key));
      return;
    }
    findMissingFields(msg, resolved.fields, '').forEach(f => missingFields.push(fieldLabel(lineNumber, lines.length, resolved.key, f)));
    findExtraFields(msg, resolved.fields, '').forEach(f => extraFields.push(fieldLabel(lineNumber, lines.length, resolved.key, f)));
  });

  const fixtureText = lines.join('\n') + '\n';
  const presence = computePresence(messages);
  const parserErrors = runParserCheck(fixtureText, presence);
  const extractorErrors = runExtractorCheck(fixtureText, presence);

  const passed = missingFields.length === 0 && parserErrors.length === 0 && extractorErrors.length === 0;

  return { ...base, passed, missingFields, extraFields, parserErrors, extractorErrors };
}

export function checkConformance(
  schemaPath: string = DEFAULT_SCHEMA_PATH,
  fixturesDirs: string | readonly string[] = DEFAULT_FIXTURE_DIRS,
): ConformanceResult[] {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(
      `schema.json not found at ${schemaPath}. Run 'bun run jsonl:probe' to generate it.`
    );
  }

  const schema: EnvelopeSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as EnvelopeSchema;
  const dirs = typeof fixturesDirs === 'string' ? [fixturesDirs] : fixturesDirs;

  return dirs.flatMap((dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .map(filename => checkFixture(path.join(dir, filename), schema));
  });
}

export function formatConformanceReport(results: ConformanceResult[]): string {
  const lines: string[] = ['Conformance check results:'];

  for (const r of results) {
    if (r.passed) {
      lines.push(`  ✓ ${r.fixturePath}`);
    } else {
      lines.push(`  ✗ ${r.fixturePath}`);
      if (r.parseError) lines.push(`      Parse error: ${r.parseError}`);
      r.missingFields.forEach(f => lines.push(`      Missing required field: ${f}`));
      r.parserErrors.forEach(e => lines.push(`      Parser: ${e}`));
      r.extractorErrors.forEach(e => lines.push(`      Extractor: ${e}`));
    }
    if (r.extraFields.length > 0) {
      lines.push(`      Extra fields (informational): ${r.extraFields.join(', ')}`);
    }
  }

  const failed = results.filter(r => !r.passed).length;
  lines.push('');
  if (failed === 0) {
    lines.push(`All ${results.length} fixture(s) passed.`);
  } else {
    lines.push(`${failed} of ${results.length} fixture(s) failed.`);
    lines.push("Run 'bun run jsonl:update' to update fixture envelopes automatically.");
  }

  return lines.join('\n');
}

const isMain = path.resolve(process.argv[1] ?? '') === path.resolve(__filename);
if (isMain) {
  try {
    const results = checkConformance();
    const report = formatConformanceReport(results);
    console.log(report);
    const anyFailed = results.some(r => !r.passed);
    process.exit(anyFailed ? 1 : 0);
  } catch (err) {
    console.error('Conformance check error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
