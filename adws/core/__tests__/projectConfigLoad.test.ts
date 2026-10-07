import { describe, it, expect, afterEach } from 'vitest';
import {
  getDefaultCommandsConfig,
  getDefaultProvidersConfig,
  getDefaultScenariosConfig,
  loadProjectConfig,
} from '../projectConfig';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

describe('loadProjectConfig — healthCheckPath integration', () => {
  it('returns healthCheckPath from .adw/commands.md when present', () => {
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

describe('loadProjectConfig — an .adw/ directory that holds no file', () => {
  it('loads the defaults of every file, empty text, and no application type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adw-test-empty-adw-'));
    mkdirSync(join(dir, '.adw'));
    try {
      const config = loadProjectConfig(dir);

      expect(config.hasAdwDir).toBe(true);
      expect(config.commands).toEqual(getDefaultCommandsConfig());
      expect(config.providers).toEqual(getDefaultProvidersConfig());
      expect(config.scenarios).toEqual(getDefaultScenariosConfig());
      expect(config.projectMd).toBe('');
      expect(config.conditionalDocsMd).toBe('');
      expect(config.scenariosMd).toBe('');
      expect(config.applicationType).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loadProjectConfig — python-flat fixture', () => {
  it('resolves testDirectory, testFramework, and runTests from the python-flat fixture', () => {
    const fixturePath = resolve(__dirname, '../../../test/fixtures/python-flat');
    const config = loadProjectConfig(fixturePath);
    expect(config.commands.testDirectory).toBe('tests');
    expect(config.commands.testFramework).toBe('pytest');
    expect(config.commands.runTests).toBe('pytest');
  });
});

describe('loadProjectConfig — applicationType field', () => {
  const dirs: string[] = [];

  function repoWithProjectMd(projectMd: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), 'adw-test-apptype-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.adw'));
    if (projectMd !== null) writeFileSync(join(dir, '.adw', 'project.md'), projectMd, 'utf-8');
    return dir;
  }

  afterEach(() => {
    dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
  });

  it('reads no type from a project.md without the section', () => {
    expect(loadProjectConfig(repoWithProjectMd('## Project Overview\nA tool\n')).applicationType).toBeNull();
  });

  it('reads the type the section names', () => {
    expect(loadProjectConfig(repoWithProjectMd('## Application Type\nweb\n')).applicationType).toBe('web');
  });

  it('reads no type from an .adw/ directory that holds no project.md', () => {
    expect(loadProjectConfig(repoWithProjectMd(null)).applicationType).toBeNull();
  });

  it('reads no type from a repository without an .adw/ directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adw-test-apptype-none-'));
    dirs.push(dir);

    const config = loadProjectConfig(dir);

    expect(config.hasAdwDir).toBe(false);
    expect(config.applicationType).toBeNull();
  });

  it("reads this repository's own type, cli, from its .adw/project.md", () => {
    expect(loadProjectConfig(resolve(__dirname, '../../..')).applicationType).toBe('cli');
  });
});

describe('loadProjectConfig — conditionalDocs field', () => {
  it('returns empty registry when conditional_docs.md is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adw-test-no-condocs-'));
    mkdirSync(join(dir, '.adw'), { recursive: true });
    try {
      const config = loadProjectConfig(dir);
      expect(config.conditionalDocs.preamble).toBe('');
      expect(config.conditionalDocs.entries).toEqual([]);
      expect(config.conditionalDocsMd).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('populates conditionalDocs from conditional_docs.md when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adw-test-condocs-'));
    mkdirSync(join(dir, '.adw'), { recursive: true });
    const content = `# Conditional Documentation\n\n- app_docs/feature-test.md\n  - Owns:\n    - adws/test/**\n  - Conditions:\n    - When working on test module\n`;
    writeFileSync(join(dir, '.adw', 'conditional_docs.md'), content, 'utf-8');
    try {
      const config = loadProjectConfig(dir);
      expect(config.conditionalDocsMd).toBe(content);
      expect(config.conditionalDocs.entries).toHaveLength(1);
      expect(config.conditionalDocs.entries[0].docPath).toBe('app_docs/feature-test.md');
      expect(config.conditionalDocs.entries[0].ownedGlobs).toEqual(['adws/test/**']);
      expect(config.conditionalDocs.entries[0].conditions).toEqual(['When working on test module']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
