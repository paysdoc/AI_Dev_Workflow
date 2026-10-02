/**
 * The `gh` calls that change the forge. Each applies its change to the forge state, so a later read
 * in the same run sees it, prints what the real CLI prints, and names the REST request it stands for,
 * which the Cucumber process replays against the mock GitHub API after the child has exited. A call
 * naming another repository changes nothing but the log. The one secret a call carries arrives on
 * stdin and is never logged. Pure: the clock and stdin are injected.
 */

import {
  allValues,
  fail,
  isNumber,
  lastValue,
  notAPullRequest,
  notAnIssue,
  parseArgs,
  sameRepository,
  succeed,
  type FlagSpec,
  type GhContext,
  type GhHandler,
  type GhOutcome,
  type GhRequest,
  type ParsedArgs,
} from './ghShadowArgs.ts';
import type { ForgeState, GhComment, GhIssue, GhLabel, GhPullRequest } from './ghShadowState.ts';

const ACTOR = 'adw-harness';
const DEFAULT_LABEL_COLOR = 'ededed';
const MERGE_STRATEGIES = ['--merge', '--squash', '--rebase'] as const;

interface Call {
  readonly parsed: ParsedArgs;
  /** The `--repo` value, `owner/repo`. */
  readonly repository: string;
  /** The one positional, an issue or pull-request number or a name, when the call takes one. */
  readonly subject: string;
}

/** `undefined` when the call carries no `--repo`, an unnamed flag, or the wrong number of positionals. */
function parseCall(args: readonly string[], spec: FlagSpec, takesSubject: boolean): Call | undefined {
  const parsed = parseArgs(args, { ...spec, values: ['--repo', ...(spec.values ?? [])] });
  const repository = parsed && lastValue(parsed, '--repo');
  if (!parsed || !repository || parsed.positionals.length !== (takesSubject ? 1 : 0)) return undefined;
  return { parsed, repository, subject: parsed.positionals[0] ?? '' };
}

/** Stdin for `-`, the text itself otherwise; undefined when no body is given or it names a file the shadow cannot read. */
function bodyOf(parsed: ParsedArgs, stdin: () => string): string | undefined {
  const file = lastValue(parsed, '--body-file');
  const inline = lastValue(parsed, '--body');
  if (file !== undefined) return file === '-' ? stdin() : undefined;
  return inline === '-' ? stdin() : inline;
}

function wrote(context: GhContext, request: GhRequest, stdout = '', state?: ForgeState): GhOutcome {
  return succeed(stdout, { state, log: { kind: 'write', argv: context.argv, request } });
}

function nextNumber(state: ForgeState): number {
  const numbers = [...Object.values(state.issues), ...Object.values(state.pullRequests)].map((record) => record.number);
  return Math.max(0, ...numbers) + 1;
}

function nextCommentId(state: ForgeState): string {
  const comments = [...Object.values(state.issues), ...Object.values(state.pullRequests)].flatMap((record) => record.comments);
  return String(Math.max(0, ...comments.map((comment) => Number(comment.id)).filter(Number.isFinite)) + 1);
}

function withIssue(state: ForgeState, issue: GhIssue): ForgeState {
  return { ...state, issues: { ...state.issues, [String(issue.number)]: issue } };
}

function withPullRequest(state: ForgeState, pullRequest: GhPullRequest): ForgeState {
  return { ...state, pullRequests: { ...state.pullRequests, [String(pullRequest.number)]: pullRequest } };
}

function newComment(state: ForgeState, body: string, now: string): GhComment {
  return { id: nextCommentId(state), author: { login: ACTOR }, body, createdAt: now, updatedAt: now };
}

/** Where a comment lands: the issue of that number, or the pull request of it, which GitHub numbers alongside. */
function commented(state: ForgeState, number: string, comment: GhComment, pullRequestsOnly: boolean): { state: ForgeState; area: 'issues' | 'pull' } | undefined {
  const issue = pullRequestsOnly ? undefined : state.issues[number];
  if (issue) return { state: withIssue(state, { ...issue, comments: [...issue.comments, comment], updatedAt: comment.createdAt }), area: 'issues' };
  const pullRequest = state.pullRequests[number];
  if (!pullRequest) return undefined;
  return { state: withPullRequest(state, { ...pullRequest, comments: [...pullRequest.comments, comment], updatedAt: comment.createdAt }), area: 'pull' };
}

function commentOn(context: GhContext, call: Call, body: string, pullRequestsOnly: boolean): GhOutcome {
  const { state, now } = context;
  const request: GhRequest = { method: 'POST', path: `/repos/${call.repository}/issues/${call.subject}/comments`, body: { body } };
  const comment = newComment(state, body, now());
  const urlFor = (area: string): string => `https://github.com/${call.repository}/${area}/${call.subject}#issuecomment-${comment.id}\n`;
  if (!sameRepository(state, call.repository)) return wrote(context, request, urlFor('issues'));

  const result = commented(state, call.subject, comment, pullRequestsOnly);
  if (!result) return pullRequestsOnly ? notAPullRequest(call.subject) : notAnIssue(call.subject);
  return wrote(context, request, urlFor(result.area), result.state);
}

function commentHandler(pullRequestsOnly: boolean): GhHandler {
  return (args, context) => {
    const call = parseCall(args, { values: ['--body-file', '--body'] }, true);
    const body = call && bodyOf(call.parsed, context.stdin);
    if (!call || !isNumber(call.subject) || body === undefined) return undefined;
    return commentOn(context, call, body, pullRequestsOnly);
  };
}

const issueComment = commentHandler(false);
const prComment = commentHandler(true);

const issueClose: GhHandler = (args, context) => {
  const call = parseCall(args, {}, true);
  if (!call || !isNumber(call.subject)) return undefined;
  const { state, now } = context;
  const request: GhRequest = { method: 'PATCH', path: `/repos/${call.repository}/issues/${call.subject}`, body: { state: 'closed' } };
  if (!sameRepository(state, call.repository)) return wrote(context, request);

  const issue = state.issues[call.subject];
  if (!issue) return notAnIssue(call.subject);
  if (issue.state === 'CLOSED') return succeed();
  return wrote(context, request, '', withIssue(state, { ...issue, state: 'CLOSED', closedAt: now(), updatedAt: now() }));
};

const issueCreate: GhHandler = (args, context) => {
  const call = parseCall(args, { values: ['--title', '--body-file', '--body'] }, false);
  const title = call && lastValue(call.parsed, '--title');
  const body = call && bodyOf(call.parsed, context.stdin);
  if (!call || title === undefined || body === undefined) return undefined;

  const { state, now } = context;
  const number = nextNumber(state);
  const url = `https://github.com/${call.repository}/issues/${number}`;
  const issue: GhIssue = {
    number, title, body, state: 'OPEN', author: { login: ACTOR, name: '', is_bot: false }, assignees: [], labels: [], milestone: null,
    comments: [], createdAt: now(), updatedAt: now(), closedAt: null, url,
  };
  const request: GhRequest = { method: 'POST', path: `/repos/${call.repository}/issues`, body: { title, body } };
  return wrote(context, request, `${url}\n`, sameRepository(state, call.repository) ? withIssue(state, issue) : undefined);
};

function labelled(issue: GhIssue, name: string, now: string): GhIssue {
  if (issue.labels.some((label) => label.name === name)) return issue;
  const label: GhLabel = { id: '', name, color: DEFAULT_LABEL_COLOR, description: '' };
  return { ...issue, labels: [...issue.labels, label], updatedAt: now };
}

interface IssueChange {
  readonly method: string;
  /** What follows `/repos/<owner>/<repo>/issues/<n>` in the REST request the change stands for. */
  readonly suffix: string;
  readonly body: unknown;
  readonly apply: (issue: GhIssue, now: string) => GhIssue;
}

/** One change per call: a new body, a label added or a label removed. */
function issueChange(parsed: ParsedArgs, stdin: () => string): IssueChange | undefined {
  const added = allValues(parsed, '--add-label');
  const removed = allValues(parsed, '--remove-label');
  const hasBody = parsed.values.has('--body-file') || parsed.values.has('--body');
  if (Number(hasBody) + added.length + removed.length !== 1) return undefined;

  if (added.length === 1) return { method: 'POST', suffix: '/labels', body: { labels: added }, apply: (issue, now) => labelled(issue, added[0], now) };
  if (removed.length === 1) {
    const apply = (issue: GhIssue, now: string): GhIssue => ({ ...issue, labels: issue.labels.filter((label) => label.name !== removed[0]), updatedAt: now });
    return { method: 'DELETE', suffix: `/labels/${encodeURIComponent(removed[0])}`, body: {}, apply };
  }
  const body = bodyOf(parsed, stdin);
  return body === undefined ? undefined : { method: 'PATCH', suffix: '', body: { body }, apply: (issue, now) => ({ ...issue, body, updatedAt: now }) };
}

const issueEdit: GhHandler = (args, context) => {
  const call = parseCall(args, { values: ['--body-file', '--body', '--add-label', '--remove-label'] }, true);
  const change = call && issueChange(call.parsed, context.stdin);
  if (!call || !change || !isNumber(call.subject)) return undefined;

  const { state, now } = context;
  const request: GhRequest = { method: change.method, path: `/repos/${call.repository}/issues/${call.subject}${change.suffix}`, body: change.body };
  const url = `https://github.com/${call.repository}/issues/${call.subject}\n`;
  if (!sameRepository(state, call.repository)) return wrote(context, request, url);

  const issue = state.issues[call.subject];
  if (!issue) return notAnIssue(call.subject);
  return wrote(context, request, url, withIssue(state, change.apply(issue, now())));
};

const labelCreate: GhHandler = (args, context) => {
  const call = parseCall(args, { values: ['--color', '--description'], switches: ['--force'] }, true);
  if (!call || call.subject === '') return undefined;
  const color = lastValue(call.parsed, '--color') ?? DEFAULT_LABEL_COLOR;
  const description = lastValue(call.parsed, '--description') ?? '';
  return wrote(context, { method: 'POST', path: `/repos/${call.repository}/labels`, body: { name: call.subject, color, description } });
};

const prCreate: GhHandler = (args, context) => {
  const call = parseCall(args, { values: ['--title', '--head', '--base', '--body-file', '--body', '--label'] }, false);
  const title = call && lastValue(call.parsed, '--title');
  const head = call && lastValue(call.parsed, '--head');
  const body = call && bodyOf(call.parsed, context.stdin);
  if (!call || title === undefined || head === undefined || body === undefined) return undefined;

  const { state, now } = context;
  const base = lastValue(call.parsed, '--base') ?? state.repository.defaultBranch;
  const mine = sameRepository(state, call.repository);
  const existing = mine ? Object.values(state.pullRequests).find((pr) => pr.state === 'OPEN' && pr.headRefName === head) : undefined;
  if (existing) return fail(`a pull request for branch "${head}" into branch "${base}" already exists:\n${existing.url}`);

  const number = nextNumber(state);
  const url = `https://github.com/${call.repository}/pull/${number}`;
  const labels = allValues(call.parsed, '--label').map((name): GhLabel => ({ id: '', name, color: DEFAULT_LABEL_COLOR, description: '' }));
  const pullRequest: GhPullRequest = {
    number, title, body, state: 'OPEN', headRefName: head, baseRefName: base, url, mergedAt: null, updatedAt: now(), labels, reviewDecision: '', reviews: [], comments: [],
  };
  const request: GhRequest = { method: 'POST', path: `/repos/${call.repository}/pulls`, body: { title, head, base, body } };
  return wrote(context, request, `${url}\n`, mine ? withPullRequest(state, pullRequest) : undefined);
};

const prMerge: GhHandler = (args, context) => {
  const call = parseCall(args, { switches: MERGE_STRATEGIES }, true);
  const strategies = call ? MERGE_STRATEGIES.filter((strategy) => call.parsed.switches.has(strategy)) : [];
  if (!call || !isNumber(call.subject) || strategies.length !== 1) return undefined;

  const { state, now } = context;
  const request: GhRequest = { method: 'PUT', path: `/repos/${call.repository}/pulls/${call.subject}/merge`, body: { merge_method: strategies[0].slice(2) } };
  if (!sameRepository(state, call.repository)) return wrote(context, request);

  const pullRequest = state.pullRequests[call.subject];
  if (!pullRequest) return notAPullRequest(call.subject);
  if (pullRequest.state !== 'OPEN') return fail(`X Pull request #${call.subject} is ${pullRequest.state === 'MERGED' ? 'already merged' : 'closed'}`);
  return wrote(context, request, '', withPullRequest(state, { ...pullRequest, state: 'MERGED', mergedAt: now(), updatedAt: now() }));
};

const prReview: GhHandler = (args, context) => {
  const call = parseCall(args, { switches: ['--approve'] }, true);
  if (!call || !isNumber(call.subject) || !call.parsed.switches.has('--approve')) return undefined;

  const { state, now } = context;
  const request: GhRequest = { method: 'POST', path: `/repos/${call.repository}/pulls/${call.subject}/reviews`, body: { event: 'APPROVE' } };
  if (!sameRepository(state, call.repository)) return wrote(context, request);

  const pullRequest = state.pullRequests[call.subject];
  if (!pullRequest) return notAPullRequest(call.subject);
  const review = { author: { login: ACTOR }, state: 'APPROVED', submittedAt: now(), body: '' };
  return wrote(context, request, '', withPullRequest(state, { ...pullRequest, reviewDecision: 'APPROVED', reviews: [...pullRequest.reviews, review], updatedAt: now() }));
};

const secretSet: GhHandler = (args, context) => {
  const call = parseCall(args, { values: ['--body'] }, true);
  if (!call || call.subject === '' || lastValue(call.parsed, '--body') !== '-') return undefined;
  context.stdin();
  return wrote(context, { method: 'PUT', path: `/repos/${call.repository}/actions/secrets/${call.subject}`, body: {} });
};

export const WRITE_HANDLERS: Readonly<Record<string, GhHandler>> = {
  'issue comment': issueComment,
  'issue close': issueClose,
  'issue create': issueCreate,
  'issue edit': issueEdit,
  'label create': labelCreate,
  'pr create': prCreate,
  'pr merge': prMerge,
  'pr review': prReview,
  'pr comment': prComment,
  'secret set': secretSet,
};
