import { describe, it, expect, vi } from 'vitest';
import { Platform } from '@paysdoc/devplatform';
import type { IssueTracker } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../core/launchGitContext';
import { ADW_LABEL_DEFINITIONS } from '../../core/adwLabels';
import { ensureAdwLabelsExist, provisionAdwLabels } from '../adwLabelProvisioning';

const REPO_INFO = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };

interface RecordedCall { name: string; color: string; description: string }

function makeRecordingTracker(onEnsure?: (call: RecordedCall) => void): { tracker: Pick<IssueTracker, 'ensureLabel'>; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const tracker: Pick<IssueTracker, 'ensureLabel'> = {
    ensureLabel: (name, color, description) => {
      const call = { name, color, description };
      calls.push(call);
      onEnsure?.(call);
    },
  };
  return { tracker, calls };
}

describe('ensureAdwLabelsExist', () => {
  it('calls ensureLabel exactly once per catalogue entry with its name/color/description', () => {
    const { tracker, calls } = makeRecordingTracker();
    ensureAdwLabelsExist(REPO_INFO, tracker);
    expect(calls).toHaveLength(ADW_LABEL_DEFINITIONS.length);
    for (const def of ADW_LABEL_DEFINITIONS) {
      expect(calls).toContainEqual({ name: def.name, color: def.color, description: def.description });
    }
  });

  it('idempotent: calling twice issues 2×N calls and throws neither time', () => {
    const { tracker, calls } = makeRecordingTracker();
    expect(() => ensureAdwLabelsExist(REPO_INFO, tracker)).not.toThrow();
    expect(() => ensureAdwLabelsExist(REPO_INFO, tracker)).not.toThrow();
    expect(calls).toHaveLength(ADW_LABEL_DEFINITIONS.length * 2);
  });

  it('a throwing entry does not abort the rest and no throw escapes', () => {
    let seen = 0;
    const { tracker, calls } = makeRecordingTracker(() => {
      seen++;
      if (seen === 3) throw new Error('permission denied');
    });
    expect(() => ensureAdwLabelsExist(REPO_INFO, tracker)).not.toThrow();
    expect(calls).toHaveLength(ADW_LABEL_DEFINITIONS.length);
  });

  it('the summary log counts only the successes', () => {
    let seen = 0;
    const { tracker } = makeRecordingTracker(() => {
      seen++;
      if (seen === 3) throw new Error('permission denied');
    });
    const logger = vi.fn();
    ensureAdwLabelsExist(REPO_INFO, tracker, logger);
    expect(logger).toHaveBeenCalledWith(
      `ensureAdwLabelsExist: ensured ${ADW_LABEL_DEFINITIONS.length - 1}/${ADW_LABEL_DEFINITIONS.length} adw:* labels on acme/widgets`,
      'info',
    );
  });
});

describe('provisionAdwLabels', () => {
  type ProvisioningBoundary = Pick<LaunchBoundary, 'repoId' | 'providers'>;

  function makeBoundary(issueTracker: Pick<IssueTracker, 'ensureLabel'>): ProvisioningBoundary {
    return { repoId: REPO_INFO, providers: { issueTracker } } as unknown as ProvisioningBoundary;
  }

  it('leaves a repository with every label in the ADW label catalogue', () => {
    // The ADW repository as `gh label list` showed it on 2026-10-01: six of the eight.
    const labels = new Set(['adw:bug', 'adw:chore', 'adw:feature', 'adw:none', 'adw:unverified', 'adw:upgrade']);
    const boundary = makeBoundary({ ensureLabel: (name) => { labels.add(name); } });

    provisionAdwLabels(boundary, vi.fn());

    expect([...labels].sort()).toEqual(ADW_LABEL_DEFINITIONS.map((d) => d.name).sort());
  });

  it('provisions through the boundary\'s own issue tracker, for the boundary\'s own repository', () => {
    const { tracker, calls } = makeRecordingTracker();
    const logger = vi.fn();

    provisionAdwLabels(makeBoundary(tracker), logger);

    expect(calls).toHaveLength(ADW_LABEL_DEFINITIONS.length);
    expect(logger).toHaveBeenCalledWith(
      `ensureAdwLabelsExist: ensured ${ADW_LABEL_DEFINITIONS.length}/${ADW_LABEL_DEFINITIONS.length} adw:* labels on acme/widgets`,
      'info',
    );
  });

  it('does not throw when the boundary cannot mint its providers, and warns once naming the repository', () => {
    const boundary = {
      repoId: REPO_INFO,
      get providers(): never { throw new Error('platform not recognised'); },
    } as unknown as ProvisioningBoundary;
    const logger = vi.fn();

    expect(() => provisionAdwLabels(boundary, logger)).not.toThrow();

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('acme/widgets'), 'warn');
  });

  it('keeps asking for the remaining labels when the forge refuses each one', () => {
    const { tracker, calls } = makeRecordingTracker(() => { throw new Error('not implemented'); });

    expect(() => provisionAdwLabels(makeBoundary(tracker), vi.fn())).not.toThrow();

    expect(calls).toHaveLength(ADW_LABEL_DEFINITIONS.length);
  });
});
