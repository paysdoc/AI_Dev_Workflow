/** What the feature-989 steps read from a park comment, whether the builder made it or a workflow posted it. */

import assert from 'assert';

import { isHeaded } from './feature-929-comments.ts';
import { commentsOn } from './feature-929-workflow.ts';

const PARK_HEADING = 'ADW Parked';

/** The park comments the recording tracker received on one issue, oldest first. */
export function parkCommentsOn(issueNumber: number): string[] {
  return commentsOn(issueNumber).filter(body => isHeaded(body, PARK_HEADING));
}

export function requireParkCommentOn(issueNumber: number): string {
  const comments = commentsOn(issueNumber);
  const parks = parkCommentsOn(issueNumber);
  assert.ok(parks.length > 0, `Expected a park comment on issue ${issueNumber}, got ${comments.length} comment(s):\n${comments.join('\n---\n')}`);
  return parks[parks.length - 1];
}

/** The text after "- `<directive>` — ": how the comment explains what a directive does. */
export function directiveMeaning(comment: string, directive: string): string {
  const prefix = `- \`${directive}\` — `;
  const line = comment.split('\n').find(candidate => candidate.startsWith(prefix));
  assert.ok(line, `Expected the park comment to explain ${directive} in a line that starts with ${prefix}, got:\n${comment}`);
  return line.slice(prefix.length);
}

export function assertDirectiveSays(comment: string, directive: string, phrase: string): void {
  const meaning = directiveMeaning(comment, directive);
  assert.ok(meaning.includes(phrase), `Expected the park comment to say that ${directive} ${phrase}, but it says that ${directive} ${meaning}`);
}
