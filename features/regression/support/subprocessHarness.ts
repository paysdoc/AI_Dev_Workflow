/**
 * The per-scenario state of a subprocess run, which the `@regression and (@subprocess or @webhook)`
 * Before hook creates: a temporary root holding the child's `TARGET_REPOS_DIR` and `HOME` and the `gh` shadow's
 * state and log, the shadow's directory, the launch recorder, the workspace of the target repository,
 * the adwIds and issues the scenario claimed, and the process groups the harness started.
 *
 * Setup saves what a child could change in the checkout, and teardown, on the World's cleanup list,
 * puts it back: the auth gate, which a cron child would otherwise obey by skipping its poll and
 * SIGTERMing live orchestrators, and the cron registry and log of the target repository.
 */

import assert from 'assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';

import { AUTH_GATE_PATH } from '../../../adws/core/authGate.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { releaseIssueSpawnLock } from '../../../adws/triggers/spawnGate.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';
import { materialiseTargetWorkspace } from './fixtureTargetRepo.ts';
import { installGhShadow } from './forgeShadow.ts';
import { createLaunchRecorder, disposeLaunchRecorder, type LaunchRecorder } from './launchRecorder.ts';
import { SURFACE_REPO } from './mockForgeProviders.ts';

export interface SubprocessHarness {
  /** Holds everything below; removing it removes all of it. */
  readonly root: string;
  /** The child's `TARGET_REPOS_DIR`. Its root is where a row's stub manifest is put, above every worktree a run creates. */
  readonly targetReposDir: string;
  /** The child's `HOME`: the target-repo setup writes `$HOME/.claude.json`. */
  readonly homeDir: string;
  readonly forgeStatePath: string;
  readonly forgeLogPath: string;
  readonly ghBinDir: string;
  readonly recorder: LaunchRecorder;
  workspacePath: string | null;
  /** The groups of children that are still running. A group leaves it once the harness has reaped it. */
  readonly processGroups: Set<number>;
  readonly claimedAdwIds: Set<string>;
  readonly claimedIssues: Set<number>;
}

/**
 * `agents/<adwId>/` also holds the state of real workflows, so the harness clears only the directories of
 * adwIds made up for a scenario: `surface-…`, `throwaway<N>-…`, or the `<name>-smoke-<N>` a smoke file names.
 * A real adwId starts with a random six-character id, then the issue's slug.
 */
const MADE_UP_ADW_ID = /^((surface|throwaway\d+)-[a-z0-9-]+|[a-z]+(-[a-z]+)*-smoke-\d+)$/;

const REPO_KEY = `${SURFACE_REPO.owner}_${SURFACE_REPO.repo}`;
const AUTH_GATE_FILE = resolve(REPO_ROOT, AUTH_GATE_PATH);
const CRON_FILES: readonly string[] = [
  resolve(REPO_ROOT, 'agents', 'cron', `${REPO_KEY}.json`),
  resolve(REPO_ROOT, 'logs', 'agents', 'cron', `${REPO_KEY}.log`),
];

interface SavedFile {
  readonly path: string;
  /** Null when the file was absent. */
  readonly content: Buffer | null;
}

function saveFile(path: string): SavedFile {
  return { path, content: existsSync(path) ? readFileSync(path) : null };
}

function restoreFile({ path, content }: SavedFile): void {
  if (content === null) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function removeDirectories(directories: readonly string[]): void {
  directories.forEach((directory) => rmSync(directory, { recursive: true, force: true }));
}

export function requireHarness(world: Pick<RegressionWorld, 'subprocess'>): SubprocessHarness {
  assert.ok(world.subprocess, 'Expected the @regression and (@subprocess or @webhook) Before hook to have set up the subprocess harness');
  return world.subprocess;
}

function makeDirectory(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function createSubprocessHarness(world: Pick<RegressionWorld, 'cleanup'>): SubprocessHarness {
  const root = mkdtempSync(join(tmpdir(), 'adw-subprocess-'));
  const forgeDir = makeDirectory(join(root, 'forge'));
  const harness: SubprocessHarness = {
    root,
    targetReposDir: makeDirectory(join(root, 'repos')),
    homeDir: makeDirectory(join(root, 'home')),
    forgeStatePath: join(forgeDir, 'state.json'),
    forgeLogPath: join(forgeDir, 'log.ndjson'),
    ghBinDir: installGhShadow(root),
    recorder: createLaunchRecorder(),
    workspacePath: null,
    processGroups: new Set(),
    claimedAdwIds: new Set(),
    claimedIssues: new Set(),
  };

  const savedAuthGate = saveFile(AUTH_GATE_FILE);
  const savedCronFiles = CRON_FILES.map(saveFile);
  rmSync(AUTH_GATE_FILE, { force: true });

  // Last in, first out: the entries a run pushes later (killing its process group, removing its state) run before these.
  world.cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  world.cleanup.push(() => disposeLaunchRecorder(harness.recorder));
  world.cleanup.push(() => harness.claimedIssues.forEach((issue) => releaseIssueSpawnLock(SURFACE_REPO, issue)));
  world.cleanup.push(() => [savedAuthGate, ...savedCronFiles].forEach(restoreFile));
  return harness;
}

/** Whatever removes `agents/<adwId>/` must name only an adwId made up for a scenario. */
export function assertMadeUpAdwId(adwId: string): void {
  assert.match(adwId, MADE_UP_ADW_ID, `Only an adwId made up for a scenario (surface-…, throwaway<N>-… or <name>-smoke-<N>) may be acted on, since its agents/ and logs/ directories are removed; got "${adwId}"`);
}

/** The first claim in a scenario clears the adwId's state and logs, so a crashed earlier run cannot decide the outcome; later claims leave what a Given seeded. */
export function claimAdwId(world: RegressionWorld, adwId: string): void {
  const harness = requireHarness(world);
  assertMadeUpAdwId(adwId);
  if (harness.claimedAdwIds.has(adwId)) return;

  harness.claimedAdwIds.add(adwId);
  const directories = [join(AGENTS_STATE_DIR, adwId), join(LOGS_DIR, adwId)];
  removeDirectories(directories);
  world.cleanup.push(() => removeDirectories(directories));
}

export function claimIssue(world: RegressionWorld, issueNumber: number): void {
  requireHarness(world).claimedIssues.add(issueNumber);
}

export function ensureTargetWorkspace(world: RegressionWorld): string {
  const harness = requireHarness(world);
  harness.workspacePath ??= materialiseTargetWorkspace(SURFACE_REPO.owner, SURFACE_REPO.repo, harness.targetReposDir);
  return harness.workspacePath;
}
