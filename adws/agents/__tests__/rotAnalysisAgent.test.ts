import { describe, it, expect } from 'vitest';
import { extractRotVerdicts } from '../rotAnalysisAgent';

describe('extractRotVerdicts', () => {
  it('well-formed JSON array → success:true with parsed verdicts', () => {
    const output = JSON.stringify([
      { step: 'a foo happens', keyword: 'Given', reuse: 'new', rot: 'VALID', note: 'ok' },
      { step: 'bar occurs', keyword: 'When', reuse: 'reuse W1 (vocab)', rot: 'ROT', note: 'rework' },
    ]);
    const result = extractRotVerdicts(output);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual({ step: 'a foo happens', keyword: 'Given', reuse: 'new', rot: 'VALID', note: 'ok' });
    expect(result.data[1].rot).toBe('ROT');
  });

  it('array wrapped in a fenced code block with surrounding prose still parses', () => {
    const output = [
      'Here is the analysis:',
      '```json',
      JSON.stringify([{ step: 'x happens', keyword: 'Then', reuse: 'new', rot: 'VALID', note: '' }]),
      '```',
      'Let me know if you need more detail.',
    ].join('\n');
    const result = extractRotVerdicts(output);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].step).toBe('x happens');
  });

  it('output with no brackets at all → success:false', () => {
    const result = extractRotVerdicts('not json at all, no brackets here');
    expect(result.success).toBe(false);
  });

  it('bracketed but unparseable content → success:false', () => {
    const result = extractRotVerdicts('[this is not valid json]');
    expect(result.success).toBe(false);
  });

  it('out-of-range rot value is coerced to UNKNOWN', () => {
    const output = JSON.stringify([{ step: 'x happens', keyword: 'Given', reuse: 'new', rot: 'MAYBE', note: '' }]);
    const result = extractRotVerdicts(output);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data[0].rot).toBe('UNKNOWN');
  });

  it('empty array → success:true with empty data', () => {
    const result = extractRotVerdicts('[]');
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data).toEqual([]);
  });

  it('entry missing required step field → success:false', () => {
    const output = JSON.stringify([{ keyword: 'Given', reuse: 'new', rot: 'VALID', note: '' }]);
    const result = extractRotVerdicts(output);
    expect(result.success).toBe(false);
  });

  it('parsed JSON that is not an array → success:false', () => {
    const result = extractRotVerdicts(JSON.stringify({ step: 'x happens' }));
    expect(result.success).toBe(false);
  });
});
