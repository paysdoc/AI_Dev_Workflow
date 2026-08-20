/**
 * BDD step definitions for feature-779.feature
 *
 * Each scenario's Given builds a REAL throwaway git repository in a temp
 * directory (`git init` + `git remote add origin <url>`, both purely local)
 * and the identity is resolved by calling the REAL `readLocalRepoInfo` /
 * `getRepoInfo`, which shell out to the real `git remote get-url origin` in
 * that temp repo. Nothing here re-implements the URL parse.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { readLocalRepoInfo } from '../../../adws/providers/github/githubIdentity.ts';
import type { RepoInfo } from '../../../adws/providers/github/githubIdentity.ts';
import { getRepoInfo } from '../../../adws/github/githubApi.ts';
import { resolveContextToken } from '../../../adws/providers/github/tokenResolver.ts';

// ---------------------------------------------------------------------------
// Module-level scenario state (reset in the @adw-779 Before hook)
// ---------------------------------------------------------------------------

interface MintCall {
  owner: string;
  repo: string;
}

const state: {
  tempDir: string;
  lastResult: RepoInfo | null;
  lastError: Error | null;
  bothEntryPoints: { readLocal: RepoInfo | null; getRepoInfo: RepoInfo | null };
  mintCalls: MintCall[];
} = {
  tempDir: '',
  lastResult: null,
  lastError: null,
  bothEntryPoints: { readLocal: null, getRepoInfo: null },
  mintCalls: [],
};

// ---------------------------------------------------------------------------
// Before / After — throwaway temp git repo per scenario
// ---------------------------------------------------------------------------

Before({ tags: '@adw-779' }, function () {
  state.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-779-'));
  state.lastResult = null;
  state.lastError = null;
  state.bothEntryPoints = { readLocal: null, getRepoInfo: null };
  state.mintCalls = [];
});

After({ tags: '@adw-779' }, function () {
  if (state.tempDir) {
    fs.rmSync(state.tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attemptReadLocalRepoInfo(): void {
  try {
    state.lastResult = readLocalRepoInfo(state.tempDir);
    state.lastError = null;
  } catch (err) {
    state.lastResult = null;
    state.lastError = err as Error;
  }
}

// ---------------------------------------------------------------------------
// Given — build the throwaway clone
// ---------------------------------------------------------------------------

Given('a local clone whose origin remote is {string}', function (remote: string) {
  execSync('git init -q', { cwd: state.tempDir, stdio: 'pipe' });
  execSync(`git remote add origin "${remote}"`, { cwd: state.tempDir, stdio: 'pipe' });
});

// ---------------------------------------------------------------------------
// When — §1/§2/§3/§6 single entry point
// ---------------------------------------------------------------------------

When('the local repository identity is read from that clone', function () {
  attemptReadLocalRepoInfo();
});

When('reading the local repository identity from that clone is attempted', function () {
  attemptReadLocalRepoInfo();
});

// ---------------------------------------------------------------------------
// When — §4 both cwd-derived entry points
// ---------------------------------------------------------------------------

When('the local repository identity is read from that clone through both cwd-derived entry points', function () {
  state.bothEntryPoints = {
    readLocal: readLocalRepoInfo(state.tempDir),
    getRepoInfo: getRepoInfo(state.tempDir),
  };
});

// ---------------------------------------------------------------------------
// When — §5 the crash surface: identity handed to the App token mint
// ---------------------------------------------------------------------------

When('an App installation token is minted for the identity read from that clone', function () {
  const info = readLocalRepoInfo(state.tempDir);
  state.mintCalls = [];
  resolveContextToken({
    owner: info.owner,
    repo: info.repo,
    pat: undefined,
    isAppConfigured: () => true,
    mintInstallationToken: (owner: string, repo: string) => {
      state.mintCalls.push({ owner, repo });
      return `installation-token::${owner}/${repo}`;
    },
    ghAuthToken: () => '',
  });
});

// ---------------------------------------------------------------------------
// Then — §1/§2/§3 resolved identity
// ---------------------------------------------------------------------------

Then('the resolved identity is owner {string} and repository {string}', function (owner: string, repo: string) {
  assert.ok(
    state.lastResult,
    `Expected a resolved identity but readLocalRepoInfo threw: ${state.lastError?.message}`,
  );
  assert.strictEqual(state.lastResult.owner, owner);
  assert.strictEqual(state.lastResult.repo, repo);
});

// ---------------------------------------------------------------------------
// Then — §4 both entry points agree
// ---------------------------------------------------------------------------

Then('both cwd-derived entry points resolve the identity to owner {string} and repository {string}', function (owner: string, repo: string) {
  assert.deepStrictEqual(state.bothEntryPoints.readLocal, { owner, repo });
  assert.deepStrictEqual(state.bothEntryPoints.getRepoInfo, { owner, repo });
});

// ---------------------------------------------------------------------------
// Then — §5 the recorded mint target
// ---------------------------------------------------------------------------

Then('the recorded installation-token mint targets the repository {string}', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  assert.ok(
    state.mintCalls.some((c) => c.owner === owner && c.repo === repo),
    `Expected a mint call for ${fullName}, got: ${JSON.stringify(state.mintCalls)}`,
  );
});

Then('no installation-token mint targets the repository {string}', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  assert.ok(
    !state.mintCalls.some((c) => c.owner === owner && c.repo === repo),
    `Expected no mint call for ${fullName}, but found one: ${JSON.stringify(state.mintCalls)}`,
  );
});

// ---------------------------------------------------------------------------
// Then — §6 loud failure on a non-GitHub remote
// ---------------------------------------------------------------------------

Then('reading the local repository identity fails loudly rather than returning an identity', function () {
  assert.ok(state.lastError instanceof Error, 'Expected readLocalRepoInfo to throw, but it returned a result');
});
