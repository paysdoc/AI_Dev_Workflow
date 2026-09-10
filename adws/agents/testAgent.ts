/**
 * Test Agent - Runs test commands and resolves failures.
 * Uses slash commands from .claude/commands/ for consistent prompt templates.
 */

import * as path from 'path';
import { getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult, AgentLaunchContext } from './claudeAgent';
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import { extractJsonArray } from '../core/jsonParser';
import type { TestCaseResult } from '../core/testReportParser';

export interface E2ETestResult {
  testName: string;
  status: 'passed' | 'failed';
  error: string | null;
  testPath?: string;
}

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
  testcase_count?: number;
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
  /** Testcase count from the application tests entry (app_tests), or 0 when absent */
  applicationTestcaseCount: number;
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
      testcase_count: { type: 'number' },
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
 * Builds a `TestResult` resolver payload from a failing `TestCaseResult`.
 * Used by `testRetry.ts` to feed `runResolveTestAgent` with structured failure info.
 */
export function testResultFromCase(c: TestCaseResult, runCommand: string): TestResult {
  return {
    test_name: c.name,
    passed: false,
    execution_command: runCommand,
    test_purpose: c.classname ?? 'unit test',
    error: c.failureMessage,
  };
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
  launchContext?: AgentLaunchContext,
): Promise<TestAgentResult> {
  const result = await runCommandAgent(testAgentConfig, {
    args: '',
    logsDir,
    issueBody,
    statePath,
    cwd,
    launchContext,
  });

  const testResults = result.parsed;
  const failedTests = testResults.filter(t => !t.passed);
  const allPassed = testResults.length > 0 && failedTests.length === 0;
  const appTestsEntry = testResults.find(t => t.test_name === 'app_tests');
  const applicationTestcaseCount = appTestsEntry?.testcase_count ?? 0;

  return {
    ...result,
    testResults,
    allPassed,
    failedTests,
    applicationTestcaseCount,
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
  launchContext?: AgentLaunchContext,
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
    cwd,
    undefined,
    undefined,
    undefined,
    launchContext,
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
  launchContext?: AgentLaunchContext,
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
    cwd,
    undefined,
    undefined,
    undefined,
    launchContext,
  );
}
