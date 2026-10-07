/**
 * Pure half: formatPrProofComment — composes JUnit summary + inline screenshots.
 * Impure half: publishPrProof — uploads the images the scenario proof selected through uploadProofArtifacts, then formats and posts.
 *
 * No side effects in the pure formatter. The only I/O here is the GitHub comment; fs and R2 are in proofUploader.
 */

import { log } from '../core/logger';
import { ADW_SIGNATURE } from '../core/workflowCommentParsing';
import { isProofUploadConfigured, uploadProofArtifacts } from './proofUploader';
import type { ProofCommentInput, PublishDeps, TagProofResultLike, UploadedArtifact } from './types';

function formatImageEmbed(fileName: string, url: string): string {
  return `[![${fileName}](${url})](${url})\n${url}`;
}

// Scenario names are written by people, and the summary is HTML.
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatScenarioGroup(scenario: string, artifacts: UploadedArtifact[]): string {
  const embeds = artifacts.map(a => formatImageEmbed(a.fileName, a.url)).join('\n\n');
  return `<details>\n<summary>${escapeHtml(scenario)} (${artifacts.length})</summary>\n\n${embeds}\n\n</details>`;
}

function tagStatusEmoji(result: TagProofResultLike): string {
  if (result.skipped) return '⏭️ skipped';
  return result.passed ? '✅ passed' : '❌ failed';
}

function formatSummaryTable(tagResults: readonly TagProofResultLike[]): string {
  const rows = tagResults.map(r => {
    const scenarios = r.skipped || !r.counts
      ? '-'
      : `${r.counts.passed}/${r.counts.total}`;
    const status = tagStatusEmoji(r);
    return `| \`${r.resolvedTag}\` | ${scenarios} | ${status} | ${r.severity} |`;
  });
  return [
    '| Suite | Scenarios | Status | Severity |',
    '|-------|-----------|--------|----------|',
    ...rows,
  ].join('\n');
}

function computeTotals(tagResults: readonly TagProofResultLike[]): { passedTotal: number; failedTotal: number } {
  let passedTotal = 0;
  let failedTotal = 0;
  for (const r of tagResults) {
    if (r.skipped || !r.counts) continue;
    passedTotal += r.counts.passed;
    failedTotal += r.counts.failed;
  }
  return { passedTotal, failedTotal };
}

function hasBlockerFailure(tagResults: readonly TagProofResultLike[]): boolean {
  return tagResults.some(r => r.severity === 'blocker' && !r.passed && !r.skipped);
}

/** Pure — no I/O, no footer. Caller appends ADW_SIGNATURE. */
export function formatPrProofComment(input: ProofCommentInput): string {
  const { tagResults, uploaded, r2Configured } = input;

  if (tagResults.length === 0) {
    return '## :camera: BDD Proof\n\nNo scenario proof available.';
  }

  const overallPassed = !hasBlockerFailure(tagResults);
  const statusLine = overallPassed ? '✅ All blocker suites passed' : '❌ One or more blocker suites failed';

  const { passedTotal, failedTotal } = computeTotals(tagResults);
  const tally = `**${passedTotal} passed, ${failedTotal} failed**`;

  const sections: string[] = [
    `## :camera: BDD Proof\n\n${statusLine}`,
    tally,
    formatSummaryTable(tagResults),
  ];

  if (uploaded.length > 0) {
    const grouped = new Map<string, UploadedArtifact[]>();
    for (const artifact of uploaded) {
      const group = grouped.get(artifact.scenario) ?? [];
      group.push(artifact);
      grouped.set(artifact.scenario, group);
    }
    for (const [scenario, artifacts] of grouped) {
      sections.push(formatScenarioGroup(scenario, artifacts));
    }
  } else if (!r2Configured) {
    sections.push('_R2 is not configured — screenshots were not uploaded._');
  }

  return sections.join('\n\n');
}

/** Non-fatal — any error is caught and logged. */
export async function publishPrProof(deps: PublishDeps): Promise<void> {
  const {
    scenarioProof,
    prNumber,
    repoInfo,
    adwId,
    uploader,
    commenter,
  } = deps;

  if (prNumber <= 0) {
    log('publishPrProof: prNumber <= 0 — skipping proof comment', 'info');
    return;
  }
  if (!scenarioProof) {
    log('publishPrProof: missing scenarioProof — skipping proof comment', 'info');
    return;
  }

  try {
    // Gated here as well as inside the uploader, so that an injected uploader is skipped when there are neither
    // credentials nor an installed uploader, and the comment then carries the "R2 is not configured" note.
    const r2Configured = isProofUploadConfigured();
    const uploaded = r2Configured
      ? await uploadProofArtifacts({ images: scenarioProof.perIssueImages, repoInfo, adwId, uploader })
      : [];

    const body = formatPrProofComment({
      tagResults: scenarioProof.tagResults,
      uploaded,
      r2Configured,
    }) + ADW_SIGNATURE;

    commenter(prNumber, body);
  } catch (err) {
    log(`publishPrProof: unexpected error — ${err}`, 'warn');
  }
}
