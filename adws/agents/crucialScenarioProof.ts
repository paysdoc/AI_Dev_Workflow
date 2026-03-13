/**
 * Crucial scenario proof orchestrator.
 *
 * Runs @crucial and @adw-{issueNumber} BDD scenarios, writes combined results
 * to a proof markdown file, and returns a structured outcome for the review retry loop.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runScenariosByTag } from './bddScenarioRunner';

/** Maximum characters of scenario output retained in the proof file. */
const MAX_OUTPUT_LENGTH = 10_000;

/**
 * Structured result from running crucial and issue-specific scenario proofs.
 */
export interface ScenarioProofResult {
  /** Whether all @crucial scenarios passed (exit code 0). */
  crucialPassed: boolean;
  /** Stdout from the @crucial run (truncated if over 10,000 chars). */
  crucialOutput: string;
  /** Exit code from the @crucial run. */
  crucialExitCode: number | null;
  /** Whether the @adw-{issueNumber} scenarios passed (exit code 0). */
  issueScenariosPassed: boolean;
  /** Stdout from the issue-specific run (truncated if over 10,000 chars). */
  issueScenarioOutput: string;
  /** Exit code from the issue-specific run. */
  issueScenarioExitCode: number | null;
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

function buildProofMarkdown(
  issueNumber: number,
  crucialOutput: string,
  crucialExitCode: number | null,
  crucialPassed: boolean,
  issueOutput: string,
  issueExitCode: number | null,
  issueScenariosPassed: boolean,
): string {
  const crucialStatus = crucialPassed ? '✅ PASSED' : '❌ FAILED';
  const issueStatus = issueScenariosPassed ? '✅ PASSED' : '❌ FAILED';

  return [
    '# Scenario Proof',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## @crucial Scenarios',
    '',
    `**Status:** ${crucialStatus}`,
    `**Exit Code:** ${crucialExitCode ?? 'null'}`,
    '',
    '### Output',
    '',
    '```',
    crucialOutput || '(no output)',
    '```',
    '',
    `## @adw-${issueNumber} Scenarios`,
    '',
    `**Status:** ${issueStatus}`,
    `**Exit Code:** ${issueExitCode ?? 'null'}`,
    '',
    '### Output',
    '',
    '```',
    issueOutput || '(no output)',
    '```',
  ].join('\n');
}

/**
 * Runs @crucial and @adw-{issueNumber} BDD scenarios, writes combined results
 * to a proof markdown file, and returns a structured ScenarioProofResult.
 *
 * @param options.scenariosMd - Raw content of .adw/scenarios.md (used for guard check only).
 * @param options.runByTagCommand - Command template with `{tag}` placeholder for issue scenarios.
 * @param options.runCrucialCommand - Command (or template) to run @crucial scenarios.
 * @param options.issueNumber - Current issue number for @adw-{issueNumber} tag filtering.
 * @param options.proofDir - Directory in which to write `scenario_proof.md`.
 * @param options.cwd - Optional working directory for scenario subprocesses.
 */
export async function runCrucialScenarioProof(options: {
  scenariosMd: string;
  runByTagCommand: string;
  runCrucialCommand: string;
  issueNumber: number;
  proofDir: string;
  cwd?: string;
}): Promise<ScenarioProofResult> {
  const { runByTagCommand, runCrucialCommand, issueNumber, proofDir, cwd } = options;

  // Run @crucial scenarios — use runCrucialCommand directly (may contain {tag} or full command)
  const crucialResult = await runScenariosByTag(runCrucialCommand, 'crucial', cwd);
  const crucialOutput = truncate(crucialResult.stdout);

  // Run @adw-{issueNumber} scenarios via the tag-based command template
  const issueTag = `adw-${issueNumber}`;
  const issueResult = await runScenariosByTag(runByTagCommand, issueTag, cwd);
  const issueOutput = truncate(issueResult.stdout);

  // Write proof file — create directory if it doesn't exist
  fs.mkdirSync(proofDir, { recursive: true });
  const resultsFilePath = path.resolve(proofDir, 'scenario_proof.md');
  const proofContent = buildProofMarkdown(
    issueNumber,
    crucialOutput,
    crucialResult.exitCode,
    crucialResult.allPassed,
    issueOutput,
    issueResult.exitCode,
    issueResult.allPassed,
  );
  fs.writeFileSync(resultsFilePath, proofContent, 'utf-8');

  return {
    crucialPassed: crucialResult.allPassed,
    crucialOutput,
    crucialExitCode: crucialResult.exitCode,
    issueScenariosPassed: issueResult.allPassed,
    issueScenarioOutput: issueOutput,
    issueScenarioExitCode: issueResult.exitCode,
    resultsFilePath,
  };
}
