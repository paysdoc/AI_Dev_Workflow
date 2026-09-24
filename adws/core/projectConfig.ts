import * as fs from 'fs';
import * as path from 'path';
import { parseConditionalDocs, type ConditionalDocsRegistry } from './conditionalDocsRegistry';

export type ApplicationType = 'cli' | 'web';

export interface CommandsConfig {
  packageManager: string;
  installDeps: string;
  runLinter: string;
  typeCheck: string;
  runTests: string;
  runBuild: string;
  startDevServer: string;
  healthCheckPath: string;
  additionalTypeChecks: string;
  libraryInstall: string;
  scriptExecution: string;
  runScenariosByTag: string;
  runRegressionScenarios: string;
  testDirectory: string;
  testFramework: string;
}

export interface ScenariosConfig {
  scenarioDirectory: string;
  runByTag: string;
  runRegression: string;
  /** Absent ⇒ undefined (legacy behaviour). */
  perIssueScenarioDirectory?: string;
  /** Absent ⇒ undefined (legacy behaviour). */
  regressionScenarioDirectory?: string;
  /** Absent ⇒ undefined (legacy behaviour). */
  vocabularyRegistry?: string;
  /** Defaults to 'features/step_definitions'. */
  stepDefDirectory: string;
  /** Empty string ⇒ default .ts extensions. */
  bddFramework: string;
}

export interface ProvidersConfig {
  codeHost: string;
  codeHostUrl?: string;
  issueTracker: string;
  issueTrackerUrl?: string;
  issueTrackerProjectKey?: string;
}

export interface ReviewTagEntry {
  tag: string;
  severity: 'blocker' | 'tech-debt';
  /** When true, gracefully skip if no matching scenarios exist. */
  optional?: boolean;
}

export interface SupplementaryCheck {
  name: string;
  command: string;
  severity: 'blocker' | 'tech-debt';
}

export interface ReviewProofConfig {
  tags: ReviewTagEntry[];
  supplementaryChecks: SupplementaryCheck[];
}

export interface ProjectConfig {
  commands: CommandsConfig;
  projectMd: string;
  conditionalDocsMd: string;
  conditionalDocs: ConditionalDocsRegistry;
  reviewProofMd: string;
  hasAdwDir: boolean;
  providers: ProvidersConfig;
  scenarios: ScenariosConfig;
  scenariosMd: string;
  reviewProofConfig: ReviewProofConfig;
  /** Defaults to `'cli'`. */
  applicationType: ApplicationType;
}

const SCENARIOS_HEADING_TO_KEY: Record<string, keyof ScenariosConfig> = {
  'scenario directory': 'scenarioDirectory',
  'run scenarios by tag': 'runByTag',
  'run regression scenarios': 'runRegression',
  'per-issue scenario directory': 'perIssueScenarioDirectory',
  'regression scenario directory': 'regressionScenarioDirectory',
  'vocabulary registry': 'vocabularyRegistry',
  'step def directory': 'stepDefDirectory',
  'bdd framework': 'bddFramework',
};

const PROVIDERS_HEADING_TO_KEY: Record<string, keyof ProvidersConfig> = {
  'code host': 'codeHost',
  'code host url': 'codeHostUrl',
  'issue tracker': 'issueTracker',
  'issue tracker url': 'issueTrackerUrl',
  'issue tracker project key': 'issueTrackerProjectKey',
};

const HEADING_TO_KEY: Record<string, keyof CommandsConfig> = {
  'package manager': 'packageManager',
  'install dependencies': 'installDeps',
  'run linter': 'runLinter',
  'type check': 'typeCheck',
  'run tests': 'runTests',
  'run build': 'runBuild',
  'start dev server': 'startDevServer',
  'health check path': 'healthCheckPath',
  'additional type checks': 'additionalTypeChecks',
  'library install command': 'libraryInstall',
  'library install': 'libraryInstall',
  'script execution': 'scriptExecution',
  'run scenarios by tag': 'runScenariosByTag',
  'run regression scenarios': 'runRegressionScenarios',
  'test directory': 'testDirectory',
  'test framework': 'testFramework',
};

export function getDefaultCommandsConfig(): CommandsConfig {
  return {
    packageManager: 'bun',
    installDeps: 'bun install',
    runLinter: 'bun run lint',
    typeCheck: 'bunx tsc --noEmit',
    runTests: 'bun run test',
    runBuild: 'bun run build',
    startDevServer: 'bun run dev',
    healthCheckPath: '/',
    additionalTypeChecks: 'bunx tsc --noEmit -p adws/tsconfig.json',
    libraryInstall: 'bun install',
    scriptExecution: 'bunx tsx <script name>',
    runScenariosByTag: 'cucumber-js --tags "@{tag}"',
    runRegressionScenarios: 'cucumber-js --tags "@regression"',
    testDirectory: 'src',
    testFramework: '',
  };
}

export function getDefaultScenariosConfig(): ScenariosConfig {
  return {
    scenarioDirectory: 'features/',
    runByTag: 'cucumber-js --tags "@{tag}"',
    runRegression: 'cucumber-js --tags "@regression"',
    stepDefDirectory: 'features/step_definitions',
    bddFramework: '',
  };
}

export function getDefaultProvidersConfig(): ProvidersConfig {
  return {
    codeHost: 'github',
    issueTracker: 'github',
  };
}

export function getDefaultReviewProofConfig(): ReviewProofConfig {
  return {
    tags: [
      { tag: '@regression', severity: 'blocker', optional: false },
      { tag: '@adw-{issueNumber}', severity: 'blocker', optional: true },
    ],
    supplementaryChecks: [],
  };
}

export function getDefaultProjectConfig(): ProjectConfig {
  return {
    commands: getDefaultCommandsConfig(),
    projectMd: '',
    conditionalDocsMd: '',
    conditionalDocs: parseConditionalDocs(''),
    reviewProofMd: '',
    hasAdwDir: false,
    providers: getDefaultProvidersConfig(),
    scenarios: getDefaultScenariosConfig(),
    scenariosMd: '',
    reviewProofConfig: getDefaultReviewProofConfig(),
    applicationType: 'cli',
  };
}

/**
 * Parses a markdown file with `## Heading` sections and returns a map of
 * lowercased heading text → trimmed body content.
 */
export function parseMarkdownSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split('\n');

  let currentHeading: string | null = null;
  const bodyLines: string[] = [];

  function flush() {
    if (currentHeading !== null) {
      sections[currentHeading] = bodyLines.join('\n').trim();
    }
    bodyLines.length = 0;
  }

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      flush();
      currentHeading = match[1].trim().toLowerCase();
    } else {
      bodyLines.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * Returns `true` when `.adw/project.md` has unit tests enabled.
 *
 * Handles two formats:
 * - `## Unit Tests: enabled` (colon-inline heading → key = "unit tests: enabled")
 * - `## Unit Tests` with body `enabled`
 *
 * Returns `false` for `disabled`, absent section, or any other value.
 */
export function parseUnitTestsEnabled(projectMd: string): boolean {
  const sections = parseMarkdownSections(projectMd);

  for (const [key, value] of Object.entries(sections)) {
    if (key.startsWith('unit tests')) {
      if (key.includes(':')) {
        const inlineValue = key.split(':').slice(1).join(':').trim();
        return inlineValue === 'enabled';
      }
      return value.trim().toLowerCase() === 'enabled';
    }
  }

  return false;
}

/**
 * Returns `'web'` when the section value (trimmed, lowercased) is `'web'`.
 * Defaults to `'cli'` when the section is absent or has any other value.
 */
export function parseApplicationType(projectMd: string): ApplicationType {
  const sections = parseMarkdownSections(projectMd);
  const value = sections['application type'];
  if (value !== undefined && value.trim().toLowerCase() === 'web') return 'web';
  return 'cli';
}

export function parseCommandsMd(content: string): CommandsConfig {
  const defaults = getDefaultCommandsConfig();
  if (!content.trim()) return defaults;

  const sections = parseMarkdownSections(content);
  const result = { ...defaults };

  for (const [heading, key] of Object.entries(HEADING_TO_KEY)) {
    if (heading in sections && sections[heading]) {
      result[key] = sections[heading];
    }
  }

  return result;
}

/** Platform names are lowercased; URL values preserve their original case. */
export function parseProvidersMd(content: string): ProvidersConfig {
  const defaults = getDefaultProvidersConfig();
  if (!content.trim()) return defaults;

  const sections = parseMarkdownSections(content);
  const result: ProvidersConfig = { ...defaults };

  for (const [heading, key] of Object.entries(PROVIDERS_HEADING_TO_KEY)) {
    if (heading in sections && sections[heading]) {
      const value = sections[heading];
      if (key === 'codeHost' || key === 'issueTracker') {
        result[key] = value.toLowerCase();
      } else if (key === 'codeHostUrl' || key === 'issueTrackerUrl' || key === 'issueTrackerProjectKey') {
        result[key] = value;
      }
    }
  }

  return result;
}

export function parseScenariosMd(content: string): ScenariosConfig {
  const defaults = getDefaultScenariosConfig();
  if (!content.trim()) return defaults;

  const sections = parseMarkdownSections(content);
  const result = { ...defaults };

  for (const [heading, key] of Object.entries(SCENARIOS_HEADING_TO_KEY)) {
    if (heading in sections && sections[heading]) {
      result[key] = sections[heading];
    }
  }

  return result;
}

function isSeparatorRow(line: string): boolean {
  return /^[|:\-\s]+$/.test(line);
}

/** Parses a markdown table body into an array of cell arrays, skipping the header and separator rows. */
function parseMarkdownTableRows(content: string): string[][] {
  const dataRows = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|') && !isSeparatorRow(line))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
  return dataRows.slice(1);
}

function parseTagsTable(content: string): ReviewTagEntry[] {
  return parseMarkdownTableRows(content)
    .filter(cells => cells.length >= 2 && cells[0])
    .map(cells => {
      const severity = cells[1] === 'tech-debt' ? 'tech-debt' : 'blocker';
      return { tag: cells[0], severity, optional: cells[2]?.toLowerCase() === 'yes' };
    });
}

function parseSupplementaryChecksTable(content: string): SupplementaryCheck[] {
  return parseMarkdownTableRows(content)
    .filter(cells => cells.length >= 3 && cells[0] && cells[1])
    .map(cells => {
      const severity = cells[2] === 'tech-debt' ? 'tech-debt' : 'blocker';
      return { name: cells[0], command: cells[1], severity };
    });
}

/** Falls back to defaults when the file is absent, empty, or has no `## Tags` section. */
export function parseReviewProofMd(content: string): ReviewProofConfig {
  const defaults = getDefaultReviewProofConfig();
  if (!content.trim()) return defaults;

  const sections = parseMarkdownSections(content);
  if (!('tags' in sections)) return defaults;

  const tags = parseTagsTable(sections['tags'] ?? '');
  const supplementaryChecks = 'supplementary checks' in sections
    ? parseSupplementaryChecksTable(sections['supplementary checks'] ?? '')
    : [];

  return { tags, supplementaryChecks };
}

export function loadProjectConfig(targetRepoPath: string): ProjectConfig {
  const adwDir = path.join(targetRepoPath, '.adw');

  if (!fs.existsSync(adwDir) || !fs.statSync(adwDir).isDirectory()) {
    return getDefaultProjectConfig();
  }

  const commandsPath = path.join(adwDir, 'commands.md');
  let commands: CommandsConfig;
  try {
    const raw = fs.readFileSync(commandsPath, 'utf-8');
    commands = parseCommandsMd(raw);
  } catch {
    commands = getDefaultCommandsConfig();
  }

  const projectPath = path.join(adwDir, 'project.md');
  let projectMd = '';
  try {
    projectMd = fs.readFileSync(projectPath, 'utf-8');
  } catch {
    // default above already covers a missing file
  }

  const conditionalDocsPath = path.join(adwDir, 'conditional_docs.md');
  let conditionalDocsMd = '';
  try {
    conditionalDocsMd = fs.readFileSync(conditionalDocsPath, 'utf-8');
  } catch {
    // default above already covers a missing file
  }

  const reviewProofPath = path.join(adwDir, 'review_proof.md');
  let reviewProofMd = '';
  try {
    reviewProofMd = fs.readFileSync(reviewProofPath, 'utf-8');
  } catch {
    // default above already covers a missing file
  }
  const reviewProofConfig = parseReviewProofMd(reviewProofMd);

  const providersPath = path.join(adwDir, 'providers.md');
  let providers: ProvidersConfig;
  try {
    const raw = fs.readFileSync(providersPath, 'utf-8');
    providers = parseProvidersMd(raw);
  } catch {
    providers = getDefaultProvidersConfig();
  }

  const scenariosPath = path.join(adwDir, 'scenarios.md');
  let scenarios: ScenariosConfig;
  let scenariosMd = '';
  try {
    scenariosMd = fs.readFileSync(scenariosPath, 'utf-8');
    scenarios = parseScenariosMd(scenariosMd);
  } catch {
    scenarios = getDefaultScenariosConfig();
  }

  return {
    commands,
    projectMd,
    conditionalDocsMd,
    conditionalDocs: parseConditionalDocs(conditionalDocsMd),
    reviewProofMd,
    hasAdwDir: true,
    providers,
    scenarios,
    scenariosMd,
    reviewProofConfig,
    applicationType: parseApplicationType(projectMd),
  };
}
