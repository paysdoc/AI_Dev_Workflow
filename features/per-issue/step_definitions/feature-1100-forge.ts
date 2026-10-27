/**
 * The forge a feature-1100 merge run talks to. The issue tracker and code host implement only what a merge run calls, and
 * throw naming anything else, so a run that reaches further fails here rather than getting a silent default. GitHub's answers
 * to `gh pr merge` are scripted call by call, and every merge call and every wait ADW makes goes into one ordered log: which
 * wait came before which merge call is what the scenarios assert.
 */

import type { BoardManager, BoundProviders, CodeHost, IssueTracker, PullRequestSummary } from '@paysdoc/devplatform';

export type MergeAnswer =
  | { readonly merged: true }
  | { readonly merged: false; readonly error: string };

export type MergeEvent =
  | { readonly kind: 'merge'; readonly prNumber: number }
  | { readonly kind: 'wait'; readonly ms: number };

export interface RecordedComment {
  readonly issueNumber: number;
  readonly body: string;
}

/** What GitHub answers, as the scenario's Givens fill it in. */
export interface MergeScript {
  /** By merge call: the first answer is for the first call. */
  answers: MergeAnswer[];
  refuseEveryCallWith: string | null;
  /** Runs once, as GitHub is asked the first time and before it answers: what happens on `origin` in between. */
  beforeFirstCall: (() => void) | null;
}

export interface Forge {
  readonly providers: BoundProviders;
  readonly script: MergeScript;
  readonly events: MergeEvent[];
  readonly comments: RecordedComment[];
  /** ADW's injected wait: records what it was asked to wait for and returns at once, so no scenario sleeps. */
  recordWait(ms: number): Promise<void>;
}

export function strictPort<T extends object>(port: string, implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || property in target) return Reflect.get(target, property, receiver);
      throw new Error(`The ${port} of the feature-1100 forge does not implement "${property}", which the merge run called`);
    },
  }) as T;
}

function mergeCallsMade(events: readonly MergeEvent[]): number {
  return events.filter((event) => event.kind === 'merge').length;
}

function answerFor(script: MergeScript, callNumber: number): MergeAnswer {
  if (script.refuseEveryCallWith !== null) return { merged: false, error: script.refuseEveryCallWith };
  const answer = script.answers[callNumber - 1];
  if (!answer) throw new Error(`GitHub was asked for merge call ${callNumber}, but the scenario scripted answers for ${script.answers.length} call(s) only`);
  return answer;
}

/** What ADW waited, in milliseconds, before each merge call, by the number of the call. A wait after the last call counts for the call that never came. */
export function waitsBeforeEachMergeCall(events: readonly MergeEvent[]): Map<number, number[]> {
  const waits = new Map<number, number[]>();
  let nextCall = 1;
  for (const event of events) {
    if (event.kind === 'merge') nextCall += 1;
    else waits.set(nextCall, [...(waits.get(nextCall) ?? []), event.ms]);
  }
  return waits;
}

export function createForge(pullRequest: PullRequestSummary): Forge {
  const script: MergeScript = { answers: [], refuseEveryCallWith: null, beforeFirstCall: null };
  const events: MergeEvent[] = [];
  const comments: RecordedComment[] = [];

  const codeHost = strictPort<CodeHost>('code host', {
    findPullRequestByBranch: (branchName) => (branchName === pullRequest.sourceBranch ? pullRequest : null),
    isPullRequestApproved: () => true,
    mergePullRequest(prNumber) {
      const callNumber = mergeCallsMade(events) + 1;
      events.push({ kind: 'merge', prNumber });
      if (callNumber === 1) script.beforeFirstCall?.();
      const answer = answerFor(script, callNumber);
      return answer.merged ? { success: true } : { success: false, error: answer.error };
    },
  });
  const issueTracker = strictPort<IssueTracker>('issue tracker', {
    fetchLabels: () => [],
    commentOnIssue: (issueNumber, body) => {
      comments.push({ issueNumber, body });
    },
  });

  return {
    providers: { issueTracker, codeHost, boardManager: strictPort<BoardManager>('board manager', {}) },
    script,
    events,
    comments,
    recordWait: async (ms) => {
      events.push({ kind: 'wait', ms });
    },
  };
}
