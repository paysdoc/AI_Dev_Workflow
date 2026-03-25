/**
 * Test harness for ADW mock infrastructure.
 *
 * Wires together the Claude CLI stub, GitHub API mock server, and git remote
 * mock. Provides setup() and teardown() functions for Cucumber Before/After
 * hooks. Environment variable changes are fully reversible.
 */

import { mkdirSync, mkdtempSync, cpSync, writeFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import {
  startMockServer,
  stopMockServer,
  getRecordedRequests,
  applyState,
  resetMockServer,
} from './github-api-server.ts';
import type { MockConfig, MockContext, MockServerState, FixtureRepoContext } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Saved original env var values for restoration on teardown. */
interface SavedEnv {
  CLAUDE_CODE_PATH: string | undefined;
  PATH: string | undefined;
  GH_TOKEN: string | undefined;
  GH_HOST: string | undefined;
  REAL_GIT_PATH: string | undefined;
  MOCK_GITHUB_API_URL: string | undefined;
  MOCK_SERVER_PORT: string | undefined;
}

let savedEnv: SavedEnv | null = null;
let gitMockTempDir: string | null = null;
let isSetUp = false;

/** Resolves the real git binary path before PATH is modified. */
function findRealGit(): string {
  try {
    return execSync('which git', { encoding: 'utf-8' }).trim();
  } catch {
    return '/usr/bin/git';
  }
}

/**
 * Creates a temporary directory containing a `git` wrapper shell script that
 * delegates to the git-remote-mock TypeScript file via bun.
 */
function createGitMockDir(realGitPath: string): string {
  const tempDir = join(process.cwd(), '.tmp-git-mock');
  mkdirSync(tempDir, { recursive: true });

  const gitRemoteMockPath = resolve(__dirname, 'git-remote-mock.ts');
  const wrapperContent = [
    '#!/bin/sh',
    `export REAL_GIT_PATH="${realGitPath}"`,
    `exec bun "${gitRemoteMockPath}" "$@"`,
  ].join('\n') + '\n';

  const wrapperPath = join(tempDir, 'git');
  writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });

  return tempDir;
}

/** Removes the temporary git mock directory. */
function cleanupGitMockDir(): void {
  if (gitMockTempDir && existsSync(gitMockTempDir)) {
    try {
      execSync(`rm -rf "${gitMockTempDir}"`, { stdio: 'pipe' });
    } catch {
      // best-effort cleanup
    }
  }
  gitMockTempDir = null;
}

/** Builds a MockContext pointing at the running server on the given port. */
function buildContext(port: number): MockContext {
  const serverUrl = `http://localhost:${port}`;

  const setState = async (state: Partial<MockServerState>): Promise<void> => {
    applyState(state);
  };

  const teardown = async (): Promise<void> => {
    await teardownMockInfrastructure();
  };

  return { serverUrl, port, getRecordedRequests, setState, teardown };
}

/**
 * Sets up the full mock infrastructure.
 *
 * - Starts the GitHub API mock server on a random port
 * - Sets CLAUDE_CODE_PATH to point at the CLI stub
 * - Prepends a temp dir with a mock `git` wrapper to PATH
 * - Sets GH_TOKEN and GH_HOST so `gh` CLI can route to the mock
 *
 * Idempotent: calling setup twice without teardown returns the existing context.
 */
export async function setupMockInfrastructure(
  config?: Partial<MockConfig>,
): Promise<MockContext> {
  if (isSetUp) {
    const existingPort = parseInt(process.env['MOCK_SERVER_PORT'] ?? '0', 10);
    return buildContext(existingPort);
  }

  // Save originals before any mutation
  savedEnv = {
    CLAUDE_CODE_PATH: process.env['CLAUDE_CODE_PATH'],
    PATH: process.env['PATH'],
    GH_TOKEN: process.env['GH_TOKEN'],
    GH_HOST: process.env['GH_HOST'],
    REAL_GIT_PATH: process.env['REAL_GIT_PATH'],
    MOCK_GITHUB_API_URL: process.env['MOCK_GITHUB_API_URL'],
    MOCK_SERVER_PORT: process.env['MOCK_SERVER_PORT'],
  };

  // Start GitHub API mock server
  const { port, url } = await startMockServer(config?.port ?? 0);

  // Set up Claude CLI stub
  const stubPath = config?.stubPath ?? resolve(__dirname, 'claude-cli-stub.ts');
  process.env['CLAUDE_CODE_PATH'] = stubPath;

  // Set up git remote mock
  const realGitPath = findRealGit();
  gitMockTempDir = config?.gitMockDir ?? createGitMockDir(realGitPath);
  const originalPath = process.env['PATH'] ?? '';
  process.env['PATH'] = `${gitMockTempDir}:${originalPath}`;
  process.env['REAL_GIT_PATH'] = realGitPath;

  // Configure GitHub mock routing environment
  process.env['GH_TOKEN'] = 'mock-token';
  process.env['GH_HOST'] = `localhost:${port}`;
  process.env['MOCK_GITHUB_API_URL'] = url;
  process.env['MOCK_SERVER_PORT'] = String(port);

  isSetUp = true;

  return buildContext(port);
}

/**
 * Stops all mocks and restores original environment variables.
 * Safe to call multiple times.
 */
export async function teardownMockInfrastructure(): Promise<void> {
  if (!isSetUp) return;

  stopMockServer();
  cleanupGitMockDir();

  if (savedEnv) {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    savedEnv = null;
  }

  delete process.env['MOCK_SERVER_PORT'];
  isSetUp = false;
}

/**
 * Resets mock server state without stopping it.
 * Use between scenarios when keeping the server running for performance.
 */
export function resetMock(): void {
  resetMockServer();
}

/**
 * Copies a fixture template to a temp directory and initializes it as a git repo.
 *
 * - Copies `test/fixtures/{fixtureName}/` to a fresh temp directory
 * - Runs `git init`, `git add .`, and `git commit` using the real git binary
 * - Returns the temp directory path and a cleanup function
 *
 * Must be called after `setupMockInfrastructure()` so that `REAL_GIT_PATH` is
 * already set, ensuring the real git is used rather than the mock wrapper.
 *
 * @param fixtureName - Subdirectory under test/fixtures/ to copy (default: 'cli-tool')
 */
export function setupFixtureRepo(fixtureName = 'cli-tool'): FixtureRepoContext {
  const sourceDir = resolve(process.cwd(), 'test/fixtures', fixtureName);
  if (!existsSync(sourceDir)) {
    throw new Error(`Fixture source directory not found: ${sourceDir}`);
  }

  const tempBase = mkdtempSync(join(tmpdir(), 'adw-fixture-'));
  const repoDir = join(tempBase, 'repo');
  cpSync(sourceDir, repoDir, { recursive: true });

  const gitBin = process.env['REAL_GIT_PATH'] ?? findRealGit();
  execSync(`"${gitBin}" init`, { cwd: repoDir, stdio: 'pipe' });
  execSync(`"${gitBin}" config user.email "test@adw.local"`, { cwd: repoDir, stdio: 'pipe' });
  execSync(`"${gitBin}" config user.name "ADW Test"`, { cwd: repoDir, stdio: 'pipe' });
  execSync(`"${gitBin}" add .`, { cwd: repoDir, stdio: 'pipe' });
  execSync(`"${gitBin}" commit -m "Initial fixture commit"`, { cwd: repoDir, stdio: 'pipe' });

  const cleanup = (): void => {
    try {
      execSync(`rm -rf "${tempBase}"`, { stdio: 'pipe' });
    } catch {
      // best-effort cleanup
    }
  };

  return { repoDir, cleanup };
}

/** Removes the fixture repo temp directory. */
export function teardownFixtureRepo(ctx: FixtureRepoContext): void {
  ctx.cleanup();
}
