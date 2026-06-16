import { describe, it, expect } from 'vitest';
import { extractFidelityResult, formatFidelityArgs } from '../scenarioFidelityAgent';

describe('extractFidelityResult', () => {
  it('valid JSON with aligned:true → success:true', () => {
    const output = JSON.stringify({ aligned: true, mismatches: [], summary: 'All aligned.' });
    const result = extractFidelityResult(output);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.aligned).toBe(true);
    expect(result.data.mismatches).toEqual([]);
    expect(result.data.summary).toBe('All aligned.');
  });

  it('valid JSON with aligned:false → success:true with mismatches', () => {
    const output = JSON.stringify({
      aligned: false,
      mismatches: [{ type: 'plan_uncovered', description: 'AC1 not covered' }],
      summary: 'One mismatch found.',
    });
    const result = extractFidelityResult(output);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.aligned).toBe(false);
    expect(result.data.mismatches).toHaveLength(1);
  });

  it('missing aligned boolean → success:false with descriptive error', () => {
    const output = JSON.stringify({ mismatches: [], summary: 'oops' });
    const result = extractFidelityResult(output);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toContain('"aligned"');
  });

  it('empty string → success:false', () => {
    const result = extractFidelityResult('');
    expect(result.success).toBe(false);
  });

  it('malformed JSON → success:false', () => {
    const result = extractFidelityResult('not json at all');
    expect(result.success).toBe(false);
  });

  it('missing mismatches normalised to empty array', () => {
    const output = JSON.stringify({ aligned: true, summary: 'ok' });
    const result = extractFidelityResult(output);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.mismatches).toEqual([]);
  });

  it('missing summary normalised to empty string', () => {
    const output = JSON.stringify({ aligned: true, mismatches: [] });
    const result = extractFidelityResult(output);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.summary).toBe('');
  });
});

describe('formatFidelityArgs', () => {
  it('returns positional args in order', () => {
    const args = formatFidelityArgs('id1', 42, 'features/', 'issue body here');
    expect(args).toEqual(['id1', '42', 'features/', 'issue body here']);
  });
});
