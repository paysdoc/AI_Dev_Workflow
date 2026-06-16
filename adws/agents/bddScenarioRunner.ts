/**
 * BDD scenario subprocess executor.
 *
 * Runs tag-filtered scenario commands as a subprocess, captures output,
 * and returns a structured result.
 * Analogous to testDiscovery.ts for Playwright.
 */

import { spawn } from 'child_process';

/**
 * Result from running BDD scenarios via subprocess.
 */
export interface BddScenarioResult {
  /** Whether all scenarios passed (exit code 0) */
  allPassed: boolean;
  /** Raw stdout from the scenario process */
  stdout: string;
  /** Raw stderr from the scenario process */
  stderr: string;
  /** Process exit code */
  exitCode: number | null;
}

/**
 * Runs BDD scenarios filtered by an arbitrary tag as a subprocess.
 *
 * - If `tagCommand` is `'N/A'` or empty, returns a passing result immediately
 *   (no scenarios configured — skip gracefully).
 * - Replaces `{tag}` in the command template with the actual tag value.
 * - Returns `allPassed: true` when the process exits with code 0.
 *
 * @param tagCommand - The run-by-tag command template (e.g. `cucumber-js --tags "@{tag}"`),
 *   or a full command without `{tag}` placeholder (e.g. `cucumber-js --tags "@regression"`).
 * @param tag - The tag value to substitute for `{tag}` (e.g. `regression`, `adw-168`).
 * @param cwd - Optional working directory (defaults to `process.cwd()`).
 * @param env - Optional additional environment variables merged into the subprocess env.
 *   Use to pass ADW_JUNIT_REPORT_PATH for the JUnit report rail.
 */
export function runScenariosByTag(
  tagCommand: string,
  tag: string,
  cwd?: string,
  env?: Record<string, string>,
): Promise<BddScenarioResult> {
  if (!tagCommand || tagCommand.trim() === 'N/A') {
    return Promise.resolve({ allPassed: true, stdout: '', stderr: '', exitCode: 0 });
  }

  const resolvedCommand = tagCommand.replace(/\{tag\}/g, tag);
  const workDir = cwd ?? process.cwd();

  return new Promise((resolve) => {
    const proc = spawn(resolvedCommand, [], {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: env ? { ...process.env, ...env } : process.env,
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
      resolve({
        allPassed: exitCode === 0,
        stdout,
        stderr,
        exitCode,
      });
    });
  });
}
