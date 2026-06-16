import { describe, it, expect } from 'vitest';
import { evaluateResolveEdit } from '../resolveFreezeGuard';

describe('evaluateResolveEdit — all branches', () => {
  it('empty path list → permitted', () => {
    expect(evaluateResolveEdit([])).toEqual({ permitted: true });
  });

  it('app-code and step-def paths → permitted', () => {
    const result = evaluateResolveEdit([
      'src/checkout/payment.ts',
      'features/step_definitions/checkout.steps.ts',
    ]);
    expect(result.permitted).toBe(true);
    expect(result.flaggedFeature).toBeUndefined();
  });

  it('single .feature path → rejected with flaggedFeature', () => {
    const result = evaluateResolveEdit(['features/per-issue/feature-582.feature']);
    expect(result.permitted).toBe(false);
    expect(result.flaggedFeature).toBe('features/per-issue/feature-582.feature');
  });

  it('.feature path mixed with permitted edits → rejected, flagged file named', () => {
    const result = evaluateResolveEdit([
      'src/checkout/payment.ts',
      'features/checkout.feature',
      'features/step_definitions/checkout.steps.ts',
    ]);
    expect(result.permitted).toBe(false);
    expect(result.flaggedFeature).toBe('features/checkout.feature');
  });

  it('first .feature is flagged when multiple .feature paths present', () => {
    const result = evaluateResolveEdit(['features/a.feature', 'features/b.feature']);
    expect(result.permitted).toBe(false);
    expect(result.flaggedFeature).toBe('features/a.feature');
  });

  it('only implementation file paths → permitted', () => {
    const result = evaluateResolveEdit([
      'src/app/server.ts',
      'src/app/db.ts',
      'test/fixtures/data.json',
    ]);
    expect(result.permitted).toBe(true);
    expect(result.flaggedFeature).toBeUndefined();
  });
});
