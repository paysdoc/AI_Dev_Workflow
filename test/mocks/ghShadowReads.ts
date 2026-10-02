/**
 * The `gh` calls the shadow answers from the forge state and logs nothing for: the token, the
 * repository's default branch, issue and pull-request views and lists, and the REST reads ADW makes
 * through `gh api`. A call naming another repository gets gh's answer for one it cannot find. Pure.
 */

import {
  isNumber,
  lastValue,
  allValues,
  notAPullRequest,
  notAnIssue,
  parseArgs,
  sameRepository,
  succeed,
  unknownRepository,
  fail,
  type FlagSpec,
  type GhContext,
  type GhHandler,
  type GhOutcome,
  type ParsedArgs,
} from './ghShadowArgs.ts';
import { projectFields, type ForgeState, type GhComment, type GhIssue, type GhPullRequest } from './ghShadowState.ts';

const FAKE_TOKEN = 'adw-harness-fake-token';
const DEFAULT_LIST_LIMIT = 30;
const PROPERTY_PATH = /^\.[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;
const COMMENTS_OR_REVIEWS = /^repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)\/(comments|reviews)$/;

const VIEW_FLAGS: FlagSpec = { values: ['--repo', '--json', '--jq'] };
const ISSUE_LIST_FLAGS: FlagSpec = { values: ['--repo', '--state', '--label', '--search', '--limit', '--json', '--jq'] };
const PR_LIST_FLAGS: FlagSpec = { values: ['--repo', '--state', '--head', '--limit', '--json', '--jq'] };

function propertyOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** Property paths only (`.a.b`): the one `--jq` ADW passes is `.defaultBranchRef.name`. A string prints bare, as gh prints it. */
function applyJq(value: unknown, expression: string): string | undefined {
  if (!PROPERTY_PATH.test(expression)) return undefined;
  const result = expression.slice(1).split('.').reduce<unknown>(propertyOf, value);
  return typeof result === 'string' ? result : JSON.stringify(result ?? null);
}

/** `undefined` when the `--jq` expression is one the shadow does not evaluate. */
function printJson(value: unknown, jq: string | undefined): GhOutcome | undefined {
  const printed = jq === undefined ? JSON.stringify(value) : applyJq(value, jq);
  return printed === undefined ? undefined : succeed(`${printed}\n`);
}

function jsonFields(parsed: ParsedArgs): string[] | undefined {
  const fields = (lastValue(parsed, '--json') ?? '').split(',').map((field) => field.trim()).filter(Boolean);
  return fields.length > 0 ? fields : undefined;
}

const authToken: GhHandler = (args) => (args.length === 0 ? succeed(`${FAKE_TOKEN}\n`) : undefined);

const repoView: GhHandler = (args, { state }) => {
  const parsed = parseArgs(args, { values: ['--json', '--jq'] });
  if (!parsed || parsed.positionals.length !== 1 || lastValue(parsed, '--json') !== 'defaultBranchRef') return undefined;
  const [repository] = parsed.positionals;
  if (!sameRepository(state, repository)) return unknownRepository(repository);
  return printJson({ defaultBranchRef: { name: state.repository.defaultBranch } }, lastValue(parsed, '--jq'));
};

function view(
  args: readonly string[],
  { state }: GhContext,
  find: (state: ForgeState, number: string) => object | undefined,
  notFound: (number: string) => GhOutcome,
): GhOutcome | undefined {
  const parsed = parseArgs(args, VIEW_FLAGS);
  const fields = parsed && jsonFields(parsed);
  const repository = parsed && lastValue(parsed, '--repo');
  if (!parsed || !fields || !repository || parsed.positionals.length !== 1 || !isNumber(parsed.positionals[0])) return undefined;

  if (!sameRepository(state, repository)) return unknownRepository(repository);
  const [number] = parsed.positionals;
  const record = find(state, number);
  if (!record) return notFound(number);
  const projected = projectFields(record, fields);
  return projected && printJson(projected, lastValue(parsed, '--jq'));
}

const issueView: GhHandler = (args, context) => view(args, context, (state, number) => state.issues[number], notAnIssue);

const prView: GhHandler = (args, context) => view(args, context, (state, number) => state.pullRequests[number], notAPullRequest);

function limitOf(parsed: ParsedArgs): number | undefined {
  const limit = lastValue(parsed, '--limit');
  if (limit === undefined) return DEFAULT_LIST_LIMIT;
  return isNumber(limit) ? Number(limit) : undefined;
}

/** `label:<name>` qualifiers must all hold, and every other word must appear in the title or the body, in any case. */
function matchesSearch(issue: GhIssue, search: string | undefined): boolean {
  const tokens = (search ?? '').match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const haystack = `${issue.title} ${issue.body}`.toLowerCase();
  return tokens.every((token) => {
    const label = /^label:(.+)$/.exec(token)?.[1].replace(/"/g, '');
    return label === undefined ? haystack.includes(token.replace(/"/g, '').toLowerCase()) : issue.labels.some((candidate) => candidate.name === label);
  });
}

function newestFirst(a: GhIssue, b: GhIssue): number {
  return b.createdAt.localeCompare(a.createdAt) || b.number - a.number;
}

/** A listing of `gh <noun> list`, projected, with the repository and the fields it names checked first. */
function list<T extends object>(
  parsed: ParsedArgs | undefined,
  state: ForgeState,
  records: (parsed: ParsedArgs) => T[] | undefined,
): GhOutcome | undefined {
  const fields = parsed && jsonFields(parsed);
  const repository = parsed && lastValue(parsed, '--repo');
  const limit = parsed && limitOf(parsed);
  if (!parsed || !fields || !repository || limit === undefined || parsed.positionals.length > 0) return undefined;

  if (!sameRepository(state, repository)) return unknownRepository(repository);
  const selected = records(parsed)?.slice(0, limit);
  const projected = selected?.map((record) => projectFields(record, fields));
  if (!projected || projected.includes(undefined)) return undefined;
  return printJson(projected, lastValue(parsed, '--jq'));
}

const ISSUE_STATES: Readonly<Record<string, readonly GhIssue['state'][]>> = { open: ['OPEN'], closed: ['CLOSED'], all: ['OPEN', 'CLOSED'] };
const PR_STATES: Readonly<Record<string, readonly GhPullRequest['state'][]>> = { open: ['OPEN'], closed: ['CLOSED'], merged: ['MERGED'], all: ['OPEN', 'CLOSED', 'MERGED'] };

const issueList: GhHandler = (args, { state }) =>
  list(parseArgs(args, ISSUE_LIST_FLAGS), state, (parsed) => {
    const states = ISSUE_STATES[lastValue(parsed, '--state') ?? 'open'];
    if (!states) return undefined;
    return Object.values(state.issues)
      .filter((issue) => states.includes(issue.state))
      .filter((issue) => allValues(parsed, '--label').every((label) => issue.labels.some((candidate) => candidate.name === label)))
      .filter((issue) => matchesSearch(issue, lastValue(parsed, '--search')))
      .sort(newestFirst);
  });

const prList: GhHandler = (args, { state }) =>
  list(parseArgs(args, PR_LIST_FLAGS), state, (parsed) => {
    const states = PR_STATES[lastValue(parsed, '--state') ?? 'open'];
    const head = lastValue(parsed, '--head');
    if (!states) return undefined;
    return Object.values(state.pullRequests)
      .filter((pullRequest) => states.includes(pullRequest.state))
      .filter((pullRequest) => head === undefined || pullRequest.headRefName === head)
      .sort((a, b) => b.number - a.number);
  });

function restComment(comment: GhComment): object {
  const id = Number(comment.id);
  return { id: Number.isNaN(id) ? comment.id : id, body: comment.body, user: { login: comment.author.login }, created_at: comment.createdAt, updated_at: comment.updatedAt };
}

function restReviews(pullRequest: GhPullRequest): object[] {
  return pullRequest.reviews.map((review, index) => ({
    id: index + 1,
    user: { login: review.author.login },
    state: review.state,
    body: review.body,
    submitted_at: review.submittedAt,
  }));
}

/** The comments of an issue, or of a pull request, which the issues API also serves. */
function conversationOf(state: ForgeState, number: string): readonly GhComment[] | undefined {
  return (state.issues[number] ?? state.pullRequests[number])?.comments;
}

/** The REST reads ADW makes through `gh api`; any other path is a call the shadow does not support. */
export function apiRead(path: string, { state }: GhContext): GhOutcome | undefined {
  const normalised = path.replace(/^\//, '');
  if (normalised === 'user') return succeed(`${JSON.stringify({ login: 'adw-harness', type: 'User' })}\n`);

  const match = COMMENTS_OR_REVIEWS.exec(normalised);
  if (!match) return undefined;
  const [, owner, repo, area, number, kind] = match;
  if (!sameRepository(state, `${owner}/${repo}`)) return unknownRepository(`${owner}/${repo}`);

  const notFound = fail('gh: Not Found (HTTP 404)');
  if (area === 'pulls' && kind === 'comments') return state.pullRequests[number] ? succeed('[]\n') : notFound;
  if (area === 'pulls') return state.pullRequests[number] ? succeed(`${JSON.stringify(restReviews(state.pullRequests[number]))}\n`) : notFound;
  if (kind !== 'comments') return undefined;

  const comments = conversationOf(state, number);
  return comments ? succeed(`${JSON.stringify(comments.map(restComment))}\n`) : notFound;
}

export const READ_HANDLERS: Readonly<Record<string, GhHandler>> = {
  'auth token': authToken,
  'repo view': repoView,
  'issue view': issueView,
  'issue list': issueList,
  'pr view': prView,
  'pr list': prList,
};
