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
  /** Whether the tag's scenarios passed (exit code 0). False when skipped. */
  passed: boolean;
  /** Stdout from the scenario run (truncated if over 10,000 chars). */
  output: string;
  /** Process exit code. */
  exitCode: number | null;
  /** True when the tag is optional and no matching scenarios were found. */
  skipped: boolean;
  /**
   * Optional explanation when scenario outcome and process exit code disagree —
   * e.g. cucumber tally was clean (0 failed, 0 undefined) but the subprocess
   * exited non-zero due to post-suite noise (KPI/D1 write failures, unhandled
   * rejections in shutdown hooks). Rendered in the proof markdown so reviewers
   * see why a non-zero exit was overridden to PASS.
   */
  warning?: string;
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

/** Cucumber-js scenario tally extracted from a `--format summary` output line. */
interface CucumberTally {
  failed: number;
  undefinedSteps: number;
  pending: number;
  passed: number;
}

/**
 * Parses the cucumber-js scenarios summary line — e.g. `1646 scenarios (41 pending, 1605 passed)`.
 * Cucumber emits one such line per run. Only non-zero counts appear in the breakdown, so missing
 * categories default to 0. Returns null when no summary line is present (means cucumber crashed
 * before emitting one and the exit code is the only signal available).
 */
function parseCucumberSummary(stdout: string): CucumberTally | null {
  const matches = [...stdout.matchAll(/^\s*\d+ scenarios? \(([^)]+)\)\s*$/gm)];
  if (matches.length === 0) return null;
  const breakdown = matches[matches.length - 1][1];
  const numFor = (label: string): number => {
    const m = breakdown.match(new RegExp(`(\\d+) ${label}\\b`));
    return m ? Number(m[1]) : 0;
  };
  return {
    failed: numFor('failed'),
    undefinedSteps: numFor('undefined'),
    pending: numFor('pending'),
    passed: numFor('passed'),
  };
}

/** Returns true when the scenario output indicates zero matching scenarios were found. */
function isNoScenariosOutput(stdout: string): boolean {
  return stdout.trim().length === 0 || /\b0 scenarios\b/i.test(stdout);
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
 */
export async function runScenarioProof(options: {
  scenariosMd: string;
  reviewProofConfig: ReviewProofConfig;
  runByTagCommand: string;
  issueNumber: number;
  proofDir: string;
  cwd?: string;
}): Promise<ScenarioProofResult> {
  const { reviewProofConfig, runByTagCommand, issueNumber, proofDir, cwd } = options;

  // Pre-flight check: verify at least one step definition file exists
  const stepDefsDir = path.resolve(cwd ?? process.cwd(), 'features', 'step_definitions');
  const hasStepDefs = fs.existsSync(stepDefsDir) &&
    fs.readdirSync(stepDefsDir).some(f => f.endsWith('.ts'));

  if (!hasStepDefs) {
    const warningMsg = 'No step definition files found in features/step_definitions/ — skipping BDD scenario proof';
    console.log(`⚠️  ${warningMsg}`);
    fs.mkdirSync(proofDir, { recursive: true });
    const resultsFilePath = path.resolve(proofDir, 'scenario_proof.md');
    fs.writeFileSync(
      resultsFilePath,
      `# Scenario Proof\n\nGenerated at: ${new Date().toISOString()}\n\n⚠️ ${warningMsg}\n`,
      'utf-8',
    );
    return { tagResults: [], hasBlockerFailures: false, resultsFilePath };
  }

  const tagResults: TagProofResult[] = [];

  for (const entry of reviewProofConfig.tags) {
    const resolvedTag = entry.tag.replace('{issueNumber}', String(issueNumber));
    // runScenariosByTag expects the tag without the @ prefix
    const tagName = resolvedTag.startsWith('@') ? resolvedTag.slice(1) : resolvedTag;

    const result = await runScenariosByTag(runByTagCommand, tagName, cwd);

    // Cucumber can exit non-zero from post-suite noise (e.g. KPI/D1 write failures
    // logged after the summary line, unhandled rejections in shutdown hooks) even
    // when every scenario passed. Trust the cucumber summary tally over the exit
    // code when it is unambiguous: 0 failed AND 0 undefined ⇒ scenario outcome is
    // PASS regardless of exitCode. Surface a warning so reviewers see why an
    // override applied.
    const tally = parseCucumberSummary(result.stdout);
    const tallyClean = tally !== null && tally.failed === 0 && tally.undefinedSteps === 0;
    const scenarioOutcomePassed = result.allPassed || tallyClean;
    const overrideWarning =
      !result.allPassed && tallyClean
        ? `Process exited ${result.exitCode} but cucumber tally was clean ` +
          `(${tally!.passed} passed, ${tally!.pending} pending, 0 failed, 0 undefined). ` +
          `Treating as PASS — non-scenario noise (e.g. post-suite KPI/D1 writes, ` +
          `shutdown-hook rejections) is preserved verbatim in the Output section below.`
        : undefined;

    const noScenarios = scenarioOutcomePassed && isNoScenariosOutput(result.stdout);
    if (entry.optional && noScenarios) {
      tagResults.push({
        tag: entry.tag,
        resolvedTag,
        severity: entry.severity,
        optional: true,
        passed: true,
        output: '',
        exitCode: result.exitCode,
        skipped: true,
      });
    } else {
      tagResults.push({
        tag: entry.tag,
        resolvedTag,
        severity: entry.severity,
        optional: entry.optional ?? false,
        passed: scenarioOutcomePassed,
        output: truncate(result.stdout),
        exitCode: result.exitCode,
        skipped: false,
        warning: overrideWarning,
      });
    }
  }

  const hasBlockerFailures = tagResults.some(
    r => r.severity === 'blocker' && !r.passed && !r.skipped,
  );

  fs.mkdirSync(proofDir, { recursive: true });
  const resultsFilePath = path.resolve(proofDir, 'scenario_proof.md');
  fs.writeFileSync(resultsFilePath, buildProofMarkdown(tagResults), 'utf-8');

  return { tagResults, hasBlockerFailures, resultsFilePath };
}
