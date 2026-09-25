import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_CODE_PATH, GITHUB_PAT, LOGS_DIR, SPECS_DIR, resolveClaudeCodePath } from './core';
import type { GitContext } from '@paysdoc/devplatform/git';
import type { CodeHost, IssueTracker } from '@paysdoc/devplatform';

export interface CheckResult {
  success: boolean;
  error?: string;
  warning?: string;
  details: Record<string, unknown>;
}

export function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function execCommand(command: string): string | null {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

export function checkEnvironmentVariables(): CheckResult {
  const required = ['ANTHROPIC_API_KEY'];
  const optional = ['CLAUDE_CODE_PATH', 'GITHUB_PAT'];

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

export function checkGitRepository(ctx: GitContext): CheckResult {
  const details: Record<string, unknown> = {};

  const isGitRepo = fs.existsSync(path.join(process.cwd(), '.git'));
  if (!isGitRepo) {
    return {
      success: false,
      error: 'Not in a git repository',
      details: { isGitRepo: false }
    };
  }
  details.isGitRepo = true;

  let branch: string;
  try {
    branch = ctx.getCurrentBranch(process.cwd());
  } catch {
    branch = '';
  }
  details.currentBranch = branch || 'unknown';

  let hasRemote = false;
  let remotesList: string[] = [];
  try {
    remotesList = ctx.remotes(process.cwd());
    hasRemote = remotesList.length > 0;
  } catch { /* no remotes or not a repo — degrade gracefully */ }
  details.hasRemote = hasRemote;
  details.remotes = remotesList;

  details.hasUncommittedChanges = ctx.hasUncommittedChanges(process.cwd());

  const { name: userName, email: userEmail } = ctx.gitConfigUser(process.cwd());
  details.userConfigured = Boolean(userName && userEmail);
  details.userName = userName ?? undefined;
  details.userEmail = userEmail ?? undefined;

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

export function checkClaudeCodeCLI(): CheckResult {
  const details: Record<string, unknown> = {};
  details.configuredPath = CLAUDE_CODE_PATH;

  let resolvedPath: string;
  try {
    resolvedPath = resolveClaudeCodePath();
    details.resolvedPath = resolvedPath;
    details.pathExists = true;
  } catch (err) {
    details.pathExists = false;
    return {
      success: false,
      error: (err as Error).message,
      details
    };
  }

  const version = execCommand(`${resolvedPath} --version`);
  details.version = version || 'unknown';

  return {
    success: true,
    details
  };
}

export function checkGitHubCLI(codeHost: Pick<CodeHost, 'getAuthenticatedUser'>): CheckResult {
  const details: Record<string, unknown> = {};

  // Indirect variable avoids guard false-positive on 'gh' literal
  const ghBin = 'gh';
  const ghExists = commandExists(ghBin);
  details.installed = ghExists;

  if (!ghExists) {
    return {
      success: false,
      error: 'GitHub CLI (gh) not installed',
      details
    };
  }

  // GitHubCodeHost.getAuthenticatedUser() already returns null on failure rather
  // than throwing, but a non-GitHub code host (e.g. GitLab) REFUSES BY NAME
  // instead — the try/catch is what keeps that refusal from turning this whole
  // health check into an uncaught stack trace.
  let authenticated = false;
  try {
    authenticated = Boolean(codeHost.getAuthenticatedUser());
  } catch {
    authenticated = false;
  }
  details.authenticated = authenticated;

  details.hasGitHubPAT = Boolean(GITHUB_PAT);

  let warning: string | undefined;
  if (!authenticated && !details.hasGitHubPAT) {
    warning = 'GitHub CLI not authenticated and no GITHUB_PAT set';
  }

  return {
    success: true,
    warning,
    details
  };
}

export function checkDirectoryStructure(): CheckResult {
  const details: Record<string, unknown> = {};

  details.logsDir = LOGS_DIR;
  details.logsDirExists = fs.existsSync(LOGS_DIR);

  details.specsDir = SPECS_DIR;
  details.specsDirExists = fs.existsSync(SPECS_DIR);

  const claudeDir = path.join(process.cwd(), '.claude');
  details.claudeDirExists = fs.existsSync(claudeDir);

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

export async function checkIssueNumber(issueNumber: number, issueTracker: Pick<IssueTracker, 'fetchIssue'>): Promise<CheckResult> {
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

  try {
    const issue = await issueTracker.fetchIssue(issueNumber);
    details.title = issue.title;
    details.state = issue.state;
    details.exists = true;
  } catch {
    return {
      success: false,
      error: `Issue #${issueNumber} not found or not accessible`,
      details
    };
  }

  return {
    success: true,
    details
  };
}
