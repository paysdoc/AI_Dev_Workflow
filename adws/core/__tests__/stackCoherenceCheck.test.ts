import { describe, it, expect } from 'vitest';
import { stackCoherenceCheck } from '../stackCoherenceCheck';

describe('stackCoherenceCheck', () => {
  it('coherent JS/TS — ADW-self regression guard', () => {
    const result = stackCoherenceCheck({
      testFramework: 'vitest',
      runTests: 'bun run test:unit',
      bddFramework: 'cucumber-js',
      runScenariosByTag: 'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('coherent Python', () => {
    const result = stackCoherenceCheck({
      testFramework: 'pytest',
      runTests: 'pytest tests',
      bddFramework: 'behave',
      runScenariosByTag: 'behave --tags @{tag}',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('incoherent (US22): Python test framework + cucumber-js run command → language-mismatch', () => {
    const result = stackCoherenceCheck({
      testFramework: 'pytest',
      runTests: 'pytest tests',
      bddFramework: 'cucumber-js',
      runScenariosByTag: 'cucumber-js --tags "@{tag}"',
    });
    expect(result.ok).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('language-mismatch');
  });

  it('non-Gherkin bddFramework → non-gherkin-bdd warning', () => {
    const result = stackCoherenceCheck({
      testFramework: 'vitest',
      runTests: 'bun run test:unit',
      bddFramework: 'playwright',
      runScenariosByTag: 'npx playwright test',
    });
    expect(result.ok).toBe(false);
    expect(result.warnings.some(w => w.code === 'non-gherkin-bdd')).toBe(true);
  });

  it('both warnings at once: mocha is non-Gherkin and JS vs Python mismatch', () => {
    const result = stackCoherenceCheck({
      testFramework: 'pytest',
      runTests: 'pytest',
      bddFramework: 'mocha',
      runScenariosByTag: 'mocha',
    });
    expect(result.ok).toBe(false);
    expect(result.warnings.some(w => w.code === 'non-gherkin-bdd')).toBe(true);
    expect(result.warnings.some(w => w.code === 'language-mismatch')).toBe(true);
  });

  it('empty bddFramework is the Gherkin default — no non-gherkin warning', () => {
    const result = stackCoherenceCheck({
      testFramework: 'vitest',
      runTests: 'bun test',
      bddFramework: '',
      runScenariosByTag: 'cucumber-js --tags @{tag}',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('no false positive from unknown signals', () => {
    const result = stackCoherenceCheck({
      testFramework: 'someframework',
      runTests: 'make test',
      bddFramework: 'cucumber-js',
      runScenariosByTag: 'cucumber-js --tags @{tag}',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('all-default/empty → ok', () => {
    const result = stackCoherenceCheck({
      testFramework: '',
      runTests: '',
      bddFramework: '',
      runScenariosByTag: '',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
