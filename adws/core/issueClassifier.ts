/**
 * Issue classifier for ADW workflows.
 *
 * Provides two-step classification: first tries deterministic regex matching
 * to detect explicit ADW workflow commands, then falls back to /classify_issue
 * for AI-based heuristic classification.
 */

import { fetchGitHubIssue, RepoInfo } from '../github/githubApi';
import { runClaudeAgentWithCommand } from '../agents/claudeAgent';
import {
  IssueClassSlashCommand,
  AdwSlashCommand,
  adwCommandToIssueTypeMap,
  VALID_ISSUE_TYPES,
  log,
  GitHubIssue,
  getModelForCommand,
  getEffortForCommand,
} from '.';

/**
 * Strips fenced code block content from text.
 * Removes all triple-backtick blocks (with or without language specifiers) so that
 * content inside code blocks is not falsely matched by downstream regex patterns.
 *
 * @param text - The raw text potentially containing fenced code blocks
 * @returns The text with all fenced code block content removed
 */
export function stripFencedCodeBlocks(text: string): string {
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  if (stripped.length !== text.length) {
    log(`stripFencedCodeBlocks: removed ${text.length - stripped.length} characters of fenced code block content`);
  }
  return stripped;
}

/**
 * Extracts an explicit ADW slash command from text using deterministic regex matching.
 * Scans for `/adw_*` patterns and validates against known commands.
 * Commands are matched longest-first to avoid partial matches (e.g., `/adw_plan_build_test` before `/adw_plan`).
 * Fenced code blocks are stripped before scanning to avoid false matches from embedded content.
 *
 * @param text - The text to scan for ADW commands
 * @returns The matched AdwSlashCommand or null if none found
 */
export function extractAdwCommandFromText(text: string): AdwSlashCommand | null {
  if (!text) return null;

  const strippedText = stripFencedCodeBlocks(text);
  const validCommands = Object.keys(adwCommandToIssueTypeMap) as AdwSlashCommand[];
  const sortedByLength = [...validCommands].sort((a, b) => b.length - a.length);

  const found = sortedByLength.find((cmd) => {
    const pattern = new RegExp(`${cmd.replace('/', '\\/')}\\b`);
    return pattern.test(strippedText);
  });

  if (found) {
    log(`extractAdwCommandFromText: matched command ${found} (checked ${validCommands.length} valid commands)`);
  } else {
    log(`extractAdwCommandFromText: no command matched (checked ${validCommands.length} valid commands)`);
  }

  return found ?? null;
}

/**
 * Result of classifying an issue for trigger purposes.
 */
export interface IssueClassificationResult {
  issueType: IssueClassSlashCommand;
  success: boolean;
  adwCommand?: AdwSlashCommand;
  adwId?: string;
  issueTitle?: string;
}

/**
 * Extracts an adwId from text using deterministic regex matching.
 * Matches label-prefixed patterns (e.g., `adwId: value`) and backtick-wrapped ADW IDs.
 *
 * @param text - The text to scan for adwId patterns
 * @returns The extracted adwId string or null if none found
 */
export function extractAdwIdFromText(text: string): string | null {
  if (!text) return null;
  const strippedText = stripFencedCodeBlocks(text);
  // Match label-prefixed patterns: "adwId: xyz" or "ADW ID: xyz" or "adw_id: xyz"
  const labelMatch = strippedText.match(/(?:adwId|adw[_\s-]id)\s*[:=]\s*[`"']?([a-z0-9][a-z0-9-]*[a-z0-9])[`"']?/i);
  if (labelMatch) return labelMatch[1];
  // Match backtick-wrapped ADW IDs (same pattern as extractAdwIdFromComment)
  const backtickMatch = strippedText.match(/`(adw[-_][a-z0-9][a-z0-9-]*[a-z0-9])`/);
  return backtickMatch ? backtickMatch[1] : null;
}

/**
 * Classifies an issue by extracting explicit ADW commands and adwId via regex.
 * No LLM call is needed — this is purely deterministic pattern matching.
 *
 * @param issueContext - The issue context string to classify
 * @param issueNumber - The GitHub issue number
 * @param issueBody - Optional issue body text (preferred over issueContext for matching)
 * @returns IssueClassificationResult if ADW command found, null to fall back
 */
export function classifyWithAdwCommand(
  issueContext: string,
  issueNumber: number,
  issueBody?: string,
): IssueClassificationResult | null {
  const text = issueBody ?? issueContext;
  const truncatedText = text.length > 100 ? `${text.substring(0, 100)}...` : text;
  log(`classifyWithAdwCommand: scanning text for issue #${issueNumber}: "${truncatedText}"`);

  const adwCommand = extractAdwCommandFromText(text);
  if (!adwCommand) {
    log(`classifyWithAdwCommand: no ADW command found in issue #${issueNumber}`);
    return null;
  }

  const issueType = adwCommandToIssueTypeMap[adwCommand];
  const adwId = extractAdwIdFromText(text);
  if (adwId) {
    log(`classifyWithAdwCommand: extracted adwId="${adwId}" from issue #${issueNumber}`);
  }
  log(`Issue #${issueNumber} matched ADW command ${adwCommand} via regex, issueType=${issueType}`, 'success');

  return {
    issueType,
    success: true,
    adwCommand,
    ...(adwId ? { adwId } : {}),
  };
}

/**
 * Classifies an issue using /classify_issue (AI heuristic fallback).
 *
 * @param issueContext - The issue context string to classify
 * @param issueNumber - The GitHub issue number
 * @param agentName - Name identifier for the agent
 * @param outputFile - Path for agent output file
 * @returns IssueClassificationResult
 */
async function classifyWithIssueCommand(
  issueContext: string,
  issueNumber: number,
  agentName: string,
  outputFile: string,
  issueBody?: string,
): Promise<IssueClassificationResult> {
  log(`classifyWithIssueCommand: starting heuristic classification for issue #${issueNumber}`);

  const result = await runClaudeAgentWithCommand(
    '/classify_issue',
    issueContext,
    agentName,
    outputFile,
    getModelForCommand('/classify_issue', issueBody),
    getEffortForCommand('/classify_issue', issueBody),
  );

  if (!result.success) {
    log(`Classification agent failed for issue #${issueNumber}, defaulting to /feature`, 'error');
    return { issueType: '/feature', success: false };
  }

  const output = result.output.trim();
  const truncatedOutput = output.length > 200 ? `${output.substring(0, 200)}...` : output;
  log(`classifyWithIssueCommand: raw AI output for issue #${issueNumber}: "${truncatedOutput}"`);

  const commandPattern = VALID_ISSUE_TYPES.map(cmd => cmd.replace('/', '\\/')).join('|');
  const regex = new RegExp(`(${commandPattern})(?!.*(?:${commandPattern}))`, 's');
  const match = output.match(regex);
  const matchedCommand = match ? match[1] as IssueClassSlashCommand : undefined;

  if (matchedCommand) {
    log(`classifyWithIssueCommand: parsed command ${matchedCommand} from AI output for issue #${issueNumber}`);
    log(`Issue #${issueNumber} classified as ${matchedCommand} via heuristic`, 'success');
    return { issueType: matchedCommand, success: true };
  }

  log(`classifyWithIssueCommand: could not parse command from AI output: "${truncatedOutput}"`, 'warn');
  log(`Could not parse classification for issue #${issueNumber}, defaulting to /feature`, 'error');
  return { issueType: '/feature', success: false };
}

/**
 * Classifies an issue to determine the appropriate workflow.
 * Uses two-step classification: regex ADW command extraction first, then /classify_issue fallback.
 *
 * @param issueNumber - The GitHub issue number to classify
 * @returns Classification result with issue type and success status
 */
export async function classifyIssueForTrigger(
  issueNumber: number,
  repoInfo: RepoInfo,
): Promise<IssueClassificationResult> {
  try {
    log(`Classifying issue #${issueNumber} for trigger...`);

    const issue = await fetchGitHubIssue(issueNumber, repoInfo);
    log(`classifyIssueForTrigger: issue #${issueNumber} title="${issue.title}", body length=${issue.body?.length ?? 0}`);
    const issueContext = `**#${issue.number}: ${issue.title}**\n\n${issue.body}`;

    // Step 1: Try deterministic ADW command extraction
    log(`Checking for explicit ADW command in issue #${issueNumber}...`);
    const adwResult = classifyWithAdwCommand(
      issueContext,
      issueNumber,
      issue.body,
    );
    if (adwResult) {
      log(`Classification complete for issue #${issueNumber}: classifier=regex, issueType=${adwResult.issueType}, adwCommand=${adwResult.adwCommand}, success=${adwResult.success}`, 'success');
      return { ...adwResult, issueTitle: issue.title };
    }

    // Step 2: Fall back to /classify_issue
    log(`No ADW command found for issue #${issueNumber}, falling back to /classify_issue`);
    log(`Attempting heuristic classification (/classify_issue) for issue #${issueNumber}...`);
    const heuristicResult = await classifyWithIssueCommand(
      issueContext,
      issueNumber,
      `trigger-classifier-${issueNumber}`,
      `/tmp/adw-trigger-classifier-${issueNumber}.jsonl`,
      issue.body,
    );
    log(`Classification complete for issue #${issueNumber}: classifier=heuristic, issueType=${heuristicResult.issueType}, adwCommand=${heuristicResult.adwCommand ?? 'none'}, success=${heuristicResult.success}`, heuristicResult.success ? 'success' : 'warn');
    return { ...heuristicResult, issueTitle: issue.title };
  } catch (error) {
    log(`Error classifying issue #${issueNumber}: ${error}`, 'error');
    return { issueType: '/feature', success: false };
  }
}

/**
 * Classifies a pre-fetched GitHub issue to determine its type.
 * Uses two-step classification: regex ADW command extraction first, then /classify_issue fallback.
 *
 * @param issue - The pre-fetched GitHub issue
 * @returns Classification result with issue type and success status
 */
export async function classifyGitHubIssue(
  issue: GitHubIssue
): Promise<IssueClassificationResult> {
  try {
    log(`Classifying issue #${issue.number} (${issue.title})...`);

    const labelsText = issue.labels.map((l) => l.name).join(', ') || 'none';
    log(`classifyGitHubIssue: issue #${issue.number} labels=[${labelsText}], body length=${issue.body?.length ?? 0}`);
    const issueContext = `**Title:** ${issue.title}
**Labels:** ${labelsText}

${issue.body || 'No description provided.'}`;

    // Step 1: Try deterministic ADW command extraction
    log(`Checking for explicit ADW command in issue #${issue.number}...`);
    const adwResult = classifyWithAdwCommand(
      issueContext,
      issue.number,
      issue.body,
    );
    if (adwResult) {
      log(`Classification complete for issue #${issue.number}: classifier=regex, issueType=${adwResult.issueType}, adwCommand=${adwResult.adwCommand}, success=${adwResult.success}`, 'success');
      return adwResult;
    }

    // Step 2: Fall back to /classify_issue
    log(`No ADW command found for issue #${issue.number}, falling back to /classify_issue`);
    log(`Attempting heuristic classification (/classify_issue) for issue #${issue.number}...`);
    const heuristicResult = await classifyWithIssueCommand(
      issueContext,
      issue.number,
      `classifier-${issue.number}`,
      `/tmp/adw-classifier-${issue.number}.jsonl`,
      issue.body,
    );
    log(`Classification complete for issue #${issue.number}: classifier=heuristic, issueType=${heuristicResult.issueType}, adwCommand=${heuristicResult.adwCommand ?? 'none'}, success=${heuristicResult.success}`, heuristicResult.success ? 'success' : 'warn');
    return heuristicResult;
  } catch (error) {
    log(`Error classifying issue #${issue.number}: ${error}`, 'error');
    return { issueType: '/feature', success: false };
  }
}

// Backward-compatible re-export from workflowMapping
export { getWorkflowScript } from './workflowMapping';
