import { spawn } from 'child_process';

export interface BddScenarioResult {
  allPassed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * @param tagCommand - The run-by-tag command template (e.g. `cucumber-js --tags "@{tag}"`),
 *   or a full command without `{tag}` placeholder (e.g. `cucumber-js --tags "@regression"`).
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
