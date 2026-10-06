/**
 * The deploy workflow's change detection, run for a push against a throwaway repository.
 * `dorny/paths-filter` is a bundled GitHub Action and is not executed; what this module ports is
 * its push-event path (`getChangedFilesFromGit` in v3's src/main.ts and the helpers it calls in
 * src/git.ts), including the fetches it makes into a shallow checkout, and the way its `Filter`
 * matches files (picomatch with `dot: true`). The inputs come from the workflow file itself, so
 * editing the workflow changes the outcome. A workflow trigger that GitHub would not fire for the
 * push (its `paths` filter, matched against the whole push) is reported as not triggered.
 */

import * as fs from 'fs';
import * as path from 'path';

import { changedFilesBetween, tryGit, type ReleasePush, type ThrowawayRepo } from './feature-936-throwawayRepo.ts';
import {
  evaluateExpressions,
  globMatches,
  readFilters,
  readPushTrigger,
  readStepInputs,
  type PushTrigger,
} from './feature-936-workflowConfig.ts';

const WORKFLOW_PATH = '.github/workflows/deploy-workers.yml';
const PATHS_FILTER_ACTION = 'dorny/paths-filter@';
const INITIAL_FETCH_DEPTH = 10;
const NULL_SHA = '0'.repeat(40);

export type DetectionOutcome =
  | { readonly kind: 'not-triggered' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'completed'; readonly changedFiles: readonly string[]; readonly marked: Readonly<Record<string, boolean>> };

interface PushEvent {
  readonly ref: string;
  readonly before: string;
  readonly defaultBranch: string;
}

/** What the action reports with `core.setFailed`: a git command that exits non-zero, or a ref it cannot resolve. */
class ActionFailure extends Error {}

const shortName = (ref: string): string => ref.replace(/^refs\/(?:heads|tags)\//, '');
const isGitSha = (ref: string): boolean => /^[a-z0-9]{40}$/.test(ref);
const namesOf = (output: string): string[] => output.split('\0').filter(Boolean);

function run(dir: string, args: readonly string[]): string {
  const result = tryGit(dir, args);
  if (result.status !== 0) {
    throw new ActionFailure(`The process 'git ${args.join(' ')}' failed with exit code ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function localRef(dir: string, name: string): string | undefined {
  if (isGitSha(name)) return tryGit(dir, ['cat-file', '-e', `${name}^{commit}`]).status === 0 ? name : undefined;

  const refs = tryGit(dir, ['show-ref', name]).stdout
    .split(/\r?\n/)
    .map(line => /refs\/(?:heads|tags|remotes\/origin)\/(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null && match[1] === name)
    .map(match => match[0]);
  return refs.find(ref => ref.startsWith('refs/remotes/origin/')) ?? refs[0];
}

function ensureRefAvailable(dir: string, name: string): string {
  const fetchThenResolve = (fetchArgs: readonly string[]): string | undefined => {
    run(dir, ['fetch', ...fetchArgs]);
    return localRef(dir, name);
  };
  const ref = localRef(dir, name)
    ?? fetchThenResolve(['--depth=1', '--no-tags', 'origin', name])
    ?? fetchThenResolve(['--depth=1', '--tags', 'origin', name]);
  if (ref === undefined) {
    throw new ActionFailure(`Could not determine what is ${name} - fetch works but it's not a branch, tag or commit SHA`);
  }
  return ref;
}

function getChanges(dir: string, base: string, head: string): string[] {
  const baseRef = ensureRefAvailable(dir, base);
  const headRef = ensureRefAvailable(dir, head);
  return namesOf(run(dir, ['diff', '--no-renames', '--name-only', '-z', `${baseRef}..${headRef}`]));
}

function fetchBothRefs(dir: string, base: string, head: string): { baseRef: string; headRef: string } {
  run(dir, ['fetch', '--no-tags', `--depth=${INITIAL_FETCH_DEPTH}`, 'origin', base, head]);
  const resolve = (): [string | undefined, string | undefined] => [localRef(dir, base), localRef(dir, head)];
  let [baseRef, headRef] = resolve();
  if (baseRef === undefined || headRef === undefined) {
    tryGit(dir, ['fetch', '--tags', '--depth=1', 'origin', base, head]);
    [baseRef, headRef] = resolve();
  }
  if (baseRef === undefined) throw new ActionFailure(`Could not determine what is ${base} - fetch works but it's not a branch, tag or commit SHA`);
  if (headRef === undefined) throw new ActionFailure(`Could not determine what is ${head} - fetch works but it's not a branch, tag or commit SHA`);
  return { baseRef, headRef };
}

function commitCount(dir: string): number {
  return parseInt(run(dir, ['rev-list', '--count', '--all']), 10) || 0;
}

/** Deepens the checkout until the two refs share a commit; false when no history joins them. */
function deepenUntilMergeBase(dir: string, base: string, head: string, baseRef: string, headRef: string): boolean {
  const hasMergeBase = (): boolean => tryGit(dir, ['merge-base', baseRef, headRef]).status === 0;
  let depth = INITIAL_FETCH_DEPTH;
  let lastCommitCount = commitCount(dir);
  while (!hasMergeBase()) {
    depth *= 2;
    run(dir, ['fetch', `--deepen=${depth}`, 'origin', base, head]);
    const count = commitCount(dir);
    if (count === lastCommitCount) {
      run(dir, ['fetch']);
      return hasMergeBase();
    }
    lastCommitCount = count;
  }
  return true;
}

function getChangesSinceMergeBase(dir: string, base: string, head: string): string[] {
  const localBase = localRef(dir, base);
  const localHead = localRef(dir, head);
  const joined = localBase !== undefined && localHead !== undefined
    && tryGit(dir, ['merge-base', localBase, localHead]).status === 0;

  const { baseRef, headRef } = joined ? { baseRef: localBase, headRef: localHead } : fetchBothRefs(dir, base, head);
  const hasMergeBase = joined || deepenUntilMergeBase(dir, base, head, baseRef, headRef);
  const range = hasMergeBase ? `${baseRef}...${headRef}` : `${baseRef}..${headRef}`;
  return namesOf(run(dir, ['diff', '--no-renames', '--name-only', '-z', range]));
}

function getChangedFilesFromGit(dir: string, inputs: { base: string; ref: string }, event: PushEvent): string[] {
  if (inputs.base === 'HEAD') return namesOf(run(dir, ['diff', '--no-renames', '--name-only', '-z', 'HEAD']));

  const head = shortName(inputs.ref || event.ref);
  const base = shortName(inputs.base || event.defaultBranch);
  const isBaseSha = isGitSha(base);
  if (!isBaseSha && base !== head) return getChangesSinceMergeBase(dir, base, head);

  const baseSha = isBaseSha ? base : event.before;
  if (baseSha === NULL_SHA) throw new Error('The first push of a branch is not modelled');
  return getChanges(dir, baseSha, head);
}

function triggersWorkflow(trigger: PushTrigger, branch: string, pushedFiles: readonly string[]): boolean {
  if (!trigger.branches.some(pattern => globMatches(pattern, branch))) return false;
  const { paths } = trigger;
  return paths === undefined || pushedFiles.some(file => paths.some(pattern => globMatches(pattern, file)));
}

/**
 * Runs the deploy workflow's change detection for the push of `push` to the release branch of
 * `repo`, in `checkoutDir`, the way the workflow's runner would.
 */
export function detectWorkersToDeploy(repo: ThrowawayRepo, push: ReleasePush, checkoutDir: string): DetectionOutcome {
  const workflow = fs.readFileSync(path.join(checkoutDir, WORKFLOW_PATH), 'utf-8');
  const event: PushEvent = { ref: `refs/heads/${repo.releaseBranch}`, before: push.before, defaultBranch: repo.defaultBranch };

  const pushedFiles = changedFilesBetween(repo, `${push.before}..${push.after}`);
  if (!triggersWorkflow(readPushTrigger(workflow), repo.releaseBranch, pushedFiles)) return { kind: 'not-triggered' };

  const context = {
    'github.ref': event.ref,
    'github.ref_name': repo.releaseBranch,
    'github.sha': push.after,
    'github.event_name': 'push',
    'github.event.before': push.before,
    'github.event.after': push.after,
    'github.event.repository.default_branch': repo.defaultBranch,
    'github.base_ref': '',
    'github.head_ref': '',
  };
  const inputs = readStepInputs(workflow, PATHS_FILTER_ACTION);
  const filters = readFilters(inputs['filters'] ?? '');
  const evaluated = (name: string): string => evaluateExpressions(inputs[name] ?? '', context);

  try {
    const changedFiles = getChangedFilesFromGit(checkoutDir, { base: evaluated('base'), ref: evaluated('ref') }, event);
    const marked = Object.fromEntries(
      Object.entries(filters).map(([name, patterns]) => [name, changedFiles.some(file => patterns.some(pattern => globMatches(pattern, file)))]),
    );
    return { kind: 'completed', changedFiles, marked };
  } catch (error) {
    if (error instanceof ActionFailure) return { kind: 'failed', message: error.message };
    throw error;
  }
}
