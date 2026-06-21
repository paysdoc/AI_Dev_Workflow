import { describe, it, expect, vi } from 'vitest';
import {
  buildBlockedByBody,
  blockedByRef,
  formatRegionOverlapComment,
  registerRegionOverlapBlocker,
  REGION_OVERLAP_MARKER,
} from '../regionOverlapSignals';
import { parseDependencies } from '../issueDependencies';
import type { OverlapDeferral } from '../cronIssueFilter';
import type { RepoInfo } from '../../github/githubApi';

const REPO: RepoInfo = { owner: 'o', repo: 'r' };

function makeDeferral(overrides: Partial<OverlapDeferral> = {}): OverlapDeferral {
  return {
    issueNumber: 100,
    blockedBy: 700,
    overlapPaths: ['adws/triggers/takeoverHandler.ts'],
    ...overrides,
  };
}

// ── buildBlockedByBody ────────────────────────────────────────────────────────

describe('buildBlockedByBody', () => {
  it('inserts ref INSIDE existing "## Blocked by" section — the "None" regression trap', () => {
    const body = '## Blocked by\nNone - can start immediately\n\n## Notes\nx';
    const result = buildBlockedByBody(body, 700);
    // ref appears right after the heading line, before "None - ..."
    expect(result).toContain(`## Blocked by\n#700 ${REGION_OVERLAP_MARKER}\nNone`);
    // parseDependencies (the exact unblock-path fn) must resolve #700
    expect(parseDependencies(result)).toContain(700);
    // ref must NOT have leaked after ## Notes (i.e. not a new EOF section)
    expect(result.indexOf(`#700`)).toBeLessThan(result.indexOf('## Notes'));
  });

  it('inserts ref into "## Dependencies" section', () => {
    const body = '## Dependencies\nNone\n\n## Next\nfoo';
    const result = buildBlockedByBody(body, 700);
    expect(parseDependencies(result)).toContain(700);
  });

  it('inserts ref into "## Depends on" section', () => {
    const body = '## Depends on\nNone\n';
    const result = buildBlockedByBody(body, 700);
    expect(parseDependencies(result)).toContain(700);
  });

  it('appends a fresh "## Blocked by" section when no dep heading exists', () => {
    const body = 'Just a plain body.';
    const result = buildBlockedByBody(body, 700);
    expect(result).toContain('## Blocked by');
    expect(result).toContain(`#700 ${REGION_OVERLAP_MARKER}`);
    expect(parseDependencies(result)).toContain(700);
  });

  it('is idempotent at the body level (calling twice would double-insert, but the guard prevents it)', () => {
    const body = '## Blocked by\nNone\n';
    const once = buildBlockedByBody(body, 700);
    // The marker line is there once
    expect(once.split(`#700 ${REGION_OVERLAP_MARKER}`).length - 1).toBe(1);
  });
});

// ── blockedByRef ──────────────────────────────────────────────────────────────

describe('blockedByRef', () => {
  it('formats ref with the annotation marker', () => {
    expect(blockedByRef(700)).toBe(`#700 ${REGION_OVERLAP_MARKER}`);
  });
});

// ── formatRegionOverlapComment ────────────────────────────────────────────────

describe('formatRegionOverlapComment', () => {
  it('names the blocker issue', () => {
    const comment = formatRegionOverlapComment(makeDeferral({ blockedBy: 700 }));
    expect(comment).toContain('#700');
  });

  it('lists the overlapping path', () => {
    const comment = formatRegionOverlapComment(
      makeDeferral({ overlapPaths: ['adws/triggers/takeoverHandler.ts'] }),
    );
    expect(comment).toContain('adws/triggers/takeoverHandler.ts');
  });

  it('uses fallback when overlapPaths is empty', () => {
    const comment = formatRegionOverlapComment(makeDeferral({ overlapPaths: [] }));
    expect(comment).toContain('(overlapping paths unavailable)');
  });
});

// ── registerRegionOverlapBlocker ──────────────────────────────────────────────

describe('registerRegionOverlapBlocker', () => {
  it('calls updateIssueBody and commentOnIssue exactly once on first registration', () => {
    const updateIssueBody = vi.fn();
    const commentOnIssue = vi.fn();
    const deferral = makeDeferral({ issueNumber: 100, blockedBy: 700 });
    const body = '## Blocked by\nNone - can start immediately\n';

    const result = registerRegionOverlapBlocker(deferral, body, REPO, { updateIssueBody, commentOnIssue });

    expect(result).toBe(true);
    expect(updateIssueBody).toHaveBeenCalledOnce();
    expect(commentOnIssue).toHaveBeenCalledOnce();
    // The body passed to updateIssueBody must contain the marker
    const passedBody: string = updateIssueBody.mock.calls[0][1];
    expect(passedBody).toContain(`#700 ${REGION_OVERLAP_MARKER}`);
    // parseDependencies on the passed body must resolve #700
    expect(parseDependencies(passedBody)).toContain(700);
    // The comment must name the blocker
    const passedComment: string = commentOnIssue.mock.calls[0][1];
    expect(passedComment).toContain('#700');
    expect(passedComment).toContain('adws/triggers/takeoverHandler.ts');
  });

  it('is idempotent — returns false and makes zero calls when marker already present', () => {
    const updateIssueBody = vi.fn();
    const commentOnIssue = vi.fn();
    const deferral = makeDeferral({ issueNumber: 100, blockedBy: 700 });
    // Body already has the marker
    const body = `## Blocked by\n#700 ${REGION_OVERLAP_MARKER}\nNone\n`;

    const result = registerRegionOverlapBlocker(deferral, body, REPO, { updateIssueBody, commentOnIssue });

    expect(result).toBe(false);
    expect(updateIssueBody).not.toHaveBeenCalled();
    expect(commentOnIssue).not.toHaveBeenCalled();
  });

  it('fail-safe: returns false and does NOT call commentOnIssue when updateIssueBody throws', () => {
    const updateIssueBody = vi.fn().mockImplementation(() => { throw new Error('GitHub 500'); });
    const commentOnIssue = vi.fn();
    const deferral = makeDeferral({ issueNumber: 100, blockedBy: 700 });

    const result = registerRegionOverlapBlocker(
      deferral, '## Blocked by\nNone\n', REPO, { updateIssueBody, commentOnIssue },
    );

    expect(result).toBe(false);
    expect(commentOnIssue).not.toHaveBeenCalled();
  });
});
