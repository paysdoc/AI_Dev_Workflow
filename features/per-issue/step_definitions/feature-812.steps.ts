/**
 * §1–§3 drive the REAL `runJanitorPass` / `discoverTargetRepoWorktrees` over a
 * throwaway `targetReposDir` (a fresh tmp directory per scenario), with only the
 * network- and OS-touching members of `DEFAULT_DEPS` stubbed (`listWorktrees`,
 * `hasProcessesInDirectory`, `killProcessesInDirectory`, `getWorktreeAgeMs`,
 * `listAdwStateDirs`, `readTopLevelState(Raw)`, `isAgentProcessRunning`, `log`).
 * `readdirTargetRepos`, `isGitRepo` and `hasAdwMarker` are left as the real
 * filesystem implementations so the marker-gate predicate under test is genuine.
 *
 * §4 spawns the REAL entrypoint (`bunx tsx adws/triggers/trigger_cron.ts`) as a
 * subprocess.
 */

import { Given, When, Then, Before, After, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_DEPS,
  runJanitorPass,
  JANITOR_GRACE_PERIOD_MS,
  type JanitorDeps,
} from '../../../adws/triggers/devServerJanitor';
import {
  createRealCronWorld,
  spawnRealCron,
  killRealCronWorld,
  readCronPid,
  isPidAlive,
  countOccurrences,
  waitForRealCron,
  type RealCronWorld,
} from './realCronProcess.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// Spawning a real cron subprocess and waiting out a 20s poll interval comfortably
// exceeds cucumber's 5s default step timeout.
setDefaultTimeout(60_000);

const YOUNG_MS = 0;
const OLD_MS = JANITOR_GRACE_PERIOD_MS * 2;

const world: {
  tmpRoot: string;
  worktreesByRepo: Map<string, string[]>;
  failingRepos: Map<string, string>;
  failingRepoName: string;
  processHoldingWorktrees: Set<string>;
  agedWorktrees: Set<string>;
  listWorktreesCalls: Array<{ owner: string; repo: string }>;
  listWorktreesSucceeded: Set<string>;
  hasProcessesCalls: string[];
  killCalls: string[];
  logCalls: Array<{ msg: string; level: string }>;
  passError: Error | null;
  passRan: boolean;
} = {
  tmpRoot: '',
  worktreesByRepo: new Map(),
  failingRepos: new Map(),
  failingRepoName: '',
  processHoldingWorktrees: new Set(),
  agedWorktrees: new Set(),
  listWorktreesCalls: [],
  listWorktreesSucceeded: new Set(),
  hasProcessesCalls: [],
  killCalls: [],
  logCalls: [],
  passError: null,
  passRan: false,
};

Before({ tags: '@adw-812' }, function () {
  world.tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-812-target-repos-'));
  world.worktreesByRepo = new Map();
  world.failingRepos = new Map();
  world.failingRepoName = '';
  world.processHoldingWorktrees = new Set();
  world.agedWorktrees = new Set();
  world.listWorktreesCalls = [];
  world.listWorktreesSucceeded = new Set();
  world.hasProcessesCalls = [];
  world.killCalls = [];
  world.logCalls = [];
  world.passError = null;
  world.passRan = false;
});

After({ tags: '@adw-812' }, function () {
  if (world.tmpRoot) {
    try { fs.rmSync(world.tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function repoDir(ownerRepo: string): string {
  return path.join(world.tmpRoot, ownerRepo);
}

function makeRepoDir(ownerRepo: string, opts: { git: boolean; marker: boolean }): void {
  const dir = repoDir(ownerRepo);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.git) fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  if (opts.marker) fs.mkdirSync(path.join(dir, '.adw'), { recursive: true });
}

function registerWorktree(ownerRepo: string, wtName: string): string {
  const wtPath = path.join(repoDir(ownerRepo), '.worktrees', wtName);
  fs.mkdirSync(wtPath, { recursive: true });
  const existing = world.worktreesByRepo.get(ownerRepo) ?? [];
  existing.push(wtPath);
  world.worktreesByRepo.set(ownerRepo, existing);
  return wtPath;
}

function findWorktreePath(wtName: string): string {
  for (const paths of world.worktreesByRepo.values()) {
    const found = paths.find(p => path.basename(p) === wtName);
    if (found) return found;
  }
  throw new Error(`Scenario bug: no worktree registered with name "${wtName}"`);
}

function buildDeps(): JanitorDeps {
  return {
    ...DEFAULT_DEPS,
    listWorktrees: (owner: string, repo: string) => {
      const key = `${owner}/${repo}`;
      world.listWorktreesCalls.push({ owner, repo });
      const failure = world.failingRepos.get(key);
      if (failure !== undefined) throw new Error(failure);
      world.listWorktreesSucceeded.add(key);
      return world.worktreesByRepo.get(key) ?? [];
    },
    hasProcessesInDirectory: (dirPath: string) => {
      world.hasProcessesCalls.push(dirPath);
      return world.processHoldingWorktrees.has(path.basename(dirPath));
    },
    killProcessesInDirectory: (dirPath: string) => {
      world.killCalls.push(dirPath);
    },
    getWorktreeAgeMs: (dirPath: string) => (world.agedWorktrees.has(path.basename(dirPath)) ? OLD_MS : YOUNG_MS),
    listAdwStateDirs: () => [],
    readTopLevelState: () => null,
    readTopLevelStateRaw: () => null,
    isAgentProcessRunning: () => false,
    log: (msg: string, level = 'info') => {
      world.logCalls.push({ msg, level });
    },
  };
}

Given('the target repositories root holds {string} with a git checkout and an ADW marker directory', function (ownerRepo: string) {
  makeRepoDir(ownerRepo, { git: true, marker: true });
});

Given('the target repositories root holds {string} with a git checkout and no ADW marker directory', function (ownerRepo: string) {
  makeRepoDir(ownerRepo, { git: true, marker: false });
});

Given('the target repositories root holds {string} with an ADW marker directory and no git checkout', function (ownerRepo: string) {
  makeRepoDir(ownerRepo, { git: false, marker: true });
});

Given('the repository {string} has a worktree {string}', function (ownerRepo: string, wtName: string) {
  registerWorktree(ownerRepo, wtName);
});

Given('the worktree listing for {string} fails with a GitHub App installation not-found error', function (ownerRepo: string) {
  world.failingRepos.set(ownerRepo, `GitHub App installation lookup failed for ${ownerRepo}: HTTP 404 (Not Found)`);
});

Given('the worktree {string} holds a live process', function (wtName: string) {
  world.processHoldingWorktrees.add(wtName);
});

Given('the worktree {string} is older than the janitor grace period with no live orchestrator', function (wtName: string) {
  world.agedWorktrees.add(wtName);
});

Given('the target repositories root holds three ADW-marked repositories with the failing one {string}', function (position: string) {
  const names = ['pos-owner-a/repo-a', 'pos-owner-b/repo-b', 'pos-owner-c/repo-c'];
  names.forEach(n => makeRepoDir(n, { git: true, marker: true }));
  const idx = position === 'first' ? 0 : position === 'middle' ? 1 : 2;
  world.failingRepoName = names[idx];
  names.forEach((n, i) => {
    if (i === idx) return;
    registerWorktree(n, `feature-issue-${i}-healthy-slug`);
  });
});

Given('the worktree listing for the failing repository fails with {string}', function (reason: string) {
  world.failingRepos.set(world.failingRepoName, reason);
});

When('the janitor pass runs', async function () {
  const deps = buildDeps();
  try {
    await runJanitorPass(deps, world.tmpRoot);
    world.passError = null;
  } catch (err) {
    world.passError = err instanceof Error ? err : new Error(String(err));
  }
  world.passRan = true;
});

Then('the janitor lists no worktrees for repository {string}', function (ownerRepo: string) {
  const attempted = world.listWorktreesCalls.some(c => `${c.owner}/${c.repo}` === ownerRepo);
  assert.ok(!attempted, `Expected listWorktrees never to be called for "${ownerRepo}". Calls: ${JSON.stringify(world.listWorktreesCalls)}`);
});

Then('the janitor lists the worktrees of repository {string}', function (ownerRepo: string) {
  assert.ok(
    world.listWorktreesSucceeded.has(ownerRepo),
    `Expected listWorktrees to have succeeded for "${ownerRepo}". Succeeded: ${JSON.stringify([...world.listWorktreesSucceeded])}`,
  );
});

Then('the janitor lists the worktrees of both healthy repositories', function () {
  const healthy = ['pos-owner-a/repo-a', 'pos-owner-b/repo-b', 'pos-owner-c/repo-c'].filter(n => n !== world.failingRepoName);
  for (const repo of healthy) {
    assert.ok(
      world.listWorktreesSucceeded.has(repo),
      `Expected listWorktrees to have succeeded for healthy repository "${repo}". Succeeded: ${JSON.stringify([...world.listWorktreesSucceeded])}`,
    );
  }
});

Then('the janitor probes no worktree under repository {string}', function (ownerRepo: string) {
  const prefix = repoDir(ownerRepo);
  const probed = world.hasProcessesCalls.some(p => p.startsWith(prefix));
  assert.ok(!probed, `Expected no worktree under "${ownerRepo}" to be probed. Probed: ${JSON.stringify(world.hasProcessesCalls)}`);
});

Then('the janitor kills no processes under repository {string}', function (ownerRepo: string) {
  const prefix = repoDir(ownerRepo);
  const killed = world.killCalls.some(p => p.startsWith(prefix));
  assert.ok(!killed, `Expected no processes under "${ownerRepo}" to be killed. Killed: ${JSON.stringify(world.killCalls)}`);
});

Then('the janitor probes the worktree {string}', function (wtName: string) {
  const wtPath = findWorktreePath(wtName);
  assert.ok(world.hasProcessesCalls.includes(wtPath), `Expected worktree "${wtName}" to be probed. Probed: ${JSON.stringify(world.hasProcessesCalls)}`);
});

Then('the janitor cleans the orphaned processes in worktree {string}', function (wtName: string) {
  const wtPath = findWorktreePath(wtName);
  assert.ok(world.killCalls.includes(wtPath), `Expected worktree "${wtName}" to have been cleaned. Killed: ${JSON.stringify(world.killCalls)}`);
});

Then('the janitor logs a warning naming repository {string}', function (ownerRepo: string) {
  const found = world.logCalls.some(c => c.level === 'warn' && c.msg.includes(ownerRepo));
  assert.ok(found, `Expected a warn log naming "${ownerRepo}". Logs: ${JSON.stringify(world.logCalls)}`);
});

Then('the janitor logs a warning naming the failing repository', function () {
  const found = world.logCalls.some(c => c.level === 'warn' && c.msg.includes(world.failingRepoName));
  assert.ok(found, `Expected a warn log naming "${world.failingRepoName}". Logs: ${JSON.stringify(world.logCalls)}`);
});

Then('the janitor pass completes without raising', function () {
  assert.ok(world.passRan, 'Expected "the janitor pass runs" to have executed first');
  assert.strictEqual(world.passError, null, `Expected the janitor pass to resolve without raising. Raised: ${world.passError}`);
});

const cronWorld: RealCronWorld & { pauseQueuePath: string; targetReposDir: string; tickGuardWorktreePath: string } = {
  ...createRealCronWorld(),
  pauseQueuePath: '',
  targetReposDir: '',
  tickGuardWorktreePath: '',
};

Before({ tags: '@adw-812' }, function () {
  Object.assign(cronWorld, createRealCronWorld());
  cronWorld.pauseQueuePath = '';
  cronWorld.targetReposDir = '';
  cronWorld.tickGuardWorktreePath = '';
});

After({ tags: '@adw-812' }, function () {
  killRealCronWorld(cronWorld);
  if (cronWorld.pauseQueuePath) {
    try { fs.unlinkSync(cronWorld.pauseQueuePath); } catch { /* never created */ }
  }
  if (cronWorld.targetReposDir) {
    try { fs.rmSync(cronWorld.targetReposDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (cronWorld.tickGuardWorktreePath) {
    try { fs.rmSync(cronWorld.tickGuardWorktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function spawnCron(repoKey: string, extraEnv: NodeJS.ProcessEnv): void {
  spawnRealCron(cronWorld, repoKey, extraEnv);
}

async function waitFor(predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
  await waitForRealCron(cronWorld, predicate, timeoutMs, description);
}

Given('a cron trigger process whose poll tick raises on every cycle', async function () {
  // The lever must be an entry the "adw-812-fixture/tick-guard" cron owns
  // (its --target-repo matches the entry's recorded target repository), since a non-owner
  // now gets skip_not_owner before any other rule and the old target-less lever would never
  // be reached: an owned, due entry whose issueNumber contains "/", so
  // acquireIssueSpawnLock's lock-file path resolves a parent directory that does not exist.
  // The write throws ENOENT before any lock file exists — deterministic, before the entry is
  // removed or the spawn lock is taken, and never swallowed by scanPauseQueue or
  // checkAndTrigger, so it reaches runGuardedTick on every cycle.
  cronWorld.pauseQueuePath = path.join(REPO_ROOT, 'agents', 'paused_queue.json');
  fs.mkdirSync(path.dirname(cronWorld.pauseQueuePath), { recursive: true });
  cronWorld.tickGuardWorktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-812-tick-guard-worktree-'));
  fs.writeFileSync(cronWorld.pauseQueuePath, JSON.stringify([
    {
      adwId: 'adw812fixture',
      issueNumber: '999999/evil',
      orchestratorScript: 'adws/adwSdlc.tsx',
      pausedAtPhase: 'sdlc_planner',
      pauseReason: 'unknown_error',
      pausedAt: new Date().toISOString(),
      worktreePath: cronWorld.tickGuardWorktreePath,
      branchName: 'adw-812-fixture',
      extraArgs: ['--target-repo', 'adw-812-fixture/tick-guard'],
    },
  ], null, 2));

  cronWorld.targetReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-812-cron-targets-'));
  spawnCron('adw-812-fixture/tick-guard', {
    PROBE_INTERVAL_CYCLES: '1',
    TARGET_REPOS_DIR: cronWorld.targetReposDir,
  });
  await waitFor(() => cronWorld.stdout.includes('CRON trigger (backlog sweeper) started'), 15_000, 'cron trigger startup line');
});

Given(
  'a cron trigger process polling a target repositories root that holds {string} with a git checkout and no ADW marker directory',
  async function (ownerRepo: string) {
    cronWorld.targetReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-812-cron-targets-'));
    fs.mkdirSync(path.join(cronWorld.targetReposDir, ownerRepo, '.git'), { recursive: true });

    spawnCron('adw-812-fixture/janitor-e2e', {
      JANITOR_INTERVAL_CYCLES: '1',
      TARGET_REPOS_DIR: cronWorld.targetReposDir,
    });
    await waitFor(() => cronWorld.stdout.includes('CRON trigger (backlog sweeper) started'), 15_000, 'cron trigger startup line');
  },
);

Given('the GitHub App is not installed on {string}', function (_ownerRepo: string) {
  // No-op: this scenario's spawned cron process (see spawnCron) is given no GitHub App
  // credentials at all (GITHUB_APP_ID/PRIVATE_KEY_PATH cleared), so no App is configured,
  // let alone installed on any repo — trivially true by construction. Documents the
  // incident's real-world precondition; nothing to wire, since the marker gate (§1) means
  // listWorktrees (and therefore any App-token resolution) is never even attempted for an
  // unmarked repo.
});

When('the cron trigger loop runs past the failing tick', async function () {
  await waitFor(
    () => countOccurrences(cronWorld.stdout, 'checkAndTrigger: tick failed (non-fatal)') >= 1,
    20_000,
    'the first failing tick to be logged',
  );
});

When('the cron trigger loop runs its janitor cycle', async function () {
  // POLL: (trigger_cron.ts) is logged once per tick, strictly after the cadence-gated
  // janitor pass — its presence proves the tick ran the janitor pass and continued
  // normally past it (the unmarked repo is skipped silently, so there is no janitor log
  // line of its own to wait on here; that silence is exactly what §1 established).
  await waitFor(() => countOccurrences(cronWorld.stdout, 'POLL:') >= 1, 20_000, 'the first poll tick to complete past the janitor pass');
});

Then('the cron trigger logs the tick failure as an error', function () {
  assert.ok(
    cronWorld.stdout.includes('checkAndTrigger: tick failed (non-fatal)'),
    `Expected the tick-failure error log. stdout:\n${cronWorld.stdout}`,
  );
});

Then('the cron trigger process is still running', async function () {
  // Let any in-flight exit event (racing the last log flush) settle.
  await new Promise(resolve => setTimeout(resolve, 300));
  const pid = readCronPid(cronWorld.repoKey);
  assert.ok(pid !== null, `Expected a cron PID file for ${cronWorld.repoKey}. stdout:\n${cronWorld.stdout}`);
  assert.ok(
    isPidAlive(pid as number),
    `Expected cron process (pid ${pid}) to still be alive. exitInfo: ${JSON.stringify(cronWorld.exitInfo)}\nstdout:\n${cronWorld.stdout}\nstderr:\n${cronWorld.stderr}`,
  );
});

Then('the cron trigger process has not exited on an unhandled promise rejection', function () {
  // Node's fatal-exit shape for an unhandled rejection: a stack trace followed by a
  // "Node.js vNN.N.N" banner on stderr, and (pre-fix) process termination. We already
  // proved liveness in the previous step; this asserts the crash SHAPE never appeared.
  assert.ok(
    !cronWorld.stderr.includes('Node.js v'),
    `Expected no Node.js fatal-exit banner in stderr (unhandled rejection). stderr:\n${cronWorld.stderr}`,
  );
  assert.ok(
    !/unhandled/i.test(cronWorld.stderr),
    `Expected no "unhandled" rejection text in stderr. stderr:\n${cronWorld.stderr}`,
  );
});

Then('the cron trigger executes its next poll tick', async function () {
  const marker = cronWorld.stdout.includes('checkAndTrigger: tick failed (non-fatal)') ? 'checkAndTrigger: tick failed (non-fatal)' : 'POLL:';
  await waitFor(
    () => countOccurrences(cronWorld.stdout, marker) >= 2,
    30_000,
    `a second occurrence of "${marker}" (proof the interval fired again, ~POLL_INTERVAL_MS after the first)`,
  );
});
