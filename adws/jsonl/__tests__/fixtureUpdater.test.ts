import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { updateFixtureEnvelopes } from '../fixtureUpdater';
import type { EnvelopeSchema } from '../types';

const SCHEMA: EnvelopeSchema = {
  probedAt: '2026-01-01T00:00:00.000Z',
  messageTypes: {
    result: [
      { name: 'type', required: true, type: 'string' },
      { name: 'subtype', required: true, type: 'string' },
      { name: 'session_id', required: true, type: 'string' },
      { name: 'result', required: false, type: 'string' },
      {
        name: 'usage', required: true, type: 'object', fields: [
          { name: 'output_tokens', required: true, type: 'number' },
          { name: 'ttft_ms', required: false, type: 'number' },
        ],
      },
    ],
  },
};

let dir: string;
let schemaPath: string;
let fixturesDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jsonl-update-'));
  schemaPath = join(dir, 'schema.json');
  writeFileSync(schemaPath, JSON.stringify(SCHEMA), 'utf-8');
  fixturesDir = join(dir, 'fixtures');
  mkdirSync(fixturesDir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const filePath = join(fixturesDir, name);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('updateFixtureEnvelopes — add-only semantics', () => {
  it('restores a missing top-level required field and keeps the payload value', () => {
    const filePath = writeFixture(
      'result-error.jsonl',
      JSON.stringify({ type: 'result', subtype: 'success', result: 'API Error: 500', usage: { output_tokens: 1 } }),
    );
    const results = updateFixtureEnvelopes(schemaPath, fixturesDir);
    expect(results[0]!.changed).toBe(true);
    expect(results[0]!.changes).toContain('+session_id');

    const rewritten = JSON.parse(readFileSync(filePath, 'utf-8').trim()) as Record<string, unknown>;
    expect(rewritten['session_id']).toBe('');
    expect(rewritten['result']).toBe('API Error: 500');
  });

  it('backfills a missing nested required field', () => {
    const filePath = writeFixture(
      'result-nested.jsonl',
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: {} }),
    );
    const results = updateFixtureEnvelopes(schemaPath, fixturesDir);
    expect(results[0]!.changes).toContain('+usage.output_tokens');

    const rewritten = JSON.parse(readFileSync(filePath, 'utf-8').trim()) as { usage: { output_tokens: number } };
    expect(rewritten.usage.output_tokens).toBe(0);
  });

  it('leaves an absent optional field alone', () => {
    writeFixture(
      'result-optional.jsonl',
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: { output_tokens: 1 } }),
    );
    const results = updateFixtureEnvelopes(schemaPath, fixturesDir);
    expect(results[0]!.changed).toBe(false);
  });

  it('never removes a field the schema does not know', () => {
    const filePath = writeFixture(
      'result-unknown-field.jsonl',
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: { output_tokens: 1 }, mystery: 'keep me' }),
    );
    updateFixtureEnvelopes(schemaPath, fixturesDir);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('mystery');
  });

  it('never overwrites a value already present', () => {
    const filePath = writeFixture(
      'result-has-value.jsonl',
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'keep-this-id', usage: { output_tokens: 1 } }),
    );
    updateFixtureEnvelopes(schemaPath, fixturesDir);
    const rewritten = JSON.parse(readFileSync(filePath, 'utf-8').trim()) as Record<string, unknown>;
    expect(rewritten['session_id']).toBe('keep-this-id');
  });

  it('updates each line of a multi-line fixture independently', () => {
    const filePath = writeFixture(
      'multi.jsonl',
      [
        JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', usage: { output_tokens: 1 } }),
        JSON.stringify({ type: 'result', subtype: 'success', session_id: 's2', usage: { output_tokens: 1 } }),
      ].join('\n'),
    );
    const results = updateFixtureEnvelopes(schemaPath, fixturesDir);
    expect(results[0]!.changed).toBe(true);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)['session_id']).toBe('');
    expect(JSON.parse(lines[1]!)['session_id']).toBe('s2');
  });

  it('does not rewrite a fixture that already satisfies the schema', () => {
    const filePath = writeFixture(
      'result-complete.jsonl',
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: { output_tokens: 1 } }),
    );
    const before = statSync(filePath);
    const beforeContent = readFileSync(filePath, 'utf-8');
    const results = updateFixtureEnvelopes(schemaPath, fixturesDir);
    expect(results[0]!.changed).toBe(false);
    const after = statSync(filePath);
    expect(readFileSync(filePath, 'utf-8')).toBe(beforeContent);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
