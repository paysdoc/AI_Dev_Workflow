import { MAX_REVIEW_RETRY_ATTEMPTS, log, AgentStateManager, type LogLevel } from '../core';
import {
  DevServerStartStatus,
  NO_REVIEW_ATTEMPTS,
  countFailedReview,
  countFailedStart,
  countStartedServer,
  isReviewBudgetSpent,
  serverOutputTail,
  type DevServerStart,
  type FailedDevServerStart,
  type ReviewAttempts,
} from '../core/devServerFailure';
import { MAX_START_ATTEMPTS } from '../core/devServerLifecycle';
import { runPhase, type CostTracker } from '../core/phaseRunner';
import { postIssueStageComment } from './phaseCommentHelpers';
import { executeReviewPatchCycle, executeReviewPhase, type ReviewIssue } from './reviewPhase';
import { executeScenarioTestPhase, type ScenarioTestPhaseResult } from './scenarioTestPhase';
import type { WorkflowConfig } from './workflowInit';

export interface ReviewRetryPhases {
  readonly executeReviewPhase: typeof executeReviewPhase;
  readonly executeReviewPatchCycle: typeof executeReviewPatchCycle;
  readonly executeScenarioTestPhase: typeof executeScenarioTestPhase;
}

export const REVIEW_RETRY_PHASES: ReviewRetryPhases = {
  executeReviewPhase,
  executeReviewPatchCycle,
  executeScenarioTestPhase,
};

/** What a scenario run leaves for the review: a `ScenarioTestFixLoopResult` has this shape as it is. */
export interface ScenarioOutcome {
  readonly scenarioProofPath: string;
  readonly devServer: DevServerStart;
}

export interface ReviewRetryResult {
  readonly reviewPassed: boolean;
  /** Every failed review of the run, failed starts included, whether or not a reset cleared them from the count. */
  readonly reviewRetries: number;
}

export function scenarioOutcomeOf(phaseResult: Pick<ScenarioTestPhaseResult, 'scenarioProof' | 'devServer'>): ScenarioOutcome {
  return { scenarioProofPath: phaseResult.scenarioProof?.resultsFilePath ?? '', devServer: phaseResult.devServer };
}

const FAILED_START_REVIEW = 'Review failed: the dev server did not start on the issue branch, so no scenario ran';
const MIN_FENCE_LENGTH = 3;

function recordLine(statePath: string, message: string, level: LogLevel): void {
  log(message, level);
  AgentStateManager.appendLog(statePath, message);
}

// The output is the server's own and may hold backticks: a fence longer than any run inside it cannot be closed early.
function fenceAround(text: string): string {
  const longestRun = (text.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0);
  const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** The patch agent is handed both fields, so the builder gets the server's output. */
export function serverStartBlocker(start: FailedDevServerStart): ReviewIssue {
  return {
    reviewIssueNumber: 1,
    issueSeverity: 'blocker',
    remediationStrategy: 'patch',
    issueDescription: [
      `The dev server did not start on the issue branch, so no scenario ran. Start command: \`${start.command}\`. ` +
        `Health check: ${start.healthUrl}. ${MAX_START_ATTEMPTS} start attempts got no answer from it. The end of the server's output:`,
      '',
      fenceAround(serverOutputTail(start.output)),
    ].join('\n'),
    issueResolution:
      'Find the change on this branch that stops the dev server from starting and fix it, using the server output above. ' +
      'Do not change how `.adw/commands.md` declares or starts the dev server.',
  };
}

/** A failed start is a failed review: the failed start is the verdict, and no scenario ran for a reviewer to judge. */
export function recordFailedStartReview(config: WorkflowConfig, start: FailedDevServerStart): ReviewIssue[] {
  const { ctx, repoContext, issueNumber, orchestratorStatePath } = config;
  const blocker = serverStartBlocker(start);

  ctx.reviewIssues = [blocker];
  ctx.errorMessage = FAILED_START_REVIEW;
  ctx.screenshotUrls = [];
  recordLine(orchestratorStatePath, FAILED_START_REVIEW, 'error');
  if (repoContext) postIssueStageComment(repoContext, issueNumber, 'review_failed', ctx);

  return [blocker];
}

interface AttemptJudgement {
  readonly attempts: ReviewAttempts;
  readonly passed: boolean;
  readonly blockers: ReviewIssue[];
}

function judgeFailedStart(
  config: WorkflowConfig,
  start: FailedDevServerStart,
  before: ReviewAttempts,
  maxAttempts: number,
): AttemptJudgement {
  const attempts = countFailedStart(before);
  recordLine(
    config.orchestratorStatePath,
    `Review attempt failed (${attempts.failed}/${maxAttempts}): the dev server did not start on the issue branch`,
    'error',
  );
  return { attempts, passed: false, blockers: recordFailedStartReview(config, start) };
}

function countStart(config: WorkflowConfig, before: ReviewAttempts): ReviewAttempts {
  if (before.lastStartFailed) {
    recordLine(
      config.orchestratorStatePath,
      'Dev server started after a failed start: the failed-review count is reset to 0',
      'success',
    );
  }
  return countStartedServer(before);
}

async function judgeReview(
  config: WorkflowConfig,
  tracker: CostTracker,
  outcome: ScenarioOutcome,
  before: ReviewAttempts,
  phases: ReviewRetryPhases,
  maxAttempts: number,
): Promise<AttemptJudgement> {
  const attempts = outcome.devServer.status === DevServerStartStatus.Started ? countStart(config, before) : before;

  config.ctx.reviewAttempt = attempts.failed + 1;
  config.ctx.maxReviewAttempts = maxAttempts;
  const review = await runPhase(config, tracker, cfg => phases.executeReviewPhase(cfg, outcome.scenarioProofPath));
  if (review.reviewPassed) return { attempts, passed: true, blockers: [] };

  const blockers = review.reviewIssues.filter(issue => issue.issueSeverity === 'blocker');
  return { attempts: countFailedReview(attempts), passed: false, blockers };
}

async function judgeAttempt(
  config: WorkflowConfig,
  tracker: CostTracker,
  outcome: ScenarioOutcome,
  before: ReviewAttempts,
  phases: ReviewRetryPhases,
  maxAttempts: number,
): Promise<AttemptJudgement> {
  if (outcome.devServer.status === DevServerStartStatus.Failed) {
    return judgeFailedStart(config, outcome.devServer, before, maxAttempts);
  }
  return judgeReview(config, tracker, outcome, before, phases, maxAttempts);
}

/**
 * The one owner of the review attempt counter. A failed review and a failed start each use one attempt, up to
 * `maxAttempts`; a start that follows a failed start sets the count back to zero. Whatever stops the loop
 * short of a pass, the caller turns into `review_failed`.
 *
 * With no server declared this is the loop every orchestrator used to carry: at most `maxAttempts` reviews,
 * and a patch and a new scenario run between them.
 */
export async function runReviewRetryLoop(
  config: WorkflowConfig,
  tracker: CostTracker,
  start: ScenarioOutcome,
  phases: ReviewRetryPhases = REVIEW_RETRY_PHASES,
  maxAttempts: number = MAX_REVIEW_RETRY_ATTEMPTS,
): Promise<ReviewRetryResult> {
  if (maxAttempts <= 0) return { reviewPassed: false, reviewRetries: 0 };

  let judgement = await judgeAttempt(config, tracker, start, NO_REVIEW_ATTEMPTS, phases, maxAttempts);
  while (!judgement.passed && !isReviewBudgetSpent(judgement.attempts, maxAttempts)) {
    const { blockers } = judgement;
    await runPhase(config, tracker, cfg => phases.executeReviewPatchCycle(cfg, blockers));
    const outcome = scenarioOutcomeOf(await runPhase(config, tracker, phases.executeScenarioTestPhase));
    judgement = await judgeAttempt(config, tracker, outcome, judgement.attempts, phases, maxAttempts);
  }

  if (!judgement.passed) {
    recordLine(
      config.orchestratorStatePath,
      `Review budget spent: ${judgement.attempts.failed} failed review attempt(s) of ${maxAttempts}, failed starts included`,
      'error',
    );
  }
  return { reviewPassed: judgement.passed, reviewRetries: judgement.attempts.total };
}
