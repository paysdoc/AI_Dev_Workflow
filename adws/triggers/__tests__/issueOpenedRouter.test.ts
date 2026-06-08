import { describe, it, expect, vi } from 'vitest';
import {
  decideIssueOpenedRoute,
  extractPayloadLabelNames,
  routeIssueOpened,
  MULTI_LABEL_REFUSAL_COMMENT,
  type IssueOpenedRouterDeps,
} from '../issueOpenedRouter';
import type { AdwLabelReading } from '../../github/labelManager';

// ── helpers ───────────────────────────────────────────────────────────────────

const REPO_INFO = { owner: 'acme', repo: 'widgets' };

function makeReading(overrides: Partial<AdwLabelReading> = {}): AdwLabelReading {
  return { optOut: false, classification: null, conflict: false, ...overrides };
}

function makeDeps(overrides: Partial<IssueOpenedRouterDeps> = {}): IssueOpenedRouterDeps {
  return {
    checkEligibility: vi.fn().mockResolvedValue({ eligible: true }),
    classifyAndSpawn: vi.fn().mockResolvedValue(undefined),
    postComment: vi.fn(),
    logger: vi.fn(),
    ...overrides,
  };
}

function makeParams(overrides: Partial<Parameters<typeof routeIssueOpened>[0]> = {}) {
  return {
    issueNumber: 100,
    issueBody: 'body',
    issueTitle: 'Test Issue',
    labelNames: [] as string[],
    repoInfo: REPO_INFO,
    targetRepoArgs: [] as string[],
    ...overrides,
  };
}

// ── decideIssueOpenedRoute ────────────────────────────────────────────────────

describe('decideIssueOpenedRoute', () => {
  it('optOut true → opt_out', () => {
    expect(decideIssueOpenedRoute(makeReading({ optOut: true }))).toEqual({ kind: 'opt_out' });
  });

  it('conflict true → conflict', () => {
    expect(decideIssueOpenedRoute(makeReading({ conflict: true }))).toEqual({ kind: 'conflict' });
  });

  it('classification set → classified', () => {
    expect(decideIssueOpenedRoute(makeReading({ classification: '/bug' }))).toEqual({ kind: 'classified', classification: '/bug' });
  });

  it('nothing set → infer', () => {
    expect(decideIssueOpenedRoute(makeReading())).toEqual({ kind: 'infer' });
  });

  it('optOut + classification → opt_out wins', () => {
    expect(decideIssueOpenedRoute(makeReading({ optOut: true, classification: '/bug' }))).toEqual({ kind: 'opt_out' });
  });

  it('optOut + conflict → opt_out wins', () => {
    expect(decideIssueOpenedRoute(makeReading({ optOut: true, conflict: true }))).toEqual({ kind: 'opt_out' });
  });

  it('conflict + classification → conflict wins over classification', () => {
    expect(decideIssueOpenedRoute(makeReading({ conflict: true, classification: null }))).toEqual({ kind: 'conflict' });
  });
});

// ── extractPayloadLabelNames ──────────────────────────────────────────────────

describe('extractPayloadLabelNames', () => {
  it('undefined issue → []', () => {
    expect(extractPayloadLabelNames(undefined)).toEqual([]);
  });

  it('missing labels → []', () => {
    expect(extractPayloadLabelNames({})).toEqual([]);
  });

  it('null labels → []', () => {
    expect(extractPayloadLabelNames({ labels: null })).toEqual([]);
  });

  it('empty array → []', () => {
    expect(extractPayloadLabelNames({ labels: [] })).toEqual([]);
  });

  it('valid objects with name strings → names array', () => {
    expect(extractPayloadLabelNames({ labels: [{ name: 'adw:bug' }, { name: 'bug' }] })).toEqual(['adw:bug', 'bug']);
  });

  it('entries without name are dropped', () => {
    expect(extractPayloadLabelNames({ labels: [{ name: 'adw:bug' }, { color: 'red' }, null, 'string'] })).toEqual(['adw:bug']);
  });

  it('entries where name is not a string are dropped', () => {
    expect(extractPayloadLabelNames({ labels: [{ name: 42 }, { name: 'adw:feature' }] })).toEqual(['adw:feature']);
  });
});

// ── routeIssueOpened ──────────────────────────────────────────────────────────

describe('routeIssueOpened', () => {
  it('AC1: adw:none → opted_out; no spawn, no comment, no eligibility check', async () => {
    const deps = makeDeps();
    const result = await routeIssueOpened(makeParams({ labelNames: ['adw:none'] }), deps);
    expect(result.status).toBe('opted_out');
    expect(deps.classifyAndSpawn).not.toHaveBeenCalled();
    expect(deps.postComment).not.toHaveBeenCalled();
    expect(deps.checkEligibility).not.toHaveBeenCalled();
  });

  it('AC3: adw:bug + adw:feature → refused_multi_label; postComment with MULTI_LABEL_REFUSAL_COMMENT; no spawn', async () => {
    const deps = makeDeps();
    const result = await routeIssueOpened(makeParams({ labelNames: ['adw:bug', 'adw:feature'] }), deps);
    expect(result.status).toBe('refused_multi_label');
    expect(deps.postComment).toHaveBeenCalledOnce();
    expect(deps.postComment).toHaveBeenCalledWith(100, MULTI_LABEL_REFUSAL_COMMENT, REPO_INFO);
    expect(deps.classifyAndSpawn).not.toHaveBeenCalled();
  });

  it('AC2: single adw:bug → spawned_classified; precomputedClassification set; no LLM/postComment', async () => {
    const deps = makeDeps();
    const result = await routeIssueOpened(makeParams({ labelNames: ['adw:bug'], issueTitle: 'Fix login' }), deps);
    expect(result.status).toBe('spawned_classified');
    expect(deps.classifyAndSpawn).toHaveBeenCalledOnce();
    const [, , , labelRouting] = vi.mocked(deps.classifyAndSpawn).mock.calls[0]!;
    expect(labelRouting?.precomputedClassification).toBe('/bug');
    expect(labelRouting?.issueTitle).toBe('Fix login');
    expect(deps.postComment).not.toHaveBeenCalled();
  });

  it('AC4: no adw:* labels → spawned_inferred; persistInferredLabel: true', async () => {
    const deps = makeDeps();
    const result = await routeIssueOpened(makeParams({ labelNames: [] }), deps);
    expect(result.status).toBe('spawned_inferred');
    expect(deps.classifyAndSpawn).toHaveBeenCalledOnce();
    const [, , , labelRouting] = vi.mocked(deps.classifyAndSpawn).mock.calls[0]!;
    expect(labelRouting?.persistInferredLabel).toBe(true);
  });

  it('classified + ineligible → deferred; no spawn', async () => {
    const deps = makeDeps({ checkEligibility: vi.fn().mockResolvedValue({ eligible: false, reason: 'concurrency_limit' }) });
    const result = await routeIssueOpened(makeParams({ labelNames: ['adw:chore'] }), deps);
    expect(result.status).toBe('deferred');
    expect(deps.classifyAndSpawn).not.toHaveBeenCalled();
  });

  it('infer + ineligible → deferred; no spawn', async () => {
    const deps = makeDeps({ checkEligibility: vi.fn().mockResolvedValue({ eligible: false, reason: 'open_dependencies' }) });
    const result = await routeIssueOpened(makeParams({ labelNames: [] }), deps);
    expect(result.status).toBe('deferred');
    expect(deps.classifyAndSpawn).not.toHaveBeenCalled();
  });
});

// ── MULTI_LABEL_REFUSAL_COMMENT marker guards ─────────────────────────────────

describe('MULTI_LABEL_REFUSAL_COMMENT', () => {
  it('does not match the ADW emoji heading pattern /^## :[a-z_]+: /m', () => {
    expect(MULTI_LABEL_REFUSAL_COMMENT).not.toMatch(/^## :[a-z_]+: /m);
  });

  it('does not contain <!-- adw-bot -->', () => {
    expect(MULTI_LABEL_REFUSAL_COMMENT).not.toContain('<!-- adw-bot -->');
  });

  it('contains the substring "adw:" (references the namespace it is asking to clean up)', () => {
    expect(MULTI_LABEL_REFUSAL_COMMENT).toContain('adw:');
  });
});
