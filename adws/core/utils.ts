/**
 * Utility functions for ADW Plan & Build workflow.
 */

import * as fs from 'fs';
import * as path from 'path';
import { LOGS_DIR, AGENTS_STATE_DIR } from './config';
import { AgentIdentifier, TargetRepoInfo } from './dataTypes';

/**
 * Generates a unique ADW session identifier.
 * When a summary is provided, format: {slugified-summary}-{random}
 * When no summary is provided, falls back to: {timestamp}-{random}
 *
 * Note: The `adw-` prefix is NOT included here because the branch name format
 * template already adds `adw-` before the adwId (e.g., `<issueClass>-issue-<N>-adw-<adwId>-<name>`).
 */
export function generateAdwId(summary?: string): string {
  const random = Math.random().toString(36).substring(2, 8);
  if (summary) {
    const slug = slugify(summary).substring(0, 20).replace(/-$/, '');
    if (slug) {
      return `${slug}-${random}`;
    }
  }
  return `${Date.now()}-${random}`;
}

/**
 * Converts text to URL-friendly slug.
 * Removes special characters, converts to lowercase, limits to 50 chars.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export type LogLevel = 'info' | 'error' | 'success' | 'warn';

const LOG_PREFIXES: Record<LogLevel, string> = {
  info: '\u{1F4CB}',
  error: '\u{274C}',
  success: '\u{2705}',
  warn: '\u{26A0}\u{FE0F}',
};

// ANSI color codes
const COLORS = {
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

/** Module-level adwId for log output. */
let _logAdwId: string | undefined;

/** Sets the adwId included in all subsequent log lines. */
export function setLogAdwId(adwId: string): void {
  _logAdwId = adwId;
}

/** Returns the current adwId used by the logger, or undefined if not set. */
export function getLogAdwId(): string | undefined {
  return _logAdwId;
}

/** Resets the logger adwId to undefined. Intended for test isolation only. */
export function resetLogAdwId(): void {
  _logAdwId = undefined;
}

/**
 * Logs a message with timestamp and emoji prefix.
 * When an adwId has been set via setLogAdwId(), it is included after the timestamp.
 * Error messages are displayed in red.
 */
export function log(message: string, level: LogLevel = 'info'): void {
  const timestamp = new Date().toISOString();
  const prefix = LOG_PREFIXES[level];
  const adwIdSegment = _logAdwId ? ` [${_logAdwId}]` : '';
  const text = `${prefix} [${timestamp}]${adwIdSegment} ${message}`;
  if (level === 'error') {
    console.log(`${COLORS.red}${text}${COLORS.reset}`);
  } else {
    console.log(text);
  }
}

/**
 * Ensures the logs directory exists for a given ADW session.
 * Creates the directory if it doesn't exist.
 * @returns The path to the session logs directory.
 */
export function ensureLogsDirectory(adwId: string): string {
  const sessionDir = path.join(LOGS_DIR, adwId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}

/**
 * Ensures the agent state directory exists for a given agent.
 * Creates the directory structure: agents/{adwId}/{agentIdentifier}/
 * For nested agents: {parentPath}/{agentIdentifier}/
 *
 * @param adwId - The ADW session identifier
 * @param agentIdentifier - The agent's identifier
 * @param parentPath - Optional parent agent's state path for nested agents
 * @returns The path to the agent's state directory.
 */
export function ensureAgentStateDirectory(
  adwId: string,
  agentIdentifier: AgentIdentifier,
  parentPath?: string
): string {
  let statePath: string;

  if (parentPath) {
    statePath = path.join(parentPath, agentIdentifier);
  } else {
    statePath = path.join(AGENTS_STATE_DIR, adwId, agentIdentifier);
  }

  if (!fs.existsSync(statePath)) {
    fs.mkdirSync(statePath, { recursive: true });
  }

  return statePath;
}

/**
 * Parses --target-repo and --clone-url CLI arguments from the given args array.
 * Mutates the args array by removing the consumed arguments.
 *
 * @param args - The CLI arguments array (will be mutated)
 * @returns A TargetRepoInfo object if --target-repo was provided, null otherwise
 */
export function parseTargetRepoArgs(args: string[]): TargetRepoInfo | null {
  const targetRepoIndex = args.indexOf('--target-repo');
  if (targetRepoIndex === -1) return null;

  const fullName = args[targetRepoIndex + 1];
  if (!fullName) {
    console.error('--target-repo requires a value in the format owner/repo');
    process.exit(1);
  }

  const parts = fullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.error(`Invalid --target-repo format: ${fullName}. Expected owner/repo`);
    process.exit(1);
  }

  // Remove --target-repo and its value
  args.splice(targetRepoIndex, 2);

  // Parse optional --clone-url
  let cloneUrl = `https://github.com/${fullName}.git`;
  const cloneUrlIndex = args.indexOf('--clone-url');
  if (cloneUrlIndex !== -1 && args[cloneUrlIndex + 1]) {
    cloneUrl = args[cloneUrlIndex + 1];
    args.splice(cloneUrlIndex, 2);
  }

  return {
    owner: parts[0],
    repo: parts[1],
    cloneUrl,
  };
}

/**
 * Gets the agent state path without creating directories.
 * Useful for reading state from a path.
 *
 * @param adwId - The ADW session identifier
 * @param agentIdentifier - The agent's identifier
 * @param parentPath - Optional parent agent's state path for nested agents
 * @returns The path to the agent's state directory.
 */
export function getAgentStatePath(
  adwId: string,
  agentIdentifier: AgentIdentifier,
  parentPath?: string
): string {
  if (parentPath) {
    return path.join(parentPath, agentIdentifier);
  }
  return path.join(AGENTS_STATE_DIR, adwId, agentIdentifier);
}
