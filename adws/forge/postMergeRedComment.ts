import type { PostMergeFailure, PostMergeRed } from '../core/postMergeVerdict';
import { inlineCode, quote } from './parkCommentFormat';

export type PostMergeRedFacts = PostMergeRed & { readonly prNumber: number; readonly baseBranch: string };

// With MAX_PARK_OUTPUT_CHARS per quoted detail, these keep the comment far below the forge's comment size limit.
export const MAX_LISTED_COMMITS = 30;
export const MAX_LISTED_FAILURES = 10;

const MERGE_LOG_FILE = 'merge.log';

// Only `## Retry` wakes a human_gated workflow: the cron leaves it alone and no trigger reacts to a push.
export const POST_MERGE_RED_REMEDY =
  'Fix by hand and push, or comment `## Retry`. Either way ADW re-runs the scenarios, attempts fixes, re-reviews and merges. ' +
  'A push alone does not wake a parked workflow, so after a fix pushed by hand, comment `## Retry` as well.';

function describeOutcome({ prNumber, baseBranch }: PostMergeRedFacts): string {
  return (
    `Pull request #${prNumber} was not merged. Before merging it, ADW merged ${inlineCode(`origin/${baseBranch}`)} into its branch, ` +
    'pushed the merge and ran the `@regression` scenarios and this issue’s own scenarios again on it, and they failed.'
  );
}

/** The read whose lines the comment lists. It is named for the reader of the comment; nothing here runs it. */
const listingOf = (baseBranch: string): string => `git log --oneline <old head>..origin/${baseBranch}`;

// A subject may carry `@name`, `#123`, backticks or `## Retry`: a code span notifies no one, links nothing and reads as no directive.
function describeMergedCommits({ mergedCommits, baseBranch }: PostMergeRedFacts): string {
  const source = inlineCode(`origin/${baseBranch}`);
  if (mergedCommits.length === 0) return `The commits that came in from ${source} could not be listed.`;

  const lead = `These commits came in from ${source}, as ${inlineCode(listingOf(baseBranch))} lists them (merge commits left out):`;
  const listed = mergedCommits.slice(0, MAX_LISTED_COMMITS).map(commit => `- ${inlineCode(commit)}`);
  const more = mergedCommits.length - listed.length;
  return [lead, listed.join('\n'), ...(more > 0 ? [`… and ${more} more`] : [])].join('\n\n');
}

function describeConflicts({ conflictedFiles, baseBranch }: PostMergeRedFacts): string {
  if (conflictedFiles.length === 0) return `No file conflicted: ${inlineCode(`origin/${baseBranch}`)} merged in cleanly.`;
  return [
    'These files conflicted, and `/resolve_conflict` resolved them:',
    conflictedFiles.map(file => `- ${inlineCode(file)}`).join('\n'),
  ].join('\n\n');
}

function describeFailure({ title, detail }: PostMergeFailure): string {
  return `${inlineCode(title)}\n\n${quote(detail)}`;
}

function describeFailures({ failures, baseBranch }: PostMergeRedFacts): string {
  const listed = failures.slice(0, MAX_LISTED_FAILURES).map(describeFailure);
  const more = failures.length - listed.length;
  const rest = more > 0 ? [`… and ${more} more; the full output is in the merge run’s ${inlineCode(MERGE_LOG_FILE)}`] : [];
  return [`What failed on the branch merged with ${inlineCode(baseBranch)}:`, ...listed, ...rest].join('\n\n');
}

export function describePostMergeRed(facts: PostMergeRedFacts): string {
  return [describeOutcome(facts), describeMergedCommits(facts), describeConflicts(facts), describeFailures(facts)].join('\n\n');
}
