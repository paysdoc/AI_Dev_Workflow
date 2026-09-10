/**
 * HITL board-event notifier — owns PR/issue lookup, message building, and Slack delivery.
 * No-throw at boundary. Nothing here constructs a provider: every reader is
 * injected via `NotifierDeps`, and the one production reader set
 * (`buildNotifierDeps`) reads through the launch boundary's `IssueTracker`/
 * `CodeHost` ports (#844) rather than a bound `createGhRepoApi(ctx)` view.
 *
 * `buildNotifierDeps` takes a THUNK resolving to the ports, not the ports
 * themselves: `forgeWiring.ts` builds these deps while `forgeProviders` is
 * still assembling the very providers they read, so the ports can only be
 * resolved later, at notification time (a status move) — never during
 * assembly. Re-entrancy into the thunk during assembly cannot happen in
 * practice (assembly never moves an issue), but callers should not rely on
 * that; the thunk is safe to call repeatedly once minting has completed.
 *
 * Non-GitHub no-op is enforced by callers via Platform.GitHub guards.
 */

import { log } from '../core';
import { postSlack } from '../core/slackNotifier';
import { bodyLinksIssue } from './issueLinkMarker';
import type { CodeHost, IssueTracker, RepoIdentifier } from '../providers/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two forge reads a notification needs — a `Pick` both `BoundProviders` and `RepoContext` satisfy. */
export interface NotifierPorts {
  issueTracker: Pick<IssueTracker, 'fetchIssue'>;
  codeHost: Pick<CodeHost, 'listPullRequests'>;
}

interface HitlIssueInfo {
  title: string;
  labels: readonly string[];
}

interface HitlPREntry {
  readonly number: number;
  readonly url: string;
  readonly body: string;
  readonly state: string;
  readonly updatedAt: string;
}

/** Injected readers — the two forge reads a notification needs. */
export interface NotifierDeps {
  readIssue: (issueNumber: number, repoInfo: RepoIdentifier) => Promise<HitlIssueInfo | null>;
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
// The one production reader set — reads through the boundary's ports,
// resolved lazily via `resolvePorts` at notification time.
// ---------------------------------------------------------------------------

// `repoId` is unused here — kept on the signature only so callers passing
// `(resolvePorts, repoId)` compile unchanged; the ports themselves are
// already bound to a repository.
export function buildNotifierDeps(resolvePorts: () => NotifierPorts, _repoId: RepoIdentifier): NotifierDeps {
  return {
    readIssue: async (issueNumber) => {
      try {
        const issue = await resolvePorts().issueTracker.fetchIssue(issueNumber);
        return { title: issue.title, labels: issue.labels };
      } catch {
        return null;
      }
    },
    listOpenPRs: () => {
      try {
        const all = resolvePorts().codeHost.listPullRequests();
        return all
          .filter((p) => p.state === 'OPEN')
          .map((p) => ({ number: p.number, url: p.url, body: p.body, state: p.state, updatedAt: p.updatedAt }));
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function readIssueTitleAndHitl(
  issueNumber: number,
  repoInfo: RepoIdentifier,
  deps: NotifierDeps,
): Promise<{ title: string; hasHitl: boolean } | null> {
  const info = await deps.readIssue(issueNumber, repoInfo);
  if (!info) return null;
  const hasHitl = info.labels.includes('hitl');
  return { title: info.title, hasHitl };
}

/** The entry with the largest `updatedAt`, or null when `entries` is empty — "newest first" over the port's timestamp, independent of the forge's own listing order. */
function pickNewestByUpdatedAt(entries: readonly HitlPREntry[]): HitlPREntry | null {
  if (entries.length === 0) return null;
  return [...entries].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
}

/**
 * The issue's preferred linked PR: `listOpenPRs` has already filtered to
 * OPEN (so a merged-only issue reaches here with an empty pool, not the
 * merged PR), leaving only "newest first" among the OPEN entries that link
 * the issue.
 */
function findReviewPr(
  issueNumber: number,
  repoInfo: RepoIdentifier,
  deps: NotifierDeps,
): string | null {
  const prs = deps.listOpenPRs(repoInfo);
  if (!prs) return null;
  const matched = prs.filter((pr) => bodyLinksIssue(pr.body, issueNumber));
  return pickNewestByUpdatedAt(matched)?.url ?? null;
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
    const info = await readIssueTitleAndHitl(issueNumber, repoInfo, deps);
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
    const info = await readIssueTitleAndHitl(issueNumber, repoInfo, deps);
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
