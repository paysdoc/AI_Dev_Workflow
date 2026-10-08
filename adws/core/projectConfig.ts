import * as fs from 'fs';
import * as path from 'path';
import { parseConditionalDocs, type ConditionalDocsRegistry } from './conditionalDocsRegistry';

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
  /** The raw body of `## Suppression Patterns`: the repository's own additions to the fix-round guard's framework table. */
  suppressionPatterns: string;
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

export interface ProjectConfig {
  commands: CommandsConfig;
  projectMd: string;
  conditionalDocsMd: string;
  conditionalDocs: ConditionalDocsRegistry;
  hasAdwDir: boolean;
  providers: ProvidersConfig;
  scenarios: ScenariosConfig;
  scenariosMd: string;
  /** Absent or empty ⇒ `null`. Decisions read it only through `resolveApplicationType`, which alone says what a value means. */
  applicationType: string | null;
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
  'suppression patterns': 'suppressionPatterns',
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
    suppressionPatterns: '',
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

export function getDefaultProjectConfig(): ProjectConfig {
  return {
    commands: getDefaultCommandsConfig(),
    projectMd: '',
    conditionalDocsMd: '',
    conditionalDocs: parseConditionalDocs(''),
    hasAdwDir: false,
    providers: getDefaultProvidersConfig(),
    scenarios: getDefaultScenariosConfig(),
    scenariosMd: '',
    applicationType: null,
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

/** The section's value as written, comments stripped and trimmed; `null` when the section is absent or empty. */
export function parseApplicationType(projectMd: string): string | null {
  const sections = parseMarkdownSections(projectMd);
  const value = stripHtmlComments(sections['application type'] ?? '');
  return value === '' ? null : value;
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

function stripHtmlComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, '').trim();
}

export function parseScenariosMd(content: string): ScenariosConfig {
  const defaults = getDefaultScenariosConfig();
  if (!content.trim()) return defaults;

  const sections = parseMarkdownSections(content);
  const result = { ...defaults };

  for (const [heading, key] of Object.entries(SCENARIOS_HEADING_TO_KEY)) {
    const value = stripHtmlComments(sections[heading] ?? '');
    if (value) result[key] = value;
  }

  return result;
}

/** The file's text, or '' when it is absent or unreadable: each parser turns '' into its defaults. */
function readAdwFile(adwDir: string, fileName: string): string {
  try {
    return fs.readFileSync(path.join(adwDir, fileName), 'utf-8');
  } catch {
    return '';
  }
}

export function loadProjectConfig(targetRepoPath: string): ProjectConfig {
  const adwDir = path.join(targetRepoPath, '.adw');

  if (!fs.existsSync(adwDir) || !fs.statSync(adwDir).isDirectory()) {
    return getDefaultProjectConfig();
  }

  const projectMd = readAdwFile(adwDir, 'project.md');
  const conditionalDocsMd = readAdwFile(adwDir, 'conditional_docs.md');
  const scenariosMd = readAdwFile(adwDir, 'scenarios.md');

  return {
    commands: parseCommandsMd(readAdwFile(adwDir, 'commands.md')),
    projectMd,
    conditionalDocsMd,
    conditionalDocs: parseConditionalDocs(conditionalDocsMd),
    hasAdwDir: true,
    providers: parseProvidersMd(readAdwFile(adwDir, 'providers.md')),
    scenarios: parseScenariosMd(scenariosMd),
    scenariosMd,
    applicationType: parseApplicationType(projectMd),
  };
}
