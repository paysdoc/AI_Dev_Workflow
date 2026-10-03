/**
 * The throwaway place a workflow run happens in. GitHub checks out the change and nothing else, so
 * the checkout holds every file `git ls-files --cached --others --exclude-standard` lists, as it
 * stands in the working tree, and no ignored file. Its `node_modules` is a link to the ADW
 * checkout's own, which is why the `bun` shadow must make `bun install` do nothing.
 *
 * The ADW checkout itself will not do. `adws/core/environment.ts` calls `dotenv.config()` when it
 * is imported, and a host's env file may set CLAUDE_CODE_PATH, which sends the probe to the host's
 * real Claude CLI, or ANTHROPIC_API_KEY, which hands a run without the secret the host's key.
 *
 * Every step starts from an environment built from nothing, never from the cucumber process.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { writeStandIns, type StandInPaths } from './feature-939-standIns.ts';

export interface Sandbox extends StandInPaths {
  readonly root: string;
  readonly checkoutDir: string;
  readonly runnerTemp: string;
  /** What every step starts with: PATH, HOME, RUNNER_TEMP, CI, GITHUB_ACTIONS, GITHUB_WORKSPACE and GITHUB_EVENT_NAME. */
  readonly environment: Readonly<Record<string, string>>;
}

function listWorkingTree(repoRoot: string): string[] {
  const listing = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return listing.split('\0').filter(file => file !== '');
}

/** A tracked file the working tree no longer has is not copied, and neither is a directory (a submodule). */
function copyEntry(repoRoot: string, checkoutDir: string, relativePath: string): void {
  const source = path.join(repoRoot, relativePath);
  const target = path.join(checkoutDir, relativePath);
  const stat = fs.lstatSync(source, { throwIfNoEntry: false });
  if (stat === undefined || stat.isDirectory()) return;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), target);
  else fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
}

function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The tool the cucumber process itself runs under, or else the first one on its PATH. */
export function realExecutable(name: string): string {
  if (path.basename(process.execPath) === name) return process.execPath;
  const candidates = (process.env.PATH ?? '').split(path.delimiter).filter(dir => dir !== '').map(dir => path.join(dir, name));
  const found = candidates.find(isExecutableFile);
  if (found === undefined) throw new Error(`The scenarios need "${name}" on the PATH of the cucumber process`);
  return found;
}

export function makeDirectory(root: string, name: string): string {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  return directory;
}

interface Layout {
  readonly checkoutDir: string;
  readonly homeDir: string;
  readonly runnerTemp: string;
  readonly standIns: StandInPaths;
}

function layOut(root: string): Layout {
  return {
    checkoutDir: makeDirectory(root, 'checkout'),
    homeDir: makeDirectory(root, 'home'),
    runnerTemp: makeDirectory(root, 'runner-temp'),
    standIns: {
      binDir: makeDirectory(root, 'claude-bin'),
      shadowDir: makeDirectory(root, 'shadows'),
      recordPath: path.join(root, 'claude-calls.jsonl'),
      versionPath: path.join(root, 'claude-version'),
      answerPath: path.join(root, 'claude-answer.jsonl'),
    },
  };
}

/** Every file `git ls-files --cached --others --exclude-standard` lists in the ADW checkout, as it stands in its working tree. */
export function copyWorkingTree(repoRoot: string, checkoutDir: string): void {
  listWorkingTree(repoRoot).forEach(file => copyEntry(repoRoot, checkoutDir, file));
}

/** Without the ADW checkout's `node_modules` the run would find no tsx, and `bunx` would download it. */
function fillCheckout(repoRoot: string, checkoutDir: string): void {
  const modules = path.join(repoRoot, 'node_modules');
  if (!fs.existsSync(modules)) throw new Error(`The scenarios need the installed dependencies of the ADW checkout: ${modules} does not exist`);
  copyWorkingTree(repoRoot, checkoutDir);
  fs.symlinkSync(modules, path.join(checkoutDir, 'node_modules'));
}

function environmentFor(layout: Layout, toolDirs: readonly string[]): Record<string, string> {
  return {
    PATH: [...new Set([layout.standIns.binDir, layout.standIns.shadowDir, ...toolDirs])].join(path.delimiter),
    HOME: layout.homeDir,
    RUNNER_TEMP: layout.runnerTemp,
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKSPACE: layout.checkoutDir,
    GITHUB_EVENT_NAME: 'pull_request',
  };
}

function populate(root: string, repoRoot: string, answer: readonly string[]): Sandbox {
  const layout = layOut(root);
  fillCheckout(repoRoot, layout.checkoutDir);

  const realBun = realExecutable('bun');
  writeStandIns(layout.standIns, answer, realBun);
  const toolDirs = [path.dirname(realBun), path.dirname(realExecutable('node')), '/usr/bin', '/bin'];
  return {
    ...layout.standIns,
    root,
    checkoutDir: layout.checkoutDir,
    runnerTemp: layout.runnerTemp,
    environment: environmentFor(layout, toolDirs),
  };
}

/** The link to the ADW checkout's `node_modules` is removed on its own first, so that nothing can ever follow it. */
export function removeSandbox(sandbox: Pick<Sandbox, 'root' | 'checkoutDir'>): void {
  const link = path.join(sandbox.checkoutDir, 'node_modules');
  if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(link);
  fs.rmSync(sandbox.root, { recursive: true, force: true });
}

export function createSandbox(repoRoot: string, answer: readonly string[]): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-939-'));
  try {
    return populate(root, repoRoot, answer);
  } catch (error) {
    removeSandbox({ root, checkoutDir: path.join(root, 'checkout') });
    throw error;
  }
}
