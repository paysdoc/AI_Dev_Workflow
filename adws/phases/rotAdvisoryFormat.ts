/**
 * Pure formatter for the promotion rot/reuse advisory PR comment.
 * No I/O — same input always produces the same string.
 */

import type { RotVerdict } from '../agents/rotAnalysisAgent';

const HEADER = '## Promotion Rot/Reuse Advisory';
const ADVISORY_NOTE =
  '_Advisory only — this analysis never blocks or gates this promotion. The merge decision stays with the reviewer._';

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatRow(verdict: RotVerdict): string {
  const step = escapeCell(`${verdict.keyword} ${verdict.step}`);
  const reuse = escapeCell(verdict.reuse);
  const note = escapeCell(verdict.note);
  return `| \`${step}\` | ${reuse} | ${verdict.rot} | ${note} |`;
}

/**
 * Formats the single advisory PR comment body: a header marking the analysis
 * advisory/non-blocking, plus a per-step reuse/rot verdict table for the
 * promoted scenario's Given/When/Then phrases.
 */
export function formatRotAdvisoryComment(feature: string, verdicts: readonly RotVerdict[]): string {
  const lines = [
    HEADER,
    '',
    ADVISORY_NOTE,
    '',
  ];

  if (verdicts.length === 0) {
    lines.push(`No phrases were analysed for the promoted \`${feature}\` scenario.`);
    return lines.join('\n');
  }

  lines.push(`Per-phrase reuse and rot verdicts for the promoted \`${feature}\` scenario's Given/When/Then steps:`);
  lines.push('');
  lines.push('| Step (G/W/T) | Reuse | Rot | Note |');
  lines.push('|---|---|---|---|');
  for (const verdict of verdicts) {
    lines.push(formatRow(verdict));
  }

  return lines.join('\n');
}
