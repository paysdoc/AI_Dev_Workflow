/**
 * The stand-in review agent: the review phase spawns the claude-cli-stub, which answers with a
 * verdict the steps script through the stub's manifest marker file. No real agent ever runs.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';
import type { ReviewResult } from '../../../adws/agents/reviewAgent.ts';
import { world } from './feature-937-world.ts';

const FRAMEWORK_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLAUDE_CLI_STUB_PATH = path.resolve(FRAMEWORK_REPO_ROOT, 'test/mocks/claude-cli-stub.ts');

// The stub's result line, which is what the review agent parses, keeps only the first 500 characters of the verdict.
const STUB_RESULT_LIMIT = 500;

function buildVerdict(blocker: string | null, proofFiles: readonly string[]): ReviewResult {
  if (blocker === null) {
    return { success: true, reviewSummary: 'LGTM', reviewIssues: [], screenshots: [...proofFiles] };
  }
  return {
    success: false,
    reviewSummary: 'Blocked',
    reviewIssues: [
      {
        reviewIssueNumber: 1,
        issueDescription: blocker,
        issueResolution: 'Fix it',
        issueSeverity: 'blocker',
        remediationStrategy: 'patch',
      },
    ],
    screenshots: [...proofFiles],
  };
}

/** Writes the manifest marker the stub looks for in its working directory, so its next review answers with the scripted verdict. */
export function scriptStandInVerdict(worktreePath: string, scenarioProofPath: string): void {
  assert.ok(world.verdict, 'Expected the stand-in review agent to have been told to pass or fail the review');
  const proofFiles = world.listsProofFile && scenarioProofPath ? [scenarioProofPath] : [];
  const text = JSON.stringify(buildVerdict(world.verdict.blocker, proofFiles));
  assert.ok(
    text.length <= STUB_RESULT_LIMIT,
    `The stand-in verdict is ${text.length} characters; the stub would cut it at ${STUB_RESULT_LIMIT} and the review agent could not parse it`,
  );

  const payloadPath = path.join(worktreePath, '.adw-stub-review-payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify([{ type: 'text', text }]));
  fs.writeFileSync(path.join(worktreePath, '.adw-stub-manifest.json'), JSON.stringify({ jsonlPath: payloadPath, edits: [] }));
}

export function activateStandInAgent(): void {
  if (world.claudeCodePath) return;
  world.claudeCodePath = { previous: process.env['CLAUDE_CODE_PATH'] };
  process.env['CLAUDE_CODE_PATH'] = CLAUDE_CLI_STUB_PATH;
  clearClaudeCodePathCache();
}

export function deactivateStandInAgent(): void {
  if (!world.claudeCodePath) return;
  const { previous } = world.claudeCodePath;
  // After hooks run in reverse registration order and the @regression teardown registers after this file, so it may already have restored the variable; writing back the value saved at activation would clobber that.
  if (process.env['CLAUDE_CODE_PATH'] === CLAUDE_CLI_STUB_PATH) {
    if (previous === undefined) delete process.env['CLAUDE_CODE_PATH'];
    else process.env['CLAUDE_CODE_PATH'] = previous;
  }
  world.claudeCodePath = null;
  clearClaudeCodePathCache();
}
