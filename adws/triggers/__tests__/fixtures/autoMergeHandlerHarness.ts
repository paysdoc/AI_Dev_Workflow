import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import type { ExecFn } from '@paysdoc/devplatform/git';

export interface SpyCall {
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function isConflictingMerge(argv: readonly string[]): boolean {
  return argv[1] === 'merge' && (argv.includes('--no-commit') || argv.includes('--no-edit'));
}

export function makeSpyExec(
  stdout = '',
  conflictOnMerge: boolean | (() => boolean) = false,
): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const conflicts = typeof conflictOnMerge === 'function' ? conflictOnMerge : () => conflictOnMerge;
  const exec: ExecFn = (argv, options) => {
    calls.push({ argv: [...argv], cwd: options.cwd, env: options.env });
    if (conflicts() && isConflictingMerge(argv)) {
      throw Object.assign(new Error('CONFLICT (content)'), { status: 1 });
    }
    return stdout;
  };
  return { exec, calls };
}

export function makeGitContext(exec: ExecFn, owner = 'acme', repo = 'widgets'): GitContext {
  return new GitContext(
    {
      owner,
      repo,
      selfHost: false,
      tokenProvider: createLiteralTokenProvider('test-token'),
      gitIdentity: {
        authorName: 'ADW Bot',
        authorEmail: 'bot@adw.dev',
        committerName: 'ADW Bot',
        committerEmail: 'bot@adw.dev',
      },
      frameworkRepoRoot: '/srv/adw/framework',
      targetReposDir: '/srv/adw/repos',
    },
    { exec },
  );
}

export interface BaseCommit {
  readonly subject: string;
  /** The file in which this commit conflicts with the branch's own change. */
  readonly conflictsIn?: string;
  /** Author date, ISO 8601. */
  readonly authoredAt?: string;
  /** A merge commit is left out of every `--no-merges` read, yet merging it in still moves HEAD. */
  readonly isMerge?: boolean;
}

export interface ScriptedRepositoryOptions {
  readonly baseBranch?: string;
  /** Subjects of the commits the branch holds on its own. */
  readonly ownCommits?: readonly string[];
  /** The commits on the base branch that the branch lacks. */
  readonly behind?: readonly BaseCommit[];
  /** How many pushes fail before one succeeds. */
  readonly failPushes?: number;
}

export interface ScriptedRepository {
  readonly exec: ExecFn;
  readonly calls: SpyCall[];
  /** The `--since` value of every `git log --oneline` read, in order. */
  readonly sinceReads: string[];
  head(): string;
  /** A commit lands on the base branch that the branch lacks. */
  landOnBase(commit: BaseCommit): void;
  /** What a successful `/resolve_conflict` run leaves behind: the base branch merged into the branch by a merge commit. */
  mergeBaseByAgent(): void;
  failBaseFetches(): void;
  /** The `git log --oneline` line of each subject. */
  onelineOf(...subjects: readonly string[]): string[];
}

const DEFAULT_AUTHORED_AT = '2026-10-20T10:00:00+02:00';

function shortHash(text: string): string {
  let hash = 2166136261;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0').slice(0, 7);
}

const onelineLine = (subject: string): string => `${shortHash(subject)} ${subject}`;

const conflictError = (): Error => Object.assign(new Error('CONFLICT (content): Merge conflict'), { status: 1 });

/**
 * A repository that answers the git reads and writes of the merge loop from a small model of it, so that HEAD moves when the
 * base branch is merged in, as it does in git. A path in conflict is printed twice by `git diff --name-only`, as git does.
 */
export function makeScriptedRepository(options: ScriptedRepositoryOptions = {}): ScriptedRepository {
  const { baseBranch = 'main', ownCommits = [] } = options;
  const calls: SpyCall[] = [];
  const sinceReads: string[] = [];
  const behind: BaseCommit[] = [...(options.behind ?? [])];
  const merged: BaseCommit[] = [];
  let headMoves = 0;
  let inConflict = false;
  let pushFailures = options.failPushes ?? 0;
  let baseFetchFails = false;

  const conflictedFiles = (): string[] => [...new Set(behind.flatMap((commit) => (commit.conflictsIn ? [commit.conflictsIn] : [])))];
  const hasConflicts = (): boolean => conflictedFiles().length > 0;
  const withoutMerges = (commits: readonly BaseCommit[]): BaseCommit[] => commits.filter((commit) => !commit.isMerge);

  const takeBase = (): void => {
    if (behind.length === 0) return;
    merged.push(...behind.splice(0));
    headMoves += 1;
    inConflict = false;
  };

  const fetch = (args: readonly string[]): string => {
    if (args[1] === baseBranch && baseFetchFails) throw new Error('fatal: unable to access origin');
    return '';
  };

  const merge = (args: readonly string[]): string => {
    if (args.includes('--abort')) {
      inConflict = false;
      return '';
    }
    if (hasConflicts()) {
      inConflict = !args.includes('--no-commit');
      throw conflictError();
    }
    if (!args.includes('--no-commit')) takeBase();
    return '';
  };

  const log = (args: readonly string[]): string => {
    const [first = ''] = args;
    if (first.startsWith('--since=')) {
      sinceReads.push(first.slice('--since='.length));
      return [...withoutMerges(merged), ...ownCommits.map((subject) => ({ subject }))].map((commit) => onelineLine(commit.subject)).join('\n');
    }
    if (first.includes('..origin/')) {
      return withoutMerges(behind).map((commit) => `${commit.authoredAt ?? DEFAULT_AUTHORED_AT} ${commit.subject}`).join('\n');
    }
    return '';
  };

  const diff = (args: readonly string[]): string => {
    if (args[0] !== '--name-only' || !inConflict) return '';
    return conflictedFiles().flatMap((file) => [file, file]).join('\n');
  };

  const push = (): string => {
    if (pushFailures === 0) return '';
    pushFailures -= 1;
    throw new Error('error: failed to push some refs');
  };

  const exec: ExecFn = (argv, execOptions) => {
    calls.push({ argv: [...argv], cwd: execOptions.cwd, env: execOptions.env });
    const [, command = '', ...args] = argv;
    switch (command) {
      case 'fetch':
        return fetch(args);
      case 'merge':
        return merge(args);
      case 'log':
        return log(args);
      case 'diff':
        return diff(args);
      case 'push':
        return push();
      case 'rev-parse':
        return `a${headMoves.toString(16).padStart(6, '0')}`;
      default:
        return '';
    }
  };

  return {
    exec,
    calls,
    sinceReads,
    head: () => `a${headMoves.toString(16).padStart(6, '0')}`,
    landOnBase: (commit) => void behind.push(commit),
    mergeBaseByAgent: takeBase,
    failBaseFetches: () => void (baseFetchFails = true),
    onelineOf: (...subjects) => subjects.map(onelineLine),
  };
}
