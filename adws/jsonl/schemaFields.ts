import type { EnvelopeSchema, SchemaField } from './types';

/**
 * Objects whose keys are data (model ids, rate-limit window names), not schema —
 * recording their nested shape would mean the schema keys on values it should
 * never assert about.
 */
export const OPAQUE_OBJECT_FIELDS: ReadonlySet<string> = new Set(['modelUsage', 'unifiedWindows']);

function getJsonType(value: unknown): SchemaField['type'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object') return t;
  return 'string';
}

/** All observed fields are marked required:true (the caller sees one live example). */
export function extractFieldSchema(obj: unknown): SchemaField[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [];

  return Object.entries(obj as Record<string, unknown>).map(([name, value]) => {
    const type = getJsonType(value);
    const field: SchemaField = { name, required: true, type };
    if (type === 'object' && value !== null && !OPAQUE_OBJECT_FIELDS.has(name)) {
      field.fields = extractFieldSchema(value);
    }
    return field;
  });
}

/** `${type}/${subtype}` when `subtype` is a string, else bare `type`; `null` when `type` is absent. */
export function schemaKeyFor(msg: Record<string, unknown>): string | null {
  const type = msg['type'];
  if (typeof type !== 'string') return null;
  const subtype = msg['subtype'];
  return typeof subtype === 'string' ? `${type}/${subtype}` : type;
}

/** Exact `type/subtype` key first, then the bare `type` fallback, else no coverage. */
export function resolveSchemaFields(
  schema: EnvelopeSchema,
  msg: Record<string, unknown>,
): { key: string; fields: SchemaField[] } | null {
  const key = schemaKeyFor(msg);
  if (key === null) return null;

  const exact = schema.messageTypes[key];
  if (exact) return { key, fields: exact };

  const type = msg['type'];
  if (typeof type === 'string' && type !== key) {
    const fallback = schema.messageTypes[type];
    if (fallback) return { key: type, fields: fallback };
  }

  return null;
}

/** Returns dot-path strings for each missing required field. A `null` value counts as present. */
export function findMissingFields(
  data: Record<string, unknown>,
  schemaFields: SchemaField[],
  prefix: string,
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
export function findExtraFields(
  data: Record<string, unknown>,
  schemaFields: SchemaField[],
  prefix: string,
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
