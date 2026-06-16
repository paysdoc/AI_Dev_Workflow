import { describe, it, expect } from 'vitest';
import { computeResolveVerdict } from '../resolveVerdict';

describe('computeResolveVerdict — all branches', () => {
  // Not-green + budget remaining → retry
  it('target fails + regression passes + budget remaining → retry', () => {
    expect(computeResolveVerdict({ targetPass: false, regressionPass: true, budgetRemaining: true })).toBe('retry');
  });

  it('target fails + regression fails + budget remaining → retry', () => {
    expect(computeResolveVerdict({ targetPass: false, regressionPass: false, budgetRemaining: true })).toBe('retry');
  });

  // Not-green + budget exhausted → hard-fail
  it('target fails + regression passes + budget exhausted → hard-fail', () => {
    expect(computeResolveVerdict({ targetPass: false, regressionPass: true, budgetRemaining: false })).toBe('hard-fail');
  });

  it('target fails + regression fails + budget exhausted → hard-fail', () => {
    expect(computeResolveVerdict({ targetPass: false, regressionPass: false, budgetRemaining: false })).toBe('hard-fail');
  });

  // @regression gate: target green but regression fails → not-green
  it('target passes + regression fails + budget remaining → retry', () => {
    expect(computeResolveVerdict({ targetPass: true, regressionPass: false, budgetRemaining: true })).toBe('retry');
  });

  it('target passes + regression fails + budget exhausted → hard-fail', () => {
    expect(computeResolveVerdict({ targetPass: true, regressionPass: false, budgetRemaining: false })).toBe('hard-fail');
  });

  // Green + aligned (or no re-validation) → pass
  it('target passes + regression passes + no re-validation → pass', () => {
    expect(computeResolveVerdict({ targetPass: true, regressionPass: true, budgetRemaining: true })).toBe('pass');
  });

  it('target passes + regression passes + aligned → pass', () => {
    expect(computeResolveVerdict({ targetPass: true, regressionPass: true, postResolveAligned: true, budgetRemaining: true })).toBe('pass');
  });

  it('target passes + regression passes + aligned + budget exhausted → pass', () => {
    expect(computeResolveVerdict({ targetPass: true, regressionPass: true, postResolveAligned: true, budgetRemaining: false })).toBe('pass');
  });

  // Gaming guard: green but misaligned → hard-fail regardless of budget
  it('target passes + regression passes + misaligned + budget remaining → hard-fail', () => {
    expect(computeResolveVerdict({ targetPass: true, regressionPass: true, postResolveAligned: false, budgetRemaining: true })).toBe('hard-fail');
  });

  it('target passes + regression passes + misaligned + budget exhausted → hard-fail', () => {
    expect(computeResolveVerdict({ targetPass: true, regressionPass: true, postResolveAligned: false, budgetRemaining: false })).toBe('hard-fail');
  });
});
