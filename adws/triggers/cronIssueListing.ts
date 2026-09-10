/**
 * The cron's open-issue listing, extracted out of trigger_cron.ts.
 *
 * trigger_cron.ts has import-time side effects (setInterval, the entry-script
 * guard, the boundary build), so a module-private function there cannot be
 * driven from a step definition — the same finding #796 recorded for
 * initializeWorkflow. Extracting it here also keeps trigger_cron.ts, already
 * over the line guideline, from gaining a function.
 */

import { log } from '../core';
import type { IssueTracker } from '../providers/types';

/** Raw issue data the cron's eligibility filter (cronIssueFilter.ts) reads. */
export interface RawIssue {
  number: number;
  title: string;
  body: string;
  comments: { body: string }[];
  createdAt: string;
  updatedAt: string;
  labels: { name: string }[];
}

/** Fetches all open issues with body, comments, and timestamps. */
export function listCronOpenIssues(issueTracker: Pick<IssueTracker, 'listIssues'>): RawIssue[] {
  try {
    return issueTracker.listIssues({
      fields: ['number', 'title', 'body', 'comments', 'createdAt', 'updatedAt', 'labels'],
      limit: 100,
    }) as RawIssue[];
  } catch (error) {
    log(`Failed to fetch issues: ${error}`, 'error');
    return [];
  }
}
