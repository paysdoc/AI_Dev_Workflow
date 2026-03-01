/**
 * Issue classifier for ADW workflows.
 *
 * Provides two-step classification: first tries /classify_adw to detect
 * explicit ADW workflow commands, then falls back to /classify_issue
 * for AI-based heuristic classification.
 */

import { fetchGitHubIssue } from '../github/githubApi';
import { runClaudeAgentWithCommand } from '../agents/claudeAgent';
import {
  IssueClassSlashCommand,
  AdwSlashCommand,
  AdwClassificationResult,
  adwCommandToIssueTypeMap,
  adwCommandToOrchestratorMap,
  issueTypeToOrchestratorMap,
  VALID_ISSUE_TYPES,
  log,
  GitHubIssue,
  getModelForCommand,
} from '.';
import { extractJson } from './jsonParser';

/**
 * Extracts an explicit ADW slash command from text using deterministic regex matching.
 * Scans for `/adw_*` patterns and validates against known commands.
 * Commands are matched longest-first to avoid partial matches (e.g., `/adw_plan_build_test` before `/adw_plan`).
 *
 * @param text - The text to scan for ADW commands
 * @returns The matched AdwSlashCommand or null if none found
 */
export function extractAdwCommandFromText(text: string): AdwSlashCommand | null {
  if (!text) return null;

  const validCommands = Object.keys(adwCommandToIssueTypeMap) as AdwSlashCommand[];
  const sortedByLength = [...validCommands].sort((a, b) => b.length - a.length);

  const found = sortedByLength.find((cmd) => {
    const pattern = new RegExp(`${cmd.replace('/', '\\/')}\\b`);
    return pattern.test(text);
  });

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
}

/**
 * Parses the raw string output from the /classify_adw agent into an AdwClassificationResult.
 * Uses shared JSON extraction, then validates the parsed result.
 *
 * @param output - Raw string output from the /classify_adw agent
 * @returns Parsed AdwClassificationResult or null if empty/unparseable
 */
export function parseAdwClassificationOutput(output: string): AdwClassificationResult | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  const parsed = extractJson<Record<string, unknown>>(trimmed);
  if (!parsed || Object.keys(parsed).length === 0) return null;

  const result: AdwClassificationResult = {};

  // Validate adwSlashCommand if present
  if (typeof parsed['adwSlashCommand'] === 'string') {
    const command = parsed['adwSlashCommand'];
    if (command in adwCommandToIssueTypeMap) {
      result.adwSlashCommand = command as AdwSlashCommand;
    } else {
      return null;
    }
  }

  // Extract adwId if present
  if (typeof parsed['adwId'] === 'string') {
    result.adwId = parsed['adwId'];
  }

  // Must have at least adwSlashCommand to be useful
  if (!result.adwSlashCommand) return null;

  return result;
}

/**
 * Attempts ADW-specific classification by calling /classify_adw.
 * Maps recognized ADW commands to IssueClassSlashCommand types.
 *
 * @param issueContext - The issue context string to classify
 * @param issueNumber - The GitHub issue number
 * @param outputFile - Path for agent output file
 * @returns IssueClassificationResult if ADW command found, null to fall back
 */
export async function classifyWithAdwCommand(
  issueContext: string,
  issueNumber: number,
  outputFile: string,
  issueBody?: string,
): Promise<IssueClassificationResult | null> {
  // Deterministic regex pre-check: extract explicit /adw_* commands before calling the AI agent
  const regexMatch = extractAdwCommandFromText(issueBody ?? issueContext);
  if (regexMatch) {
    const issueType = adwCommandToIssueTypeMap[regexMatch];
    log(`Issue #${issueNumber} matched ADW command ${regexMatch} via regex pre-check`, 'success');
    return {
      issueType,
      success: true,
      adwCommand: regexMatch,
    };
  }

  try {
    const result = await runClaudeAgentWithCommand(
      '/classify_adw',
      issueContext,
      `adw-classifier-${issueNumber}`,
      outputFile,
      getModelForCommand('/classify_adw', issueBody),
    );

    if (!result.success) {
      log(`ADW classifier agent failed for issue #${issueNumber}`, 'error');
      return null;
    }

    const parsed = parseAdwClassificationOutput(result.output);
    if (!parsed?.adwSlashCommand) {
      log(`ADW classifier returned no valid command for issue #${issueNumber}`);
      return null;
    }

    const issueType = adwCommandToIssueTypeMap[parsed.adwSlashCommand];
    log(`Issue #${issueNumber} matched ADW command ${parsed.adwSlashCommand} → ${issueType}`, 'success');

    return {
      issueType,
      success: true,
      adwCommand: parsed.adwSlashCommand,
      adwId: parsed.adwId,
    };
  } catch (error) {
    log(`ADW classification error for issue #${issueNumber}: ${error}`, 'error');
    return null;
  }
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
  const result = await runClaudeAgentWithCommand(
    '/classify_issue',
    issueContext,
    agentName,
    outputFile,
    getModelForCommand('/classify_issue', issueBody),
  );

  if (!result.success) {
    log(`Classification failed for issue #${issueNumber}, defaulting to /feature`, 'error');
    return { issueType: '/feature', success: false };
  }

  const output = result.output.trim();
  const commandPattern = VALID_ISSUE_TYPES.map(cmd => cmd.replace('/', '\\/')).join('|');
  const regex = new RegExp(`(${commandPattern})(?!.*(?:${commandPattern}))`, 's');
  const match = output.match(regex);
  const matchedCommand = match ? match[1] as IssueClassSlashCommand : undefined;

  if (matchedCommand) {
    log(`Issue #${issueNumber} classified as ${matchedCommand}`, 'success');
    return { issueType: matchedCommand, success: true };
  }

  log(`Could not parse classification for issue #${issueNumber}, defaulting to /feature`, 'error');
  return { issueType: '/feature', success: false };
}

/**
 * Classifies an issue to determine the appropriate workflow.
 * Uses two-step classification: /classify_adw first, then /classify_issue fallback.
 *
 * @param issueNumber - The GitHub issue number to classify
 * @returns Classification result with issue type and success status
 */
export async function classifyIssueForTrigger(
  issueNumber: number
): Promise<IssueClassificationResult> {
  try {
    log(`Classifying issue #${issueNumber} for trigger...`);

    const issue = await fetchGitHubIssue(issueNumber);
    const issueContext = `**#${issue.number}: ${issue.title}**\n\n${issue.body}`;

    // Step 1: Try ADW-specific classification
    log(`Attempting ADW classification (/classify_adw) for issue #${issueNumber}...`);
    const adwResult = await classifyWithAdwCommand(
      issueContext,
      issueNumber,
      `/tmp/adw-trigger-adw-classifier-${issueNumber}.jsonl`,
      issue.body,
    );
    if (adwResult) return adwResult;

    // Step 2: Fall back to /classify_issue
    log(`No ADW command found for issue #${issueNumber}, falling back to /classify_issue`);
    log(`Attempting heuristic classification (/classify_issue) for issue #${issueNumber}...`);
    return await classifyWithIssueCommand(
      issueContext,
      issueNumber,
      `trigger-classifier-${issueNumber}`,
      `/tmp/adw-trigger-classifier-${issueNumber}.jsonl`,
      issue.body,
    );
  } catch (error) {
    log(`Error classifying issue #${issueNumber}: ${error}`, 'error');
    return { issueType: '/feature', success: false };
  }
}

/**
 * Classifies a pre-fetched GitHub issue to determine its type.
 * Uses two-step classification: /classify_adw first, then /classify_issue fallback.
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
    const issueContext = `**Title:** ${issue.title}
**Labels:** ${labelsText}

${issue.body || 'No description provided.'}`;

    // Step 1: Try ADW-specific classification
    log(`Attempting ADW classification (/classify_adw) for issue #${issue.number}...`);
    const adwResult = await classifyWithAdwCommand(
      issueContext,
      issue.number,
      `/tmp/adw-adw-classifier-${issue.number}.jsonl`,
      issue.body,
    );
    if (adwResult) return adwResult;

    // Step 2: Fall back to /classify_issue
    log(`No ADW command found for issue #${issue.number}, falling back to /classify_issue`);
    log(`Attempting heuristic classification (/classify_issue) for issue #${issue.number}...`);
    return await classifyWithIssueCommand(
      issueContext,
      issue.number,
      `classifier-${issue.number}`,
      `/tmp/adw-classifier-${issue.number}.jsonl`,
      issue.body,
    );
  } catch (error) {
    log(`Error classifying issue #${issue.number}: ${error}`, 'error');
    return { issueType: '/feature', success: false };
  }
}

/**
 * Determines which workflow script to use based on issue type and optional ADW command.
 *
 * Routing priority:
 * 1. If `adwCommand` is provided and exists in `adwCommandToOrchestratorMap`, use the mapped orchestrator.
 * 2. Otherwise, fall back to `issueTypeToOrchestratorMap` for issue-type-based routing.
 *
 * @param issueType - The classified issue type
 * @param adwCommand - Optional ADW command for precise orchestrator routing
 * @returns The workflow script path to spawn
 */
export function getWorkflowScript(issueType: IssueClassSlashCommand, adwCommand?: AdwSlashCommand): string {
  // Route ADW commands to their dedicated orchestrators when mapped
  if (adwCommand) {
    const orchestrator = adwCommandToOrchestratorMap[adwCommand];
    if (orchestrator) return orchestrator;
  }

  return issueTypeToOrchestratorMap[issueType] ?? 'adws/adwPlanBuildTest.tsx';
}
