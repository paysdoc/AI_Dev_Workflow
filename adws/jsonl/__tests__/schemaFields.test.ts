import { describe, it, expect } from 'vitest';
import {
  schemaKeyFor,
  resolveSchemaFields,
  extractFieldSchema,
  findMissingFields,
  OPAQUE_OBJECT_FIELDS,
} from '../schemaFields';
import type { EnvelopeSchema } from '../types';

describe('schemaKeyFor', () => {
  it('joins type and subtype when subtype is a string', () => {
    expect(schemaKeyFor({ type: 'system', subtype: 'init' })).toBe('system/init');
  });

  it('returns bare type when there is no subtype', () => {
    expect(schemaKeyFor({ type: 'assistant' })).toBe('assistant');
  });

  it('returns null when type is missing', () => {
    expect(schemaKeyFor({ subtype: 'init' })).toBeNull();
  });

  it('returns null when type is not a string', () => {
    expect(schemaKeyFor({ type: 42 })).toBeNull();
  });

  it('falls back to bare type when subtype is not a string', () => {
    expect(schemaKeyFor({ type: 'result', subtype: null })).toBe('result');
  });
});

describe('resolveSchemaFields', () => {
  const schema: EnvelopeSchema = {
    probedAt: '2026-01-01T00:00:00.000Z',
    messageTypes: {
      'system/init': [{ name: 'type', required: true, type: 'string' }],
      result: [{ name: 'subtype', required: true, type: 'string' }],
    },
  };

  it('resolves an exact type/subtype key', () => {
    const resolved = resolveSchemaFields(schema, { type: 'system', subtype: 'init' });
    expect(resolved?.key).toBe('system/init');
  });

  it('falls back to the bare type entry for an unknown subtype', () => {
    const resolved = resolveSchemaFields(schema, { type: 'result', subtype: 'error_max_turns' });
    expect(resolved?.key).toBe('result');
  });

  it('falls back to the bare type entry when subtype is absent', () => {
    const resolved = resolveSchemaFields(schema, { type: 'result' });
    expect(resolved?.key).toBe('result');
  });

  it('returns null when neither the exact key nor the bare type is known', () => {
    const resolved = resolveSchemaFields(schema, { type: 'rate_limit_event' });
    expect(resolved).toBeNull();
  });
});

describe('extractFieldSchema', () => {
  it('recurses into nested objects', () => {
    const fields = extractFieldSchema({ message: { usage: { input_tokens: 1 } } });
    const message = fields.find(f => f.name === 'message');
    expect(message?.fields?.find(f => f.name === 'usage')?.fields?.[0]).toEqual({
      name: 'input_tokens',
      required: true,
      type: 'number',
    });
  });

  it('records opaque object fields without nested fields', () => {
    expect(OPAQUE_OBJECT_FIELDS.has('modelUsage')).toBe(true);
    const fields = extractFieldSchema({ modelUsage: { 'claude-sonnet-5': { inputTokens: 1 } } });
    const modelUsage = fields.find(f => f.name === 'modelUsage');
    expect(modelUsage?.type).toBe('object');
    expect(modelUsage?.fields).toBeUndefined();
  });

  it('types a null value as "null"', () => {
    const fields = extractFieldSchema({ api_error_status: null });
    expect(fields[0]).toEqual({ name: 'api_error_status', required: true, type: 'null' });
  });
});

describe('findMissingFields', () => {
  it('reports a nested dot-path for a missing required field', () => {
    const missing = findMissingFields(
      { message: { usage: {} } },
      [{ name: 'message', required: true, type: 'object', fields: [
        { name: 'usage', required: true, type: 'object', fields: [
          { name: 'output_tokens', required: true, type: 'number' },
        ] },
      ] }],
      '',
    );
    expect(missing).toEqual(['message.usage.output_tokens']);
  });

  it('does not report an absent optional field', () => {
    const missing = findMissingFields({}, [{ name: 'ttft_ms', required: false, type: 'number' }], '');
    expect(missing).toEqual([]);
  });

  it('treats a null value as present', () => {
    const missing = findMissingFields(
      { api_error_status: null },
      [{ name: 'api_error_status', required: true, type: 'null' }],
      '',
    );
    expect(missing).toEqual([]);
  });
});
