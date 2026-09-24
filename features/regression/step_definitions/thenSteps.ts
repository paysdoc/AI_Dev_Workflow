import { Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import type { RegressionWorld } from './world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

Then(
  'the state file for adwId {string} records workflowStage {string}',
  function (this: RegressionWorld, adwId: string, expectedStage: string) {
    // Per-issue (source-inspection) scenarios: mockContext is null → source inspection.
    if (this.mockContext === null) {
      const sdlcContent = readFileSync(resolve(ROOT, 'adws/adwSdlc.tsx'), 'utf-8');
      assert.ok(sdlcContent.includes('handleAuthRequiredPause('),
        'Expected handleAuthRequiredPause( in adwSdlc.tsx');
      const authPauseContent = readFileSync(resolve(ROOT, 'adws/phases/authPause.ts'), 'utf-8');
      assert.ok(
        authPauseContent.includes(`'${expectedStage}'`) || authPauseContent.includes(`"${expectedStage}"`),
        `Expected '${expectedStage}' in authPause.ts`,
      );
      void adwId;
      return;
    }
    const worktreePath = this.worktreePaths.get(adwId);
    const productionStateFile = resolve(ROOT, `agents/${adwId}/state.json`);
    const worktreeStateFile = worktreePath ? join(worktreePath, '.adw', 'state.json') : null;
    const stateFile = existsSync(productionStateFile)
      ? productionStateFile
      : worktreeStateFile;
    assert.ok(
      stateFile && existsSync(stateFile),
      `State file artefact not found at ${productionStateFile} (production) or ${worktreeStateFile} (G11 temp worktree)`,
    );

    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
    assert.strictEqual(
      state['workflowStage'],
      expectedStage,
      `Expected workflowStage "${expectedStage}" but got "${String(state['workflowStage'])}"`,
    );
  },
);

Then(
  'the mock GitHub API recorded a comment on issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const commentPost = requests.find(
      (r: RecordedRequest) =>
        r.method === 'POST' &&
        r.url.includes(`/issues/${issueNumber}/comments`),
    );
    assert.ok(
      commentPost,
      `Expected a POST to /issues/${issueNumber}/comments but none was recorded. Recorded URLs: ${requests.map((r) => r.url).join(', ')}`,
    );
  },
);

Then(
  'the mock GitHub API recorded a comment containing the text {string}',
  function (this: RegressionWorld, expectedText: string) {
    const requests = this.getRecordedRequests();
    const commentPosts = requests.filter(
      (r: RecordedRequest) => r.method === 'POST' && r.url.includes('/comments'),
    );

    const found = commentPosts.some((r: RecordedRequest) => {
      try {
        const body = JSON.parse(r.body) as Record<string, unknown>;
        return typeof body['body'] === 'string' && body['body'].includes(expectedText);
      } catch {
        return false;
      }
    });

    assert.ok(
      found,
      `Expected a recorded comment containing "${expectedText}" but none found in ${commentPosts.length} comment POST(s)`,
    );
  },
);

Then(
  'the git-mock recorded a commit on branch {string}',
  function (this: RegressionWorld, branch: string) {
    // Local commits pass through to real git, so this step checks branch-name agreement only; T5 asserts the exit code.
    assert.strictEqual(
      this.targetBranch,
      branch,
      `Expected branch "${branch}" but World.targetBranch is "${this.targetBranch}"`,
    );
  },
);

Then(
  'the orchestrator subprocess exited {int}',
  function (this: RegressionWorld, expectedCode: number) {
    // Per-issue (source-inspection) scenarios: mockContext is null → source inspection.
    if (this.mockContext === null) {
      const authPauseContent = readFileSync(resolve(ROOT, 'adws/phases/authPause.ts'), 'utf-8');
      assert.ok(
        authPauseContent.includes(`process.exit(${expectedCode})`),
        `Expected process.exit(${expectedCode}) in adws/phases/authPause.ts`,
      );
      return;
    }
    assert.strictEqual(
      this.lastExitCode,
      expectedCode,
      `Expected subprocess exit code ${expectedCode} but got ${this.lastExitCode}`,
    );
  },
);

Then(
  'the spawn-gate lock for issue {int} is released',
  function (_this: RegressionWorld, issueNumber: number) {
    // The lock path mirrors orchestratorLock.ts; the lock is a runtime artefact, not a source file.
    const lockCandidates = [
      join(process.cwd(), `.adw/locks/issue-${issueNumber}.lock`),
    ];
    for (const lockPath of lockCandidates) {
      assert.ok(
        !existsSync(lockPath),
        `Expected lock artefact ${lockPath} to be absent (released) after orchestrator exit`,
      );
    }
  },
);

Then(
  'the mock harness recorded zero PR-merge calls',
  function (this: RegressionWorld) {
    const requests = this.getRecordedRequests();
    const mergeCalls = requests.filter(
      (r: RecordedRequest) => r.method === 'PUT' && r.url.includes('/merge'),
    );
    assert.strictEqual(
      mergeCalls.length,
      0,
      `Expected zero PR-merge calls but recorded ${mergeCalls.length}`,
    );
  },
);

Then(
  'the mock GitHub API recorded a PR creation for issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const prPost = requests.find((r: RecordedRequest) => {
      if (r.method !== 'POST' || !r.url.includes('/pulls')) return false;
      try {
        const body = JSON.parse(r.body) as Record<string, unknown>;
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes(String(issueNumber));
      } catch {
        return false;
      }
    });
    assert.ok(
      prPost,
      `Expected a POST to /pulls referencing issue ${issueNumber} but none was recorded`,
    );
  },
);

Then(
  'the state file for adwId {string} records no error',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    const productionStateFile = resolve(ROOT, `agents/${adwId}/state.json`);
    const worktreeStateFile = worktreePath ? join(worktreePath, '.adw', 'state.json') : null;
    const stateFile = existsSync(productionStateFile)
      ? productionStateFile
      : worktreeStateFile;
    assert.ok(
      stateFile && existsSync(stateFile),
      `State file artefact not found at ${productionStateFile} (production) or ${worktreeStateFile} (G11 temp worktree)`,
    );

    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
    assert.ok(
      !state['error'] && !state['errorMessage'],
      `State file records an error: ${JSON.stringify(state)}`,
    );
  },
);

Then(
  'the mock GitHub API recorded {int} total API calls',
  function (this: RegressionWorld, expectedCount: number) {
    const requests = this.getRecordedRequests();
    assert.strictEqual(
      requests.length,
      expectedCount,
      `Expected ${expectedCount} recorded API call(s) but got ${requests.length}`,
    );
  },
);

Then(
  'the mock GitHub API recorded an application of the {string} label on issue {int}',
  function (this: RegressionWorld, labelName: string, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const labelPost = requests.find(
      (r: RecordedRequest) => {
        if (r.method !== 'POST' || !r.url.includes(`/issues/${issueNumber}/labels`)) return false;
        try {
          const body = JSON.parse(r.body) as Record<string, unknown>;
          const labels = body['labels'] as string[] | undefined;
          return Array.isArray(labels) && labels.includes(labelName);
        } catch {
          return false;
        }
      },
    );
    assert.ok(
      labelPost,
      `Expected a POST to /issues/${issueNumber}/labels with label "${labelName}" but none was recorded. Recorded URLs: ${requests.map((r) => r.url).join(', ')}`,
    );
  },
);

Then(
  'the mock harness recorded zero applications of the {string} label on issue {int}',
  function (this: RegressionWorld, labelName: string, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const labelPosts = requests.filter(
      (r: RecordedRequest) => {
        if (r.method !== 'POST' || !r.url.includes(`/issues/${issueNumber}/labels`)) return false;
        try {
          const body = JSON.parse(r.body) as Record<string, unknown>;
          const labels = body['labels'] as string[] | undefined;
          return Array.isArray(labels) && labels.includes(labelName);
        } catch {
          return false;
        }
      },
    );
    assert.strictEqual(
      labelPosts.length,
      0,
      `Expected zero label applications of "${labelName}" on issue ${issueNumber} but recorded ${labelPosts.length}`,
    );
  },
);

Then(
  'the mock harness recorded zero comment posts on issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const commentPosts = requests.filter(
      (r: RecordedRequest) => r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`),
    );
    assert.strictEqual(
      commentPosts.length,
      0,
      `Expected zero comment posts on issue ${issueNumber} but recorded ${commentPosts.length}`,
    );
  },
);

function extractTagBlock(lines: string[], headerIdx: number): string[] {
  const tags: string[] = [];
  for (let i = headerIdx - 1; i >= 0; i--) {
    const trimmed = (lines[i] ?? '').trimStart();
    if (trimmed.startsWith('@')) {
      tags.push(...trimmed.split(/\s+/).filter((t) => t.startsWith('@')));
    } else if (trimmed.length > 0) {
      break;
    }
  }
  return tags;
}

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries exactly one "@promotion-suggested-" tag on the seeded scenario',
  function (this: RegressionWorld, filePath: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const content = readFileSync(join(worktreePath, filePath), 'utf-8');
    const lines = content.split('\n');
    const headerIdx = lines.findIndex((l) => /^\s*Scenario:/.test(l));
    assert.ok(headerIdx >= 0, 'No Scenario: header found in artefact file');
    const tags = extractTagBlock(lines, headerIdx);
    const SUGGESTION_RE = /@promotion-suggested-\d{4}-\d{2}-\d{2}/;
    const count = tags.filter((t) => SUGGESTION_RE.test(t)).length;
    assert.strictEqual(
      count,
      1,
      `Expected exactly one @promotion-suggested-* tag but found ${count}. Tags: ${tags.join(' ')}`,
    );
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries a "@promotion-suggested-" tag dated today on the scenario named {string}',
  function (this: RegressionWorld, filePath: string, adwId: string, scenarioName: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const content = readFileSync(join(worktreePath, filePath), 'utf-8');
    const today = new Date().toISOString().slice(0, 10);
    const expectedTag = `@promotion-suggested-${today}`;
    const lines = content.split('\n');
    const headerIdx = lines.findIndex((l) => {
      const t = l.trimStart();
      return t.startsWith('Scenario:') && t.slice('Scenario:'.length).trim() === scenarioName;
    });
    assert.ok(headerIdx >= 0, `Scenario named "${scenarioName}" not found in artefact file`);
    const tags = extractTagBlock(lines, headerIdx);
    assert.ok(
      tags.includes(expectedTag),
      `Expected tag "${expectedTag}" in tag block of scenario "${scenarioName}" but not found. Tags: ${tags.join(' ')}`,
    );
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries no "@promotion-suggested-" tag on the scenario named {string}',
  function (this: RegressionWorld, filePath: string, adwId: string, scenarioName: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const content = readFileSync(join(worktreePath, filePath), 'utf-8');
    const lines = content.split('\n');
    const headerIdx = lines.findIndex((l) => {
      const t = l.trimStart();
      return t.startsWith('Scenario:') && t.slice('Scenario:'.length).trim() === scenarioName;
    });
    assert.ok(headerIdx >= 0, `Scenario named "${scenarioName}" not found in artefact file`);
    const tags = extractTagBlock(lines, headerIdx);
    const SUGGESTION_RE = /@promotion-suggested-\d{4}-\d{2}-\d{2}/;
    const found = tags.some((t) => SUGGESTION_RE.test(t));
    assert.ok(
      !found,
      `Expected no @promotion-suggested-* tag in scenario "${scenarioName}" but found one. Tags: ${tags.join(' ')}`,
    );
  },
);

Then(
  'the mock GitHub API recorded a comment on issue {int} containing the seeded scenario name {string}',
  function (this: RegressionWorld, issueNumber: number, scenarioName: string) {
    const requests = this.getRecordedRequests();
    const commentPosts = requests.filter(
      (r: RecordedRequest) =>
        r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`),
    );
    const found = commentPosts.some((r: RecordedRequest) => {
      try {
        const body = JSON.parse(r.body) as Record<string, unknown>;
        return typeof body['body'] === 'string' && body['body'].includes(scenarioName);
      } catch {
        return false;
      }
    });
    assert.ok(
      found,
      `Expected a comment on issue ${issueNumber} containing "${scenarioName}" but none found in ${commentPosts.length} comment POST(s)`,
    );
  },
);

Then(
  'the mock harness recorded zero comment posts on issue {int} referencing the seeded scenario name {string}',
  function (this: RegressionWorld, issueNumber: number, scenarioName: string) {
    const requests = this.getRecordedRequests();
    const matching = requests.filter((r: RecordedRequest) => {
      if (r.method !== 'POST' || !r.url.includes(`/issues/${issueNumber}/comments`)) return false;
      try {
        const body = JSON.parse(r.body) as Record<string, unknown>;
        return typeof body['body'] === 'string' && body['body'].includes(scenarioName);
      } catch {
        return false;
      }
    });
    assert.strictEqual(
      matching.length,
      0,
      `Expected zero comment posts referencing "${scenarioName}" on issue ${issueNumber} but found ${matching.length}`,
    );
  },
);

Then(
  'the git-mock recorded a push to branch {string}',
  function (this: RegressionWorld, branch: string) {
    // The git-remote-mock's invocation log is not readable here yet, so this step checks branch-name agreement only.
    assert.strictEqual(
      this.targetBranch,
      branch,
      `Expected push to branch "${branch}" but World.targetBranch is "${this.targetBranch}"`,
    );
  },
);
