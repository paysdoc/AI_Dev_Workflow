import { describe, it, expect } from 'vitest';
import { ReviewIssueKind, formatReviewArgs, type ReviewPromptContext } from '../reviewPromptArgs';

const CONTEXT: ReviewPromptContext = {
  guidanceSection: 'Web applications',
  issueKind: ReviewIssueKind.Feature,
  imagePaths: ['/agents/adw-1/scenario-test/artifacts/cart.png', '/agents/adw-1/scenario-test/artifacts/checkout.png'],
};

function contextWith(imagePaths: readonly string[]): ReviewPromptContext {
  return { ...CONTEXT, imagePaths };
}

describe('formatReviewArgs', () => {
  it('returns the seven positional arguments in the order the review prompt documents them', () => {
    const args = formatReviewArgs('adw-1', 'specs/plan.md', 'Review', '/abs/scenario_proof.md', CONTEXT);

    expect(args).toEqual([
      'adw-1',
      'specs/plan.md',
      'Review',
      '/abs/scenario_proof.md',
      CONTEXT.guidanceSection,
      CONTEXT.issueKind,
      JSON.stringify(CONTEXT.imagePaths),
    ]);
  });

  it('gives the proof argument as an empty string when there is no proof, so that $4 to $6 keep their positions', () => {
    const args = formatReviewArgs('adw-1', 'specs/plan.md', 'Review', undefined, CONTEXT);

    expect(args).toHaveLength(7);
    expect(args[3]).toBe('');
    expect(args.slice(4)).toEqual([CONTEXT.guidanceSection, CONTEXT.issueKind, JSON.stringify(CONTEXT.imagePaths)]);
  });

  it('gives the image paths as a JSON array that parses back to the paths in the order given', () => {
    const args = formatReviewArgs('adw-1', 'specs/plan.md', 'Review', undefined, CONTEXT);

    expect(JSON.parse(args[6])).toEqual(CONTEXT.imagePaths);
  });

  it('gives an empty JSON array when there is no image', () => {
    const args = formatReviewArgs('adw-1', 'specs/plan.md', 'Review', '/abs/scenario_proof.md', contextWith([]));

    expect(args[6]).toBe('[]');
  });

  it('keeps a path with a space or a single quote as one element', () => {
    const paths = ["/agents/adw 1/artifacts/the cart.png", "/agents/adw-1/artifacts/o'brien.png"];

    const args = formatReviewArgs('adw-1', 'specs/plan.md', 'Review', undefined, contextWith(paths));

    expect(args).toHaveLength(7);
    expect(JSON.parse(args[6])).toEqual(paths);
  });
});

describe('ReviewIssueKind', () => {
  it('names the five kinds of issue in lowercase, as the review prompt does', () => {
    expect(Object.values(ReviewIssueKind)).toEqual(['feature', 'bug', 'chore', 'promotion', 'pr_review']);
  });

  it.each(Object.values(ReviewIssueKind))('is lowercase: %s', (kind) => {
    expect(kind).toBe(kind.toLowerCase());
  });
});
