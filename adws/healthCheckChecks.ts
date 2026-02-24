/**
 * Health Check Individual Checks
 *
 * Contains all individual check functions, the CheckResult interface,
 * and utility functions used by healthCheck.tsx.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_CODE_PATH, GITHUB_PAT, LOGS_DIR, SPECS_DIR } from './core';

/**
 * Individual check result.
 */
export interface CheckResult {
  success: boolean;
  error?: string;
  warning?: string;
  details: Record<string, unknown>;
}

/**
 * Checks if a command exists in PATH.
 */
export function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Executes a command and returns the output or null on failure.
 */
export function execCommand(command: string): string | null {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/**
 * Checks required environment variables.
 */
export function checkEnvironmentVariables(): CheckResult {
  const required = ['ANTHROPIC_API_KEY'];
  const optional = ['CLAUDE_CODE_PATH', 'GITHUB_PAT', 'GITHUB_PERSONAL_ACCESS_TOKEN'];

  const missing: string[] = [];
  const present: string[] = [];
  const optionalPresent: string[] = [];

  for (const envVar of required) {
    if (process.env[envVar]) {
      present.push(envVar);
    } else {
      missing.push(envVar);
    }
  }

  for (const envVar of optional) {
    if (process.env[envVar]) {
      optionalPresent.push(envVar);
    }
  }

  const success = missing.length === 0;

  return {
    success,
    error: missing.length > 0 ? `Missing required environment variables: ${missing.join(', ')}` : undefined,
    details: {
      required: present,
      missing,
      optional: optionalPresent
    }
  };
}

/**
 * Checks git repository configuration.
 */
export function checkGitRepository(): CheckResult {
  const details: Record<string, unknown> = {};

  // Check if in a git repository
  const isGitRepo = fs.existsSync(path.join(process.cwd(), '.git'));
  if (!isGitRepo) {
    return {
      success: false,
      error: 'Not in a git repository',
      details: { isGitRepo: false }
    };
  }
  details.isGitRepo = true;

  // Get current branch
  const branch = execCommand('git rev-parse --abbrev-ref HEAD');
  details.currentBranch = branch || 'unknown';

  // Check for remote
  const remotes = execCommand('git remote');
  details.hasRemote = remotes !== null && remotes.length > 0;
  details.remotes = remotes?.split('\n').filter(Boolean) || [];

  // Check for uncommitted changes
  const status = execCommand('git status --porcelain');
  details.hasUncommittedChanges = status !== null && status.length > 0;

  // Check user config
  const userName = execCommand('git config user.name');
  const userEmail = execCommand('git config user.email');
  details.userConfigured = Boolean(userName && userEmail);
  details.userName = userName || undefined;
  details.userEmail = userEmail || undefined;

  let warning: string | undefined;
  if (!details.userConfigured) {
    warning = 'Git user.name or user.email not configured';
  }

  return {
    success: true,
    warning,
    details
  };
}

/**
 * Checks Claude Code CLI functionality.
 */
export function checkClaudeCodeCLI(): CheckResult {
  const details: Record<string, unknown> = {};

  // Check if claude CLI exists at configured path
  const cliExists = fs.existsSync(CLAUDE_CODE_PATH);
  details.configuredPath = CLAUDE_CODE_PATH;
  details.pathExists = cliExists;

  // Also check if claude is in PATH
  const inPath = commandExists('claude');
  details.inPath = inPath;

  if (!cliExists && !inPath) {
    return {
      success: false,
      error: `Claude CLI not found at ${CLAUDE_CODE_PATH} and not in PATH`,
      details
    };
  }

  // Try to get version
  const claudePath = cliExists ? CLAUDE_CODE_PATH : 'claude';
  const version = execCommand(`${claudePath} --version`);
  details.version = version || 'unknown';

  return {
    success: true,
    details
  };
}

/**
 * Checks GitHub CLI (gh) functionality.
 */
export function checkGitHubCLI(): CheckResult {
  const details: Record<string, unknown> = {};

  // Check if gh CLI exists
  const ghExists = commandExists('gh');
  details.installed = ghExists;

  if (!ghExists) {
    return {
      success: false,
      error: 'GitHub CLI (gh) not installed',
      details
    };
  }

  // Check if authenticated
  const authStatus = execCommand('gh auth status 2>&1');
  details.authenticated = authStatus !== null && !authStatus.includes('not logged');

  // Check GITHUB_PAT
  details.hasGitHubPAT = Boolean(GITHUB_PAT);

  let warning: string | undefined;
  if (!details.authenticated && !details.hasGitHubPAT) {
    warning = 'GitHub CLI not authenticated and no GITHUB_PAT set';
  }

  return {
    success: true,
    warning,
    details
  };
}

/**
 * Checks directory structure.
 */
export function checkDirectoryStructure(): CheckResult {
  const details: Record<string, unknown> = {};

  // Check if logs directory exists or can be created
  details.logsDir = LOGS_DIR;
  details.logsDirExists = fs.existsSync(LOGS_DIR);

  // Check if specs directory exists or can be created
  details.specsDir = SPECS_DIR;
  details.specsDirExists = fs.existsSync(SPECS_DIR);

  // Check for .claude directory
  const claudeDir = path.join(process.cwd(), '.claude');
  details.claudeDirExists = fs.existsSync(claudeDir);

  // Check for .claude/commands directory
  const commandsDir = path.join(claudeDir, 'commands');
  details.commandsDirExists = fs.existsSync(commandsDir);

  let warning: string | undefined;
  if (!details.claudeDirExists || !details.commandsDirExists) {
    warning = '.claude/commands directory not found - custom slash commands may not work';
  }

  return {
    success: true,
    warning,
    details
  };
}

/**
 * Validates a GitHub issue number (basic check).
 */
export function checkIssueNumber(issueNumber: number): CheckResult {
  const details: Record<string, unknown> = {
    issueNumber
  };

  if (isNaN(issueNumber) || issueNumber <= 0) {
    return {
      success: false,
      error: `Invalid issue number: ${issueNumber}`,
      details
    };
  }

  // Try to fetch the issue using gh CLI
  const issueData = execCommand(`gh issue view ${issueNumber} --json number,title,state 2>&1`);

  if (issueData === null || issueData.includes('Could not resolve')) {
    return {
      success: false,
      error: `Issue #${issueNumber} not found or not accessible`,
      details
    };
  }

  try {
    const parsed = JSON.parse(issueData);
    details.title = parsed.title;
    details.state = parsed.state;
    details.exists = true;
  } catch {
    return {
      success: false,
      error: `Failed to parse issue data for #${issueNumber}`,
      details
    };
  }

  return {
    success: true,
    details
  };
}
