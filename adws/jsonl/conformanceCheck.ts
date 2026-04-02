/**
 * CI conformance checker: validates JSONL fixture files against the probed schema
 * and through ADW's parsers. Exits non-zero when drift is detected.
 *
 * Run standalone: bunx tsx adws/jsonl/conformanceCheck.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseJsonlOutput, type JsonlParserState } from '../core/claudeStreamParser';
import { AnthropicTokenUsageExtractor } from '../cost/providers/anthropic/extractor';
import type { EnvelopeSchema, SchemaField, ConformanceResult } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCHEMA_PATH = path.join(__dirname, 'schema.json');
const DEFAULT_FIXTURES_DIR = path.join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Schema comparison helpers
// ---------------------------------------------------------------------------

/**
 * Recursively finds required schema fields missing from a data object.
 * Returns dot-path strings for each missing required field.
 */
function findMissingFields(
  data: Record<string, unknown>,
  schemaFields: SchemaField[],
  prefix: string
): string[] {
  return schemaFields.flatMap((field) => {
    const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;

    if (!(field.name in data)) {
      return field.required ? [fieldPath] : [];
    }

    if (field.type === 'object' && field.fields && field.fields.length > 0) {
      const nested = data[field.name];
      if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
        return findMissingFields(nested as Record<string, unknown>, field.fields, fieldPath);
      }
    }

    return [];
  });
}

/** Returns dot-paths for fields present in data but absent from the schema. */
function findExtraFields(
  data: Record<string, unknown>,
  schemaFields: SchemaField[],
  prefix: string
): string[] {
  const schemaNames = new Set(schemaFields.map(f => f.name));
  return Object.keys(data).flatMap((key) => {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (!schemaNames.has(key)) return [fieldPath];

    const schemaField = schemaFields.find(f => f.name === key);
    const value = data[key];
    if (
      schemaField?.type === 'object' &&
      schemaField.fields &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return findExtraFields(value as Record<string, unknown>, schemaField.fields, fieldPath);
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Per-fixture checks
// ---------------------------------------------------------------------------

/** Verifies the fixture line feeds through parseJsonlOutput with expected state changes. */
function runParserCheck(fixtureLine: string, messageType: string): string[] {
  const state: JsonlParserState = {
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
  };

  try {
    parseJsonlOutput(fixtureLine, state);
  } catch (err) {
    return [`parseJsonlOutput threw: ${err instanceof Error ? err.message : String(err)}`];
  }

  const errors: string[] = [];

  if (messageType === 'assistant' && state.turnCount === 0) {
    errors.push('assistant message did not increment turnCount (parser did not recognize message)');
  }

  if (messageType === 'result' && state.lastResult === null) {
    errors.push('result message did not set lastResult (parser did not recognize message)');
  }

  return errors;
}

/** Verifies the fixture line feeds through AnthropicTokenUsageExtractor without errors. */
function runExtractorCheck(fixtureLine: string, messageType: string): string[] {
  const extractor = new AnthropicTokenUsageExtractor();

  try {
    extractor.onChunk(fixtureLine + '\n');
  } catch (err) {
    return [`AnthropicTokenUsageExtractor.onChunk threw: ${err instanceof Error ? err.message : String(err)}`];
  }

  const errors: string[] = [];

  if (messageType === 'assistant') {
    const usage = extractor.getCurrentUsage();
    if (Object.keys(usage).length === 0) {
      errors.push('assistant message produced no token usage estimates (extractor may not have recognized message)');
    }
  }

  if (messageType === 'result' && !extractor.isFinalized()) {
    errors.push('result message did not finalize the extractor');
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates all .jsonl fixture files against the probed schema and through ADW's parsers.
 *
 * @param schemaPath - Path to schema.json (defaults to adws/jsonl/schema.json).
 * @param fixturesDir - Path to fixtures directory (defaults to adws/jsonl/fixtures/).
 * @returns Array of ConformanceResult, one per fixture file.
 */
export function checkConformance(
  schemaPath: string = DEFAULT_SCHEMA_PATH,
  fixturesDir: string = DEFAULT_FIXTURES_DIR
): ConformanceResult[] {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(
      `schema.json not found at ${schemaPath}. Run 'bun run jsonl:probe' to generate it.`
    );
  }

  const schema: EnvelopeSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as EnvelopeSchema;

  const fixtureFiles = fs.readdirSync(fixturesDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort();

  return fixtureFiles.map((filename) => {
    const fixturePath = path.join(fixturesDir, filename);
    const relPath = path.relative(process.cwd(), fixturePath);

    const base: Omit<ConformanceResult, 'passed'> = {
      fixturePath: relPath,
      missingFields: [],
      extraFields: [],
      parserErrors: [],
      extractorErrors: [],
    };

    // 1. Parse check
    let parsed: unknown;
    const rawLine = fs.readFileSync(fixturePath, 'utf-8').trim();
    try {
      parsed = JSON.parse(rawLine);
    } catch (err) {
      return { ...base, passed: false, parseError: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...base, passed: false, parseError: 'Fixture must be a JSON object, not an array or primitive.' };
    }

    const msg = parsed as Record<string, unknown>;
    const messageType = msg['type'];

    if (typeof messageType !== 'string') {
      return { ...base, passed: false, parseError: 'Fixture is missing a string "type" field.' };
    }

    // 2. Schema check
    const schemaFields = schema.messageTypes[messageType];
    if (!schemaFields) {
      // Unknown message type — warn but don't fail
      const result: ConformanceResult = { ...base, passed: true };
      result.extraFields = [`type "${messageType}" has no schema coverage (informational)`];
      return result;
    }

    const missingFields = findMissingFields(msg, schemaFields, '');
    const extraFields = findExtraFields(msg, schemaFields, '');

    // 3. Parser check
    const parserErrors = runParserCheck(rawLine, messageType);

    // 4. Extractor check
    const extractorErrors = runExtractorCheck(rawLine, messageType);

    const passed = missingFields.length === 0 && parserErrors.length === 0 && extractorErrors.length === 0;

    return { ...base, passed, missingFields, extraFields, parserErrors, extractorErrors };
  });
}

/**
 * Formats a conformance report as a human-readable string.
 */
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

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

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
