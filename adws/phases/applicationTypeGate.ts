import type { GitContext } from '@paysdoc/devplatform/git';
import { log, AgentStateManager, loadProjectConfig, type LogLevel, type ProjectConfig } from '../core';
import {
  describeApplicationProfile,
  resolveApplicationType,
  type ApplicationProfile,
  type ApplicationProfiles,
} from '../core/applicationType';
import type { ParkEvidence } from '../forge/parkComment';
import { parkWorkflow } from './workflowPark';
import type { WorkflowConfig } from './workflowInit';

export type ApplicationTypeGateConfig = Pick<
  WorkflowConfig,
  'adwId' | 'issueNumber' | 'orchestratorStatePath' | 'repoContext' | 'worktreePath' | 'defaultBranch'
>;

export interface ApplicationTypeGateDeps {
  readonly loadProjectConfig: (worktreePath: string) => ProjectConfig;
  readonly mergeLatestFromDefaultBranch: (defaultBranch: string, worktreePath: string) => void;
  readonly park: (config: ApplicationTypeGateConfig, evidence: ParkEvidence) => never;
  readonly profiles?: ApplicationProfiles;
}

export interface ApplicationTypeGateResult {
  readonly projectConfig: ProjectConfig;
  readonly applicationProfile: ApplicationProfile;
}

function recordLine(statePath: string, message: string, level: LogLevel): void {
  log(message, level);
  AgentStateManager.appendLog(statePath, message);
}

function proceed(config: ApplicationTypeGateConfig, projectConfig: ProjectConfig, profile: ApplicationProfile): ApplicationTypeGateResult {
  recordLine(config.orchestratorStatePath, `Application type ${projectConfig.applicationType}: ${describeApplicationProfile(profile)}`, 'info');
  return { projectConfig, applicationProfile: profile };
}

function describeDeclared(declared: string | null): string {
  return declared === null ? 'is missing' : `says "${declared}"`;
}

/**
 * A type the mapping knows proceeds with its profile. Any other type merges the latest default branch into the worktree
 * once and reads the type again, because a reused target-repo or PR worktree is not merged with the default branch at
 * init, and the run that `## Retry` resumes must see what `adw_init` has since written there. Only a type the mapping
 * still does not know parks the workflow, which does not return.
 */
export function runApplicationTypeGate(
  config: ApplicationTypeGateConfig,
  projectConfig: ProjectConfig,
  deps: ApplicationTypeGateDeps,
): ApplicationTypeGateResult {
  const first = resolveApplicationType(projectConfig.applicationType, deps.profiles);
  if (first.kind === 'known') return proceed(config, projectConfig, first.profile);

  recordLine(
    config.orchestratorStatePath,
    `## Application Type ${describeDeclared(projectConfig.applicationType)} in the worktree; merging the latest ${config.defaultBranch} and reading it again`,
    'warn',
  );
  deps.mergeLatestFromDefaultBranch(config.defaultBranch, config.worktreePath);
  const reloaded = deps.loadProjectConfig(config.worktreePath);

  const second = resolveApplicationType(reloaded.applicationType, deps.profiles);
  if (second.kind === 'known') return proceed(config, reloaded, second.profile);
  return deps.park(config, second.evidence);
}

export function buildApplicationTypeGateDeps(gitContext: Pick<GitContext, 'mergeLatestFromDefaultBranch'>): ApplicationTypeGateDeps {
  return {
    loadProjectConfig,
    mergeLatestFromDefaultBranch: (defaultBranch, worktreePath) => gitContext.mergeLatestFromDefaultBranch(defaultBranch, worktreePath),
    park: parkWorkflow,
  };
}

/**
 * `applicationProfile` is optional only for phase-test fixtures: every production config comes from
 * `initializeWorkflow` or `initializePRReviewWorkflow`, both of which always set it. It is never defaulted.
 */
export function requireApplicationProfile(config: Pick<WorkflowConfig, 'applicationProfile'>): ApplicationProfile {
  if (config.applicationProfile) return config.applicationProfile;
  throw new Error(
    'requireApplicationProfile: this WorkflowConfig carries no application profile — initializeWorkflow and initializePRReviewWorkflow always set one, and ADW assumes no application type',
  );
}
