import { vi, type Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { APPLICATION_TYPE_PROFILES, type ApplicationProfile } from '../../core/applicationType';
import { BaselineStatus, type BaselineRecord } from '../../core/baselineGate';
import { AGENTS_STATE_DIR } from '../../core/config';
import { parseDeviceSourceSections, type DeviceSourceSections } from '../../core/deviceSourceConfig';
import { BaseScenarioOutcome } from '../../core/regressionTriage';
import type { TestCaseResult } from '../../core/testReportParser';
import type { BaseScenarioRerun } from '../baseScenarioRerun';
import type { ScenarioProofResult, TagProofResult } from '../scenarioProof';
import type { WorkflowConfig } from '../workflowInit';

export class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

export const ADW_ID = `pre-existing-gate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
export const BASE_BRANCH = 'trunk';
export const FEATURE = 'Alpha';

const tempDirs: string[] = [];

export const PASSED_BASELINE: BaselineRecord = { status: BaselineStatus.Passed, baseBranch: BASE_BRANCH, baseCommit: 'abc1234', recordedAt: '2026-10-04T10:00:00.000Z' };
export const WAIVED_BASELINE: BaselineRecord = { status: BaselineStatus.Waived, waivedPark: 'baseline_red', recordedAt: '2026-10-04T10:00:00.000Z' };

export function testCase(name: string, status: TestCaseResult['status'], classname: string | null = FEATURE): TestCaseResult {
  return { name, status, attachments: [], ...(classname === null ? {} : { classname }) };
}

export function tagResult(resolvedTag: string, overrides: Partial<TagProofResult> = {}): TagProofResult {
  return { tag: resolvedTag, resolvedTag, severity: 'blocker', optional: false, passed: true, output: '', exitCode: 0, skipped: false, ...overrides };
}

export function proofOf(...tagResults: TagProofResult[]): ScenarioProofResult {
  return {
    tagResults,
    hasBlockerFailures: tagResults.some(result => result.severity === 'blocker' && !result.passed && !result.skipped),
    perIssueImages: [],
    resultsFilePath: '/proof.md',
    artifactsDir: '/artifacts',
  };
}

export function failingRegression(...cases: TestCaseResult[]): ScenarioProofResult {
  return proofOf(tagResult('@regression', { passed: false, exitCode: 1, cases }));
}

interface GateConfigOptions {
  /** Defaults to the cli profile. */
  readonly applicationProfile?: ApplicationProfile;
  /** Defaults to no section set. */
  readonly deviceSources?: DeviceSourceSections;
}

export function makeConfig(commentOnIssue: (issueNumber: number, body: string) => void = vi.fn(), options: GateConfigOptions = {}): WorkflowConfig {
  const orchestratorStatePath = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-gate-state-'));
  tempDirs.push(orchestratorStatePath);
  return {
    adwId: ADW_ID,
    issueNumber: 990,
    defaultBranch: BASE_BRANCH,
    orchestratorStatePath,
    logsDir: path.join(orchestratorStatePath, 'logs'),
    applicationProfile: options.applicationProfile ?? APPLICATION_TYPE_PROFILES.cli,
    projectConfig: { deviceSources: options.deviceSources ?? parseDeviceSourceSections('') },
    repoContext: { issueTracker: { commentOnIssue } },
  } as unknown as WorkflowConfig;
}

/** Answers each scenario with its scripted outcome, and notes in `events` that it ran. */
export function scriptedRerun(
  outcomes: Readonly<Record<string, BaseScenarioOutcome>>,
  events: string[] = [],
): { rerunOnBase: Mock<BaseScenarioRerun>; rerun: Mock<BaseScenarioRerun> } {
  const rerun = vi.fn<BaseScenarioRerun>(async (scenario) => {
    events.push(`re-ran ${scenario.name}`);
    return outcomes[scenario.name] ?? BaseScenarioOutcome.NotRun;
  });
  return { rerunOnBase: rerun, rerun };
}

export function executionLog(config: WorkflowConfig): string {
  return fs.readFileSync(path.join(config.orchestratorStatePath, 'execution.log'), 'utf-8');
}

/** The park exits the process: here it throws `ExitSignal` instead. */
export function stubProcessExit(): void {
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitSignal(code);
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
}

export function cleanUpGateFixtures(): void {
  vi.restoreAllMocks();
  fs.rmSync(path.join(AGENTS_STATE_DIR, ADW_ID), { recursive: true, force: true });
  tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
}
