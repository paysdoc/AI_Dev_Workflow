/**
 * Adds fields the schema marks required but a fixture line is missing, using a
 * type default. Never deletes a field and never overwrites a value already
 * present — the only thing a hand-maintained fixture ever needs, and the only
 * behaviour that can never damage a real capture.
 *
 * Run standalone: bunx tsx adws/jsonl/fixtureUpdater.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolveSchemaFields } from './schemaFields';
import { DEFAULT_SCHEMA_PATH, DEFAULT_FIXTURE_DIRS } from './conformanceCheck';
import type { EnvelopeSchema, SchemaField, UpdateResult } from './types';

const __filename = fileURLToPath(import.meta.url);

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

/** Recurses into nested object fields to backfill missing required fields at any depth. */
function addMissingRequiredFields(
  data: Record<string, unknown>,
  schemaFields: SchemaField[],
  prefix: string,
): { merged: Record<string, unknown>; changes: string[] } {
  const merged: Record<string, unknown> = { ...data };
  const changes: string[] = [];

  for (const field of schemaFields) {
    const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
    const present = field.name in merged;

    if (!present && field.required) {
      merged[field.name] = defaultValue(field.type);
      changes.push(`+${fieldPath}`);
      continue;
    }
    if (!present) continue;

    if (!field.fields || field.fields.length === 0) continue;
    const nested = merged[field.name];
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) continue;

    const { merged: mergedNested, changes: nestedChanges } = addMissingRequiredFields(
      nested as Record<string, unknown>,
      field.fields,
      fieldPath,
    );
    if (nestedChanges.length > 0) {
      merged[field.name] = mergedNested;
      changes.push(...nestedChanges);
    }
  }

  return { merged, changes };
}

interface LineUpdateResult {
  outputLine: string;
  skip: string | null;
  changes: string[];
}

/** Backfills one fixture line's missing required fields, or reports why it was left untouched. */
function updateFixtureLine(raw: string, lineNumber: number, multiLine: boolean, schema: EnvelopeSchema): LineUpdateResult {
  const label = (msg: string): string => (multiLine ? `line ${lineNumber}: ${msg}` : msg);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { outputLine: raw, skip: label('parse error — skipped'), changes: [] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { outputLine: raw, skip: label('not a JSON object — skipped'), changes: [] };
  }

  const msg = parsed as Record<string, unknown>;
  const resolved = resolveSchemaFields(schema, msg);
  if (!resolved) {
    return {
      outputLine: raw,
      skip: label(`no schema coverage for "${typeof msg['type'] === 'string' ? msg['type'] : 'unknown'}" — skipped`),
      changes: [],
    };
  }

  const { merged, changes: lineChanges } = addMissingRequiredFields(msg, resolved.fields, '');
  if (lineChanges.length === 0) {
    return { outputLine: raw, skip: null, changes: [] };
  }

  return { outputLine: JSON.stringify(merged), skip: null, changes: lineChanges.map(label) };
}

function updateFixtureFile(filePath: string, schema: EnvelopeSchema): UpdateResult {
  const relPath = path.relative(process.cwd(), filePath);
  const rawLines = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (rawLines.length === 0) {
    return { fixturePath: relPath, changed: false, changes: ['fixture is empty — skipped'] };
  }

  const multiLine = rawLines.length > 1;
  const results = rawLines.map((raw, idx) => updateFixtureLine(raw, idx + 1, multiLine, schema));

  const anyChanged = results.some(r => r.changes.length > 0);
  const skips = results.flatMap(r => (r.skip !== null ? [r.skip] : []));

  if (!anyChanged) {
    return { fixturePath: relPath, changed: false, changes: skips };
  }

  const outputLines = results.map(r => r.outputLine);
  const changes = results.flatMap(r => r.changes);
  fs.writeFileSync(filePath, outputLines.join('\n') + '\n', 'utf-8');
  return { fixturePath: relPath, changed: true, changes: [...changes, ...skips] };
}

export function updateFixtureEnvelopes(
  schemaPath: string = DEFAULT_SCHEMA_PATH,
  fixturesDirs: string | readonly string[] = DEFAULT_FIXTURE_DIRS,
): UpdateResult[] {
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
      .map(filename => updateFixtureFile(path.join(dir, filename), schema));
  });
}

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
