/**
 * PR proof publisher.
 *
 * Pure half: formatPrProofComment — composes JUnit summary + inline screenshots.
 * Impure half: publishPrProof — harvests → uploads → formats → posts.
 *
 * No side effects in the pure formatter. All I/O (fs, R2, GitHub) is in publishPrProof.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/logger';
import { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } from '../core/environment';
import { uploadToR2 } from '../r2/uploadService';
import { ADW_SIGNATURE } from '../core/workflowCommentParsing';
import { harvestProofArtifacts } from './proofArtifactHarvester';
import type { ProofCommentInput, PublishDeps, TagProofResultLike, UploadedArtifact } from './types';

// ── Content-type helper ───────────────────────────────────────────────────────

const CONTENT_TYPE_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function contentTypeForExt(ext: string): string {
  return CONTENT_TYPE_MAP[ext.toLowerCase()] ?? 'image/png';
}

function leadingSegment(relPath: string): string {
  const parts = relPath.split('/');
  return parts.length > 1 ? parts[0] : 'Screenshots';
}

// ── Pure formatter helpers ────────────────────────────────────────────────────

function formatImageEmbed(fileName: string, url: string): string {
  return `[![${fileName}](${url})](${url})\n${url}`;
}

function formatScenarioGroup(scenario: string, artifacts: UploadedArtifact[]): string {
  const embeds = artifacts.map(a => formatImageEmbed(a.fileName, a.url)).join('\n\n');
  return `<details>\n<summary>${scenario} (${artifacts.length})</summary>\n\n${embeds}\n\n</details>`;
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

// ── Pure formatter ────────────────────────────────────────────────────────────

/**
 * Composes a PR proof comment from JUnit summary data and uploaded screenshot URLs.
 *
 * Pure — no I/O, no footer. Caller appends ADW_SIGNATURE.
 */
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

// ── Impure publisher ──────────────────────────────────────────────────────────

function isR2Configured(): boolean {
  return Boolean(CLOUDFLARE_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

/**
 * Harvests proof artifacts, uploads them to R2, composes the proof comment,
 * and posts it to the PR. Non-fatal — any error is caught and logged.
 */
export async function publishPrProof(deps: PublishDeps): Promise<void> {
  const {
    artifactsDir,
    scenarioProof,
    prNumber,
    repoInfo,
    adwId,
    uploader = uploadToR2,
    commenter,
  } = deps;

  if (prNumber <= 0) {
    log('publishPrProof: prNumber <= 0 — skipping proof comment', 'info');
    return;
  }
  if (!artifactsDir || !scenarioProof) {
    log('publishPrProof: missing artifactsDir or scenarioProof — skipping proof comment', 'info');
    return;
  }

  try {
    const artifacts = harvestProofArtifacts(artifactsDir);
    const r2Configured = isR2Configured();
    const uploaded: UploadedArtifact[] = [];

    if (r2Configured && artifacts.length > 0) {
      const { owner, repo } = repoInfo;
      for (const artifact of artifacts) {
        try {
          const ext = path.extname(artifact.absPath);
          const key = `proof/${adwId}/${artifact.relPath}`;
          const body = fs.readFileSync(artifact.absPath);
          const result = await uploader({ owner, repo, key, body, contentType: contentTypeForExt(ext) });
          uploaded.push({
            scenario: leadingSegment(artifact.relPath),
            url: result.url,
            fileName: path.basename(artifact.relPath),
          });
        } catch (err) {
          log(`publishPrProof: failed to upload ${artifact.relPath} — ${err}`, 'warn');
        }
      }
    }

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
