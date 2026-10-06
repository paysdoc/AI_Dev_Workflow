import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  APPLICATION_TYPE_PROFILES,
  EvidenceKind,
  RunnerMode,
  describeApplicationProfile,
  type ApplicationProfile,
  type ApplicationProfiles,
} from '../../core/applicationType';
import { ParkReason, type ParkEvidence } from '../../forge/parkComment';
import {
  requireApplicationProfile,
  runApplicationTypeGate,
  type ApplicationTypeGateConfig,
  type ApplicationTypeGateDeps,
} from '../applicationTypeGate';
import { DEFAULT_BRANCH, configDeclaring, makeConfig, useApplicationTypeGateSandbox } from './applicationTypeGate.helpers';

class Parked extends Error {
  constructor(readonly config: ApplicationTypeGateConfig, readonly evidence: ParkEvidence) {
    super(`parked for ${evidence.reason}`);
  }
}

const FAKE: ApplicationProfile = {
  runnerMode: RunnerMode.Descriptor,
  evidenceKinds: [EvidenceKind.PerIssueImages],
  reviewGuidanceSection: 'Desktop applications',
};

const sandbox = useApplicationTypeGateSandbox();

function makeDeps(profiles?: ApplicationProfiles) {
  return {
    loadProjectConfig: vi.fn<ApplicationTypeGateDeps['loadProjectConfig']>(),
    mergeLatestFromDefaultBranch: vi.fn<ApplicationTypeGateDeps['mergeLatestFromDefaultBranch']>(),
    park: vi.fn<ApplicationTypeGateDeps['park']>((config, evidence) => {
      throw new Parked(config, evidence);
    }),
    profiles,
  };
}

function executionLog(config: ApplicationTypeGateConfig): string {
  return fs.readFileSync(path.join(config.orchestratorStatePath, 'execution.log'), 'utf-8');
}

describe('runApplicationTypeGate — a type ADW knows proceeds', () => {
  it.each([
    ['cli', APPLICATION_TYPE_PROFILES.cli],
    ['web', APPLICATION_TYPE_PROFILES.web],
  ] as const)('proceeds with the %s profile, without merging, reloading or parking', (type, profile) => {
    const config = makeConfig();
    const projectConfig = configDeclaring(type);
    const deps = makeDeps();

    const result = runApplicationTypeGate(config, projectConfig, deps);

    expect(result).toEqual({ projectConfig, applicationProfile: profile });
    expect(result.projectConfig).toBe(projectConfig);
    expect(deps.mergeLatestFromDefaultBranch).not.toHaveBeenCalled();
    expect(deps.loadProjectConfig).not.toHaveBeenCalled();
    expect(deps.park).not.toHaveBeenCalled();
  });

  it.each([['cli'], ['web']])('records the %s profile on the console and in the execution log', (type) => {
    const config = makeConfig();
    const line = `Application type ${type}: ${describeApplicationProfile(APPLICATION_TYPE_PROFILES[type as 'cli' | 'web'])}`;

    runApplicationTypeGate(config, configDeclaring(type), makeDeps());

    expect(executionLog(config)).toContain(line);
    expect(sandbox.consoleOutput()).toContain(line);
  });

  it('reads a value that differs only in case or spacing as the type it names', () => {
    const result = runApplicationTypeGate(makeConfig(), configDeclaring('Web'), makeDeps());

    expect(result.applicationProfile).toBe(APPLICATION_TYPE_PROFILES.web);
  });
});

describe('runApplicationTypeGate — a fake third type reaches the gate through the table alone', () => {
  it('proceeds with the profile of a type only the table it is handed knows', () => {
    const config = makeConfig();
    const projectConfig = configDeclaring('desktop');
    const deps = makeDeps({ ...APPLICATION_TYPE_PROFILES, desktop: FAKE });

    const result = runApplicationTypeGate(config, projectConfig, deps);

    expect(result).toEqual({ projectConfig, applicationProfile: FAKE });
    expect(deps.mergeLatestFromDefaultBranch).not.toHaveBeenCalled();
    expect(deps.park).not.toHaveBeenCalled();
    expect(executionLog(config)).toContain(describeApplicationProfile(FAKE));
  });

  it('still proceeds with cli and web under the extended table', () => {
    const deps = makeDeps({ ...APPLICATION_TYPE_PROFILES, desktop: FAKE });

    expect(runApplicationTypeGate(makeConfig(), configDeclaring('cli'), deps).applicationProfile).toBe(APPLICATION_TYPE_PROFILES.cli);
    expect(runApplicationTypeGate(makeConfig(), configDeclaring('web'), deps).applicationProfile).toBe(APPLICATION_TYPE_PROFILES.web);
  });

  it('parks the same type under the default table', () => {
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(configDeclaring('desktop'));

    expect(() => runApplicationTypeGate(makeConfig(), configDeclaring('desktop'), deps)).toThrow(Parked);
  });
});

describe('runApplicationTypeGate — a type ADW does not know merges the default branch once, reads again, and parks if still unknown', () => {
  it('parks a missing type with found null after merging and reloading once each', () => {
    const config = makeConfig();
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(configDeclaring(null));

    expect(() => runApplicationTypeGate(config, configDeclaring(null), deps)).toThrow(Parked);

    expect(deps.mergeLatestFromDefaultBranch).toHaveBeenCalledTimes(1);
    expect(deps.mergeLatestFromDefaultBranch).toHaveBeenCalledWith(DEFAULT_BRANCH, config.worktreePath);
    expect(deps.loadProjectConfig).toHaveBeenCalledTimes(1);
    expect(deps.loadProjectConfig).toHaveBeenCalledWith(config.worktreePath);
    expect(deps.park).toHaveBeenCalledTimes(1);
    expect(deps.park).toHaveBeenCalledWith(config, { reason: ParkReason.MissingApplicationType, found: null });
  });

  it('parks an unknown type with the value as written', () => {
    const config = makeConfig();
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(configDeclaring('Desktop'));

    expect(() => runApplicationTypeGate(config, configDeclaring('Desktop'), deps)).toThrow(Parked);

    expect(deps.park).toHaveBeenCalledWith(config, { reason: ParkReason.MissingApplicationType, found: 'Desktop' });
  });

  it('parks with what the merge left, not with what the first read found', () => {
    const config = makeConfig();
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(configDeclaring('desktop'));

    expect(() => runApplicationTypeGate(config, configDeclaring(null), deps)).toThrow(Parked);

    expect(deps.park).toHaveBeenCalledWith(config, { reason: ParkReason.MissingApplicationType, found: 'desktop' });
  });

  it('merges before it reads again, and reads again before it parks', () => {
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(configDeclaring(null));

    expect(() => runApplicationTypeGate(makeConfig(), configDeclaring(null), deps)).toThrow(Parked);

    const [merged] = deps.mergeLatestFromDefaultBranch.mock.invocationCallOrder;
    const [loaded] = deps.loadProjectConfig.mock.invocationCallOrder;
    const [parked] = deps.park.mock.invocationCallOrder;
    expect(merged).toBeLessThan(loaded);
    expect(loaded).toBeLessThan(parked);
  });

  it('proceeds, with the reloaded config, when the merge brings the type in', () => {
    const config = makeConfig();
    const reloaded = configDeclaring('web');
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(reloaded);

    const result = runApplicationTypeGate(config, configDeclaring(null), deps);

    expect(result.applicationProfile).toBe(APPLICATION_TYPE_PROFILES.web);
    expect(result.projectConfig).toBe(reloaded);
    expect(deps.mergeLatestFromDefaultBranch).toHaveBeenCalledTimes(1);
    expect(deps.park).not.toHaveBeenCalled();
  });

  it('proceeds when the merge corrects an unknown value to a known one', () => {
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(configDeclaring('cli'));

    const result = runApplicationTypeGate(makeConfig(), configDeclaring('desktop'), deps);

    expect(result.applicationProfile).toBe(APPLICATION_TYPE_PROFILES.cli);
    expect(deps.park).not.toHaveBeenCalled();
  });

  it('says in the execution log that the section is missing, and that it merges and reads again', () => {
    const config = makeConfig();
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(configDeclaring(null));

    expect(() => runApplicationTypeGate(config, configDeclaring(null), deps)).toThrow(Parked);

    expect(executionLog(config)).toContain(`## Application Type is missing in the worktree; merging the latest ${DEFAULT_BRANCH} and reading it again`);
  });

  it('quotes the value the section holds when it is not a type ADW knows', () => {
    const config = makeConfig();
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(configDeclaring('desktop'));

    expect(() => runApplicationTypeGate(config, configDeclaring('desktop'), deps)).toThrow(Parked);

    expect(executionLog(config)).toContain('## Application Type says "desktop" in the worktree; merging the latest');
  });

  it('records the profile it proceeds with after the merge', () => {
    const config = makeConfig();
    const deps = makeDeps();
    deps.loadProjectConfig.mockReturnValue(configDeclaring('web'));

    runApplicationTypeGate(config, configDeclaring(null), deps);

    expect(executionLog(config)).toContain(`Application type web: ${describeApplicationProfile(APPLICATION_TYPE_PROFILES.web)}`);
  });
});

describe('requireApplicationProfile', () => {
  it('returns the profile the configuration carries', () => {
    expect(requireApplicationProfile({ applicationProfile: FAKE })).toBe(FAKE);
  });

  it('throws, naming both initialisers, instead of defaulting when there is none', () => {
    expect(() => requireApplicationProfile({})).toThrow(/initializeWorkflow/);
    expect(() => requireApplicationProfile({})).toThrow(/initializePRReviewWorkflow/);
  });
});
