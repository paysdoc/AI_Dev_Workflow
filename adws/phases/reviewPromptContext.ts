import { ReviewIssueKind, type ReviewPromptContext } from '../agents/reviewPromptArgs';
import { hasRegressionPromotionLabel } from '../core/adwLabels';
import type { IssueClassSlashCommand } from '../types/issueTypes';
import { requireApplicationProfile } from './applicationTypeGate';
import type { WorkflowConfig } from './workflowInit';

const ISSUE_KIND_BY_TYPE: Readonly<Record<IssueClassSlashCommand, ReviewIssueKind>> = {
  '/feature': ReviewIssueKind.Feature,
  '/bug': ReviewIssueKind.Bug,
  '/chore': ReviewIssueKind.Chore,
  '/pr_review': ReviewIssueKind.PrReview,
  '/adw_init': ReviewIssueKind.Chore, // never reviewed; the record is total
};

// A promotion issue is classified as a feature, and only its label says it needs no scenarios of its own.
export function reviewIssueKind(issueType: IssueClassSlashCommand, labels: readonly string[]): ReviewIssueKind {
  if (hasRegressionPromotionLabel(labels)) return ReviewIssueKind.Promotion;
  return ISSUE_KIND_BY_TYPE[issueType];
}

export function buildReviewPromptContext(
  config: Pick<WorkflowConfig, 'applicationProfile' | 'issueType' | 'issue' | 'ctx'>,
): ReviewPromptContext {
  return {
    guidanceSection: requireApplicationProfile(config).reviewGuidanceSection,
    issueKind: reviewIssueKind(config.issueType, config.issue.labels),
    imagePaths: (config.ctx.scenarioProof?.perIssueImages ?? []).map(image => image.absPath),
  };
}

export function describeReviewPromptContext(context: ReviewPromptContext): string {
  const images = context.imagePaths.length === 0
    ? 'no per-issue image'
    : `${context.imagePaths.length} per-issue image(s) for the reviewer to open: ${context.imagePaths.join(', ')}`;
  return `Review: "${context.guidanceSection}" guidance, ${context.issueKind} issue, ${images}`;
}
