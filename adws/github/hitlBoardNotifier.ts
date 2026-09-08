/**
 * HITL board-event notifier — owns PR/issue lookup, message building, and Slack delivery.
 * No-throw at boundary. GitHub-layer: no providers/ import.
 * Non-GitHub no-op is enforced by callers via Platform.GitHub guards.
 */

import { log } from '../core';
import { postSlack } from '../core/slackNotifier';
import { bodyLinksIssue } from './issueLinkMarker';
import { selectPreferredPR } from './prApi';
import { gitContextForRepo } from './gitContextFactory';
import { createGhRepoApi } from '../providers/github/ghRepoApi';
import type { RepoIdentifier } from '../providers/types';

const gh = (repoInfo: RepoIdentifier) => createGhRepoApi(gitContextForRepo(repoInfo));

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

/** Injected readers for testing — omit in production (defaults to real gh CLI calls). */
export interface NotifierDeps {
  readIssue?: (issueNumber: number, repoInfo: RepoIdentifier) => HitlIssueInfo | null;
  listOpenPRs?: (repoInfo: RepoIdentifier) => HitlPREntry[] | null;
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
// Private defaults — real gh CLI reads
// ---------------------------------------------------------------------------

function defaultReadIssue(issueNumber: number, repoInfo: RepoIdentifier): HitlIssueInfo | null {
  try {
    const raw = gh(repoInfo).fetchIssue(issueNumber);
    const parsed = JSON.parse(raw) as { title: string; labels: { name: string }[] };
    return { title: parsed.title, labels: parsed.labels };
  } catch {
    return null;
  }
}

function defaultListOpenPRs(repoInfo: RepoIdentifier): HitlPREntry[] | null {
  try {
    const raw = gh(repoInfo).fetchAllPRs();
    const allPrs = JSON.parse(raw) as Array<{
      number: number;
      body: string;
      state: string;
      mergedAt: string | null;
    }>;
    return allPrs
      .filter((p) => p.state === 'OPEN')
      .map((p) => ({
        number: p.number,
        url: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/${p.number}`,
        body: p.body,
        state: p.state,
        headRefName: '',
        baseRefName: '',
        updatedAt: '',
      }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function readIssueTitleAndHitl(
  issueNumber: number,
  repoInfo: RepoIdentifier,
  deps?: NotifierDeps,
): { title: string; hasHitl: boolean } | null {
  const reader = deps?.readIssue ?? defaultReadIssue;
  const info = reader(issueNumber, repoInfo);
  if (!info) return null;
  const hasHitl = info.labels.some((l) => l.name === 'hitl');
  return { title: info.title, hasHitl };
}

function findReviewPr(
  issueNumber: number,
  repoInfo: RepoIdentifier,
  deps?: NotifierDeps,
): string | null {
  const lister = deps?.listOpenPRs ?? defaultListOpenPRs;
  const prs = lister(repoInfo);
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
  deps?: NotifierDeps,
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
  deps?: NotifierDeps,
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
