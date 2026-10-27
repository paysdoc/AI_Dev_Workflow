import { vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AGENTS_STATE_DIR } from '../../core/config';
import { NO_DEV_SERVER_START } from '../../core/devServerFailure';
import { getDefaultProjectConfig, type ProjectConfig } from '../../core/projectConfig';
import type { ScenarioProofResult, TagProofResult } from '../../proof/types';
import type { PostMergeRerunDeps, PostMergeScenarioRun } from '../postMergeScenarioRerun';

export const adwId = `rerun-test-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
export const RUN: PostMergeScenarioRun = { issueNumber: 1101, adwId, worktreePath: '/work/feature-issue-1101', logsDir: '/logs/rerun' };

export function projectWith(overrides: { applicationType?: string | null; scenariosMd?: string; installDeps?: string; runScenariosByTag?: string } = {}): ProjectConfig {
  const defaults = getDefaultProjectConfig();
  return {
    ...defaults,
    hasAdwDir: true,
    scenariosMd: overrides.scenariosMd ?? '# Scenarios\n',
    applicationType: overrides.applicationType === undefined ? 'cli' : overrides.applicationType,
    commands: {
      ...defaults.commands,
      installDeps: overrides.installDeps ?? 'bun install',
      runScenariosByTag: overrides.runScenariosByTag ?? 'run-scenarios {tag}',
    },
  };
}

export function tagResult(overrides: Partial<TagProofResult>): TagProofResult {
  return { tag: '@regression', resolvedTag: '@regression', severity: 'blocker', optional: false, passed: true, output: '', exitCode: 0, skipped: false, ...overrides };
}

export function proofOf(...tagResults: TagProofResult[]): ScenarioProofResult {
  return {
    tagResults,
    hasBlockerFailures: tagResults.some((tag) => !tag.passed && !tag.skipped),
    perIssueImages: [],
    resultsFilePath: '/proof/scenario_proof.md',
    artifactsDir: '/proof/artifacts',
  };
}

export interface Harness {
  readonly deps: PostMergeRerunDeps;
  readonly loadProjectConfig: ReturnType<typeof vi.fn>;
  readonly runProcess: ReturnType<typeof vi.fn>;
  readonly allocatePort: ReturnType<typeof vi.fn>;
  readonly runScenarioTests: ReturnType<typeof vi.fn>;
  readonly commentOnIssue: ReturnType<typeof vi.fn>;
}

export function harness(project: ProjectConfig = projectWith(), proof: ScenarioProofResult | undefined = proofOf(tagResult({}))): Harness {
  const loadProjectConfig = vi.fn(() => project);
  const runProcess = vi.fn(async () => ({ exitCode: 0, output: '' }));
  const allocatePort = vi.fn(async () => 4321);
  const runScenarioTests = vi.fn(async () => ({ scenarioProof: proof, devServer: NO_DEV_SERVER_START }));
  const commentOnIssue = vi.fn();
  const deps: PostMergeRerunDeps = { loadProjectConfig, runProcess, allocatePort, runScenarioTests, issueTracker: { commentOnIssue } };
  return { deps, loadProjectConfig, runProcess, allocatePort, runScenarioTests, commentOnIssue };
}

/** Silences the console, and removes the state directory that the run under test may create for its ADW ID. */
export function useRerunSandbox(): void {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
  });
}
