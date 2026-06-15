/**
 * HITL board-event notifier — owns PR/issue lookup, message building, and Slack delivery.
 * No-throw at boundary. GitHub-layer: no providers/ import.
 * Non-GitHub no-op is enforced by callers via Platform.GitHub guards.
 */

import { execWithRetry, log } from '../core';
import { postSlack } from '../core/slackNotifier';
import { type RepoInfo } from './githubApi';
import { selectPreferredPR } from './prApi';

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
  readIssue?: (issueNumber: number, repoInfo: RepoInfo) => HitlIssueInfo | null;
  listOpenPRs?: (repoInfo: RepoInfo) => HitlPREntry[] | null;
}

export interface NotifyReviewArgs {
  issueNumber: number;
  repoInfo: RepoInfo;
}

export interface NotifyBlockedArgs {
  issueNumber: number;
  repoInfo: RepoInfo;
  source: 'discarded' | 'review_error';
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Private defaults — real gh CLI reads
// ---------------------------------------------------------------------------

function defaultReadIssue(issueNumber: number, repoInfo: RepoInfo): HitlIssueInfo | null {
  const { owner, repo } = repoInfo;
  try {
    const raw = execWithRetry(
      `gh issue view ${issueNumber} --repo ${owner}/${repo} --json title,labels`,
    );
    const parsed = JSON.parse(raw) as { title: string; labels: { name: string }[] };
    return { title: parsed.title, labels: parsed.labels };
  } catch {
    return null;
  }
}

function defaultListOpenPRs(repoInfo: RepoInfo): HitlPREntry[] | null {
  const { owner, repo } = repoInfo;
  try {
    const raw = execWithRetry(
      `gh pr list --repo ${owner}/${repo} --state open --json number,url,body,headRefName,baseRefName,updatedAt,state --limit 50`,
    );
    return JSON.parse(raw) as HitlPREntry[];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function readIssueTitleAndHitl(
  issueNumber: number,
  repoInfo: RepoInfo,
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
  repoInfo: RepoInfo,
  deps?: NotifierDeps,
): string | null {
  const lister = deps?.listOpenPRs ?? defaultListOpenPRs;
  const prs = lister(repoInfo);
  if (!prs) return null;
  const boundary = new RegExp(`Implements #${issueNumber}(?!\\d)`);
  const matched = prs.filter((pr) => pr.body && boundary.test(pr.body));
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
