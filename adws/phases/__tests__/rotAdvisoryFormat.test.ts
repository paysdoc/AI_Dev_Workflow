import { describe, it, expect } from 'vitest';
import { formatRotAdvisoryComment } from '../rotAdvisoryFormat';
import { hasRegressionPromotionLabel } from '../../github/labelManager';
import type { RotVerdict } from '../../agents/rotAnalysisAgent';

describe('formatRotAdvisoryComment', () => {
  const verdicts: RotVerdict[] = [
    { step: 'a foo happens', keyword: 'Given', reuse: 'new', rot: 'VALID', note: 'looks good' },
    { step: 'bar occurs', keyword: 'When', reuse: 'reuse W1 (vocab)', rot: 'ROT', note: 'asserts file shape' },
  ];

  it('names the analysis advisory and non-blocking', () => {
    const body = formatRotAdvisoryComment('feature-665', verdicts);
    expect(body).toMatch(/advisory/i);
    expect(body).toMatch(/never blocks|non-blocking/i);
  });

  it('includes a Markdown table header', () => {
    const body = formatRotAdvisoryComment('feature-665', verdicts);
    expect(body).toContain('| Step (G/W/T) | Reuse | Rot | Note |');
  });

  it('includes one row per verdict carrying its step, reuse, rot, and note', () => {
    const body = formatRotAdvisoryComment('feature-665', verdicts);

    expect(body).toContain('a foo happens');
    expect(body).toContain('new');
    expect(body).toContain('VALID');
    expect(body).toContain('looks good');

    expect(body).toContain('bar occurs');
    expect(body).toContain('reuse W1 (vocab)');
    expect(body).toContain('ROT');
    expect(body).toContain('asserts file shape');
  });

  it('names the promoted feature id', () => {
    const body = formatRotAdvisoryComment('feature-665', verdicts);
    expect(body).toContain('feature-665');
  });

  it('emits a stable fallback line and no table when there are no verdicts', () => {
    const body = formatRotAdvisoryComment('feature-665', []);
    expect(body).toContain('No phrases were analysed for the promoted `feature-665` scenario.');
    expect(body).not.toContain('| Step (G/W/T) |');
  });

  it('is pure — same input always produces the same output', () => {
    const first = formatRotAdvisoryComment('feature-665', verdicts);
    const second = formatRotAdvisoryComment('feature-665', verdicts);
    expect(first).toBe(second);
  });
});

describe('hasRegressionPromotionLabel', () => {
  const cases: Array<[string, { name: string }[], boolean]> = [
    ['label present', [{ name: 'regression-promotion' }], true],
    ['label absent', [{ name: 'enhancement' }], false],
    ['mixed labels including the target', [{ name: 'adw:feature' }, { name: 'regression-promotion' }, { name: 'hitl' }], true],
    ['mixed labels without the target', [{ name: 'adw:feature' }, { name: 'hitl' }], false],
    ['empty labels', [], false],
  ];

  it.each(cases)('%s → %s', (_name, labels, expected) => {
    expect(hasRegressionPromotionLabel(labels)).toBe(expected);
  });
});
