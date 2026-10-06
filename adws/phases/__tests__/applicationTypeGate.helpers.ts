import { vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import { getDefaultProjectConfig, type ProjectConfig } from '../../core/projectConfig';
import type { ApplicationTypeGateConfig } from '../applicationTypeGate';
import type { WorkflowConfig } from '../workflowInit';

export class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

export const DEFAULT_BRANCH = 'trunk';
export const ISSUE_NUMBER = 991;
export const adwId = `apptype-gate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

const tempDirs: string[] = [];

export function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function configDeclaring(applicationType: string | null): ProjectConfig {
  return { ...getDefaultProjectConfig(), applicationType };
}

export function makeConfig(worktreePath: string = makeTempDir('adw-apptype-gate-worktree-'), commentOnIssue = vi.fn()): ApplicationTypeGateConfig {
  return {
    adwId,
    issueNumber: ISSUE_NUMBER,
    orchestratorStatePath: AgentStateManager.initializeState(adwId, 'orchestrator'),
    repoContext: { issueTracker: { commentOnIssue } } as unknown as WorkflowConfig['repoContext'],
    worktreePath,
    defaultBranch: DEFAULT_BRANCH,
  };
}

/** Traps `process.exit`, collects what reaches the console, and removes the run's state and temp directories afterwards. */
export function useApplicationTypeGateSandbox(): { readonly consoleOutput: () => string } {
  let consoleLines: string[] = [];

  beforeEach(() => {
    consoleLines = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { consoleLines.push(args.join(' ')); });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
    tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
  });

  return { consoleOutput: () => consoleLines.join('\n') };
}
