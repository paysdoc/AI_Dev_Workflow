/**
 * Programmatic fixture envelope updater.
 * Updates envelope fields in fixture files to match the probed schema while
 * preserving hand-maintained payload content.
 *
 * Run standalone: bunx tsx adws/jsonl/fixtureUpdater.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { EnvelopeSchema, SchemaField, UpdateResult } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCHEMA_PATH = path.join(__dirname, 'schema.json');
const DEFAULT_FIXTURES_DIR = path.join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Envelope / payload boundary definitions
// ---------------------------------------------------------------------------

/**
 * Top-level envelope field names for each message type.
 * These are structural fields whose presence/absence is controlled by the schema.
 * Payload fields (result text, cost figures, content values) are always preserved.
 */
const ENVELOPE_FIELDS: Record<string, ReadonlySet<string>> = {
  result: new Set(['type', 'subtype', 'isError', 'durationMs', 'durationApiMs', 'numTurns', 'sessionId']),
  assistant: new Set(['type', 'message']),
};

/** Envelope sub-fields within `message` for assistant messages. */
const ASSISTANT_MESSAGE_ENVELOPE_FIELDS = new Set(['id', 'model', 'usage']);

// ---------------------------------------------------------------------------
// Default value helpers
// ---------------------------------------------------------------------------

function defaultValue(type: SchemaField['type']): unknown {
  switch (type) {
    case 'string': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'object': return {};
    case 'array': return [];
    case 'null': return null;
  }
}

// ---------------------------------------------------------------------------
// Per-message-type envelope merge
// ---------------------------------------------------------------------------

/** Merges envelope fields for a `result` message. */
function mergeResultEnvelope(
  fixture: Record<string, unknown>,
  schemaFields: SchemaField[]
): { merged: Record<string, unknown>; changes: string[] } {
  const merged: Record<string, unknown> = { ...fixture };
  const changes: string[] = [];
  const envelopeSet = ENVELOPE_FIELDS['result'] ?? new Set<string>();

  for (const field of schemaFields) {
    if (!envelopeSet.has(field.name)) continue;
    if (!(field.name in merged)) {
      merged[field.name] = defaultValue(field.type);
      changes.push(`+${field.name}`);
    }
  }

  // Remove envelope fields no longer in schema
  const schemaEnvelopeNames = new Set(
    schemaFields.filter(f => envelopeSet.has(f.name)).map(f => f.name)
  );
  for (const key of Object.keys(merged)) {
    if (envelopeSet.has(key) && !schemaEnvelopeNames.has(key)) {
      delete merged[key];
      changes.push(`-${key}`);
    }
  }

  return { merged, changes };
}

/** Merges envelope sub-fields within `message.usage` for an assistant message. */
function mergeUsageEnvelope(
  usage: Record<string, unknown>,
  usageSchemaFields: SchemaField[]
): { merged: Record<string, unknown>; changes: string[] } {
  const merged: Record<string, unknown> = { ...usage };
  const changes: string[] = [];

  // Add missing usage fields
  for (const field of usageSchemaFields) {
    if (!(field.name in merged)) {
      merged[field.name] = defaultValue(field.type);
      changes.push(`message.usage.+${field.name}`);
    }
  }

  // Remove usage fields no longer in schema
  const schemaNames = new Set(usageSchemaFields.map(f => f.name));
  for (const key of Object.keys(merged)) {
    if (!schemaNames.has(key)) {
      delete merged[key];
      changes.push(`message.usage.-${key}`);
    }
  }

  return { merged, changes };
}

/** Merges envelope fields for an `assistant` message. */
function mergeAssistantEnvelope(
  fixture: Record<string, unknown>,
  schemaFields: SchemaField[]
): { merged: Record<string, unknown>; changes: string[] } {
  const merged: Record<string, unknown> = { ...fixture };
  const changes: string[] = [];

  const msgSchemaField = schemaFields.find(f => f.name === 'message');
  const msgSchemaSubFields = msgSchemaField?.fields ?? [];

  const existingMessage = merged['message'];
  if (existingMessage === null || typeof existingMessage !== 'object' || Array.isArray(existingMessage)) {
    return { merged, changes };
  }

  const message: Record<string, unknown> = { ...(existingMessage as Record<string, unknown>) };

  // Add missing message envelope sub-fields
  for (const field of msgSchemaSubFields) {
    if (!ASSISTANT_MESSAGE_ENVELOPE_FIELDS.has(field.name)) continue;
    if (!(field.name in message)) {
      message[field.name] = defaultValue(field.type);
      changes.push(`message.+${field.name}`);
    }
  }

  // Merge usage sub-fields if schema has them
  const usageSchemaField = msgSchemaSubFields.find(f => f.name === 'usage');
  if (usageSchemaField?.fields && usageSchemaField.fields.length > 0) {
    const existingUsage = message['usage'];
    if (existingUsage !== null && typeof existingUsage === 'object' && !Array.isArray(existingUsage)) {
      const { merged: mergedUsage, changes: usageChanges } = mergeUsageEnvelope(
        existingUsage as Record<string, unknown>,
        usageSchemaField.fields
      );
      if (usageChanges.length > 0) {
        message['usage'] = mergedUsage;
        changes.push(...usageChanges);
      }
    }
  }

  merged['message'] = message;
  return { merged, changes };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Updates envelope fields in all fixture files to match the probed schema,
 * preserving payload content.
 *
 * @param schemaPath - Path to schema.json (defaults to adws/jsonl/schema.json).
 * @param fixturesDir - Path to fixtures directory (defaults to adws/jsonl/fixtures/).
 * @returns Array of UpdateResult, one per fixture file.
 */
export function updateFixtureEnvelopes(
  schemaPath: string = DEFAULT_SCHEMA_PATH,
  fixturesDir: string = DEFAULT_FIXTURES_DIR
): UpdateResult[] {
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
    const rawLine = fs.readFileSync(fixturePath, 'utf-8').trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      return { fixturePath: relPath, changed: false, changes: [`parse error — skipped`] };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { fixturePath: relPath, changed: false, changes: ['not a JSON object — skipped'] };
    }

    const msg = parsed as Record<string, unknown>;
    const messageType = msg['type'];
    if (typeof messageType !== 'string') {
      return { fixturePath: relPath, changed: false, changes: ['missing type field — skipped'] };
    }

    const schemaFields = schema.messageTypes[messageType];
    if (!schemaFields) {
      return { fixturePath: relPath, changed: false, changes: [`no schema for type "${messageType}" — skipped`] };
    }

    let merged: Record<string, unknown>;
    let changes: string[];

    if (messageType === 'result') {
      ({ merged, changes } = mergeResultEnvelope(msg, schemaFields));
    } else if (messageType === 'assistant') {
      ({ merged, changes } = mergeAssistantEnvelope(msg, schemaFields));
    } else {
      return { fixturePath: relPath, changed: false, changes: [] };
    }

    if (changes.length === 0) {
      return { fixturePath: relPath, changed: false, changes: [] };
    }

    fs.writeFileSync(fixturePath, JSON.stringify(merged) + '\n', 'utf-8');
    return { fixturePath: relPath, changed: true, changes };
  });
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

const isMain = path.resolve(process.argv[1] ?? '') === path.resolve(__filename);
if (isMain) {
  try {
    const results = updateFixtureEnvelopes();
    let anyChanged = false;
    for (const r of results) {
      if (r.changed) {
        anyChanged = true;
        console.log(`  Updated ${r.fixturePath}: ${r.changes.join(', ')}`);
      } else if (r.changes.length > 0) {
        console.log(`  Skipped ${r.fixturePath}: ${r.changes.join(', ')}`);
      } else {
        console.log(`  No changes: ${r.fixturePath}`);
      }
    }
    if (!anyChanged) {
      console.log('All fixtures are up to date.');
    }
  } catch (err) {
    console.error('Fixture update error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
