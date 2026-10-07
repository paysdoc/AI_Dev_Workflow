export enum ReviewIssueKind {
  Feature = 'feature',
  Bug = 'bug',
  Chore = 'chore',
  /** An issue that moves an existing scenario into the regression suite. */
  Promotion = 'promotion',
  /** A revision of an open pull request. */
  PrReview = 'pr_review',
}

/** What the review prompt needs from TypeScript, which the agent cannot work out for itself. */
export interface ReviewPromptContext {
  /** The title of the section under `## Guidance by application type` that the reviewer applies. */
  readonly guidanceSection: string;
  readonly issueKind: ReviewIssueKind;
  /** Absolute paths of the per-issue scenario images the reviewer must open. */
  readonly imagePaths: readonly string[];
}

/**
 * The positional arguments of the `/review` prompt: `$0` adwId, `$1` spec file, `$2` agent name, `$3` scenario proof path,
 * `$4` guidance section title, `$5` issue kind, `$6` the image paths as a JSON array.
 *
 * `$3` is an empty string rather than absent when there is no proof, so that `$4` to `$6` keep their positions.
 * `$6` is JSON so that any number of paths, whatever characters they hold, reaches the prompt as one argument.
 */
export function formatReviewArgs(
  adwId: string,
  specFile: string,
  agentName: string,
  scenarioProofPath: string | undefined,
  context: ReviewPromptContext,
): string[] {
  return [
    adwId,
    specFile,
    agentName,
    scenarioProofPath ?? '',
    context.guidanceSection,
    context.issueKind,
    JSON.stringify(context.imagePaths),
  ];
}
