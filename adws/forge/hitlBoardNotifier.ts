/**
 * HITL board-event notifier — owns PR/issue lookup, message building, and Slack delivery.
 * No-throw at boundary. Nothing here constructs a GitContext or a provider: every
 * reader is injected via `NotifierDeps`, and the one production reader set
 * (`buildNotifierDeps`) is built over a `GitContext` the caller already holds.
 * Non-GitHub no-op is enforced by callers via Platform.GitHub guards.
 */

import { log } from '../core';
import { postSlack } from '../core/slackNotifier';
import { bodyLinksIssue } from './issueLinkMarker';
import { selectPreferredPR } from '../providers/github/ghPrParsers';
import { createGhRepoApi } from '../providers/github/ghRepoApi';
import type { RepoIdentifier } from '../providers/types';
import type { GitContext } from '../gitContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HitlIssueInfo {
  title: string;
  labels: readonly { name: string }[];
}

interface HitlPREntry {
  readonly number: number;
  readonly url: string;
  readonly body: string;
  readonly state: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly updatedAt: string;
}

/** Injected readers — the two forge reads a notification needs. */
export interface NotifierDeps {
  readIssue: (issueNumber: number, repoInfo: RepoIdentifier) => HitlIssueInfo | null;
  listOpenPRs: (repoInfo: RepoIdentifier) => HitlPREntry[] | null;
}

export interface NotifyReviewArgs {
  issueNumber: number;
  repoInfo: RepoIdentifier;
}

export interface NotifyBlockedArgs {
  issueNumber: number;
  repoInfo: RepoIdentifier;
  source: 'discarded' | 'review_error';
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// The one production reader set — over `createGhRepoApi(ctx)`, a bound view
// of a context the caller already holds (never a construction): the same
// `fetchIssue`/`fetchAllPRs` commands the legacy defaults issued.
// ---------------------------------------------------------------------------

export function buildNotifierDeps(ctx: GitContext, repoId: RepoIdentifier): NotifierDeps {
  const gh = createGhRepoApi(ctx);
  return {
    readIssue: (issueNumber) => {
      try {
        const raw = JSON.parse(gh.fetchIssue(issueNumber)) as { title: string; labels: { name: string }[] };
        return { title: raw.title, labels: raw.labels };
      } catch {
        return null;
      }
    },
    listOpenPRs: () => {
      try {
        const allPrs = JSON.parse(gh.fetchAllPRs()) as Array<{ number: number; body: string; state: string }>;
        return allPrs
          .filter((p) => p.state === 'OPEN')
          .map((p) => ({
            number: p.number,
            url: `https://github.com/${repoId.owner}/${repoId.repo}/pull/${p.number}`,
            body: p.body,
            state: p.state,
            headRefName: '',
            baseRefName: '',
            updatedAt: '',
          }));
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function readIssueTitleAndHitl(
  issueNumber: number,
  repoInfo: RepoIdentifier,
  deps: NotifierDeps,
): { title: string; hasHitl: boolean } | null {
  const info = deps.readIssue(issueNumber, repoInfo);
  if (!info) return null;
  const hasHitl = info.labels.some((l) => l.name === 'hitl');
  return { title: info.title, hasHitl };
}

function findReviewPr(
  issueNumber: number,
  repoInfo: RepoIdentifier,
  deps: NotifierDeps,
): string | null {
  const prs = deps.listOpenPRs(repoInfo);
  if (!prs) return null;
  const matched = prs.filter((pr) => bodyLinksIssue(pr.body, issueNumber));
  const chosen = selectPreferredPR(matched) as HitlPREntry | null;
  return chosen?.url ?? null;
}

function buildSnippet(errorMessage: string | undefined): string {
  return (errorMessage ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function notifyReviewTransition(
  args: NotifyReviewArgs,
  deps: NotifierDeps,
): Promise<void> {
  const { issueNumber, repoInfo } = args;
  try {
    const info = readIssueTitleAndHitl(issueNumber, repoInfo, deps);
    if (!info?.hasHitl) return;
    const prUrl = findReviewPr(issueNumber, repoInfo, deps);
    if (!prUrl) return;
    await postSlack(
      `:eyes: HITL issue #${issueNumber} "${info.title}" → In Review. Approve to merge: ${prUrl}`,
    );
  } catch (err) {
    log(`hitlBoardNotifier: review notification failed: ${err}`, 'warn');
  }
}

export async function notifyBlockedTransition(
  args: NotifyBlockedArgs,
  deps: NotifierDeps,
): Promise<void> {
  const { issueNumber, repoInfo, source, errorMessage } = args;
  try {
    const info = readIssueTitleAndHitl(issueNumber, repoInfo, deps);
    if (!info?.hasHitl) return;
    const { owner, repo } = repoInfo;
    const issueUrl = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
    let message: string;
    if (source === 'discarded') {
      message = `:no_entry: HITL issue #${issueNumber} "${info.title}" discarded (PR closed/terminal): ${issueUrl}`;
    } else {
      const snippet = buildSnippet(errorMessage);
      message = `:warning: HITL issue #${issueNumber} "${info.title}" — PR review failed: ${snippet} — needs attention: ${issueUrl}`;
    }
    await postSlack(message);
  } catch (err) {
    log(`hitlBoardNotifier: blocked notification failed: ${err}`, 'warn');
  }
}
