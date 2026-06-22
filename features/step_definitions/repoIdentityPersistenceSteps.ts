import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AgentStateManager } from '../../adws/core/agentState';
import { crossCheckRepoIdentity, RepoIdentityMismatchError } from '../../adws/core/repoIdentityCrossCheck';
import { AGENTS_STATE_DIR } from '../../adws/core/config';
import type { RepoIdentity } from '../../adws/types/agentTypes';

// World extension for resume-time cross-check results
interface ResumeResult {
  error: RepoIdentityMismatchError | null;
  launchIdentity: RepoIdentity | null;
}

const resumeResults = new Map<string, ResumeResult>();

// Track adwIds touched in each scenario for cleanup
const touchedAdwIds = new Set<string>();

function cleanAdwId(adwId: string): void {
  const dir = path.join(AGENTS_STATE_DIR, adwId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

Before({ tags: '@adw-665' }, function () {
  resumeResults.clear();
  touchedAdwIds.clear();
});

After({ tags: '@adw-665' }, function () {
  for (const adwId of touchedAdwIds) cleanAdwId(adwId);
  resumeResults.clear();
  touchedAdwIds.clear();
});

// §1 — Init-time identity persistence (round-trip)

Given(
  'a workflow for adwId {string} is initialised under launch identity owner {string} repo {string}',
  function (adwId: string, owner: string, repo: string) {
    touchedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      issueNumber: 665,
      workflowStage: 'starting',
      repoIdentity: { owner, repo },
    });
  },
);

Then(
  'the top-level state for adwId {string} records repo identity owner {string} repo {string}',
  function (adwId: string, expectedOwner: string, expectedRepo: string) {
    touchedAdwIds.add(adwId);
    const state = AgentStateManager.readTopLevelState(adwId);
    assert.ok(state !== null, `Expected state for adwId "${adwId}" to exist`);
    assert.ok(state!.repoIdentity !== undefined, 'Expected repoIdentity to be present in state');
    assert.strictEqual(state!.repoIdentity!.owner, expectedOwner, `owner mismatch`);
    assert.strictEqual(state!.repoIdentity!.repo, expectedRepo, `repo mismatch`);
  },
);

// §2, §3, §4 — Resume-time cross-check setup

Given(
  'a top-level state for adwId {string} persists repo identity owner {string} repo {string}',
  function (adwId: string, owner: string, repo: string) {
    touchedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      issueNumber: 665,
      workflowStage: 'starting',
      repoIdentity: { owner, repo },
    });
  },
);

Given(
  'a top-level state for adwId {string} persists no repo identity',
  function (adwId: string) {
    touchedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      issueNumber: 665,
      workflowStage: 'starting',
    });
  },
);

// §2, §3, §4 — Resume action (reads persisted, runs cross-check)

When(
  'a process resumes adwId {string} under launch identity owner {string} repo {string}',
  function (adwId: string, owner: string, repo: string) {
    touchedAdwIds.add(adwId);
    const launchIdentity: RepoIdentity = { owner, repo };
    const priorState = AgentStateManager.readTopLevelState(adwId);
    let error: RepoIdentityMismatchError | null = null;
    try {
      crossCheckRepoIdentity(launchIdentity, priorState?.repoIdentity);
    } catch (e) {
      if (e instanceof RepoIdentityMismatchError) {
        error = e;
      } else {
        throw e;
      }
    }
    resumeResults.set(adwId, { error, launchIdentity });
  },
);

// §2, §4 — Passing cross-check assertions

Then('the resume cross-check passes', function () {
  for (const result of resumeResults.values()) {
    assert.strictEqual(result.error, null, `Expected cross-check to pass but got: ${result.error?.message}`);
  }
});

Then(
  'the resume proceeds under launch identity owner {string} repo {string}',
  function (expectedOwner: string, expectedRepo: string) {
    for (const result of resumeResults.values()) {
      assert.ok(result.launchIdentity !== null, 'Expected launch identity to be recorded');
      assert.strictEqual(result.launchIdentity!.owner, expectedOwner, 'launch identity owner mismatch');
      assert.strictEqual(result.launchIdentity!.repo, expectedRepo, 'launch identity repo mismatch');
    }
  },
);

// §3 — Mismatch assertions

Then('the resume surfaces a repo-identity mismatch error', function () {
  for (const result of resumeResults.values()) {
    assert.ok(
      result.error instanceof RepoIdentityMismatchError,
      `Expected RepoIdentityMismatchError but got: ${result.error}`,
    );
  }
});

Then(
  'the mismatch error names the persisted identity {string} and the launch identity {string}',
  function (persistedLabel: string, launchLabel: string) {
    for (const result of resumeResults.values()) {
      assert.ok(result.error !== null, 'Expected a mismatch error to be present');
      const msg = result.error!.message;
      assert.ok(
        msg.includes(persistedLabel),
        `Expected error message to contain persisted identity "${persistedLabel}" but got: "${msg}"`,
      );
      assert.ok(
        msg.includes(launchLabel),
        `Expected error message to contain launch identity "${launchLabel}" but got: "${msg}"`,
      );
    }
  },
);

// §5 — TypeScript type-check backstop (registry T22) is handled by feature-504.steps.ts
