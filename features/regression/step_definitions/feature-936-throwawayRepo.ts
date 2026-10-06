/**
 * Throwaway git repositories laid out like the ADW repository: a default branch ("dev") that
 * releases are merged from, and a release branch ("main") that receives them as merge commits.
 * Every git command runs with the host's git configuration switched off, so signing or default
 * branch settings of the machine cannot reach the scenarios.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const WORKFLOW_PATH = '.github/workflows/deploy-workers.yml';

const BASELINE_FILES: Readonly<Record<string, string>> = {
  'README.md': '# Throwaway repository\n',
  'workers/cost-api/wrangler.toml': 'name = "cost-api"\n',
  'workers/cost-api/src/queries.ts': 'export const queries = [];\n',
  'workers/screenshot-router/wrangler.toml': 'name = "screenshot-router"\n',
  'workers/screenshot-router/src/index.ts': 'export default {};\n',
};

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'ADW Scenario',
  GIT_AUTHOR_EMAIL: 'scenario@example.com',
  GIT_COMMITTER_NAME: 'ADW Scenario',
  GIT_COMMITTER_EMAIL: 'scenario@example.com',
};

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ThrowawayRepo {
  readonly dir: string;
  readonly defaultBranch: string;
  readonly releaseBranch: string;
}

export interface ReleasePush {
  readonly before: string;
  readonly after: string;
}

export function tryGit(dir: string, args: readonly string[]): GitResult {
  const result = spawnSync('git', [...args], { cwd: dir, encoding: 'utf-8', env: GIT_ENV });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

export function git(dir: string, args: readonly string[]): string {
  const result = tryGit(dir, args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${result.stderr}`);
  return result.stdout.trim();
}

function writeFile(dir: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function commitFileChange(dir: string, file: string): void {
  const target = path.join(dir, file);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';
  writeFile(dir, file, `${previous}# changed by the scenario\n`);
  git(dir, ['add', '--', file]);
  git(dir, ['commit', '--quiet', '-m', `Change ${file}`]);
}

/** The default branch holds the previous release, and so does the release branch. */
export function createRepository(defaultBranch: string, releaseBranch: string): ThrowawayRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-936-repo-'));
  git(dir, ['init', '--quiet', '-b', defaultBranch]);
  Object.entries(BASELINE_FILES).forEach(([file, content]) => writeFile(dir, file, content));
  writeFile(dir, WORKFLOW_PATH, fs.readFileSync(path.join(process.cwd(), WORKFLOW_PATH), 'utf-8'));
  git(dir, ['add', '--all']);
  git(dir, ['commit', '--quiet', '-m', 'Previous release']);
  git(dir, ['branch', releaseBranch]);
  return { dir, defaultBranch, releaseBranch };
}

export function commitOnDefaultBranch(repo: ThrowawayRepo, file: string): void {
  git(repo.dir, ['checkout', '--quiet', repo.defaultBranch]);
  commitFileChange(repo.dir, file);
}

export function mergePullRequestIntoDefaultBranch(repo: ThrowawayRepo, file: string): void {
  const number = Number(git(repo.dir, ['rev-list', '--count', '--merges', repo.defaultBranch])) + 1;
  const branch = `feature-${number}`;
  git(repo.dir, ['checkout', '--quiet', '-b', branch, repo.defaultBranch]);
  commitFileChange(repo.dir, file);
  git(repo.dir, ['checkout', '--quiet', repo.defaultBranch]);
  git(repo.dir, ['merge', '--quiet', '--no-ff', branch, '-m', `Merge pull request #${number} from acme/${branch}`]);
}

/** The way releases are merged: a merge commit whose first parent is the previous release. */
export function mergeDefaultBranchIntoRelease(repo: ThrowawayRepo): ReleasePush {
  const before = git(repo.dir, ['rev-parse', repo.releaseBranch]);
  git(repo.dir, ['checkout', '--quiet', repo.releaseBranch]);
  git(repo.dir, ['merge', '--quiet', '--no-ff', repo.defaultBranch, '-m', `Merge pull request #1 from acme/${repo.defaultBranch}`]);
  return { before, after: git(repo.dir, ['rev-parse', 'HEAD']) };
}

export function changedFilesBetween(repo: ThrowawayRepo, range: string): string[] {
  return git(repo.dir, ['diff', '--name-only', range]).split('\n').filter(Boolean);
}

/**
 * A runner's checkout. `full` is an ordinary clone. `pushed-commit-only` is what
 * `actions/checkout` makes by default: the pushed commit fetched at depth 1 into a fresh
 * repository whose remote carries the usual `+refs/heads/*:refs/remotes/origin/*` refspec.
 */
export function openCheckout(repo: ThrowawayRepo, push: ReleasePush, history: 'full' | 'pushed-commit-only'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-936-checkout-'));
  const origin = `file://${repo.dir}`;
  if (history === 'full') {
    git(dir, ['clone', '--quiet', origin, '.']);
    git(dir, ['checkout', '--quiet', repo.releaseBranch]);
    return dir;
  }
  git(dir, ['init', '--quiet']);
  git(dir, ['remote', 'add', 'origin', origin]);
  git(dir, ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', `+${push.after}:refs/remotes/origin/${repo.releaseBranch}`]);
  git(dir, ['checkout', '--quiet', '-B', repo.releaseBranch, `refs/remotes/origin/${repo.releaseBranch}`]);
  return dir;
}
