/**
 * Proof Comment Formatter — pure functions that transform structured proof data
 * into rich markdown for GitHub issue comments.
 *
 * No side effects, no I/O. Caller is responsible for appending ADW footer.
 */

import type { ScenarioProofResult, TagProofResult } from '../agents/regressionScenarioProof';
import type { ReviewIssue } from '../agents/reviewAgent';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VerificationResult {
  name: string;
  passed: boolean;
  command?: string;
}

export interface ProofCommentInput {
  /** Overall review outcome. */
  passed: boolean;
  /** Summary text from review agents. */
  reviewSummary?: string;
  /** Scenario proof results — optional for backward compatibility. */
  scenarioProof?: ScenarioProofResult;
  /** Blocker issues (prevent merge). */
  blockerIssues: ReviewIssue[];
  /** Non-blocker issues (tech-debt, skippable). */
  nonBlockerIssues: ReviewIssue[];
  /** Type-check / lint results — optional placeholder for future wiring. */
  verificationResults?: VerificationResult[];
  /** All review agent summaries. */
  allSummaries?: string[];
  /** Screenshot URLs — placeholder for future wiring. */
  screenshotUrls?: string[];
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parses scenario count summary from cucumber output.
 * Returns "passed/total" (e.g. "5/5") or "-" when not parseable.
 */
function parseScenarioCounts(output: string): string {
  const match = output.match(/(\d+)\s+scenarios?\s*\(([^)]+)\)/i);
  if (!match) return '-';
  const total = match[1];
  const passedMatch = match[2].match(/(\d+)\s+passed/);
  const passed = passedMatch ? passedMatch[1] : total;
  return `${passed}/${total}`;
}

function tagStatusEmoji(result: TagProofResult): string {
  if (result.skipped) return '⏭️ skipped';
  return result.passed ? '✅ passed' : '❌ failed';
}

function formatReviewIssueItem(issue: ReviewIssue): string {
  return `- **#${issue.reviewIssueNumber}** [${issue.issueSeverity}]: ${issue.issueDescription}`;
}

// ── Section formatters ───────────────────────────────────────────────────────

/** Renders a markdown proof table for all tag results. */
export function formatProofTable(tagResults: TagProofResult[]): string {
  const rows = tagResults.map(r => {
    const counts = r.skipped ? '-' : parseScenarioCounts(r.output);
    const status = tagStatusEmoji(r);
    return `| \`${r.resolvedTag}\` | ${counts} | ${status} | ${r.severity} |`;
  });
  return [
    '| Suite | Scenarios | Status | Severity |',
    '|-------|-----------|--------|----------|',
    ...rows,
  ].join('\n');
}

/** Renders a verification section showing supplementary check results. */
export function formatVerificationSection(results: VerificationResult[]): string {
  const rows = results.map(r => {
    const status = r.passed ? '✅ passed' : '❌ failed';
    const cmd = r.command ? `\`${r.command}\`` : '-';
    return `| ${r.name} | ${status} | ${cmd} |`;
  });
  return [
    '**Verification**',
    '',
    '| Check | Status | Command |',
    '|-------|--------|---------|',
    ...rows,
  ].join('\n');
}

/** Renders non-blocker issues in a collapsible `<details>` section. */
export function formatNonBlockerSection(issues: ReviewIssue[]): string {
  const items = issues.map(formatReviewIssueItem).join('\n');
  return `<details>\n<summary>Non-blocker issues (${issues.length})</summary>\n\n${items}\n\n</details>`;
}

/** Renders blocker issues in a collapsible `<details>` section. */
export function formatBlockerSection(issues: ReviewIssue[]): string {
  const items = issues.map(formatReviewIssueItem).join('\n');
  return `<details>\n<summary>Blocker issues (${issues.length})</summary>\n\n${items}\n\n</details>`;
}

/** Renders full per-tag scenario output in a collapsible `<details>` section. */
export function formatScenarioOutputSection(tagResults: TagProofResult[]): string {
  const withOutput = tagResults.filter(r => !r.skipped && r.output.length > 0);
  const sections = withOutput.length > 0
    ? withOutput.map(r => `### \`${r.resolvedTag}\`\n\n\`\`\`\n${r.output}\n\`\`\``).join('\n\n')
    : '(no output)';
  return `<details>\n<summary>Full scenario output</summary>\n\n${sections}\n\n</details>`;
}

// ── Main composer ────────────────────────────────────────────────────────────

/**
 * Composes all proof comment sections into a full review comment body.
 *
 * Pure function — no side effects. The caller is responsible for appending
 * any workflow footer (ADW ID, token usage, ADW_SIGNATURE).
 */
export function formatReviewProofComment(input: ProofCommentInput): string {
  const { passed, reviewSummary, scenarioProof, blockerIssues, nonBlockerIssues, verificationResults } = input;

  const statusHeader = passed
    ? '## :white_check_mark: Review Passed'
    : '## :x: Review Failed';

  const sections: string[] = [statusHeader];

  if (reviewSummary) {
    sections.push(reviewSummary);
  }

  if (scenarioProof && scenarioProof.tagResults.length > 0) {
    sections.push(formatProofTable(scenarioProof.tagResults));
  }

  if (verificationResults && verificationResults.length > 0) {
    sections.push(formatVerificationSection(verificationResults));
  }

  if (nonBlockerIssues.length > 0) {
    sections.push(formatNonBlockerSection(nonBlockerIssues));
  }

  if (!passed && blockerIssues.length > 0) {
    sections.push(formatBlockerSection(blockerIssues));
  }

  if (!passed && scenarioProof && scenarioProof.tagResults.length > 0) {
    sections.push(formatScenarioOutputSection(scenarioProof.tagResults));
  }

  return sections.join('\n\n');
}
