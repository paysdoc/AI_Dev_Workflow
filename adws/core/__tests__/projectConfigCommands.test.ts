import { describe, it, expect } from 'vitest';
import { parseCommandsMd, getDefaultCommandsConfig } from '../projectConfig';

describe('parseCommandsMd — testDirectory field', () => {
  it('defaults testDirectory to "src" when content is empty', () => {
    const result = parseCommandsMd('');
    expect(result.testDirectory).toBe('src');
  });

  it('defaults testDirectory to "src" when "## Test Directory" section is absent', () => {
    const content = '## Run Tests\nbun run test\n';
    const result = parseCommandsMd(content);
    expect(result.testDirectory).toBe('src');
  });

  it('reads testDirectory from "## Test Directory" section', () => {
    const content = '## Test Directory\ntests\n';
    const result = parseCommandsMd(content);
    expect(result.testDirectory).toBe('tests');
  });

  it('trims whitespace from testDirectory value', () => {
    const content = '## Test Directory\n  tests/  \n';
    const result = parseCommandsMd(content);
    expect(result.testDirectory).toBe('tests/');
  });

  it('reads custom testDirectory while preserving other defaults', () => {
    const content = '## Test Directory\ntests\n\n## Run Tests\npytest\n';
    const result = parseCommandsMd(content);
    expect(result.testDirectory).toBe('tests');
    expect(result.runTests).toBe('pytest');
    expect(result.packageManager).toBe('bun');
  });
});

describe('parseCommandsMd — testFramework field', () => {
  it('defaults testFramework to "" when content is empty', () => {
    const result = parseCommandsMd('');
    expect(result.testFramework).toBe('');
  });

  it('defaults testFramework to "" when "## Test Framework" section is absent', () => {
    const content = '## Run Tests\nbun run test\n';
    const result = parseCommandsMd(content);
    expect(result.testFramework).toBe('');
  });

  it('reads testFramework from "## Test Framework" section', () => {
    const content = '## Test Framework\npytest\n';
    const result = parseCommandsMd(content);
    expect(result.testFramework).toBe('pytest');
  });

  it('reads custom testFramework while preserving other defaults', () => {
    const content = '## Test Framework\nvitest\n\n## Run Tests\nbun run test\n';
    const result = parseCommandsMd(content);
    expect(result.testFramework).toBe('vitest');
    expect(result.runTests).toBe('bun run test');
  });
});

describe('getDefaultCommandsConfig — testDirectory and testFramework', () => {
  it('includes testDirectory defaulting to "src"', () => {
    const defaults = getDefaultCommandsConfig();
    expect(defaults.testDirectory).toBe('src');
  });

  it('includes testFramework defaulting to ""', () => {
    const defaults = getDefaultCommandsConfig();
    expect(defaults.testFramework).toBe('');
  });
});

describe('parseCommandsMd — suppressionPatterns field', () => {
  it('reads the trimmed body of "## Suppression Patterns"', () => {
    const content = '## Run Tests\nbun run test\n\n## Suppression Patterns\n\n- `@acme-lint off`\n- widgets-lint: off\n\n';
    const result = parseCommandsMd(content);
    expect(result.suppressionPatterns).toBe('- `@acme-lint off`\n- widgets-lint: off');
  });

  it('keeps the other sections apart from the suppression patterns', () => {
    const content = '## Suppression Patterns\n- widgets-lint: off\n\n## Test Framework\nvitest\n';
    const result = parseCommandsMd(content);
    expect(result.suppressionPatterns).toBe('- widgets-lint: off');
    expect(result.testFramework).toBe('vitest');
  });

  it('defaults suppressionPatterns to "" when the section is absent', () => {
    const result = parseCommandsMd('## Run Tests\nbun run test\n');
    expect(result.suppressionPatterns).toBe('');
  });

  it('defaults suppressionPatterns to "" when content is empty', () => {
    expect(parseCommandsMd('').suppressionPatterns).toBe('');
  });

  it('is "" in getDefaultCommandsConfig', () => {
    expect(getDefaultCommandsConfig().suppressionPatterns).toBe('');
  });
});
