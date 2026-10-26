import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ParkReason, buildParkComment, type ParkEvidence } from '../../forge/parkComment';
import { decideRetryAction } from '../../triggers/retryHandler';
import { recordPark, type ParkRecorder } from '../workflowPark';

const adwId = 'record-park-test';

const POST_MERGE_RED: ParkEvidence = {
  reason: ParkReason.PostMergeBddRed,
  prNumber: 7,
  baseBranch: 'trunk',
  mergedCommits: ['a1b2c3d Add the changelog'],
  conflictedFiles: [],
  failures: [{ title: '@regression Orders: Orders are accepted', detail: 'expected 1 order, found 0' }],
};

const LOST_PLAN: ParkEvidence = {
  reason: ParkReason.WorktreeLost,
  phase: 'build',
  worktreePath: '/srv/adw/.worktrees/feature-issue-989-widget',
  planPath: 'specs/issue-989-adw-park-test-sdlc_planner-widget.md',
};

function recorder(order: string[] = [], failOnComment = false): ParkRecorder & { comments: Array<[number, string]> } {
  const comments: Array<[number, string]> = [];
  return {
    comments,
    writeTopLevelState: (id, state) => {
      order.push(`state ${id} ${JSON.stringify(state)}`);
    },
    commentOnIssue: (issueNumber, body) => {
      order.push('comment');
      if (failOnComment) throw new Error('HTTP 502 from the forge');
      comments.push([issueNumber, body]);
    },
  };
}

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${String(code)})`);
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordPark', () => {
  it('writes the stage and the reason of the park, and returns the stage', () => {
    const order: string[] = [];

    const stage = recordPark(adwId, 7, POST_MERGE_RED, recorder(order));

    expect(stage).toBe('human_gated');
    expect(order[0]).toBe(`state ${adwId} ${JSON.stringify({ workflowStage: 'human_gated', parkReason: 'post_merge_bdd_red' })}`);
  });

  it('writes the state before it posts the comment', () => {
    const order: string[] = [];

    recordPark(adwId, 7, POST_MERGE_RED, recorder(order));

    expect(order.map(entry => entry.split(' ')[0])).toEqual(['state', 'comment']);
  });

  it('posts exactly the park comment of the evidence on the issue', () => {
    const parked = recorder();

    recordPark(adwId, 7, POST_MERGE_RED, parked);

    expect(parked.comments).toEqual([[7, buildParkComment(adwId, POST_MERGE_RED)]]);
  });

  it('logs a comment that cannot be posted, keeps the state it wrote and still returns the stage', () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });
    const order: string[] = [];

    const stage = recordPark(adwId, 7, POST_MERGE_RED, recorder(order, true));

    expect(stage).toBe('human_gated');
    expect(order.map(entry => entry.split(' ')[0])).toEqual(['state', 'comment']);
    expect(logged.join('\n')).toContain('Failed to post the park comment on issue #7');
    expect(logged.join('\n')).toContain('HTTP 502 from the forge');
  });

  it('logs the stage and the reason it parks for', () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });

    recordPark(adwId, 7, POST_MERGE_RED, recorder());

    expect(logged.join('\n')).toContain('Workflow parked as human_gated: post_merge_bdd_red');
  });

  it('returns the stage a lost plan has of its own', () => {
    expect(recordPark(adwId, 7, LOST_PLAN, recorder())).toBe('worktree_lost');
  });

  it('does not end the process, since the caller decides how a park ends its run', () => {
    recordPark(adwId, 7, POST_MERGE_RED, recorder());

    expect(process.exit).not.toHaveBeenCalled();
  });

  it('leaves the workflow in a stage that "## Retry" re-arms to phase_timeout', () => {
    const stage = recordPark(adwId, 7, POST_MERGE_RED, recorder());

    expect(decideRetryAction(stage)).toEqual({ kind: 'rearm_phase_timeout', from: 'human_gated' });
  });
});
