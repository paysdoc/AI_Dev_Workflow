/**
 * Shared CLI parsing utilities for ADW orchestrator scripts.
 *
 * Provides composable functions for argument parsing, option extraction,
 * and usage printing that are shared across all orchestrator entry points.
 */

import type { IssueClassSlashCommand, TargetRepoInfo } from '../types/dataTypes';
import { VALID_ISSUE_TYPES } from '../types/dataTypes';
import type { RepoIdentifier } from '../providers/types';
import { Platform } from '../providers/types';
import { getRepoInfo } from '../github/githubApi';

/**
 * Parsed orchestrator arguments returned by {@link parseOrchestratorArguments}.
 */
export interface OrchestratorArgs {
  readonly issueNumber: number;
  readonly adwId: string | null;
  readonly cwd: string | null;
  readonly providedIssueType: IssueClassSlashCommand | null;
}

/**
 * Configuration for {@link parseOrchestratorArguments}.
 */
interface ParseOptions {
  readonly scriptName: string;
  readonly usagePattern: string;
  readonly supportsCwd?: boolean;
  readonly supportsIssueType?: boolean;
  readonly requiresIssueNumber?: boolean;
}

/**
 * Extracts and removes a `--cwd <path>` option from args (mutates the array).
 */
export function extractCwdOption(args: string[]): string | null {
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex === -1 || !args[cwdIndex + 1]) return null;
  const cwd = args[cwdIndex + 1];
  args.splice(cwdIndex, 2);
  return cwd;
}

/**
 * Extracts and removes an `--issue-type <type>` option from args (mutates the array).
 * Exits with an error if the provided type is invalid.
 */
export function extractIssueTypeOption(args: string[]): IssueClassSlashCommand | null {
  const issueTypeIndex = args.indexOf('--issue-type');
  if (issueTypeIndex === -1 || !args[issueTypeIndex + 1]) return null;

  const typeValue = args[issueTypeIndex + 1];
  if (!VALID_ISSUE_TYPES.includes(typeValue as IssueClassSlashCommand)) {
    console.error(`Invalid issue type: ${typeValue}. Valid values: ${VALID_ISSUE_TYPES.join(', ')}`);
    process.exit(1);
  }
  args.splice(issueTypeIndex, 2);
  return typeValue as IssueClassSlashCommand;
}

/**
 * Validates and parses a string as an issue number.
 * Exits with an error message if invalid.
 */
export function parseIssueNumber(value: string): number {
  const issueNumber = parseInt(value, 10);
  if (isNaN(issueNumber)) {
    console.error(`Invalid issue number: ${value}`);
    process.exit(1);
  }
  return issueNumber;
}

/**
 * Prints orchestrator usage information and exits with code 1.
 */
export function printUsageAndExit(scriptName: string, usagePattern: string, options?: readonly string[]): never {
  console.error(`Usage: bunx tsx adws/${scriptName} ${usagePattern}`);
  console.error('');
  if (options && options.length > 0) {
    console.error('Options:');
    options.forEach((opt) => console.error(`  ${opt}`));
    console.error('');
  }
  console.error('Environment Requirements:');
  console.error('  ANTHROPIC_API_KEY  - Anthropic API key');
  console.error('  CLAUDE_CODE_PATH   - Path to Claude CLI (default: /usr/local/bin/claude)');
  console.error('  GITHUB_PAT         - (Optional) GitHub Personal Access Token');
  process.exit(1);
}

/**
 * Full orchestrator argument parser combining cwd, issue-type, issue number, and adwId.
 * Handles `--help`/`-h` flags and validates minimum arguments.
 */
export function parseOrchestratorArguments(args: string[], options: ParseOptions): OrchestratorArgs {
  const { scriptName, usagePattern, supportsCwd = true, supportsIssueType = true, requiresIssueNumber = true } = options;

  if (args.includes('--help') || args.includes('-h')) {
    const opts: string[] = [];
    if (supportsCwd) opts.push('--cwd <path>         Working directory for git operations (worktree path)');
    if (supportsIssueType) {
      opts.push('--issue-type <type>  Pre-classified issue type (skips classification step)');
      opts.push(`                     Valid values: ${VALID_ISSUE_TYPES.join(', ')}`);
    }
    printUsageAndExit(scriptName, usagePattern, opts);
  }

  const cwd = supportsCwd ? extractCwdOption(args) : null;
  const providedIssueType = supportsIssueType ? extractIssueTypeOption(args) : null;

  if (requiresIssueNumber && args.length < 1) {
    const opts: string[] = [];
    if (supportsCwd) opts.push('--cwd <path>         Working directory for git operations (worktree path)');
    if (supportsIssueType) {
      opts.push('--issue-type <type>  Pre-classified issue type (skips classification step)');
      opts.push(`                     Valid values: ${VALID_ISSUE_TYPES.join(', ')}`);
    }
    printUsageAndExit(scriptName, usagePattern, opts);
  }

  const issueNumber = requiresIssueNumber ? parseIssueNumber(args[0]) : 0;
  const adwId = args[requiresIssueNumber ? 1 : 0] || null;

  return { issueNumber, adwId, cwd, providedIssueType };
}

/**
 * Builds a RepoIdentifier from CLI-parsed target repo info or local git remote.
 * Centralizes repo identity resolution for all orchestrator entry points.
 *
 * @param targetRepo - Parsed --target-repo info, or null for local repo
 * @returns A RepoIdentifier with owner, repo, and platform
 */
export function buildRepoIdentifier(targetRepo: TargetRepoInfo | null): RepoIdentifier {
  if (targetRepo) {
    return { owner: targetRepo.owner, repo: targetRepo.repo, platform: Platform.GitHub };
  }
  const localRepo = getRepoInfo();
  return { owner: localRepo.owner, repo: localRepo.repo, platform: Platform.GitHub };
}
