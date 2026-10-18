/**
 * Pure. Renders `scenario_proof.md`, which the reviewer reads; the fixed lines are exported so that
 * whatever reads the proof quotes them instead of retyping them.
 */

import type { Platform } from '../core/applicationType';
import type { PerIssueImage, ScenarioPlatformCoverage, TagProofResult } from './types';

export const NO_PER_ISSUE_SCENARIOS = 'no per-issue scenarios';
export const NO_SCENARIO_OPENED_A_PAGE = 'no scenario opened a page';
export const NO_SCENARIO_OPENED_A_SCREEN = 'no scenario opened a screen';

const SOME_PLATFORMS_ONLY = 'On some platforms only';

/** What a profile with platforms adds to the Evidence section. */
export interface PlatformEvidence {
  /** The profile's platforms, in its order. */
  readonly expected: readonly Platform[];
  /** One entry per per-issue scenario with a selected image. */
  readonly coverage: readonly ScenarioPlatformCoverage[];
  /** Paths, relative to the harvest root, of the issue's images that lie in no platform directory. */
  readonly outside: readonly string[];
}

export interface ProofEvidence {
  readonly images: readonly PerIssueImage[];
  /** Names of test cases that attached an image but match no scenario of the feature files. */
  readonly unattributed: readonly string[];
  /** Null where the application profile has no platforms. */
  readonly platforms: PlatformEvidence | null;
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

function noImageLine(platforms: PlatformEvidence | null): string {
  return platforms ? NO_SCENARIO_OPENED_A_SCREEN : NO_SCENARIO_OPENED_A_PAGE;
}

function imageLines(images: readonly PerIssueImage[], platforms: PlatformEvidence | null): string[] {
  if (images.length === 0) return [noImageLine(platforms)];
  return images.map(image => `- \`${image.scenario}\`: ${image.absPath}`);
}

function partialCoverageLine({ scenario, present, missing }: ScenarioPlatformCoverage): string {
  return `${SOME_PLATFORMS_ONLY}: \`${scenario}\` (present: ${present.join(', ')}; missing: ${missing.join(', ')})`;
}

// A scenario with no image is not listed: the no-image line and the reviewer's reading of the diff cover it.
function partialCoverageLines(platforms: PlatformEvidence | null): string[] {
  const partial = platforms?.coverage.filter(({ present, missing }) => present.length > 0 && missing.length > 0) ?? [];
  return partial.length === 0 ? [] : ['', ...partial.map(partialCoverageLine)];
}

function outsideLines(platforms: PlatformEvidence | null): string[] {
  if (!platforms || platforms.outside.length === 0) return [];
  const directories = platforms.expected.map(platform => `\`${platform}/\``).join(', ');
  const paths = platforms.outside.map(relPath => `\`${relPath}\``).join(', ');
  return ['', `Left out as unattributed, because they are in no platform directory (${directories}): ${paths}`];
}

function evidenceSection({ images, unattributed, platforms }: ProofEvidence): string[] {
  return [
    '## Evidence',
    '',
    `Per-issue scenario images (${images.length}):`,
    '',
    ...imageLines(images, platforms),
    ...partialCoverageLines(platforms),
    ...leftOutLines(unattributed),
    ...outsideLines(platforms),
    '',
  ];
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
