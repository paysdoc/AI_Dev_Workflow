/**
 * Base utilities and parsing functions for workflow comments.
 */

import { WorkflowStage, RecoveryState, GitHubComment, AgentStateManager } from '../core';
import { fetchGitHubIssue } from './githubApi';

/** Stage order for determining recovery resume point. */
export const STAGE_ORDER: WorkflowStage[] = [
  'starting',
  'resuming',
  'classified',
  'branch_created',
  'plan_building',
  'plan_created',
  'planFile_created',
  'plan_committing',
  'implementing',
  'build_progress',
  'implemented',
  'implementation_committing',
  'pr_creating',
  'pr_created',
  'completed',
];

/** Maps comment header patterns to workflow stages. */
const STAGE_HEADER_MAP: Record<string, WorkflowStage> = {
  ':rocket: ADW Workflow Started': 'starting',
  ':arrows_counterclockwise: ADW Workflow Resuming': 'resuming',
  ':mag: Issue Classified': 'classified',
  ':seedling: Branch Created': 'branch_created',
  ':pencil: Building Implementation Plan': 'plan_building',
  ':white_check_mark: Implementation Plan Created': 'plan_created',
  ':page_facing_up: Plan File Created': 'planFile_created',
  ':floppy_disk: Committing Plan': 'plan_committing',
  ':hammer_and_wrench: Implementing Solution': 'implementing',
  ':white_check_mark: Implementation Complete': 'implemented',
  ':floppy_disk: Committing Implementation': 'implementation_committing',
  ':memo: Creating Pull Request': 'pr_creating',
  ':link: Pull Request Created': 'pr_created',
  ':tada: ADW Workflow Completed': 'completed',
  ':x: ADW Workflow Error': 'error',
  ':warning: Token Limit Recovery': 'token_limit_recovery',
};

/** ADW comment heading pattern: `## :emoji_name: Title` */
const ADW_COMMENT_PATTERN = /^## :[a-z_]+: /m;

/** Machine-readable footer appended to all ADW workflow comments. */
export const ADW_SIGNATURE = '\n\n---\n_Posted by ADW (AI Developer Workflow) automation_ <!-- adw-bot -->';

/** Pattern matching the HTML comment marker in the ADW signature footer. */
export const ADW_SIGNATURE_PATTERN = /<!-- adw-bot -->/;

/** Returns true if the comment body contains an ADW workflow heading pattern or the ADW signature marker. */
export function isAdwComment(commentBody: string): boolean {
  return ADW_COMMENT_PATTERN.test(commentBody) || ADW_SIGNATURE_PATTERN.test(commentBody);
}

/** Pattern matching the `## Take action` heading that signals an explicit human directive. */
export const ACTIONABLE_COMMENT_PATTERN = /^## Take action$/mi;

/** Returns true if the comment body contains the explicit `## Take action` directive heading. */
export function isActionableComment(commentBody: string): boolean {
  return ACTIONABLE_COMMENT_PATTERN.test(commentBody);
}

/** Extracts the content following the `## Take action` heading. Returns null if no heading or empty content. */
export function extractActionableContent(commentBody: string): string | null {
  const match = commentBody.match(ACTIONABLE_COMMENT_PATTERN);
  if (!match) return null;

  const headingEnd = (match.index ?? 0) + match[0].length;
  const content = commentBody.slice(headingEnd).trim();
  return content.length > 0 ? content : null;
}

/** Truncates text to a maximum length with ellipsis. */
export function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

/** Parses a workflow stage from a comment body. Returns null if not a workflow comment. */
export function parseWorkflowStageFromComment(commentBody: string): WorkflowStage | null {
  if (!commentBody.includes('ADW ID:')) return null;
  const headerMatch = commentBody.match(/^## (:[a-z_]+: .+)$/m);
  if (!headerMatch) return null;
  return STAGE_HEADER_MAP[headerMatch[1]] || null;
}

/** Extracts the ADW ID from a comment body. Matches both old format `adw-{timestamp}-{random}` and new format `adw-{slug}-{random}`. */
export function extractAdwIdFromComment(commentBody: string): string | null {
  const match = commentBody.match(/`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])`/);
  return match ? match[1] : null;
}

/** Extracts the branch name from a comment body. */
export function extractBranchNameFromComment(commentBody: string): string | null {
  const match = commentBody.match(/`((feat|bug|chore|review|test)-issue-\d+[a-z0-9-]*)`/);
  return match ? match[1] : null;
}

/** Extracts the PR URL from a comment body. */
export function extractPrUrlFromComment(commentBody: string): string | null {
  const match = commentBody.match(/(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/);
  return match ? match[1] : null;
}

/** Extracts the plan file path from a comment body. Pattern: `specs/issue-{number}-plan.md` */
export function extractPlanPathFromComment(commentBody: string): string | null {
  const match = commentBody.match(/`(specs\/issue-\d+-plan\.md)`/);
  return match ? match[1] : null;
}

const TERMINAL_STAGES: ReadonlyArray<WorkflowStage> = ['completed', 'error'];

/** Returns true if an ADW workflow is currently active (not completed or errored) for the given issue. */
export async function isAdwRunningForIssue(issueNumber: number): Promise<boolean> {
  const issue = await fetchGitHubIssue(issueNumber);

  const stageComments = issue.comments
    .map((c) => ({ stage: parseWorkflowStageFromComment(c.body), createdAt: c.createdAt, body: c.body }))
    .filter((entry): entry is { stage: WorkflowStage; createdAt: string; body: string } => entry.stage !== null);

  if (stageComments.length === 0) return false;

  const sorted = [...stageComments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (TERMINAL_STAGES.includes(sorted[0].stage)) return false;

  // Latest stage is non-terminal — verify the agent process is actually alive
  const adwId = extractAdwIdFromComment(sorted[0].body);
  if (!adwId) return true; // Cannot verify without ADW ID; conservatively assume running

  return AgentStateManager.isAgentProcessRunning(adwId);
}

/** Detects recovery state from GitHub comments. */
export function detectRecoveryState(comments: GitHubComment[]): RecoveryState {
  const defaultState: RecoveryState = {
    lastCompletedStage: null,
    adwId: null,
    branchName: null,
    planPath: null,
    prUrl: null,
    canResume: false,
  };

  const adwComments = comments.filter(c => parseWorkflowStageFromComment(c.body) !== null);
  if (adwComments.length === 0) return defaultState;

  const sortedComments = [...adwComments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const mostRecentStage = parseWorkflowStageFromComment(sortedComments[0].body);
  if (mostRecentStage === 'completed') return defaultState;

  let lastCompletedStage: WorkflowStage | null = null;
  let adwId: string | null = null;
  let branchName: string | null = null;
  let planPath: string | null = null;
  let prUrl: string | null = null;

  for (const comment of sortedComments.reverse()) {
    const stage = parseWorkflowStageFromComment(comment.body);
    if (!stage || stage === 'error') continue;

    const stageIndex = STAGE_ORDER.indexOf(stage);
    const lastIndex = lastCompletedStage ? STAGE_ORDER.indexOf(lastCompletedStage) : -1;
    if (stageIndex > lastIndex) lastCompletedStage = stage;

    const extractedAdwId = extractAdwIdFromComment(comment.body);
    if (extractedAdwId) adwId = extractedAdwId;

    const extractedBranch = extractBranchNameFromComment(comment.body);
    if (extractedBranch) branchName = extractedBranch;

    const extractedPlanPath = extractPlanPathFromComment(comment.body);
    if (extractedPlanPath) planPath = extractedPlanPath;

    const extractedPrUrl = extractPrUrlFromComment(comment.body);
    if (extractedPrUrl) prUrl = extractedPrUrl;
  }

  const canResume = lastCompletedStage !== null && lastCompletedStage !== 'completed';
  return { lastCompletedStage, adwId, branchName, planPath, prUrl, canResume };
}
