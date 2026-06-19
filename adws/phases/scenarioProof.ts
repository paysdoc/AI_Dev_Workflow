/**
 * Scenario proof orchestrator.
 *
 * Iterates over config-driven tag entries from ReviewProofConfig, runs each tag
 * via the tag-based scenario runner, writes combined results to a proof markdown
 * file, and returns a structured outcome for the review retry loop.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runScenariosByTag } from '../agents/bddScenarioRunner';
import type { ReviewProofConfig } from '../core/projectConfig';
import { readJUnitReport, hasStepDefinitions } from '../core';
import type { TestReport, TestCaseResult } from '../core';
import type { BddScenarioResult } from '../agents/bddScenarioRunner';

/** Maximum characters of scenario output retained in the proof file. */
const MAX_OUTPUT_LENGTH = 10_000;

/**
 * Per-tag result from running BDD scenario proof.
 */
export interface TagProofResult {
  /** Original tag pattern from config, e.g. `@review-proof`, `@adw-{issueNumber}`. */
  tag: string;
  /** Tag after `{issueNumber}` substitution, e.g. `@adw-273`. */
  resolvedTag: string;
  severity: 'blocker' | 'tech-debt';
  optional: boolean;
  /** Whether the tag's scenarios passed. False when skipped. */
  passed: boolean;
  /** Stdout from the scenario run (truncated if over 10,000 chars). */
  output: string;
  /** Process exit code. */
  exitCode: number | null;
  /** True when the tag is optional and no matching scenarios were found. */
  skipped: boolean;
  /**
   * Optional explanation when scenario outcome and process exit code disagree —
   * e.g. JUnit report is clean but the subprocess exited non-zero due to
   * post-suite noise (D1 write failures, unhandled rejections in shutdown hooks).
   */
  warning?: string;
  /** Structured tally from the JUnit report (when report was present and parsed). */
  counts?: { total: number; passed: number; failed: number };
  /** Per-case results from the JUnit report (when report was present and parsed). */
  cases?: TestCaseResult[];
}

/**
 * Structured result from running the config-driven scenario proof.
 */
export interface ScenarioProofResult {
  tagResults: TagProofResult[];
  /** True when any non-skipped tag with severity `blocker` did not pass. */
  hasBlockerFailures: boolean;
  /** Absolute path to the written scenario proof markdown file. */
  resultsFilePath: string;
  /** Absolute path to the directory where BDD screenshot artifacts are written (ADW_PROOF_DIR). */
  artifactsDir: string;
}

/**
 * Returns true when scenario proof should be run.
 * Returns false when .adw/scenarios.md content is absent or empty — callers
 * should fall back to code-diff proof behaviour in that case.
 */
export function shouldRunScenarioProof(scenariosMd: string): boolean {
  return scenariosMd.trim().length > 0;
}

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output;
  return `${output.slice(0, MAX_OUTPUT_LENGTH)}\n\n[...output truncated at ${MAX_OUTPUT_LENGTH} characters...]`;
}

/** Returns true when the scenario output indicates zero matching scenarios were found. */
function isNoScenariosOutput(stdout: string): boolean {
  return stdout.trim().length === 0 || /\b0 scenarios\b/i.test(stdout);
}

/** Sanitize a tag name for use as a filename component. */
function sanitizeTagName(tagName: string): string {
  return tagName.replace(/[^A-Za-z0-9_-]/g, '-');
}

interface TagOutcome {
  passed: boolean;
  skipped: boolean;
  warning?: string;
  counts?: { total: number; passed: number; failed: number };
  cases?: TestCaseResult[];
}

function deriveTagOutcome(
  report: TestReport | null,
  result: BddScenarioResult,
  optional: boolean,
): TagOutcome {
  if (report !== null) {
    if (report.total > 0) {
      const passed = report.failed === 0;
      let warning: string | undefined;
      if (!result.allPassed && passed) {
        warning =
          `Process exited ${result.exitCode} but JUnit report is clean: ` +
          `${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped of ${report.total}. ` +
          `Treating as PASS — pending/undefined scenarios and post-suite noise (e.g. D1 writes, ` +
          `shutdown-hook rejections) are preserved verbatim in the Output section below.`;
      }
      return {
        passed,
        skipped: false,
        warning,
        counts: { total: report.total, passed: report.passed, failed: report.failed },
        cases: report.cases,
      };
    }

    // report.total === 0: zero-testcase case
    if (optional) {
      return { passed: true, skipped: true };
    }
    return { passed: false, skipped: false };
  }

  // Report absent — fall back to process exit code; no stdout regex
  const passed = result.allPassed;
  if (optional && isNoScenariosOutput(result.stdout)) {
    return { passed: true, skipped: true };
  }
  return { passed, skipped: false };
}

function buildProofMarkdown(tagResults: readonly TagProofResult[]): string {
  const lines: string[] = [
    '# Scenario Proof',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
  ];

  for (const result of tagResults) {
    const statusLabel = result.skipped
      ? '⏭️ SKIPPED (no matching scenarios)'
      : result.passed
        ? '✅ PASSED'
        : '❌ FAILED';

    lines.push(
      `## ${result.resolvedTag} Scenarios (severity: ${result.severity})`,
      '',
      `**Status:** ${statusLabel}`,
      `**Exit Code:** ${result.exitCode ?? 'null'}`,
    );
    if (result.warning) {
      lines.push(`**Warning:** ${result.warning}`);
    }
    if (result.counts) {
      lines.push(`**Report:** ${result.counts.passed} passed, ${result.counts.failed} failed of ${result.counts.total}`);
    }
    lines.push(
      '',
      '### Output',
      '',
      '```',
      result.skipped ? '(skipped — no matching scenarios)' : (result.output || '(no output)'),
      '```',
      '',
    );
  }

  return lines.join('\n');
}

/**
 * Iterates over `reviewProofConfig.tags`, runs each via `runScenariosByTag`,
 * writes combined results to `scenario_proof.md`, and returns a structured result.
 *
 * @param options.scenariosMd - Raw content of .adw/scenarios.md (used for guard check only).
 * @param options.reviewProofConfig - Parsed review proof config with tags and severities.
 * @param options.runByTagCommand - Command template with `{tag}` placeholder.
 * @param options.issueNumber - Current issue number for `{issueNumber}` substitution in tag patterns.
 * @param options.proofDir - Directory in which to write `scenario_proof.md`.
 * @param options.cwd - Optional working directory for scenario subprocesses.
 * @param options.stepDefDirectory - Directory to scan for step definition files.
 * @param options.stepDefExtensions - File extensions to match for step definitions.
 */
export async function runScenarioProof(options: {
  scenariosMd: string;
  reviewProofConfig: ReviewProofConfig;
  runByTagCommand: string;
  issueNumber: number;
  proofDir: string;
  cwd?: string;
  stepDefDirectory?: string;
  stepDefExtensions?: string[];
}): Promise<ScenarioProofResult> {
  const {
    reviewProofConfig,
    runByTagCommand,
    issueNumber,
    proofDir,
    cwd,
    stepDefDirectory = 'features/step_definitions',
    stepDefExtensions = ['.ts'],
  } = options;

  const effectiveCwd = cwd ?? process.cwd();

  // Pre-flight check: verify at least one step definition file exists
  const hasStepDefs = hasStepDefinitions(stepDefDirectory, stepDefExtensions, effectiveCwd);

  const artifactsDir = path.resolve(proofDir, 'artifacts');

  if (!hasStepDefs) {
    const warningMsg = `No step definition files found in ${stepDefDirectory}/ — skipping BDD scenario proof`;
    console.log(`⚠️  ${warningMsg}`);
    fs.mkdirSync(proofDir, { recursive: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
    fs.mkdirSync(artifactsDir, { recursive: true });
    const resultsFilePath = path.resolve(proofDir, 'scenario_proof.md');
    fs.writeFileSync(
      resultsFilePath,
      `# Scenario Proof\n\nGenerated at: ${new Date().toISOString()}\n\n⚠️ ${warningMsg}\n`,
      'utf-8',
    );
    return { tagResults: [], hasBlockerFailures: false, resultsFilePath, artifactsDir };
  }

  fs.mkdirSync(proofDir, { recursive: true });
  fs.rmSync(artifactsDir, { recursive: true, force: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  const tagResults: TagProofResult[] = [];

  for (const entry of reviewProofConfig.tags) {
    const resolvedTag = entry.tag.replace('{issueNumber}', String(issueNumber));
    const tagName = resolvedTag.startsWith('@') ? resolvedTag.slice(1) : resolvedTag;
    const safeTagName = sanitizeTagName(tagName);
    const reportPath = path.resolve(proofDir, `junit-${safeTagName}.xml`);

    // Remove any stale report from a prior run
    fs.rmSync(reportPath, { force: true });

    const result = await runScenariosByTag(runByTagCommand, tagName, cwd, {
      ADW_JUNIT_REPORT_PATH: reportPath,
      ADW_PROOF_DIR: artifactsDir,
    });

    const report = readJUnitReport(reportPath);
    const outcome = deriveTagOutcome(report, result, entry.optional ?? false);

    tagResults.push({
      tag: entry.tag,
      resolvedTag,
      severity: entry.severity,
      optional: entry.optional ?? false,
      passed: outcome.passed,
      output: outcome.skipped ? '' : truncate(result.stdout),
      exitCode: result.exitCode,
      skipped: outcome.skipped,
      warning: outcome.warning,
      counts: outcome.counts,
      cases: outcome.cases,
    });
  }

  const hasBlockerFailures = tagResults.some(
    r => r.severity === 'blocker' && !r.passed && !r.skipped,
  );

  const resultsFilePath = path.resolve(proofDir, 'scenario_proof.md');
  fs.writeFileSync(resultsFilePath, buildProofMarkdown(tagResults), 'utf-8');

  return { tagResults, hasBlockerFailures, resultsFilePath, artifactsDir };
}
