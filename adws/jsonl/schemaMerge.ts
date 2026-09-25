import { extractFieldSchema, schemaKeyFor } from './schemaFields';
import type { EnvelopeSchema, LiveDriftReport, SchemaField } from './types';

/**
 * What a one-turn `say hello` run deterministically produces. Every other schema
 * key (rate_limit_event, system/api_retry, result/error_during_execution, the bare
 * `result` fallback) is capture-owned: the probe can never trigger them, so it must
 * never touch them.
 */
export const PROBE_OWNED_TYPES: readonly string[] = ['system/init', 'assistant', 'result/success'];

/** Parses live probe output into a schema-key → observed-fields map. First occurrence of each key wins. */
export function extractObservedSchema(lines: readonly string[]): Record<string, SchemaField[]> {
  const observed: Record<string, SchemaField[]> = {};

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

    const msg = parsed as Record<string, unknown>;
    const key = schemaKeyFor(msg);
    if (key === null) continue;
    if (key in observed) continue;

    observed[key] = extractFieldSchema(msg);
  }

  return observed;
}

/**
 * Merges a probe-owned entry's committed fields against what was just observed:
 * a committed field survives (with its committed `required` flag) only if the live
 * run still carries it; a committed field the live run dropped is removed; a field
 * the live run added that the schema does not know is appended as optional.
 */
function mergeFieldList(committedFields: SchemaField[], observedFields: SchemaField[]): SchemaField[] {
  const observedByName = new Map(observedFields.map(f => [f.name, f]));
  const committedNames = new Set(committedFields.map(f => f.name));

  const merged: SchemaField[] = [];

  for (const committed of committedFields) {
    const liveField = observedByName.get(committed.name);
    if (!liveField) continue; // dropped by the live CLI — do not carry it forward

    const field: SchemaField = { ...committed };
    if (committed.type === 'object' && committed.fields && liveField.type === 'object' && liveField.fields) {
      field.fields = mergeFieldList(committed.fields, liveField.fields);
    } else if (committed.type === 'object' && liveField.fields) {
      field.fields = liveField.fields;
    }
    merged.push(field);
  }

  for (const observedField of observedFields) {
    if (!committedNames.has(observedField.name)) {
      merged.push({ ...observedField, required: false });
    }
  }

  return merged;
}

/**
 * Immutable: reconciles only the probe-owned keys the live run observed, preserving
 * every hand-curated `required` flag on a field the live run still carries. Every
 * other committed key — capture-owned or otherwise — is copied through untouched,
 * because the probe has no live evidence for it.
 */
export function mergeObservedSchema(
  committed: EnvelopeSchema,
  observed: Record<string, SchemaField[]>,
  probedAt: string,
  cliVersion: string | undefined,
): EnvelopeSchema {
  const messageTypes: Record<string, SchemaField[]> = { ...committed.messageTypes };

  for (const key of PROBE_OWNED_TYPES) {
    const observedFields = observed[key];
    if (!observedFields) continue;

    const committedFields = committed.messageTypes[key];
    messageTypes[key] = committedFields
      ? mergeFieldList(committedFields, observedFields)
      : observedFields;
  }

  const schema: EnvelopeSchema = { probedAt, messageTypes };
  if (cliVersion !== undefined) schema.cliVersion = cliVersion;
  return schema;
}

/** Dot-paths of every required field in `fields`, at any depth, absent from `observedFields`. */
function missingRequiredPaths(fields: SchemaField[], observedFields: SchemaField[], prefix: string): string[] {
  const observedByName = new Map(observedFields.map(f => [f.name, f]));
  return fields.flatMap((field) => {
    const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
    const liveField = observedByName.get(field.name);

    if (!liveField) {
      return field.required ? [fieldPath] : [];
    }
    if (field.fields && liveField.fields) {
      return missingRequiredPaths(field.fields, liveField.fields, fieldPath);
    }
    return [];
  });
}

/** Dot-paths of fields in `observedFields` that `fields` does not know, at any depth. */
function newFieldPaths(fields: SchemaField[], observedFields: SchemaField[], prefix: string): string[] {
  return observedFields.flatMap((observedField) => {
    const fieldPath = prefix ? `${prefix}.${observedField.name}` : observedField.name;
    const known = fields.find(f => f.name === observedField.name);
    if (!known) return [fieldPath];
    if (known.fields && observedField.fields) {
      return newFieldPaths(known.fields, observedField.fields, fieldPath);
    }
    return [];
  });
}

/** Compares the live probe's output against the committed schema for every probe-owned type. */
export function findLiveDrift(
  committed: EnvelopeSchema,
  observed: Record<string, SchemaField[]>,
): LiveDriftReport {
  const unobservedTypes: string[] = [];
  const missingRequired: string[] = [];
  const newFields: string[] = [];

  for (const key of PROBE_OWNED_TYPES) {
    const observedFields = observed[key];
    if (!observedFields) {
      unobservedTypes.push(key);
      continue;
    }

    const committedFields = committed.messageTypes[key] ?? [];
    missingRequired.push(...missingRequiredPaths(committedFields, observedFields, key));
    newFields.push(...newFieldPaths(committedFields, observedFields, key));
  }

  return {
    unobservedTypes,
    missingRequired,
    newFields,
    observedTypes: Object.keys(observed),
  };
}
