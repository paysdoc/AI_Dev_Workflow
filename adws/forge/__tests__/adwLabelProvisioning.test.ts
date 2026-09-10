import { describe, it, expect, vi } from 'vitest';
import { Platform } from '../../providers/types';
import type { IssueTracker } from '../../providers/types';
import { ADW_LABEL_DEFINITIONS } from '../../core/adwLabels';
import { ensureAdwLabelsExist } from '../adwLabelProvisioning';

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
