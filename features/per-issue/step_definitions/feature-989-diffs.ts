/**
 * Unified diffs of the kinds the feature-989 guard scenarios describe, written the way
 * `git diff --no-renames` prints them. Their content lines are ordinary code, so only what a
 * scenario says a round adds can make the fix-round guard reject one.
 */

import assert from 'assert';

function header(file: string): string {
  return `diff --git a/${file} b/${file}`;
}

/** A modified file: one ordinary line becomes another, and `addedLine` comes in after it. */
export function addedLineDiff(file: string, addedLine: string): string {
  return [header(file), `--- a/${file}`, `+++ b/${file}`, '@@ -1,2 +1,3 @@', ' export const kept = 1;', ' export const alsoKept = 2;', `+${addedLine}`].join('\n');
}

export function editedFileDiff(file: string): string {
  return [header(file), `--- a/${file}`, `+++ b/${file}`, '@@ -1,2 +1,2 @@', ' kept', '-before', '+after'].join('\n');
}

export function createdFileDiff(file: string): string {
  return [header(file), 'new file mode 100644', '--- /dev/null', `+++ b/${file}`, '@@ -0,0 +1 @@', '+created'].join('\n');
}

export function deletedFileDiff(file: string): string {
  return [header(file), 'deleted file mode 100644', `--- a/${file}`, '+++ /dev/null', '@@ -1 +0,0 @@', '-deleted'].join('\n');
}

const ADDS_A_LINE = /^adds the line "(.*)"$/;

/** The wording of a "change" cell of a table of changes: the one place the scenarios' phrases are read. */
export function diffForChange(file: string, change: string): string {
  const added = ADDS_A_LINE.exec(change);
  if (added) return addedLineDiff(file, added[1]);
  if (change === 'edits the file') return editedFileDiff(file);
  if (change === 'creates the file') return createdFileDiff(file);
  if (change === 'deletes the file') return deletedFileDiff(file);
  return assert.fail(`Unrecognised wording for a change to ${file}: ${change}`);
}
