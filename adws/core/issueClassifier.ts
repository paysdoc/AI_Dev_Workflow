/**
 * Issue classifier for ADW workflows.
 *
 * Provides single-step LLM classification via /classify_issue.
 * Deterministic regex command extraction has been removed; classification
 * is performed exclusively by the AI heuristic.
 */

import type { Issue } from '../providers/types';
import { runClaudeAgentWithCommand } from '../agents/claudeAgent';
import {
  IssueClassSlashCommand,
  VALID_ISSUE_TYPES,
  log,
  getModelForCommand,
  getEffortForCommand,
} from '.';
import { extractAdwIdFromComment } from './workflowCommentParsing';
import { readAdwLabelNames } from './adwLabels';

/**
 * Result of classifying an issue for trigger purposes.
 */
export interface IssueClassificationResult {
  issueType: IssueClassSlashCommand;
  success: boolean;
  adwId?: string;
  issueTitle?: string;
}

/**
 * Classifies an issue using /classify_issue (AI heuristic).
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
 * The forge-neutral shape `classifyIssueForTrigger` needs: label *names*
 * (`string[]`), not the GitHub-shaped label objects `readAdwLabels` used to
 * read directly. Any `fetchIssue` implementation — a boundary's `IssueTracker`
 * or a legacy adapter — satisfies this by construction.
 */
export type ClassifiableIssue = Pick<Issue, 'number' | 'title' | 'body' | 'labels' | 'comments'>;

/**
 * Injectable deps for classifyIssueForTrigger. `fetchIssue` is required — a
 * bound provider has no repository parameter to get wrong, so there is no
 * legacy default left to fall back to. `classifyWith` is optional, defaulting
 * to the module-private `classifyWithIssueCommand`; tests inject a fake.
 */
export interface ClassifyIssueForTriggerDeps {
  fetchIssue: (issueNumber: number) => Promise<ClassifiableIssue>;
  classifyWith?: (
    issueContext: string,
    issueNumber: number,
    agentName: string,
    outputFile: string,
    issueBody?: string,
  ) => Promise<IssueClassificationResult>;
}

/**
 * Classifies an issue to determine the appropriate workflow.
 * Uses LLM-only classification via /classify_issue.
 *
 * The adw:* label override is enforced here — at the sole chokepoint all four
 * trigger paths (cron, issues.opened, issue_comment, dependency-closure) share —
 * rather than per-caller, so callers that omit labelRouting cannot silently fall
 * through to the LLM on a labeled issue (#618).
 *
 * @param issueNumber - The GitHub issue number to classify
 * @param deps - Injectable deps; `fetchIssue` is required, `classifyWith` optional
 * @returns Classification result with issue type and success status
 */
export async function classifyIssueForTrigger(
  issueNumber: number,
  deps: ClassifyIssueForTriggerDeps,
): Promise<IssueClassificationResult> {
  const classifyWith = deps.classifyWith ?? classifyWithIssueCommand;

  try {
    log(`Classifying issue #${issueNumber} for trigger...`);

    const issue = await deps.fetchIssue(issueNumber);
    log(`classifyIssueForTrigger: issue #${issueNumber} title="${issue.title}", body length=${issue.body?.length ?? 0}`);

    // Deterministic adw:* label override — a single adw:<type> classification label
    // bypasses AI classification on EVERY spawn path. Enforced here (all four triggers
    // funnel through this chokepoint) so a caller that omits labelRouting cannot
    // silently fall through to the LLM. Multiple conflicting adw:<type> labels fall
    // through to the heuristic, unchanged.
    const labelReading = readAdwLabelNames(issue.labels);
    if (labelReading.classification && !labelReading.conflict) {
      log(`Issue #${issueNumber}: adw:* label override -> ${labelReading.classification}, skipping AI classification`, 'success');
      return { issueType: labelReading.classification, success: true, issueTitle: issue.title };
    }

    const issueContext = `**#${issue.number}: ${issue.title}**\n\n${issue.body}`;

    const heuristicResult = await classifyWith(
      issueContext,
      issueNumber,
      `trigger-classifier-${issueNumber}`,
      `/tmp/adw-trigger-classifier-${issueNumber}.jsonl`,
      issue.body,
    );

    // If no adwId from classification, scan comments for an existing one (retry path)
    if (!heuristicResult.adwId && issue.comments.length > 0) {
      for (let i = issue.comments.length - 1; i >= 0; i--) {
        const commentAdwId = extractAdwIdFromComment(issue.comments[i].body);
        if (commentAdwId) {
          log(`classifyIssueForTrigger: recovered adwId="${commentAdwId}" from issue #${issueNumber} comments`);
          heuristicResult.adwId = commentAdwId;
          break;
        }
      }
    }

    log(`Classification complete for issue #${issueNumber}: issueType=${heuristicResult.issueType}, success=${heuristicResult.success}`, heuristicResult.success ? 'success' : 'warn');
    return { ...heuristicResult, issueTitle: issue.title };
  } catch (error) {
    log(`Error classifying issue #${issueNumber}: ${error}`, 'error');
    return { issueType: '/feature', success: false };
  }
}

/**
 * Classifies a pre-fetched issue to determine its type.
 * Uses LLM-only classification via /classify_issue.
 *
 * @param issue - The pre-fetched issue
 * @returns Classification result with issue type and success status
 */
export async function classifyGitHubIssue(
  issue: ClassifiableIssue
): Promise<IssueClassificationResult> {
  try {
    log(`Classifying issue #${issue.number} (${issue.title})...`);

    const labelsText = issue.labels.join(', ') || 'none';
    log(`classifyGitHubIssue: issue #${issue.number} labels=[${labelsText}], body length=${issue.body?.length ?? 0}`);
    const issueContext = `**Title:** ${issue.title}
**Labels:** ${labelsText}

${issue.body || 'No description provided.'}`;

    const heuristicResult = await classifyWithIssueCommand(
      issueContext,
      issue.number,
      `classifier-${issue.number}`,
      `/tmp/adw-classifier-${issue.number}.jsonl`,
      issue.body,
    );
    log(`Classification complete for issue #${issue.number}: issueType=${heuristicResult.issueType}, success=${heuristicResult.success}`, heuristicResult.success ? 'success' : 'warn');
    return heuristicResult;
  } catch (error) {
    log(`Error classifying issue #${issue.number}: ${error}`, 'error');
    return { issueType: '/feature', success: false };
  }
}

// Backward-compatible re-export from workflowMapping
export { getWorkflowScript } from './workflowMapping';
