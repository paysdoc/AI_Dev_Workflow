import { describe, it, expect } from 'vitest';
import { parseCommandsMd, getDefaultCommandsConfig, parseScenariosMd, loadProjectConfig } from '../projectConfig';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseCommandsMd — healthCheckPath field', () => {
  it('defaults healthCheckPath to "/" when content is empty', () => {
    const result = parseCommandsMd('');
    expect(result.healthCheckPath).toBe('/');
  });

  it('defaults healthCheckPath to "/" when "## Health Check Path" section is absent', () => {
    const content = '## Start Dev Server\nbun run dev\n';
    const result = parseCommandsMd(content);
    expect(result.healthCheckPath).toBe('/');
  });

  it('reads healthCheckPath from "## Health Check Path" section', () => {
    const content = '## Health Check Path\n/api/health\n';
    const result = parseCommandsMd(content);
    expect(result.healthCheckPath).toBe('/api/health');
  });

  it('reads a custom healthCheckPath while preserving other defaults', () => {
    const content = '## Health Check Path\n/ready\n\n## Start Dev Server\nbun start\n';
    const result = parseCommandsMd(content);
    expect(result.healthCheckPath).toBe('/ready');
    expect(result.startDevServer).toBe('bun start');
  });

  it('trims whitespace from the healthCheckPath value', () => {
    const content = '## Health Check Path\n  /health  \n';
    const result = parseCommandsMd(content);
    expect(result.healthCheckPath).toBe('/health');
  });
});

describe('getDefaultCommandsConfig — healthCheckPath', () => {
  it('includes healthCheckPath defaulting to "/"', () => {
    const defaults = getDefaultCommandsConfig();
    expect(defaults.healthCheckPath).toBe('/');
  });
});

describe('parseScenariosMd — per-issue / regression / vocabulary fields', () => {
  it('all three new sections absent → fields are undefined; existing defaults preserved', () => {
    const content = '## Scenario Directory\nfeatures/\n\n## Run Scenarios by Tag\ncucumber-js\n';
    const result = parseScenariosMd(content);
    expect(result.perIssueScenarioDirectory).toBeUndefined();
    expect(result.regressionScenarioDirectory).toBeUndefined();
    expect(result.vocabularyRegistry).toBeUndefined();
    expect(result.scenarioDirectory).toBe('features/');
    expect(result.runByTag).toBe('cucumber-js');
  });

  it('all three new sections present → all three fields populated', () => {
    const content = [
      '## Scenario Directory',
      'features/',
      '',
      '## Run Scenarios by Tag',
      'cucumber-js',
      '',
      '## Run Regression Scenarios',
      'cucumber-js --tags "@regression"',
      '',
      '## Per-Issue Scenario Directory',
      'features/per-issue/',
      '',
      '## Regression Scenario Directory',
      'features/regression/',
      '',
      '## Vocabulary Registry',
      'features/regression/vocabulary.md',
    ].join('\n');
    const result = parseScenariosMd(content);
    expect(result.perIssueScenarioDirectory).toBe('features/per-issue/');
    expect(result.regressionScenarioDirectory).toBe('features/regression/');
    expect(result.vocabularyRegistry).toBe('features/regression/vocabulary.md');
    expect(result.scenarioDirectory).toBe('features/');
  });

  it('partial presence (only Vocabulary Registry) → that field set, others undefined', () => {
    const content = '## Vocabulary Registry\nfeatures/regression/vocabulary.md\n';
    const result = parseScenariosMd(content);
    expect(result.vocabularyRegistry).toBe('features/regression/vocabulary.md');
    expect(result.perIssueScenarioDirectory).toBeUndefined();
    expect(result.regressionScenarioDirectory).toBeUndefined();
  });

  it('trims whitespace from new section values', () => {
    const content = '## Per-Issue Scenario Directory\n  features/per-issue/  \n';
    const result = parseScenariosMd(content);
    expect(result.perIssueScenarioDirectory).toBe('features/per-issue/');
  });
});

describe('loadProjectConfig — healthCheckPath integration', () => {
  it('returns healthCheckPath from .adw/commands.md when present', () => {
    // Create a temporary directory simulating a target repository
    const tmpDir = mkdtempSync(join(tmpdir(), 'adw-test-'));
    const adwDir = join(tmpDir, '.adw');
    mkdirSync(adwDir);
    writeFileSync(
      join(adwDir, 'commands.md'),
      '## Health Check Path\n/ready\n',
      'utf-8',
    );

    const config = loadProjectConfig(tmpDir);
    expect(config.commands.healthCheckPath).toBe('/ready');
  });

  it('defaults healthCheckPath to "/" when commands.md has no Health Check Path section', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'adw-test-'));
    const adwDir = join(tmpDir, '.adw');
    mkdirSync(adwDir);
    writeFileSync(join(adwDir, 'commands.md'), '## Start Dev Server\nbun run dev\n', 'utf-8');

    const config = loadProjectConfig(tmpDir);
    expect(config.commands.healthCheckPath).toBe('/');
  });

  it('exposes per-issue/regression/vocabulary fields from .adw/scenarios.md when all three present', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'adw-test-'));
    const adwDir = join(tmpDir, '.adw');
    mkdirSync(adwDir);
    const scenariosMd = [
      '## Scenario Directory',
      'features/',
      '',
      '## Run Scenarios by Tag',
      'cucumber-js',
      '',
      '## Run Regression Scenarios',
      'cucumber-js --tags "@regression"',
      '',
      '## Per-Issue Scenario Directory',
      'features/per-issue/',
      '',
      '## Regression Scenario Directory',
      'features/regression/',
      '',
      '## Vocabulary Registry',
      'features/regression/vocabulary.md',
    ].join('\n');
    writeFileSync(join(adwDir, 'scenarios.md'), scenariosMd, 'utf-8');

    const config = loadProjectConfig(tmpDir);
    expect(config.scenarios.perIssueScenarioDirectory).toBe('features/per-issue/');
    expect(config.scenarios.regressionScenarioDirectory).toBe('features/regression/');
    expect(config.scenarios.vocabularyRegistry).toBe('features/regression/vocabulary.md');
  });
});
