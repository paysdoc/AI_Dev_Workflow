/**
 * Test Agent - Runs test commands and resolves failures.
 * Uses slash commands from .claude/commands/ for consistent prompt templates.
 */

import * as path from 'path';
import { getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult } from './claudeAgent';
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import { extractJsonArray } from '../core/jsonParser';

// Backward-compatible re-exports from testDiscovery
export {
  discoverE2ETestFiles,
  isValidE2ETestResult,
  runPlaywrightE2ETests,
  type E2ETestResult,
  type PlaywrightE2EResult,
} from './testDiscovery';

// Re-import E2ETestResult for local use
import type { E2ETestResult } from './testDiscovery';

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

export const testResultsSchema: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    required: ['test_name', 'passed', 'execution_command', 'test_purpose'],
    properties: {
      test_name: { type: 'string' },
      passed: { type: 'boolean' },
      execution_command: { type: 'string' },
      test_purpose: { type: 'string' },
      error: { type: 'string' },
    },
  },
};

/**
 * Extracts test results from the agent output.
 * Returns a structured error if no valid JSON array is found.
 */
function extractTestResults(output: string): ExtractionResult<TestResult[]> {
  const results = extractJsonArray<TestResult>(output);
  if (results.length === 0) {
    // Check if there really is no JSON array (vs an empty array meaning no tests)
    const hasArrayMatch = /\[[\s\S]*\]/.test(output);
    if (!hasArrayMatch) {
      return {
        success: false,
        error: 'No JSON array found in test agent output',
      };
    }
  }
  return { success: true, data: results };
}

const testAgentConfig: CommandAgentConfig<TestResult[]> = {
  command: '/test',
  agentName: 'Test Runner',
  outputFileName: 'test-agent.jsonl',
  extractOutput: extractTestResults,
  outputSchema: testResultsSchema,
};

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
  const result = await runCommandAgent(testAgentConfig, {
    args: '',
    logsDir,
    issueBody,
    statePath,
    cwd,
  });

  const testResults = result.parsed;
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
export async function runResolveScenarioAgent(
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
    '/resolve_failed_scenario',
    failureJson,
    `Resolve Scenario: ${displayName}`,
    outputFile,
    getModelForCommand('/resolve_failed_scenario', issueBody),
    getEffortForCommand('/resolve_failed_scenario', issueBody),
    undefined,
    statePath,
    cwd
  );
}
