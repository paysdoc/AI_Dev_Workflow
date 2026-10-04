import { describe, it, expect } from 'vitest';
import { stackCoherenceCheck, inferStackLanguages, type StackCoherenceInput } from '../stackCoherenceCheck';

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

describe('inferStackLanguages', () => {
  const none: StackCoherenceInput = { testFramework: '', bddFramework: '', runTests: '', runScenariosByTag: '' };

  it("finds only javascript in ADW's own descriptors", () => {
    const languages = inferStackLanguages({
      testFramework: 'vitest',
      bddFramework: 'cucumber-js',
      runTests: 'bun run test:unit',
      runScenariosByTag: 'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"',
    });

    expect([...languages]).toEqual(['javascript']);
  });

  it.each([
    ['pytest and behave', { testFramework: 'pytest', bddFramework: 'behave' }, 'python'],
    ['go test and godog', { testFramework: 'go test', bddFramework: 'godog' }, 'go'],
    ['cargo test and cucumber-rs', { testFramework: 'cargo test', bddFramework: 'cucumber-rs' }, 'rust'],
    ['rspec and cucumber-ruby', { testFramework: 'rspec', bddFramework: 'cucumber-ruby' }, 'ruby'],
  ])('finds one language for %s', (_name, descriptors, language) => {
    expect([...inferStackLanguages({ ...none, ...descriptors })]).toEqual([language]);
  });

  it('does not take cargo test for go', () => {
    expect([...inferStackLanguages({ ...none, testFramework: 'cargo test' })]).toEqual(['rust']);
  });

  it('finds every language of a mixed stack', () => {
    const languages = inferStackLanguages({ ...none, testFramework: 'pytest', bddFramework: 'cucumber-js' });

    expect(new Set(languages)).toEqual(new Set(['python', 'javascript']));
  });

  it('finds a language from the run commands as well as from the framework names', () => {
    const languages = inferStackLanguages({ ...none, runTests: 'cargo test', runScenariosByTag: 'bundle exec cucumber --tags @{tag}' });

    expect(new Set(languages)).toEqual(new Set(['rust', 'ruby']));
  });

  it('finds none for a stack it does not know', () => {
    expect(inferStackLanguages({ ...none, testFramework: 'ExUnit', bddFramework: 'cabbage' }).size).toBe(0);
  });

  it('finds none when every descriptor is empty', () => {
    expect(inferStackLanguages(none).size).toBe(0);
  });

  it('agrees with stackCoherenceCheck about when a stack spans several languages', () => {
    const mixed: StackCoherenceInput = { testFramework: 'pytest', bddFramework: 'cucumber-js', runTests: 'pytest', runScenariosByTag: 'cucumber-js' };

    expect(inferStackLanguages(mixed).size).toBeGreaterThan(1);
    expect(stackCoherenceCheck(mixed).warnings.some(w => w.code === 'language-mismatch')).toBe(true);
  });
});
