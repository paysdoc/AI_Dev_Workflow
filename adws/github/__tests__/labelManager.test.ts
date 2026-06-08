import { describe, it, expect, vi } from 'vitest';
import type { GitHubLabel } from '../../types/issueTypes';
import type { LabelManagerDeps } from '../labelManager';
import {
  readAdwLabels,
  readAdwLabelNames,
  issueTypeToAdwLabel,
  ensureAdwLabelsExist,
  applyLabel,
  ADW_LABEL_DEFINITIONS,
} from '../labelManager';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLabel(name: string): GitHubLabel {
  return { id: name, name, color: 'cccccc', description: null };
}

function makeIssue(...labelNames: string[]) {
  return { labels: labelNames.map(makeLabel) };
}

const REPO_INFO = { owner: 'acme', repo: 'widgets' };

function makeDeps(overrides: Partial<LabelManagerDeps> = {}): LabelManagerDeps {
  return {
    exec: vi.fn().mockReturnValue(''),
    logger: vi.fn(),
    ...overrides,
  };
}

// ── readAdwLabels — all branches ──────────────────────────────────────────────

describe('readAdwLabels', () => {
  it('zero adw:* labels and no adw:none → no classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue())).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('zero adw:* labels with adw:none → opt-out, no classification, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:none'))).toEqual({ optOut: true, classification: null, conflict: false });
  });

  it('exactly adw:chore → /chore classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:chore'))).toEqual({ optOut: false, classification: '/chore', conflict: false });
  });

  it('exactly adw:bug → /bug classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:bug'))).toEqual({ optOut: false, classification: '/bug', conflict: false });
  });

  it('exactly adw:feature → /feature classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:feature'))).toEqual({ optOut: false, classification: '/feature', conflict: false });
  });

  it('exactly adw:pr_review → /pr_review classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:pr_review'))).toEqual({ optOut: false, classification: '/pr_review', conflict: false });
  });

  it('adw:bug + adw:none → opt-out, /bug classification, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:bug', 'adw:none'))).toEqual({ optOut: true, classification: '/bug', conflict: false });
  });

  it('adw:bug + adw:feature → conflict, no classification, no opt-out', () => {
    expect(readAdwLabels(makeIssue('adw:bug', 'adw:feature'))).toEqual({ optOut: false, classification: null, conflict: true });
  });

  it('adw:bug + adw:feature + adw:none → opt-out, conflict, no classification', () => {
    expect(readAdwLabels(makeIssue('adw:bug', 'adw:feature', 'adw:none'))).toEqual({ optOut: true, classification: null, conflict: true });
  });

  it('non-adw labels are ignored', () => {
    expect(readAdwLabels(makeIssue('hitl', 'bug'))).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw:upgrade alone → no classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:upgrade'))).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw-bug (hyphen) and adwesome are ignored — exact match only', () => {
    expect(readAdwLabels(makeIssue('adw-bug', 'adwesome'))).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw:bug + unrelated labels → /bug classification only', () => {
    expect(readAdwLabels(makeIssue('adw:bug', 'hitl'))).toEqual({ optOut: false, classification: '/bug', conflict: false });
  });
});

// ── readAdwLabelNames — parity with readAdwLabels ─────────────────────────────

describe('readAdwLabelNames', () => {
  it('zero labels → no classification, no opt-out, no conflict', () => {
    expect(readAdwLabelNames([])).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw:none only → opt-out, no classification, no conflict', () => {
    expect(readAdwLabelNames(['adw:none'])).toEqual({ optOut: true, classification: null, conflict: false });
  });

  it('exactly adw:bug → /bug classification, no opt-out, no conflict', () => {
    expect(readAdwLabelNames(['adw:bug'])).toEqual({ optOut: false, classification: '/bug', conflict: false });
  });

  it('adw:bug + adw:feature → conflict, no classification, no opt-out', () => {
    expect(readAdwLabelNames(['adw:bug', 'adw:feature'])).toEqual({ optOut: false, classification: null, conflict: true });
  });

  it('adw:bug + adw:none → opt-out wins, /bug classification, no conflict', () => {
    expect(readAdwLabelNames(['adw:bug', 'adw:none'])).toEqual({ optOut: true, classification: '/bug', conflict: false });
  });

  it('non-adw labels are ignored', () => {
    expect(readAdwLabelNames(['bug', 'enhancement'])).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('exact match only — adw-bug and adwesome are not matched', () => {
    expect(readAdwLabelNames(['adw-bug', 'adwesome'])).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw:upgrade alone is not a classification label', () => {
    expect(readAdwLabelNames(['adw:upgrade'])).toEqual({ optOut: false, classification: null, conflict: false });
  });
});

// ── issueTypeToAdwLabel ───────────────────────────────────────────────────────

describe('issueTypeToAdwLabel', () => {
  it('/feature → adw:feature', () => {
    expect(issueTypeToAdwLabel('/feature')).toBe('adw:feature');
  });

  it('/bug → adw:bug', () => {
    expect(issueTypeToAdwLabel('/bug')).toBe('adw:bug');
  });

  it('/chore → adw:chore', () => {
    expect(issueTypeToAdwLabel('/chore')).toBe('adw:chore');
  });

  it('/pr_review → adw:pr_review', () => {
    expect(issueTypeToAdwLabel('/pr_review')).toBe('adw:pr_review');
  });

  it('/adw_init → null (no classification label)', () => {
    expect(issueTypeToAdwLabel('/adw_init')).toBeNull();
  });
});

// ── ensureAdwLabelsExist ──────────────────────────────────────────────────────

describe('ensureAdwLabelsExist', () => {
  it('calls exec exactly 6 times, once per label', () => {
    const deps = makeDeps();
    ensureAdwLabelsExist(REPO_INFO, deps);
    expect(deps.exec).toHaveBeenCalledTimes(6);
  });

  it('each exec call contains gh label create, --force, the label name, and --repo acme/widgets', () => {
    const deps = makeDeps();
    ensureAdwLabelsExist(REPO_INFO, deps);
    const calls = vi.mocked(deps.exec).mock.calls;
    for (const def of ADW_LABEL_DEFINITIONS) {
      const match = calls.find(([cmd]) =>
        typeof cmd === 'string' &&
        cmd.includes('gh label create') &&
        cmd.includes(`'${def.name}'`) &&
        cmd.includes('--force') &&
        cmd.includes('--repo acme/widgets'),
      );
      expect(match, `expected exec call for label "${def.name}"`).toBeDefined();
    }
  });

  it('idempotent: calling twice does not throw, issues 6 calls each time (12 total)', () => {
    const deps = makeDeps();
    ensureAdwLabelsExist(REPO_INFO, deps);
    ensureAdwLabelsExist(REPO_INFO, deps);
    expect(deps.exec).toHaveBeenCalledTimes(12);
  });

  it('resilient: one failing label does not abort — all 6 still attempted, no throw escapes', () => {
    let callCount = 0;
    const deps = makeDeps({
      exec: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 3) throw new Error('permission denied');
        return '';
      }),
    });
    expect(() => ensureAdwLabelsExist(REPO_INFO, deps)).not.toThrow();
    expect(deps.exec).toHaveBeenCalledTimes(6);
  });
});

// ── applyLabel ────────────────────────────────────────────────────────────────

describe('applyLabel', () => {
  it('success path: exactly one exec call, contains --add-label, no gh label create', () => {
    const deps = makeDeps();
    applyLabel(7001, 'adw:feature', REPO_INFO, deps);
    expect(deps.exec).toHaveBeenCalledTimes(1);
    const [cmd] = vi.mocked(deps.exec).mock.calls[0]!;
    expect(cmd).toContain("--add-label 'adw:feature'");
    expect(cmd).not.toContain('gh label create');
  });

  it('lazy-create path: creates label and retries edit on "not found"', () => {
    let callCount = 0;
    const deps = makeDeps({
      exec: vi.fn().mockImplementation((cmd: string) => {
        callCount++;
        if (cmd.includes('issue edit') && callCount === 1) {
          throw new Error('Label not found');
        }
        return '';
      }),
    });
    applyLabel(7002, 'adw:bug', REPO_INFO, deps);
    const calls = vi.mocked(deps.exec).mock.calls.map(([cmd]) => cmd);
    const issueEditCalls = calls.filter(c => c.includes('issue edit'));
    const createCalls = calls.filter(c => c.includes('gh label create'));
    expect(issueEditCalls).toHaveLength(2);
    expect(createCalls).toHaveLength(1);
  });

  it('persistent not-found: exactly one label create, retry error propagates', () => {
    const deps = makeDeps({
      exec: vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes('issue edit')) throw new Error('Label not found');
        return '';
      }),
    });
    expect(() => applyLabel(7003, 'adw:chore', REPO_INFO, deps)).toThrow();
    const calls = vi.mocked(deps.exec).mock.calls.map(([cmd]) => cmd);
    const createCalls = calls.filter(c => c.includes('gh label create'));
    expect(createCalls).toHaveLength(1);
  });

  it('non-"not found" error rethrows without creating a label', () => {
    const deps = makeDeps({
      exec: vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes('issue edit')) throw new Error('HTTP 500 Internal Server Error');
        return '';
      }),
    });
    expect(() => applyLabel(7001, 'adw:feature', REPO_INFO, deps)).toThrow(/500/);
    const calls = vi.mocked(deps.exec).mock.calls.map(([cmd]) => cmd);
    expect(calls.some(c => c.includes('gh label create'))).toBe(false);
  });
});
