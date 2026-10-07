import { describe, it, expect } from 'vitest';
import { ReviewIssueKind } from '../../agents/reviewPromptArgs';
import { APPLICATION_TYPE_PROFILES, EvidenceKind, RunnerMode, type ApplicationProfile } from '../../core/applicationType';
import { ADW_REGRESSION_PROMOTION_LABEL } from '../../core/adwLabels';
import type { IssueClassSlashCommand } from '../../types/issueTypes';
import type { WorkflowConfig } from '../workflowInit';
import { buildReviewPromptContext, describeReviewPromptContext, reviewIssueKind } from '../reviewPromptContext';

const DESKTOP: ApplicationProfile = {
  runnerMode: RunnerMode.Descriptor,
  evidenceKinds: [EvidenceKind.PerIssueImages],
  reviewGuidanceSection: 'Desktop applications',
};

const IMAGES = [
  { absPath: '/artifacts/adw-1/cart/total.png', relPath: 'adw-1/cart/total.png', scenario: 'Cart › The cart shows the order total' },
  { absPath: '/artifacts/adw-1/checkout/address.png', relPath: 'adw-1/checkout/address.png', scenario: 'Checkout › The page asks for an address' },
];

interface ConfigOptions {
  /** `null` is a workflow that carries no profile; leaving it out gives the web profile. */
  readonly profile?: ApplicationProfile | null;
  readonly issueType?: IssueClassSlashCommand;
  readonly labels?: readonly string[];
  /** `null` is a workflow with no scenario proof. */
  readonly images?: typeof IMAGES | null;
}

function makeConfig({ profile = APPLICATION_TYPE_PROFILES.web, issueType = '/feature', labels = [], images = IMAGES }: ConfigOptions = {}) {
  const scenarioProof = images === null
    ? undefined
    : { tagResults: [], hasBlockerFailures: false, perIssueImages: images, resultsFilePath: '/proof.md', artifactsDir: '/artifacts' };
  return {
    applicationProfile: profile ?? undefined,
    issueType,
    issue: { labels },
    ctx: { scenarioProof },
  } as unknown as Pick<WorkflowConfig, 'applicationProfile' | 'issueType' | 'issue' | 'ctx'>;
}

describe('reviewIssueKind', () => {
  it.each<[IssueClassSlashCommand, ReviewIssueKind]>([
    ['/feature', ReviewIssueKind.Feature],
    ['/bug', ReviewIssueKind.Bug],
    ['/chore', ReviewIssueKind.Chore],
    ['/pr_review', ReviewIssueKind.PrReview],
    ['/adw_init', ReviewIssueKind.Chore],
  ])('maps %s to %s', (issueType, expected) => {
    expect(reviewIssueKind(issueType, [])).toBe(expected);
  });

  it.each<IssueClassSlashCommand>(['/feature', '/chore', '/bug'])('makes a %s issue labelled for promotion a promotion, whatever its type', (issueType) => {
    expect(reviewIssueKind(issueType, [ADW_REGRESSION_PROMOTION_LABEL])).toBe(ReviewIssueKind.Promotion);
  });

  it('changes nothing for the labels of any other kind of issue', () => {
    expect(reviewIssueKind('/feature', ['hitl', 'adw:feature'])).toBe(ReviewIssueKind.Feature);
    expect(reviewIssueKind('/bug', ['hitl'])).toBe(ReviewIssueKind.Bug);
  });
});

describe('buildReviewPromptContext', () => {
  it('names the guidance section of the web profile', () => {
    expect(buildReviewPromptContext(makeConfig({ profile: APPLICATION_TYPE_PROFILES.web })).guidanceSection).toBe('Web applications');
  });

  it('names the guidance section of the cli profile', () => {
    expect(buildReviewPromptContext(makeConfig({ profile: APPLICATION_TYPE_PROFILES.cli })).guidanceSection).toBe('CLI applications');
  });

  it("passes on the guidance section of a profile it has never heard of, which shows that it reads the mapping", () => {
    expect(buildReviewPromptContext(makeConfig({ profile: DESKTOP })).guidanceSection).toBe('Desktop applications');
  });

  it('derives the issue kind from the classification and the labels of the issue', () => {
    expect(buildReviewPromptContext(makeConfig({ issueType: '/bug' })).issueKind).toBe(ReviewIssueKind.Bug);
    expect(buildReviewPromptContext(makeConfig({ labels: [ADW_REGRESSION_PROMOTION_LABEL] })).issueKind).toBe(ReviewIssueKind.Promotion);
  });

  it('lists the absolute paths of the images the scenario proof selected, in its order', () => {
    expect(buildReviewPromptContext(makeConfig()).imagePaths).toEqual(['/artifacts/adw-1/cart/total.png', '/artifacts/adw-1/checkout/address.png']);
  });

  it('lists no image when the proof selected none', () => {
    expect(buildReviewPromptContext(makeConfig({ images: [] })).imagePaths).toEqual([]);
  });

  it('lists no image when the workflow has no scenario proof', () => {
    expect(buildReviewPromptContext(makeConfig({ images: null })).imagePaths).toEqual([]);
  });

  it('refuses a workflow that carries no application profile, since ADW assumes no type', () => {
    expect(() => buildReviewPromptContext(makeConfig({ profile: null }))).toThrow(/application profile/);
  });
});

describe('describeReviewPromptContext', () => {
  it('names the guidance section, the issue kind and every image path', () => {
    const description = describeReviewPromptContext({
      guidanceSection: 'Web applications',
      issueKind: ReviewIssueKind.Feature,
      imagePaths: ['/a.png', '/b.png'],
    });

    expect(description).toBe('Review: "Web applications" guidance, feature issue, 2 per-issue image(s) for the reviewer to open: /a.png, /b.png');
  });

  it('says there is no per-issue image when there is none', () => {
    const description = describeReviewPromptContext({ guidanceSection: 'CLI applications', issueKind: ReviewIssueKind.Chore, imagePaths: [] });

    expect(description).toBe('Review: "CLI applications" guidance, chore issue, no per-issue image');
  });

  it('stays on one line', () => {
    const description = describeReviewPromptContext({ guidanceSection: 'Web applications', issueKind: ReviewIssueKind.PrReview, imagePaths: ['/a.png', '/b.png'] });

    expect(description).not.toMatch(/[\r\n]/);
  });
});
