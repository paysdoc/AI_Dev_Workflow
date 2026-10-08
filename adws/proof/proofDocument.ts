/**
 * Pure. Renders `scenario_proof.md`, which the reviewer reads; the two fixed lines are exported so that
 * whatever reads the proof quotes them instead of retyping them.
 */

import type { PerIssueImage, TagProofResult } from './types';

export const NO_PER_ISSUE_SCENARIOS = 'no per-issue scenarios';
export const NO_SCENARIO_OPENED_A_PAGE = 'no scenario opened a page';

export interface ProofEvidence {
  readonly images: readonly PerIssueImage[];
  /** Names of test cases that attached an image but match no scenario of the feature files. */
  readonly unattributed: readonly string[];
}

export interface ProofDocumentInput {
  readonly generatedAt: string;
  readonly notice?: string;
  readonly tagResults: readonly TagProofResult[];
  /** Null where the application profile expects no images: the document then has no Evidence section. */
  readonly evidence: ProofEvidence | null;
}

function statusLabel(result: TagProofResult): string {
  if (result.skipped) return `⏭️ ${NO_PER_ISSUE_SCENARIOS}`;
  return result.passed ? '✅ PASSED' : '❌ FAILED';
}

// A tag that was not run has no exit code, no report and no output to show.
function statusLines(result: TagProofResult): string[] {
  const lines = [`**Status:** ${statusLabel(result)}`];
  if (result.skipped) return lines;
  lines.push(`**Exit Code:** ${result.exitCode ?? 'null'}`);
  if (result.warning) lines.push(`**Warning:** ${result.warning}`);
  if (result.counts) lines.push(`**Report:** ${result.counts.passed} passed, ${result.counts.failed} failed of ${result.counts.total}`);
  return lines;
}

function outputLines(result: TagProofResult): string[] {
  if (result.skipped) return [];
  return ['', '### Output', '', '```', result.output || '(no output)', '```'];
}

function tagSection(result: TagProofResult): string[] {
  return [`## ${result.resolvedTag} Scenarios (severity: ${result.severity})`, '', ...statusLines(result), ...outputLines(result), ''];
}

function leftOutLines(unattributed: readonly string[]): string[] {
  if (unattributed.length === 0) return [];
  const names = unattributed.map(name => `\`${name}\``).join(', ');
  return ['', `Left out, because no scenario in the feature files has their name: ${names}`];
}

function evidenceSection({ images, unattributed }: ProofEvidence): string[] {
  const shown = images.length > 0 ? images.map(image => `- \`${image.scenario}\`: ${image.absPath}`) : [NO_SCENARIO_OPENED_A_PAGE];
  return ['## Evidence', '', `Per-issue scenario images (${images.length}):`, '', ...shown, ...leftOutLines(unattributed), ''];
}

export function renderProofDocument({ generatedAt, notice, tagResults, evidence }: ProofDocumentInput): string {
  return [
    '# Scenario Proof',
    '',
    `Generated at: ${generatedAt}`,
    '',
    ...(notice ? [`⚠️ ${notice}`, ''] : []),
    ...tagResults.flatMap(tagSection),
    ...(evidence ? evidenceSection(evidence) : []),
  ].join('\n');
}
