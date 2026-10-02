import { describe, it, expect } from 'vitest';
import { parseCommandsMd, getDefaultCommandsConfig, parseScenariosMd, getDefaultScenariosConfig, loadProjectConfig } from '../projectConfig';
import { resolve } from 'path';

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

  describe('HTML comments', () => {
    const SECTIONS = [
      { heading: 'Per-Issue Scenario Directory', value: 'features/per-issue/', read: (c: ReturnType<typeof parseScenariosMd>) => c.perIssueScenarioDirectory },
      { heading: 'Regression Scenario Directory', value: 'features/regression/', read: (c: ReturnType<typeof parseScenariosMd>) => c.regressionScenarioDirectory },
      { heading: 'Vocabulary Registry', value: 'features/regression/vocabulary.md', read: (c: ReturnType<typeof parseScenariosMd>) => c.vocabularyRegistry },
    ];

    const PLACEMENTS: Array<{ placement: string; body: (value: string) => string }> = [
      { placement: 'on the line above the value', body: (v) => `<!-- Consumed by scenario_writer. -->\n${v}` },
      { placement: 'after the value on its line', body: (v) => `${v} <!-- Consumed by scenario_writer. -->` },
      { placement: 'on the line below the value', body: (v) => `${v}\n<!-- Consumed by scenario_writer. -->` },
      { placement: 'across several lines above the value', body: (v) => `<!-- Consumed by scenario_writer.\n     When set, the sweep step is skipped.\n-->\n${v}` },
    ];

    for (const { placement, body } of PLACEMENTS) {
      it(`strips a comment ${placement} from every section value`, () => {
        const content = SECTIONS.map(({ heading, value }) => `## ${heading}\n${body(value)}\n`).join('\n');
        const result = parseScenariosMd(content);
        for (const { value, read } of SECTIONS) {
          expect(read(result)).toBe(value);
        }
      });
    }

    it('leaves a section that holds only a comment absent', () => {
      const content = SECTIONS.map(({ heading }) => `## ${heading}\n<!-- nothing set here -->\n`).join('\n');
      const result = parseScenariosMd(content);
      for (const { read } of SECTIONS) {
        expect(read(result)).toBeUndefined();
      }
    });

    it('keeps the default for a scalar section that holds only a comment', () => {
      const result = parseScenariosMd('## Scenario Directory\n<!-- unset -->\n\n## BDD Framework\ncucumber-js\n');
      expect(result.scenarioDirectory).toBe(getDefaultScenariosConfig().scenarioDirectory);
      expect(result.bddFramework).toBe('cucumber-js');
    });

    it('reads a run command followed by a trailing multi-line comment block as just the command', () => {
      const content = [
        '## Run Regression Scenarios',
        'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"',
        '',
        '<!-- The three optional sections below activate the regression-suite contract for repos that',
        '     opt in. Target repos that omit them keep current free-form behaviour. -->',
        '',
        '## Per-Issue Scenario Directory',
        'features/per-issue/',
      ].join('\n');
      const result = parseScenariosMd(content);
      expect(result.runRegression).toBe('NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"');
      expect(result.perIssueScenarioDirectory).toBe('features/per-issue/');
    });

    it("reads this repository's own .adw/scenarios.md without any comment left in a value", () => {
      const result = loadProjectConfig(resolve(__dirname, '..', '..', '..')).scenarios;
      expect([result.perIssueScenarioDirectory, result.regressionScenarioDirectory, result.vocabularyRegistry]).toEqual([
        'features/per-issue/',
        'features/regression/',
        'features/regression/vocabulary.md',
      ]);
      expect(Object.values(result).filter((v) => typeof v === 'string' && v.includes('<!--'))).toEqual([]);
    });
  });
});

describe('parseScenariosMd — stepDefDirectory and bddFramework fields', () => {
  it('defaults to features/step_definitions and empty bddFramework when sections absent', () => {
    const result = parseScenariosMd('## Scenario Directory\nfeatures/\n');
    expect(result.stepDefDirectory).toBe('features/step_definitions');
    expect(result.bddFramework).toBe('');
  });

  it('reads stepDefDirectory from ## Step Def Directory section', () => {
    const content = '## Step Def Directory\nfeatures/steps\n';
    const result = parseScenariosMd(content);
    expect(result.stepDefDirectory).toBe('features/steps');
  });

  it('reads bddFramework from ## BDD Framework section', () => {
    const content = '## BDD Framework\nbehave\n';
    const result = parseScenariosMd(content);
    expect(result.bddFramework).toBe('behave');
  });

  it('round-trips both new fields when present', () => {
    const content = [
      '## Step Def Directory',
      'features/step_definitions',
      '',
      '## BDD Framework',
      'cucumber-js',
    ].join('\n');
    const result = parseScenariosMd(content);
    expect(result.stepDefDirectory).toBe('features/step_definitions');
    expect(result.bddFramework).toBe('cucumber-js');
  });
});

describe('getDefaultScenariosConfig — stepDefDirectory and bddFramework', () => {
  it('defaults stepDefDirectory to features/step_definitions', () => {
    expect(getDefaultScenariosConfig().stepDefDirectory).toBe('features/step_definitions');
  });

  it('defaults bddFramework to empty string', () => {
    expect(getDefaultScenariosConfig().bddFramework).toBe('');
  });
});
