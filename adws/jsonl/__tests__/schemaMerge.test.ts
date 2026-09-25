import { describe, it, expect } from 'vitest';
import { extractObservedSchema, mergeObservedSchema, findLiveDrift, PROBE_OWNED_TYPES } from '../schemaMerge';
import type { EnvelopeSchema } from '../types';

const EMPTY_SCHEMA: EnvelopeSchema = { probedAt: '2026-01-01T00:00:00.000Z', messageTypes: {} };

describe('PROBE_OWNED_TYPES', () => {
  it('covers exactly the three types a one-turn run deterministically produces', () => {
    expect(PROBE_OWNED_TYPES).toEqual(['system/init', 'assistant', 'result/success']);
  });
});

describe('extractObservedSchema', () => {
  it('keys by type/subtype and keeps the first occurrence of each key', () => {
    const lines = [
      '{"type":"system","subtype":"init","session_id":"a"}',
      '{"type":"assistant","message":{}}',
      '{"type":"system","subtype":"init","session_id":"b","extra":true}',
    ];
    const observed = extractObservedSchema(lines);
    expect(Object.keys(observed).sort()).toEqual(['assistant', 'system/init']);
    expect(observed['system/init']!.find(f => f.name === 'extra')).toBeUndefined();
  });

  it('skips non-JSON and typeless lines', () => {
    const observed = extractObservedSchema(['not json', '{"no":"type"}', '{"type":"result","subtype":"success"}']);
    expect(Object.keys(observed)).toEqual(['result/success']);
  });
});

describe('mergeObservedSchema', () => {
  it('marks every field of a brand-new probe-owned type as required', () => {
    const observed = { 'system/init': [{ name: 'session_id', required: true, type: 'string' as const }] };
    const merged = mergeObservedSchema(EMPTY_SCHEMA, observed, '2026-09-25T00:00:00.000Z', '2.1.282');
    expect(merged.messageTypes['system/init']).toEqual([{ name: 'session_id', required: true, type: 'string' }]);
    expect(merged.probedAt).toBe('2026-09-25T00:00:00.000Z');
    expect(merged.cliVersion).toBe('2.1.282');
  });

  it('preserves a hand-set required:false flag for a field still observed live', () => {
    const committed: EnvelopeSchema = {
      probedAt: '2026-01-01T00:00:00.000Z',
      messageTypes: { assistant: [{ name: 'request_id', required: false, type: 'string' }] },
    };
    const observed = { assistant: [{ name: 'request_id', required: true, type: 'string' as const }] };
    const merged = mergeObservedSchema(committed, observed, '2026-09-25T00:00:00.000Z', undefined);
    expect(merged.messageTypes['assistant']).toEqual([{ name: 'request_id', required: false, type: 'string' }]);
  });

  it('drops a committed field the live run no longer emits and appends a new one as optional', () => {
    const committed: EnvelopeSchema = {
      probedAt: '2026-01-01T00:00:00.000Z',
      messageTypes: { 'result/success': [{ name: 'vanished', required: true, type: 'string' }] },
    };
    const observed = { 'result/success': [{ name: 'brand_new', required: true, type: 'number' as const }] };
    const merged = mergeObservedSchema(committed, observed, '2026-09-25T00:00:00.000Z', undefined);
    expect(merged.messageTypes['result/success']).toEqual([{ name: 'brand_new', required: false, type: 'number' }]);
  });

  it('merges nested object fields (message.usage) the same way', () => {
    const committed: EnvelopeSchema = {
      probedAt: '2026-01-01T00:00:00.000Z',
      messageTypes: {
        assistant: [{
          name: 'message', required: true, type: 'object', fields: [
            { name: 'usage', required: true, type: 'object', fields: [
              { name: 'input_tokens', required: true, type: 'number' },
              { name: 'gone', required: true, type: 'number' },
            ] },
          ],
        }],
      },
    };
    const observed = {
      assistant: [{
        name: 'message', required: true, type: 'object' as const, fields: [
          { name: 'usage', required: true, type: 'object' as const, fields: [
            { name: 'input_tokens', required: true, type: 'number' as const },
            { name: 'output_tokens', required: true, type: 'number' as const },
          ] },
        ],
      }],
    };
    const merged = mergeObservedSchema(committed, observed, '2026-09-25T00:00:00.000Z', undefined);
    const usage = merged.messageTypes['assistant']![0]!.fields!.find(f => f.name === 'usage');
    expect(usage!.fields).toEqual([
      { name: 'input_tokens', required: true, type: 'number' },
      { name: 'output_tokens', required: false, type: 'number' },
    ]);
  });

  it('never rewrites a capture-owned entry even when it was observed live', () => {
    const committed: EnvelopeSchema = {
      probedAt: '2026-01-01T00:00:00.000Z',
      messageTypes: { rate_limit_event: [{ name: 'type', required: true, type: 'string' }] },
    };
    const observed = { rate_limit_event: [{ name: 'type', required: true, type: 'string' as const }, { name: 'rate_limit_info', required: true, type: 'object' as const }] };
    const merged = mergeObservedSchema(committed, observed, '2026-09-25T00:00:00.000Z', undefined);
    expect(merged.messageTypes['rate_limit_event']).toEqual(committed.messageTypes['rate_limit_event']);
  });

  it('copies the bare result fallback through untouched', () => {
    const committed: EnvelopeSchema = {
      probedAt: '2026-01-01T00:00:00.000Z',
      messageTypes: { result: [{ name: 'subtype', required: true, type: 'string' }] },
    };
    const merged = mergeObservedSchema(committed, {}, '2026-09-25T00:00:00.000Z', undefined);
    expect(merged.messageTypes['result']).toEqual(committed.messageTypes['result']);
  });

  it('does not write an observed key that is not probe-owned', () => {
    const observed = { rate_limit_event: [{ name: 'type', required: true, type: 'string' as const }] };
    const merged = mergeObservedSchema(EMPTY_SCHEMA, observed, '2026-09-25T00:00:00.000Z', undefined);
    expect(merged.messageTypes['rate_limit_event']).toBeUndefined();
  });
});

describe('findLiveDrift', () => {
  const committed: EnvelopeSchema = {
    probedAt: '2026-01-01T00:00:00.000Z',
    messageTypes: {
      'system/init': [{ name: 'is_error', required: true, type: 'boolean' }],
      assistant: [{ name: 'type', required: true, type: 'string' }],
      'result/success': [{ name: 'type', required: true, type: 'string' }],
    },
  };

  it('reports a renamed required field as missing', () => {
    const observed = {
      'system/init': [{ name: 'isError', required: true, type: 'boolean' as const }],
      assistant: [{ name: 'type', required: true, type: 'string' as const }],
      'result/success': [{ name: 'type', required: true, type: 'string' as const }],
    };
    const drift = findLiveDrift(committed, observed);
    expect(drift.missingRequired).toContain('system/init.is_error');
  });

  it('reports an unobserved probe-owned type', () => {
    const observed = {
      assistant: [{ name: 'type', required: true, type: 'string' as const }],
      'result/success': [{ name: 'type', required: true, type: 'string' as const }],
    };
    const drift = findLiveDrift(committed, observed);
    expect(drift.unobservedTypes).toEqual(['system/init']);
  });

  it('lists an added field as new only, never as missing', () => {
    const observed = {
      'system/init': [{ name: 'is_error', required: true, type: 'boolean' as const }, { name: 'brand_new', required: true, type: 'string' as const }],
      assistant: [{ name: 'type', required: true, type: 'string' as const }],
      'result/success': [{ name: 'type', required: true, type: 'string' as const }],
    };
    const drift = findLiveDrift(committed, observed);
    expect(drift.newFields).toContain('system/init.brand_new');
    expect(drift.missingRequired).toEqual([]);
  });

  it('ignores an absent optional field', () => {
    const optionalCommitted: EnvelopeSchema = {
      probedAt: '2026-01-01T00:00:00.000Z',
      messageTypes: {
        'system/init': [{ name: 'ttft_ms', required: false, type: 'number' }],
        assistant: [],
        'result/success': [],
      },
    };
    const drift = findLiveDrift(optionalCommitted, { 'system/init': [], assistant: [], 'result/success': [] });
    expect(drift.missingRequired).toEqual([]);
  });
});
