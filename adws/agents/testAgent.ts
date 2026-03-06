/**
 * Test Agent - Runs test commands and resolves failures.
 * Uses slash commands from .claude/commands/ for consistent prompt templates.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult } from './claudeAgent';
import { extractJsonArray } from '../core/jsonParser';

/**
 * Individual test result from the /test command.
 * Matches the JSON output structure defined in .claude/commands/test.md
 */
export interface TestResult {
  test_name: string;
  passed: boolean;
  execution_command: string;
  test_purpose: string;
  error?: string;
}

/**
 * E2E test result parsed from Playwright JSON reporter output.
 */
export interface E2ETestResult {
  testName: string;
  status: 'passed' | 'failed';
  error: string | null;
  /** The path to the spec file */
  testPath?: string;
}

/**
 * Result from running Playwright E2E tests via subprocess.
 */
export interface PlaywrightE2EResult {
  /** Whether all E2E tests passed */
  allPassed: boolean;
  /** Individual results per spec file */
  results: E2ETestResult[];
  /** Failed spec results */
  failedResults: E2ETestResult[];
  /** Raw stdout from the Playwright process */
  stdout: string;
  /** Raw stderr from the Playwright process */
  stderr: string;
  /** Process exit code */
  exitCode: number | null;
}

/**
 * Aggregated result from running the /test command.
 */
export interface TestAgentResult extends AgentResult {
  /** Parsed test results from the JSON output */
  testResults: TestResult[];
  /** Overall success status (all tests passed) */
  allPassed: boolean;
  /** Failed tests for resolution */
  failedTests: TestResult[];
}

/**
 * Validates that an E2ETestResult has a valid testName property.
 * Returns false if testName is undefined, null, or not a string.
 */
export function isValidE2ETestResult(result: E2ETestResult | null): result is E2ETestResult & { testName: string } {
  return result !== null && typeof result.testName === 'string' && result.testName.length > 0;
}

/**
 * Runs the /test command and returns parsed test results.
 * Uses 'sonnet' model for cost efficiency.
 *
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runTestAgent(
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<TestAgentResult> {
  const outputFile = path.join(logsDir, 'test-agent.jsonl');

  // Run /test command with empty args (command has no required arguments)
  const result = await runClaudeAgentWithCommand(
    '/test',
    '',
    'Test Runner',
    outputFile,
    getModelForCommand('/test', issueBody),
    getEffortForCommand('/test', issueBody),
    undefined,
    statePath,
    cwd
  );

  // Parse the test results from the output
  const testResults = extractJsonArray<TestResult>(result.output);
  const failedTests = testResults.filter(t => !t.passed);
  const allPassed = testResults.length > 0 && failedTests.length === 0;

  return {
    ...result,
    testResults,
    allPassed,
    failedTests,
  };
}

/**
 * Runs the /resolve_failed_test command with failure details.
 * Uses 'opus' model for complex reasoning.
 *
 * @param failedTest - The test result that failed
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runResolveTestAgent(
  failedTest: TestResult,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<AgentResult> {
  const outputFile = path.join(logsDir, `resolve-test-${failedTest.test_name}.jsonl`);

  // Format the failed test as JSON for the resolver
  const failureJson = JSON.stringify(failedTest, null, 2);

  return runClaudeAgentWithCommand(
    '/resolve_failed_test',
    failureJson,
    `Resolve: ${failedTest.test_name}`,
    outputFile,
    getModelForCommand('/resolve_failed_test', issueBody),
    getEffortForCommand('/resolve_failed_test', issueBody),
    undefined,
    statePath,
    cwd
  );
}

/**
 * Runs the /resolve_failed_e2e_test command with failure details.
 * Uses 'opus' model for complex reasoning.
 *
 * @param failedE2ETest - The E2E test result that failed
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 * @param applicationUrl - Optional application URL for the dev server (e.g. http://localhost:12345)
 */
export async function runResolveE2ETestAgent(
  failedE2ETest: E2ETestResult,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  applicationUrl?: string,
  issueBody?: string,
): Promise<AgentResult> {
  // Handle undefined or invalid testName gracefully
  const rawTestName = failedE2ETest.testName;
  const safeTestName = typeof rawTestName === 'string' && rawTestName.length > 0
    ? rawTestName.replace(/\s+/g, '-').toLowerCase()
    : 'unknown-test';
  const outputFile = path.join(logsDir, `resolve-e2e-${safeTestName}.jsonl`);

  // Include applicationUrl in the failure JSON so the resolver knows which URL to use
  const failurePayload = applicationUrl
    ? { ...failedE2ETest, applicationUrl }
    : failedE2ETest;
  const failureJson = JSON.stringify(failurePayload, null, 2);

  // Use fallback display name if testName is undefined
  const displayName = rawTestName ?? 'unknown';

  return runClaudeAgentWithCommand(
    '/resolve_failed_e2e_test',
    failureJson,
    `Resolve E2E: ${displayName}`,
    outputFile,
    getModelForCommand('/resolve_failed_e2e_test', issueBody),
    getEffortForCommand('/resolve_failed_e2e_test', issueBody),
    undefined,
    statePath,
    cwd
  );
}

/**
 * Discovers E2E test spec files in the e2e-tests directory.
 * Returns an array of paths to Playwright spec files.
 *
 * @param baseDir - Optional base directory (defaults to process.cwd())
 * @returns Array of absolute paths to E2E spec files
 */
export function discoverE2ETestFiles(baseDir?: string): string[] {
  const e2eTestsDir = path.join(baseDir ?? process.cwd(), 'e2e-tests');

  // Return empty array if directory doesn't exist
  if (!fs.existsSync(e2eTestsDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(e2eTestsDir);
    return files
      .filter(file => file.endsWith('.spec.ts'))
      .map(file => path.join(e2eTestsDir, file))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Playwright JSON reporter spec result shape (subset of fields we need).
 */
interface PlaywrightJsonSpec {
  title: string;
  ok: boolean;
  tests: Array<{
    title: string;
    ok: boolean;
    results: Array<{
      status: string;
      error?: { message?: string };
    }>;
  }>;
}

interface PlaywrightJsonSuite {
  title: string;
  file: string;
  specs: PlaywrightJsonSpec[];
  suites?: PlaywrightJsonSuite[];
}

interface PlaywrightJsonReport {
  suites: PlaywrightJsonSuite[];
}

/**
 * Extracts spec results from a Playwright JSON report suite (handles nested suites).
 */
function extractSpecResults(suite: PlaywrightJsonSuite): E2ETestResult[] {
  const results: E2ETestResult[] = [];
  const allSpecs = [
    ...suite.specs,
    ...(suite.suites ?? []).flatMap(s => s.specs),
  ];

  const allOk = allSpecs.every(spec => spec.ok);
  const errors = allSpecs
    .flatMap(spec => spec.tests)
    .flatMap(test => test.results)
    .filter(r => r.status === 'failed')
    .map(r => r.error?.message)
    .filter(Boolean);

  results.push({
    testName: suite.title || suite.file,
    status: allOk ? 'passed' : 'failed',
    error: errors.length > 0 ? errors.join('\n') : null,
    testPath: suite.file,
  });

  return results;
}

/**
 * Runs Playwright E2E tests as a subprocess and parses the JSON results.
 *
 * @param cwd - Optional working directory (defaults to process.cwd())
 * @param applicationUrl - Optional application URL to set as E2E_BASE_URL env var (e.g. http://localhost:12345)
 * @returns Structured results with pass/fail status per spec file
 */
export function runPlaywrightE2ETests(cwd?: string, applicationUrl?: string): Promise<PlaywrightE2EResult> {
  const workDir = cwd ?? process.cwd();
  const resultsFile = path.join(workDir, 'e2e-results.json');

  return new Promise((resolve) => {
    const env = applicationUrl
      ? { ...process.env, E2E_BASE_URL: applicationUrl }
      : process.env;

    const proc = spawn('bunx', ['playwright', 'test'], {
      cwd: workDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode) => {
      // Parse JSON results file
      const e2eResults: E2ETestResult[] = [];

      try {
        if (fs.existsSync(resultsFile)) {
          const raw = fs.readFileSync(resultsFile, 'utf-8');
          const report: PlaywrightJsonReport = JSON.parse(raw);

          for (const suite of report.suites) {
            e2eResults.push(...extractSpecResults(suite));
          }
        }
      } catch {
        // If JSON parsing fails, treat all tests as failed
        e2eResults.push({
          testName: 'Playwright E2E Tests',
          status: 'failed',
          error: `Failed to parse e2e-results.json. stdout: ${stdout.slice(0, 500)}`,
        });
      }

      const failedResults = e2eResults.filter(r => r.status === 'failed');
      const allPassed = exitCode === 0 && failedResults.length === 0;

      resolve({
        allPassed,
        results: e2eResults,
        failedResults,
        stdout,
        stderr,
        exitCode,
      });
    });
  });
}
