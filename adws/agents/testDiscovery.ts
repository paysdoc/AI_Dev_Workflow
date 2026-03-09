/**
 * E2E test discovery and Playwright test runner.
 *
 * Provides functions to discover E2E test spec files and run Playwright
 * E2E tests as a subprocess, parsing JSON reporter output.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

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
 * Validates that an E2ETestResult has a valid testName property.
 * Returns false if testName is undefined, null, or not a string.
 */
export function isValidE2ETestResult(result: E2ETestResult | null): result is E2ETestResult & { testName: string } {
  return result !== null && typeof result.testName === 'string' && result.testName.length > 0;
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
