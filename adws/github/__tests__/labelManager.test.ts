import { describe, it, expect, vi } from 'vitest';
import { GitContext } from '../../gitContext';
import type { GitContextOptions, ExecFn } from '../../gitContext/types';
import { createLiteralTokenProvider } from '../../providers/github/githubTokenProvider';
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

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'widgets',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('gh-token-test'),
    gitIdentity: {
      authorName: 'ADW Bot',
      authorEmail: 'bot@adw.dev',
      committerName: 'ADW Bot',
      committerEmail: 'bot@adw.dev',
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  };
}

interface SpyCall {
  command: string;
  input?: string;
}

function makeSpyExec(
  impl?: (command: string) => string,
): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, input: options.input });
    return impl ? impl(command) : '';
  };
  return { exec, calls };
}

function makeLabel(name: string): GitHubLabel {
  return { id: name, name, color: 'cccccc', description: null };
}

function makeIssue(...labelNames: string[]) {
  return { labels: labelNames.map(makeLabel) };
}

const REPO_INFO = { owner: 'acme', repo: 'widgets' };

function makeDeps(spyCalls: SpyCall[], exec: ExecFn): LabelManagerDeps {
  return {
    gitContextForRepo: () => new GitContext(validOptions(), { exec }),
    logger: vi.fn(),
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
  it('issues exactly 8 exec calls, once per label', () => {
    const { exec, calls } = makeSpyExec();
    const deps = makeDeps(calls, exec);
    ensureAdwLabelsExist(REPO_INFO, deps);
    expect(calls).toHaveLength(8);
  });

  it('each exec call contains gh label create, --force, the label name, and --repo acme/widgets', () => {
    const { exec, calls } = makeSpyExec();
    const deps = makeDeps(calls, exec);
    ensureAdwLabelsExist(REPO_INFO, deps);
    for (const def of ADW_LABEL_DEFINITIONS) {
      const match = calls.find(c =>
        c.command.includes('gh label create') &&
        c.command.includes(`'${def.name}'`) &&
        c.command.includes('--force') &&
        c.command.includes('--repo acme/widgets'),
      );
      expect(match, `expected exec call for label "${def.name}"`).toBeDefined();
    }
  });

  it('idempotent: calling twice does not throw, issues 8 calls each time (16 total)', () => {
    const { exec, calls } = makeSpyExec();
    const deps = makeDeps(calls, exec);
    ensureAdwLabelsExist(REPO_INFO, deps);
    ensureAdwLabelsExist(REPO_INFO, deps);
    expect(calls).toHaveLength(16);
  });

  it('resilient: one failing label does not abort — all 8 still attempted, no throw escapes', () => {
    let callCount = 0;
    const { exec, calls } = makeSpyExec(() => {
      callCount++;
      if (callCount === 3) throw new Error('permission denied');
      return '';
    });
    const deps = makeDeps(calls, exec);
    expect(() => ensureAdwLabelsExist(REPO_INFO, deps)).not.toThrow();
    expect(calls).toHaveLength(8);
  });
});

// ── applyLabel ────────────────────────────────────────────────────────────────

describe('applyLabel', () => {
  it('success path: exactly one exec call, contains --add-label, no gh label create', () => {
    const { exec, calls } = makeSpyExec();
    const deps = makeDeps(calls, exec);
    applyLabel(7001, 'adw:feature', REPO_INFO, deps);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toContain("--add-label 'adw:feature'");
    expect(calls[0].command).not.toContain('gh label create');
  });

  it('lazy-create path: creates label and retries edit on "not found"', () => {
    let callCount = 0;
    const { exec, calls } = makeSpyExec((cmd) => {
      callCount++;
      if (cmd.includes('issue edit') && callCount === 1) {
        throw new Error('Label not found');
      }
      return '';
    });
    const deps = makeDeps(calls, exec);
    applyLabel(7002, 'adw:bug', REPO_INFO, deps);
    const issueEditCalls = calls.filter(c => c.command.includes('issue edit'));
    const createCalls = calls.filter(c => c.command.includes('gh label create'));
    expect(issueEditCalls).toHaveLength(2);
    expect(createCalls).toHaveLength(1);
  });

  it('persistent not-found: exactly one label create, retry error propagates', () => {
    const { exec, calls } = makeSpyExec((cmd) => {
      if (cmd.includes('issue edit')) throw new Error('Label not found');
      return '';
    });
    const deps = makeDeps(calls, exec);
    expect(() => applyLabel(7003, 'adw:chore', REPO_INFO, deps)).toThrow();
    const createCalls = calls.filter(c => c.command.includes('gh label create'));
    expect(createCalls).toHaveLength(1);
  });

  it('non-"not found" error rethrows without creating a label', () => {
    const { exec, calls } = makeSpyExec((cmd) => {
      if (cmd.includes('issue edit')) throw new Error('HTTP 500 Internal Server Error');
      return '';
    });
    const deps = makeDeps(calls, exec);
    expect(() => applyLabel(7001, 'adw:feature', REPO_INFO, deps)).toThrow(/500/);
    expect(calls.some(c => c.command.includes('gh label create'))).toBe(false);
  });
});
