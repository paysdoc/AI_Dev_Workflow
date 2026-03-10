/**
 * Project configuration loader for target repositories.
 *
 * Reads `.adw/commands.md`, `.adw/project.md`, `.adw/conditional_docs.md`,
 * and `.adw/review_proof.md` from a target repository to determine
 * project-specific commands, file structure, conditional documentation,
 * and review proof requirements. Falls back to sensible defaults when files are absent.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandsConfig {
  packageManager: string;
  installDeps: string;
  runLinter: string;
  typeCheck: string;
  runTests: string;
  runBuild: string;
  startDevServer: string;
  prepareApp: string;
  runE2ETests: string;
  additionalTypeChecks: string;
  libraryInstall: string;
  scriptExecution: string;
}

export interface ProvidersConfig {
  codeHost: string;
  codeHostUrl: string;
  issueTracker: string;
  issueTrackerUrl: string;
  issueTrackerProjectKey: string;
}

export interface ProjectConfig {
  commands: CommandsConfig;
  /** Parsed provider configuration from `.adw/providers.md`. */
  providers: ProvidersConfig;
  /** Raw content of `.adw/project.md` (empty string when absent). */
  projectMd: string;
  /** Raw content of `.adw/conditional_docs.md` (empty string when absent). */
  conditionalDocsMd: string;
  /** Raw content of `.adw/review_proof.md` (empty string when absent). */
  reviewProofMd: string;
  /** Whether the `.adw/` directory was found. */
  hasAdwDir: boolean;
}

// ---------------------------------------------------------------------------
// Section heading → key mappings
// ---------------------------------------------------------------------------

const PROVIDER_HEADING_TO_KEY: Record<string, keyof ProvidersConfig> = {
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
  'prepare app': 'prepareApp',
  'run e2e tests': 'runE2ETests',
  'additional type checks': 'additionalTypeChecks',
  'library install command': 'libraryInstall',
  'library install': 'libraryInstall',
  'script execution': 'scriptExecution',
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
    prepareApp: 'bun install && bunx next dev --port {PORT}',
    runE2ETests: 'bunx playwright test',
    additionalTypeChecks: 'bunx tsc --noEmit -p adws/tsconfig.json',
    libraryInstall: 'bun install',
    scriptExecution: 'bunx tsx <script name>',
  };
}

export function getDefaultProvidersConfig(): ProvidersConfig {
  return {
    codeHost: 'github',
    codeHostUrl: '',
    issueTracker: 'github',
    issueTrackerUrl: '',
    issueTrackerProjectKey: '',
  };
}

export function getDefaultProjectConfig(): ProjectConfig {
  return {
    commands: getDefaultCommandsConfig(),
    providers: getDefaultProvidersConfig(),
    projectMd: '',
    conditionalDocsMd: '',
    reviewProofMd: '',
    hasAdwDir: false,
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
 * Missing sections fall back to defaults.
 */
export function parseProvidersMd(content: string): ProvidersConfig {
  const defaults = getDefaultProvidersConfig();
  if (!content.trim()) return defaults;

  const sections = parseMarkdownSections(content);
  const result = { ...defaults };

  for (const [heading, key] of Object.entries(PROVIDER_HEADING_TO_KEY)) {
    if (heading in sections && sections[heading]) {
      result[key] = sections[heading];
    }
  }

  return result;
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

  // providers.md
  const providersPath = path.join(adwDir, 'providers.md');
  let providers: ProvidersConfig;
  try {
    const raw = fs.readFileSync(providersPath, 'utf-8');
    providers = parseProvidersMd(raw);
  } catch {
    providers = getDefaultProvidersConfig();
  }

  return {
    commands,
    providers,
    projectMd,
    conditionalDocsMd,
    reviewProofMd,
    hasAdwDir: true,
  };
}
