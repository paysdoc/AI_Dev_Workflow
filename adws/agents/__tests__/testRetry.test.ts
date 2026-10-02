import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../testAgent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../testAgent')>();
  return {
    ...actual,
    runTestAgent: vi.fn(),
    runResolveTestAgent: vi.fn(),
  };
});

import { runUnitTestsWithRetry, type TestRetryOptions } from '../testRetry';
import { runTestAgent, runResolveTestAgent, type TestAgentResult } from '../testAgent';

const PASSING_REPORT = '<testsuite tests="1"><testcase classname="S" name="ok"/></testsuite>';
const FAILING_REPORT = '<testsuite tests="1"><testcase classname="S" name="broken"><failure message="boom"/></testcase></testsuite>';

const mockRunTestAgent = vi.mocked(runTestAgent);
const mockRunResolveTestAgent = vi.mocked(runResolveTestAgent);

interface ScriptedRun {
  /** What the real test command would have written to the JUnit report path. */
  report?: string;
  compactionDetected?: boolean;
}

let tempDir: string;
let unitReportPath: string;

function agentResult(extra: Partial<TestAgentResult> = {}): TestAgentResult {
  return { success: true, output: '', testResults: [], allPassed: false, failedTests: [], applicationTestcaseCount: 0, ...extra };
}

function scriptTestAgentRuns(...runs: ScriptedRun[]): void {
  for (const run of runs) {
    mockRunTestAgent.mockImplementationOnce(async () => {
      if (run.report) fs.writeFileSync(unitReportPath, run.report);
      return agentResult({ compactionDetected: run.compactionDetected });
    });
  }
}

function runRetryLoop(extra: Partial<TestRetryOptions> = {}) {
  return runUnitTestsWithRetry({
    logsDir: tempDir,
    orchestratorStatePath: tempDir,
    maxRetries: 3,
    unitReportPath,
    runTestsCommand: 'bun run test:unit',
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-test-retry-'));
  unitReportPath = path.join(tempDir, 'junit-unit.xml');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('runUnitTestsWithRetry — context compaction', () => {
  it('asks for the kill on a restartable test agent, and runs it again without using up a retry', async () => {
    const onCompactionDetected = vi.fn();
    scriptTestAgentRuns({ compactionDetected: true }, { report: PASSING_REPORT });

    const result = await runRetryLoop({ onCompactionDetected });

    expect(mockRunTestAgent).toHaveBeenCalledTimes(2);
    for (const call of mockRunTestAgent.mock.calls) {
      expect(call[5]).toBe(true);
    }
    expect(onCompactionDetected).toHaveBeenCalledTimes(1);
    expect(onCompactionDetected).toHaveBeenCalledWith(1);
    expect(result.passed).toBe(true);
    expect(result.totalRetries).toBe(0);
    expect(result.contextResetCount).toBe(1);
  });

  it('asks for the kill on a restartable test-resolution agent', async () => {
    scriptTestAgentRuns({ report: FAILING_REPORT }, { report: PASSING_REPORT });
    mockRunResolveTestAgent.mockResolvedValue({ success: true, output: 'fixed' });

    await runRetryLoop({ onCompactionDetected: vi.fn() });

    expect(mockRunResolveTestAgent).toHaveBeenCalledTimes(1);
    expect(mockRunResolveTestAgent.mock.calls[0][6]).toBe(true);
  });

  it('leaves the test agent running through a compaction when nothing restarts it', async () => {
    scriptTestAgentRuns({ report: PASSING_REPORT });

    await runRetryLoop();

    expect(mockRunTestAgent).toHaveBeenCalledTimes(1);
    expect(mockRunTestAgent.mock.calls[0][5]).toBe(false);
  });
});
