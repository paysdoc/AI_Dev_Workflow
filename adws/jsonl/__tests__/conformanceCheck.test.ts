import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkConformance } from '../conformanceCheck';
import type { EnvelopeSchema } from '../types';

const MINIMAL_SCHEMA: EnvelopeSchema = {
  probedAt: '2026-01-01T00:00:00.000Z',
  messageTypes: {
    'system/init': [
      { name: 'type', required: true, type: 'string' },
      { name: 'subtype', required: true, type: 'string' },
    ],
    assistant: [
      { name: 'type', required: true, type: 'string' },
      {
        name: 'message', required: true, type: 'object', fields: [
          { name: 'usage', required: true, type: 'object', fields: [
            { name: 'output_tokens', required: true, type: 'number' },
          ] },
        ],
      },
    ],
    'result/success': [
      { name: 'type', required: true, type: 'string' },
      { name: 'subtype', required: true, type: 'string' },
      { name: 'is_error', required: true, type: 'boolean' },
      { name: 'modelUsage', required: true, type: 'object' },
    ],
    rate_limit_event: [
      { name: 'type', required: true, type: 'string' },
      { name: 'rate_limit_info', required: true, type: 'object', fields: [
        { name: 'status', required: true, type: 'string' },
      ] },
    ],
    result: [
      { name: 'type', required: true, type: 'string' },
      { name: 'subtype', required: true, type: 'string' },
      { name: 'is_error', required: true, type: 'boolean' },
    ],
  },
};

let dir: string;
let schemaPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jsonl-check-'));
  schemaPath = join(dir, 'schema.json');
  writeFileSync(schemaPath, JSON.stringify(MINIMAL_SCHEMA), 'utf-8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const fixturesDir = join(dir, 'fixtures');
  mkdirSync(fixturesDir, { recursive: true });
  const filePath = join(fixturesDir, name);
  writeFileSync(filePath, content, 'utf-8');
  return fixturesDir;
}

describe('checkConformance — parser newline regression', () => {
  it('passes a single-line fixture with no trailing newline', () => {
    const fixturesDir = writeFixture(
      'assistant-only.jsonl',
      '{"type":"assistant","message":{"usage":{"output_tokens":5}}}',
    );
    const [result] = checkConformance(schemaPath, fixturesDir);
    expect(result?.passed).toBe(true);
    expect(result?.parserErrors).toEqual([]);
  });
});

describe('checkConformance — multi-line fixtures', () => {
  it('passes a session excerpt covering init, a rejected rate_limit_event, assistant and result', () => {
    const fixturesDir = writeFixture(
      'session.jsonl',
      [
        '{"type":"system","subtype":"init"}',
        '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}',
        '{"type":"assistant","message":{"usage":{"output_tokens":5}}}',
        '{"type":"result","subtype":"success","is_error":true,"modelUsage":{}}',
      ].join('\n'),
    );
    const [result] = checkConformance(schemaPath, fixturesDir);
    expect(result?.passed).toBe(true);
    expect(result?.lineCount).toBe(4);
  });

  it('passes an allowed rate_limit_event without requiring rateLimitRejected', () => {
    const fixturesDir = writeFixture(
      'allowed.jsonl',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
    );
    const [result] = checkConformance(schemaPath, fixturesDir);
    expect(result?.passed).toBe(true);
  });

  it('fails a rejected rate_limit_event whose parser state never sees a trailing newline problem — sanity companion', () => {
    const fixturesDir = writeFixture(
      'rejected.jsonl',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}',
    );
    const [result] = checkConformance(schemaPath, fixturesDir);
    expect(result?.passed).toBe(true);
    expect(result?.parserErrors).toEqual([]);
  });
});

describe('checkConformance — missing and unknown fields', () => {
  it('fails with a nested dot-path when a required nested field is missing', () => {
    const fixturesDir = writeFixture(
      'assistant-missing.jsonl',
      '{"type":"assistant","message":{"usage":{}}}',
    );
    const [result] = checkConformance(schemaPath, fixturesDir);
    expect(result?.passed).toBe(false);
    expect(result?.missingFields).toEqual(['message.usage.output_tokens']);
  });

  it('falls back to the bare type entry for an unknown subtype', () => {
    const fixturesDir = writeFixture(
      'result-unknown-subtype.jsonl',
      '{"type":"result","subtype":"error_max_turns","is_error":true}',
    );
    const [result] = checkConformance(schemaPath, fixturesDir);
    expect(result?.passed).toBe(true);
  });

  it('fails naming subtype when a result line has lost its subtype', () => {
    const fixturesDir = writeFixture(
      'result-no-subtype.jsonl',
      '{"type":"result","is_error":true}',
    );
    const [result] = checkConformance(schemaPath, fixturesDir);
    expect(result?.passed).toBe(false);
    expect(result?.missingFields).toEqual(['subtype']);
  });

  it('passes an unknown type informationally, without failing', () => {
    const fixturesDir = writeFixture(
      'unknown-type.jsonl',
      '{"type":"tool_result","is_error":false}',
    );
    const [result] = checkConformance(schemaPath, fixturesDir);
    expect(result?.passed).toBe(true);
    expect(result?.extraFields[0]).toContain('no schema coverage');
  });
});

describe('checkConformance — extractor behaviour with an empty modelUsage', () => {
  it('passes the extractor check when a result after an assistant line carries modelUsage: {}', () => {
    const fixturesDir = writeFixture(
      'rate-limited-first-call.jsonl',
      [
        '{"type":"assistant","message":{"usage":{"output_tokens":0}}}',
        '{"type":"result","subtype":"success","is_error":true,"modelUsage":{}}',
      ].join('\n'),
    );
    const [result] = checkConformance(schemaPath, fixturesDir);
    expect(result?.passed).toBe(true);
    expect(result?.extractorErrors).toEqual([]);
  });
});

describe('checkConformance — multiple fixture directories', () => {
  it('checks fixtures from every directory passed in', () => {
    const dirA = join(dir, 'a');
    const dirB = join(dir, 'b');
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    writeFileSync(join(dirA, 'one.jsonl'), '{"type":"system","subtype":"init"}', 'utf-8');
    writeFileSync(join(dirB, 'two.jsonl'), '{"type":"system","subtype":"init"}', 'utf-8');

    const results = checkConformance(schemaPath, [dirA, dirB]);
    expect(results.map(r => r.fixturePath).some(p => p.endsWith('one.jsonl'))).toBe(true);
    expect(results.map(r => r.fixturePath).some(p => p.endsWith('two.jsonl'))).toBe(true);
  });
});

describe('checkConformance — repository defaults', () => {
  it('passes every real fixture and stub envelope against the committed schema', () => {
    const results = checkConformance();
    const failed = results.filter(r => !r.passed);
    expect(failed).toEqual([]);
    expect(results.length).toBeGreaterThan(0);
  });
});
