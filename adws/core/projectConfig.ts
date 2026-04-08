/**
 * Project configuration loader for target repositories.
 *
 * Reads `.adw/commands.md`, `.adw/project.md`, `.adw/conditional_docs.md`,
 * `.adw/review_proof.md`, and `.adw/scenarios.md` from a target repository to determine
 * project-specific commands, file structure, conditional documentation,
 * review proof requirements, and BDD scenario configuration. Falls back to sensible
 * defaults when files are absent.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  prepareApp: string;
  runE2ETests: string;
  additionalTypeChecks: string;
  libraryInstall: string;
  scriptExecution: string;
  runScenariosByTag: string;
  runRegressionScenarios: string;
}

export interface ScenariosConfig {
  scenarioDirectory: string;
  runByTag: string;
  runRegression: string;
}

export interface ProvidersConfig {
  codeHost: string;
  codeHostUrl?: string;
  issueTracker: string;
  issueTrackerUrl?: string;
  issueTrackerProjectKey?: string;
}

export interface ReviewTagEntry {
  /** Tag pattern, e.g. `@review-proof`, `@adw-{issueNumber}`. */
  tag: string;
  severity: 'blocker' | 'tech-debt';
  /** When true, gracefully skip if no matching scenarios exist. */
  optional?: boolean;
}

export interface SupplementaryCheck {
  name: string;
  /** Shell command to run, e.g. `bunx tsc --noEmit`. */
  command: string;
  severity: 'blocker' | 'tech-debt';
}

export interface ReviewProofConfig {
  tags: ReviewTagEntry[];
  supplementaryChecks: SupplementaryCheck[];
}

export interface ProjectConfig {
  commands: CommandsConfig;
  /** Raw content of `.adw/project.md` (empty string when absent). */
  projectMd: string;
  /** Raw content of `.adw/conditional_docs.md` (empty string when absent). */
  conditionalDocsMd: string;
  /** Raw content of `.adw/review_proof.md` (empty string when absent). */
  reviewProofMd: string;
  /** Whether the `.adw/` directory was found. */
  hasAdwDir: boolean;
  /** Provider configuration from `.adw/providers.md`. */
  providers: ProvidersConfig;
  /** BDD scenario configuration from `.adw/scenarios.md`. */
  scenarios: ScenariosConfig;
  /** Raw content of `.adw/scenarios.md` (empty string when absent). */
  scenariosMd: string;
  /** Parsed review proof config from `.adw/review_proof.md`. */
  reviewProofConfig: ReviewProofConfig;
  /** Application type from `.adw/project.md` `## Application Type` section. Defaults to `'cli'`. */
  applicationType: ApplicationType;
}

// ---------------------------------------------------------------------------
// Section heading → CommandsConfig key mapping
// ---------------------------------------------------------------------------

const SCENARIOS_HEADING_TO_KEY: Record<string, keyof ScenariosConfig> = {
  'scenario directory': 'scenarioDirectory',
  'run scenarios by tag': 'runByTag',
  'run regression scenarios': 'runRegression',
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
  'prepare app': 'prepareApp',
  'run e2e tests': 'runE2ETests',
  'additional type checks': 'additionalTypeChecks',
  'library install command': 'libraryInstall',
  'library install': 'libraryInstall',
  'script execution': 'scriptExecution',
  'run scenarios by tag': 'runScenariosByTag',
  'run regression scenarios': 'runRegressionScenarios',
};

// ---------------------------------------------------------------------------
// Defaults (backward-compatible with current hardcoded values)
// ---------------------------------------------------------------------------

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
    prepareApp: 'bun install && bunx next dev --port {PORT}',
    runE2ETests: 'bunx playwright test',
    additionalTypeChecks: 'bunx tsc --noEmit -p adws/tsconfig.json',
    libraryInstall: 'bun install',
    scriptExecution: 'bunx tsx <script name>',
    runScenariosByTag: 'cucumber-js --tags "@{tag}"',
    runRegressionScenarios: 'cucumber-js --tags "@regression"',
  };
}

export function getDefaultScenariosConfig(): ScenariosConfig {
  return {
    scenarioDirectory: 'features/',
    runByTag: 'cucumber-js --tags "@{tag}"',
    runRegression: 'cucumber-js --tags "@regression"',
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
    reviewProofMd: '',
    hasAdwDir: false,
    providers: getDefaultProvidersConfig(),
    scenarios: getDefaultScenariosConfig(),
    scenariosMd: '',
    reviewProofConfig: getDefaultReviewProofConfig(),
    applicationType: 'cli',
  };
}

// ---------------------------------------------------------------------------
// Markdown parsing helpers
// ---------------------------------------------------------------------------

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
 * Parses the `## Application Type` section from `.adw/project.md`.
 * Returns `'web'` when the section value (trimmed, lowercased) is `'web'`.
 * Defaults to `'cli'` when the section is absent or has any other value.
 */
export function parseApplicationType(projectMd: string): ApplicationType {
  const sections = parseMarkdownSections(projectMd);
  const value = sections['application type'];
  if (value !== undefined && value.trim().toLowerCase() === 'web') return 'web';
  return 'cli';
}

/**
 * Parses `.adw/commands.md` into a `CommandsConfig` object.
 * Missing sections fall back to defaults.
 */
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

/**
 * Parses `.adw/providers.md` into a `ProvidersConfig` object.
 * Missing sections fall back to defaults. Platform names are lowercased;
 * URL values preserve their original case.
 */
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

/**
 * Parses `.adw/scenarios.md` into a `ScenariosConfig` object.
 * Missing sections fall back to defaults.
 */
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

/** Returns true for markdown table separator rows (e.g. `|---|---|`). */
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
  // First row is the header — skip it
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

/**
 * Parses `.adw/review_proof.md` into a `ReviewProofConfig`.
 * Falls back to defaults when the file is absent, empty, or has no `## Tags` section.
 */
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

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Loads the project configuration from `<targetRepoPath>/.adw/`.
 * Returns defaults when the directory or individual files are absent.
 */
export function loadProjectConfig(targetRepoPath: string): ProjectConfig {
  const adwDir = path.join(targetRepoPath, '.adw');

  if (!fs.existsSync(adwDir) || !fs.statSync(adwDir).isDirectory()) {
    return getDefaultProjectConfig();
  }

  // commands.md
  const commandsPath = path.join(adwDir, 'commands.md');
  let commands: CommandsConfig;
  try {
    const raw = fs.readFileSync(commandsPath, 'utf-8');
    commands = parseCommandsMd(raw);
  } catch {
    commands = getDefaultCommandsConfig();
  }

  // project.md
  const projectPath = path.join(adwDir, 'project.md');
  let projectMd = '';
  try {
    projectMd = fs.readFileSync(projectPath, 'utf-8');
  } catch {
    // file missing — keep empty
  }

  // conditional_docs.md
  const conditionalDocsPath = path.join(adwDir, 'conditional_docs.md');
  let conditionalDocsMd = '';
  try {
    conditionalDocsMd = fs.readFileSync(conditionalDocsPath, 'utf-8');
  } catch {
    // file missing — keep empty
  }

  // review_proof.md
  const reviewProofPath = path.join(adwDir, 'review_proof.md');
  let reviewProofMd = '';
  try {
    reviewProofMd = fs.readFileSync(reviewProofPath, 'utf-8');
  } catch {
    // file missing — keep empty
  }
  const reviewProofConfig = parseReviewProofMd(reviewProofMd);

  // providers.md
  const providersPath = path.join(adwDir, 'providers.md');
  let providers: ProvidersConfig;
  try {
    const raw = fs.readFileSync(providersPath, 'utf-8');
    providers = parseProvidersMd(raw);
  } catch {
    providers = getDefaultProvidersConfig();
  }

  // scenarios.md
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
    reviewProofMd,
    hasAdwDir: true,
    providers,
    scenarios,
    scenariosMd,
    reviewProofConfig,
    applicationType: parseApplicationType(projectMd),
  };
}
